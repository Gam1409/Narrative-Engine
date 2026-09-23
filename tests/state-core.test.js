import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, applyStateDelta } from '../src/state/model.js';
import { advanceTimeline } from '../src/state/timeline.js';
import { StateManager } from '../src/state/manager.js';
import { MemoryStorageAdapter, BrowserStorageAdapter } from '../src/memory/storage.js';

test('state delta is immutable, advances time, and records provenance', () => {
    const state = createInitialState({ timeline: { date: '2026-12-17', time: '23:58', scheduled: [] } });
    const next = applyStateDelta(state, {
        time_advance_minutes: 4,
        characters: { Kenzie: { position: 'bed 2' } },
        objects: { balcony_door: 'closed' },
    }, { source: 'message:421', confidence: 1, at: '2026-01-01T00:00:00Z' });
    assert.equal(state.characters.Kenzie, undefined);
    assert.equal(next.characters.Kenzie.position, 'bed 2');
    assert.equal(next.timeline.date, '2026-12-18');
    assert.equal(next.timeline.time, '00:02');
    assert.equal(next.provenance['characters.Kenzie.position'].source, 'message:421');
});

test('timeline rejects invalid increments and remains immutable', () => {
    const original = { date: '2026-12-17', time: '17:46', scheduled: [] };
    assert.throws(() => advanceTimeline(original, NaN));
    assert.deepEqual(original, { date: '2026-12-17', time: '17:46', scheduled: [] });
});

test('failed transaction rolls state back', async () => {
    const manager = new StateManager({ validator: (state) => ({ valid: !state.objects.forbidden, errors: ['forbidden'] }) });
    const before = manager.snapshot();
    await assert.rejects(manager.applyDelta({ objects: { forbidden: true } }), /validation/);
    assert.deepEqual(manager.snapshot(), before);
    assert.equal(manager.deltas.length, 0);
});

test('storage failure also rolls transaction back', async () => {
    const storage = { async getItem() { return null; }, async setItem() { throw new Error('disk full'); } };
    const manager = new StateManager({ storage });
    const before = manager.snapshot();
    await assert.rejects(manager.applyDelta({ scene: { location: 'hall' } }), /disk full/);
    assert.deepEqual(manager.snapshot(), before);
    assert.equal(manager.deltas.length, 0);
});

test('checkpoint restore and replay rebuild deterministic state', async () => {
    const storage = new MemoryStorageAdapter();
    const manager = new StateManager({ storage, checkpointEvery: 2 });
    await manager.applyDelta({ objects: { violin: 'desk' } }, { messageIndex: 0 });
    await manager.applyDelta({ objects: { violin: 'Wren' } }, { messageIndex: 1 });
    await manager.applyDelta({ scene: { location: 'hall' } }, { messageIndex: 2 });
    await manager.restoreCheckpoint(1);
    assert.equal(manager.state.objects.violin, 'Wren');
    const result = await manager.rebuild({ throughMessageIndex: 2 });
    assert.equal(result.state.scene.location, 'hall');
    assert.equal(result.state.objects.violin, 'Wren');
});

test('browser adapter falls back when localforage rejects', async () => {
    const adapter = new BrowserStorageAdapter({
        async getItem() { throw new Error('private mode'); },
        async setItem() { throw new Error('private mode'); },
    });
    await adapter.setItem('x', { ok: true });
    assert.deepEqual(await adapter.getItem('x'), { ok: true });
    assert.equal(adapter.degraded, true);
});
