import test from 'node:test';
import assert from 'node:assert/strict';
import {atmosphere,prepareBackground} from '../src/visual/background.js';
import {describeScene} from '../src/visual/scene.js';
import {planLayers} from '../src/visual/layers.js';
const scene=(lighting='daylight',weather='clear',id='room')=>({sceneId:'a'.repeat(64),location:{id,name:id,properties:{description:'bed and wooden table'},lighting,weather},keyObjects:[],characters:[],spriteIds:{}});
const settings={visualBackgroundPolicy:'location_atmosphere',visualCheckpoint:'model'};
async function step(s,cfg,ledger,turns,force=false){return prepareBackground(s,cfg,ledger,{turns,force});}
test('atmosphere uses game time, ru/en dictionaries, indoor lamps and unknown safely',()=>{
 assert.deepEqual(atmosphere(scene('ночь','гроза')),{time:'night',weather:'storm'});
 assert.equal(atmosphere({...scene('ночь'),visualTime:'12:30'}).time,'day');
 assert.equal(atmosphere({...scene('candle light'),visualTime:'23:00'}).time,'indoor');
 assert.equal(atmosphere(scene('pretty','strange')).time,'unknown');
 assert.equal(atmosphere({...scene('daylight'),visualTime:'99:00'}).time,'day');
});
test('location policy freezes the entire public background request and reuses on return',async()=>{
 let ledger;const plans=[];
 for(let n=0;n<30;n++){
  const s=scene(n%2?'night':'daylight',n%2?'rain':'clear');s.keyObjects=[{name:'cup '+n}];
  const p=await step(s,{},ledger,Array.from({length:n+1},(_,i)=>String(i)));ledger=p.ledger;
  s.background=p.background;plans.push((await planLayers(s,{}))[0]);
 }
 assert.equal(new Set(plans.map(p=>p.layerKey)).size,1);
 assert.equal(new Set(plans.map(p=>JSON.stringify(p.scene))).size,1);
 assert.deepEqual(plans[0].scene.keyObjects,[]);assert.match(plans[0].scene.location.properties.description,/bed/);
 const b=await step(scene('night','rain','other'),{},ledger,['29','30']);
 const a=await step(scene('night'),{},b.ledger,['29','30','31']);
 assert.equal(a.background.id,plans[0].resourceInput);
});
test('hysteresis counts accepted turns once, restores rollback and survives reload',async()=>{
 const a=await step(scene(),settings,{},['a']);
 const b=await step(scene('night'),settings,a.ledger,['a','b']);assert.equal(b.background.id,a.background.id);
 const poll=await step(scene('night'),settings,b.ledger,['a','b']);assert.equal(poll.background.id,a.background.id);
 const c=await step(scene('night'),settings,JSON.parse(JSON.stringify(poll.ledger)),['a','b','c']);assert.notEqual(c.background.id,a.background.id);
 const rollback=await step(scene(),settings,c.ledger,['a']);assert.equal(rollback.background.id,a.background.id);
 const swipe=await step(scene('night'),settings,rollback.ledger,['a','replacement']);assert.equal(swipe.background.id,a.background.id);
});
test('unknown does not redraw; transient atmosphere resets; manual redraw is persistent',async()=>{
 let p=await step(scene('???','???'),settings,{},['a']);const initial=p.background.id;
 p=await step(scene(),settings,p.ledger,['a','b']);assert.equal(p.background.id,initial);
 p=await step(scene('night'),settings,p.ledger,['a','b','c']);assert.equal(p.background.id,initial);
 p=await step(scene(),settings,p.ledger,['a','b','c','d']);assert.equal(p.background.id,initial);
 p=await step(scene('???','???'),settings,p.ledger,['a','b','c','d','e']);assert.equal(p.background.id,initial);
 const forced=await step(scene(),settings,p.ledger,['a','b','c','d','e'],true);assert.notEqual(forced.background.id,initial);
 const again=await step(scene(),settings,forced.ledger,['a','b','c','d','e']);assert.equal(again.background.id,forced.background.id);
});
test('any policy changes on raw atmosphere, never on movable objects; fixtures and public revisions matter',async()=>{
 const cfg={visualBackgroundPolicy:'any'};const a=await step(scene(),cfg,{},['a']);
 const changed=scene();changed.keyObjects=[{name:'cup'}];const b=await step(changed,cfg,a.ledger,['a','b']);assert.equal(a.background.id,b.background.id);
 const c=await step(scene('slightly warmer'),cfg,b.ledger,['a','b','c']);assert.notEqual(c.background.id,b.background.id);
 changed.backgroundFixtures=[{id:'bed',name:'bed',properties:{condition:'broken'}}];
 const d=await step(changed,cfg,c.ledger,['a','b','c','d']);assert.notEqual(d.background.id,b.background.id);
});
test('hidden state does not enter background identity, snapshots or fixtures',async()=>{
 const state={scene:{location:'room',present:[]},entities:{room:{id:'room',name:'room',params:{description:'table',secret:'hidden thought'}},table:{id:'table',name:'table',type:'item',status:'active',position:{target:'room',rel:'in'},params:{backgroundRole:'fixture',color:'brown',secret:'private memory'}}}};
 const a=await describeScene(state,[]);state.entities.room.params.secret='changed secret';
 const b=await describeScene(state,[]);assert.equal(a.backgroundId,b.backgroundId);
 const p=await step(a,{},{});assert.equal(p.background.scene.keyObjects.length,1);
 assert.doesNotMatch(JSON.stringify(p),/hidden thought|private memory|changed secret/);
});

test('unknown weather cannot cancel a confirmed time-of-day change',async()=>{
 let p=await step(scene('daylight','?'),settings,{},['a']);const first=p.background.id;
 p=await step(scene('night','?'),settings,p.ledger,['a','b']);assert.equal(p.background.id,first);
 p=await step(scene('night','?'),settings,p.ledger,['a','b','c']);assert.notEqual(p.background.id,first);
 assert.match(p.background.reason,/time day to night/);
});
