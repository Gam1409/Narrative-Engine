import test from 'node:test';
import assert from 'node:assert/strict';
import { lexicalTokens } from '../src/memory/semantic.js';
import { retrieveMemories } from '../src/memory/retrieval.js';

for (const [language, query, relevant] of [
    ['Russian','скрипки','Вера принесла скрипку'],
    ['English','repairing compasses','Robin repaired the compass'],
    ['German','Schlüssel','Anna versteckte den Schlüssel'],
    ['Spanish','anillos','Ana encontró el anillo'],
    ['Chinese','钥匙','他把钥匙放在桌上'],
    ['Japanese','図書館','図書館に手紙を忘れた'],
    ['mixed','Nora backpack','Nora забрала backpack'],
]) test(`Unicode fallback retrieves ${language} text without a language setting`, () => {
    const memories = ['An unrelated weather report.', relevant].map((text,i) => ({ id:String(i), text, visibleTo:['*'], importance:.5 }));
    assert.equal(retrieveMemories(memories, { message:query }, { topK:1 })[0].id,'1');
});
test('Unicode normalization supports composed and decomposed text', () => {
    assert.deepEqual(lexicalTokens('café'), lexicalTokens('cafe\u0301'));
});
