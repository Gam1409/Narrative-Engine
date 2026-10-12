import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NarrativeRuntime } from '../src/runtime/runtime.js';
import { StateManager } from '../src/state/manager.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';
import { EpisodicMemoryStore } from '../src/memory/store.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { getChatFingerprint } from '../src/context/stContext.js';
import { branchReferences, latestStatus } from '../src/state/history.js';

async function fixture(t) {
    const oldFetch = globalThis.fetch, oldST = globalThis.SillyTavern;
    globalThis.fetch = async url => {
        const target = new URL(url);
        assert.equal(target.protocol, 'file:', 'No model/network calls in tests');
        return new Response(await readFile(target));
    };
    t.after(() => { globalThis.fetch = oldFetch; globalThis.SillyTavern = oldST; });
    const context = { chatId: 'one', characterId: 0, characters: [{ name: 'Anna', avatar: 'Anna.png' }],
        chat: [{ is_user: true, mes: 'Continue', send_date: 'u1' }, { name: 'Anna', mes: 'takes sword', send_date: 'a1', swipe_id: 0, extra: {} }],
        chatMetadata: {}, saveChat: async () => {}, saveMetadata: async () => {} };
    globalThis.SillyTavern = { getContext: () => context };
    const runtime = new NarrativeRuntime();
    runtime.settings = { ...DEFAULT_SETTINGS, enabled: true, spriteDirector: false };
    runtime.storage = new MemoryStorageAdapter();
    runtime.spriteManifests = { loadParticipants: async () => [] };
    await runtime.loadChat(context);
    const calls = [];
    runtime.director = { run: async (_role, payload) => {
        calls.push(payload.rp_response);
        return { audit: { valid: true, errors: [] }, confidence: 0.8,
            state_delta: { time_advance_minutes: 5, objects: { sword: payload.rp_response } },
            relationship_delta: [], knowledge_delta: [], thread_delta: {}, world_event_delta: {},
            memory_candidates: [{ summary: payload.rp_response }], sprite_decisions: {} };
    } };
    return { runtime, context, calls };
}

test('G12 replay after load is idempotent and preserves provenance and memory', async t => {
    const { runtime, context, calls } = await fixture(t);
    await runtime.processPost(1, 'normal');
    const before = runtime.stateManager.snapshot();
    await runtime.loadChat(context); await runtime.processPost(1, 'normal');
    assert.equal(calls.length, 1); assert.deepEqual(runtime.stateManager.snapshot(), before);
    assert.equal(runtime.memoryStore.items.length, 1);
    assert.equal(runtime.stateManager.records[0].confidence, 0.8);
});

test('G6 swipe removes old memory and restores compatible cached variant without Director', async t => {
    const { runtime, context, calls } = await fixture(t);
    await runtime.processPost(1); const original = structuredClone(runtime.stateManager.records[0]);
    context.chat[1].swipe_id = 1; context.chat[1].mes = 'leaves sword';
    await runtime.markDirtyAndRebuild(1);
    assert.equal(runtime.stateManager.state.objects.sword, 'leaves sword');
    assert.deepEqual(runtime.memoryStore.items.map(m => m.summary), ['leaves sword']);
    assert.equal(latestStatus(runtime.stateManager.decisions, original.deltaId), 'reverted');
    context.chat[1].swipe_id = 0; context.chat[1].mes = 'takes sword';
    await runtime.markDirtyAndRebuild(1);
    assert.equal(calls.length, 2); assert.equal(runtime.stateManager.state.objects.sword, 'takes sword');
    assert.deepEqual(runtime.stateManager.records[0], original);
    assert.equal(latestStatus(runtime.stateManager.decisions, original.deltaId), 'confirmed');
});

test('G7 earlier edit recomputes dependent turns and equals replay from scratch', async t => {
    const { runtime, context, calls } = await fixture(t);
    runtime.stateManager.checkpointEvery = 2;
    context.chat.push({ is_user: true, mes: 'Next', send_date: 'u2' }, { name: 'Anna', mes: 'goes home', send_date: 'a2', extra: {} });
    await runtime.processPost(3); assert.equal(calls.length, 2);
    context.chat[0].mes = 'New instruction'; await runtime.markDirtyAndRebuild(0);
    assert.equal(calls.length, 4); assert.equal(runtime.stateManager.state.timeline.elapsedMinutes, 10);
    assert.equal(runtime.memoryStore.items.length, 2);
    const expected = new StateManager();
    for (const record of runtime.stateManager.deltas) await expected.applyDelta(record.delta, record);
    assert.deepEqual(runtime.stateManager.snapshot(), expected.snapshot());
    await runtime.markDirtyAndRebuild(3); assert.equal(calls.length, 4);
});

test('G8 delete rolls back state and memory including after reload', async t => {
    const { runtime, context } = await fixture(t); await runtime.processPost(1);
    context.chat.pop(); await runtime.markDirtyAndRebuild(1); await runtime.loadChat(context);
    assert.deepEqual(runtime.stateManager.state.objects, {}); assert.equal(runtime.memoryStore.items.length, 0);
    assert.equal(runtime.stateManager.records.length, 1);
});

test('G10 outage recovers missing POST and clears persistent pending flag', async t => {
    const { runtime, context } = await fixture(t), working = runtime.director;
    runtime.director = { run: async () => { throw new Error('offline'); } };
    await runtime.processPost(1); assert.equal(context.chatMetadata.narrative_engine.pendingReconciliation, true);
    await runtime.loadChat(context); runtime.director = working;
    await runtime.markDirtyAndRebuild(0);
    assert.equal(runtime.stateManager.state.timeline.elapsedMinutes, 5);
    assert.equal(context.chatMetadata.narrative_engine.pendingReconciliation, false);
});

test('C5 audit failure keeps immutable proposal and pending; successful retry supersedes it', async t => {
    const { runtime, context } = await fixture(t), working = runtime.director;
    runtime.director = { run: async (...args) => { const result = await working.run(...args); result.audit.valid = false; return result; } };
    await runtime.processPost(1);
    const proposal = structuredClone(runtime.stateManager.records[0]);
    assert.equal(latestStatus(runtime.stateManager.decisions, proposal.deltaId), 'proposed');
    assert.equal(runtime.stateManager.state.revision, 0);
    assert.equal(context.chatMetadata.narrative_engine.pendingReconciliation, true);
    runtime.director = working; await runtime.markDirtyAndRebuild(0);
    assert.equal(runtime.stateManager.state.revision, 1); assert.deepEqual(runtime.stateManager.records[0], proposal);
    assert.equal(latestStatus(runtime.stateManager.decisions, proposal.deltaId), 'superseded');
});

test('low confidence remains proposed and never creates memories or advances time', async t => {
    const { runtime } = await fixture(t), working = runtime.director;
    runtime.director = { run: async (...args) => ({ ...await working.run(...args), confidence: 0.1 }) };
    await runtime.processPost(1);
    assert.equal(runtime.stateManager.state.revision, 0); assert.equal(runtime.memoryStore.items.length, 0);
    assert.equal(runtime.stateManager.records[0].confidence, 0.1);
});

test('G11 late POST cannot write another chat or its metadata', async t => {
    const { runtime, context } = await fixture(t);
    let resolve, entered; const started = new Promise(r => { entered = r; });
    runtime.director = { run: async () => { entered(); return new Promise(r => { resolve = r; }); } };
    const post = runtime.processPost(1); await started;
    const other = { ...context, chatId: 'two', chat: [], chatMetadata: {} };
    globalThis.SillyTavern = { getContext: () => other };
    const switched = runtime.loadChat(other);
    resolve({ audit: { valid: true, errors: [] }, state_delta: { time_advance_minutes: 9 }, sprite_decisions: {} });
    await post; await switched;
    assert.equal(runtime.stateManager.state.revision, 0); assert.equal(runtime.stateManager.records.length, 0);
    assert.equal(other.chatMetadata.narrative_engine.pendingReconciliation, false);
});

test('late strict rewrite cannot edit a chat after switching', async t => {
    const { runtime, context } = await fixture(t); runtime.settings.auditMode = 'strict';
    let resolve, entered; const started = new Promise(r => { entered = r; });
    runtime.director = { run: async role => {
        if (role === 'post') return { audit: { valid: false, errors: [{ severity: 'high' }] } };
        entered(); return new Promise(r => { resolve = r; });
    } };
    const pending = runtime.processPost(1); await started;
    const other = { ...context, chatId: 'two', chat: [], chatMetadata: {} };
    globalThis.SillyTavern = { getContext: () => other }; const switched = runtime.loadChat(other);
    resolve({ replacement: 'should never appear' }); await pending; await switched;
    assert.equal(context.chat[1].mes, 'takes sword');
});

test('state and memories commit atomically on storage failure', async () => {
    const manager = new StateManager({ storage: { setItem: async () => { throw new Error('disk full'); } } });
    await assert.rejects(manager.recordTurn({ time_advance_minutes: 5 }, { idempotencyKey: 'k', messageIndex: 1 }, { memories: [{ summary: 'x' }] }), /disk full/);
    assert.equal(manager.state.revision, 0); assert.equal(manager.records.length, 0); assert.equal(manager.memories.length, 0);
});

test('A1 subsequent rebuild never reuses checkpoint invalidated by an earlier edit', async () => {
    const manager = new StateManager({ checkpointEvery: 1 });
    await manager.applyDelta({ objects: { sword: 'Anna' } }, { messageIndex: 0 });
    manager.markDirty(0);
    const history = [{ messageIndex: 0, at: '2026-01-01T00:00:00Z', delta: { objects: { sword: 'Bob' } } }];
    await manager.rebuild({ deltas: history }); manager.markDirty(1); await manager.rebuild({ deltas: history });
    assert.equal(manager.state.objects.sword, 'Bob');
});

test('G13 legacy bundle is backed up before migration; startup card checkpoint survives', async () => {
    const storage = new MemoryStorageAdapter(); const old = new StateManager({ storage });
    await old.applyDelta({ characters: { Anna: { trait: 'careful' } } }, { messageIndex: -1 });
    const bundle = await storage.getItem(`${old.prefix}:bundle`); delete bundle.historyVersion;
    await storage.setItem(`${old.prefix}:bundle`, bundle);
    const manager = new StateManager({ storage }); await manager.load(); await manager.selectBranch([]);
    assert.deepEqual(await storage.getItem(`${old.prefix}:backup-v1`), bundle);
    assert.equal(manager.state.characters.Anna.trait, 'careful');
});

test('G9 explicit player action can establish new canon instead of preserving a lost item', async t => {
    const { runtime, context } = await fixture(t);
    await runtime.stateManager.applyDelta({ objects: { sword: 'lost' } }, { messageIndex: -1, source: 'canon' });
    context.chat[0].mes = 'I draw the lost sword'; context.chat[1].mes = 'sword drawn';
    await runtime.processPost(1);
    assert.equal(runtime.stateManager.state.objects.sword, 'sword drawn');
    assert.equal(runtime.stateManager.pending.length, 0);
});

test('rerender of an older accepted message never discards later accepted state', async t => {
    const { runtime, context, calls } = await fixture(t);
    runtime.stateManager.checkpointEvery = 2;
    context.chat.push({ is_user: true, mes: 'Next', send_date: 'u2' }, { name: 'Anna', mes: 'goes home', send_date: 'a2', extra: {} });
    await runtime.processPost(3); const state = runtime.stateManager.snapshot();
    await runtime.processPost(1);
    assert.deepEqual(runtime.stateManager.snapshot(), state); assert.equal(calls.length, 2);
});

test('imported baseline and memories survive reconciliation', async t => {
    const { runtime } = await fixture(t);
    const state = runtime.stateManager.snapshot(); state.scene.location = 'imported';
    await runtime.stateManager.importData({ chatFingerprint: runtime.stateManager.chatFingerprint, state, memories: [{ id: 'imported', summary: 'A prior campaign fact' }] });
    await runtime.processPost(1);
    assert.equal(runtime.stateManager.state.scene.location, 'imported');
    assert.ok(runtime.memoryStore.items.some(m => m.id === 'imported'));
});

test('schema rejection preserves evidence but never applies state or memory', async () => {
    const manager = new StateManager({ validator: state => !state.objects.invalid });
    const status = await manager.recordTurn({ objects: { invalid: true } }, { idempotencyKey: 'bad', messageIndex: 1 }, { memories: [{ summary: 'bad' }] });
    assert.equal(status, 'rejected'); assert.equal(manager.state.revision, 0);
    assert.equal(manager.records.length, 1); assert.equal(manager.memories.length, 0);
    assert.equal(latestStatus(manager.decisions, manager.records[0].deltaId), 'rejected');
});

test('history bundle matches its published schema including separate decisions', async t => {
    const { runtime } = await fixture(t); await runtime.processPost(1);
    const { validateSchema } = await import('../src/utils/schema.js');
    const schema = JSON.parse(await readFile(new URL('../schemas/history.schema.json', import.meta.url), 'utf8'));
    const result = validateSchema(schema, runtime.stateManager.bundle());
    assert.deepEqual(result.errors, []);
    assert.equal(typeof runtime.stateManager.records[0].messageRef.generationId, 'string');
    assert.throws(() => { runtime.stateManager.records[0].delta.objects.sword = 'mutated'; }, TypeError);
});


test('typed POST operations and explicit author command integrate with branch replay', async t => {
    const { runtime, context } = await fixture(t);
    await runtime.processPost(1);
    await runtime.authorEdit({ reason: 'Define world entities', ops: [
        { op: 'create_entity', entity: { id: 'anna', name: 'Anna', type: 'character' } },
        { op: 'create_entity', entity: { id: 'sword', name: 'Sword', type: 'item' } },
        { op: 'set_owner', entity: 'sword', owner: 'anna' },
    ] });
    context.chat.push({ is_user: true, mes: 'Pick it up', send_date: 'u2' }, { name: 'Anna', mes: 'Takes sword', send_date: 'a2', extra: {} });
    runtime.director.run = async () => ({ audit: { valid: true, errors: [] }, confidence: 0.9, state_delta: {},
        ops: [{ op: 'move', entity: 'sword', to: { rel: 'holds', target: 'anna' } }],
        relationship_delta: [], knowledge_delta: [], thread_delta: {}, world_event_delta: {}, memory_candidates: [], sprite_decisions: {} });
    await runtime.processPost(3);
    assert.equal(runtime.stateManager.state.entities.sword.holder, 'anna');
    const before = runtime.stateManager.snapshot(); await runtime.loadChat(context); await runtime.processPost(3);
    assert.deepEqual(runtime.stateManager.snapshot(), before);
    context.chat[3].swipe_id = 1;
    runtime.director.run = async () => ({ audit: { valid: true, errors: [] }, confidence: 0.9, state_delta: {},
        ops: [{ op: 'define_type', key: 'injected', label: 'Injected' }],
        relationship_delta: [], knowledge_delta: [], thread_delta: {}, world_event_delta: {}, memory_candidates: [], sprite_decisions: {} });
    await runtime.processPost(3);
    assert.equal(runtime.stateManager.state.registry.entityTypes.injected, undefined);
    assert.equal(latestStatus(runtime.stateManager.decisions, runtime.stateManager.records.at(-1).deltaId), 'rejected');
    assert.equal(runtime.stateManager.pending.length, 1);
});


for (const auditMode of ['off','soft','strict']) test(`G3 PRE and packet exclude unavailable knowledge in ${auditMode} mode`, async t => {
    const { runtime, context } = await fixture(t);
    runtime.settings.auditMode = auditMode;
    await runtime.stateManager.applyDelta({ scene: { present: ['Anna','C'] }, knowledge: { secret: { truth: 'HIDDEN_SECRET', visibleTo: ['Anna'] }, public: { truth: 'OPEN_FACT', visibleTo: ['*'] } }, characters: { Anna: { privateThought: 'HIDDEN_SECRET' } } }, { messageIndex: -1 });
    await runtime.processPost(1);
    let captured;
    runtime.director.run = async (_role, payload) => {
        captured = payload;
        return { scene: payload.state.scene, must_preserve: Object.values(payload.state.knowledge).map(v => v.truth), character_states: {}, relevant_memories: ['INVENTED_MEMORY'], active_threads: [], scene_plan: {}, user_agency: [] };
    };
    const packet = await runtime.preparePacket([], 4096, 'normal');
    assert.ok(!JSON.stringify(captured).includes('HIDDEN_SECRET'));
    assert.ok(!packet.includes('HIDDEN_SECRET')); assert.ok(!packet.includes('INVENTED_MEMORY')); assert.ok(packet.includes('OPEN_FACT'));
    assert.deepEqual(captured.recent_messages, []);
});


test('semantic provider outage degrades to filtered Unicode memory and still builds PRE', async t => {
    const { runtime } = await fixture(t); await runtime.processPost(1);
    runtime.settings.embeddingSearch = true;
    runtime.memoryStore.items = [{ id: 'visible', text: 'public violin', summary: 'public violin', visibleTo: ['*'], status: 'current', ...runtime.stateManager.scope }];
    // reconcile restores its journal projection, so store a public memory in the imported baseline.
    const base = { messageIndex: -1, state: runtime.stateManager.checkpoints.find(p => p.messageIndex === -1)?.state || new StateManager().snapshot(), memories: runtime.memoryStore.items };
    await runtime.stateManager.commit({ checkpoints: [base] });
    runtime.director.run = async () => ({ scene: {}, must_preserve: [], character_states: {}, active_threads: [], scene_plan: {}, user_agency: [] });
    const packet = await runtime.preparePacket([], 4096, 'normal');
    assert.ok(packet); assert.equal(runtime.diagnostics.snapshot().retrievalMode, 'lexical_degraded');
    assert.ok(packet.includes('public violin'));
});


test('inherited scene membership cannot grant a new session participant private knowledge', async t => {
    const { runtime } = await fixture(t);
    await runtime.stateManager.applyDelta({ scene: { present: ['PreviousActor'] }, knowledge: { secret: { truth: 'OLD_PRIVATE_SECRET', visibleTo: ['PreviousActor'] } } }, { messageIndex: -1 });
    await runtime.processPost(1);
    let payload;
    runtime.director.run = async (_phase, value) => { payload = value; return { scene: {}, must_preserve: [], character_states: {}, active_threads: [], scene_plan: {}, user_agency: [] }; };
    await runtime.preparePacket([], 4096, 'normal');
    assert.ok(payload.knowledge_viewers.includes('Anna')); assert.ok(!JSON.stringify(payload).includes('OLD_PRIVATE_SECRET'));
    assert.ok(payload.state.scene.present.includes('PreviousActor'));
});
