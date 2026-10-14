'use strict';
const fail = message => { throw Object.assign(new Error(message), {status:400}); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function userRecipe(input) {
    if (!/^user-[a-zA-Z0-9_-]{1,70}$/.test(input.workflow || '')) fail('Custom recipes require a user- workflow ID');
    const recipe = input.customRecipe;
    if (!object(recipe) || Buffer.byteLength(JSON.stringify(recipe)) > 128*1024) fail('Invalid custom recipe or recipe exceeds 128 KiB');
    if (recipe.adapter) fail('Custom adapters are not supported');
    if (recipe.operation !== (input.operation || 'illustration')) fail('Workflow operation does not match the requested image type');
    if (!['illustration','background','sprite'].includes(recipe.operation)) fail('Invalid workflow operation');
    const graph = recipe.workflow;
    if (!object(graph) || !Object.keys(graph).length || Object.keys(graph).length > 256) fail('Expected API graph with 1–256 nodes');
    const unsafe = ['__proto__','constructor','prototype'];
    for (const [id,node] of Object.entries(graph)) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || unsafe.includes(id) || !object(node) || typeof node.class_type !== 'string' || !node.class_type || !object(node.inputs)) fail('Invalid API graph node');
        if (Object.keys(node.inputs).some(k=>unsafe.includes(k))) fail('Unsafe node input');
    }
    if (!Object.hasOwn(graph,recipe.outputNode || '')) fail('Output node is missing');
    if (!Array.isArray(recipe.bindings) || !recipe.bindings.some(b=>b.source === 'positive')) fail('Scene prompt binding is required');
    const seen = new Set();
    for (const b of [...recipe.bindings,...(recipe.checkpointBinding ? [recipe.checkpointBinding] : [])]) {
        if (!object(b) || unsafe.includes(b.node) || unsafe.includes(b.input) || !Object.hasOwn(graph[b.node]?.inputs || {},b.input)) fail('Invalid recipe binding');
        if (['positive','negative'].includes(b.source) && (typeof graph[b.node].inputs[b.input] !== 'string' || ['ckpt_name','lora_name','unet_name','vae_name','clip_name','filename_prefix','sampler_name','scheduler','weight_dtype','type','device','image','mask'].includes(b.input))) fail('Prompt binding must target a text input');
        const key=b.node+'.'+b.input;
        if (seen.has(key)) fail('Duplicate binding');
        seen.add(key);
    }
    for (const b of recipe.bindings) if (typeof b.source !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(b.source) || b.source.split('.').some(k=>unsafe.includes(k)) || !['positive','negative','seed','previous','scene','composition','modelFiles','checkpoint','promptProfile'].includes(b.source.split('.')[0])) fail('Unsupported custom binding source');
    for (const b of recipe.bindings) {
        if (b.template === undefined) continue;
        if (!['positive','negative'].includes(b.source) || typeof b.template !== 'string' || b.template.length>4000) fail('Invalid prompt template');
        const tokens=[...b.template.matchAll(/\{\{([^{}]+)\}\}/g)].map(m=>m[1]);
        if (!tokens.includes(b.source) || tokens.some(t=>!['positive','negative','userPositive','userNegative'].includes(t))) fail('Invalid prompt chip or missing scene source');
    }
    if (recipe.loraSlots !== undefined && (!Array.isArray(recipe.loraSlots) || recipe.loraSlots.length>16 || recipe.loraSlots.some(id=>graph[id]?.class_type!=='LoraLoader'))) fail('Invalid LoRA slots');
    return JSON.parse(JSON.stringify(recipe));
}
module.exports = {userRecipe};
