import test from 'node:test';
import assert from 'node:assert/strict';
import { narrativeEngineInterceptor, installInterceptor, uninstallInterceptor } from '../src/interceptors/narrativeEngineInterceptor.js';
import { retrieveMemories } from '../src/memory/retrieval.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';
import { StateManager } from '../src/state/manager.js';
import { shouldRunWorldSimulation } from '../src/utils/cadence.js';
import { RequestGate } from '../src/utils/requestGate.js';

test('solo continuity, knowledge, relationships, and timeline survive delta replay', async () => {
    const manager = new StateManager({ chatFingerprint: 'solo', storage: new MemoryStorageAdapter(), checkpointEvery: 2 });
    await manager.load();
    await manager.applyDelta({
        time_advance_minutes: 4,
        characters: { Kenzie: { clothing: { jacket: 'removed' }, position: 'bed 2' } },
        objects: { kenzie_jacket: { location: 'bed 2' } },
        knowledge: { family_debt: { truth: 'debt', known_by: ['Kenzie'], unknown_to: ['Bex'] } },
        relationships: { 'Bex::Kenzie': { current_tension: 'public embarrassment', unresolved: true } },
    }, { messageIndex: 1, source: 'message:1' });
    const before = manager.snapshot();
    assert.equal(before.characters.Kenzie.clothing.jacket, 'removed');
    assert.deepEqual(before.knowledge.family_debt.known_by, ['Kenzie']);
    assert.equal(before.timeline.elapsedMinutes, 4);
    await manager.rebuild();
    assert.deepEqual(manager.snapshot(), before);
});

test('long chat retrieval returns the old relevant violin episode without a chat dump', () => {
    const memories = Array.from({ length: 1000 }, (_, index) => ({
        id: `episode_${index}`, summary: index === 42 ? 'Wren promised to bring her violin to rehearsal.' : `Routine meal number ${index}`,
        topics: index === 42 ? ['violin', 'talent_show'] : ['daily'], characters: index === 42 ? ['Wren'] : ['NPC'], importance: index === 42 ? 0.9 : 0.1,
    }));
    const result = retrieveMemories(memories, { message: 'Wren asks about the violin', characters: ['Wren'], topics: ['violin'] }, { topK: 6 });
    assert.equal(result.length, 6);
    assert.equal(result[0].id, 'episode_42');
});

test('world cadence resurfaces due established events without random chance text', () => {
    assert.equal(shouldRunWorldSimulation({ dueEvent: true }), true);
    assert.equal(shouldRunWorldSimulation({ timeAdvanceMinutes: 5 }), true);
    assert.equal(shouldRunWorldSimulation({ timeAdvanceMinutes: 1 }), false);
});

test('chat switch rejects a stale PRE result', () => {
    const gate = new RequestGate();
    gate.switchContext({ chatFingerprint: 'a', sessionId: '1' });
    const request = gate.begin({ generationId: 'g1' });
    gate.switchContext({ chatFingerprint: 'b', sessionId: '2' });
    assert.equal(request.signal.aborted, true);
    assert.throws(() => gate.assertCurrent(request), /Stale asynchronous response/);
});

test('Director offline leaves outgoing RP chat untouched', async () => {
    const chat = [{ is_user: true, mes: 'Continue.' }];
    installInterceptor({ preparePacket: async () => null });
    await narrativeEngineInterceptor(chat, 4096, () => {}, 'normal');
    uninstallInterceptor();
    assert.equal(chat.length, 1);
});

test('PRE packet is ephemeral and marked when available', async () => {
    const chat = [{ is_user: true, mes: 'Continue.' }];
    installInterceptor({ preparePacket: async () => '[DIRECTOR CONTEXT]\nSCENE\nRoom 167' });
    await narrativeEngineInterceptor(chat, 4096, () => {}, 'normal');
    uninstallInterceptor();
    assert.equal(chat.length, 2);
    assert.equal(chat[1].extra.narrative_engine.ephemeral, true);
});
