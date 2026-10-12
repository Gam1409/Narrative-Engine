import test from 'node:test';
import assert from 'node:assert/strict';
import { describeScene, visualProfile } from '../src/visual/scene.js';
import { VisualDirector } from '../src/visual/director.js';
import { createInitialState } from '../src/state/model.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';

const state=()=>createInitialState({scene:{location:'cafe',present:['Anna'],weather:'rain',lighting:'warm'},characters:{Anna:{clothing:{costume:'casual'},pose:'sitting',expression:'neutral'}},simulation:{characters:{Anna:{expressedVsFelt:{expressed:['smile'],felt:['fear']}}}}});
const participants=[{name:'Anna'}];
test('visual descriptor derives physical scene and excludes hidden feelings without mutating canon',async()=>{
 const s=state(),before=structuredClone(s),scene=await describeScene(s,participants);
 assert.equal(scene.characters[0].outfit,'casual');assert.equal(scene.characters[0].emotion,'neutral');assert.doesNotMatch(JSON.stringify(scene),/fear/);assert.deepEqual(s,before);
 assert.deepEqual((await describeScene(s,participants,{},scene)).changesSincePrevious,[]);
 s.characters.Anna.clothing.costume='formal';assert.notEqual((await describeScene(s,participants)).sceneId,scene.sceneId);
});
test('visual profiles validate references and remain bound to entity IDs',()=>{
 const profile=visualProfile({entityId:'Anna',appearance:'dark hair',references:['anna.png'],lora:[{name:'Anna.safetensors',weight:0.8}],compatibleWorkflows:['scene_full']});
 assert.equal(profile.entityId,'Anna');assert.throws(()=>visualProfile({entityId:'__proto__'}),/Invalid/);assert.throws(()=>visualProfile({...profile,lora:[null]}),/LoRA/);assert.throws(()=>visualProfile({...profile,references:['https://host/a.png']}),/asset/);assert.throws(()=>visualProfile({...profile,lora:[{name:'x',weight:99}]}),/LoRA/);
});

function fixture(t,fetchImpl) {
 const old=globalThis.SillyTavern;const context={chatId:'one',characterId:0,characters:[{name:'Anna',avatar:'Anna.png'}],chatMetadata:{},saveMetadata:async()=>{}};
 globalThis.SillyTavern={getContext:()=>context};t.after(()=>globalThis.SillyTavern=old);
 const s=state();const runtime={stateManager:{prefix:'narrative-engine:ne-one',chatFingerprint:'ne-one',pending:[],deltas:[],snapshot:()=>structuredClone(s)},storage:new MemoryStorageAdapter(),participants,spriteManifests:{},settings:{visualEnabled:true,visualWorkflow:'scene_full',visualKeepSeed:true,visualStages:{}},diagnostics:{error:()=>{}}};
 const director=new VisualDirector(runtime,{fetchImpl});t.after(()=>director.close());return {director,runtime,context,s};
}
test('G16 illustration request and completion attach scene metadata without a state delta',async t=>{
 let submitted;const {director,runtime,context,s}=fixture(t,async(_url,opts)=>{
  if(opts.method==='GET')return {ok:true,json:async()=>[]};submitted=JSON.parse(opts.body);return {ok:true,json:async()=>({id:'job',status:'done',scene:submitted.scene,outputs:[{filename:'a.png'}]})};
 });
 const before=structuredClone(s);const job=await director.request();await director.follow(job,context,submitted.chatId,runtime.stateManager);
 assert.deepEqual(s,before);assert.equal(runtime.stateManager.deltas.length,0);assert.ok(context.chatMetadata.narrative_engine_visual.images[0].includes('/visual/image/'));
});
test('G17 visual submission error never writes to the canonical manager',async t=>{
 const {director,runtime,s}=fixture(t,async()=>{throw new Error('offline');});const before=structuredClone(s);
 await assert.rejects(director.request(),/offline/);assert.deepEqual(s,before);assert.equal(runtime.stateManager.deltas.length,0);
});
test('deleted/swiped origin or changed scene makes a visual result stale',async t=>{
 const {director,runtime,s}=fixture(t,async()=>{});const scene=await director.scene();const job={scene:{...scene,messageRef:{idempotencyKey:'old'}}};
 assert.equal(director.matches(job,scene),false);runtime.stateManager.deltas=[{idempotencyKey:'old'}];assert.equal(director.matches(job,scene),true);
 s.scene.weather='snow';assert.equal(director.matches(job,await director.scene()),false);
});
test('automatic generation deduplicates an unchanged scene; manual requests still work',async t=>{
 let history=[],posts=0;const {director}=fixture(t,async(_url,options)=>{if(options.method==='GET')return {ok:true,json:async()=>history};posts++;const body=JSON.parse(options.body);const job={id:'job',status:'failed_final',scene:body.scene,outputs:[]};history=[job];return {ok:true,json:async()=>job};});
 await director.request({automatic:true});await director.request({automatic:true});assert.equal(posts,1);await director.request();assert.equal(posts,2);
});
