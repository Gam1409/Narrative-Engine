import { MemoryStorageAdapter } from './storage.js';

function parseKey(key) {
    const match = String(key).match(/^narrative-engine:(ne-[a-f0-9]+):(.+)$/);
    if (!match) throw new Error('Unsupported Narrative Engine server storage key.');
    return { chatId: match[1], field: match[2] };
}

/** SQLite-backed storage through the optional server plugin, with local fallback. */
export class ServerStorageAdapter {
    constructor(context, { fallback = new MemoryStorageAdapter(), fetchImpl = globalThis.fetch } = {}) {
        this.context = context;
        this.fallback = fallback;
        this.fetch = fetchImpl;
        this.degraded = false;
        this.knownKeys = new Set();
        this.queues = new Map();
    }

    async request(chatId, method = 'GET', body) {
        const response = await this.fetch(`/api/plugins/narrative-engine/state/${encodeURIComponent(chatId)}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(this.context.getRequestHeaders?.() || {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Narrative Engine server storage failed (HTTP ${response.status}).`);
        return response.json();
    }

    async getEnvelope(chatId) {
        const result = await this.request(chatId);
        const state = result?.state;
        return state?.__narrativeEngineStore === 1 && state.values && typeof state.values === 'object'
            ? state
            : { __narrativeEngineStore: 1, values: {} };
    }

    async getItem(key) {
        this.knownKeys.add(key);
        if (this.degraded) return this.fallback.getItem(key);
        try {
            const { chatId, field } = parseKey(key);
            const envelope = await this.getEnvelope(chatId);
            return envelope.values[field] ?? null;
        } catch (error) {
            this.degraded = true;
            this.lastError = error;
            return this.fallback.getItem(key);
        }
    }

    async setItem(key, value) {
        this.knownKeys.add(key);
        if (this.degraded) return this.fallback.setItem(key, value);
        const { chatId, field } = parseKey(key);
        const prior = this.queues.get(chatId) || Promise.resolve();
        const operation = prior.then(async () => {
            try {
                const envelope = await this.getEnvelope(chatId);
                envelope.values[field] = structuredClone(value);
                await this.request(chatId, 'POST', { state: envelope });
                return value;
            } catch (error) {
                this.degraded = true;
                this.lastError = error;
                return this.fallback.setItem(key, value);
            }
        });
        const queued = operation.finally(() => {
            if (this.queues.get(chatId) === queued) this.queues.delete(chatId);
        });
        this.queues.set(chatId, queued);
        return operation;
    }

    async removeItem(key) {
        this.knownKeys.delete(key);
        if (this.degraded) return this.fallback.removeItem(key);
        const { chatId, field } = parseKey(key);
        const envelope = await this.getEnvelope(chatId);
        delete envelope.values[field];
        await this.request(chatId, 'POST', { state: envelope });
    }

    async keys() { return [...this.knownKeys]; }
    async clear() { await Promise.all([...this.knownKeys].map((key) => this.removeItem(key))); }
}
