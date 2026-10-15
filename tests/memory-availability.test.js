import test from 'node:test';
import assert from 'node:assert/strict';
import { gameTimestamp, memoryAvailability, supportingEpisodes } from '../src/memory/availability.js';
import { retrieveMemories } from '../src/memory/retrieval.js';
import { normalizeSettings } from '../src/settings.js';

const gameTime = '2026-10-01T12:00';
const event = (id, extra={}) => ({id,type:'event',text:'blue ribbon promise',status:'current',visibleTo:['Anna'],
    scene:'kitchen',gameTime:'2026-01-01T12:00',importance:0.5,...extra});
const options={policy:{viewers:['Anna'],through:gameTime},availability:{enabled:true,halfLifeDays:30},
    topK:6,tokenBudget:3000,includeScores:true,associationLimit:0,now:Date.parse(gameTime+'Z')};

test('availability uses game time and preserves a floor for old significant memories',()=>{
    const ordinary=memoryAvailability(event('old',{importance:0}),{gameTime});
    const important=memoryAvailability(event('important',{importance:1}),{gameTime});
    assert.ok(ordinary.factor>0 && ordinary.factor<0.3);
    assert.ok(important.factor>=0.75 && important.factor<1);
    assert.equal(memoryAvailability(event('unknown',{gameTime:null}),{gameTime}).factor,1);
    assert.equal(memoryAvailability(event('old'),{}).factor,1);
    assert.equal(gameTimestamp('2026-02-30T12:00'),null);
    assert.equal(gameTimestamp(gameTime+'Z'),gameTimestamp(gameTime));
});

test('explicit cues reactivate old memories without changing stored confidence',()=>{
    const memory=event('old',{provenance:{holder:'Anna',kind:'observed',confidence:0.3}});
    const before=structuredClone(memory);
    const weak=retrieveMemories([memory],{location:'kitchen'},options)[0];
    const strong=retrieveMemories([memory],{message:'blue ribbon promise'},options)[0];
    assert.ok(strong.availability.factor>weak.availability.factor);
    assert.equal(strong.availability.factor,1);
    for(let i=0;i<5;i++) assert.deepEqual(retrieveMemories([memory],{message:'blue ribbon promise'},options)[0],strong);
    assert.deepEqual(memory,before);assert.equal(strong.provenance.confidence,0.3);
    assert.deepEqual(retrieveMemories([memory],{message:'reactor'},options),[]);
});

test('support counts independent accepted event records, not duplicates, summaries or beliefs',()=>{
    const link={relation:'supports',targetId:'old'};
    const items=[event('a',{sourceDeltaId:'turn1',links:[link,link]}),event('b',{sourceDeltaId:'turn1',links:[link]}),
        event('c',{sourceDeltaId:'turn2',links:[link]}),event('summary',{type:'summary',links:[link]}),
        event('belief',{type:'belief',links:[link]}),event('disputed',{status:'disputed',links:[link]})];
    assert.equal(supportingEpisodes(items).get('old').size,2);
    const bare=memoryAvailability(event('old'),{gameTime});
    const reinforced=memoryAvailability(event('old'),{gameTime,supportCount:20});
    assert.ok(reinforced.factor>bare.factor);assert.equal(reinforced.supportCount,3);
});

test('hidden support and rolled-back events cannot reinforce a visible memory',()=>{
    const old=event('old');
    const supporting=event('support',{text:'unrelated testimony',links:[{relation:'supports',targetId:'old'}],sourceDeltaId:'turn'});
    const query={location:'kitchen'};
    const read=items=>retrieveMemories(items,query,options).find(m=>m.id==='old').availability;
    const base=read([old]);
    assert.ok(read([old,supporting]).factor>base.factor);
    assert.deepEqual(read([old,{...supporting,visibleTo:['Bob']}]),base);
    assert.deepEqual(read([old,{...supporting,gameTime:'2099-01-01T00:00'}]),base);
    assert.deepEqual(read([old]),base);
});

test('availability is opt-in and clamps settings without changing legacy retrieval',()=>{
    assert.equal(normalizeSettings({}).memoryAvailability,false);
    assert.equal(normalizeSettings({memoryAvailability:'true'}).memoryAvailability,false);
    assert.equal(normalizeSettings({memoryAvailabilityHalfLifeDays:0}).memoryAvailabilityHalfLifeDays,1);
    assert.equal(normalizeSettings({memoryAvailabilityHalfLifeDays:99999}).memoryAvailabilityHalfLifeDays,3650);
    const memories=[event('old'),event('recent',{gameTime})];
    const legacy={...options,availability:undefined};
    assert.deepEqual(retrieveMemories(memories,{location:'kitchen'},legacy),
        retrieveMemories(memories,{location:'kitchen'},{...legacy,availability:{enabled:false}}));
});
