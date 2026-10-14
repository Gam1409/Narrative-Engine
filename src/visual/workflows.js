export const RECIPE_LIMIT = 128 * 1024;
export const WORKFLOW_SETTINGS = ['visualWorkflow', 'visualBackgroundWorkflow', 'visualSpriteWorkflow', 'visualPartialWorkflow'];
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const fail = message => { throw new Error(message); };
export function readWorkflowFile(text) {
    if (new TextEncoder().encode(text).length > RECIPE_LIMIT) fail('Workflow file exceeds 128 KiB.');
    let value;
    try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { fail('Invalid JSON. Export the workflow again from ComfyUI.'); }
    if (Array.isArray(value?.nodes)) fail('This is a ComfyUI editor file. Export in API format, then import that JSON.');
    const recipe = object(value?.workflow) ? value : null;
    const graph = recipe?.workflow || value?.prompt || value;
    checkGraphShape(graph);
    return { graph, recipe };
}
export function checkGraphShape(graph) {
    if (!object(graph) || !Object.keys(graph).length || Object.keys(graph).length > 256) fail('Expected an API graph with 1–256 nodes.');
    for (const [id, node] of Object.entries(graph)) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ['__proto__','constructor','prototype'].includes(id)) fail('Invalid node ID.');
        if (!object(node) || typeof node.class_type !== 'string' || !node.class_type || !object(node.inputs)) fail(`Node ${id} must contain class_type and inputs.`);
    }
}
export function validateUserRecipe(recipe) {
    if (!object(recipe) || new TextEncoder().encode(JSON.stringify(recipe)).length > RECIPE_LIMIT) fail('Invalid recipe or recipe exceeds 128 KiB.');
    checkGraphShape(recipe.workflow);
    if (!['illustration','background','sprite'].includes(recipe.operation)) fail('Choose illustration, background or sprite.');
    if (!Object.hasOwn(recipe.workflow, recipe.outputNode || '')) fail('Choose an image output node.');
    if (!Array.isArray(recipe.bindings) || !recipe.bindings.some(b => b.source === 'positive')) fail('Bind the scene prompt to a text input.');
    const seen = new Set();
    for (const binding of [...recipe.bindings, ...(recipe.checkpointBinding ? [recipe.checkpointBinding] : [])]) {
        if (!Object.hasOwn(recipe.workflow[binding?.node]?.inputs || {}, binding?.input || '')) fail('A binding refers to a missing node input.');
        if (['positive','negative'].includes(binding.source) && !isPromptInput(binding.input,recipe.workflow[binding.node].inputs[binding.input])) fail('Prompt bindings require a text input, not a model filename or sampler setting.');
        const key = `${binding.node}.${binding.input}`;
        if (seen.has(key)) fail('Each input may have only one binding.');
        seen.add(key);
    }
    for (const binding of recipe.bindings) {
        if (binding.template === undefined) continue;
        if (!['positive','negative'].includes(binding.source) || typeof binding.template !== 'string' || binding.template.length > 4000) fail('Invalid prompt template.');
        const tokens = [...binding.template.matchAll(/\{\{([^{}]+)\}\}/g)].map(m=>m[1]);
        if (tokens.some(t=>!['positive','negative','userPositive','userNegative'].includes(t)) || !tokens.includes(binding.source)) fail('Keep the scene prompt chip and use only supported chips.');
        if (binding.template.replace(/\{\{[^{}]+\}\}/g,'').includes('{{') || binding.template.replace(/\{\{[^{}]+\}\}/g,'').includes('}}')) fail('Unclosed prompt chip.');
    }
    if (recipe.adapter) fail('Custom adapters are not supported by file import. Use an API graph recipe.');
    for (const b of recipe.bindings) if (typeof b.source !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(b.source) || b.source.split('.').some(k => ['__proto__','constructor','prototype'].includes(k)) || !['positive','negative','seed','previous','scene','composition','modelFiles','checkpoint','promptProfile'].includes(b.source.split('.')[0])) fail('Unsupported binding source.');
    if (recipe.loraSlots !== undefined && (!Array.isArray(recipe.loraSlots) || recipe.loraSlots.length > 16 || recipe.loraSlots.some(id=>recipe.workflow[id]?.class_type !== 'LoraLoader'))) fail('Invalid LoRA slots.');
    return structuredClone(recipe);
}
export function selectedRecipe(settings, workflow) {
    const item = settings.visualUserWorkflows?.find(item => item.id === workflow);
    if (String(workflow).startsWith('user-') && !item) fail('The selected imported workflow is missing. Import it again or choose another workflow.');
    return item ? validateUserRecipe(item.recipe) : null;
}
export function saveUserWorkflow(settings, item) {
    if (!/^user-[a-zA-Z0-9_-]{1,70}$/.test(item.id)) fail('Invalid imported workflow ID.');
    const next = [...(settings.visualUserWorkflows || []).filter(row => row.id !== item.id),
        {id:item.id,name:String(item.name || 'Imported workflow').trim().slice(0,80),recipe:validateUserRecipe(item.recipe)}];
    if (next.length > 8 || new TextEncoder().encode(JSON.stringify(next)).length > 384 * 1024) fail('Keep up to 8 imported workflows, 384 KiB in total. Export and remove an unused recipe first.');
    return next;
}

export function isPromptInput(name,value) {
    return typeof value === 'string' && !['ckpt_name','lora_name','unet_name','vae_name','clip_name','filename_prefix','sampler_name','scheduler','weight_dtype','type','device','image','mask'].includes(name);
}
