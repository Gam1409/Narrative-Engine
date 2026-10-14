// Render four recorded A/B intents without calling the LLM again. Args: BASE_INPUT ANCHOR_DB_DIR COMFY_URL PUBLIC_OUTPUT_DIR RESULTS_JSON
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PNG}=require('pngjs');
const {Database}=require('../lib/database');
const {VisualQueue}=require('../lib/visual');
const [source,root,comfyUrl,publicRoot,recordedFile,caseNames,runName='purpose40']=process.argv.slice(2);
if(!recordedFile)throw Error('Expected five arguments');
if(!/^[a-z0-9-]+$/.test(runName))throw Error('Invalid run name');
const config={storageRoot:root,databasePath:path.join(root,'test.sqlite'),comfyUrl,allowHosts:new Set(),timeoutMs:60000,visualJobTimeoutMs:240000};
const db=new Database(config),q=new VisualQueue(config,db),results=[];
const base=JSON.parse(fs.readFileSync(source,'utf8'));base.localExpressions=true;base.faceDetector='lbpcascade_animeface.xml';
const data=JSON.parse(fs.readFileSync(recordedFile,'utf8'));
const recorded=Array.isArray(data)?data:data.results;
const episodes=(caseNames?caseNames.split(','):['anger_ru','wink_ru','shyness_ru','sadness_en']).map(name=>{const row=recorded.find(r=>r.case===name&&r.purpose&&r.valid);if(!row)throw Error('Missing accepted intent '+name);return [name,row];});
(async()=>{try{
 for(const [expected,row] of episodes){
  const start=Date.now();const input=structuredClone(base);input.requestKey='director-'+runName+'-'+expected;
  const {applyIntent,validateIntent}=await import('../../src/visual/intent.js');
  const narration=row.scene.characters[0].emotion;
  input.scene.characters[0].emotion=narration;
  input.scene.spriteIds ||= {[input.scene.characters[0].id]:input.scene.sceneId};
  const selected=structuredClone(row.intent);selected.characters[0].id=input.scene.characters[0].id;
  input.scene=await applyIntent(input.scene,validateIntent(selected,input.scene));
  const intent={emotion:expected,expression:input.scene.characters[0].emotion};
  const directorMs=row.ms;
  input.scene.sceneId=crypto.createHash('sha256').update(JSON.stringify(input.scene)).digest('hex');input.resourceInput=input.scene.sceneId;
  let job=q.enqueue('test:expressions',input);
  if(!job.expressionAnchor)throw Error('Matching original anchor missing');
  const anchor=job.expressionAnchor,original=PNG.sync.read(q.assets.image('test:expressions',anchor.assetId).bytes);
  while(!['done','failed_final','cancelled'].includes(job.status)){
   await q.tick();job=q.get('test:expressions',job.id);
   if(!['done','failed_final','cancelled'].includes(job.status))await new Promise(r=>setTimeout(r,500));
  }
  if(job.status!=='done')throw Error(job.error||job.status);
  const img=await q.image('test:expressions',job.id,0),decoded=PNG.sync.read(img.bytes),f=anchor.face;
  let outsideChanged=0,alphaChanged=0,insideChanged=0;
  for(let y=0;y<decoded.height;y++)for(let x=0;x<decoded.width;x++){
   const i=(y*decoded.width+x)*4,changed=!decoded.data.subarray(i,i+4).equals(original.data.subarray(i,i+4));
   if(decoded.data[i+3]!==original.data[i+3])alphaChanged++;
   if(changed){if(x<f.x||x>=f.x+f.width||y<f.y||y>=f.y+f.height)outsideChanged++;else insideChanged++;}
  }
  if(outsideChanged||alphaChanged)throw Error('Pixel preservation failed');
  const name='qwen_'+runName+'_'+expected+'.png';fs.writeFileSync(path.join(root,name),img.bytes);fs.writeFileSync(path.join(publicRoot,name),img.bytes);
  const result={expected,narration,intent,labelMatch:intent.emotion===expected,directorMs,visualTiming:job.timing,totalMs:Date.now()-start,filename:name,outsideChanged,alphaChanged,insideChanged};
  results.push(result);fs.writeFileSync(path.join(root,'director-'+runName+'.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(result));
 }
}finally{q.close();db.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
