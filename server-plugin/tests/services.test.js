'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { consolidateMemories, mergeState, searchMemories, selectSprite } = require('../lib/services');

class MemoryDb {
    constructor() { this.items = []; }
    saveMemory(item) { const index = this.items.findIndex((entry) => entry.id === item.id); if (index >= 0) this.items[index] = item; else this.items.push(item); }
    listMemories(chatId) { return this.items.filter((item) => item.chatId === chatId).map((item) => ({ ...item, updated_at: 'now' })); }
}

test('state deltas merge without mutation and null deletes values', () => {
    const original = { scene: { place: 'room', door: 'open' }, list: [1] };
    const merged = mergeState(original, { scene: { door: 'closed', light: 'low' }, list: null });
    assert.deepEqual(original, { scene: { place: 'room', door: 'open' }, list: [1] });
    assert.deepEqual(merged, { scene: { place: 'room', door: 'closed', light: 'low' } });
    assert.throws(() => mergeState({}, JSON.parse('{"__proto__":{"polluted":true}}')), /Unsafe/);
});

test('memory consolidation and keyword retrieval remain chat-scoped', () => {
    const db = new MemoryDb();
    assert.equal(consolidateMemories(db, 'chat-a', [{ text: 'Wren left the violin beside the desk', tags: ['violin'], importance: 0.9 }]), 1);
    consolidateMemories(db, 'chat-b', [{ text: 'Unrelated violin', importance: 1 }]);
    const found = searchMemories(db, 'chat-a', 'Where is the violin?', 6);
    assert.equal(found.length, 1);
    assert.match(found[0].text, /beside the desk/);
});

test('sprite selection shortlists by code and preserves KEEP semantics', () => {
    const candidates = Array.from({ length: 2001 }, (_, index) => ({ name: `neutral-${index}`, tags: ['neutral'] }));
    candidates.push({ name: 'embarrassment-arms_crossed-medium', tags: ['embarrassment', 'arms crossed'] });
    const result = selectSprite({ candidates, desired: ['embarrassment', 'arms crossed'] });
    assert.equal(result.sprite, 'embarrassment-arms_crossed-medium');
    assert.ok(result.candidatesConsidered <= 24);
    assert.equal(selectSprite({ candidates, desired: [] }).sprite, 'KEEP');
    assert.equal(selectSprite({ candidates, desired: ['embarrassment'], current: 'embarrassment-arms_crossed-medium' }).sprite, 'KEEP');
});
