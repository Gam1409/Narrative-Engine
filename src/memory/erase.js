/** Remove episodic memory copies, not world state, events or relationships. */
export function eraseMemoryCopies(value, field = '') {
    if (field === 'memories' || field === 'legacyMemories' || field === 'memoryIds') return [];
    if (field === 'memoryStatuses') return {};
    if (Array.isArray(value)) return value.map(item => eraseMemoryCopies(item));
    if (!value || typeof value !== 'object') return value;
    const result = structuredClone(value);
    for (const key of ['memories','legacyMemories','memoryIds','memoryStatuses','records','deltas','baseDeltas','checkpoints']) {
        if (Object.hasOwn(result,key)) result[key] = eraseMemoryCopies(result[key],key);
    }
    if (result.__narrativeEngineStore === 1 && result.values) {
        for (const key of Object.keys(result.values)) result.values[key] = eraseMemoryCopies(result.values[key],key);
    }
    return result;
}
