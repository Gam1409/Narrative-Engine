"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWorkflow } = require("../lib/visual-workflow");
const { builtinRecipe } = require("../lib/visual-recipes");
const { checkGraph } = require("../lib/visual-capabilities");
function input() {
  return {
    seed: 42,
    operation: "illustration",
    checkpoint: "base.safetensors",
    promptProfile: "anima",
    modelFiles: { textEncoder: "qwen.safetensors", vae: "vae.safetensors" },
    composition: { style: "soft painted anime", camera: "low angle" },
    scene: {
      location: { name: "bedroom", lighting: "warm" },
      characters: ["A", "B"].map((id) => ({
        id,
        name: id,
        outfit: id === "A" ? "blue ruffled dress" : "brown trousers",
        emotion: "neutral",
        profile: {
          lora: [
            {
              name: id + ".safetensors",
              weight: 0.8,
              family: "anima",
              triggerWords: id + "_trigger",
            },
          ],
        },
      })),
    },
  };
}
function build(x) {
  return buildWorkflow(builtinRecipe("scene_integrated", x), x);
}
test("whole-frame composition precedes separate masked identity passes without sprite inputs", () => {
  const x = input(),
    before = structuredClone(x),
    g = build(x),
    nodes = Object.values(g),
    loras = nodes.filter((n) => n.class_type === "LoraLoader");
  assert.deepEqual(x, before);
  assert.equal(loras.length, 2);
  assert.deepEqual(loras[0].inputs.model, loras[1].inputs.model);
  assert.deepEqual(loras[0].inputs.clip, loras[1].inputs.clip);
  assert.equal(nodes.filter((n) => n.class_type === "KSampler").length, 3);
  assert.equal(
    nodes.filter((n) => n.class_type === "SetLatentNoiseMask").length,
    2,
  );
  assert.equal(nodes.filter((n) => n.class_type === "LoadImage").length, 0);
  const text = nodes
    .filter((n) => n.class_type === "CLIPTextEncode")
    .map((n) => n.inputs.text);
  assert.match(text[0], /blue ruffled dress/);
  assert.match(text[0], /brown trousers/);
  assert.doesNotMatch(text[0], /_trigger/);
  assert.match(text[2], /A_trigger/);
  assert.doesNotMatch(text[2], /B_trigger/);
  assert.match(text[4], /B_trigger/);
  assert.doesNotMatch(text[4], /A_trigger/);
  assert.equal(g["900"].class_type, "SaveImage");
});
test("identity compatibility, capacity, weights and model filenames fail closed", () => {
  const x = input();
  x.scene.characters[1].profile.lora[0].family = "illustrious";
  assert.throws(() => build(x), /family/);
  x.scene.characters[1].profile.lora[0].family = "anima";
  x.scene.characters[1].profile.lora[0].weight = Infinity;
  assert.throws(() => build(x), /weight/);
  const y = input();
  y.modelFiles.vae = "";
  assert.throws(() => build(y), /VAE/);
  y.modelFiles.vae = "../secret";
  assert.throws(() => build(y), /VAE/);
  const z = input();
  z.scene.characters.push(z.scene.characters[0]);
  assert.throws(() => build(z), /two characters/);
  const q = input();
  q.stages = { ipadapter: true };
  assert.throws(() => build(q), /optional stages/);
});
test("accepted outfit changes reach scene and identity pass; other character stays unchanged", () => {
  const x = input(),
    base = build(x);
  x.scene.characters[0].outfit = "burgundy cardigan and charcoal skirt";
  const changed = build(x);
  const text = (g) =>
    Object.values(g)
      .filter((n) => n.class_type === "CLIPTextEncode")
      .map((n) => n.inputs.text);
  assert.match(text(changed)[0], /burgundy cardigan/);
  assert.match(text(changed)[2], /charcoal skirt/);
  assert.doesNotMatch(text(changed)[0], /blue ruffled dress/);
  assert.equal(text(base)[4], text(changed)[4]);
});
test("background and sprite share style, sprite uses transparent output and one identity", () => {
  const x = input();
  x.operation = "background";
  x.scene.characters = [];
  const bg = buildWorkflow(builtinRecipe("background_integrated", x), x);
  assert.equal(
    Object.values(bg).filter((n) => n.class_type === "LoraLoader").length,
    0,
  );
  assert.match(
    Object.values(bg).find((n) => n.class_type === "CLIPTextEncode").inputs
      .text,
    /soft painted anime/,
  );
  const y = input();
  y.operation = "sprite";
  y.scene.characters.length = 1;
  const g = buildWorkflow(builtinRecipe("sprite_integrated", y), y);
  assert.equal(
    Object.values(g).filter((n) => n.class_type === "JoinImageWithAlpha")
      .length,
    1,
  );
  assert.equal(
    Object.values(g).filter((n) => n.class_type === "LoraLoader").length,
    1,
  );
  y.composition.style = "x".repeat(301);
  assert.throws(
    () => buildWorkflow(builtinRecipe("sprite_integrated", y), y),
    /composition/,
  );
});
test("modern COMBO inventory rejects unavailable model before GPU submission", () => {
  const inventory = {
    Loader: {
      input: { required: { model: ["COMBO", { options: ["installed"] }] } },
      output: [],
      output_node: true,
    },
  };
  assert.match(
    checkGraph(
      { 1: { class_type: "Loader", inputs: { model: "missing" } } },
      inventory,
    ).join(),
    /unavailable/,
  );
});


test('empty hands are grounded in explicit inventory, never inferred from unknown inventory', () => {
  const {compilePrompts}=require('../lib/visual-prompts');
  const x=input(); x.scene.characters.length=1;
  assert.doesNotMatch(compilePrompts(x.scene).positive,/empty hands/);
  x.scene.characters[0].holding=[];
  assert.match(compilePrompts(x.scene).positive,/empty hands/);
  x.scene.characters[0].holding=['book'];
  assert.doesNotMatch(compilePrompts(x.scene).positive,/empty hands/);
});


test("integrated recipes allow bounded CFG overrides without changing default", () => {
  const x = input(), recipe = builtinRecipe("scene_integrated", x);
  const values = (graph) => Object.values(graph).filter(n => n.class_type === "KSampler").map(n => n.inputs.cfg);
  assert.deepEqual(values(buildWorkflow(recipe, x)), [4, 4, 4]);
  assert.deepEqual(values(buildWorkflow({...recipe, cfg: 3}, x)), [3, 3, 3]);
  for (const cfg of [0, 13, NaN, "3"]) assert.throws(() => buildWorkflow({...recipe, cfg}, x), /CFG/);
});


test("detail pass preserves base graph and uses enlarged masks with independent identity branches", () => {
  const x = input(), recipe = builtinRecipe("scene_integrated", x);
  const base = buildWorkflow(recipe, x);
  const graph = buildWorkflow({...recipe, detail: {scale: 1.5, denoise: 0.16}}, x);
  for (const [id, node] of Object.entries(base)) if (id !== "900") assert.deepEqual(graph[id], node);
  assert.deepEqual(graph["901"].inputs.images, base["900"].inputs.images);
  const nodes = Object.values(graph);
  assert.equal(nodes.filter(n => n.class_type === "EmptyLatentImage").length, 1);
  assert.deepEqual(nodes.filter(n => n.class_type === "KSampler").map(n => n.inputs.denoise), [1, .35, .35, .16, .16]);
  assert.equal(nodes.filter(n => n.class_type === "SolidMask" && n.inputs.width === 1536 && n.inputs.height === 1152).length, 2);
  const loras = nodes.filter(n => n.class_type === "LoraLoader");
  assert.ok(loras.every(n => JSON.stringify(n.inputs.model) === JSON.stringify(loras[0].inputs.model)));
  for (const detail of [null, [], {scale: 4, denoise: .1}, {scale: 2, denoise: .9}, {scale: 2, denoise: .1, typo: true}])
    assert.throws(() => buildWorkflow({...recipe, detail}, x), /Detail pass/);
  const sprite = {...x, operation: 'sprite', scene: {...x.scene, characters: [x.scene.characters[0]]}};
  assert.throws(() => buildWorkflow({...builtinRecipe('sprite_integrated', sprite), detail: {scale: 2, denoise: .1}}, sprite), /Detail pass/);
});


test("detail pass works for unprofiled pairs, solo portraits and empty environments", () => {
  for (const count of [0, 1, 2]) {
    const x = input(); x.scene.characters = x.scene.characters.slice(0, count);
    for (const c of x.scene.characters) c.profile.lora = [];
    const graph = buildWorkflow({...builtinRecipe('scene_integrated', x), detail:{scale:1.5,denoise:.16}}, x);
    assert.equal(Object.values(graph).filter(n => n.class_type === 'KSampler').length, count === 2 ? 3 : 2);
  }
});

test('Anima variants use dedicated loaders, bounded sampler defaults and compatible prompts', () => {
  for (const [variant, steps, cfg] of [['base',30,4],['aesthetic',30,4],['turbo',10,1]]) {
    const x=input();x.animaVariant=variant;
    const recipe=builtinRecipe('scene_anima',x);
    const graph=buildWorkflow(recipe,x), nodes=Object.values(graph);
    assert.equal(nodes.filter(n=>n.class_type==='CheckpointLoaderSimple').length,0);
    assert.ok(nodes.some(n=>n.class_type==='UNETLoader'));
    assert.equal(nodes.find(n=>n.class_type==='CLIPLoader').inputs.type,'stable_diffusion');
    for(const node of nodes.filter(n=>n.class_type==='KSampler')){assert.equal(node.inputs.steps,steps);assert.equal(node.inputs.cfg,cfg);}
    const texts=nodes.filter(n=>n.class_type==='CLIPTextEncode').map(n=>n.inputs.text).join(' ');
    if(variant==='base')assert.match(texts,/score_7/);else assert.doesNotMatch(texts,/score_\d/);
  }
  const x=input();assert.throws(()=>buildWorkflow(builtinRecipe('scene_anima',x),{...x,promptProfile:'sdxl'}),/Anima prompt profile/);
  assert.throws(()=>buildWorkflow(builtinRecipe('scene_anima',x),{...x,modelFiles:{}}),/text encoder/);
  assert.throws(()=>buildWorkflow(builtinRecipe('scene_anima',x),{...x,animaVariant:'unknown'}),/variant/);
});
