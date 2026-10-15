import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJson, reduceEvents, validateEmotions} from '../scripts/event-memory-study.mjs';
const catalog = [{ref: 'r0'}, {ref: 'r1'}, {ref: 'r2'}];
const event = (field, value, ref, time = 'current', mode = 'fact') => ['Anna', field, value, time, mode, ref];

test('event reducer excludes memories, claims, wishes and unknown times from physical state', () => {
    for (const [time, mode] of [['past', 'fact'], ['unknown', 'fact'], ['current', 'claim'], ['current', 'wish'], ['current', 'hypothetical'], ['current', 'negated']]) {
        const result = reduceEvents({cast: ['Anna'], events: [event('clothing', 'coat', 'r0', time, mode)]}, catalog);
        assert.deepEqual(result.characters, [{id: 'Anna'}]);
        assert.equal(result.excluded.length, 1);
    }
});

test('event reducer orders by source evidence and invalidates posture after a location change', () => {
    const events = [event('location', 'street', 'r2'), event('location', 'car', 'r0'), event('posture', 'sitting', 'r1')];
    const result = reduceEvents({cast: ['Anna'], events}, catalog);
    assert.equal(result.characters[0].location.value, 'street');
    assert.equal(result.characters[0].posture, undefined);
});

test('holding does not become clothing and invalid source refs fail closed', () => {
    const input = {cast: ['Anna'], events: [event('holding', 'coat', 'r1')]};
    assert.equal(reduceEvents(input, catalog).characters[0].clothing, undefined);
    input.events.push(event('clothing', 'coat', 'fake'));
    assert.throws(() => reduceEvents(input, catalog), /evidence/);
});

test('emotion validation rejects switched identities and unknown evidence', () => {
    const value = {characters: [{id: 'Anna', inner: 'uncertain', evidenceRefs: ['r0']}]};
    assert.deepEqual(validateEmotions(value, ['Anna'], catalog), value);
    value.characters[0].id = 'Unknown';
    assert.throws(() => validateEmotions(value, ['Anna'], catalog), /identity/);
    value.characters[0].id = 'Anna';
    value.characters[0].evidenceRefs = ['unknown'];
    assert.throws(() => validateEmotions(value, ['Anna'], catalog), /evidence/);
    assert.deepEqual(parseJson('{"events":[]}'), {events: []});
});
