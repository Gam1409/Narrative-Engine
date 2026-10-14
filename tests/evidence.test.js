import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceCatalog, resolveEvidence } from '../src/state/evidence.js';
import { validateSchema } from '../src/utils/schema.js';
import { readFile } from 'node:fs/promises';
test('evidence references resolve exact Russian text with immutable input',async()=>{
 const texts={user:'Прости. Я ошибся.',rp:'Она улыбнулась.\nОн опустил глаза.'};texts.evidenceCatalog=await buildEvidenceCatalog(texts);
 const input={ref:texts.evidenceCatalog[1].ref};assert.deepEqual(resolveEvidence(input,texts),{source:'rp',quote:'Она улыбнулась.'});assert.deepEqual(Object.keys(input),['ref']);
});
test('stale, invented and ambiguous references fail closed',async()=>{
 const before={rp:'Первый ход',user:''},now={rp:'Второй ход',user:''};const old=await buildEvidenceCatalog(before);now.evidenceCatalog=await buildEvidenceCatalog(now);
 assert.throws(()=>resolveEvidence({ref:old[0].ref},now),/Unknown/);
 assert.throws(()=>resolveEvidence({ref:now.evidenceCatalog[0].ref,quote:'подмена'},now),/shape/);
 assert.throws(()=>resolveEvidence({ref:'invented'},now),/Unknown/);
 assert.throws(()=>resolveEvidence({source:'rp',quote:'translated'},now),/quote/);
});
test('catalog bounds length and legacy exact evidence remains accepted',async()=>{
 const text='а'.repeat(1300);const entries=await buildEvidenceCatalog({rp:text});assert.equal(entries.length,3);assert.equal(entries.map(e=>e.quote).join(''),text);
 assert.deepEqual(resolveEvidence({source:'rp',quote:'текст'},{rp:'Вот текст.'}),{source:'rp',quote:'текст'});
 await assert.rejects(buildEvidenceCatalog({rp:Array(257).fill('x').join('\n')}),/budget/);
});
test('POST event schema accepts refs and legacy quotes but rejects mixed forms',async()=>{
 const schema=JSON.parse(await readFile(new URL('../schemas/post_director.schema.json',import.meta.url),'utf8')).properties.simulation_delta.properties.events.items.properties.evidence;
 assert.equal(validateSchema(schema,{ref:'rp:abc:0'}).valid,true);
 assert.equal(validateSchema(schema,{source:'rp',quote:'text'}).valid,true);
 assert.equal(validateSchema(schema,{ref:'rp:abc:0',quote:'text'}).valid,false);
});
