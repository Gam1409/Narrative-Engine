const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {PNG}=require('pngjs');const {Database}=require('../lib/database');const {VisualQueue}=require('../lib/visual');
function setup(t){const db=new Database({storageRoot:process.cwd(),databasePath:':memory:'});const q=new VisualQueue({},db);t.after(()=>{q.close();db.close();});q.api=async()=>{throw Error('No network allowed');};return q;}
function finish(q,scope,job){const raw=q.get(scope,job.id,true);const image=new PNG({width:1,height:1});image.data.set([1,2,3,255]);raw.asset=q.assets.put(raw,PNG.sync.write(image));raw.status='done';raw.outputs=[{assetId:raw.asset.id}];q.save(raw);return raw;}
const scene=id=>({sceneId:'a'.repeat(64),location:{id,name:id,properties:{description:'bed'},lighting:'daylight',weather:'clear'},keyObjects:[],characters:[],spriteIds:{}});
test('30 turns produce one background job; A-B-A reuses; manual replaces only once',async t=>{
 const q=setup(t);const {prepareBackground}=await import('../../src/visual/background.js');const {planLayers}=await import('../../src/visual/layers.js');
 const cfg={visualCheckpoint:'model.safetensors'};let ledger,first,latest;const turns=[];
 async function request(s,force=false){turns.push(String(turns.length));const p=await prepareBackground(s,cfg,ledger,{turns,force});ledger=p.ledger;s.background=p.background;const [plan]=await planLayers(s,cfg);const job=q.enqueue('u:c',{...plan,requestKey:crypto.randomUUID(),automatic:true});if(job.status==='queued')finish(q,'u:c',job);latest=job.reused?job:q.get('u:c',job.id);return latest;}
 for(let i=0;i<30;i++){const s=scene('A');s.location.lighting='light '+i;s.keyObjects=[{name:'cup '+i}];const j=await request(s);first ||= j.asset.id;assert.equal(j.asset.id,first);}
 assert.equal(q.metrics('u:c').counts.background.jobs,1);
 assert.equal(q.metrics('u:c').counts.background.reused,29);
 assert.equal(q.db.prepare('SELECT COUNT(*) AS n FROM visual_assets').get().n,1);
 assert.equal(q.db.prepare('SELECT COUNT(*) AS n FROM visual_jobs').get().n,1);
 await request(scene('B'));const back=await request(scene('A'));assert.equal(back.asset.id,first);assert.equal(back.reused,true);
 const manual=await request(scene('A'),true);assert.notEqual(manual.asset.id,first);const repeat=await request(scene('A'));assert.equal(repeat.asset.id,manual.asset.id);
 assert.equal(q.db.prepare('SELECT COUNT(*) AS n FROM visual_assets').get().n,3);
 assert.equal(q.db.prepare("SELECT COUNT(*) AS n FROM visual_jobs WHERE status='queued'").get().n,0);
});
test('legacy background migration verifies graph settings and scope, refuses compacted evidence',async t=>{
 const q=setup(t);const original={workflow:'background',operation:'background',checkpoint:'model.safetensors',seed:1,resourceInput:'b'.repeat(64),scene:scene('room'),requestKey:'old'};
 original.scene.keyObjects=[{name:'old cup'}];const old=finish(q,'u:c',q.enqueue('u:c',original));
 const next={...original,requestKey:'new',seed:9,resourceInput:'c'.repeat(64),scene:scene('room'),backgroundPolicy:'location'};
 const reused=q.enqueue('u:c',next);assert.equal(reused.status,'done',JSON.stringify(reused));assert.equal(reused.asset.id,old.asset.id);assert.equal(reused.reused,true);
 assert.equal(q.enqueue('other:c',{...next,requestKey:'other'}).status,'queued');
 assert.equal(q.enqueue('u:c',{...next,requestKey:'different-model',checkpoint:'different.safetensors'}).status,'queued');
 assert.equal(q.enqueue('u:c',{...next,requestKey:'manual',seed:55,backgroundManual:true}).status,'queued');
 const raw=q.get('u:c',old.id,true);delete raw.graph;q.save(raw);
 const alias=q.enqueue('u:c',{...next,requestKey:'alias'});assert.equal(alias.asset.id,old.asset.id);
 const noEvidence=q.enqueue('u:c',{...next,requestKey:'no-evidence',seed:100,resourceInput:'d'.repeat(64)});assert.equal(noEvidence.status,'queued');
});
