/** JSON-safe clone used at persistence and transaction boundaries. */
export function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Merge plain objects without ever mutating either operand. Arrays replace. */
export function mergeImmutable(base, patch) {
    if (!isPlainObject(patch)) return clone(patch);
    const result = isPlainObject(base) ? clone(base) : {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (isPlainObject(value) && value.$delete === true) {
            delete result[key];
        } else if (isPlainObject(value)) {
            result[key] = mergeImmutable(result[key], value);
        } else {
            result[key] = clone(value);
        }
    }
    return result;
}

export function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}
