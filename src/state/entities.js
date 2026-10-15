import { clone } from '../utils/object.js';

const own = (object, key) => Object.hasOwn(object, key);
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalized = value => String(value).normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const TYPES = ['character', 'item', 'clothing', 'accessory', 'location', 'container', 'plotObject', 'event'];
const PARAM_TYPES = ['string', 'number', 'boolean', 'enum', 'date', 'gameTime', 'entityRef', 'object', 'list'];
const PHYSICAL = ['on', 'in', 'inside', 'holds', 'wears'];
const ADMIN = ['define_type', 'define_parameter', 'update_parameter', 'rename_parameter', 'archive_parameter', 'delete_parameter'];

export function assertSafeData(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('Non-finite number');
    if (Array.isArray(value)) { value.forEach(assertSafeData); return; }
    if (!object(value)) return;
    for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`Unsafe key: ${key}`);
        assertSafeData(child);
    }
}
function id(value) {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || ['__proto__', 'prototype', 'constructor'].includes(value)) fail('Invalid identifier');
    return value;
}
function exact(value, keys) {
    if (!object(value)) fail('Expected an object');
    for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`Unsupported field: ${key}`);
}
export function createRegistry() {
    return { schemaVersion: 1, entityTypes: Object.fromEntries(TYPES.map(key => [key, { key, label: key, status: 'active' }])), parameters: {} };
}
function entity(state, key, active = true) {
    const result = own(state.entities, key) && state.entities[key];
    if (!result || (active && result.status !== 'active')) fail(`Unknown or archived entity: ${key}`);
    return result;
}
function definition(state, key, active = true) {
    const result = Object.values(state.registry.parameters).find(p => p.key === key || p.aliases.includes(key));
    if (!result || (active && result.status !== 'active')) fail(`Unknown or archived parameter: ${key}`);
    return result;
}
function validValue(state, def, value) {
    const rules = def.validation || {};
    if (value === undefined) fail(`${def.key}: value is required`);
    if (value === null && !rules.required) return;
    switch (def.type) {
        case 'string': if (typeof value !== 'string') fail(`${def.key}: expected string`); break;
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value) || (rules.min !== undefined && value < rules.min) || (rules.max !== undefined && value > rules.max)) fail(`${def.key}: number outside range`);
            break;
        case 'boolean': if (typeof value !== 'boolean') fail(`${def.key}: expected boolean`); break;
        case 'enum': if (!def.values.includes(value)) fail(`${def.key}: invalid enum`); break;
        case 'date': {
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`${def.key}: invalid date`);
            break;
        }
        case 'gameTime': if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(`${def.key}: expected HH:mm`); break;
        case 'entityRef': if (typeof value !== 'string') fail(`${def.key}: expected entity ID`); entity(state, value, false); break;
        case 'object':
            if (!object(value)) fail(`${def.key}: expected object`);
            if (def.fields) {
                exact(value, Object.keys(def.fields));
                for (const [key, child] of Object.entries(def.fields)) {
                    if (own(value, key)) validValue(state, { ...child, key: `${def.key}.${key}` }, value[key]);
                    else if (child.validation?.required) fail(`${def.key}.${key}: required`);
                }
            }
            break;
        case 'list':
            if (!Array.isArray(value)) fail(`${def.key}: expected list`);
            if (rules.maxItems !== undefined && value.length > rules.maxItems) fail(`${def.key}: too many items`);
            if (def.items) value.forEach(item => validValue(state, { ...def.items, key: def.key }, item));
            break;
        default: fail(`Unsupported parameter type: ${def.type}`);
    }
    if (typeof value === 'string' && rules.minLength !== undefined && value.length < rules.minLength) fail(`${def.key}: too short`);
    if (typeof value === 'string' && rules.maxLength !== undefined && value.length > rules.maxLength) fail(`${def.key}: too long`);
}
function validateDescriptor(def) {
    if (!PARAM_TYPES.includes(def.type)) fail('Invalid parameter type');
    exact(def.validation || {}, ['required', 'min', 'max', 'minLength', 'maxLength', 'maxItems']);
    const rules = def.validation || {};
    if (rules.required !== undefined && typeof rules.required !== 'boolean') fail('Invalid required constraint');
    for (const key of ['min', 'max', 'minLength', 'maxLength', 'maxItems']) if (rules[key] !== undefined && (typeof rules[key] !== 'number' || !Number.isFinite(rules[key]))) fail('Invalid numeric constraint');
    if (rules.min > rules.max || rules.minLength > rules.maxLength) fail('Invalid range');
    if (def.type === 'enum' && (!Array.isArray(def.values) || !def.values.length || def.values.some(v => typeof v !== 'string') || new Set(def.values).size !== def.values.length)) fail('Enum needs distinct string values');
    if (def.fields !== undefined) {
        if (def.type !== 'object' || !object(def.fields)) fail('Fields require object type');
        Object.entries(def.fields).forEach(([key, child]) => { id(key); validateDescriptor(child); });
    }
    if (def.items !== undefined) { if (def.type !== 'list') fail('Items require list type'); validateDescriptor(def.items); }
}
function validateDefinition(state, def, ignore) {
    exact(def, ['key', 'label', 'description', 'type', 'scope', 'default', 'validation', 'schemaVersion', 'status', 'aliases', 'values', 'items', 'fields', 'visibility']);
    id(def.key); id(def.label); validateDescriptor(def);
    if (def.visibility !== undefined && !['public', 'private'].includes(def.visibility)) fail('Invalid parameter visibility');
    if (!Array.isArray(def.aliases) || def.aliases.some(a => typeof a !== 'string' || !a.trim())) fail('Invalid aliases');
    if (!['active', 'archived'].includes(def.status)) fail('Invalid parameter status');
    if (!Number.isInteger(def.schemaVersion) || def.schemaVersion < 1) fail('Invalid parameter schema version');
    if (!Array.isArray(def.scope) || !def.scope.length || def.scope.some(t => !own(state.registry.entityTypes, t))) fail('Unknown parameter scope');
    const names = new Set([def.key, def.label, ...def.aliases].map(normalized));
    const duplicate = Object.entries(state.registry.parameters).find(([key, p]) => key !== ignore && [p.key, p.label, ...p.aliases].some(n => names.has(normalized(n))))?.[1];
    if (duplicate) fail(`Parameter already exists: ${duplicate.key}`);
    if (own(def, 'default')) validValue(state, def, def.default);
}
function stamp(target, metadata) {
    target.updatedAt = metadata.at;
    if (metadata.deltaId) target.lastChangeId = metadata.deltaId;
}
function spatialFields(e) {
    e.holder = null; e.location = null; e.container = null;
    if (!e.position) return;
    if (['holds', 'wears'].includes(e.position.rel)) e.holder = e.position.target;
    else if (e.position.rel === 'inside') e.container = e.position.target;
    else e.location = e.position.target;
}
export function validateWorld(state) {
    assertSafeData(state);
    if (!object(state.registry) || !object(state.registry.entityTypes) || !object(state.registry.parameters) || !object(state.entities)) fail('Missing entity registry');
    if (!Number.isInteger(state.registry.schemaVersion) || state.registry.schemaVersion < 1) fail('Invalid registry schema version');
    for (const [key, type] of Object.entries(state.registry.entityTypes)) {
        id(key); exact(type, ['key', 'label', 'status']); id(type.label);
        if (key !== type.key || !['active', 'archived'].includes(type.status)) fail('Invalid entity type');
    }
    for (const [key, def] of Object.entries(state.registry.parameters)) {
        if (key !== def.key) fail('Parameter key mismatch');
        validateDefinition(state, def, key);
    }
    for (const [key, e] of Object.entries(state.entities)) {
        exact(e, ['id', 'type', 'name', 'aliases', 'campaignId', 'sessionId', 'params', 'relations', 'status', 'createdAt', 'updatedAt', 'lastChangeId', 'owner', 'holder', 'location', 'container', 'position']);
        id(key); id(e.name); id(e.campaignId);
        if (e.id !== key || !own(state.registry.entityTypes, e.type) || !['active', 'archived'].includes(e.status) || !object(e.params) || !Array.isArray(e.relations) || !Array.isArray(e.aliases) || e.aliases.some(a => typeof a !== 'string')) fail(`Invalid entity: ${key}`);
        if (e.sessionId !== undefined) id(e.sessionId);
        for (const [param, value] of Object.entries(e.params)) {
            const def = definition(state, param, false);
            if (def.key !== param || !def.scope.includes(e.type)) fail(`Parameter scope or key mismatch: ${param}`);
            validValue(state, def, value);
        }
        for (const def of Object.values(state.registry.parameters)) if (def.status === 'active' && def.scope.includes(e.type) && def.validation?.required && !own(e.params, def.key)) fail(`Required parameter: ${def.key}`);
        if (e.owner !== null) entity(state, e.owner, false);
        if (e.position !== null) {
            exact(e.position, ['rel', 'target']);
            if (!PHYSICAL.includes(e.position.rel)) fail('Invalid physical relation');
            const target = entity(state, e.position.target, false);
            if (['holds', 'wears'].includes(e.position.rel) && target.type !== 'character') fail('Holder must be a character');
            const seen = new Set([key]); let cursor = e;
            while (cursor.position) { if (seen.has(cursor.position.target)) fail('Physical containment cycle'); seen.add(cursor.position.target); cursor = entity(state, cursor.position.target, false); }
        }
        const expected = { position: e.position }; spatialFields(expected);
        for (const field of ['holder', 'location', 'container']) if (e[field] !== expected[field]) fail(`Conflicting physical field: ${field}`);
        for (const rel of e.relations) { exact(rel, ['rel', 'target']); id(rel.rel); if (PHYSICAL.includes(rel.rel) || ['owner', 'holder', 'location', 'container'].includes(rel.rel)) fail('Use move or set_owner for physical relations'); entity(state, rel.target, false); }
    }
    return state;
}

/** Pure all-or-nothing transaction. Registry changes require explicit author authority. */
export function applyOperations(input, operations, metadata = {}) {
    if (!Array.isArray(operations) || operations.length > 200) fail('Operations must be an array of at most 200 entries');
    assertSafeData(operations);
    metadata = { at: new Date().toISOString(), ...metadata };
    const state = clone(input);
    for (const op of operations) {
        if (!object(op)) fail('Invalid operation');
        if (ADMIN.includes(op.op) && metadata.source !== 'author') fail('Registry changes require author command');
        if (op.op === 'define_type') {
            exact(op, ['op', 'key', 'label']); id(op.key); id(op.label);
            if (Object.values(state.registry.entityTypes).some(t => [t.key, t.label].map(normalized).some(n => [op.key, op.label].map(normalized).includes(n)))) fail('Entity type already exists');
            state.registry.entityTypes[op.key] = { key: op.key, label: op.label, status: 'active' };
        } else if (op.op === 'define_parameter') {
            exact(op, ['op', 'definition']);
            const def = { description: '', aliases: [], validation: {}, status: 'active', visibility: 'private', ...clone(op.definition), schemaVersion: state.registry.schemaVersion + 1 };
            validateDefinition(state, def);
            state.registry.parameters[def.key] = def;
            for (const e of Object.values(state.entities)) if (def.scope.includes(e.type) && own(def, 'default')) { e.params[def.key] = clone(def.default); stamp(e, metadata); }
        } else if (['update_parameter', 'rename_parameter', 'archive_parameter', 'delete_parameter'].includes(op.op)) {
            exact(op, ['op', 'key', ...(op.op === 'update_parameter' ? ['patch'] : op.op === 'rename_parameter' ? ['newKey', 'label'] : [])]);
            const def = definition(state, op.key, false); const oldKey = def.key;
            if (op.op === 'update_parameter') {
                exact(op.patch, ['label', 'description', 'type', 'scope', 'default', 'validation', 'values', 'items', 'fields', 'status', 'visibility']);
                Object.assign(def, clone(op.patch));
            } else if (op.op === 'rename_parameter') {
                id(op.newKey); def.key = op.newKey; if (op.label !== undefined) def.label = op.label;
                def.aliases = [...new Set([...def.aliases, oldKey])].filter(a => a !== def.key);
            } else {
                const used = Object.values(state.entities).some(e => own(e.params, oldKey));
                if (op.op === 'delete_parameter' && !used) { delete state.registry.parameters[oldKey]; state.registry.schemaVersion++; continue; }
                def.status = 'archived';
            }
            def.schemaVersion = state.registry.schemaVersion + 1;
            validateDefinition(state, def, oldKey);
            delete state.registry.parameters[oldKey]; state.registry.parameters[def.key] = def;
            if (oldKey !== def.key) for (const e of Object.values(state.entities)) if (own(e.params, oldKey)) { e.params[def.key] = e.params[oldKey]; delete e.params[oldKey]; stamp(e, metadata); }
        } else if (op.op === 'create_entity') {
            exact(op, ['op', 'entity']);
            exact(op.entity, ['id', 'type', 'name', 'aliases', 'campaignId', 'sessionId', 'params']);
            const raw = op.entity; id(raw.id);
            if (own(state.entities, raw.id)) fail('Entity ID already exists');
            if (!own(state.registry.entityTypes, raw.type) || state.registry.entityTypes[raw.type].status !== 'active') fail('Unknown or archived entity type');
            const e = { aliases: [], campaignId: metadata.campaignId || 'default', ...clone(raw), params: {}, relations: [], status: 'active', owner: null, position: null, holder: null, location: null, container: null, createdAt: metadata.at, updatedAt: metadata.at };
            for (const def of Object.values(state.registry.parameters)) if (def.status === 'active' && def.scope.includes(e.type) && own(def, 'default')) e.params[def.key] = clone(def.default);
            for (const [key, value] of Object.entries(raw.params || {})) { const def = definition(state, key); e.params[def.key] = clone(value); }
            stamp(e, metadata); state.entities[e.id] = e;
        } else {
            const keys = { move: ['entity', 'to'], set_owner: ['entity', 'owner'], set: ['entity', 'key', 'value'], adjust: ['entity', 'key', 'amount'], link: ['entity', 'rel', 'target'], unlink: ['entity', 'rel', 'target'], archive_entity: ['entity'] };
            if (!own(keys, op.op)) fail(`Unsupported operation: ${op.op}`);
            exact(op, ['op', ...keys[op.op]]);
            const e = entity(state, op.entity);
            if (op.op === 'move') {
                if (op.to !== null) { exact(op.to, ['rel', 'target']); entity(state, op.to.target); }
                e.position = clone(op.to); spatialFields(e);
            } else if (op.op === 'set_owner') { if (op.owner !== null) entity(state, op.owner); e.owner = op.owner; }
            else if (['set', 'adjust'].includes(op.op)) {
                const def = definition(state, op.key);
                if (!def.scope.includes(e.type)) fail('Parameter scope mismatch');
                if (op.op === 'adjust' && (def.type !== 'number' || typeof e.params[def.key] !== 'number' || !Number.isFinite(op.amount))) fail('Adjust requires numeric current value and amount');
                const value = op.op === 'set' ? op.value : e.params[def.key] + op.amount;
                validValue(state, def, value); e.params[def.key] = clone(value);
            } else if (op.op === 'archive_entity') e.status = 'archived';
            else {
                entity(state, op.target); id(op.rel);
                e.relations = e.relations.filter(r => r.rel !== op.rel || r.target !== op.target);
                if (op.op === 'link') e.relations.push({ rel: op.rel, target: op.target });
            }
            stamp(e, metadata);
        }
        if (ADMIN.includes(op.op)) state.registry.schemaVersion++;
    }
    return validateWorld(state);
}
