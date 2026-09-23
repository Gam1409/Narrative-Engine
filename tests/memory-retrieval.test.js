import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveMemories, scoreMemory } from '../src/memory/retrieval.js';
import { compactToBudget, estimateTokens } from '../src/utils/tokenBudget.js';

const memories = [
    { id: 'violin', scene: 'Room 167', characters: ['Wren'], topics: ['violin', 'talent_show'], summary: 'Wren left her violin beside the desk.', importance: 0.8 },
    { id: 'snow', scene: 'Yard', characters: ['Bex'], topics: ['weather'], summary: 'Bex noticed heavy snow.', importance: 0.4 },
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
