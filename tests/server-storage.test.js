import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerStorageAdapter } from '../src/memory/serverStorage.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';

test('server storage persists independent fields in one remote envelope', async () => {
    let state = null;
    const fetchImpl = async (_url, options = {}) => {
        if (options.method === 'POST') state = JSON.parse(options.body).state;
        return { ok: true, json: async () => options.method === 'POST' ? { ok: true } : { state } };
    };
    const storage = new ServerStorageAdapter({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'test' }) }, { fetchImpl });
    await storage.setItem('narrative-engine:ne-a1:bundle', { revision: 1 });
    await storage.setItem('narrative-engine:ne-a1:memories', [{ id: 'm1' }]);
    assert.deepEqual(await storage.getItem('narrative-engine:ne-a1:bundle'), { revision: 1 });
    assert.deepEqual(await storage.getItem('narrative-engine:ne-a1:memories'), [{ id: 'm1' }]);
});

test('server storage degrades to local fallback when plugin is unavailable', async () => {
    const fallback = new MemoryStorageAdapter();
    const storage = new ServerStorageAdapter({}, { fallback, fetchImpl: async () => { throw new Error('offline'); } });
    await storage.setItem('narrative-engine:ne-b2:bundle', { revision: 2 });
    assert.equal(storage.degraded, true);
    assert.deepEqual(await storage.getItem('narrative-engine:ne-b2:bundle'), { revision: 2 });
});
