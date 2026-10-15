import { memoryAvailability, supportingEpisodes } from './availability.js';
import { projectMemoryReferences, memoryAdjacency } from './links.js';
import { personalMemoryScore } from './personal.js';
import { eligibleMemory, audienceMemories } from './policy.js';
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
    const personal = options.policy?.viewers?.length === 1 && options.policy.viewers[0] === options.personal?.characterId
        ? options.personal : null;
    return personalMemoryScore(memory, personal) + similarity * w.semantic + importance * w.importance + character * w.entities + location * w.location + recency * w.recency - (memory.status === 'superseded' ? w.old : 0);
}

const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const strings = value => Array.isArray(value) ? value : [];

// Common function words are not a topical cue. Other languages retain Unicode fallback.
const FUNCTION_WORDS = new Set(('a an the and or but is are was were be been being to of in on at for from with as by it this that these those i you he she we they me my your his her our their ' +
    'и а но или в во на с со к ко у о об от до по из за для не ни это этот эта эти то тот та те я ты он она оно мы вы они мой твой его её их наш ваш').split(' '));
const relevanceTokens = value => tokenize((String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])
    .filter(word => !FUNCTION_WORDS.has(word)).join(' '));

export function hasMemoryQuery(query = {}) {
    return Boolean(relevanceTokens([query.message, ...strings(query.topics), ...strings(query.threads)].join(' ')).size
        || normalized(query.location) || strings(query.characters).some(normalized));
}

/** Relevance is independent of importance, age and ranking weights. */
export function memoryMatchesQuery(memory, query = {}, options = {}) {
    if (!hasMemoryQuery(query)) return false;
    const queryText = [query.message, ...strings(query.topics), ...strings(query.threads)].filter(Boolean).join(' ');
    const content = [memory.text || memory.summary, ...strings(memory.topics)].filter(Boolean).join(' ');
    const lexical = intersectionScore(relevanceTokens(queryText), relevanceTokens(content));
    const semantic = options.similarities?.[memory.id];
    const location = normalized(query.location);
    const actors = new Set(strings(memory.entities || memory.characters).map(normalized).filter(Boolean));
    return lexical >= (options.minLexicalRelevance ?? 0.12) && lexical > 0
        || Number.isFinite(semantic) && semantic >= (options.minSemanticRelevance ?? 0.35)
        || Boolean(location && location === normalized(memory.scene))
        || strings(query.characters).some(id => actors.has(normalized(id)));
}

/** Suppress equivalent retrieval entries, never merge their underlying evidence. */
function duplicateKey(memory) {
    const sorted = value => [...new Set(strings(value))].sort();
    return JSON.stringify([
        normalized(memory.text || memory.summary), memory.campaignId, memory.sessionId,
        memory.type || 'event', memory.status || 'current', memory.epistemicStatus,
        memory.factKey, memory.gameTime, memory.scene,
        memory.provenance, memory.sourceAssertions, memory.links, sorted(memory.sourceMemoryIds),
        sorted(memory.entities || memory.characters), sorted(memory.visibleTo),
        memory.eventId, sorted(memory.eventIds), sorted(memory.sourceEventIds),
    ]);
}

export function retrieveMemories(memories, query = {}, options = {}) {
    const topK = Math.max(0, Math.min(50, Math.trunc(Number(options.topK ?? query.topK ?? 6))));
    const minScore = Number(options.minScore ?? 0);
    const now = options.now ?? Date.now();
    const eligible = projectMemoryReferences(audienceMemories(memories || [], options.policy)
        .filter(memory => eligibleMemory(memory, options.policy)));
    const availability = new Map();
    if (options.availability?.enabled === true) {
        const supports = supportingEpisodes(eligible);
        for (const memory of eligible) {
            const textCue = intersectionScore(relevanceTokens([query.message, ...strings(query.topics)].join(' ')),
                relevanceTokens([memory.text || memory.summary, ...strings(memory.topics)].join(' ')));
            const semantic = options.similarities?.[memory.id];
            const cue = Math.max(textCue, Number.isFinite(semantic) ? semantic : 0,
                normalized(query.location) && normalized(query.location) === normalized(memory.scene) ? 0.4 : 0);
            availability.set(memory, memoryAvailability(memory, {
                ...options.availability, gameTime: options.policy?.through,
                cue, supportCount: supports.get(memory.id)?.size || 0,
            }));
        }
    }
    const ranked = eligible
        .filter(memory => memoryMatchesQuery(memory, query, options))
        .map(memory => ({ memory, score: scoreMemory(memory, query, now, options) * (availability.get(memory)?.factor ?? 1) }))
        .filter(({ score }) => score > minScore)
        .sort((a, b) => b.score - a.score || Number(b.memory.importance || 0) - Number(a.memory.importance || 0));
    let remaining = Math.max(0, options.tokenBudget ?? 1200);
    const selected = [], seen = new Set(), selectedIds = new Set();
    const byId = new Map(eligible.map(memory => [memory.id, memory]));
    const graph = memoryAdjacency(eligible);
    const associationLimit = Math.max(0, Math.min(2, Math.trunc(options.associationLimit ?? 2)));
    let associated = 0;
    const append = (memory, score, retrieval) => {
        if (selected.length >= topK || selectedIds.has(memory.id ?? memory)) return false;
        const key = duplicateKey(memory);
        if (seen.has(key)) return false;
        const entry = { ...memory, ...(options.includeScores ? { score } : {}), ...(retrieval ? { retrieval } : {}),
            ...(options.includeScores && availability.has(memory) ? { availability: availability.get(memory) } : {}) };
        const cost = Math.ceil(JSON.stringify(entry).length / 4);
        if (cost > remaining) return false;
        remaining -= cost;
        seen.add(key); selectedIds.add(memory.id ?? memory); selected.push(entry);
        return true;
    };
    for (const {memory, score} of ranked) {
        if (selected.length >= topK) break;
        if (!append(memory, score)) continue;
        // Only an actually selected relevant seed can activate the bounded graph walk.
        const queue = [{ id: memory.id, depth: 0 }], visited = new Set([memory.id]);
        for (let index = 0; index < queue.length && associated < associationLimit; index++) {
            const parent = queue[index];
            if (parent.depth >= 2) continue;
            for (const edge of graph.get(parent.id) || []) {
                if (associated >= associationLimit || selected.length >= topK) break;
                if (visited.has(edge.id)) continue;
                visited.add(edge.id);
                const linked = byId.get(edge.id);
                if (!append(linked, score * 0.5, { kind: 'association', fromId: parent.id,
                    relation: edge.relation, direction: edge.direction, depth: parent.depth + 1 })) continue;
                associated++;
                queue.push({ id: edge.id, depth: parent.depth + 1 });
            }
        }
    }
    return selected;
}
