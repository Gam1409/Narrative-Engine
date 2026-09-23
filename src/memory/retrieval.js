const WORD = /[\p{L}\p{N}_-]+/gu;

export function tokenize(value) {
    return new Set(String(value || '').toLocaleLowerCase().match(WORD) || []);
}

function intersectionScore(query, document) {
    if (!query.size) return 0;
    let matches = 0;
    for (const term of query) if (document.has(term)) matches += 1;
    return matches / Math.sqrt(query.size * Math.max(document.size, 1));
}

export function scoreMemory(memory, query = {}, now = Date.now()) {
    const text = [memory.summary, memory.scene, ...(memory.topics || []), ...(memory.characters || [])].join(' ');
    const queryText = [query.message, query.location, ...(query.topics || []), ...(query.characters || []), ...(query.threads || [])].join(' ');
    const lexical = intersectionScore(tokenize(queryText), tokenize(text));
    const importance = Math.max(0, Math.min(1, Number(memory.importance ?? 0.5)));
    const queryCharacters = tokenize((query.characters || []).join(' '));
    const character = intersectionScore(queryCharacters, tokenize((memory.characters || []).join(' ')));
    const location = query.location && memory.scene && String(query.location).toLowerCase() === String(memory.scene).toLowerCase() ? 1 : 0;
    const timestamp = Date.parse(memory.timestamp || memory.createdAt || '');
    const ageDays = Number.isFinite(timestamp) ? Math.max(0, now - timestamp) / 86_400_000 : 365;
    const recency = 1 / (1 + ageDays / 30);
    return lexical * 0.55 + importance * 0.2 + character * 0.1 + location * 0.1 + recency * 0.05;
}

export function retrieveMemories(memories, query = {}, options = {}) {
    const topK = Math.max(0, Math.min(50, Number(options.topK ?? query.topK ?? 6)));
    const minScore = Number(options.minScore ?? 0);
    const now = options.now ?? Date.now();
    return (memories || [])
        .map((memory) => ({ memory, score: scoreMemory(memory, query, now) }))
        .filter(({ score }) => score > minScore)
        .sort((a, b) => b.score - a.score || Number(b.memory.importance || 0) - Number(a.memory.importance || 0))
        .slice(0, topK)
        .map(({ memory, score }) => options.includeScores ? { ...memory, score } : memory);
}
