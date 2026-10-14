'use strict';
const { compilePrompts } = require('./visual-prompts');
const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const unsafe = ['__proto__', 'prototype', 'constructor'];
function bind(graph, binding, value) {
    if (
        !binding ||
        unsafe.includes(binding.node) ||
        unsafe.includes(binding.input) ||
        !Object.hasOwn(graph, binding.node) ||
        !Object.hasOwn(graph[binding.node].inputs, binding.input)
    )
        fail('Invalid workflow binding');
    graph[binding.node].inputs[binding.input] = clone(value);
}
function buildWorkflow(recipe, input) {
    if (recipe?.adapter === 'integrated-v1') return require('./visual-integrated').buildIntegrated(recipe, input);
    if (!recipe?.workflow || typeof recipe.workflow !== 'object') fail('Workflow is not configured', 503);
    const graph = clone(recipe.workflow);
    const prompts = compilePrompts(input.scene, {
        profile: input.promptProfile || recipe.promptProfile || 'sdxl',
        operation: input.operation,
        animaVariant: input.animaVariant,
        userPositive: input.userPositive, userNegative: input.userNegative,
        composition: input.composition,
    });
    const values = { ...input, ...prompts };
    for (const binding of recipe.bindings || []) {
        if (binding.stage && !input.stages?.[binding.stage]) continue;
        const parts = String(binding.source).split('.');
        if (parts.some((k) => unsafe.includes(k))) fail('Invalid binding source');
        const value = parts.reduce((v, k) => v?.[k], values) ?? binding.default;
        if (value === undefined) fail(`Missing workflow value: ${binding.source}`);
        if (binding.template !== undefined) {
            if (!['positive','negative'].includes(binding.source) || typeof binding.template !== 'string' || binding.template.length > 4000) fail('Invalid prompt template');
            const parts = {positive:prompts.generatedPositive, negative:prompts.generatedNegative, userPositive:prompts.userPositive, userNegative:prompts.userNegative};
            const rendered = binding.template.replace(/\{\{([^{}]+)\}\}/g, (_, token) => {
                if (!Object.hasOwn(parts, token)) fail('Unknown prompt chip: ' + token);
                return parts[token];
            });
            if (rendered.includes('{{') || rendered.includes('}}') || rendered.length > 16000) fail('Invalid or oversized prompt template');
            bind(graph, binding, rendered.trim());
        } else bind(graph, binding, value);
    }
    for (const [name, enabled] of Object.entries(input.stages || {}))
        if (enabled && !Object.hasOwn(recipe.stages || {}, name)) fail(`Workflow has no stage ${name}`);
    for (const [name, stage] of Object.entries(recipe.stages || {}))
        for (const patch of (input.stages?.[name] ? stage.on : stage.off) || []) bind(graph, patch, patch.value);
    const characters =
        input.operation === 'background' ? [] : input.scene.characters.filter((c) => c.profile?.lora?.length);
    if (characters.length > 1)
        fail('Multiple character LoRAs require a regional workflow adapter; use separate sprites');
    const loras = characters.flatMap((c) => c.profile.lora);
    if (loras.length > (recipe.loraSlots || []).length)
        fail('Workflow has insufficient LoRA slots; identity LoRA must not be skipped');
    if (new Set(recipe.loraSlots || []).size !== (recipe.loraSlots || []).length)
        fail('Duplicate LoRA slots');
    // Unused identity slots must not retain the template character's weights.
    for (const slot of (recipe.loraSlots || []).slice(loras.length)) {
        if (graph[slot]?.class_type !== 'LoraLoader') fail('LoRA slot must address a LoraLoader node');
        bind(graph, { node: slot, input: 'strength_model' }, 0);
        bind(graph, { node: slot, input: 'strength_clip' }, 0);
    }
    for (let index = 0; index < loras.length; index++) {
        const lora = loras[index],
            slot = recipe.loraSlots[index];
        if (lora.family && lora.family !== prompts.profile) fail(`LoRA family mismatch: ${lora.name}`);
        if (!lora.family)
            fail(`LoRA compatibility is unknown: ${lora.name}; select its model family in the character card`);
        if (graph[slot]?.class_type !== 'LoraLoader') fail('LoRA slot must address a LoraLoader node');
        bind(graph, { node: slot, input: 'lora_name' }, lora.name);
        bind(graph, { node: slot, input: 'strength_model' }, lora.weight);
        bind(graph, { node: slot, input: 'strength_clip' }, lora.clipWeight ?? lora.weight);
    }
    if (loras.length) {
        const reachesOutput = (source, seen = new Set()) => {
            if (seen.has(source)) return false;
            seen.add(source);
            return Object.entries(graph).some(([id, node]) => {
                if (!Object.values(node.inputs || {}).some((value) => Array.isArray(value) && value[0] === source))
                    return false;
                return ['SaveImage', 'PreviewImage'].includes(node.class_type) || reachesOutput(id, seen);
            });
        };
        for (const slot of (recipe.loraSlots || []).slice(0, loras.length)) {
            if (!reachesOutput(slot)) fail('LoRA slot is disconnected from image outputs');
        }
    }
    if (input.checkpoint) {
        if (!recipe.checkpointBinding) fail('Workflow has no checkpoint binding');
        bind(graph, recipe.checkpointBinding, input.checkpoint);
    }
    return graph;
}

module.exports = { buildWorkflow };
