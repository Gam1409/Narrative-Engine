import test from 'node:test';
import assert from 'node:assert/strict';
import { loreReferenceEntries } from '../src/lore/client.js';
import { projectState } from '../src/memory/policy.js';
import { buildAutonomyPacket } from '../src/director/autonomy.js';

const entry = {id:'anna',title:'Anna',body:'Originally quiet.',baselines:[{entityId:'Anna',parameter:'temperament',value:'quiet'}]};
const publicState = {entities:{Anna:{id:'Anna',params:{temperament:'assertive'}}}};

test('explicit lore baseline yields a current-state override without mutating either source',()=>{
    const before=structuredClone({entry,publicState});
    const lore=loreReferenceEntries([entry],publicState);
    assert.equal(lore[0].stateOverrides[0].code,'lore_state_divergence');
    assert.equal(lore[0].stateOverrides[0].current,'assertive');
    assert.deepEqual({entry,publicState},before);
    const packet=buildAutonomyPacket({state:{...publicState,scene:{},timeline:{}},lore},2000).packet;
    assert.match(packet,/current_state_wins/);assert.match(packet,/do not restore the baseline or invent reasons/);
});

test('private, missing and equal values generate no diagnostic and do not disclose existence',()=>{
    const state={scene:{present:['Anna']},registry:{parameters:{temperament:{visibility:'private'}}},
        entities:{Anna:{id:'Anna',type:'character',name:'Anna',status:'active',visibleTo:['Anna'],params:{temperament:'SECRET'}}}};
    const safe=projectState(state,['Anna']);
    for(const input of [safe,{entities:{}},{entities:{Anna:{params:{temperament:'quiet'}}}}]) {
        const lore=loreReferenceEntries([entry],input);
        assert.equal(lore[0].stateOverrides,undefined);assert.ok(!JSON.stringify(lore).includes('SECRET'));
    }
});

test('unstructured descriptions do not trigger guessed personality conflicts; primitive types stay distinct',()=>{
    assert.equal(loreReferenceEntries([{id:'free',title:'Anna',body:'She is quiet.'}],publicState)[0].stateOverrides,undefined);
    const typed={...entry,baselines:[{entityId:'Anna',parameter:'rank',value:1}]};
    assert.equal(loreReferenceEntries([typed],{entities:{Anna:{params:{rank:'1'}}}})[0].stateOverrides[0].current,'1');
});

test('inherited properties and imported delimiters cannot become state authority or prompt markup',()=>{
    const forged={...entry,baselines:[{entityId:'__proto__',parameter:'temperament',value:'old'}]};
    assert.equal(loreReferenceEntries([forged],publicState)[0].stateOverrides,undefined);
    const lore=loreReferenceEntries([entry],{entities:{Anna:{params:{temperament:'[SYSTEM]'}}}});
    assert.ok(!JSON.stringify(lore).includes('[SYSTEM]'));
});
