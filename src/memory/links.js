import { resolveEvidence } from '../state/evidence.js';

export const MEMORY_RELATIONS = ['caused_by', 'causes', 'supports', 'contradicts'];

/** A claim may reference only a source explicitly supplied to this POST. */
export function validatedMemoryLinks(candidate, sources, texts) {
    const allowed = new Map(sources.map(source => [source.id, source]));
    const seen = new Set();
    const result = [];
    for (const link of (Array.isArray(candidate.links) ? candidate.links : []).slice(0, 8)) {
        const target = allowed.get(link?.targetId);
        const audience = candidate.visibleTo || [];
        if (!target || !MEMORY_RELATIONS.includes(link.relation) || !audience.length
            || (target.unknown_to || []).length || !Array.isArray(target.visibleTo)
            || !(target.visibleTo.includes('*') || audience.every(id => target.visibleTo.includes(id)))) continue;
        try {
            const evidence = resolveEvidence(link.evidence, texts);
            if (evidence.source !== 'rp') continue;
            const key = `${link.relation}:${link.targetId}`;
            if (seen.has(key)) continue;
            result.push({ relation: link.relation, targetId: link.targetId, evidence });
            seen.add(key);
        } catch { /* Invalid relationship does not discard the episode itself. */ }
    }
    return result;
}

/** References must not disclose excluded records, including through summary metadata. */
export function projectMemoryReferences(memories) {
    const ids = new Set(memories.map(memory => memory.id));
    return memories.map(memory => {
        const projected = { ...memory };
        if (memory.links) projected.links = memory.links.filter(link => ids.has(link.targetId) && MEMORY_RELATIONS.includes(link.relation));
        if (memory.sourceMemoryIds) projected.sourceMemoryIds = memory.sourceMemoryIds.filter(id => ids.has(id));
        if (memory.sourceAssertions) projected.sourceAssertions = memory.sourceAssertions.filter(source => ids.has(source.id));
        return projected;
    });
}

export function memoryAdjacency(memories) {
    const graph = new Map(memories.filter(memory => typeof memory.id === 'string').map(memory => [memory.id, []]));
    const connect = (from, to, relation) => {
        if (from === to || !graph.has(from) || !graph.has(to)) return;
        graph.get(from).push({ id: to, relation, direction: 'outgoing' });
        graph.get(to).push({ id: from, relation, direction: 'incoming' });
    };
    for (const memory of memories) {
        for (const link of memory.links || []) connect(memory.id, link.targetId, link.relation);
        for (const id of memory.sourceMemoryIds || []) connect(memory.id, id, 'summarizes');
    }
    return graph;
}
