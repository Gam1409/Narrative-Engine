import { clone } from '../utils/object.js';

export function visibleTo(record, viewers = []) {
    const allowed = record?.visibleTo ?? record?.known_by ?? record?.knownBy;
    if (!Array.isArray(allowed)) return false;
    if ((record.unknown_to || []).some(id => viewers.includes(id))) return false;
    return allowed.includes('*') || (viewers.length > 0 && viewers.every(id => allowed.includes(id)));
}
/** Reconstruct the latest knowledge available to the audience without revealing unseen corrections. */
export function audienceMemories(memories, policy = {}) {
    const byId = new Map(memories.map(m => [m.id || m.memoryId, m]));
    const inScope = m => eligibleMemory({...m,status:'current',visibleTo:['*'],unknown_to:[]}, {...policy,history:false});
    const known = m => inScope(m) && visibleTo(m, policy.viewers);
    return memories.map(memory => {
        const result = clone(memory);
        if (result.status === 'superseded' && !policy.history && known(result)) {
            const visited = new Set();
            let successor = byId.get(result.supersededBy), learned = false;
            while (successor && !visited.has(successor.id)) {
                visited.add(successor.id);
                if (inScope(successor) && successor.status !== 'disputed' &&
                    (visibleTo(successor,[]) || (policy.viewers || []).some(viewer => visibleTo(successor,[viewer])))) {
                    learned = true;
                    break;
                }
                successor = byId.get(successor.supersededBy);
            }
            if (!learned && visited.size) {
                // Current belief for this audience, never proof of current objective state.
                result.status = 'current';
                result.type = 'belief';
                result.epistemicStatus = 'last_known';
                result.referenceRule = 'Character recollection only; not verified present-world truth. Do not infer later events from this record.';
            }
        }
        if (result.supersededBy && !known(byId.get(result.supersededBy) || {})) delete result.supersededBy;
        if (result.supersedes) result.supersedes = result.supersedes.filter(id => known(byId.get(id) || {}));
        return result;
    });
}
export function eligibleMemory(memory, policy = {}) {
    if (!visibleTo(memory, policy.viewers)) return false;
    if (!['current', ...(policy.history ? ['superseded'] : [])].includes(memory.status || 'current')) return false;
    if (policy.campaignId && memory.campaignId !== policy.campaignId) return false;
    if (policy.mode === 'session_only' && memory.sessionId !== policy.sessionId) return false;
    if (policy.mode === 'selective' && memory.sessionId !== policy.sessionId && !selected(memory, policy)) return false;
    if (policy.from && (!memory.gameTime || memory.gameTime < policy.from)) return false;
    if (policy.through && memory.gameTime && memory.gameTime > policy.through) return false;
    return true;
}
export function selected(memory, policy) {
    return (policy.memoryIds || []).includes(memory.id || memory.memoryId)
        || (policy.types || []).includes(memory.type)
        || (memory.entities || memory.characters || []).some(id => (policy.entities || []).includes(id));
}
export function projectState(state, viewers) {
    const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, clone(value[k])]));
    const filtered = value => Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v && v.status !== 'superseded' && v.status !== 'disputed' && visibleTo(v, viewers)).map(([k, v]) => [k, clone(v)]));
    const publicParameters = e => Object.fromEntries(Object.entries(e.params || {})
        .filter(([key]) => state.registry?.parameters?.[key]?.visibility === 'public')
        .map(([key,value]) => [key,clone(value)]));
    const known = new Set([...viewers, state.scene?.location].filter(Boolean));
    for (const e of Object.values(state.entities || {})) if (visibleTo(e, viewers)) known.add(e.id);
    let changed = true;
    while (changed) {
        changed = false;
        for (const e of Object.values(state.entities || {})) if (!known.has(e.id) && e.position && ['holds','wears','on','in'].includes(e.position.rel) && known.has(e.position.target)) { known.add(e.id); changed = true; }
    }
    return {
        schemaVersion: state.schemaVersion, revision: state.revision,
        scene: pick(state.scene, ['location', 'present', 'weather', 'lighting']),
        timeline: pick(state.timeline, ['date', 'time', 'elapsedMinutes']),
        entities: Object.fromEntries(Object.entries(state.entities || {}).filter(([id, e]) => e.status === 'active' && known.has(id)).map(([id, e]) => [id, { ...pick(e, ['id', 'type', 'name', 'owner', 'position', 'holder', 'location', 'container']), params: publicParameters(e) }])),
        characters: Object.fromEntries(Object.entries(state.characters || {}).filter(([id]) => viewers.includes(id)).map(([id, c]) => [id, pick(c, ['position', 'location', 'clothing', 'held_items', 'expression'])])),
        // Unannotated legacy free-form values may contain secrets: do not forward them.
        objects: filtered(state.objects), locations: filtered(state.locations),
        knowledge: filtered(state.knowledge), relationships: filtered(state.relationships),
        threads: filtered(state.threads), world_events: filtered(state.world_events),
    };
}
export function sceneViewers(state, participants = [], includeRecipients = true) {
    const present = Array.isArray(state.scene?.present) && state.scene.present.length ? state.scene.present : participants.map(p => p.name);
    const audience = includeRecipients ? [...present, ...participants.map(p => p.name)] : present;
    return [...new Set(audience.map(value => {
        const name = typeof value === 'string' ? value : value?.id || value?.name;
        const entity = Object.values(state.entities || {}).find(e => e.type === 'character' && [e.id, e.name, ...(e.aliases || [])].includes(name));
        return entity?.id || name;
    }).filter(value => typeof value === 'string' && value))];
}
export function normalizeMemory(input, metadata = {}) {
    const text = String(input?.text || input?.summary || '').trim();
    if (!text || text.length > 20000) throw new Error('Memory text must contain 1..20000 characters');
    const strings = value => Array.isArray(value) ? [...new Set(value.filter(v => typeof v === 'string'))] : [];
    return { summary: text, text, type: ['event','fact','belief','relation','thread','summary'].includes(input.type) ? input.type : 'event',
        entities: strings(input.entities || input.characters), characters: strings(input.characters || input.entities), topics: strings(input.topics),
        visibleTo: strings(input.visibleTo), scene: typeof input.scene === 'string' ? input.scene : '',
        importance: Math.max(0, Math.min(1, Number.isFinite(input.importance) ? input.importance : 0.5)),
        status: ['current','superseded','disputed'].includes(input.status) ? input.status : 'current',
        supersedes: strings(input.supersedes), supersededBy: null,
        ...(input.provenance ? { provenance: clone(input.provenance) } : {}),
        gameTime: typeof input.gameTime === 'string' ? input.gameTime : metadata.gameTime || null,
        campaignId: metadata.campaignId, sessionId: metadata.sessionId,
        ...(typeof input.factKey === 'string' ? { factKey: input.factKey } : {}),
    };
}
