'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const {validateProviderUrl,validateId}=require('./security');
const {requestJson}=require('./provider');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const clone=value=>JSON.parse(JSON.stringify(value));
const unsafe=['__proto__','prototype','constructor'];
function bind(graph,binding,value) {
    if (!binding || unsafe.includes(binding.node)||unsafe.includes(binding.input)||!Object.hasOwn(graph,binding.node)||!Object.hasOwn(graph[binding.node].inputs,binding.input)) fail('Invalid workflow binding');
    graph[binding.node].inputs[binding.input]=clone(value);
}
function buildWorkflow(recipe,input) {
    if(!recipe?.workflow || typeof recipe.workflow!=='object')fail('Workflow is not configured',503);
    const graph=clone(recipe.workflow);
    const positive=[JSON.stringify(input.scene.location),...input.scene.characters.map(c=>[c.name,c.profile?.appearance,c.profile?.outfits?.[c.outfit] || c.outfit,c.pose,c.emotion,JSON.stringify(c.position),JSON.stringify(c.holding)].filter(Boolean).join(', ')),JSON.stringify(input.scene.keyObjects)].join('\n');
    const values={...input,positive};
    for(const binding of recipe.bindings || []) {
        if(binding.stage && !input.stages?.[binding.stage])continue;
        const parts=String(binding.source).split('.');if(parts.some(k=>unsafe.includes(k)))fail('Invalid binding source');
        const value=parts.reduce((v,k)=>v?.[k],values) ?? binding.default;
        if(value===undefined)fail(`Missing workflow value: ${binding.source}`);
        bind(graph,binding,value);
    }
    for(const [name,enabled] of Object.entries(input.stages || {})) if(enabled && !Object.hasOwn(recipe.stages || {},name))fail(`Workflow has no stage ${name}`);
    for(const [name,stage] of Object.entries(recipe.stages || {})) for(const patch of (input.stages?.[name] ? stage.on : stage.off) || []) bind(graph,patch,patch.value);
    return graph;
}
class VisualQueue {
    constructor(config,db,deps={}) {
        this.config=config;this.db=db.db;this.request=deps.requestJson||requestJson;this.validate=deps.validateProviderUrl||validateProviderUrl;this.controllers=new Set();this.busy=false;this.closed=false;
        try {this.recipes=deps.recipes || (config.comfyWorkflows ? JSON.parse(fs.readFileSync(config.comfyWorkflows,'utf8').replace(/^\uFEFF/,'')) : {});} catch {this.recipes={};}
        this.db.exec('CREATE TABLE IF NOT EXISTS visual_jobs (id TEXT PRIMARY KEY, scope TEXT NOT NULL, request_key TEXT NOT NULL, status TEXT NOT NULL, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(scope,request_key));');
        // A crash during submission is ambiguous. Never spend GPU work by resubmitting blindly.
        for(const row of this.db.prepare("SELECT data_json FROM visual_jobs WHERE status='running'").all()) {const job=JSON.parse(row.data_json);if(job.promptId)continue;this.transition(job,'failed_final',{error:'Submission interrupted; remote acceptance unknown'});}
    }
    save(job) {this.db.prepare('INSERT INTO visual_jobs(id,scope,request_key,status,data_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data_json=excluded.data_json,updated_at=excluded.updated_at').run(job.id,job.scope,job.requestKey,job.status,JSON.stringify(job),Date.now());return this.public(job);}
    public(job) {const {scope,graph,...safe}=job;return clone(safe);}
    transition(job,status,patch={}) {Object.assign(job,patch,{status});job.history.push({status,at:Date.now()});return this.save(job);}
    get(scope,id,raw=false) {const row=this.db.prepare('SELECT data_json FROM visual_jobs WHERE scope=? AND id=?').get(scope,id);if(!row)fail('Visual job not found',404);const job=JSON.parse(row.data_json);return raw?job:this.public(job);}
    list(scope) {return this.db.prepare('SELECT data_json FROM visual_jobs WHERE scope=? ORDER BY updated_at DESC LIMIT 30').all(scope).map(row=>this.public(JSON.parse(row.data_json)));}
    enqueue(scope,input) {
        validateId(input.requestKey,'requestKey');validateId(input.workflow,'workflow');
        if(!input.scene || !/^[a-f0-9]{64}$/.test(input.scene.sceneId) || !Array.isArray(input.scene.characters) || JSON.stringify(input.scene).length>200000)fail('Invalid visual scene');
        const old=this.db.prepare('SELECT data_json FROM visual_jobs WHERE scope=? AND request_key=?').get(scope,input.requestKey);
        if(old) {const job=JSON.parse(old.data_json);if(job.scene.sceneId!==input.scene.sceneId||job.workflow!==input.workflow)fail('Request key conflict',409);return this.public(job);}
        if(this.db.prepare("SELECT count(*) AS n FROM visual_jobs WHERE scope=? AND status IN ('queued','requested','running','failed')").get(scope).n>=10)fail('Visual queue limit reached',429);
        if(!Number.isSafeInteger(input.seed)||input.seed<0||input.seed>0xffffffff)fail('Invalid seed');
        if(Object.keys(input.stages || {}).some(k=>!['controlnet','ipadapter','mask'].includes(k))||Object.values(input.stages || {}).some(v=>typeof v!=='boolean'))fail('Invalid processing stages');
        for(const c of input.scene.characters) if(c.profile?.compatibleWorkflows?.length && !c.profile.compatibleWorkflows.includes(input.workflow))fail(`Workflow incompatible with ${c.id}`);
        const job={id:crypto.randomUUID(),scope,requestKey:input.requestKey,scene:clone(input.scene),workflow:input.workflow,seed:input.seed,stages:clone(input.stages || {}),status:'queued',history:[{status:'requested',at:Date.now()},{status:'queued',at:Date.now()}],createdAt:Date.now(),attempts:0,nextPoll:0,outputs:[]};
        try {job.graph=buildWorkflow(this.recipes[input.workflow],input);}catch(error){job.status='failed_final';job.error=error.message;job.history.push({status:job.status,at:Date.now()});}
        return this.save(job);
    }
    async api(route,body,binary=false) {
        if(!this.config.comfyUrl)fail('ComfyUI is not configured',503);
        const checked=await this.validate(this.config.comfyUrl,this.config.allowHosts);
        const url=new URL(checked.url);const endpoint=new URL(route,'http://local/');url.pathname=url.pathname.replace(/\/$/,'')+endpoint.pathname;url.search=endpoint.search;
        const text=body===undefined?undefined:JSON.stringify(body);
        return this.request(url,{method:text?'POST':'GET',headers:{...(text?{'content-type':'application/json','content-length':Buffer.byteLength(text)}:{}),...(this.config.comfyKey?{authorization:`Bearer ${this.config.comfyKey}`}:{})}},text,checked.addresses,this.config.timeoutMs,this.controllers,binary);
    }
    async tick() {
        if(this.busy||this.closed)return;this.busy=true;
        try {
            const job=this.db.prepare("SELECT data_json FROM visual_jobs WHERE status IN ('queued','running','failed') ORDER BY updated_at ASC").all().map(row=>JSON.parse(row.data_json)).find(job=>job.nextPoll<=Date.now());if(!job)return;
            if(Date.now()-job.createdAt>(this.config.visualJobTimeoutMs||600000))return this.transition(job,'failed_final',{error:'Visual job deadline exceeded'});
            if(job.status==='queued') {
                this.transition(job,'running',{submissionPending:true});
                try {const response=await this.api('/prompt',{prompt:job.graph,client_id:job.id});if(typeof response.prompt_id!=='string'||response.error||Object.keys(response.node_errors || {}).length)throw new Error('ComfyUI rejected workflow');this.transition(job,'running',{submissionPending:false,promptId:response.prompt_id,nextPoll:Date.now()+1000});}
                catch {this.transition(job,'failed_final',{error:'Submission failed; remote acceptance may be unknown. Not resubmitted.'});}
            } else {
                try {const history=await this.api(`/history/${encodeURIComponent(job.promptId)}`);const result=history[job.promptId];
                    if(result?.status?.status_str==='error')return this.transition(job,'failed_final',{error:'ComfyUI execution failed'});
                    if(result?.status?.completed) {
                        const outputs=Object.values(result.outputs||{}).flatMap(v=>v.images||[]).filter(v=>typeof v.filename==='string'&&v.type==='output').map(v=>({filename:v.filename,subfolder:v.subfolder||'',type:'output'})).slice(0,8);
                        return this.transition(job,outputs.length?'done':'failed_final',{outputs,error:outputs.length?null:'Workflow completed without images'});
                    }
                    this.transition(job,'running',{attempts:0,nextPoll:Date.now()+2000});
                } catch {job.attempts++;this.transition(job,job.attempts>=3?'failed_final':'failed',{error:'ComfyUI history unavailable',nextPoll:Date.now()+Math.min(2000*2**job.attempts,30000)});}
            }
        } finally {this.busy=false;}
    }
    async image(scope,id,index) {
        const job=this.get(scope,id,true),output=job.outputs[index];if(job.status!=='done'||!output)fail('Image not available',404);
        return this.api('/view?'+new URLSearchParams(output),undefined,true);
    }
    start(){this.timer=setInterval(()=>this.tick().catch(()=>{}),1000);this.timer.unref?.();}
    close(){this.closed=true;clearInterval(this.timer);for(const c of this.controllers)c.abort();}
}
module.exports={VisualQueue,buildWorkflow};
