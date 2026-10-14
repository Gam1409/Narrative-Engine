'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {Database}=require('../lib/database');const {VisualQueue}=require('../lib/visual');
const recipe=()=>({operation:'illustration',version:1,outputNode:'1',workflow:{1:{class_type:'SaveImage',inputs:{text:'',seed:0}}},bindings:[{node:'1',input:'text',source:'positive'}]});
function fixture(t){const db=new Database({storageRoot:process.cwd(),databasePath:':memory:'});const q=new VisualQueue({},db);t.after(()=>{q.close();db.close();});return q;}
const input=()=>({requestKey:'one',workflow:'user-demo',customRecipe:recipe(),seed:1,scene:{sceneId:'a'.repeat(64),location:{id:'kitchen'},characters:[],keyObjects:[],preserve:[]}});
test('custom recipe stays scoped to submitted job and goes through server preflight',async t=>{
 const q=fixture(t);let posts=0;q.api=async route=>{if(route==='/object_info')return {Other:{}};posts++;throw Error('must not submit');};
 const job=q.enqueue('user:one',input());assert.equal(job.status,'queued');
 assert.ok(q.get('user:one',job.id,true).graph['1'].inputs.text.includes('kitchen'));
 assert.throws(()=>q.get('other:chat',job.id),/not found/);
 assert.equal(q.enqueue('user:one',input()).id,job.id);
 await q.tick();assert.equal(q.get('user:one',job.id).status,'failed_final');assert.equal(posts,0);
 assert.equal(q.recipes['user-demo'],undefined);
});
test('custom graphs cannot override server recipes, skip operation or silently lose LoRA',t=>{
 const q=fixture(t);
 for(const [i,patch] of [{workflow:'scene_full'},{customRecipe:{...recipe(),operation:'sprite'}},{customRecipe:{...recipe(),outputNode:'missing'}},{customRecipe:{...recipe(),bindings:[]}}].entries()){
 const job=q.enqueue('user:one',{...input(),...patch,requestKey:String(i)});assert.equal(job.status,'failed_final');
 }
 const data=input();data.requestKey='lora';data.scene.characters=[{id:'Anna',profile:{lora:[{name:'anna.safetensors',family:'sdxl',weight:1}]}}];
 assert.match(q.enqueue('user:one',data).error,/LoRA slots/);
});

test('prompt chips render into exactly the selected input and preserve literal text',t=>{
 const q=fixture(t);const data=input();data.userPositive='fine fabric';data.userNegative='watermark';
 data.customRecipe.workflow['1'].inputs.other='untouched';
 data.customRecipe.bindings[0].template='{{userPositive}}\n{{positive}}\ncustom detail';
 const job=q.enqueue('u:c',data);assert.equal(job.status,'queued');
 const graph=q.get('u:c',job.id,true).graph;
 assert.match(graph['1'].inputs.text,/^fine fabric\n/);assert.match(graph['1'].inputs.text,/kitchen/);assert.match(graph['1'].inputs.text,/custom detail$/);assert.equal(graph['1'].inputs.other,'untouched');
 const invalid=input();invalid.requestKey='bad';invalid.customRecipe.bindings[0].template='{{system}}';
 assert.equal(q.enqueue('u:c',invalid).status,'failed_final');
});


test('standalone workflow check only reads fresh inventory and never creates a job', async t => {
 const q=fixture(t), calls=[];
 const data=input();data.endpoint='https://comfy.example';
 data.customRecipe.workflow['2']={class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'old.safetensors'}};
 data.customRecipe.checkpointBinding={node:'2',input:'ckpt_name'};data.checkpoint='installed.safetensors';
 const before=structuredClone(data);
 q.api=async (...args)=>{calls.push(args);return {
  SaveImage:{input:{required:{text:['STRING'],seed:['INT']}},output_node:true},
  CheckpointLoaderSimple:{input:{required:{ckpt_name:[['installed.safetensors']]}},output:['MODEL']}
 };};
 const result=await q.checkWorkflow(data);
 assert.equal(result.ok,true);assert.equal(result.scope,'saved-graph-inventory');assert.deepEqual(data,before);
 assert.equal(q.db.prepare('SELECT COUNT(*) AS n FROM visual_jobs').get().n,0);
 await q.checkWorkflow(data);assert.equal(calls.length,2);
 for(const call of calls){assert.equal(call[0],'/object_info');assert.equal(call[1],undefined);assert.equal(call[3],'https://comfy.example');}
 data.checkpoint='missing.safetensors';const invalid=await q.checkWorkflow(data);
 assert.equal(invalid.ok,false);assert.ok(invalid.errors.some(x=>x.includes('2.ckpt_name')));
});

test('standalone workflow check rejects bad bindings before network and reports unavailable server', async t => {
 const q=fixture(t);let calls=0;
 q.api=async()=>{calls++;throw Error('offline');};
 const data=input();data.endpoint='https://comfy.example';data.customRecipe.bindings[0].node='missing';
 await assert.rejects(q.checkWorkflow(data),/Invalid recipe binding/);assert.equal(calls,0);
 data.customRecipe=recipe();await assert.rejects(q.checkWorkflow(data),/offline/);
 assert.equal(calls,1);assert.equal(q.db.prepare('SELECT COUNT(*) AS n FROM visual_jobs').get().n,0);
});
