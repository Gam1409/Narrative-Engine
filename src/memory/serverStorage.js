import { canonicalStringify } from '../utils/object.js';
import { MemoryStorageAdapter } from './storage.js';

function parseKey(key) {
    const match = String(key).match(/^narrative-engine:(ne-[a-f0-9]+):(.+)$/);
    if (!match) throw new Error('Unsupported Narrative Engine server storage key.');
    return { chatId: match[1], field: match[2] };
}

/** CAS writes and durable local mirror. Recovery is explicit; conflicts never overwrite remote data. */
export class ServerStorageAdapter {
    constructor(context, { fallback = new MemoryStorageAdapter(), fetchImpl = globalThis.fetch } = {}) {
        Object.assign(this, { context, fallback, fetch: fetchImpl });
        this.degraded = false; this.knownKeys = new Set(); this.queues = new Map();
    }
    cacheKey(key) { return `narrative-engine-cache:${key}`; }
    async request(key, method = 'GET', body) {
        const { chatId, field } = parseKey(key);
        const response = await this.fetch(`/api/plugins/narrative-engine/storage/${encodeURIComponent(chatId)}/${encodeURIComponent(field)}`, {
            method, headers: { 'Content-Type': 'application/json', ...(this.context.getRequestHeaders?.() || {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) {
            const error = new Error(`Narrative Engine storage HTTP ${response.status}`);
            error.status = response.status; throw error;
        }
        const result = await response.json();
        if (!Number.isInteger(result.revision) || result.revision < 0 || (method === 'GET' && !Object.hasOwn(result, 'value'))) throw new Error('Invalid storage response; update the server plugin');
        return result;
    }
    async cached(key) { return this.fallback.getItem(this.cacheKey(key)); }
    async getItem(key) {
        this.knownKeys.add(key);
        const cache = await this.cached(key);
        if (cache?.dirty) { this.degraded = true; return structuredClone(cache.value); }
        if (this.degraded) {
            if (!cache) throw new Error('Offline storage has no verified snapshot for this key');
            return structuredClone(cache.value);
        }
        try {
            const result = await this.request(key);
            await this.fallback.setItem(this.cacheKey(key), { ...result, dirty: false });
            return result.value;
        } catch (error) {
            this.lastError = error;
            if (error.status && error.status < 500) throw error;
            this.degraded = true;
            if (!cache) throw new Error('Server unavailable and no verified local snapshot; state was not reset');
            return structuredClone(cache.value);
        }
    }
    wireValue(value, previous) {
        if (value?.historyVersion !== 2 || !previous || previous.historyVersion !== 2) return value;
        const oldRecords = new Set((previous.records || []).map(r => r.deltaId));
        const oldDecisions = new Set((previous.decisions || []).map(r => r.decisionId));
        const recordIds = new Set((value.records || []).map(r => r.deltaId));
        // Imports reset the head and must use the complete representation.
        if ([...oldRecords].some(id => !recordIds.has(id))) return value;
        const wire = { ...value, __incremental: 2,
            records: (value.records || []).filter(r => !oldRecords.has(r.deltaId)),
            decisions: (value.decisions || []).filter(r => !oldDecisions.has(r.decisionId)),
            activeIds: (value.deltas || []).filter(r => recordIds.has(r.deltaId)).map(r => r.deltaId),
            baseDeltas: (value.deltas || []).filter(r => !recordIds.has(r.deltaId)),
        };
        delete wire.deltas; delete wire.memories;
        return wire;
    }
    async setItem(key, value) {
        this.knownKeys.add(key);
        const prior = this.queues.get(key) || Promise.resolve();
        const operation = prior.catch(() => {}).then(async () => {
            let cache = await this.cached(key);
            if (!cache) { await this.getItem(key); cache = await this.cached(key); }
            if (this.degraded || cache.dirty) {
                await this.fallback.setItem(this.cacheKey(key), { ...cache, value: structuredClone(value), dirty: true });
                this.degraded = true; return value;
            }
            let result;
            try { result = await this.request(key, 'POST', { value: this.wireValue(value, cache.value), expectedRevision: cache.revision }); }
            catch (error) {
                this.lastError = error;
                if (error.status && error.status < 500) throw error;
                // The server may have committed before a lost response. Keep the base revision;
                // recover() compares the remote value or raises a conflict, never blindly retries.
                await this.fallback.setItem(this.cacheKey(key), { ...cache, value: structuredClone(value), dirty: true });
                this.degraded = true; return value;
            }
            await this.fallback.setItem(this.cacheKey(key), { value: structuredClone(value), revision: result.revision, dirty: false });
            return value;
        });
        this.queues.set(key, operation);
        try { return await operation; } finally { if (this.queues.get(key) === operation) this.queues.delete(key); }
    }
    async recover() {
        const keys = (await this.fallback.keys()).filter(k => k.startsWith('narrative-engine-cache:')).map(k => k.slice('narrative-engine-cache:'.length));
        for (const key of keys) {
            const cache = await this.cached(key);
            if (!cache?.dirty) continue;
            const remote = await this.request(key);
            let revision = remote.revision;
            if (canonicalStringify(remote.value) !== canonicalStringify(cache.value)) {
                if (remote.revision !== cache.revision) throw new Error('Storage conflict: remote and offline branches differ; local data preserved');
                revision = (await this.request(key, 'POST', { value: cache.value, expectedRevision: cache.revision })).revision;
            }
            await this.fallback.setItem(this.cacheKey(key), { value: cache.value, revision, dirty: false });
        }
        this.degraded = false; this.lastError = null;
    }
    async removeItem(key) { await this.setItem(key, null); }
    async keys() {
        const cached = (await this.fallback.keys()).filter(k => k.startsWith('narrative-engine-cache:')).map(k => k.slice('narrative-engine-cache:'.length));
        const keys = [...new Set([...this.knownKeys, ...cached])];
        const present = await Promise.all(keys.map(async key => [key, await this.getItem(key)]));
        return present.filter(([, value]) => value !== null).map(([key]) => key);
    }
    async clear() { for (const key of await this.keys()) await this.removeItem(key); }
}
