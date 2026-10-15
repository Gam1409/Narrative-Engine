/** Compare author-provided baselines only against the audience-projected public state. */
export function loreStateOverrides(entry, state) {
    if (!Array.isArray(entry.baselines) || entry.baselines.length > 20) return [];
    const overrides = [];
    for (const baseline of entry.baselines) {
        if (!baseline || typeof baseline.entityId !== 'string' || typeof baseline.parameter !== 'string') continue;
        const entities = state?.entities || {};
        if (!Object.hasOwn(entities, baseline.entityId)) continue;
        const params = entities[baseline.entityId]?.params || {};
        if (!Object.hasOwn(params, baseline.parameter)) continue;
        const current = params[baseline.parameter];
        const scalar = value => ['string','number','boolean'].includes(typeof value)
            && (typeof value !== 'number' || Number.isFinite(value))
            && (typeof value !== 'string' || value.length <= 1000);
        if (!scalar(baseline.value) || !scalar(current) || current === baseline.value) continue;
        overrides.push({ code:'lore_state_divergence', entityId:baseline.entityId, parameter:baseline.parameter,
            baseline:baseline.value, current, resolution:'current_state_wins' });
    }
    return overrides;
}
