import { textHash, cosine, lexicalTokens } from './semantic.js';
import { eligibleMemory, audienceMemories } from './policy.js';
import { retrieveMemories, hasMemoryQuery } from './retrieval.js';

export class VectorSearch {
    constructor(context, chatId, fetchImpl = globalThis.fetch) { Object.assign(this, { context, chatId, fetch: fetchImpl }); }
    async search(memories, query, options) {
        if (!hasMemoryQuery(query) || options.topK === 0 || options.tokenBudget === 0) return [];
        const candidates = audienceMemories(memories, options.policy).filter(m => eligibleMemory(m, options.policy));
        const similarities = {};
        const queryText = [query.message, query.location, ...(query.characters || []), ...(query.topics || [])].filter(Boolean).join(' ') || 'current scene';
        const queryHash = await textHash(queryText);
        let model = null;
        for (let start = 0; start < candidates.length; start += 24) {
            const batch = candidates.slice(start, start + 24);
            const texts = [queryText, ...batch.map(m => m.text || m.summary)];
            const response = await this.fetch('/api/plugins/narrative-engine/memory/embeddings', {
                method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', ...(this.context.getRequestHeaders?.() || {}) },
                body: JSON.stringify({ chatId: this.chatId, texts, tokens: texts.map(t => [...lexicalTokens(t)].join(' ')) }),
            });
            if (!response.ok) throw new Error(`Embeddings HTTP ${response.status}`);
            const result = await response.json();
            const hashes = await Promise.all(texts.map(textHash));
            const validScores = Array.isArray(result.scores) && result.scores.length === texts.length && result.scores.every(Number.isFinite);
            const validVectors = Array.isArray(result.vectors) && result.vectors.length === texts.length && result.vectors.every(v => Array.isArray(v) && v.length && v.every(Number.isFinite) && v.length === result.vectors[0].length);
            if (!result.model || (model && model !== result.model) || result.hashes?.[0] !== queryHash || result.hashes?.length !== texts.length
                || result.hashes.some((hash, i) => hash !== hashes[i]) || (!validScores && !validVectors)) throw new Error('Invalid vector batch');
            model = result.model;
            batch.forEach((m, i) => { similarities[m.id] = validScores ? result.scores[i + 1] : cosine(result.vectors[0], result.vectors[i + 1]); });
        }
        return retrieveMemories(candidates, query, { ...options, similarities });
    }
}
