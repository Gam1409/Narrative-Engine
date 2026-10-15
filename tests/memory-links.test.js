import test from 'node:test';
import assert from 'node:assert/strict';
import { validatedMemoryLinks, projectMemoryReferences } from '../src/memory/links.js';
import { retrieveMemories } from '../src/memory/retrieval.js';
import { prepareTurnMemories } from '../src/memory/turn.js';
import { activeMemories } from '../src/state/history.js';

const scope = {campaignId:'c',sessionId:'s'};
const event = (id,text,extra={}) => ({id,text,type:'event',status:'current',visibleTo:['Anna'],...scope,...extra});
const policy = {...scope,mode:'session_only',viewers:['Anna']};
const options = {policy,topK:6,tokenBudget:4000};
const link = (targetId,relation='caused_by') => ({targetId,relation,evidence:{source:'rp',quote:'Because the promise was broken, Anna lost trust.'}});
const texts = {rp:'Because the promise was broken, Anna lost trust.'};

function chain() {
    return [event('promise','A solemn commitment.'), event('broken','He did not arrive.',{links:[link('promise')]}),
        event('trust','Distrust.',{links:[link('broken')]})];
}

test('validated links require supplied targets, compatible access and exact current RP evidence', () => {
    const sources=[event('private','secret',{visibleTo:['Bob']}),event('public','public',{visibleTo:['*']})];
    const candidate=event('new','new',{links:[link('private'),link('public'),link('invented'),link('public','invented'),
        {...link('public'),evidence:{source:'rp',quote:'not in RP'}},link('public')]});
    const links=validatedMemoryLinks(candidate,sources,texts);
    assert.deepEqual(links.map(l=>l.targetId),['public']);
    assert.deepEqual(validatedMemoryLinks({...candidate,visibleTo:['*'],links:[link('private')]},sources,texts),[]);
});

test('relevant anchor retrieves a two-hop cause chain and preserves original knowledge', () => {
    const memories=chain(), before=structuredClone(memories);
    const result=retrieveMemories(memories,{message:'Distrust'},options);
    assert.deepEqual(result.map(m=>m.id),['trust','broken','promise']);
    assert.equal(result[1].retrieval.relation,'caused_by');assert.equal(result[2].retrieval.depth,2);
    assert.deepEqual(memories,before);
    assert.deepEqual(retrieveMemories(memories,{message:'reactor'},options),[]);
});

test('reverse traversal is explicitly marked and cycles cannot duplicate episodes', () => {
    const memories=chain();memories[0].links=[link('trust','supports')];
    const result=retrieveMemories(memories,{message:'solemn commitment'},options);
    assert.equal(new Set(result.map(m=>m.id)).size,result.length);
    assert.equal(result.length,3);
    assert.ok(result.some(m=>m.retrieval?.direction==='incoming'));
    assert.equal(retrieveMemories(memories,{message:'Distrust'},{...options,associationLimit:0}).length,1);
});

test('hidden, out-of-scope and disputed memories cannot be reached or exposed through metadata', () => {
    const memories=chain();memories[1].visibleTo=['Bob'];
    memories[2].sourceMemoryIds=['broken'];memories[2].sourceAssertions=[{id:'broken',provenance:{secret:'HIDDEN'}}];
    const result=retrieveMemories(memories,{message:'Distrust'},options);
    assert.deepEqual(result.map(m=>m.id),['trust']);assert.ok(!JSON.stringify(result).includes('broken'));
    assert.ok(!JSON.stringify(result).includes('HIDDEN'));
    for(const patch of [{status:'disputed'},{sessionId:'another'},{gameTime:'2099-01-01T00:00'}]) {
        const data=chain();Object.assign(data[1],patch);
        const found=retrieveMemories(data,{message:'Distrust'},{...options,policy:{...policy,through:'2026-01-01T00:00'}});
        assert.deepEqual(found.map(m=>m.id),['trust']);
    }
});

test('associations share topK and token budgets and oversized links do not displace fitting direct hits', () => {
    const memories=chain();memories[1].text='x'.repeat(10000);
    memories.push(event('other','Distrust again.'));
    const found=retrieveMemories(memories,{message:'Distrust'},{...options,topK:2,tokenBudget:600});
    assert.deepEqual(found.map(m=>m.id),['trust','other']);
    assert.ok(found.reduce((sum,m)=>sum+Math.ceil(JSON.stringify(m).length/4),0)<=600);
    assert.deepEqual(retrieveMemories(chain(),{message:'Distrust'},{...options,tokenBudget:1}),[]);
});

test('summary sources are traversable and references disappear when their branch is removed', () => {
    const first={deltaId:'a',memories:[event('old','A solemn commitment.')]};
    const sourceId=activeMemories([first])[0].id;
    const second={deltaId:'b',memories:[event('new','Distrust.',{type:'summary',sourceMemoryIds:[sourceId]})]};
    assert.equal(retrieveMemories(activeMemories([first,second]),{message:'Distrust'},options).length,2);
    const orphan=projectMemoryReferences(activeMemories([second]));
    assert.deepEqual(orphan[0].sourceMemoryIds,[]);
    assert.equal(retrieveMemories(orphan,{message:'Distrust'},options).length,1);
});

test('turn storage retains validated links and drops unsupported ones without losing the episode',async()=>{
    const result=await prepareTurnMemories([event('new','Distrust.',{links:[link('past'),link('invented')]})],
        {scope,sources:[],linkSources:[event('past','promise')],viewers:['Anna'],texts});
    assert.equal(result.length,1);assert.deepEqual(result[0].links.map(l=>l.targetId),['past']);
});
