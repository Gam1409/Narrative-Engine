"use strict";
const crypto = require("node:crypto");
const { planCompositeLayout } = require("./visual-layout");

// Public input contains asset IDs and expected resource keys, never ComfyUI filenames or rectangles.
function resolveLayerGuidance(assets, scope, input, recipe) {
    if (recipe.adapter !== "integrated-v1" || recipe.operation !== "illustration" || recipe.layerGuidance?.compose !== "graph")
        throw Error("Layer guidance requires an integrated graph illustration recipe");
    const characters = input.scene.characters;
    if (characters.length > 2 || new Set(characters.map(c => c.id)).size !== characters.length)
        throw Error("Layer guidance supports at most two distinct characters");
    const wanted = [{operation:"background", characterId:null}, ...characters.map(c => ({operation:"sprite", characterId:c.id}))];
    const refs = input.layerReferences;
    if (!Array.isArray(refs) || refs.length !== wanted.length)
        throw Error("Layer references must include the background and every current character");
    const references = wanted.map((expected, index) => {
        const ref = refs[index];
        if (!ref || typeof ref.assetId !== "string" || !/^[a-f0-9]{64}$/.test(ref.resourceKey || ""))
            throw Error("Layer reference requires an asset ID and expected resource key");
        const asset = assets.metadata(scope, ref.assetId);
        if (asset.operation !== expected.operation || asset.characterId !== expected.characterId || asset.resourceKey !== ref.resourceKey)
            throw Error("Layer reference does not match its operation, character or resource key");
        if (expected.operation === "sprite" && !asset.transparent) throw Error("Sprite reference must preserve transparency");
        const token = crypto.createHash("sha256").update(JSON.stringify([scope,asset.id,asset.sha256])).digest("hex");
        return {assetId:asset.id, resourceKey:asset.resourceKey, characterId:asset.characterId,
            filename:`ne-layer-${token}.png`, width:asset.width, height:asset.height};
    });
    const background = references[0];
    if (background.width % 8 || background.height % 8)
        throw Error("Layer background dimensions must be divisible by eight for VAE encoding");
    const layout = planCompositeLayout({width:background.width, height:background.height,
        camera:input.layerCamera || "full body, eye level",
        characters:references.slice(1).map(ref => ({id:ref.characterId,width:ref.width,height:ref.height}))});
    const denoise = input.layerDenoise ?? recipe.layerGuidance.denoise ?? 0.45;
    if (!Number.isFinite(denoise) || denoise < 0.35 || denoise > 0.55)
        throw Error("Layer guidance denoise must be between 0.35 and 0.55");
    return {version:1, references, layout, denoise};
}
module.exports = { resolveLayerGuidance };
