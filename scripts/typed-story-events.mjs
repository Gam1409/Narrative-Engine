import {applyOperations, assertSafeData} from '../src/state/entities.js';

const verbs = new Set(['take', 'put', 'wear', 'remove', 'relocate']);
const times = new Set(['current', 'past', 'unknown']);
const modalities = new Set(['fact', 'claim', 'wish', 'hypothetical', 'negated']);

// Experimental adapter only. Temporal and semantic truth still require model evaluation.
export function applyStoryEvents(initial, events, evidenceCatalog) {
    assertSafeData(events);
    if (!Array.isArray(events) || events.length > 32) throw Error('Invalid event batch');
    const refs = new Map(evidenceCatalog.map((entry, index) => [entry.ref, index]));
    const ids = new Set();
    for (const event of events) {
        if (!event || typeof event !== 'object' || Array.isArray(event)
            || Object.keys(event).some(key => !['id', 'actor', 'verb', 'object', 'destination', 'time', 'modality', 'ref'].includes(key))
            || ['id', 'actor', 'verb', 'object', 'time', 'modality', 'ref'].some(key => typeof event[key] !== 'string' || !event[key].trim())
            || ids.has(event.id) || !verbs.has(event.verb) || !times.has(event.time)
            || !modalities.has(event.modality) || !refs.has(event.ref)) throw Error('Invalid event contract');
        if (event.verb === 'put') {
            if (typeof event.destination !== 'string' || !event.destination.trim()) throw Error('Put requires destination');
        } else if (Object.hasOwn(event, 'destination')) throw Error('Unexpected destination');
        ids.add(event.id);
    }
    let state = initial;
    const applied = [], excluded = [];
    const ordered = events.map((event, index) => ({event, index})).sort((a, b) =>
        refs.get(a.event.ref) - refs.get(b.event.ref) || a.index - b.index);
    for (const {event} of ordered) {
        if (event.time !== 'current' || event.modality !== 'fact') {
            excluded.push(event.id);
            continue;
        }
        const resolve = id => {
            const item = Object.hasOwn(state.entities, id) && state.entities[id];
            if (!item || item.status !== 'active') throw Error('Unknown or archived entity');
            return item;
        };
        const actor = resolve(event.actor), object = resolve(event.object);
        if (actor.type !== 'character') throw Error('Actor must be character');
        const held = object.position?.rel === 'holds' && object.position.target === actor.id;
        const worn = object.position?.rel === 'wears' && object.position.target === actor.id;
        let operations;
        if (event.verb === 'relocate') {
            if (object.type !== 'location') throw Error('Movement requires location');
            operations = [{op: 'move', entity: actor.id, to: {rel: 'in', target: object.id}}];
            // Clear only an existing nullable posture parameter; no schema administration.
            const posture = state.registry.parameters.posture;
            if (Object.hasOwn(actor.params, 'posture') && posture?.status === 'active'
                && !posture.validation?.required) operations.push({op: 'set', entity: actor.id, key: 'posture', value: null});
        } else {
            if (!['item', 'clothing', 'accessory', 'plotObject'].includes(object.type)
                || object.relations.some(relation => relation.rel === 'part_of')) throw Error('Object is not portable');
            if (event.verb === 'take') {
                if (object.position?.rel === 'wears') throw Error('Remove clothing before taking');
                if (object.holder && object.holder !== actor.id) throw Error('Explicit transfer required');
                operations = [{op: 'move', entity: object.id, to: {rel: 'holds', target: actor.id}}];
            } else if (event.verb === 'put') {
                if (!held) throw Error('Cannot put an object not held by actor');
                const destination = resolve(event.destination);
                if (!['location', 'item', 'container'].includes(destination.type)) throw Error('Invalid destination');
                operations = [{op: 'move', entity: object.id, to: {rel: 'on', target: destination.id}}];
            } else if (event.verb === 'wear') {
                if (!['clothing', 'accessory'].includes(object.type)) throw Error('Object is not clothing');
                if (!held) throw Error('Wear requires held object');
                operations = [{op: 'move', entity: object.id, to: {rel: 'wears', target: actor.id}}];
            } else {
                if (!worn) throw Error('Cannot remove clothing not worn by actor');
                operations = [{op: 'move', entity: object.id, to: {rel: 'holds', target: actor.id}}];
            }
        }
        state = applyOperations(state, operations, {source: 'study', deltaId: event.id});
        applied.push(event.id);
    }
    return {state, applied, excluded};
}
