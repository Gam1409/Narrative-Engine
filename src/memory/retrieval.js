import { eligibleMemory } from './policy.js';
import { lexicalTokens } from './semantic.js';

export function tokenize(value) {
    return lexicalTokens(value);
}

function intersectionScore(query, document) {
    if (!query.size) return 0;
    let matches = 0;
    for (const term of query) if (document.has(term)) matches += 1;
    return matches / Math.sqrt(query.size * Math.max(document.size, 1));
}

export function scoreMemory(memory, query = {}, now = Date.now(), options = {}) {
    const text = [memory.text || memory.summary, memory.scene, ...(memory.topics || []), ...(memory.entities || memory.characters || [])].join(' ');
    const queryText = [query.message, query.location, ...(query.topics || []), ...(query.characters || []), ...(query.threads || [])].join(' ');
    const lexical = intersectionScore(tokenize(queryText), tokenize(text));
    const importance = Math.max(0, Math.min(1, Number(memory.importance ?? 0.5)));
    const queryCharacters = tokenize((query.characters || []).join(' '));
    const character = intersectionScore(queryCharacters, tokenize((memory.entities || memory.characters || []).join(' ')));
    const location = query.location && memory.scene && String(query.location).toLowerCase() === String(memory.scene).toLowerCase() ? 1 : 0;
    const timestamp = Date.parse(memory.gameTime ? `${memory.gameTime.replace(/Z$/, '')}Z` : '');
    const ageDays = Number.isFinite(timestamp) ? Math.max(0, now - timestamp) / 86_400_000 : 365;
    const recency = 1 / (1 + ageDays / 30);
    const w = { semantic: 0.55, importance: 0.2, entities: 0.1, location: 0.1, recency: 0.05, old: 0.3, ...options.weights };
    const similarity = options.similarities?.[memory.id] ?? lexical;
    return similarity * w.semantic + importance * w.importance + character * w.entities + location * w.location + recency * w.recency - (memory.status === 'superseded' ? w.old : 0);
}

export function retrieveMemories(memories, query = {}, options = {}) {
    const topK = Math.max(0, Math.min(50, Number(options.topK ?? query.topK ?? 6)));
    const minScore = Number(options.minScore ?? 0);
    const now = options.now ?? Date.now();
    const ranked = (memories || [])
        .filter(memory => eligibleMemory(memory, options.policy))
        .map((memory) => ({ memory, score: scoreMemory(memory, query, now, options) }))
        .filter(({ score }) => score > minScore)
        .sort((a, b) => b.score - a.score || Number(b.memory.importance || 0) - Number(a.memory.importance || 0))
        .slice(0, topK)
        .map(({ memory, score }) => options.includeScores ? { ...memory, score } : memory);
    let remaining = Math.max(0, options.tokenBudget ?? 1200);
    return ranked.filter(memory => { const cost = Math.ceil(JSON.stringify(memory).length / 4); if (cost > remaining) return false; remaining -= cost; return true; });
}
