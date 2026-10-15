import { eligibleMemory } from './policy.js';

const audienceKey = memory => JSON.stringify([...(memory.visibleTo || [])].sort());

// The active branch is the buffer. Only accepted summaries acknowledge sources.
export function consolidationBatch(memories, { scope, viewers, maxItems = 16, tokenBudget = 3000, maxChars = Math.floor(tokenBudget * 4) }) {
    const policy = { ...scope, viewers, mode: 'session_only' };
    const eligible = memories.filter(m => Array.isArray(m.visibleTo) && !(m.unknown_to || []).length && eligibleMemory(m, policy));
    const processed = new Set(eligible.filter(m => m.type === 'summary').flatMap(m => m.sourceMemoryIds || []));
    const groups = new Map();
    for (const memory of eligible) {
        if (memory.type !== 'event' || !memory.id || processed.has(memory.id)) continue;
        const key = audienceKey(memory);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(memory);
    }
    for (const group of groups.values()) {
        const batch = [];
        let used = 2; // JSON array brackets; token estimate is characters / 4.
        for (const m of group) {
            const item = { id: m.id, text: m.text || m.summary, scene: m.scene, gameTime: m.gameTime,
                provenance: m.provenance, entities: m.entities || [], visibleTo: m.visibleTo, campaignId: m.campaignId, sessionId: m.sessionId };
            const size = JSON.stringify(item).length + (batch.length ? 1 : 0);
            if (used + size > maxChars) continue;
            batch.push(item); used += size;
            if (batch.length >= maxItems) break;
        }
        if (batch.length >= 2) return batch;
    }
    return [];
}

// Invalid summaries do not invalidate unrelated, supported current-turn extraction.
export function validateConsolidationCandidate(candidate, batch) {
    if (!Object.hasOwn(candidate, 'sourceMemoryIds')) return candidate;
    if (candidate.type !== 'summary' || !Array.isArray(candidate.sourceMemoryIds)) return null;
    const ids = [...new Set(candidate.sourceMemoryIds)];
    if (ids.length < 2 || ids.some(id => typeof id !== 'string')) return null;
    const sources = ids.map(id => batch.find(m => m.id === id));
    if (sources.some(m => !m) || sources.some(m => audienceKey(m) !== audienceKey(sources[0]))) return null;
    const text = String(candidate.text || candidate.summary || '').trim();
    if (!text || text.length > 4000) return null;
    return { text, type: 'summary', sourceMemoryIds: ids,
        sourceAssertions: sources.map(m => ({ id: m.id, ...(m.provenance ? { provenance: structuredClone(m.provenance) } : {}) })), visibleTo: [...sources[0].visibleTo],
        entities: [...new Set(sources.flatMap(m => m.entities || []))], status: 'current',
        importance: candidate.importance, scene: sources.every(m => m.scene === sources[0].scene) ? sources[0].scene : '',
        gameTime: null };
}


export function memorySceneKey(state) {
    return JSON.stringify([state.scene?.location || null, [...(state.scene?.present || [])].sort()]);
}

// A transition accepted on the previous turn triggers the next POST. No extra LLM call.
export function hasPendingSceneTransition(records, state) {
    const last = records.findLast(record => record.source !== 'author' && record.messageIndex >= 0);
    return typeof last?.memorySceneKey === 'string' && last.memorySceneKey !== memorySceneKey(state);
}
