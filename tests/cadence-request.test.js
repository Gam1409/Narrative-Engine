import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRunPlotMaintenance, shouldRunMemoryConsolidation, shouldCreateCheckpoint, shouldRunWorldSimulation } from '../src/utils/cadence.js';
import { RequestGate } from '../src/utils/requestGate.js';

test('default cadence follows specification', () => {
    assert.equal(shouldRunPlotMaintenance({ turn: 3 }), true);
    assert.equal(shouldRunPlotMaintenance({ turn: 2 }), false);
    assert.equal(shouldRunMemoryConsolidation({ messageCount: 8 }), true);
    assert.equal(shouldRunMemoryConsolidation({ messageCount: 1, sceneChanged: true }), true);
    assert.equal(shouldCreateCheckpoint({ messageCount: 10 }), true);
    assert.equal(shouldRunWorldSimulation({ timeAdvanceMinutes: 5 }), true);
    assert.equal(shouldRunWorldSimulation({ dueEvent: true }), true);
});

test('request gate aborts and rejects results after chat switch', () => {
    const gate = new RequestGate();
    gate.switchContext({ chatFingerprint: 'chat-a', sessionId: 'one' });
    const old = gate.begin({ generationId: 'g1', requestId: 'r1' });
    assert.equal(gate.isCurrent(old), true);
    gate.switchContext({ chatFingerprint: 'chat-b', sessionId: 'two' });
    assert.equal(old.signal.aborted, true);
    assert.equal(gate.isCurrent(old), false);
    assert.throws(() => gate.assertCurrent(old), { name: 'StaleResponseError' });
});

test('newer request in the same role makes an older response stale', () => {
    const gate = new RequestGate();
    gate.switchContext({ chatFingerprint: 'chat-a' });
    const old = gate.begin({ role: 'pre', requestId: 'one' });
    const current = gate.begin({ role: 'pre', requestId: 'two' });
    assert.equal(gate.isCurrent(old), false);
    assert.equal(gate.isCurrent(current), true);
});
