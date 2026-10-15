import {buildEvidenceCatalog} from '../src/state/evidence.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildStoryCases,buildStoryRequest,validateStoryResponse} from './memory-study.mjs';

const args=process.argv.slice(2), run=args.includes('--run');
const get=(flag,fallback)=>{const i=args.indexOf(flag);return i<0?fallback:args[i+1];};
const sourceDir=get('--source-dir'), output=get('--output');
if(!sourceDir || !output) throw Error('Required: --source-dir PATH --output NEW_DIRECTORY; optional --run --endpoint URL --model MODEL --repeats N');
const optionsFile=get('--options');
const providerOptions=optionsFile?JSON.parse(await fs.readFile(optionsFile,'utf8')):{};
if(!providerOptions || Array.isArray(providerOptions) || typeof providerOptions!=='object'
    || Object.keys(providerOptions).some(key=>!['reasoning_effort','chat_template_kwargs'].includes(key)))throw Error('Unsupported provider options');
const config={model:get('--model','dry-run'),temperature:0.2,maxTokens:1800,evidenceRefs:args.includes('--evidence-refs'),providerOptions};
const repeats=Number(get('--repeats','1'));
if(!Number.isInteger(repeats)||repeats<1||repeats>5)throw Error('Repeats must be 1..5');
const endpoint=run?new URL(get('--endpoint','')):null;
if(run && (!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||config.model==='dry-run'))throw Error('Supply endpoint and model without URL credentials/query');
const manifest=JSON.parse(await fs.readFile(new URL('../tests/fixtures/story-memory-study.json',import.meta.url),'utf8'));
const sources={};
for(const name of Object.keys(manifest.sources)) sources[name]=(await fs.readFile(path.join(sourceDir,name),'utf8')).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
const cases=buildStoryCases(manifest,sources), jobs=[], key=[];
if(config.evidenceRefs)for(const row of cases)row.evidenceCatalog=await buildEvidenceCatalog({rp:row.current});
for(const row of cases) for(let repeat=0;repeat<repeats;repeat++) for(const structured of [false,true]) {
    const id=crypto.randomBytes(12).toString('hex');
    jobs.push({id,request:{...buildStoryRequest(row,structured,config),...providerOptions},caseId:row.id});
    key.push({id,caseId:row.id,repeat,arm:structured?'dated_reference':'plain_reference'});
}
for(let i=jobs.length-1;i>0;i--){const j=crypto.randomInt(i+1);[jobs[i],jobs[j]]=[jobs[j],jobs[i]];}
await fs.mkdir(output,{recursive:false});
const write=(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
await write('key.json',key);
await write('requests.json',jobs);
const report={kind:manifest.kind,live:run,config,repeats,total:jobs.length,results:[]};
await write('results.json',report);
const review={language:'ru',instructions:'Оцените фактические ошибки отдельно от ошибок и пропусков эмоций. Не угадывайте вариант запроса. Укажите основание оценки в исходном тексте. Размер ответа сам по себе не означает качество.',cases:cases.map(row=>({id:row.id,source:row.source,current:row.current,history:row.history,checks:row.checks})),answers:[]};
if(run) {
    let failedInSequence=0;
    for(const job of jobs) {
        const started=performance.now(), result={id:job.id};
        try {
            const url=endpoint.href.replace(/\/$/,'')+'/chat/completions';
            const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',
                ...(process.env.NE_STUDY_API_KEY?{authorization:`Bearer ${process.env.NE_STUDY_API_KEY}`}:{})},
                body:JSON.stringify(job.request),signal:AbortSignal.timeout(120000)});
            if(!response.ok)throw Error(`HTTP ${response.status}`);
            const body=await response.json();
            result.raw=body.choices?.[0]?.message?.content;
            result.finishReason=body.choices?.[0]?.finish_reason;
            if(result.finishReason==='length')throw Error('Truncated output');
            result.analysis=validateStoryResponse(result.raw,cases.find(row=>row.id===job.caseId).current,cases.find(row=>row.id===job.caseId).evidenceCatalog);
            result.usage=body.usage;result.valid=true;
        } catch(error) {result.valid=false;result.error=error.name==='TimeoutError'?'Request timeout':String(error.message).slice(0,200);}
        result.ms=Math.round(performance.now()-started);report.results.push(result);
        review.answers.push({id:job.id,caseId:job.caseId,answer:result.analysis||result.raw||null,valid:result.valid,
            factualErrors:null,emotionalErrors:null,naturalness:null,reason:''});
        failedInSequence=result.valid?0:failedInSequence+1;
        if(failedInSequence>=2)report.stoppedEarly='Two consecutive invalid responses; inspect provider before spending more calls.';
        await write('results.json',report);await write('review-ru.json',review);
        console.log(JSON.stringify({completed:report.results.length,total:jobs.length,valid:result.valid,ms:result.ms}));
        if(report.stoppedEarly)break;
    }
    if(report.results.some(row=>!row.valid))process.exitCode=1;
} else await write('review-ru.json',review);
console.log(JSON.stringify({live:run,cases:cases.length,requests:jobs.length,output}));
