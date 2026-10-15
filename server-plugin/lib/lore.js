'use strict';
const { normalizeBaselines } = require('./lore-baselines');
const { normalizeGating, matchesGating } = require('./lore-gating');
const crypto = require('node:crypto');
const { LoreFiles } = require('./lore-files');
const { adaptLore } = require('./lore-adapters');
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keys = value => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []).filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean).slice(0, 100);

function importWorldInfo(input, publicIds = [], options = {}) {
    input = adaptLore(input, options);
    if (typeof input === 'string') {
        if (Buffer.byteLength(input) > 500000) fail('Lore file exceeds 500 KB');
        try { input = JSON.parse(input.replace(/^\uFEFF/, '')); } catch { fail('Invalid World Info JSON'); }
    }
    if (!input || !input.entries || typeof input.entries !== 'object') fail('Expected World Info entries object or array');
    if (!Array.isArray(publicIds) || publicIds.some(id => typeof id !== 'string')) fail('Invalid visibility selection');
    const rows = Object.entries(input.entries);
    if (rows.length > 500) fail('At most 500 entries per library');
    const ids = new Set();
    const entries = rows.map(([key, row]) => {
        if (!row || typeof row !== 'object' || typeof row.content !== 'string') fail('Every entry needs string content');
        if (row.content.length > 20000) fail('Entry exceeds 20000 characters');
        if (row.summary !== undefined && (typeof row.summary !== 'string' || row.summary.length > 20000)) fail('Summary must be text of at most 20000 characters');
        const id = String(row.uid ?? key);
        if (!/^[A-Za-z0-9_.:@-]{1,100}$/.test(id) || ids.has(id)) fail('Duplicate or invalid entry ID');
        ids.add(id);
        const secondary = keys(row.keysecondary);
        // Unsupported conditional semantics must never broaden activation.
        const unsupported = row.selective === true && ![undefined, 0].includes(row.selectiveLogic);
        const locked = ['secret','self','restricted'].includes(row.extensions?.narrative_engine?.visibility);
        return { id, source: { adapter: input.adapter, ref: id, hash: hash(row) }, title: String(row.comment ?? id).slice(0,200),
            baselines: normalizeBaselines(row.extensions?.narrative_engine?.baselines),
            gating: normalizeGating(row.extensions?.narrative_engine?.gating), visibleTo: row.extensions?.narrative_engine?.visibleTo || [], summary: row.summary || '', tags: keys(row.tags), type: row.loreType || 'other', links: row.links || [],
            insertionOrder: Number(row.insertionOrder) || 0, caseSensitive: row.caseSensitive === true,
            body: row.content, keys: keys(row.key), secondaryKeys: secondary, selective: row.selective === true,
            priority: Number.isFinite(Number(row.order)) ? Number(row.order) : 0, always: row.constant === true,
            status: row.disable === true || unsupported ? 'disabled' : 'active',
            visibility: publicIds.includes(id) && !locked ? 'public' : 'hidden', locked, unsupported };
    });
    if (publicIds.some(id => !ids.has(id))) fail('Unknown entry in visibility selection');
    return { entries, ...(input.mappingProfile ? {mappingProfile:input.mappingProfile} : {}), report: { adapter: input.adapter, warnings: input.warnings || [], total: entries.length, public: entries.filter(e => e.visibility === 'public').length,
        hidden: entries.filter(e => e.visibility === 'hidden').length, unsupported: entries.filter(e => e.unsupported).map(e => e.id) } };
}

class LoreStore {
    constructor(db, { fileRoot } = {}) {
        this.db = db;
        this.files = fileRoot ? new LoreFiles(fileRoot) : null;
        db.exec('CREATE TABLE IF NOT EXISTS lore_generations (scope TEXT PRIMARY KEY,generation INTEGER NOT NULL)');
        db.exec('CREATE TABLE IF NOT EXISTS lore_libraries (scope TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(scope,id))');
    }
    generation(scope) {
        return this.db.prepare('SELECT generation FROM lore_generations WHERE scope=?').get(scope)?.generation || 0;
    }
    clear(scope) {
        // Serialize against imports, and retain invalidation even on partial filesystem failure.
        let failure;
        this.db.transaction(() => {
            this.db.prepare('INSERT INTO lore_generations(scope,generation) VALUES (?,1) ON CONFLICT(scope) DO UPDATE SET generation=generation+1').run(scope);
            try {
                this.files?.clearScope(scope);
                this.db.prepare('DELETE FROM lore_libraries WHERE scope=?').run(scope);
            } catch (error) { failure = error; }
        }).immediate();
        if (failure) throw failure;
    }
    read(scope, id) {
        const stored = this.files?.read(scope,id);
        if (stored) return {...stored,generation:this.generation(scope)};
        const row = this.db.prepare('SELECT revision,data_json FROM lore_libraries WHERE scope=? AND id=?').get(scope,id);
        const legacy = row ? { revision: row.revision, ...JSON.parse(row.data_json) } : { revision: 0, entries: [] };
        const result = row && this.files ? this.db.transaction(() => this.files.read(scope,id) || this.files.write(scope,id,legacy)).immediate() : legacy;
        return {...result,generation:this.generation(scope)};
    }
    save(scope, id, input, publicIds, expectedRevision, options = {}) {
        const normalized = importWorldInfo(input, publicIds, options);
        return this.db.transaction(() => {
            const generation = this.generation(scope);
            if ((options.expectedGeneration ?? 0) !== generation) throw Object.assign(new Error('Lore was cleared; preview again'), {status:409});
            const old = this.read(scope,id);
            if (old.revision !== expectedRevision) throw Object.assign(new Error('Lore library changed; preview again'), {status:409});
            const active = new Set(normalized.entries.map(e=>e.id));
            normalized.entries.push(...old.entries.filter(e=>!active.has(e.id)).map(e=>({...e,status:'deprecated'})));
            if (normalized.entries.length > 1000) fail('Library history exceeds 1000 entries; use a new library ID');
            const content = JSON.stringify(normalized);
            const unchanged = JSON.stringify({entries:old.entries,...(old.mappingProfile ? {mappingProfile:old.mappingProfile} : {}),report:old.report}) === content;
            const revision = old.revision + (unchanged ? 0 : 1);
            if (this.files) {
                this.files.write(scope,id,{revision,...normalized},input,options);
                return {revision,generation,report:normalized.report};
            }
            this.db.prepare('INSERT INTO lore_libraries(scope,id,revision,data_json) VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET revision=excluded.revision,data_json=excluded.data_json').run(scope,id,revision,content);
            return { revision, generation, report: normalized.report };
        }).immediate();
    }
    export(scope,id,kind) {
        this.read(scope,id);
        if (!this.files) throw Error('File lore storage is not configured');
        return this.files.export(scope,id,kind);
    }
    retrieve(scope,id,query,budget=450,context={}) {
        if (typeof query !== 'string' || query.length > 10000) fail('Invalid lore query');
        const library=this.read(scope,id), text=query.normalize('NFKC').toLowerCase();
        const matches=(e,key)=>(e.caseSensitive ? query.normalize('NFKC') : text).includes(e.caseSensitive ? key.normalize('NFKC') : key.normalize('NFKC').toLowerCase());
        // Tags are literal search metadata, never permissions or model instructions.
        const tagMatches = (entry, tag) => {
            const haystack = entry.caseSensitive ? query.normalize('NFKC') : text;
            const needle = entry.caseSensitive ? tag.normalize('NFKC') : tag.normalize('NFKC').toLowerCase();
            if (!needle) return false;
            let start = haystack.indexOf(needle);
            while (start !== -1) {
                const before = [...haystack.slice(0,start)].pop() || '';
                const after = [...haystack.slice(start+needle.length)][0] || '';
                if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
                start = haystack.indexOf(needle,start+1);
            }
            return false;
        };
        const candidates=library.entries.filter(e=>e.status==='active' && e.visibility==='public' && matchesGating(e.gating,context) &&
            (e.always || e.keys.some(key=>matches(e,key)) || keys(e.tags).some(tag=>tagMatches(e,tag))) && (!e.selective || !e.secondaryKeys.length || e.secondaryKeys.some(key=>matches(e,key))))
            .sort((a,b)=>b.priority-a.priority || (a.insertionOrder || 0)-(b.insertionOrder || 0) || a.id.localeCompare(b.id));
        let used=0, alwaysUsed=0;
        const entries=[], selection=[];
        for(const e of candidates) {
            if(entries.length===10) {
                selection.push({id:e.id,mode:'omitted',reason:'entry_limit'});
                continue;
            }
            const available=Math.max(0,Math.min(budget-used,e.always ? Math.floor(budget*0.25)-alwaysUsed : Infinity));
            let entry={id:e.id,title:e.title,body:e.body,...(e.baselines?.length ? {baselines:e.baselines} : {})};
            let cost=Math.ceil(JSON.stringify(entry).length/4), mode='full';
            if(cost>available && typeof e.summary==='string' && e.summary.trim()) {
                const short={...entry,body:e.summary.trim()};
                const shortCost=Math.ceil(JSON.stringify(short).length/4);
                if(shortCost<cost) {entry=short;cost=shortCost;mode='summary';}
            }
            if(cost>available) {
                selection.push({id:e.id,mode:'omitted',reason:e.always && Math.floor(budget*0.25)-alwaysUsed<budget-used ? 'always_budget' : 'budget'});
                continue;
            }
            entries.push(entry);used+=cost;if(e.always)alwaysUsed+=cost;
            selection.push({id:e.id,mode,estimatedTokens:cost});
        }
        return { revision: library.revision, entries, estimatedTokens: used, selection };

    }
}
module.exports={importWorldInfo,LoreStore};
