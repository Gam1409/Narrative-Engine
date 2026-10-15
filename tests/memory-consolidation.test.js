import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidationBatch, validateConsolidationCandidate } from '../src/memory/consolidation.js';
import { activeMemories } from '../src/state/history.js';

const scope = { campaignId: 'world', sessionId: 'session' };
const options = { scope, viewers: ['Anna'] };
const event = (id, extra = {}) => ({ id, text: id, type: 'event', status: 'current', visibleTo: ['Anna'], ...scope, ...extra });

test('consolidation limits context and separates audiences, sessions and disputed sources', () => {
    const items = [event('private', { visibleTo: ['Bob'] }), event('disputed', { status: 'disputed' }),
        event('old', { sessionId: 'old' }), event('exception', { visibleTo: ['*'], unknown_to: ['Bob'] }),
        event('huge', { text: 'x'.repeat(13000) }), event('public', { visibleTo: ['*'] }), event('a'), event('b'), event('c')];
    assert.deepEqual(consolidationBatch(items, { ...options, maxItems: 2 }).map(m => m.id), ['a', 'b']);
});

test('summaries acknowledge only validated sources and cannot widen access or replace facts', () => {
    const batch = consolidationBatch([event('a'), event('b')], options);
    const candidate = { type: 'summary', text: 'A promise was kept.', sourceMemoryIds: ['a', 'b'],
        visibleTo: ['*'], factKey: 'personality', supersedes: ['a'], status: 'superseded' };
    const summary = validateConsolidationCandidate(candidate, batch);
    assert.deepEqual(summary.visibleTo, ['Anna']); assert.equal(summary.status, 'current');
    assert.equal(summary.factKey, undefined); assert.equal(summary.supersedes, undefined);
    assert.equal(validateConsolidationCandidate({ ...candidate, sourceMemoryIds: ['a', 'invented'] }, batch), null);
    assert.equal(validateConsolidationCandidate({ ...candidate, type: 'belief' }, batch), null);
    assert.equal(validateConsolidationCandidate(candidate, []), null);
    assert.deepEqual(consolidationBatch([event('a'), event('b'), { ...summary, ...scope }], options), []);
});

test('branch rollback restores pending sources without deleting original episodes', () => {
    const first = { deltaId: 'first', memories: [event('a'), event('b')] };
    const sources = activeMemories([first]);
    const summary = validateConsolidationCandidate({ type: 'summary', text: 'Two related events.',
        sourceMemoryIds: sources.map(m => m.id) }, consolidationBatch(sources, options));
    const second = { deltaId: 'second', memories: [{ ...summary, ...scope }] };
    assert.equal(activeMemories([first, second]).length, 3);
    assert.deepEqual(consolidationBatch(activeMemories([first, second]), options), []);
    assert.equal(consolidationBatch(activeMemories([first]), options).length, 2);
});


test('configured token estimate bounds serialized source context without consuming skipped episodes', () => {
    const memories = [event('long', {text: 'x'.repeat(5000)}), event('a'), event('b')];
    const batch = consolidationBatch(memories, {...options, tokenBudget: 256});
    assert.deepEqual(batch.map(m=>m.id), ['a','b']);
    assert.ok(Math.ceil(JSON.stringify(batch).length / 4) <= 256);
    assert.equal(consolidationBatch(memories, {...options, tokenBudget: 3000})[0].id, 'long');
});
