import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState, applyStateDelta} from '../src/state/model.js';
import {buildEvidenceCatalog} from '../src/state/evidence.js';
import {applyStoryEvents} from '../scripts/typed-story-events.mjs';
import {buildTypedStoryRequest} from '../scripts/prepare-typed-story-study.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/typed-story-events.json', import.meta.url), 'utf8'));
function world(setup) {
    const types = {anna: 'character', boris: 'character', coat: 'clothing', cup: 'item', table: 'item',
        car: 'container', handle: 'item', bruise: 'event', street: 'location', kitchen: 'location'};
    const ops = Object.entries(types).map(([id, type]) => ({op: 'create_entity', entity: {id, name: id, type, campaignId: 'study'}}));
    ops.push({op: 'define_parameter', definition: {key: 'posture', label: 'Posture', type: 'string', scope: ['character'], default: 'sitting'}},
        {op: 'move', entity: 'coat', to: {rel: setup === 'worn-coat' ? 'wears' : 'on', target: setup === 'worn-coat' ? 'anna' : 'table'}},
        {op: 'move', entity: 'cup', to: {rel: 'holds', target: 'anna'}},
        {op: 'move', entity: 'boris', to: {rel: 'inside', target: 'car'}},
        {op: 'link', entity: 'handle', rel: 'part_of', target: 'car'});
    return applyStateDelta(createInitialState(), {ops}, {source: 'author', deltaId: 'setup'});
}
for (const row of fixture.cases) {
    test('typed regression: ' + row.id, async () => {
        const initial = world(row.setup), snapshot = structuredClone(initial);
        const catalog = await buildEvidenceCatalog({rp: row.text});
        const events = row.events.map(({line, ...event}) => ({...event, ref: catalog[line].ref}));
        if (row.expectedError) assert.throws(() => applyStoryEvents(initial, events, catalog), new RegExp(row.expectedError));
        else {
            const result = applyStoryEvents(initial, events, catalog);
            if (row.unchanged) assert.deepEqual(result.state, initial);
            else {
                const entity = result.state.entities[row.check.entity];
                assert.deepEqual(entity.position, {rel: row.check.rel, target: row.check.target});
                if (Object.hasOwn(row.check, 'posture')) assert.equal(entity.params.posture, row.check.posture);
            }
        }
        assert.deepEqual(initial, snapshot);
    });
}

test('typed event batch rejects stale references and failures cannot mutate its input', () => {
    const initial = world(), snapshot = structuredClone(initial);
    const event = {id: 'one', actor: 'anna', verb: 'take', object: 'coat', time: 'current', modality: 'fact', ref: 'r0'};
    assert.throws(() => applyStoryEvents(initial, [event], [{ref: 'other'}]), /contract/);
    assert.throws(() => applyStoryEvents(initial, [event, {...event, id: 'two', object: 'missing'}], [{ref: 'r0'}]), /Unknown/);
    assert.deepEqual(initial, snapshot);
});

test('taking does not steal another holder item and removing requires worn clothing', () => {
    const initial = world();
    const event = {id: 'one', actor: 'boris', verb: 'take', object: 'cup', time: 'current', modality: 'fact', ref: 'r0'};
    assert.throws(() => applyStoryEvents(initial, [event], [{ref: 'r0'}]), /transfer/);
    assert.throws(() => applyStoryEvents(initial, [{...event, actor: 'anna', verb: 'remove', object: 'coat'}], [{ref: 'r0'}]), /not worn/);
});

test('model-facing preparation excludes expected results and adversarial candidate events', async () => {
    for (const row of fixture.cases) {
        const request = buildTypedStoryRequest(row, await buildEvidenceCatalog({rp: row.text}));
        const data = JSON.parse(request.messages[1].content);
        assert.equal(data.text, row.text);
        assert.deepEqual(Object.keys(data).sort(), ['entities', 'evidence_catalog', 'text']);
        assert.doesNotMatch(JSON.stringify(request), /expectedError|unchanged|chicken|not-holdout/);
    }
});
