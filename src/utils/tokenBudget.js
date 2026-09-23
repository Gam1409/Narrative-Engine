import { clone } from './object.js';

export function estimateTokens(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return Math.ceil((text || '').length / 4);
}

function shorten(value, ratio) {
    if (typeof value === 'string') return value.slice(0, Math.max(0, Math.floor(value.length * ratio)));
    if (Array.isArray(value)) return value.slice(0, Math.max(0, Math.floor(value.length * ratio))).map((item) => shorten(item, ratio));
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, child] of Object.entries(value)) result[key] = shorten(child, ratio);
        return result;
    }
    return value;
}

/**
 * Compacts low-priority top-level sections first and never mutates the packet.
 * `required` fields survive whenever their own representation fits the budget.
 */
export function compactToBudget(packet, budget = 1500, options = {}) {
    const maxTokens = Math.max(1, Number(budget) || 1500);
    let result = clone(packet);
    if (estimateTokens(result) <= maxTokens) return result;
    const required = new Set(options.required || ['scene', 'must_preserve', 'user_agency']);
    const priority = options.dropOrder || ['diagnostics', 'sprite_candidates', 'relevant_memories', 'world_events', 'npc_plans', 'active_threads', 'character_states'];
    for (const key of priority) {
        if (estimateTokens(result) <= maxTokens) break;
        if (!required.has(key) && key in result) delete result[key];
    }
    if (estimateTokens(result) <= maxTokens) return result;
    for (const ratio of [0.75, 0.5, 0.25, 0.1]) {
        const candidate = shorten(result, ratio);
        if (estimateTokens(candidate) <= maxTokens) return candidate;
        result = candidate;
    }
    return shorten(result, Math.max(0.01, maxTokens / Math.max(estimateTokens(result), 1)));
}

export const trimToTokenBudget = compactToBudget;
