'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {Database}=require('../lib/database');const {VisualQueue,buildWorkflow}=require('../lib/visual');
const recipe={workflow:{'1':{class_type:'TestNode',inputs:{text:'',seed:0,control:false}}},bindings:[{node:'1',input:'text',source:'positive'},{node:'1',input:'seed',source:'seed'}],stages:{controlnet:{on:[{node:'1',input:'control',value:true}],off:[{node:'1',input:'control',value:false}]}}};
const input=()=>({requestKey:'request-1',workflow:'scene_full',seed:42,scene:{sceneId:'a'.repeat(64),location:{id:'cafe'},characters:[],keyObjects:[],preserve:[]},stages:{controlnet:false}});
function fixture(t,api){const db=new Database({storageRoot:process.cwd(),databasePath:':memory:'});const q=new VisualQueue({},db,{recipes:{scene_full:recipe}});q.api=api;t.after(()=>{q.close();db.close();});return {q,db};}
function due(q,id){const j=q.get('user:chat',id,true);j.nextPoll=0;q.save(j);}
test('workflow bindings preserve fixed graph and independently toggle configured stages',()=>{
 const a=buildWorkflow(recipe,input()),b=buildWorkflow(recipe,{...input(),stages:{controlnet:true}});assert.equal(a['1'].inputs.seed,42);assert.equal(b['1'].inputs.control,true);assert.equal(recipe.workflow['1'].inputs.seed,0);
 assert.throws(()=>buildWorkflow(recipe,{...input(),stages:{ipadapter:true}}),/no stage/);
});
test('queue progresses to done, is idempotent and isolates users',async t=>{
 let posts=0;const {q}=fixture(t,async(route)=>{if(route==='/prompt'){posts++;return {prompt_id:'remote'};}return {remote:{status:{completed:true},outputs:{'1':{images:[{filename:'a.png',type:'output',subfolder:''}]}}}};});
 const first=q.enqueue('user:chat',input());assert.equal(q.enqueue('user:chat',input()).id,first.id);assert.throws(()=>q.get('another:chat',first.id),/not found/);
 await q.tick();assert.equal(q.get('user:chat',first.id).status,'running');due(q,first.id);await q.tick();assert.equal(q.get('user:chat',first.id).status,'done');assert.equal(posts,1);assert.equal(q.get('user:chat',first.id).outputs.length,1);
});
test('G17 lost submission acknowledgement ends without unsafe duplicate POST',async t=>{
 let calls=0;const {q}=fixture(t,async()=>{calls++;throw new Error('timeout');});const job=q.enqueue('user:chat',input());await q.tick();await q.tick();assert.equal(q.get('user:chat',job.id).status,'failed_final');assert.equal(calls,1);
});
test('safe history GET retries are bounded and never resubmit the workflow',async t=>{
 let posts=0;const {q}=fixture(t,async route=>{if(route==='/prompt'){posts++;return {prompt_id:'remote'};}throw new Error('offline');});const job=q.enqueue('user:chat',input());await q.tick();for(let i=0;i<3;i++){due(q,job.id);await q.tick();}assert.equal(q.get('user:chat',job.id).status,'failed_final');assert.equal(posts,1);
});
test('restart resumes known prompt IDs and terminates ambiguous submissions',async t=>{
 const {q,db}=fixture(t,async()=>({prompt_id:'remote'}));const job=q.enqueue('user:chat',input());await q.tick();
 const unknown=q.enqueue('user:chat',{...input(),requestKey:'request-2'});const raw=q.get('user:chat',unknown.id,true);q.transition(raw,'running');
 const next=new VisualQueue({},db,{recipes:{scene_full:recipe}});t.after(()=>next.close());assert.equal(next.get('user:chat',job.id).promptId,'remote');assert.equal(next.get('user:chat',unknown.id).status,'failed_final');
});
test('invalid workflow and empty outputs are terminal failures, not fake success',async t=>{
 const {q}=fixture(t,async route=>route==='/prompt'?{prompt_id:'remote'}:{remote:{status:{completed:true},outputs:{}}});const missing=q.enqueue('user:chat',{...input(),workflow:'missing'});assert.equal(missing.status,'failed_final');
 const job=q.enqueue('user:chat',{...input(),requestKey:'request-2'});await q.tick();due(q,job.id);await q.tick();assert.equal(q.get('user:chat',job.id).status,'failed_final');
});

test('Comfy transport pins configured host and image reads require the owning scope',async t=>{
 const db=new Database({storageRoot:process.cwd(),databasePath:':memory:'});let sent;
 const q=new VisualQueue({comfyUrl:'http://127.0.0.1:8188/comfy',comfyKey:'test-secret',timeoutMs:1000},db,{
  recipes:{scene_full:recipe},validateProviderUrl:async url=>({url,addresses:[{address:'127.0.0.1',family:4}]}),
  requestJson:async(...args)=>{sent=args;return {bytes:Buffer.from('image')};}
 });t.after(()=>{q.close();db.close();});
 const job=q.enqueue('user:chat',input()),raw=q.get('user:chat',job.id,true);
 q.transition(raw,'done',{outputs:[{filename:'frame name.png',subfolder:'scene',type:'output'}]});
 await assert.rejects(q.image('other:chat',job.id,0),/not found/);assert.equal(sent,undefined);
 await q.image('user:chat',job.id,0);
 assert.equal(sent[0].origin,'http://127.0.0.1:8188');assert.equal(sent[0].pathname,'/comfy/view');
 assert.equal(sent[0].searchParams.get('filename'),'frame name.png');assert.equal(sent[1].headers.authorization,'Bearer test-secret');assert.equal(sent[6],true);
});
test('real SQLite close and reopen resumes a job without submitting it twice',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ne-visual-'));const config={storageRoot:root,databasePath:path.join(root,'visual.sqlite')};
 let db=new Database(config),q=new VisualQueue({},db,{recipes:{scene_full:recipe}}),posts=0;
 q.api=async()=>{posts++;return {prompt_id:'persisted'};};const job=q.enqueue('user:chat',input());await q.tick();q.close();db.close();
 db=new Database(config);q=new VisualQueue({},db,{recipes:{scene_full:recipe}});
 t.after(()=>{q.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 q.api=async route=>{assert.equal(route,'/history/persisted');return {persisted:{status:{completed:true},outputs:{'1':{images:[{filename:'frame.png',type:'output'}]}}}};};
 due(q,job.id);await q.tick();assert.equal(q.get('user:chat',job.id).status,'done');assert.equal(posts,1);
});
