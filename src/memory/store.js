import { clone } from '../utils/object.js';
import { retrieveMemories } from './retrieval.js';

export class EpisodicMemoryStore {
    constructor({ storage, key = 'narrative-engine:memories' } = {}) { this.storage = storage; this.key = key; this.items = []; }
    async load() { this.items = (await this.storage?.getItem(this.key)) || []; return clone(this.items); }
    async add(memory) {
        if (!memory?.id || !memory?.summary) throw new TypeError('Memory requires id and summary');
        const item = { importance: 0.5, topics: [], characters: [], createdAt: new Date().toISOString(), ...clone(memory) };
        this.items = [...this.items.filter((entry) => entry.id !== item.id), item];
        await this.storage?.setItem(this.key, this.items);
        return clone(item);
    }
    search(query, options) { return retrieveMemories(this.items, query, options); }
    async remove(id) { this.items = this.items.filter((item) => item.id !== id); await this.storage?.setItem(this.key, this.items); }
}
