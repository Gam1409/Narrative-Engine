'use strict';

// Storage contract v2: small mutable head plus immutable journal rows.
const STORAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS storage_fields (chat_id TEXT NOT NULL, field TEXT NOT NULL, value_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(chat_id,field));
CREATE TABLE IF NOT EXISTS turn_records (chat_id TEXT NOT NULL, id TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(chat_id,id));
CREATE TABLE IF NOT EXISTS turn_decisions (chat_id TEXT NOT NULL, id TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(chat_id,id));
CREATE TABLE IF NOT EXISTS turn_memories (chat_id TEXT NOT NULL, id TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(chat_id,id));
CREATE TABLE IF NOT EXISTS turn_checkpoints (chat_id TEXT NOT NULL, message_index INTEGER NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(chat_id,message_index));
`;

function immutableRows(db, table, chatId, items, idKey) {
    const insert = db.prepare(`INSERT OR IGNORE INTO ${table}(chat_id,id,data_json) VALUES (?,?,?)`);
    const read = db.prepare(`SELECT data_json FROM ${table} WHERE chat_id=? AND id=?`);
    for (const item of items) {
        const id = item[idKey];
        if (typeof id !== 'string' || !id) throw Object.assign(new Error('Missing immutable record ID'), { status: 400 });
        const text = JSON.stringify(item);
        const existing = read.get(chatId, id);
        if (existing && existing.data_json !== text) throw Object.assign(new Error('Immutable record conflict'), { status: 409 });
        insert.run(chatId, id, text);
    }
}

function installStorage(Database) {
    Database.prototype.readField = function(chatId, field) {
        const row = this.db.prepare('SELECT value_json,revision FROM storage_fields WHERE chat_id=? AND field=?').get(chatId, field);
        if (!row) {
            const legacy = this.getState(chatId);
            const value = legacy?.__narrativeEngineStore === 1 ? legacy.values?.[field] ?? null : null;
            return { value, revision: 0 };
        }
        let value = JSON.parse(row.value_json);
        if (field === 'bundle' && value?.__rows === 2) {
            const records = this.db.prepare('SELECT data_json FROM turn_records WHERE chat_id=? ORDER BY rowid').all(chatId).map(r => JSON.parse(r.data_json));
            const decisions = this.db.prepare('SELECT data_json FROM turn_decisions WHERE chat_id=? ORDER BY rowid').all(chatId).map(r => JSON.parse(r.data_json));
            const checkpoints = this.db.prepare('SELECT data_json FROM turn_checkpoints WHERE chat_id=? ORDER BY message_index').all(chatId).map(r => JSON.parse(r.data_json));
            const byId = new Map(records.map(r => [r.deltaId, r]));
            const deltas = value.activeIds.map(id => byId.get(id)).filter(Boolean);
            const memoryRows = this.db.prepare('SELECT id,data_json FROM turn_memories WHERE chat_id=?').all(chatId);
            const memoriesById = new Map(memoryRows.map(r => [r.id, JSON.parse(r.data_json)]));
            const memories = (value.memoryIds || []).map(id => memoriesById.has(id) ? { ...memoriesById.get(id), ...(value.memoryStatuses?.[id] || {}) } : null).filter(Boolean);
            value = { ...value, records, decisions, checkpoints, memories, deltas: [...(value.baseDeltas || []), ...deltas] };
            delete value.memoryStatuses; delete value.__rows; delete value.activeIds; delete value.baseDeltas; delete value.memoryIds;
        }
        return { value, revision: row.revision };
    };
    Database.prototype.writeField = function(chatId, field, input, expectedRevision) {
        return this.db.transaction(() => {
            const current = this.db.prepare('SELECT revision FROM storage_fields WHERE chat_id=? AND field=?').get(chatId, field)?.revision || 0;
            if (expectedRevision !== current) throw Object.assign(new Error('Storage revision conflict; reload before writing'), { status: 409 });
            let value = structuredClone(input);
            if (value?.__incremental === 2) {
                const previous = this.readField(chatId, field).value || {};
                const records = [...(previous.records || []), ...(value.records || [])];
                const byId = new Map(records.map(r => [r.deltaId, r]));
                value.deltas = [...(value.baseDeltas || []), ...(value.activeIds || []).map(id => {
                    if (!byId.has(id)) throw Object.assign(new Error('Unknown active delta'), { status: 400 });
                    return byId.get(id);
                })];
                value.decisions = [...(previous.decisions || []), ...(value.decisions || [])];
                value.records = records;
                value.memories = [...((value.checkpoints || []).find(p => p.messageIndex === -1)?.memories || []), ...value.deltas.flatMap(r => (r.memories || []).map((m, i) => ({ ...m,
                    id: `${r.deltaId}:memory:${i}`, sourceDeltaId: r.deltaId, messageRef: r.messageRef, status: m.status || 'current', createdAt: r.at, memoryId: `${r.deltaId}:memory:${i}`, campaignId: m.campaignId || r.campaignId || r.chatFingerprint, sessionId: m.sessionId || r.sessionId })))];
                const byMemoryId = new Map(), facts = new Map();
                for (const m of value.memories) {
                    if (m.status !== 'current') { byMemoryId.set(m.id, m); continue; }
                    const key = m.factKey ? `${m.campaignId}:${m.factKey}` : null;
                    for (const old of [...(m.supersedes || []).map(id => byMemoryId.get(id)), key ? facts.get(key) : null].filter(Boolean)) {
                        if (old.campaignId === m.campaignId) { old.status = 'superseded'; old.supersededBy = m.id; }
                    }
                    byMemoryId.set(m.id, m); if (key) facts.set(key, m);
                }
                delete value.__incremental; delete value.activeIds; delete value.baseDeltas;
            }
            if (field === 'bundle' && value?.historyVersion === 2) {
                immutableRows(this.db, 'turn_records', chatId, value.records || [], 'deltaId');
                immutableRows(this.db, 'turn_decisions', chatId, value.decisions || [], 'decisionId');
                value.memoryStatuses = Object.fromEntries((value.memories || []).map(m => [m.id, { status: m.status, ...(m.memoryId !== undefined ? { memoryId: m.memoryId } : {}), ...(m.campaignId !== undefined ? { campaignId: m.campaignId } : {}), ...(m.sessionId !== undefined ? { sessionId: m.sessionId } : {}), ...(m.supersededBy !== undefined ? { supersededBy: m.supersededBy } : {}) }]));
                const memoryRows = (value.memories || []).map(m => {
                    const original = this.db.prepare('SELECT data_json FROM turn_memories WHERE chat_id=? AND id=?').get(chatId, m.id);
                    if (!original) return m;
                    const saved = JSON.parse(original.data_json);
                    const comparable = { ...m, status: saved.status };
                    if (saved.supersededBy === undefined) delete comparable.supersededBy; else comparable.supersededBy = saved.supersededBy;
                    for (const key of ['memoryId', 'campaignId', 'sessionId']) if (!Object.hasOwn(saved, key)) delete comparable[key];
                    return comparable;
                });
                immutableRows(this.db, 'turn_memories', chatId, memoryRows, 'id');
                value.memoryIds = (value.memories || []).map(m => m.id);
                delete value.memories;
                const checkpoints = (value.checkpoints || []).filter(p => p.messageIndex < 0).concat((value.checkpoints || []).filter(p => p.messageIndex >= 0).slice(-20));
                this.db.prepare('DELETE FROM turn_checkpoints WHERE chat_id=?').run(chatId);
                const insert = this.db.prepare('INSERT INTO turn_checkpoints(chat_id,message_index,data_json) VALUES (?,?,?)');
                for (const point of checkpoints) insert.run(chatId, point.messageIndex, JSON.stringify(point));
                value.activeIds = (value.deltas || []).filter(d => (value.records || []).some(r => r.deltaId === d.deltaId)).map(d => d.deltaId);
                value.baseDeltas = (value.deltas || []).filter(d => !(value.records || []).some(r => r.deltaId === d.deltaId));
                delete value.records; delete value.decisions; delete value.checkpoints; delete value.deltas;
                value.__rows = 2;
            }
            this.ensureChat(chatId);
            this.db.prepare('INSERT INTO storage_fields(chat_id,field,value_json,revision) VALUES (?,?,?,?) ON CONFLICT(chat_id,field) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision')
                .run(chatId, field, JSON.stringify(value), current + 1);
            return { revision: current + 1 };
        })();
    };
    Database.prototype.listFields = function(chatId) {
        const fields = this.db.prepare('SELECT field FROM storage_fields WHERE chat_id=?').all(chatId).map(r => r.field);
        const old = this.getState(chatId);
        return [...new Set([...fields, ...Object.keys(old?.__narrativeEngineStore === 1 ? old.values || {} : {})])];
    };
}
module.exports = { STORAGE_SCHEMA, installStorage };
