'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compilePrompts } = require('../lib/visual-prompts');
const { buildWorkflow } = require('../lib/visual-workflow');
const { builtinRecipe } = require('../lib/visual-recipes');
const { checkGraph } = require('../lib/visual-capabilities');

const scene = () => ({
    location: { id: 'room', name: 'Kitchen', lighting: 'warm' },
    keyObjects: [],
    characters: [
        {
            id: 'Anna',
            name: 'Anna',
            outfit: 'blue dress',
            wardrobe: [{ id: 'dress', name: 'Ruffled dress', properties: { condition: 'torn', details: 'buttons' } }],
            profile: {
                appearance: 'dark hair',
                lora: [{ name: 'anna.safetensors', weight: 0.8, family: 'illustrious' }],
            },
        },
    ],
});

test('compiler preserves clothing state without raw JSON and selects distinct model profiles', () => {
    const input = scene();
    const sdxl = compilePrompts(input, { profile: 'sdxl' });
    const pony = compilePrompts(input, { profile: 'pony' });
    const illustrious = compilePrompts(input, { profile: 'illustrious' });
    for (const output of [sdxl, pony, illustrious]) {
        assert.match(output.positive, /torn/);
        assert.match(output.positive, /buttons/);
        assert.doesNotMatch(output.positive, /[{}]|"id"/);
    }
    assert.match(pony.positive, /score_9/);
    assert.doesNotMatch(illustrious.positive, /score_9/);
    assert.equal(sdxl.format, 'natural');
    assert.equal(illustrious.format, 'tags');
    assert.throws(() => compilePrompts(input, { negative: ['dark hair'] }), /Conflicting/);
});

test('background compiler excludes characters and their identity LoRA words', () => {
    const output = compilePrompts(scene(), { operation: 'background' });
    assert.doesNotMatch(output.positive, /Anna|dark hair|dress/);
    assert.match(output.positive, /Kitchen/);
    assert.match(output.negative, /people/);
});

test('built-in workflow binds exact LoRA weights and negative text; rejects wrong family', () => {
    const input = {
        scene: scene(),
        seed: 42,
        checkpoint: 'novaOrangeXL_rexV10.safetensors',
        promptProfile: 'illustrious',
    };
    const recipe = builtinRecipe('scene_full', input);
    const graph = buildWorkflow(recipe, input);
    assert.equal(graph['10'].inputs.lora_name, 'anna.safetensors');
    assert.equal(graph['10'].inputs.strength_model, 0.8);
    assert.deepEqual(graph['5'].inputs.model, ['10', 0]);
    assert.deepEqual(graph['2'].inputs.clip, ['10', 1]);
    assert.equal(graph['3'].inputs.text, 'watermark');
    assert.throws(() => buildWorkflow(recipe, { ...input, promptProfile: 'pony' }), /family mismatch/);
    input.scene.characters[0].profile.lora[0].family = undefined;
    assert.throws(() => buildWorkflow(recipe, input), /unknown/);
    assert.throws(() => builtinRecipe('scene_full', { ...input, promptProfile: 'anima' }), /Anima requires/);
});

test('LoRA cannot silently disappear from a workflow without slots or be globally mixed across characters', () => {
    const input = { scene: scene(), seed: 1, checkpoint: 'test', promptProfile: 'illustrious' };
    const recipe = builtinRecipe('scene_full', input);
    recipe.loraSlots = [];
    assert.throws(() => buildWorkflow(recipe, input), /LoRA slots/);
    input.scene.characters.push({ ...input.scene.characters[0], id: 'Bex', name: 'Bex' });
    assert.throws(() => buildWorkflow(builtinRecipe('scene_full', input), input), /Multiple character/);
});

test('node inventory preflight identifies missing models, inputs, output types and cycles', () => {
    const inventory = {
        Loader: { input: { required: { name: [['installed']] } }, output: ['MODEL'] },
        Output: {
            input: { required: { model: ['MODEL'], count: ['INT', { min: 1, max: 3 }] } },
            output: [],
            output_node: true,
        },
    };
    const graph = {
        1: { class_type: 'Loader', inputs: { name: 'installed' } },
        2: { class_type: 'Output', inputs: { model: ['1', 0], count: 1 } },
    };
    assert.deepEqual(checkGraph(graph, inventory), []);
    graph['1'].inputs.name = 'missing';
    graph['2'].inputs.count = 10;
    assert.ok(checkGraph(graph, inventory).some((error) => error.includes('unavailable value missing')));
    assert.ok(checkGraph(graph, inventory).some((error) => error.includes('numeric')));
    graph['2'].inputs.model = ['not-found', 0];
    assert.ok(checkGraph(graph, inventory).some((error) => error.includes('invalid output link')));
});


test('unused identity slots have zero model and CLIP influence',()=>{
    const input={scene:scene(),seed:42,checkpoint:'model',promptProfile:'illustrious'};
    const recipe=builtinRecipe('scene_full',input);
    recipe.workflow['11']={class_type:'LoraLoader',inputs:{model:['10',0],clip:['10',1],lora_name:'other.safetensors',strength_model:1,strength_clip:1}};
    recipe.loraSlots.push('11');recipe.workflow['5'].inputs.model=['11',0];
    const graph=buildWorkflow(recipe,input);
    assert.equal(graph['10'].inputs.strength_model,0.8);
    assert.equal(graph['11'].inputs.strength_model,0);assert.equal(graph['11'].inputs.strength_clip,0);
    input.scene.characters[0].profile.lora=[];
    const empty=buildWorkflow(recipe,input);
    assert.equal(empty['10'].inputs.strength_model,0);assert.equal(empty['10'].inputs.strength_clip,0);
    assert.equal(recipe.workflow['11'].inputs.strength_model,1);
});
