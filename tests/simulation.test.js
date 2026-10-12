import { resolveGenerationRecipient } from '../src/context/stContext.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, applyStateDelta } from '../src/state/model.js';
import { SIMULATION_DEFAULTS, pendingReactions } from '../src/state/simulation.js';
import { innerLifeContext, prepareSimulation, inspectionState, inspectionPacket, postSimulationState } from '../src/state/simulationContext.js';
import { buildDirectorPacket } from '../src/director/packet.js';
import { StateManager } from '../src/state/manager.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';
import { normalizeSettings } from '../src/settings.js';

const policy={...SIMULATION_DEFAULTS,innerLifeMode:'full',activeCharacters:['Anna','Bob'],playerIds:['Player'],characterEnabled:true,relationshipsEnabled:true};
const initial=()=>createInitialState({characters:{Anna:{},Bob:{},Player:{}},scene:{location:'hall',present:['Anna','Bob']},timeline:{date:'2026-03-02',time:'21:00',elapsedMinutes:0,scheduled:[]}});
const event=(id='e1',significance=0.9)=>({id,kind:'humiliation',summary:'Bob mocks Anna in public',participants:['Anna','Bob'],visibleTo:['Anna','Bob'],significance,status:'occurred'});
const appraisal=(id='e1',meaning='Threat to belonging')=>({eventId:id,meaning,significance:0.9,confidence:0.9});
const reaction=(id='Anna',type='anxiety',eventId='e1')=>({characterId:id,basis:'character_appraisal',consistency:{valid:true,reason:'Cautious profile and prior rejection'},appraisals:[appraisal(eventId)],emotions:[{type,intensity:0.8,causeEventId:eventId,decay:'exponential',halfLifeMinutes:60}],mood:{valence:-0.3,arousal:0.6},expressedVsFelt:{expressed:['a brief smile'],felt:['anxiety'],maskingLevel:0.8}});
const apply=(state,input={},delta={})=>applyStateDelta(state,{...delta,simulation:{policy,...input}},{source:'director'});

test('G21 significant event creates personal appraisal, hidden emotions and durable aftermath',()=>{
 const state=apply(initial(),{events:[event()],characters:[reaction()]});
 const c=state.simulation.characters.Anna;
 assert.equal(c.appraisals[0].eventId,'e1');assert.equal(c.emotions[0].intensity,0.8);
 assert.equal(c.pendingProcessing[0].dueGameTime,'2026-03-03T08:00');
 const ctx=innerLifeContext(state,[{name:'Anna'}],{characterState:true,innerLifeMode:'full'},['Anna','Bob']);
 assert.equal(ctx.own.characterId,'Anna');assert.match(buildDirectorPacket({inner_life:ctx.own},1000),/anxiety/);
});

test('G4/G26 a transient emotion never changes durable relationships',()=>{
 const e=event('startle',0.1),r=reaction('Anna','fear','startle');r.appraisals[0].significance=0.1;
 const state=apply(initial(),{events:[e],characters:[r]});assert.deepEqual(state.relationships,{});
 assert.throws(()=>apply(state,{relationships:[{from:'Anna',to:'Bob',dimension:'trust',delta:-0.1,eventIds:['startle'],interpretation:'A fright',confidence:0.9}]}),/threshold/);
});

test('G5 repeated humiliation changes directed trust, bounded once per causal evidence',()=>{
 let state=initial();for(let i=1;i<=3;i++)state=apply(state,{events:[event(`e${i}`,0.2)]});
 const change={from:'Anna',to:'Bob',dimension:'trust',delta:-0.8,eventIds:['e1','e2','e3'],interpretation:'Repeated public humiliation',confidence:0.9};
 state=apply(state,{relationships:[change,{...change,dimension:'affection',delta:-0.4}]});
 const pair=state.relationships['["Anna","Bob"]'];assert.equal(pair.dimensions.trust,0.35);assert.equal(pair.dimensions.affection,0.5);
 assert.equal(pair.history[0].eventIds.length,3);assert.equal(state.relationships['["Bob","Anna"]'],undefined);
 assert.throws(()=>apply(state,{relationships:[change]}),/already consumed/);
});

test('G22/G14 overnight advances decay, weather, conditional events and daily schedules',()=>{
 let state=apply(initial(),{policy:{...policy,simulationLevel:'living'},events:[event(),{...event('rain',0),status:'scheduled',dueGameTime:'next_morning',effects:{weather:'rain'}},{...event('bell',0),status:'scheduled',condition:{eventId:'rain'}}],characters:[reaction()],schedules:[{id:'work',characterId:'Bob',at:'08:00',activity:'open shop',location:'shop',visibleTo:['*']}]});
 state=apply(state,{policy:{...policy,simulationLevel:'living',activeCharacters:[]}},{time_advance_minutes:660});
 assert.equal(state.timeline.time,'08:00');assert.equal(state.scene.weather,'rain');assert.equal(state.scene.lighting,'day');
 assert.equal(state.simulation.events.rain.status,'occurred');assert.equal(state.simulation.events.bell.status,'occurred');assert.equal(state.npc_plans.Bob.activity,'open shop');
 assert.equal(state.simulation.characters.Anna.emotions.length,0);assert.equal(pendingReactions(state,['Anna']).Anna[0].status,'due');
 const reconsider=reaction();reconsider.processing=[{eventId:'e1',interpretation:'After sleeping she seeks reassurance'}];
 state=apply(state,{characters:[reconsider]});assert.equal(state.simulation.characters.Anna.pendingProcessing[0].status,'processed');
 assert.equal(state.simulation.characters.Anna.pendingProcessing.length,1);
});

test('G23 another recipient and ambiguous group receive observations without hidden anxiety',()=>{
 const state=apply(initial(),{events:[event()],characters:[reaction()]});
 const bob=innerLifeContext(state,[{name:'Bob'}],{characterState:true,innerLifeMode:'full'},['Anna','Bob']);
 assert.equal(bob.own,null);assert.match(JSON.stringify(bob),/brief smile/);assert.doesNotMatch(JSON.stringify(bob),/anxiety|Threat to belonging/);
 assert.equal(innerLifeContext(state,[{name:'Anna'},{name:'Bob'}],{characterState:true,innerLifeMode:'full'},['Anna','Bob']).own,null);
});

test('G24 per-character appraisals and mixed emotions remain distinct',()=>{
 const a=reaction(),b=reaction('Bob','amusement');b.appraisals=[appraisal('e1','A harmless joke according to his playful profile')];b.consistency.reason='Playful profile';
 b.emotions.push({...b.emotions[0],type:'regret',intensity:0.2});
 const state=apply(initial(),{events:[event()],characters:[a,b]});
 assert.notEqual(state.simulation.characters.Anna.appraisals[0].meaning,state.simulation.characters.Bob.appraisals[0].meaning);
 assert.equal(state.simulation.characters.Bob.emotions.length,2);
});

test('G25 agency, unknown causes and character breaks reject atomically',()=>{
 const base=initial();
 for(const r of [{...reaction(),basis:'player_assertion'},reaction('Player'),{...reaction(),consistency:{valid:false,reason:'Contradicts established profile'}}]) assert.throws(()=>apply(base,{events:[event()],characters:[r]}),/agency|author-controlled|consistency/);
 assert.throws(()=>apply(base,{characters:[reaction()]}),/cause/);assert.equal(base.simulation,undefined);
});

test('G27 off/light/full and background detail are selective and packet remains bounded',()=>{
 for(const mode of ['off','light','full']) {
  const state=apply(initial(),{policy:{...policy,innerLifeMode:mode,activeCharacters:['Anna']},events:[event()],characters:[reaction(),reaction('Bob','amusement')]});
  assert.equal(state.simulation.characters.Bob.detail,'background');assert.equal(state.simulation.characters.Bob.appraisals.length,0);
  assert.equal(state.simulation.characters.Anna.pendingProcessing.length,mode==='full'?1:0);
  assert.equal(state.simulation.characters.Anna.appraisals.length,mode==='off'?0:1);
 }
 const packet=buildDirectorPacket({inner_life:{text:'x'.repeat(20000)},scene:{location:'hall'},relevant_memories:['safe']},500);
 assert.ok(Math.ceil(packet.length/4)<=500);assert.match(packet,/hall/);
});

test('minimal world leaves scheduled events pending; standard excludes NPC schedules',()=>{
 for(const mode of ['minimal','standard']) {
  const state=apply(initial(),{policy:{...policy,simulationLevel:mode},events:[{...event('rain',0),status:'scheduled',dueGameTime:'2026-03-02T21:00',effects:{weather:'rain'}}],schedules:[{id:'work',characterId:'Bob',at:'08:00',activity:'work',visibleTo:['*']}]});
  assert.equal(state.scene.weather,mode==='minimal'?undefined:'rain');assert.deepEqual(state.npc_plans,{});
 }
});

test('bounded time rejects backwards and excessive jumps including direct date patches',()=>{
 assert.throws(()=>apply(initial(),{},{time_advance_minutes:-1}),/bounds/);
 assert.throws(()=>apply(initial(),{},{timeline:{date:'2027-01-01'}}),/bounds/);
 assert.throws(()=>apply(initial(),{},{timeline:{date:'2026-02-30'}}),/invalid game/);
 assert.equal(apply(initial(),{policy:{...policy,maxTurnMinutes:3000}},{time_advance_minutes:2880}).timeline.date,'2026-03-04');
});

test('turn journal survives reload, rollback and reactivation without repeated emotional processing',async()=>{
 const storage=new MemoryStorageAdapter();let manager=new StateManager({storage,chatFingerprint:'ne-emotion'});
 await manager.importData({chatFingerprint:'ne-emotion',state:initial(),memories:[]});
 const one={idempotencyKey:'one',messageIndex:1},two={idempotencyKey:'two',messageIndex:3};
 assert.equal(await manager.recordTurn({simulation:{policy,events:[event()],characters:[reaction()]}},one),'confirmed');
 const old=manager.snapshot();
 assert.equal(await manager.recordTurn({time_advance_minutes:660,simulation:{policy:{...policy,activeCharacters:[]}}},two),'confirmed');
 const morning=manager.snapshot();manager=new StateManager({storage,chatFingerprint:'ne-emotion'});await manager.load();assert.deepEqual(manager.snapshot(),morning);
 await manager.selectBranch([one]);assert.deepEqual(manager.snapshot(),old);
 await manager.selectBranch([one,two]);assert.deepEqual(manager.snapshot(),morning);
});

test('runtime contract quotes current evidence and rejects legacy relationship bypass',()=>{
 const post={simulation_delta:{events:[{...event(),evidence:{source:'rp',quote:'Bob mocks Anna'}}]}};
 assert.doesNotThrow(()=>prepareSimulation(post,{},initial(),policy,{rp:'Bob mocks Anna',user:''}));
 assert.throws(()=>prepareSimulation(post,{},initial(),policy,{rp:'different text',user:''}),/evidence/);
 assert.throws(()=>prepareSimulation({relationship_delta:[{}]}, {},initial(),policy,{}),/causal/);
 assert.throws(()=>prepareSimulation({}, {characters:{Anna:{emotions:[]}}},initial(),policy,{}),/internal/);
});

test('simulation settings clamp numerical bounds and reject unknown modes',()=>{
 const s=normalizeSettings({innerLifeMode:'invented',simulationLevel:'random',minTurnMinutes:20,maxTurnMinutes:2,repetitionThreshold:2.7,relationshipMaxChange:50});
 assert.equal(s.innerLifeMode,'light');assert.equal(s.simulationLevel,'standard');assert.equal(s.maxTurnMinutes,20);assert.equal(s.repetitionThreshold,3);assert.equal(s.relationshipMaxChange,1);
});


test('full active reactions must be reconsidered on the time-jump turn',()=>{
 const state=apply(initial(),{events:[event()],characters:[reaction()]});
 assert.throws(()=>apply(state,{},{time_advance_minutes:660}),/due emotional processing required/);
 const r=reaction();r.processing=[{eventId:'e1',interpretation:'New morning perspective'}];
 assert.equal(apply(state,{characters:[r]},{time_advance_minutes:660}).simulation.characters.Anna.pendingProcessing[0].status,'processed');
});


test('private inspection is opt-in while exported state and persistence stay complete',()=>{
 const state=apply(initial(),{events:[event()],characters:[reaction()]});
 const runtime={settings:{showInternalState:false},stateManager:{snapshot:()=>structuredClone(state)},diagnostics:{lastPacket:buildDirectorPacket({inner_life:{felt:'secret-anxiety'},scene:{location:'hall'}})}};
 assert.doesNotMatch(JSON.stringify(inspectionState(runtime).simulation.characters),/anxiety/);
 assert.doesNotMatch(inspectionPacket(runtime),/secret-anxiety/);assert.match(inspectionPacket(runtime),/hall/);
 runtime.settings.showInternalState=true;assert.match(inspectionPacket(runtime),/secret-anxiety/);assert.equal(inspectionState(runtime).simulation.characters.Anna.emotions.length,1);
 assert.equal(postSimulationState(state,{activeCharacters:['Bob']}).simulation.characters.Anna.appraisals,undefined);
});

test('invalid imported emotion cannot corrupt an existing saved simulation',async()=>{
 const manager=new StateManager({chatFingerprint:'ne-import'});
 const state=apply(initial(),{events:[event()],characters:[reaction()]});
 await manager.importData({chatFingerprint:'ne-import',state});const before=manager.snapshot();
 state.simulation.characters.Anna.emotions[0].intensity=2;
 await assert.rejects(manager.importData({chatFingerprint:'ne-import',state}),/outside/);assert.deepEqual(manager.snapshot(),before);
});


test('G23 group generation selects only the current member, never the player impersonation',()=>{
 const state=apply(initial(),{events:[event()],characters:[reaction()]});
 const participants=[{name:'Anna',avatar:'a.png'},{name:'Bob',avatar:'b.png'}];
 const context={groupId:'g',groups:[{id:'g',members:['a.png','b.png']}],characters:participants,characterId:0};
 const settings={characterState:true,innerLifeMode:'full'};
 let target=resolveGenerationRecipient(context);
 assert.equal(innerLifeContext(state,participants,settings,['Anna','Bob'],target).own.characterId,'Anna');
 context.characterId=1;target=resolveGenerationRecipient(context);
 assert.equal(innerLifeContext(state,participants,settings,['Anna','Bob'],target).own,null);
 context.characterId=0;assert.equal(resolveGenerationRecipient(context,'impersonate'),null);
 context.characterId=undefined;assert.equal(resolveGenerationRecipient(context),null);
 context.characterId=0;context.groups[0].members=['b.png'];assert.equal(resolveGenerationRecipient(context),null);
});


test('scheduled event fires before appraisal on the same accepted time-jump turn',()=>{
 let state=apply(initial(),{events:[{...event('alarm',0.9),status:'scheduled',dueGameTime:'next_morning'}]});
 const r=reaction('Anna','fear','alarm');
 state=apply(state,{characters:[r]},{time_advance_minutes:660});
 assert.equal(state.simulation.events.alarm.status,'occurred');assert.equal(state.simulation.characters.Anna.emotions[0].causeEventId,'alarm');
});

test('explicit author profile correction is journaled and replayed without changing the source',async()=>{
 const manager=new StateManager({chatFingerprint:'ne-profile'});
 await manager.importData({chatFingerprint:'ne-profile',state:initial()});
 const profile={age:22,traits:{temperament:'reserved',values:['honesty']},formativeExperiences:[{id:'bio1',summary:'A broken promise',salience:0.8}],behaviorTendencies:{likelyTo:['ask for time'],unlikelyTo:['trust instantly']}};
 await manager.authorEdit([],'Initial profile',{characters:[{characterId:'Anna',profile}]});
 const original=manager.snapshot();profile.traits.temperament='changed';
 await manager.selectBranch([]);assert.deepEqual(manager.snapshot(),original);
 assert.equal(manager.records[0].source,'author');assert.equal(manager.snapshot().simulation.characters.Anna.profile.traits.temperament,'reserved');
});
