import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyStateDelta, createInitialState } from '../src/state/model.js';
import { StateManager } from '../src/state/manager.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';
import { validateWorld } from '../src/state/entities.js';
import { deepFreeze } from '../src/utils/object.js';
import { latestStatus } from '../src/state/history.js';
import { validateSchema } from '../src/utils/schema.js';

const metadata = { source: 'author', at: '2026-10-12T10:00:00Z', deltaId: 'setup' };
const create = (id, type = 'item') => ({ op: 'create_entity', entity: { id, name: id, type, campaignId: 'campaign' } });
const setup = [create('alice', 'character'), create('bob', 'character'), create('table'), create('bag', 'container'), create('phone'),
    { op: 'set_owner', entity: 'phone', owner: 'alice' }, { op: 'move', entity: 'phone', to: { rel: 'on', target: 'table' } }];
const apply = (state, ops, meta = metadata) => applyStateDelta(state, { ops }, meta);
const world = () => apply(createInitialState(), setup);
const param = (key = 'energy') => ({ op: 'define_parameter', definition: { key, label: 'Energy', type: 'number', scope: ['character'], default: 5, validation: { min: 0, max: 10 } } });
const ref = (key, index = 1) => ({ idempotencyKey: key, messageIndex: index, messageId: key, swipeId: 0 });

test('G1 taking an item replaces its table position, G2 transfer preserves ownership', () => {
    const initial = world();
    const held = apply(initial, [{ op: 'move', entity: 'phone', to: { rel: 'holds', target: 'alice' } }]);
    assert.equal(held.entities.phone.holder, 'alice'); assert.equal(held.entities.phone.location, null);
    const transferred = apply(held, [{ op: 'move', entity: 'phone', to: { rel: 'holds', target: 'bob' } }]);
    assert.equal(transferred.entities.phone.holder, 'bob'); assert.equal(transferred.entities.phone.owner, 'alice');
    const stored = apply(transferred, [{ op: 'move', entity: 'phone', to: { rel: 'inside', target: 'bag' } }]);
    assert.equal(stored.entities.phone.container, 'bag'); assert.equal(stored.entities.phone.holder, null);
    assert.equal(initial.entities.phone.location, 'table');
});

test('movement validates references, holder types, cycles and rejects bypass relations atomically', () => {
    const initial = world(); const snapshot = structuredClone(initial);
    for (const ops of [
        [{ op: 'move', entity: 'phone', to: { rel: 'holds', target: 'missing' } }],
        [{ op: 'move', entity: 'phone', to: { rel: 'holds', target: 'table' } }],
        [{ op: 'move', entity: 'phone', to: { rel: 'inside', target: 'bag' } }, { op: 'move', entity: 'bag', to: { rel: 'inside', target: 'phone' } }],
        [{ op: 'link', entity: 'phone', rel: 'on', target: 'table' }],
        [{ op: 'move', entity: 'phone', to: { rel: 'near', target: 'table' } }],
    ]) assert.throws(() => apply(initial, ops));
    assert.deepEqual(initial, snapshot);
});

test('parameter rename migrates values, keeps aliases, and allows historical keys', () => {
    let state = apply(world(), [param()]);
    const old = structuredClone(state);
    state = apply(state, [{ op: 'rename_parameter', key: 'energy', newKey: 'stamina', label: 'Stamina' }]);
    assert.equal(state.entities.alice.params.stamina, 5); assert.equal(state.entities.alice.params.energy, undefined);
    assert.deepEqual(state.registry.parameters.stamina.aliases, ['energy']);
    state = apply(state, [{ op: 'adjust', entity: 'alice', key: 'energy', amount: -2 }], { ...metadata, source: 'message:1' });
    assert.equal(state.entities.alice.params.stamina, 3); assert.equal(old.entities.alice.params.energy, 5);
    assert.equal(state.registry.schemaVersion, 3);
});

test('registry detects normalized duplicate aliases and rejects incompatible schema changes', () => {
    const state = apply(world(), [param()]);
    assert.throws(() => apply(state, [{ op: 'define_parameter', definition: { ...param('other').definition, label: 'Other', aliases: ['  ENERGY '] } }]), /already exists/);
    assert.throws(() => apply(state, [{ op: 'update_parameter', key: 'energy', patch: { type: 'boolean' } }]), /boolean/);
    assert.throws(() => apply(state, [{ op: 'update_parameter', key: 'energy', patch: { validation: { max: 2 } } }]), /range/);
    assert.equal(state.registry.parameters.energy.type, 'number');
    assert.throws(() => apply(state, [{ op: 'set', entity: 'phone', key: 'energy', value: 1 }]), /scope/);
    assert.throws(() => apply(state, [{ op: 'adjust', entity: 'alice', key: 'energy', amount: 20 }]), /range/);
});

test('all parameter types validate values including nested objects and lists', () => {
    const specs = [
        ['text', { type: 'string' }, 'ok', 3], ['flag', { type: 'boolean' }, true, 1],
        ['mood', { type: 'enum', values: ['calm', 'angry'] }, 'calm', 'unknown'],
        ['birthday', { type: 'date' }, '2024-02-29', '2025-02-29'],
        ['wake', { type: 'gameTime' }, '08:30', '25:00'],
        ['friend', { type: 'entityRef' }, 'bob', 'missing'],
        ['details', { type: 'object', fields: { note: { type: 'string', validation: { required: true } } } }, { note: 'ok' }, {}],
        ['tags', { type: 'list', items: { type: 'string' }, validation: { maxItems: 2 } }, ['a'], [3]],
    ];
    for (const [key, def, valid, invalid] of specs) {
        const state = apply(world(), [{ op: 'define_parameter', definition: { key, label: key, scope: ['character'], ...def } }]);
        assert.doesNotThrow(() => apply(state, [{ op: 'set', entity: 'alice', key, value: valid }]));
        assert.throws(() => apply(state, [{ op: 'set', entity: 'alice', key, value: invalid }]));
    }
});

test('used parameter deletion archives it, unused deletion removes it, custom types work', () => {
    let state = apply(world(), [param(), { op: 'define_type', key: 'vehicle', label: 'Vehicle' }, create('car', 'vehicle')]);
    state = apply(state, [{ op: 'delete_parameter', key: 'energy' }]);
    assert.equal(state.registry.parameters.energy.status, 'archived'); assert.equal(state.entities.alice.params.energy, 5);
    assert.throws(() => apply(state, [{ op: 'set', entity: 'alice', key: 'energy', value: 3 }]), /archived/);
    state = apply(state, [{ op: 'define_parameter', definition: { key: 'unused', label: 'Unused', type: 'string', scope: ['vehicle'] } }, { op: 'delete_parameter', key: 'unused' }]);
    assert.equal(state.registry.parameters.unused, undefined); assert.equal(state.entities.car.type, 'vehicle');
});

test('Director cannot administer schema, overwrite registry, or execute unknown operations', () => {
    const state = world();
    assert.throws(() => apply(state, [param()], { ...metadata, source: 'message:1' }), /author/);
    assert.throws(() => applyStateDelta(state, { registry: {} }), /typed/);
    assert.throws(() => applyStateDelta(state, { objects: { phone: { holder: 'bob', location: 'table' } } }), /typed/);
    assert.throws(() => apply(state, [{ op: 'execute', command: 'anything' }]), /Unsupported/);
    assert.throws(() => apply(state, [JSON.parse('{"op":"set","__proto__":{"polluted":true}}')]), /Unsafe/);
    assert.throws(() => applyStateDelta(state, { revision: 99 }), /Unsupported/);
    assert.equal({}.polluted, undefined);
});

test('author journal survives reload/replay and follows its anchored branch', async () => {
    const storage = new MemoryStorageAdapter(); let manager = new StateManager({ storage, checkpointEvery: 2 });
    await manager.authorEdit(setup, 'Initial cast');
    const first = ref('turn-one'); await manager.recordTurn({ ops: [{ op: 'move', entity: 'phone', to: { rel: 'holds', target: 'alice' } }] }, first);
    await manager.authorEdit([param()], 'Add energy');
    await manager.authorEdit([{ op: 'rename_parameter', key: 'energy', newKey: 'stamina' }], 'Rename energy');
    const second = ref('turn-two', 3); await manager.recordTurn({ ops: [{ op: 'adjust', entity: 'alice', key: 'energy', amount: -1 }] }, second);
    const snapshot = manager.snapshot(); const records = structuredClone(manager.records);
    manager = new StateManager({ storage }); await manager.load(); await manager.selectBranch([first, second]);
    assert.deepEqual(manager.snapshot(), snapshot); assert.deepEqual(manager.records, records);
    await manager.selectBranch([]); assert.equal(manager.state.entities.phone.location, 'table'); assert.equal(manager.state.registry.parameters.stamina, undefined);
    await manager.selectBranch([first, second]); assert.deepEqual(manager.snapshot(), snapshot);
    assert.equal((await storage.keys()).filter(k => k.includes('backup-author-')).length, 3);
    const schema = JSON.parse(readFileSync(new URL('../schemas/history.schema.json', import.meta.url)));
    assert.equal(validateSchema(schema, manager.bundle()).valid, true);
});

test('author correction invalidates cached continuations and can fix schema before pending retry', async () => {
    const manager = new StateManager(); await manager.authorEdit(setup, 'Initial cast');
    const first = ref('first'), second = ref('second', 3);
    await manager.recordTurn({}, first); await manager.recordTurn({}, second);
    await manager.selectBranch([first]); await manager.authorEdit([{ op: 'set_owner', entity: 'phone', owner: 'bob' }], 'Correct owner');
    assert.equal(manager.findAccepted(second.idempotencyKey), undefined);
    await manager.selectBranch([first, second]);
    await manager.authorEdit([param()], 'Supply missing definition before retry');
    assert.equal(manager.pending.length, 1);
    assert.equal(manager.state.registry.parameters.energy.type, 'number');
    await manager.recordTurn({ ops: [{ op: 'adjust', entity: 'alice', key: 'energy', amount: -1 }] }, second);
    await manager.selectBranch([first, second]);
    assert.equal(manager.pending.length, 0);
    assert.equal(manager.state.entities.alice.params.energy, 4);
    assert.equal(manager.state.entities.phone.owner, 'bob');
});

test('invalid operation batch is recorded as rejected with no state or memory effect', async () => {
    const manager = new StateManager(); await manager.authorEdit(setup, 'Initial cast'); const before = manager.snapshot();
    const status = await manager.recordTurn({ ops: [{ op: 'move', entity: 'phone', to: { rel: 'holds', target: 'bob' } }, { op: 'set_owner', entity: 'phone', owner: 'missing' }] }, ref('bad'), { memories: [{ summary: 'wrong' }] });
    assert.equal(status, 'rejected'); assert.deepEqual(manager.snapshot(), before); assert.deepEqual(manager.memories, []);
    assert.equal(latestStatus(manager.decisions, manager.records.at(-1).deltaId), 'rejected');
});

test('G13 schema-v1 save is backed up before migration and old deltas remain replayable', async () => {
    const storage = new MemoryStorageAdapter(); const old = { schemaVersion: 1, revision: 0, scene: { location: 'old room' }, characters: { Alice: { mood: 'calm' } }, objects: { phone: 'table' }, timeline: { scheduled: [] }, relationships: {}, knowledge: {}, threads: {} };
    const bundle = { historyVersion: 2, state: old, records: [], decisions: [], checkpoints: [{ messageIndex: -1, state: old }], deltas: [] };
    await storage.setItem('narrative-engine:default:bundle', bundle);
    const manager = new StateManager({ storage }); await manager.load(); await manager.selectBranch([]);
    assert.equal(manager.state.schemaVersion, 2); assert.deepEqual(manager.state.objects, old.objects);
    assert.deepEqual(await storage.getItem(`${manager.prefix}:backup-state-v1`), bundle);
    await manager.recordTurn({ objects: { phone: 'Alice' } }, ref('old-delta'));
    await manager.selectBranch([ref('old-delta')]); assert.equal(manager.state.objects.phone, 'Alice');
    assert.equal(bundle.state.schemaVersion, 1);
});

test('failed migration and failed author persistence leave source and state unchanged', async () => {
    const storage = new MemoryStorageAdapter(); const manager = new StateManager({ storage });
    const original = { state: { schemaVersion: 999 }, historyVersion: 2 };
    await storage.setItem(`${manager.prefix}:bundle`, original);
    await assert.rejects(manager.load(), /newer/); assert.deepEqual(await storage.getItem(`${manager.prefix}:bundle`), original);
    const before = manager.snapshot();
    storage.setItem = async () => { throw new Error('disk full'); };
    await assert.rejects(manager.authorEdit(setup, 'Setup'), /disk full/); assert.deepEqual(manager.snapshot(), before); assert.equal(manager.records.length, 0);
});

test('physical validation accepts frozen entities without mutation and rejects conflicting derived fields',()=>{
 const state=deepFreeze(world()),before=structuredClone(state);
 validateWorld(state);assert.deepEqual(state,before);
 const invalid=structuredClone(state);invalid.entities.phone.holder='alice';
 assert.throws(()=>validateWorld(invalid),/Conflicting physical field/);
});
