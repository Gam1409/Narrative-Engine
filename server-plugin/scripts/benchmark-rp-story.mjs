// Standalone runtime acceptance: file-backed resources, simulated ST host, real Director API.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { NarrativeRuntime } from '../../src/runtime/runtime.js';
import { DirectorService } from '../../src/director/service.js';
import { MemoryStorageAdapter } from '../../src/memory/storage.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import { createInitialState } from '../../src/state/model.js';
const [url,model,baseFile,output,optionsFile]=process.argv.slice(2);
const base=JSON.parse(await fs.readFile(baseFile,'utf8'));
const options=optionsFile?JSON.parse(await fs.readFile(optionsFile,'utf8')):{};
const realFetch=globalThis.fetch;
globalThis.fetch=async (url,...args)=>String(url).startsWith('file:')?new Response(await fs.readFile(new URL(url))):realFetch(url,...args);
const name='Wren';
const context={chatId:'standalone-rp-story',characterId:0,name1:'Антон',characters:[{name,avatar:'Wren.png'}],chat:[],chatMetadata:{},saveChat:async()=>{},saveMetadata:async()=>{}};
globalThis.SillyTavern={getContext:()=>context};
const runtime=new NarrativeRuntime();
runtime.settings={...DEFAULT_SETTINGS,enabled:true,spriteDirector:false,visualEnabled:false,visualLlmIntent:true,visualPromptProfile:'anima',memoryRetrieval:false,worldSimulation:false,relationships:false,knowledge:false,plotManager:false,innerLifeMode:'off'};
runtime.storage=new MemoryStorageAdapter();runtime.spriteManifests={loadParticipants:async()=>[]};
const results=[],calls=[];
try{
 await runtime.loadChat(context);
 const character=base.scene.characters[0];
 const initial=createInitialState({scene:{location:'bedroom',present:[name],lighting:'soft daylight'},characters:{[name]:{clothing:{costume:character.outfit||'blue dress with white ruffled collar and buttons'},pose:'standing',expression:'relaxed eyes, closed mouth'}},locations:{bedroom:{description:'one wooden bed, pale blue walls'}},objects:{}});
 const profile={...character.profile,entityId:name};
 await runtime.stateManager.importData({chatFingerprint:runtime.stateManager.chatFingerprint,state:initial,visualProfiles:{[name]:profile}});
 runtime.provider={complete:async request=>{
  const start=Date.now();
  const response=await realFetch(url+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...options,model,messages:request.messages,max_tokens:request.maxTokens,temperature:0.2,stream:false}),signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const body=await response.json(),content=body.choices?.[0]?.message?.content;
  calls.push({role:request.role,ms:Date.now()-start,content});
  return {content,usage:body.usage};
 }};
 runtime.director=new DirectorService(runtime.provider,runtime.diagnostics);
 const turns=[
  {user:'Мы успеем поговорить до начала встречи?',rp:'Рен остаётся стоять в спальне. Её взгляд расслаблен, на губах появляется небольшая улыбка. «Да, времени достаточно. Я слушаю».',expected:'спокойная улыбка'},
  {user:'Встречу перенесли на сегодня, она начнётся через полчаса.',rp:'Рен широко раскрывает глаза и поднимает брови; рот на мгновение остаётся открытым. «Сегодня? Я думала, она завтра». Она остаётся на прежнем месте.',expected:'удивление'},
  {user:'Я узнал об этом ещё утром, но забыл тебе сказать.',rp:'Рен опускает брови, прищуривается и плотно сжимает губы. «Мне неприятно узнавать об этом в последний момент», — говорит она, не меняя позы.',expected:'раздражение'},
  {user:'Прости. Я ошибся и больше не буду откладывать такие сообщения.',rp:'Брови Рен расслабляются. Она смотрит мягче и слегка улыбается. «Хорошо. Спасибо, что признал это». Она по-прежнему стоит в той же комнате.',expected:'примирение'},
 ];
 for(const [i,turn] of turns.entries()){
  const start=Date.now(),callStart=calls.length;
  context.chat.push({is_user:true,mes:turn.user,send_date:'u'+i},{name,mes:turn.rp,send_date:'a'+i,swipe_id:0,extra:{}});
  await runtime.processPost(context.chat.length-1,'normal');
  const state=runtime.stateManager.snapshot();
  const row={case:'rp_'+i,turn,postMs:Date.now()-start,pending:runtime.stateManager.pending,records:runtime.stateManager.records,accepted:runtime.stateManager.pending.length===0&&Boolean(context.chat.at(-1).extra.narrative_engine),state};
  results.push(row);
  if(!row.accepted)throw Error('POST did not accept turn '+i);
  assert.deepEqual(state.characters[name].clothing,initial.characters[name].clothing,'wardrobe changed');
  assert.equal(state.characters[name].pose,initial.characters[name].pose,'pose changed');
  assert.equal(state.scene.location,initial.scene.location,'location changed');
  assert.deepEqual(state.objects,initial.objects,'objects invented');
  const rawScene=await import('../../src/visual/scene.js').then(m=>m.describeScene(state,runtime.participants, runtime.stateManager.visualProfiles));
  const directed=await runtime.visualDirector.scene();
  const visualCall=calls.slice(callStart).findLast(c=>c.role==='visual');
  const {parseIntent}=await import('../../src/visual/intent.js');
  row.scene=rawScene;row.intent=parseIntent(visualCall.content,rawScene);row.directedScene=directed;row.ms=visualCall.ms;row.purpose=true;row.valid=true;row.calls=calls.slice(callStart);row.totalMs=Date.now()-start;
  const beforeRepeat=calls.length;await runtime.visualDirector.scene();row.reusedIntent=calls.length===beforeRepeat;
  if(i)assert.equal(directed.backgroundId,results[0].directedScene.backgroundId,'background changed');
  await fs.writeFile(output,JSON.stringify({host:'simulated ST; real runtime and Qwen',results,calls,diagnostics:runtime.diagnostics.errors},null,2));
  console.log(JSON.stringify({case:row.case,accepted:row.accepted,postMs:row.postMs,visualMs:row.ms,totalMs:row.totalMs,reusedIntent:row.reusedIntent,expression:state.characters[name].expression,intent:row.intent}));
 }
}catch(error){await fs.writeFile(output,JSON.stringify({error:error.message,results,calls,diagnostics:runtime.diagnostics.errors},null,2));throw error;}
finally{runtime.visualDirector?.close();globalThis.fetch=realFetch;}
