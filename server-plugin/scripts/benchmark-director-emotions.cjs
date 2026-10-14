// node benchmark-director-emotions.cjs BASE_INPUT ANCHOR_DB_DIR COMFY_URL PUBLIC_OUTPUT_DIR LLM_URL MODEL [CASES_JSON] [RUN_NAME]
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PNG}=require('pngjs');
const {Database}=require('../lib/database');
const {VisualQueue}=require('../lib/visual');
const [source,root,comfyUrl,publicRoot,llmUrl,model,casesFile,runName='spectrum']=process.argv.slice(2);
if(!model)throw Error('Expected six arguments');
if(!/^[a-z0-9-]+$/.test(runName))throw Error('Invalid run name');
const config={storageRoot:root,databasePath:path.join(root,'test.sqlite'),comfyUrl,allowHosts:new Set(),timeoutMs:60000,visualJobTimeoutMs:240000};
const db=new Database(config),q=new VisualQueue(config,db),results=[];
const base=JSON.parse(fs.readFileSync(source,'utf8'));base.localExpressions=true;base.faceDetector='lbpcascade_animeface.xml';
const episodes=casesFile ? JSON.parse(fs.readFileSync(casesFile,'utf8')) : [
 ['neutral','Wren listens without showing a particular reaction. Her brow and lips remain relaxed.'],
 ['joy','Wren hears wonderful news. She gives a broad warm smile; her cheeks rise and her eyes brighten.'],
 ['sadness','Wren learns that the meeting has been cancelled. Her mouth corners sink and her brows draw upward toward the middle.'],
 ['anger','Wren sees someone break an explicit promise. Her brows lower sharply, her eyes narrow and her lips press together.'],
 ['fear','A sudden threatening sound frightens Wren. Her eyes widen, her brows lift and draw together, and her lips part tensely.'],
 ['surprise','Wren receives a completely unexpected harmless gift. Her eyebrows rise and her mouth forms a small open O.'],
 ['disgust','Wren notices a rotten smell. She wrinkles her nose and raises her upper lip with a repelled expression.'],
 ['embarrassment','Wren hears a personal compliment in front of everyone. Her cheeks blush, she averts her eyes and gives a small shy smile.'],
 ['skepticism','Wren hears an implausible excuse. She raises one eyebrow and looks sideways with a doubtful closed-mouth expression.'],
 ['calm','Wren relaxes after the noise stops. Her eyes soften and her mouth settles into a faint peaceful smile.'],
];
(async()=>{try{
 for(const [expected,narration] of episodes){
  const start=Date.now();const input=structuredClone(base);input.requestKey='director-'+runName+'-'+expected;
  const llmStart=Date.now();let intent;
  try{
   const response=await fetch(llmUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({model,temperature:.2,max_tokens:240,stream:false,reasoning_effort:'none',chat_template_kwargs:{enable_thinking:false},messages:[
    {role:'system',content:'You are a visual Director. Read the narration and return ONLY a JSON object with exactly emotion and expression. emotion must be one of: '+episodes.map(([label])=>label).join(', ')+'. expression must be a concise English description of the VISIBLE facial expression, using eyes, brows, mouth and cheeks only, maximum 300 characters. Do not infer hidden feelings. Do not change hair, clothing, body pose, objects, lighting or camera. No markdown or reasoning.'},
    {role:'user',content:narration+' The outfit, hair and standing pose remain unchanged.'}
   ]})});
   if(!response.ok)throw Error('LLM HTTP '+response.status);
   const raw=await response.json();const content=raw.choices?.[0]?.message?.content || '';
   intent=JSON.parse(content);
   if(Object.keys(intent).sort().join()!=='emotion,expression' || !episodes.some(([label])=>label===intent.emotion) || typeof intent.expression!=='string' || !intent.expression.trim() || intent.expression.length>300)throw Error('Invalid Director intent');
  }catch(error){results.push({expected,narration,error:error.message,stage:'director',elapsedMs:Date.now()-start});fs.writeFileSync(path.join(root,'director-'+runName+'.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));continue;}
  const directorMs=Date.now()-llmStart;
  input.scene.characters[0].emotion=intent.expression;
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
