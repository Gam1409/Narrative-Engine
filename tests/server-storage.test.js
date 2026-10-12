import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerStorageAdapter } from '../src/memory/serverStorage.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';

function remote() {
    const fields = new Map();
    return async (url, options) => {
        const current = fields.get(url) || { value: null, revision: 0 };
        if (options.method === 'POST') {
            const body = JSON.parse(options.body);
            if (body.expectedRevision !== current.revision) return { ok: false, status: 409 };
            fields.set(url, { value: body.value, revision: current.revision + 1 });
        }
        return { ok: true, json: async () => structuredClone(fields.get(url) || current) };
    };
}

test('field storage isolates keys and survives adapter reload', async () => {
    const fallback = new MemoryStorageAdapter(), fetchImpl = remote();
    let storage = new ServerStorageAdapter({}, { fallback, fetchImpl });
    await storage.setItem('narrative-engine:ne-a1:bundle', { revision: 1 });
    await storage.setItem('narrative-engine:ne-a1:memories', [{ id: 'm1' }]);
    storage = new ServerStorageAdapter({}, { fallback, fetchImpl });
    assert.deepEqual(await storage.getItem('narrative-engine:ne-a1:bundle'), { revision: 1 });
    assert.deepEqual(await storage.getItem('narrative-engine:ne-a1:memories'), [{ id: 'm1' }]);
});

test('offline server uses a verified snapshot and refuses an uncached key', async () => {
    const storage = new ServerStorageAdapter({}, { fetchImpl: remote() });
    await storage.setItem('narrative-engine:ne-a1:bundle', { revision: 1 });
    storage.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await storage.getItem('narrative-engine:ne-a1:bundle'), { revision: 1 });
    assert.equal(storage.degraded, true);
    await assert.rejects(storage.getItem('narrative-engine:ne-b2:bundle'), /no verified snapshot/);
});
