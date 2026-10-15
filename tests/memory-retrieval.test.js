import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveMemories, scoreMemory } from '../src/memory/retrieval.js';
import { compactToBudget, estimateTokens } from '../src/utils/tokenBudget.js';

const memories = [
    { id: 'violin', visibleTo: ['*'], scene: 'Room 167', characters: ['Wren'], topics: ['violin', 'talent_show'], summary: 'Wren left her violin beside the desk.', importance: 0.8 },
    { id: 'snow', visibleTo: ['*'], scene: 'Yard', characters: ['Bex'], topics: ['weather'], summary: 'Bex noticed heavy snow.', importance: 0.4 },
];

test('keyword retrieval returns relevant old episode without dumping database', () => {
    const result = retrieveMemories(memories, { message: 'Wren needs the violin', characters: ['Wren'] }, { topK: 1 });
    assert.deepEqual(result.map((item) => item.id), ['violin']);
    assert.ok(scoreMemory(memories[0], { message: 'violin' }) > scoreMemory(memories[1], { message: 'violin' }));
});

test('token budget compaction preserves required continuity section', () => {
    const packet = { scene: { location: 'Room 167' }, must_preserve: ['door closed'], relevant_memories: Array(100).fill('long memory '.repeat(20)), diagnostics: 'x'.repeat(2000) };
    const compact = compactToBudget(packet, 100, { required: ['scene', 'must_preserve'] });
    assert.ok(compact.scene);
    assert.ok(compact.must_preserve);
    assert.ok(estimateTokens(compact) <= 110);
    assert.ok(packet.relevant_memories.length === 100);
});


const episode = (id, text, extra = {}) => ({id,text,visibleTo:['*'],type:'event',importance:0.5,...extra});

test('importance and recency cannot rescue unrelated memories or empty queries', () => {
    const items=[episode('tomatoes','The tomatoes are growing in the garden',{importance:1,gameTime:'2026-10-15T12:00'})];
    for(const message of ['The reactor is unstable', 'Реактор перегревается', '', 'the and is', 'и это на']) {
        assert.deepEqual(retrieveMemories(items,{message},{weights:{importance:100,recency:100},now:Date.parse('2026-10-15T12:00Z')}),[]);
    }
});

test('location and participant cues recall an old conversation without topic overlap', () => {
    const items=[episode('talk','An old conversation about promises',{scene:'Kitchen',entities:['Anna'],importance:0.01})];
    assert.equal(retrieveMemories(items,{message:'Hello',location:' kitchen '})[0].id,'talk');
    assert.equal(retrieveMemories(items,{characters:['Anna']})[0].id,'talk');
    assert.deepEqual(retrieveMemories(items,{characters:['Ann']}),[]);
});

test('semantic relevance has its own threshold and still obeys visibility', () => {
    const items=[episode('remember','An old promise'),episode('private','Secret promise',{visibleTo:['Bob']})];
    const query={message:'Will you keep your word?'};
    assert.deepEqual(retrieveMemories(items,query,{similarities:{remember:0.1,private:0.99},policy:{viewers:['Anna']}}),[]);
    assert.deepEqual(retrieveMemories(items,query,{similarities:{remember:0.8,private:0.99},policy:{viewers:['Anna']}}).map(m=>m.id),['remember']);
    assert.deepEqual(retrieveMemories(items,{}, {similarities:{remember:1}}),[]);
});

test('an oversized first candidate does not consume topK or starve a shorter episode', () => {
    const items=[episode('long','violin '.repeat(500),{importance:1}),episode('short','violin',{importance:0.1})];
    const before=structuredClone(items);
    const result=retrieveMemories(items,{message:'violin'},{topK:1,tokenBudget:50,includeScores:true});
    assert.deepEqual(result.map(m=>m.id),['short']);
    assert.ok(Math.ceil(JSON.stringify(result[0]).length/4)<=50);
    assert.deepEqual(items,before);
});

test('duplicates consume one slot and budget continues to the next relevant episode', () => {
    const items=[episode('one','Violin promised',{importance:1}),episode('duplicate','  VIOLIN   promised  ',{importance:0.9}),episode('next','Violin repaired',{importance:0.1})];
    assert.deepEqual(retrieveMemories(items,{message:'violin'},{topK:2}).map(m=>m.id),['one','next']);
    assert.equal(items.length,3);
});

test('contradictions, distinct times and personal beliefs are not deduplicated', () => {
    const items=[episode('fact','Violin promised'),episode('negated','Violin not promised'),
        episode('belief','Violin promised',{type:'belief'}),episode('later','Violin promised',{gameTime:'2026-10-15T12:00'})];
    assert.equal(retrieveMemories(items,{message:'violin'},{topK:10}).length,4);
});

test('zero count or budget returns no entries even for relevant memories', () => {
    assert.deepEqual(retrieveMemories(memories,{message:'violin'},{topK:0}),[]);
    assert.deepEqual(retrieveMemories(memories,{message:'violin'},{tokenBudget:0}),[]);
});
