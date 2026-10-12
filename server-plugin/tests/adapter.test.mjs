import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ServerStorageAdapter } from '../../src/memory/serverStorage.js';
import { MemoryStorageAdapter, BrowserStorageAdapter } from '../../src/memory/storage.js';
import { StateManager } from '../../src/state/manager.js';
const require = createRequire(new URL('../package.json', import.meta.url));
const { Database } = require('./lib/database.js');
function server(t, fallback = new MemoryStorageAdapter()) {
    const db = new Database({ storageRoot: process.cwd(), databasePath: ':memory:' }); t.after(() => db.close());
    const transport = { offline: false, loseReply: false, payloads: [] };
    const fetchImpl = async (url, options) => {
        if (transport.offline) throw new Error('offline');
        const [chat, field] = url.split('/').slice(-2).map(decodeURIComponent);
        let result;
        try {
            if (options.method === 'POST') {
                const body = JSON.parse(options.body); transport.payloads.push(body);
                result = db.writeField(chat, field, body.value, body.expectedRevision);
                if (transport.loseReply) { transport.loseReply = false; throw new Error('lost response'); }
            } else result = db.readField(chat, field);
        } catch (error) {
            if (!error.status) throw error;
            return { ok: false, status: error.status, json: async () => ({ error: error.message }) };
        }
        return { ok: true, json: async () => result };
    };
    return { db, transport, fetchImpl, storage: new ServerStorageAdapter({}, { fallback, fetchImpl }) };
}

for (const mode of ['browser', 'server']) {
    test(`G19 ${mode} storage contract: isolation, reload, copy semantics, remove and clear`, async t => {
        const backend = new MemoryStorageAdapter();
        const fixture = mode === 'server' ? server(t, backend) : null;
        const create = () => fixture ? new ServerStorageAdapter({}, { fallback: backend, fetchImpl: fixture.fetchImpl }) : new BrowserStorageAdapter(backend);
        let storage = create();
        const a = 'narrative-engine:ne-a1:bundle', b = 'narrative-engine:ne-b2:bundle';
        assert.equal(await storage.getItem(a), null);
        await Promise.all([storage.setItem(a, { scene: 'hall' }), storage.setItem(b, { scene: 'home' })]);
        const read = await storage.getItem(a); read.scene = 'mutated'; storage = create();
        assert.deepEqual(await storage.getItem(a), { scene: 'hall' }); assert.deepEqual(await storage.getItem(b), { scene: 'home' });
        assert.deepEqual((await storage.keys()).sort(), [a,b]);
        await storage.removeItem(a); assert.equal(await storage.getItem(a), null);
        await storage.clear(); assert.deepEqual(await storage.keys(), []);
    });
}

test('C4 normalized SQLite writes append journal rows without snapshot multiplication', async t => {
    const { storage, db, transport } = server(t); const manager = new StateManager({ storage, chatFingerprint: 'ne-a1', checkpointEvery: 2 });
    await manager.load();
    for (let i = 0; i < 100; i++) await manager.recordTurn({ time_advance_minutes: 1 }, { idempotencyKey: `turn-${i}`, messageIndex: i }, { memories: [{ summary: `episode-${i}` }] });
    assert.equal(db.db.prepare('SELECT count(*) n FROM turn_records').get().n, 100);
    assert.equal(db.db.prepare('SELECT count(*) n FROM turn_decisions').get().n, 100);
    assert.equal(db.db.prepare('SELECT count(*) n FROM turn_memories').get().n, 100);
    assert.equal(db.db.prepare('SELECT count(*) n FROM state_snapshots').get().n, 0);
    assert.equal(db.db.prepare('SELECT count(*) n FROM turn_checkpoints').get().n, 20);
    const post = transport.payloads.at(-1); assert.equal(post.value.records.length, 1); assert.equal(post.value.decisions.length, 1);
    const reloaded = new StateManager({ storage, chatFingerprint: 'ne-a1' }); await reloaded.load();
    assert.equal(reloaded.records.length, 100); assert.equal(reloaded.memories.length, 100);
    assert.equal(reloaded.state.timeline.elapsedMinutes, 100);
});

test('last verified snapshot survives outage and offline changes recover after reload', async t => {
    const fallback = new MemoryStorageAdapter(), f = server(t, fallback), key = 'narrative-engine:ne-a1:bundle';
    await f.storage.setItem(key, { revision: 9 }); f.transport.offline = true;
    assert.deepEqual(await f.storage.getItem(key), { revision: 9 });
    await f.storage.setItem(key, { revision: 10 });
    const restarted = new ServerStorageAdapter({}, { fallback, fetchImpl: f.fetchImpl });
    assert.deepEqual(await restarted.getItem(key), { revision: 10 });
    f.transport.offline = false; await restarted.recover();
    assert.deepEqual(f.db.readField('ne-a1', 'bundle').value, { revision: 10 });
});

test('uncached offline key fails closed instead of resetting the world', async t => {
    const f = server(t); f.transport.offline = true;
    await assert.rejects(f.storage.getItem('narrative-engine:ne-a1:bundle'), /no verified local snapshot/);
});

test('lost POST acknowledgement is recovered without duplicating writes', async t => {
    const f = server(t), key = 'narrative-engine:ne-a1:bundle';
    await f.storage.getItem(key); f.transport.loseReply = true;
    await f.storage.setItem(key, { revision: 1 }); assert.equal(f.storage.degraded, true);
    await f.storage.recover(); assert.equal(f.db.readField('ne-a1', 'bundle').revision, 1);
});

test('offline conflict preserves both versions and never overwrites remote state', async t => {
    const f = server(t), key = 'narrative-engine:ne-a1:bundle';
    await f.storage.setItem(key, { x: 1 }); f.transport.offline = true;
    await f.storage.getItem(key); await f.storage.setItem(key, { x: 2 });
    f.db.writeField('ne-a1', 'bundle', { x: 3 }, 1); f.transport.offline = false;
    await assert.rejects(f.storage.recover(), /conflict/);
    assert.deepEqual(await f.storage.getItem(key), { x: 2 });
    assert.deepEqual(f.db.readField('ne-a1', 'bundle').value, { x: 3 });
});

test('CAS conflict rolls back in-memory transaction instead of entering fallback', async t => {
    const f = server(t), manager = new StateManager({ storage: f.storage, chatFingerprint: 'ne-a1' });
    await manager.load(); f.db.writeField('ne-a1', 'bundle', { otherWriter: true }, 0);
    await assert.rejects(manager.recordTurn({}, { idempotencyKey: 'x', messageIndex: 1 }), /409/);
    assert.equal(manager.records.length, 0); assert.equal(f.storage.degraded, false);
});

test('lost acknowledgement of normalized history reconciles by value, not JSON key order', async t => {
    const f = server(t), manager = new StateManager({ storage: f.storage, chatFingerprint: 'ne-a1' });
    await manager.load();
    await manager.recordTurn({ time_advance_minutes: 1 }, { idempotencyKey: 'one', messageIndex: 0 });
    f.transport.loseReply = true;
    await manager.recordTurn({ time_advance_minutes: 1 }, { idempotencyKey: 'two', messageIndex: 1 });
    assert.equal(f.storage.degraded, true); await f.storage.recover();
    assert.equal(f.db.readField('ne-a1', 'bundle').revision, 2);
    assert.equal(f.db.readField('ne-a1', 'bundle').value.records.length, 2);
});


test('G1/G2 author and typed turn journal round-trip through normalized SQLite', async t => {
    const { storage, db } = server(t); let manager = new StateManager({ storage, chatFingerprint: 'ne-a1', checkpointEvery: 2 });
    await manager.load();
    await manager.authorEdit([
        ...['alice', 'bob'].map(id => ({ op: 'create_entity', entity: { id, name: id, type: 'character' } })),
        { op: 'create_entity', entity: { id: 'phone', name: 'Phone', type: 'item' } },
        { op: 'set_owner', entity: 'phone', owner: 'alice' },
    ], 'Initial cast');
    const ref = { idempotencyKey: 'take', messageIndex: 1, messageId: 'take', swipeId: 0 };
    await manager.recordTurn({ ops: [{ op: 'move', entity: 'phone', to: { rel: 'holds', target: 'bob' } }] }, ref);
    const snapshot = manager.snapshot();
    manager = new StateManager({ storage, chatFingerprint: 'ne-a1' }); await manager.load(); await manager.selectBranch([ref]);
    assert.deepEqual(manager.snapshot(), snapshot); assert.equal(manager.state.entities.phone.owner, 'alice');
    assert.equal(manager.state.entities.phone.holder, 'bob');
    assert.equal(db.db.prepare('SELECT count(*) n FROM turn_records').get().n, 2);
    await manager.selectBranch([]); assert.equal(manager.state.entities.phone.holder, null);
    await manager.selectBranch([ref]); assert.deepEqual(manager.snapshot(), snapshot);
});


test('G18 SQLite keeps memory rows immutable while projecting superseded status and rollback', async t => {
    const { storage, db } = server(t); let manager = new StateManager({ storage, chatFingerprint: 'ne-a1' }); await manager.load();
    const a = { idempotencyKey: 'a', messageIndex: 1 }, b = { idempotencyKey: 'b', messageIndex: 3 };
    const mem = summary => ({ summary, text: summary, visibleTo: ['*'], status: 'current', supersededBy: null, factKey: 'owner' });
    await manager.recordTurn({}, a, { memories: [mem('old')] });
    const original = db.db.prepare('SELECT data_json FROM turn_memories').get().data_json;
    await manager.recordTurn({}, b, { memories: [mem('new')] });
    assert.equal(manager.memories[0].status, 'superseded');
    assert.equal(db.db.prepare('SELECT data_json FROM turn_memories ORDER BY rowid LIMIT 1').get().data_json, original);
    manager = new StateManager({ storage, chatFingerprint: 'ne-a1' }); await manager.load();
    assert.equal(manager.memories[0].status, 'superseded'); await manager.selectBranch([a]);
    assert.equal(manager.memories[0].status, 'current'); await manager.selectBranch([a,b]); assert.equal(manager.memories[0].status, 'superseded');
});


test('legacy immutable memory rows accept additive projection metadata without rewriting originals', async t => {
    const { storage, db } = server(t); let manager = new StateManager({ storage, chatFingerprint: 'ne-a1' });
    const ref = { idempotencyKey: 'old', messageIndex: 1 }; await manager.recordTurn({}, ref, { memories: [{ summary: 'old memory' }] });
    const row = db.db.prepare('SELECT id,data_json FROM turn_memories').get();
    const legacy = JSON.parse(row.data_json); delete legacy.memoryId; delete legacy.campaignId; delete legacy.sessionId;
    db.db.prepare('UPDATE turn_memories SET data_json=? WHERE id=?').run(JSON.stringify(legacy), row.id);
    const headRow = db.db.prepare("SELECT value_json FROM storage_fields WHERE field='bundle'").get();
    const head = JSON.parse(headRow.value_json); delete head.memoryStatuses;
    db.db.prepare("UPDATE storage_fields SET value_json=? WHERE field='bundle'").run(JSON.stringify(head));
    manager = new StateManager({ storage, chatFingerprint: 'ne-a1' }); await manager.load(); await manager.selectBranch([ref]);
    assert.equal(manager.memories[0].memoryId, row.id);
    assert.deepEqual(JSON.parse(db.db.prepare('SELECT data_json FROM turn_memories WHERE id=?').get(row.id).data_json), legacy);
});
