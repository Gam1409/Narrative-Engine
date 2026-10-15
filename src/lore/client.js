import { loreStateOverrides } from './continuity.js';
export async function loreRequest(context, path, body, signal) {
    const response = await fetch(`/api/plugins/narrative-engine/lore/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(context.getRequestHeaders?.() || {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Lore server HTTP ${response.status}`);
    return response.json();
}


/** Keep imported delimiters inside quoted reference data, never service markup. */
export function loreReferenceEntries(entries, publicState) {
    if (!Array.isArray(entries) || entries.length > 10) throw Error('Invalid lore response');
    const escape = text => text.replace(/[<>\[\]]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
    return entries.map(e => {
        if (typeof e?.id !== 'string' || typeof e.title !== 'string' || typeof e.body !== 'string' || e.body.length > 20000) throw Error('Invalid lore entry');
        const overrides = loreStateOverrides(e, publicState).map(item => Object.fromEntries(
            Object.entries(item).map(([key,value]) => [key, typeof value === 'string' ? escape(value) : value])));
        return { id: e.id, title: escape(e.title), body: escape(e.body),
            ...(overrides.length ? { stateOverrides: overrides } : {}) };
    });
}
