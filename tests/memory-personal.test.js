import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMemoryProvenance } from '../src/memory/provenance.js';
import { normalizeMemory } from '../src/memory/policy.js';
import { retrieveMemories } from '../src/memory/retrieval.js';
import { consolidationBatch, validateConsolidationCandidate, memorySceneKey, hasPendingSceneTransition } from '../src/memory/consolidation.js';

const options = { viewers: ['Anna'], texts: { rp: 'Anna heard about the betrayal.', user: 'Anna knows everything.' } };
const candidate = { type: 'fact', text: 'Boris betrayed Anna.', visibleTo: ['*'], factKey: 'betrayal', supersedes: ['old'],
    provenance: { holder: 'Anna', kind: 'reported', confidence: 0.4, evidence: { source: 'rp', quote: 'Anna heard about the betrayal.' } } };

test('reported claims stay private beliefs with evidence and do not supersede facts', () => {
    const result = normalizeMemory(validateMemoryProvenance(candidate, options));
    assert.equal(result.type, 'belief'); assert.deepEqual(result.visibleTo, ['Anna']);
    assert.equal(result.factKey, undefined); assert.deepEqual(result.supersedes, []);
    assert.equal(result.provenance.confidence, 0.4); assert.equal(result.provenance.kind, 'reported');
    assert.equal(candidate.type, 'fact');
});

test('unsupported holder, evidence and confidence cannot establish personal memory', () => {
    for (const patch of [{ holder: 'Bob' }, { confidence: 2 }, { kind: 'certain' },
        { evidence: { source: 'rp', quote: 'invented' } }, { evidence: { source: 'user_action', quote: 'Anna knows everything.' } }]) {
        assert.equal(validateMemoryProvenance({ ...candidate, provenance: { ...candidate.provenance, ...patch } }, options), null);
    }
});

test('personal ranking changes eligible order without changing confidence or shared ranking', () => {
    const memories = ['garden flowers', 'promise betrayal'].map((text, i) => ({id:String(i),text,scene:'kitchen',visibleTo:['Anna'],
        importance:0.5,status:'current',provenance:{holder:'Anna',kind:'inferred',confidence:0.3}}));
    const settings = {policy:{viewers:['Anna']},topK:1,tokenBudget:2000};
    const before = structuredClone(memories);
    assert.equal(retrieveMemories(memories,{location:'kitchen'},settings)[0].id,'0');
    assert.equal(retrieveMemories(memories,{location:'kitchen'}, {...settings,personal:{characterId:'Anna',causes:[{summary:'promise betrayal'}]}})[0].id,'1');
    assert.deepEqual(retrieveMemories(memories,{message:'reactor'}, {...settings,personal:{characterId:'Anna',causes:[{summary:'promise betrayal'}]}}),[]);
    assert.deepEqual(memories,before);
    assert.deepEqual(retrieveMemories(memories,{location:'kitchen'}, {...settings,policy:{viewers:['Bob']},personal:{characterId:'Anna'}}),[]);
});

test('identical wording with different knowledge provenance remains distinct', () => {
    const memories = ['observed','reported'].map((kind,i)=>({id:String(i),text:'A promise.',scene:'kitchen',visibleTo:['Anna'],
        provenance:{holder:'Anna',kind,confidence:0.4}}));
    assert.equal(retrieveMemories(memories,{location:'kitchen'},{policy:{viewers:['Anna']},tokenBudget:2000}).length,2);
});

test('scene transitions ignore cast order and weather, and legacy records do not invent boundaries', () => {
    const state={scene:{location:'kitchen',present:['Anna','Bob'],weather:'rain'}};
    const records=[{source:'message:1',messageIndex:1,memorySceneKey:memorySceneKey(state)}];
    assert.equal(hasPendingSceneTransition(records,{scene:{...state.scene,present:['Bob','Anna'],weather:'sun'}}),false);
    assert.equal(hasPendingSceneTransition(records,{scene:{...state.scene,location:'garden'}}),true);
    assert.equal(hasPendingSceneTransition([{source:'message:1',messageIndex:1}],state),false);
});

test('consolidation preserves assertion source and uncertainty in derived summary metadata', () => {
    const scope={campaignId:'c',sessionId:'s'};
    const events=['a','b'].map(id=>({...normalizeMemory(validateMemoryProvenance({...candidate,type:'event',provenance:{...candidate.provenance,kind:'observed'}},options),scope),id}));
    const batch=consolidationBatch(events,{scope,viewers:['Anna']});
    const summary=validateConsolidationCandidate({type:'summary',text:'Related observations.',sourceMemoryIds:['a','b']},batch);
    assert.equal(summary.sourceAssertions[0].provenance.confidence,0.4);
    assert.deepEqual(summary.visibleTo,['Anna']);
});


test('turn normalization drops forged sources but preserves unrelated valid episodes', async () => {
    const { prepareTurnMemories } = await import('../src/memory/turn.js');
    const items = await prepareTurnMemories([
        { type:'summary', text:'forged', sourceMemoryIds:['x','y'] },
        { ...candidate, provenance:{...candidate.provenance,holder:'unknown'} },
        { type:'event', text:'valid', visibleTo:['*'] }, candidate,
    ], {scope:{campaignId:'c',sessionId:'s'},sources:[],viewers:options.viewers,texts:options.texts});
    assert.deepEqual(items.map(m=>m.text), ['valid',candidate.text]);
    assert.equal(items[1].provenance.confidence,0.4);
    assert.ok(items.every(m=>m.embeddingHash));
});
