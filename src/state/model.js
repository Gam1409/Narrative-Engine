import { applyOperations, assertSafeData, createRegistry } from './entities.js';
import { clone, mergeImmutable } from '../utils/object.js';
import { advanceTimeline } from './timeline.js';

export const CURRENT_SCHEMA_VERSION = 2;

export function createInitialState(overrides = {}) {
    const initial = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        revision: 0,
        entities: {},
        registry: createRegistry(),
        scene: {},
        characters: {},
        objects: {},
        locations: {},
        timeline: { date: null, time: null, elapsedMinutes: 0, scheduled: [] },
        relationships: {},
        knowledge: {},
        threads: {},
        npc_plans: {},
        world_events: {},
        provenance: {},
    };
    return mergeImmutable(initial, overrides);
}

/**
 * Applies a Director delta as a pure operation. `$delete: true` removes a key.
 * Metadata is recorded separately so ordinary state consumers keep plain values.
 */
export function applyStateDelta(state, delta = {}, options = {}) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state must be an object');
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) throw new TypeError('delta must be an object');
    const { source = 'director', confidence = 1, at = new Date().toISOString() } = options;
    assertSafeData(delta);
    if (Object.hasOwn(delta, 'entities') || Object.hasOwn(delta, 'registry')) throw new Error('Use typed operations for entities and registry');
    const allowed = ['ops', 'scene', 'characters', 'objects', 'locations', 'timeline', 'relationships', 'knowledge', 'threads', 'npc_plans', 'world_events', 'time_advance_minutes', 'timeAdvanceMinutes'];
    for (const key of Object.keys(delta)) if (!allowed.includes(key)) throw new Error(`Unsupported state delta field: ${key}`);
    const stateDelta = clone(delta);
    const operations = stateDelta.ops;
    delete stateDelta.ops;
    const minutes = Number(stateDelta.time_advance_minutes ?? stateDelta.timeAdvanceMinutes ?? 0);
    delete stateDelta.time_advance_minutes;
    delete stateDelta.timeAdvanceMinutes;

    let next = mergeImmutable(state, stateDelta);
    if (Number.isFinite(minutes) && minutes !== 0) next.timeline = advanceTimeline(next.timeline, minutes);
    if (operations !== undefined) next = applyOperations(next, operations, { ...options, source, confidence, at });
    for (const section of ['characters', 'objects', 'locations']) {
        for (const key of Object.keys(delta[section] || {})) {
            const registered = Object.values(next.entities || {}).some(e => [e.id, e.name, ...e.aliases].includes(key));
            if (registered) throw new Error(`Use typed operations for registered entity: ${key}`);
        }
    }
    next.schemaVersion = CURRENT_SCHEMA_VERSION;
    next.revision = Number(state.revision || 0) + 1;
    next.provenance = mergeImmutable(state.provenance || {}, buildProvenance(stateDelta, { source, confidence, at }));
    return next;
}

function buildProvenance(delta, metadata, path = [], output = {}) {
    for (const [key, value] of Object.entries(delta)) {
        const nextPath = [...path, key];
        if (value && typeof value === 'object' && !Array.isArray(value) && value.$delete !== true) {
            buildProvenance(value, metadata, nextPath, output);
        } else {
            output[nextPath.join('.')] = { value: value?.$delete === true ? undefined : clone(value), ...metadata };
        }
    }
    return output;
}

export function fact(value, source, confidence = 1) {
    return { value: clone(value), source, confidence };
}
