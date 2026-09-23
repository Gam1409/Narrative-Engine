import { clone } from '../utils/object.js';

export class MemoryStorageAdapter {
    #values = new Map();
    async getItem(key) { return this.#values.has(key) ? clone(this.#values.get(key)) : null; }
    async setItem(key, value) { this.#values.set(key, clone(value)); return value; }
    async removeItem(key) { this.#values.delete(key); }
    async clear() { this.#values.clear(); }
    async keys() { return [...this.#values.keys()]; }
}

/** Accepts an injected localforage instance and safely falls back in private mode. */
export class BrowserStorageAdapter {
    constructor(localforage, options = {}) {
        this.fallback = options.fallback || new MemoryStorageAdapter();
        this.backend = localforage?.createInstance
            ? localforage.createInstance({ name: 'narrative-engine', storeName: 'state', ...(options.config || {}) })
            : localforage;
        this.degraded = !this.backend;
    }

    async #call(method, ...args) {
        if (!this.degraded && typeof this.backend?.[method] === 'function') {
            try { return await this.backend[method](...args); }
            catch (error) { this.degraded = true; this.lastError = error; }
        }
        return this.fallback[method](...args);
    }
    getItem(key) { return this.#call('getItem', key); }
    setItem(key, value) { return this.#call('setItem', key, value); }
    removeItem(key) { return this.#call('removeItem', key); }
    clear() { return this.#call('clear'); }
    keys() { return this.#call('keys'); }
}

export function createStorageAdapter(localforage = globalThis.localforage, options) {
    return new BrowserStorageAdapter(localforage, options);
}
