'use strict';
const fail = message => { throw Object.assign(new Error(message), {status:400}); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const privateModes = new Set(['secret', 'self', 'restricted']);
function pathParts(path, wildcard = false) {
    if (typeof path !== 'string' || path.length > 300) fail('Invalid mapping path');
    const base = wildcard && path.endsWith('[*]') ? path.slice(0, -3) : path;
    if (!/^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(base)) fail('Only $.field paths and a terminal entries [*] are supported');
    const parts = base.slice(2).split('.').filter(Boolean);
    if (parts.length > 16 || parts.some(p => ['__proto__', 'prototype', 'constructor'].includes(p))) fail('Unsafe mapping path');
    return parts;
}
function read(value, parts) {
    for (const part of parts) {
        if (!object(value) || !Object.hasOwn(value, part)) return undefined;
        value = value[part];
    }
    return value;
}
function validateRule(rule, defaults = false) {
    if (!object(rule) || Object.keys(rule).some(k => !['type', 'visibility', ...(defaults ? [] : ['visibleTo'])].includes(k))) fail('Invalid tag mapping rule');
    if (rule.type !== undefined && (typeof rule.type !== 'string' || rule.type.length > 100)) fail('Invalid mapped type');
    if (rule.visibility !== undefined && !['public', 'hidden', ...privateModes].includes(rule.visibility)) fail('Invalid mapped visibility');
    if (rule.visibleTo !== undefined && (typeof rule.visibleTo !== 'string' || rule.visibleTo.length > 100)) fail('Invalid visibleTo rule');
}
function mapLore(input, profile) {
    if (!object(profile) || JSON.stringify(profile).length > 20000) fail('Invalid mapping profile');
    if (Object.keys(profile).some(k => !['profile','format','entriesPath','fields','tagMap','defaults'].includes(k))) fail('Unknown mapping profile option');
    if (profile.format !== undefined && profile.format !== 'json') fail('Mapping supports JSON only');
    if (profile.profile !== undefined && (typeof profile.profile !== 'string' || profile.profile.length > 100)) fail('Invalid profile name');
    if (!object(profile.fields) || !profile.fields.body) fail('Mapping requires fields.body');
    const fields = Object.entries(profile.fields).map(([key, value]) => {
        if (!['id','title','body','summary','keys','tags','priority'].includes(key)) fail('Unknown mapped field: ' + key);
        return [key, pathParts(value)];
    });
    const defaults = profile.defaults ?? {};
    validateRule(defaults, true);
    const tagMap = profile.tagMap ?? {};
    if (!object(tagMap) || Object.keys(tagMap).length > 100) fail('Invalid tagMap');
    const rules = Object.entries(tagMap).map(([tag, rule]) => {
        if (!tag || tag.length > 100 || tag.slice(0,-1).includes('*')) fail('Only trailing tag wildcards are supported');
        validateRule(rule);
        return [tag, rule];
    });
    const rows = read(input, pathParts(profile.entriesPath, true));
    if (!Array.isArray(rows) || rows.length > 500) fail('entriesPath must select an array of at most 500 entries');
    const unknown = new Set();
    const entries = rows.map((row, index) => {
        if (!object(row)) fail('Mapped entry must be an object');
        const values = Object.fromEntries(fields.map(([key, path]) => [key, read(row, path)]));
        if (typeof values.body !== 'string') fail('Mapped body is missing or not text');
        for (const key of ['title','summary']) if (values[key] !== undefined && typeof values[key] !== 'string') fail('Mapped ' + key + ' must be text');
        for (const key of ['keys','tags']) if (values[key] !== undefined && !(typeof values[key] === 'string' || Array.isArray(values[key]) && values[key].every(v => typeof v === 'string'))) fail('Mapped ' + key + ' must be text or a text array');
        if (values.priority !== undefined && (typeof values.priority !== 'number' || !Number.isFinite(values.priority))) fail('Mapped priority must be a number');
        if (values.id !== undefined && !['string','number'].includes(typeof values.id)) fail('Mapped ID must be text or a number');
        const tags = typeof values.tags === 'string' ? values.tags.split(',').map(s => s.trim()).filter(Boolean) : values.tags || [];
        if (tags.length > 100 || tags.some(t => t.length > 200)) fail('Too many or oversized tags');
        let visibility = defaults.visibility || 'hidden', type = defaults.type || 'other';
        let locked = privateModes.has(visibility);
        const visibleTo = [];
        for (const tag of tags) {
            const matches = rules.filter(([pattern]) => pattern.endsWith('*') ? tag.startsWith(pattern.slice(0,-1)) : tag === pattern);
            if (!matches.length) { unknown.add(tag); }
            for (const [pattern, rule] of matches) {
                type = rule.type ?? type;
                visibility = rule.visibility ?? visibility;
                locked ||= privateModes.has(visibility);
                if (rule.visibleTo) visibleTo.push(rule.visibleTo.replace('$1', pattern.endsWith('*') ? tag.slice(pattern.length-1) : ''));
            }
        }
        return {uid:values.id ?? index,comment:values.title,content:values.body,summary:values.summary,
            key:values.keys,tags,loreType:type,order:values.priority,
            extensions:{narrative_engine:{visibility:locked ? 'restricted' : visibility,visibleTo}}};
    });
    return {adapter:'mapped_json',entries,mappingProfile:profile,
        warnings:[...unknown].sort().map(tag => 'Search tag (no mapping rule): ' + tag)};
}
module.exports = {mapLore};
