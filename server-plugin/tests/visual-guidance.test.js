"use strict";
const test = require("node:test");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const { Database } = require("../lib/database");
const { VisualQueue } = require("../lib/visual");
const { planCompositeLayout } = require("../lib/visual-layout");

function setup(t) {
    const db = new Database({storageRoot:process.cwd(),databasePath:":memory:"});
    const queue = new VisualQueue({comfyUrl:"https://configured.example",comfyKey:"secret"}, db);
    queue.api = async () => { throw Error("Network forbidden in test"); };
    t.after(() => {queue.close();db.close();});
    return queue;
}
function store(queue, operation, characterId, marker = "a", scope = "u:chat") {
    const png = new PNG({width:operation === "background" ? 128 : 32,height:64});
    for(let i=0;i<png.data.length;i+=4) png.data.set([30,80,140,i===0 && operation==="sprite" ? 0 : 255],i);
    const asset = queue.assets.put({scope,operation,characterId,resourceKey:marker.repeat(64),resourceInput:"f".repeat(64),
        scene:{characters:[]},workflow:"fixture",seed:1},PNG.sync.write(png));
    return {assetId:asset.id,resourceKey:asset.resourceKey};
}
function input(queue, count=2) {
    return {requestKey:"layered",workflow:"scene_layered",operation:"illustration",seed:42,checkpoint:"base.safetensors",
        scene:{sceneId:"b".repeat(64),location:{name:"bedroom"},characters:["A","B"].slice(0,count).map(id=>({id,outfit:"blue dress",profile:{lora:[{name:id+".safetensors",weight:0.7,family:"sdxl"}]}}))},
        layerReferences:[store(queue,"background",null),...["A","B"].slice(0,count).map((id,i)=>store(queue,"sprite",id,i ? "c" : "b"))]};
}
function enqueue(queue, value, scope="u:chat") {
    const job=queue.enqueue(scope,value);
    return queue.get(scope,job.id,true);
}

test("layered graph uses saved background, correctly oriented alpha and one coherent refinement before isolated LoRA passes", t=>{
    const q=setup(t), x=input(q), before=structuredClone(x), job=enqueue(q,x);
    assert.equal(job.status,"queued",job.error);
    assert.deepEqual(x,before);
    const g=job.graph, nodes=Object.values(g);
    assert.equal(nodes.filter(n=>n.class_type==="LoadImage").length,3);
    assert.equal(nodes.filter(n=>n.class_type==="EmptyLatentImage").length,0);
    const samplers=nodes.filter(n=>n.class_type==="KSampler");
    assert.deepEqual(samplers.map(n=>n.inputs.denoise),[0.45,0.35,0.35]);
    const encoded=g[samplers[0].inputs.latent_image[0]];
    assert.equal(encoded.class_type,"VAEEncode");
    assert.deepEqual(encoded.inputs.pixels,g["901"].inputs.images);
    assert.equal(g["900"].class_type,"SaveImage");
    const overlays=nodes.filter(n=>n.class_type==="ImageCompositeMasked" && n.inputs.x!==0);
    assert.equal(overlays.length,2);
    for(const overlay of overlays){
        const mask=g[overlay.inputs.mask[0]];
        assert.equal(mask.class_type,"ImageToMask");
        const resized=g[mask.inputs.image[0]], asImage=g[resized.inputs.image[0]], inverted=g[asImage.inputs.mask[0]];
        assert.equal(inverted.class_type,"InvertMask");
        assert.equal(inverted.inputs.mask[1],1);
        assert.equal(g[inverted.inputs.mask[0]].class_type,"LoadImage");
        const scaled=g[overlay.inputs.source[0]];
        assert.equal(scaled.inputs.width,resized.inputs.width);
        assert.equal(scaled.inputs.height,resized.inputs.height);
    }
    const loras=nodes.filter(n=>n.class_type==="LoraLoader");
    assert.deepEqual(loras[0].inputs.model,loras[1].inputs.model);
    assert.deepEqual(loras[0].inputs.clip,loras[1].inputs.clip);
    for(const masked of nodes.filter(n=>n.class_type==="SetLatentNoiseMask")) {
        const mask=g[masked.inputs.mask[0]];
        assert.equal(mask.class_type,"MaskComposite");
        assert.equal(g[mask.inputs.source[0]].class_type,"ImageToMask");
    }
});

test("reference contract rejects cross-chat assets, wrong identity, missing resources and stale expected keys", t=>{
    const q=setup(t), x=input(q);
    assert.match(enqueue(q,x,"other:chat").error,/not found/);
    for(const [key,change,pattern] of [
        ["wrong",v=>v.layerReferences.reverse(),/does not match/],
        ["missing",v=>v.layerReferences.pop(),/every current character/],
        ["stale",v=>v.layerReferences[1].resourceKey="d".repeat(64),/resource key/],
        ["unknown",v=>v.layerReferences[1].assetId="missing",/not found/],
        ["denoise",v=>v.layerDenoise=0.9,/denoise/],
        ["camera",v=>v.layerCamera="arbitrary",/framing/],
        ["many",v=>v.scene.characters.push({id:"C"}),/two distinct/],
        ["fresh",v=>v.workflow="scene_integrated",/does not support/]
    ]){
        const value=structuredClone(x);value.requestKey=key;change(value);
        const job=enqueue(q,value);assert.equal(job.status,"failed_final");assert.match(job.error,pattern);
        assert.equal(job.graph,undefined);
    }
    const forged=enqueue(q,{...x,requestKey:"forged",layerGuidance:{references:[{filename:"secret.png"}],layout:{width:1,height:1}},
        layerReferences:x.layerReferences.map(ref=>({...ref,filename:"secret.png",x:9999}))});
    assert.equal(forged.status,"queued",forged.error);
    assert.doesNotMatch(JSON.stringify(forged.graph),/secret.png/);
});

test("reference IDs, framing and denoise change the resource key; fresh recipe stays reference-free",t=>{
    const q=setup(t), x=input(q,1), base=enqueue(q,x);
    const alternate=store(q,"background",null,"d");
    for(const changes of [{layerDenoise:0.5},{layerCamera:"wide shot, eye level"},{layerReferences:[alternate,x.layerReferences[1]]}]){
        const other=enqueue(q,{...x,...changes,requestKey:crypto.randomUUID()});
        assert.equal(other.status,"queued",other.error);assert.notEqual(other.resourceKey,base.resourceKey);
    }
    const fresh={...x,requestKey:"fresh",workflow:"scene_integrated"};delete fresh.layerReferences;
    const job=enqueue(q,fresh);assert.equal(job.status,"queued",job.error);
    assert.equal(Object.values(job.graph).filter(n=>n.class_type==="LoadImage").length,0);
    assert.equal(Object.values(job.graph).find(n=>n.class_type==="KSampler").inputs.denoise,1);
});

test("layer uploads preserve exact PNG alpha bytes, use the selected endpoint and precede inventory checks",async t=>{
    const q=setup(t), x=input(q,1);x.endpoint="https://dynamic.example";
    const job=enqueue(q,x), calls=[];
    q.validate=async url=>({url,addresses:["203.0.113.1"]});
    q.request=async(url,options,body)=>{
        assert.equal(url.hostname,"dynamic.example");assert.equal(url.pathname,"/upload/image");
        assert.equal(options.headers.authorization,undefined);
        const ref=job.layerGuidance.references[calls.length];
        const bytes=q.assets.image("u:chat",ref.assetId).bytes;
        const start=body.indexOf(Buffer.from("\r\n\r\n"))+4;
        assert.deepEqual(body.subarray(start,start+bytes.length),bytes);
        calls.push(ref.assetId);return {name:ref.filename};
    };
    q.inventory=async()=>{assert.equal(calls.length,2);return {};};
    await assert.rejects(q.preflight(job),/unavailable|Unknown|not installed/i);
    assert.equal(calls.length,2);
    // Missing local layers fail before any upload; a stale upload cannot hide deletion.
    q.db.prepare("DELETE FROM visual_assets WHERE scope=? AND id=?").run("u:chat",x.layerReferences[1].assetId);
    calls.length=0;
    await assert.rejects(q.preflight(job),/not found/);assert.equal(calls.length,0);
});

test("browser and server layout contracts agree for every framing, cast size and aspect ratio",async()=>{
    const browser=await import("../../src/visual/layout.js");
    for(const camera of Object.keys(browser.COMPOSITE_CAMERAS)) for(const count of [0,1,2]) for(const [width,height] of [[1024,768],[768,1024],[128,64]]){
        const value={width,height,camera,characters:[{id:"A",width:300,height:1000},{id:"B",width:600,height:800}].slice(0,count)};
        assert.deepEqual(planCompositeLayout(value),browser.planCompositeLayout(value));
    }
});

test("queue never submits a prompt after missing-node or unexpected-upload failures", async t=>{
    const q=setup(t), x=input(q,0);
    let prompts=0;
    q.api=async()=>{prompts++;throw Error("No remote submission expected");};
    q.validate=async url=>({url,addresses:["203.0.113.1"]});
    q.inventory=async()=>({});
    q.request=async(_url,_options,body)=>({name:body.toString().match(/filename="([^"]+)"/)[1]});
    const first=enqueue(q,x);await q.tick();
    assert.equal(q.get("u:chat",first.id).status,"failed_final");
    assert.match(q.get("u:chat",first.id).error,/Preflight:.*not installed/);
    const second=enqueue(q,{...x,requestKey:"bad-upload"});
    q.request=async()=>({name:"other.png"});await q.tick();
    assert.match(q.get("u:chat",second.id).error,/unexpected filename/);
    assert.equal(prompts,0);
});


test('full guided graph passes a typed core inventory and exposes guidance metadata',t=>{
    const q=setup(t), job=enqueue(q,input(q));
    const definitions={
        CheckpointLoaderSimple:[{ckpt_name:[['base.safetensors']]},['MODEL','CLIP','VAE']],
        LoraLoader:[{model:['MODEL'],clip:['CLIP'],lora_name:[['A.safetensors','B.safetensors']],strength_model:['FLOAT'],strength_clip:['FLOAT']},['MODEL','CLIP']],
        LoadImage:[{image:[job.layerGuidance.references.map(r=>r.filename)]},['IMAGE','MASK']],
        ImageScale:[{image:['IMAGE'],upscale_method:[['bicubic','bilinear']],width:['INT'],height:['INT'],crop:[['disabled']]},['IMAGE']],
        InvertMask:[{mask:['MASK']},['MASK']], MaskToImage:[{mask:['MASK']},['IMAGE']],
        ImageToMask:[{image:['IMAGE'],channel:[['red']]},['MASK']],
        ImageCompositeMasked:[{destination:['IMAGE'],source:['IMAGE'],mask:['MASK'],x:['INT'],y:['INT'],resize_source:['BOOLEAN']},['IMAGE']],
        SolidMask:[{value:['FLOAT'],width:['INT'],height:['INT']},['MASK']],
        MaskComposite:[{destination:['MASK'],source:['MASK'],x:['INT'],y:['INT'],operation:[['add']]},['MASK']],
        VAEEncode:[{pixels:['IMAGE'],vae:['VAE']},['LATENT']], VAEDecode:[{samples:['LATENT'],vae:['VAE']},['IMAGE']],
        CLIPTextEncode:[{text:['STRING'],clip:['CLIP']},['CONDITIONING']],
        KSampler:[{model:['MODEL'],positive:['CONDITIONING'],negative:['CONDITIONING'],latent_image:['LATENT'],seed:['INT'],steps:['INT'],cfg:['FLOAT'],sampler_name:[['euler']],scheduler:[['simple']],denoise:['FLOAT']},['LATENT']],
        SetLatentNoiseMask:[{samples:['LATENT'],mask:['MASK']},['LATENT']],
        SaveImage:[{images:['IMAGE'],filename_prefix:['STRING']},[]],
    };
    const inventory=Object.fromEntries(Object.entries(definitions).map(([name,[required,output]])=>[name,{input:{required},output,output_node:name==='SaveImage'}]));
    const {checkGraph}=require('../lib/visual-capabilities');
    assert.deepEqual(checkGraph(job.graph,inventory),[]);
    assert.equal(job.guided,true);assert.equal(job.reason,null);
    const {builtinRecipe}=require('../lib/visual-recipes');
    assert.equal(builtinRecipe('scene_layered',{}).version,1);
    delete inventory.InvertMask;
    assert.ok(checkGraph(job.graph,inventory).some(e=>e.includes('InvertMask')));
});

test('task counters separate submitted, failures, cache hits and local expressions by chat',t=>{
    const q=setup(t), base=enqueue(q,input(q));
    q.transition(base,'running',{promptId:'remote'});q.transition(base,'done',{outputs:[{filename:'final.png'}]});
    const local={...base,id:'local',requestKey:'local',operation:'sprite',expressionAnchor:{id:'anchor'},status:'failed_final'};
    q.save(local);
    q.db.prepare('INSERT INTO visual_reuse_events VALUES(?,?,?)').run('u:chat','reuse','background');
    const counts=q.metrics('u:chat').counts;
    assert.equal(counts.illustration.submitted,1);assert.equal(counts.illustration.completed,1);
    assert.equal(counts.local_expression.failed,1);assert.equal(counts.background.reused,1);
    assert.equal(q.metrics('other:chat').counts.illustration.jobs,0);
});
