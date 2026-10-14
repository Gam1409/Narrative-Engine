import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const [url,model,input,output,optionsFile]=process.argv.slice(2);
const data=JSON.parse(await fs.readFile(input,'utf8'));
const options=optionsFile?JSON.parse(await fs.readFile(optionsFile,'utf8')):{};
const anonymous=[],key=[];
for(const r of data.results){
 if(!r.valid)continue;
 const id=crypto.randomBytes(8).toString('hex');
 // Remove architecture-specific events and all timing/provider/repetition metadata.
 const candidate={frame:r.analysis.frame,location:r.analysis.location,characters:r.analysis.characters.map(c=>Object.fromEntries(['id','visible','inner','posture','clothing','action'].map(k=>[k,c[k]])))};
 anonymous.push({id,caseId:r.caseId,candidate});key.push({id,arm:r.arm,repeat:r.repeat,caseId:r.caseId,condition:r.condition||"none"});
}
for(let i=anonymous.length-1;i>0;i--){const j=crypto.randomInt(i+1);[anonymous[i],anonymous[j]]=[anonymous[j],anonymous[i]];}
await fs.writeFile(output+'.key.json',JSON.stringify(key,null,2));
const system='Evaluate Russian narrative state descriptions against the supplied source. You do not know how candidates were generated. Evaluate each independently. A current scene description must not merge past memories with present clothing, pose, location or held objects. Distinguish observed behavior, narrated private feelings, spoken claims, and unsupported psychological assertions. Wishes/negations are not performed actions. A summary may mention earlier actions only if their temporal scope is explicit; do not treat a clearly marked earlier action as a current-state error. Use previous_text to resolve context. Return JSON only: {reviews:[{id:string,physical_error:boolean,emotion_error:boolean,key_transition_omitted:boolean,reason:string}]}. reason must be concise Russian, cite the specific mismatch; do not reward verbosity. Do not infer hidden motives or assume consent/forgiveness from smiles. Unknown fields are safer than invented facts, but missing a required transition is an omission.';
const report={kind:'architecture-blinded LLM judge, same model in fresh contexts; not independent human ground truth',model,system,requests:[],results:[]};
for(const caseId of data.selected){
 const row=data.results.find(r=>r.caseId===caseId);
 const candidates=anonymous.filter(r=>r.caseId===caseId).map(({id,candidate})=>({id,candidate}));
 if(!candidates.length)continue;
 const payload={previous_text:row.payload.previous_text,CURRENT:row.payload.CURRENT,checks:data.criteria[caseId],candidates};
 const started=Date.now();const entry={caseId,payload};
 try{
 const response=await fetch(url+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...options,model,temperature:0.2,max_tokens:1800,stream:false,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(payload)}]}),signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('HTTP '+response.status);
 const body=await response.json();entry.raw=body.choices?.[0]?.message?.content;entry.usage=body.usage;
 const value=JSON.parse(entry.raw.trim().replace(/^```json\s*/i,'').replace(/\s*```$/,''));
 if(!Array.isArray(value.reviews)||value.reviews.length!==candidates.length||new Set(value.reviews.map(r=>r.id)).size!==candidates.length)throw Error('Invalid review count');
 for(const r of value.reviews){if(!candidates.some(c=>c.id===r.id)||['physical_error','emotion_error','key_transition_omitted'].some(k=>typeof r[k]!=='boolean')||typeof r.reason!=='string')throw Error('Invalid review');}
 report.results.push(...value.reviews);
 }catch(error){entry.error=error.message;}
 entry.ms=Date.now()-started;report.requests.push(entry);
 await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({caseId,ms:entry.ms,error:entry.error}));
}
