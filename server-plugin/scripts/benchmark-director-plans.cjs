// Text-only benchmark: node benchmark-director-plans.cjs LLM_URL MODEL OUTPUT_JSON
'use strict';
const fs = require('node:fs');
const { compilePrompts } = require('../lib/visual-prompts');
const [url, model, output] = process.argv.slice(2);
const cameras = ['medium shot, eye level', 'full body, eye level', 'wide shot, eye level'];
const results = [];
function fixture(pair) {
    const characters = [{id:'wren',name:'Wren',outfit: pair ? 'green cable-knit sweater and black trousers' : 'blue dress with white ruffled collar and buttons',pose:'standing',emotion:pair ? 'one eye closed in a playful wink, broad smile' : 'brows lowered, eyes narrowed, lips pressed in anger',holding:[],profile:{appearance:'adult woman, blonde bob, grey-green eyes'}}];
    if (pair) characters.push({id:'kenzie',name:'Kenzie',outfit:'cream cardigan and navy skirt',pose:'sitting on a chair',emotion:'raised eyebrows, widened eyes and small open mouth in surprise',holding:[],profile:{appearance:'adult woman, long brown hair, brown eyes'}});
    return {location:{id:'bedroom',name:'bedroom',lighting:'soft daylight from the left window',properties:{description:'one wooden bed against the back wall, pale blue walls'}},keyObjects:[{id:'chair',name:'wooden chair',properties:{color:'brown'}}],characters};
}
function validate(plan, scene) {
    if (!plan || Object.keys(plan).sort().join() !== 'camera,characters,lighting,locationId,objectIds') throw Error('Unexpected plan fields');
    if (!cameras.includes(plan.camera) || plan.locationId !== scene.location.id || plan.lighting !== scene.location.lighting) throw Error('Changed location/light or invalid camera');
    if (JSON.stringify(plan.objectIds) !== JSON.stringify(scene.keyObjects.map(x=>x.id))) throw Error('Changed objects');
    if (!Array.isArray(plan.characters) || plan.characters.length !== scene.characters.length) throw Error('Changed cast');
    for (const [i,c] of plan.characters.entries()) {
        const source=scene.characters[i];
        if (Object.keys(c).sort().join() !== 'expression,id,outfit,pose' || c.id !== source.id || c.outfit !== source.outfit || c.pose !== source.pose) throw Error('Changed character canon');
        if (typeof c.expression !== 'string' || !c.expression.trim() || c.expression.length > 300) throw Error('Invalid expression');
    }
    return plan;
}
(async()=>{
 for (const profile of ['sdxl','pony','illustrious','anima']) for (const pair of [false,true]) {
    const scene=fixture(pair), started=Date.now();
    const result={profile,case:pair?'two-characters-after-outfit-change':'one-character-anger',scene};
    try {
        const request={model,temperature:0.2,max_tokens:800,stream:false,reasoning_effort:'none',chat_template_kwargs:{enable_thinking:false},messages:[
            {role:'system',content:'You are a visual Director. Return ONLY JSON with exactly camera, locationId, lighting, objectIds, characters. camera must be one of '+JSON.stringify(cameras)+'. Copy locationId from scene.location.id, lighting verbatim, objectIds from scene.keyObjects in order. Each character has exactly id, outfit, pose, expression; preserve order and copy id/outfit/pose verbatim. expression is an English visible facial description up to 300 characters, faithfully restating the supplied emotion; no new actions, items, hair, clothes or hidden feelings. Never change canon. Use concise natural description for SDXL and concise comma-separated facial tags for Pony, Illustrious and Anima. Do not add quality tags; the compiler handles those.'},
            {role:'user',content:JSON.stringify({profile,scene})}
        ]};
        const response=await fetch(url.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(45000)});
        if(!response.ok)throw Error('HTTP '+response.status);
        const body=await response.json();result.directorMs=Date.now()-started;
        result.raw=body.choices?.[0]?.message?.content;
        const plan=validate(JSON.parse(result.raw),scene);result.plan=plan;
        const effective=structuredClone(scene);
        effective.characters.forEach((c,i)=>{c.emotion=plan.characters[i].expression;});
        const compileStart=performance.now();
        result.prompts=Object.fromEntries(['illustration','background','sprite'].map(operation=>[operation,compilePrompts(operation==='sprite'?{...effective,characters:[effective.characters[0]]}:effective,{profile,operation,composition:{camera:operation==='background'?'':plan.camera}})]));
        result.compilerMs=+(performance.now()-compileStart).toFixed(3);result.valid=true;
    } catch(error) {result.valid=false;result.error=error.message;}
    result.totalMs=Date.now()-started;results.push(result);fs.writeFileSync(output,JSON.stringify(results,null,2));
    console.log(JSON.stringify({profile,case:result.case,valid:result.valid,directorMs:result.directorMs,totalMs:result.totalMs,error:result.error}));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
