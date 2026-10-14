'use strict';

// Bounded, known SDXL-family API template. No arbitrary graph is authored by an LLM.
function builtinRecipe(name, input) {
    const integrated = require('./visual-integrated').integratedRecipe(name);
    if (integrated) return integrated;
    if (!['scene_full', 'background'].includes(name)) return null;
    if (input.promptProfile === 'anima')
        throw new Error(
            'Anima requires a dedicated diffusion model, text encoder and VAE recipe; the SDXL template cannot be used',
        );
    const background = name === 'background';
    if (background && input.operation !== 'background')
        throw new Error('Background recipe requires a background operation');
    if (!input.checkpoint) throw new Error('Select an installed checkpoint');
    const workflow = {
        1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: input.checkpoint } },
        2: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
        3: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
        4: { class_type: 'EmptyLatentImage', inputs: { width: 1216, height: 832, batch_size: 1 } },
        5: {
            class_type: 'KSampler',
            inputs: {
                seed: 1,
                steps: 28,
                cfg: 6,
                sampler_name: 'euler_ancestral',
                scheduler: 'normal',
                denoise: 1,
                model: ['1', 0],
                positive: ['2', 0],
                negative: ['3', 0],
                latent_image: ['4', 0],
            },
        },
        6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
        7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'narrative-engine' } },
    };
    const loras = background
        ? []
        : (input.scene.characters || []).flatMap((character) => character.profile?.lora || []);
    if (loras.length > 8) throw new Error('At most eight LoRAs are supported');
    let model = ['1', 0],
        clip = ['1', 1];
    const loraSlots = [];
    for (let index = 0; index < loras.length; index++) {
        const id = String(10 + index);
        workflow[id] = {
            class_type: 'LoraLoader',
            inputs: {
                model,
                clip,
                lora_name: '',
                strength_model: 1,
                strength_clip: 1,
            },
        };
        loraSlots.push(id);
        model = [id, 0];
        clip = [id, 1];
    }
    workflow['2'].inputs.clip = clip;
    workflow['3'].inputs.clip = clip;
    workflow['5'].inputs.model = model;
    return {
        version: 1,
        outputNode: '7',
        workflow,
        loraSlots,
        checkpointBinding: { node: '1', input: 'ckpt_name' },
        bindings: [
            { node: '2', input: 'text', source: 'positive' },
            { node: '3', input: 'text', source: 'negative' },
            { node: '5', input: 'seed', source: 'seed' },
        ],
        stages: {},
    };
}
module.exports = { builtinRecipe };
