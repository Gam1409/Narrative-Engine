'use strict';

const crypto = require('node:crypto');
const { validateId } = require('./security');

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function mergeState(target, delta) {
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return delta;
    const output = target && typeof target === 'object' && !Array.isArray(target) ? structuredClone(target) : {};
    for (const [key, value] of Object.entries(delta)) {
        if (FORBIDDEN_KEYS.has(key)) throw Object.assign(new Error('Unsafe state key'), { status: 400 });
        if (value === null) delete output[key];
        else output[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergeState(output[key], value) : structuredClone(value);
    }
    return output;
}

function searchMemories(db, chatId, query, topK = 6) {
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [])].slice(0, 32);
    return db.listMemories(chatId).map((memory) => {
        const haystack = `${memory.text} ${memory.tags.join(' ')}`.toLowerCase();
        const matches = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { ...memory, score: terms.length ? matches / terms.length + Number(memory.importance || 0) * 0.1 : Number(memory.importance || 0) };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.min(20, Math.max(1, topK)));
}

function consolidateMemories(db, chatId, memories) {
    if (!Array.isArray(memories) || memories.length > 200) throw Object.assign(new Error('memories must be an array of at most 200 items'), { status: 400 });
    let saved = 0;
    for (const item of memories) {
        if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 10000) continue;
        const id = item.id ? validateId(item.id, 'memory id') : crypto.createHash('sha256').update(`${chatId}\0${item.text.trim()}`).digest('hex').slice(0, 32);
        db.saveMemory({ id, chatId, text: item.text.trim(), tags: Array.isArray(item.tags) ? item.tags.slice(0, 32).map(String) : [], importance: Math.min(1, Math.max(0, Number(item.importance) || 0.5)) });
        saved += 1;
    }
    return saved;
}

function selectSprite({ candidates, current = null, desired = [] }) {
    if (!Array.isArray(candidates) || candidates.length > 5000) throw Object.assign(new Error('candidates must be an array of at most 5000 items'), { status: 400 });
    if (!Array.isArray(desired) || !desired.length) return { sprite: 'KEEP', candidatesConsidered: 0 };
    const wanted = desired.map((term) => String(term).toLowerCase()).slice(0, 20);
    const shortlist = candidates.map((candidate) => {
        const name = typeof candidate === 'string' ? candidate : candidate?.name;
        const tags = typeof candidate === 'object' && Array.isArray(candidate.tags) ? candidate.tags : [];
        if (!name || name.length > 500) return null;
        const haystack = `${name} ${tags.join(' ')}`.toLowerCase();
        return { name, score: wanted.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0) };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 24);
    const winner = shortlist[0];
    if (!winner || winner.score === 0 || winner.name === current) return { sprite: 'KEEP', candidatesConsidered: shortlist.length };
    return { sprite: winner.name, candidatesConsidered: shortlist.length };
}

module.exports = { consolidateMemories, mergeState, searchMemories, selectSprite };
