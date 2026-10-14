// node benchmark-detail-pass.cjs BASE_INPUT OUTPUT_DIR COMFY_URL PUBLIC_OUTPUT_DIR
const fs = require('node:fs'), path = require('node:path');
const { Database } = require('../lib/database');
const { VisualQueue } = require('../lib/visual');
const { integratedRecipe } = require('../lib/visual-integrated');
const [baseInput, outputDir, comfyUrl, publicOutputDir] = process.argv.slice(2);
if (!baseInput || !outputDir || !comfyUrl || !publicOutputDir) throw Error('Expected four arguments');
fs.mkdirSync(outputDir, {recursive:true});
const config = { storageRoot:outputDir, databasePath:path.join(outputDir,'test.sqlite'), comfyUrl,
    allowHosts:new Set(), timeoutMs:60000, visualJobTimeoutMs:300000 };
const recipe = {...integratedRecipe('scene_integrated'), detail:{scale:1.5,denoise:0.16}};
const db = new Database(config), q = new VisualQueue(config,db,{recipes:{scene_detail_test:recipe}});
(async()=>{try{
    const input = {...JSON.parse(fs.readFileSync(baseInput,'utf8')),workflow:'scene_detail_test',requestKey:'detail-016'};
    const start=Date.now();let job=q.enqueue('benchmark:detail',input);
    fs.writeFileSync(path.join(outputDir,'input.json'),JSON.stringify(input,null,2));
    fs.writeFileSync(path.join(outputDir,'workflow.json'),JSON.stringify(q.get('benchmark:detail',job.id,true).graph,null,2));
    while(!['done','failed_final','cancelled'].includes(job.status)){
        await q.tick();job=q.get('benchmark:detail',job.id);
        if(!['done','failed_final','cancelled'].includes(job.status))await new Promise(r=>setTimeout(r,500));
    }
    if(job.status!=='done')throw Error(job.error||job.status);
    const history=await q.api('/history/'+encodeURIComponent(job.promptId));
    const outputs=history[job.promptId].outputs;
    for(const [node,suffix] of [['901','before'],['900','after']]){
        const name = (process.argv[6] || 'detail') + '_' + suffix;
        const file=outputs[node].images[0];
        const image=await q.api('/view?'+new URLSearchParams(file),undefined,true);
        fs.writeFileSync(path.join(outputDir,name+'.png'),image.bytes);
        fs.writeFileSync(path.join(publicOutputDir,name+'.png'),image.bytes);
    }
    const result={status:job.status,elapsedMs:Date.now()-start,timing:job.timing,recipe,
      note:'May reuse ComfyUI cached base nodes; not a cold total-generation benchmark.'};
    fs.writeFileSync(path.join(outputDir,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{q.close();db.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
