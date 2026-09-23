import { assertSchema, validateSchema } from './schema.js';

export function extractJson(text) {
    const source = String(text ?? '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try { return JSON.parse(source); } catch { /* extract below */ }
    for (let start = 0; start < source.length; start += 1) {
        if (source[start] !== '{' && source[start] !== '[') continue;
        const open = source[start];
        const close = open === '{' ? '}' : ']';
        let depth = 0, quoted = false, escaped = false;
        for (let index = start; index < source.length; index += 1) {
            const char = source[index];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
            } else if (char === '"') quoted = true;
            else if (char === open) depth += 1;
            else if (char === close && --depth === 0) return JSON.parse(source.slice(start, index + 1));
        }
    }
    throw new SyntaxError('No valid JSON object or array found');
}

export function repairJsonLocally(text) {
    return String(text ?? '')
        .replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
        .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
        .replace(/,\s*([}\]])/g, '$1').trim();
}

/** Extract, validate, make at most one repair callback, then fail closed. */
export async function parseAndValidateJson(text, schema, repair) {
    let firstError;
    try {
        const value = extractJson(text);
        return assertSchema(schema, value, 'Director output');
    } catch (error) { firstError = error; }
    try {
        const local = extractJson(repairJsonLocally(text));
        return assertSchema(schema, local, 'Locally repaired Director output');
    } catch { /* one external retry below */ }
    if (typeof repair === 'function') {
        const repaired = await repair({ invalidOutput: text, error: firstError.message, schema });
        const value = extractJson(repaired);
        return assertSchema(schema, value, 'Repaired Director output');
    }
    throw firstError;
}

export const parseJsonWithRepair = parseAndValidateJson;
