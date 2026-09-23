import { filterSpriteCandidates, validateSpriteManifest } from './manifest.js';

function timeoutSignal(ms) {
    if (typeof AbortSignal?.timeout === 'function') return AbortSignal.timeout(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
}

export class SpriteManifestStore {
    constructor({ storage, fetchImpl = globalThis.fetch } = {}) {
        this.storage = storage;
        this.fetch = fetchImpl;
        this.entries = new Map();
    }

    async loadParticipant(participant) {
        const source = participant?.narrativeEngine?.spriteManifest;
        if (!source) return [];
        const cacheKey = `narrative-engine:sprites:${participant.id}`;
        try {
            let payload = source;
            if (typeof source === 'string') {
                const url = new URL(source, globalThis.location?.href || 'http://localhost/');
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Sprite manifest URL must use HTTP or HTTPS.');
                const response = await this.fetch(url, { signal: timeoutSignal(10000), credentials: 'same-origin' });
                if (!response.ok) throw new Error(`Sprite manifest returned HTTP ${response.status}.`);
                const text = await response.text();
                if (text.length > 2_000_000) throw new Error('Sprite manifest is too large.');
                payload = JSON.parse(text);
            }
            const list = Array.isArray(payload) ? payload : payload?.sprites;
            const result = validateSpriteManifest(list);
            if (!result.valid) throw new Error(result.errors.join(' '));
            this.entries.set(participant.name, result.entries);
            await this.storage?.setItem(cacheKey, result.entries);
            return result.entries;
        } catch (error) {
            const cached = await this.storage?.getItem(cacheKey);
            if (Array.isArray(cached)) {
                this.entries.set(participant.name, cached);
                return cached;
            }
            throw error;
        }
    }

    async loadParticipants(participants) {
        const results = await Promise.allSettled(participants.map((participant) => this.loadParticipant(participant)));
        return results;
    }

    candidatesFor(character, state = {}, limit = 20) {
        const characterState = state.characters?.[character] || {};
        const mood = Array.isArray(characterState.mood) ? characterState.mood[0] : characterState.mood;
        return filterSpriteCandidates(this.entries.get(character) || [], {
            character,
            costume: characterState.costume || characterState.clothing?.costume || '',
            expression: mood || characterState.expression || '',
            pose: characterState.pose || characterState.posture || '',
        }, limit);
    }
}
