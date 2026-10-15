import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveMemories } from '../src/memory/retrieval.js';
import { eligibleMemory, projectState, sceneViewers } from '../src/memory/policy.js';
import { activeMemories } from '../src/state/history.js';
import { StateManager } from '../src/state/manager.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';
import { configureSession } from '../src/memory/session.js';
import { VectorSearch } from '../src/memory/vectorSearch.js';
import { textHash } from '../src/memory/semantic.js';

const memory = (extra = {}) => ({ id: 'm', text: 'public memory', summary: 'public memory', visibleTo: ['*'], campaignId: 'world', sessionId: 'ne-a1', status: 'current', type: 'event', entities: ['A'], importance: 0.5, ...extra });
const policy = { viewers: ['C'], campaignId: 'world', sessionId: 'ne-a1', mode: 'session_only' };

test('G3 hard filters run before ranking, default legacy visibility is denied', () => {
    const candidates = [memory({ id: 'secret', visibleTo: ['A','B'], importance: 1 }), memory({ id: 'other-world', campaignId: 'elsewhere' }), memory({ id: 'other-session', sessionId: 'ne-b2' }), memory({ id: 'disputed', status: 'disputed' }), memory({ id: 'legacy', visibleTo: undefined }), memory({ id: 'public' })];
    const found = retrieveMemories(candidates, { message: 'secret', characters:['A'] }, { policy, topK: 20 });
    assert.deepEqual(found.map(m => m.id), ['public']);
    assert.equal(eligibleMemory(memory({ visibleTo: ['A'] }), { viewers: ['A','C'] }), false);
    assert.equal(eligibleMemory(memory({ unknown_to: ['C'] }), policy), false);
    assert.equal(eligibleMemory(memory({ gameTime: '2027-01-01T12:00' }), { ...policy, through: '2026-01-01T00:00' }), false);
});

test('G3/G23 shared state removes private feelings, secrets, provenance and off-scene entities', () => {
    const state = { scene: { location: 'room', present: ['C'], hidden: 'SECRET' }, timeline: { date: '2026-01-01', scheduled: ['SECRET'] },
        characters: { C: { position: 'door', feelings: 'SECRET' }, A: { internal: 'SECRET' } },
        knowledge: { private: { truth: 'SECRET', visibleTo: ['A'] }, public: { truth: 'open door', visibleTo: ['*'] } },
        threads: { secret: { goal: 'SECRET' } }, provenance: { secret: 'SECRET' },
        entities: { hidden: { id: 'hidden', name: 'SECRET', status: 'active' }, C: { id: 'C', type: 'character', name: 'C', status: 'active', params: { mood: 'SECRET' } } } };
    const projected = projectState(state, ['C']);
    assert.ok(!JSON.stringify(projected).includes('SECRET')); assert.equal(projected.knowledge.public.truth, 'open door');
    assert.deepEqual(sceneViewers(state, [{ name: 'A' }], false), ['C']);
    assert.deepEqual(sceneViewers(state, [{ name: 'A' }]), ['C','A']);
});

test('G18 supersession is derived from accepted records and reverses with branch rollback', () => {
    const records = [
        { deltaId: 'a', campaignId: 'world', sessionId: 'ne-a1', memories: [memory({ factKey: 'phone.owner' })] },
        { deltaId: 'b', campaignId: 'world', sessionId: 'ne-a1', memories: [memory({ factKey: 'phone.owner', text: 'new owner', summary: 'new owner' })] },
    ];
    const result = activeMemories(records);
    assert.equal(result[0].status, 'superseded'); assert.equal(result[0].supersededBy, result[1].id);
    assert.deepEqual(retrieveMemories(result, {characters:['A']}, { policy }).map(m => m.id), ['b:memory:0']);
    assert.equal(activeMemories(records.slice(0,1))[0].status, 'current');
    assert.equal(records[0].memories[0].status, 'current');
    assert.equal(retrieveMemories(result, {characters:['A']}, { policy: { ...policy, history: true }, minScore: -Infinity }).length, 2);
});

test('G20 campaign snapshot inherits state and open threads; selective and session-only isolate', async () => {
    const storage = new MemoryStorageAdapter(), first = new StateManager({ storage, chatFingerprint: 'ne-a1' });
    await configureSession(first, { mode: 'campaign', campaignId: 'world' });
    await first.recordTurn({ scene: { location: 'harbor' }, threads: { open: { status: 'active', visibleTo: ['*'] }, closed: { status: 'resolved' } } }, { idempotencyKey: 'one', messageIndex: 1 }, { memories: [memory({ type: 'fact' }), memory({ id: 'private', visibleTo: ['A'], type: 'belief' })] });
    const next = new StateManager({ storage, chatFingerprint: 'ne-b2' });
    await configureSession(next, { mode: 'campaign', campaignId: 'world', fromSession: 'ne-a1' });
    assert.equal(next.state.scene.location, 'harbor'); assert.equal(next.state.threads.closed, undefined);
    assert.equal(retrieveMemories(next.memories, {characters:['A']}, { policy: { ...next.scope, viewers: ['C'] } }).length, 1);
    const reloaded = new StateManager({ storage, chatFingerprint: 'ne-b2' }); await reloaded.load(); await reloaded.selectBranch([]);
    assert.deepEqual(reloaded.snapshot(), next.snapshot()); assert.deepEqual(reloaded.scope, next.scope);
    const selective = new StateManager({ storage, chatFingerprint: 'ne-c3' });
    await configureSession(selective, { mode: 'selective', campaignId: 'world', fromSession: 'ne-a1', types: ['fact'] });
    assert.equal(selective.memories.length, 1); assert.deepEqual(selective.state.scene, {});
    const separate = new StateManager({ storage, chatFingerprint: 'ne-d4' });
    await configureSession(separate, { mode: 'session_only', campaignId: 'world', fromSession: 'ne-a1' });
    assert.deepEqual(separate.memories, []);
    await assert.rejects(configureSession(first, { mode: 'campaign', campaignId: 'other' }), /first accepted/);
    await assert.rejects(configureSession(separate, { mode: 'campaign', campaignId: 'other', fromSession: 'ne-a1' }), /outside/);
});

test('inherited facts are superseded by this session and restored when its turn is removed', async () => {
    const manager = new StateManager();
    await manager.importData({ chatFingerprint: 'default', state: manager.snapshot(), memories: [memory({ factKey: 'key', id: 'inherited' })] });
    const ref = { idempotencyKey: 'new', messageIndex: 1 };
    await manager.recordTurn({}, ref, { memories: [memory({ factKey: 'key' })] });
    assert.equal(manager.memories[0].status, 'superseded');
    await manager.selectBranch([]); assert.equal(manager.memories[0].status, 'current');
});

test('vector search sends only eligible texts, validates batches, ranks and applies budget', async () => {
    const calls = [];
    const vector = new VectorSearch({}, 'ne-a1', async (_url, options) => {
        const { texts } = JSON.parse(options.body); calls.push(texts);
        return { ok: true, json: async () => ({ model: 'test', hashes: await Promise.all(texts.map(textHash)), vectors: texts.map((_, i) => i === 2 ? [1,0] : [0,1]) }) };
    });
    const items = [memory({ id: 'secret', visibleTo: ['A'], text: 'SECRET' }), memory({ id: 'first' }), memory({ id: 'second' })];
    const result = await vector.search(items, { message: 'query' }, { policy, topK: 2 });
    assert.ok(!JSON.stringify(calls).includes('SECRET')); assert.equal(result[0].id, 'first');
    assert.deepEqual(await vector.search(items, {characters:['A']}, { policy, tokenBudget: 0 }), []);
    vector.fetch = async () => ({ ok: true, json: async () => ({ vectors: [[1]], hashes: [] }) });
    await assert.rejects(vector.search(items, {characters:['A']}, { policy }), /Invalid/);
});


test('secret corrections preserve the unaware recipient recollection without exposing hidden successors', async () => {
    const {projectMemoryStatuses} = await import('../src/state/history.js');
    const {audienceMemories} = await import('../src/memory/policy.js');
    const items=projectMemoryStatuses([
        memory({id:'old',text:'Key is in the kitchen',factKey:'key.location',visibleTo:['A','B']}),
        memory({id:'secret',text:'SECRET_BEDROOM',factKey:'key.location',visibleTo:['A']}),
    ]);
    const options = viewers => ({policy:{...policy,viewers},topK:10});
    const b = retrieveMemories(items,{message:'key kitchen'},options(['B']));
    assert.equal(b.length,1);assert.equal(b[0].id,'old');assert.equal(b[0].type,'belief');
    assert.equal(b[0].epistemicStatus,'last_known');assert.equal(b[0].supersededBy,undefined);
    assert.doesNotMatch(JSON.stringify(b),/SECRET_BEDROOM|secret/);
    assert.deepEqual(retrieveMemories(items,{characters:['A']},options(['A'])).map(m=>m.id),['secret']);
    assert.deepEqual(retrieveMemories(items,{characters:['A']},options(['A','B'])),[]);
    assert.equal(items[0].status,'superseded');
    const later=projectMemoryStatuses([...items,memory({id:'learned',text:'Key is now in bedroom',factKey:'key.location',visibleTo:['A','B']})]);
    assert.deepEqual(retrieveMemories(later,{characters:['A']},options(['B'])).map(m=>m.id),['learned']);
    assert.equal(audienceMemories(items,{viewers:['B']})[0].supersededBy,undefined);
    const vector=new VectorSearch({},'ne-a1',async(_url,options)=>{
        const {texts}=JSON.parse(options.body);assert.ok(!texts.some(t=>t.includes('SECRET_BEDROOM')));
        return {ok:true,json:async()=>({model:'test',hashes:await Promise.all(texts.map(textHash)),vectors:texts.map(()=>[1,0])})};
    });
    assert.equal((await vector.search(items,{characters:['A']},options(['B'])))[0].epistemicStatus,'last_known');
});

test('only author-declared public typed parameters reach RP continuity',async()=>{
    const {applyStateDelta,createInitialState}=await import('../src/state/model.js');
    const {buildAutonomyPacket}=await import('../src/director/autonomy.js');
    const ops=[
        {op:'define_parameter',definition:{key:'clothing',label:'Clothing',type:'string',scope:['character'],visibility:'public'}},
        {op:'define_parameter',definition:{key:'secret',label:'Secret',type:'string',scope:['character']}},
        {op:'create_entity',entity:{id:'A',name:'A',type:'character',params:{clothing:'torn red dress',secret:'HIDDEN_THOUGHT'}}},
    ];
    const state=applyStateDelta(createInitialState(),{ops},{source:'author'});
    assert.deepEqual(projectState(state,['A']).entities.A.params,{clothing:'torn red dress'});
    const packet=buildAutonomyPacket({state:projectState(state,['A'])}).packet;
    assert.match(packet,/torn red dress/);assert.doesNotMatch(packet,/HIDDEN_THOUGHT/);
    assert.throws(()=>applyStateDelta(state,{ops:[{op:'update_parameter',key:'secret',patch:{visibility:'public'}}]}),/author/);
    const hidden=applyStateDelta(state,{ops:[{op:'update_parameter',key:'clothing',patch:{visibility:'private'}}]},{source:'author'});
    assert.deepEqual(projectState(hidden,['A']).entities.A.params,{});
    const legacy=structuredClone(state);delete legacy.registry.parameters.clothing.visibility;
    assert.deepEqual(projectState(legacy,['A']).entities.A.params,{});
});


test('corrections outside session or future time do not suppress local remembered knowledge',async()=>{
    const {projectMemoryStatuses}=await import('../src/state/history.js');
    const items=projectMemoryStatuses([
        memory({id:'local',text:'Local understanding',factKey:'fact',visibleTo:['B'],gameTime:'2026-01-01T10:00'}),
        memory({id:'other',text:'Other session change',factKey:'fact',visibleTo:['B'],sessionId:'ne-other',gameTime:'2026-01-02T10:00'}),
    ]);
    const options={policy:{...policy,viewers:['B']}};
    assert.deepEqual(retrieveMemories(items,{characters:['A']},options).map(m=>m.id),['local']);
    assert.deepEqual(retrieveMemories(items,{characters:['A']}, {policy:{...options.policy,mode:'campaign'}}).map(m=>m.id),['other']);
    assert.deepEqual(retrieveMemories(items,{characters:['A']}, {policy:{...options.policy,mode:'campaign',through:'2026-01-01T12:00'}}).map(m=>m.id),['local']);
});


test('vector retrieval refills the budget and skips transport for an empty query', async()=>{
    let calls=0;
    const vector=new VectorSearch({},'ne-a1',async(_url,options)=>{
        calls++;
        const {texts}=JSON.parse(options.body);
        return {ok:true,json:async()=>({model:'test',hashes:await Promise.all(texts.map(textHash)),scores:texts.map((_,i)=>i===1?0.99:0.8)})};
    });
    const items=[memory({id:'long',text:'promise '.repeat(1000),importance:1}),memory({id:'short',text:'promise'})];
    assert.deepEqual(await vector.search(items,{}, {policy}),[]);assert.equal(calls,0);
    assert.deepEqual((await vector.search(items,{message:'pledge'},{policy,topK:1,tokenBudget:100})).map(m=>m.id),['short']);
});
