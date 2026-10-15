const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function gameTimestamp(value) {
    if (typeof value !== 'string') return null;
    value = value.replace(/Z$/, '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
    const stamp = Date.parse(`${value}Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, value.length) === value ? stamp : null;
}

/** Evidence events, not retrieval count. Caller supplies the audience-filtered active branch. */
export function supportingEpisodes(memories) {
    const support = new Map();
    for (const memory of memories) {
        if (memory.type !== 'event' || (memory.status || 'current') !== 'current'
            || (memory.provenance && memory.provenance.kind !== 'observed')) continue;
        for (const link of memory.links || []) {
            if (link.relation !== 'supports' || link.targetId === memory.id || !(memory.sourceDeltaId || memory.id)) continue;
            if (!support.has(link.targetId)) support.set(link.targetId, new Set());
            support.get(link.targetId).add(memory.sourceDeltaId || memory.id);
        }
    }
    return support;
}

/** A bounded retrieval heuristic. Never writes memory, confidence, or truth status. */
export function memoryAvailability(memory, { gameTime, halfLifeDays = 30, cue = 0, supportCount = 0 } = {}) {
    const current = gameTimestamp(gameTime), recorded = gameTimestamp(memory.gameTime);
    const ageDays = current === null || recorded === null ? null : Math.max(0, (current - recorded) / 86400000);
    const halfLife = Math.max(1, Math.min(3650, Number(halfLifeDays) || 30));
    const importance = clamp(memory.importance ?? 0.5);
    const floor = 0.25 + 0.5 * importance;
    const baseline = ageDays === null ? 1 : floor + (1 - floor) * 2 ** (-ageDays / halfLife);
    const reinforcement = Math.min(3, Math.max(0, supportCount)) * 0.05;
    const cueStrength = clamp(cue);
    const accessible = Math.min(1, baseline + reinforcement);
    return { factor: accessible + (1 - accessible) * cueStrength,
        baseline, cueStrength, supportCount: Math.min(3, Math.max(0, supportCount)), ageDays };
}
