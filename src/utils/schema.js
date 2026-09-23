const typeOf = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;

export function validateSchema(schema, value) {
    const errors = [];
    visit(schema, value, '$', errors);
    return { valid: errors.length === 0, errors };
}

function visit(schema, value, path, errors) {
    if (!schema || schema === true) return;
    if (schema === false) { errors.push({ path, message: 'value is not allowed' }); return; }
    if (schema.anyOf && !schema.anyOf.some((item) => validateSchema(item, value).valid)) errors.push({ path, message: 'does not match anyOf' });
    if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) errors.push({ path, message: 'not in enum' });
    if (schema.const !== undefined && !Object.is(schema.const, value)) errors.push({ path, message: 'does not match const' });
    if (schema.type) {
        const actual = typeOf(value);
        const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
        const matches = allowed.includes(actual) || (actual === 'integer' && allowed.includes('number'));
        if (!matches) { errors.push({ path, message: `expected ${allowed.join('|')}, got ${actual}` }); return; }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const key of schema.required || []) if (!(key in value)) errors.push({ path: `${path}.${key}`, message: 'is required' });
        for (const [key, child] of Object.entries(value)) {
            if (schema.properties?.[key]) visit(schema.properties[key], child, `${path}.${key}`, errors);
            else if (schema.additionalProperties === false) errors.push({ path: `${path}.${key}`, message: 'additional property' });
            else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') visit(schema.additionalProperties, child, `${path}.${key}`, errors);
        }
    }
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: `requires at least ${schema.minItems} items` });
        if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, message: `allows at most ${schema.maxItems} items` });
        if (schema.items) value.forEach((child, index) => visit(schema.items, child, `${path}[${index}]`, errors));
    }
    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: 'string too short' });
        if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push({ path, message: 'pattern mismatch' });
    }
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `must be >= ${schema.minimum}` });
        if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `must be <= ${schema.maximum}` });
    }
}

export function assertSchema(schema, value, label = 'JSON') {
    const result = validateSchema(schema, value);
    if (!result.valid) {
        const error = new Error(`${label} schema validation failed: ${result.errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
        error.validationErrors = result.errors;
        throw error;
    }
    return value;
}

export const validateJsonSchema = validateSchema;
export const assertJsonSchema = assertSchema;
