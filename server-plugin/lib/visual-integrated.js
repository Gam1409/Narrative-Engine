"use strict";

const { compilePrompts } = require("./visual-prompts");

const NAMES = {

  scene_integrated: "illustration",
  scene_layered: "illustration",

  background_integrated: "background",

  sprite_integrated: "sprite",
  scene_anima: "illustration",
  background_anima: "background",
  sprite_anima: "sprite",

};

function integratedRecipe(name) {

  return Object.hasOwn(NAMES, name)

    ? {

        version: name === "scene_layered" ? 1 : 3,
        ...(name === "scene_layered" ? {guidance:"layers", layerGuidance:{denoise:0.45, compose:"graph"}} : {}),
        ...(name.endsWith("_anima") ? {family:"anima"} : {}),

        adapter: "integrated-v1",

        operation: NAMES[name],

        outputNode: "900",

      }

    : null;

}

function buildIntegrated(recipe, input) {

  const operation = input.operation || "illustration";

  if (operation !== recipe.operation)

    throw Error("Integrated recipe operation mismatch");

  if (Object.values(input.stages || {}).some(Boolean))

    throw Error("Integrated recipes do not accept optional stages");

  const characters = input.scene.characters || [];

  if (characters.length > 2)

    throw Error(

      "Integrated illustrations currently support at most two characters",

    );

  if (operation === "sprite" && characters.length !== 1)

    throw Error("Sprite requires one character");

  if (operation === "background" && characters.length)

    throw Error("Background must have no characters");

  const profile = input.promptProfile || "sdxl";

  if (recipe.family && recipe.family !== profile) throw Error('Anima workflows require the Anima prompt profile');
  const animaVariant = input.animaVariant || 'base';
  if (profile === 'anima' && !['base','aesthetic','turbo'].includes(animaVariant)) throw Error('Unknown Anima variant');
  const cfg = recipe.cfg ?? (profile === "anima" ? animaVariant === 'turbo' ? 1 : 4 : 6);
  const steps = recipe.steps ?? (profile === 'anima' ? animaVariant === 'turbo' ? 10 : 30 : 28);
  if (!Number.isInteger(steps) || steps < 1 || steps > 100) throw Error('Steps must be an integer from 1 to 100');

  if (!Number.isFinite(cfg) || cfg < 1 || cfg > 12)

    throw Error("Integrated recipe CFG must be between 1 and 12");

  const layered = recipe.guidance === "layers";
  const guidance = layered ? input.layerGuidance : null;
  if (layered && (operation !== "illustration" || !guidance || !guidance.layout || !guidance.references))
    throw Error("Layered illustration requires server-resolved layers");
  if (layered && (!Number.isFinite(guidance.denoise) || guidance.denoise < 0.35 || guidance.denoise > 0.55))
    throw Error("Layer guidance denoise must be between 0.35 and 0.55");
  const detail = recipe.detail;
  if (layered && detail) throw Error("Layer guidance and detail pass cannot be combined yet");

  if (detail !== undefined && (

    !detail || typeof detail !== "object" || Array.isArray(detail) ||

    Object.keys(detail).some(key => !["scale", "denoise"].includes(key)) ||

    ![1.5, 2].includes(detail.scale) ||

    !Number.isFinite(detail.denoise) || detail.denoise < 0.05 || detail.denoise > 0.3 ||

    operation !== "illustration"

  )) throw Error("Detail pass requires illustration, scale 1.5 or 2, denoise 0.05-0.3");

  const composition = {

    ...input.composition,

    style:

      input.composition?.style ||

      "anime illustration, clean line art, soft cel shading, consistent color palette",

  };

  function filename(value, label) {

    if (

      typeof value !== "string" ||

      !value.trim() ||

      value.length > 500 ||

      value.startsWith("/") ||

      value.startsWith(String.fromCharCode(92)) ||

      value.includes("..") ||

      value.includes(":")

    )

      throw Error(`Select an installed ${label} filename`);

    return value;

  }

  const graph = {};

  let next = 1;

  function add(class_type, inputs) {

    const id = String(next++);

    graph[id] = { class_type, inputs };

    return [id, 0];

  }

  let model, clip, vae;

  if (profile === "anima") {

    model = add("UNETLoader", {

      unet_name: filename(input.checkpoint, "diffusion model"),

      weight_dtype: "default",

    });

    clip = add("CLIPLoader", {

      clip_name: filename(input.modelFiles?.textEncoder, "text encoder"),

      type: "stable_diffusion",

    });

    vae = add("VAELoader", {

      vae_name: filename(input.modelFiles?.vae, "VAE"),

    });

  } else {

    model = add("CheckpointLoaderSimple", {

      ckpt_name: filename(input.checkpoint, "checkpoint"),

    });

    clip = [model[0], 1];

    vae = [model[0], 2];

  }

  // Each identity branch starts at the unpatched base, never at another character's LoRA.

  function identity(character) {

    let branchModel = model,

      branchClip = clip;

    const loras = character.profile?.lora || [];

    if (loras.length > 8) throw Error("At most eight LoRAs per character");

    for (const lora of loras) {

      if (lora.family !== profile)

        throw Error(`LoRA family mismatch or unknown: ${lora.name}`);

      const clipWeight =

        lora.clipWeight ?? (profile === "anima" ? 0 : lora.weight);

      if (

        ![lora.weight, clipWeight].every(

          (v) => Number.isFinite(v) && Math.abs(v) <= 2,

        )

      )

        throw Error("Invalid LoRA weight");

      branchModel = add("LoraLoader", {

        model: branchModel,

        clip: branchClip,

        lora_name: filename(lora.name, "LoRA"),

        strength_model: lora.weight,

        strength_clip: clipWeight,

      });

      branchClip = [branchModel[0], 1];

    }

    return { model: branchModel, clip: branchClip };

  }

  const width = layered ? guidance.layout.width : operation === "sprite" ? 768 : 1024,

    height = layered ? guidance.layout.height : operation === "sprite" ? 1024 : 768;

  function sample(scene, branch, latent, seed, denoise, extra = "") {

    const prompts = compilePrompts(scene, { profile, operation, composition, animaVariant, userPositive:input.userPositive, userNegative:input.userNegative });

    const positive = add("CLIPTextEncode", {

      clip: branch.clip,

      text: prompts.positive + (extra ? ", " + extra : ""),

    });

    const negative = add("CLIPTextEncode", {

      clip: branch.clip,

      text: prompts.negative,

    });

    const samples = add("KSampler", {

      model: branch.model,

      positive,

      negative,

      latent_image: latent,

      seed,

      steps,

      cfg,

      sampler_name: "euler",

      scheduler: "simple",

      denoise,

    });

    return add("VAEDecode", { samples, vae });

  }

  if (input.expressionAnchor) {

    if (operation !== "sprite") throw Error("Expression anchor requires a sprite");

    const anchor = input.expressionAnchor;

    const loaded = add("LoadImage", { image: filename(anchor.filename, "anchor image") });

    const empty = add("SolidMask", {value:0, width:anchor.width, height:anchor.height});

    const area = add("SolidMask", {value:1, width:anchor.face.width, height:anchor.face.height});

    const feather = add("FeatherMask", {mask:area,left:8,top:8,right:8,bottom:8});

    const mask = add("MaskComposite", {destination:empty,source:feather,x:anchor.face.x,y:anchor.face.y,operation:"add"});

    const encoded = add("VAEEncode", {pixels:loaded,vae});

    const masked = add("SetLatentNoiseMask", {samples:encoded,mask});

    const image = sample(input.scene,identity(characters[0]),masked,input.seed,0.5,

      "change only facial expression, preserve face identity, head position and hairstyle");

    graph["900"] = {class_type:"SaveImage",inputs:{images:image,filename_prefix:"NarrativeEngine/expression"}};

    return graph;

  }

  let latent;
  const layerMasks = [];
  if (layered) {
    const [background, ...sprites] = guidance.references;
    let composite = add("LoadImage", {image: filename(background.filename, "background reference")});
    for (const [index, sprite] of sprites.entries()) {
      const slot = guidance.layout.slots[index];
      const loaded = add("LoadImage", {image: filename(sprite.filename, "sprite reference")});
      const scaled = add("ImageScale", {image: loaded, upscale_method:"bicubic", width:slot.width, height:slot.height, crop:"disabled"});
      // LoadImage returns 1-alpha: invert it before compositing, then resize the mask with the sprite.
      const alpha = add("InvertMask", {mask:[loaded[0],1]});
      const maskImage = add("MaskToImage", {mask:alpha});
      const resizedMask = add("ImageScale", {image:maskImage, upscale_method:"bilinear", width:slot.width, height:slot.height, crop:"disabled"});
      const mask = add("ImageToMask", {image:resizedMask, channel:"red"});
      composite = add("ImageCompositeMasked", {destination:composite, source:scaled, mask, x:slot.x, y:slot.y, resize_source:false});
      const empty = add("SolidMask", {value:0, width, height});
      layerMasks.push(add("MaskComposite", {destination:empty, source:mask, x:slot.x, y:slot.y, operation:"add"}));
    }
    graph["901"] = {class_type:"SaveImage", inputs:{images:composite, filename_prefix:"NarrativeEngine/layered_composite"}};
    latent = add("VAEEncode", {pixels:composite, vae});
  } else {
    latent = add("EmptyLatentImage", { width, height, batch_size: 1 });
  }

  const placed = characters.map((c, i) => ({

    ...c,

    name: `${c.name || c.id}, person on the ${i ? "right" : "left"}`,

    profile: { ...c.profile, lora: [] },

  }));

  // Whole-frame generation establishes perspective, light, poses and contact shadows first.

  let image = sample(

    characters.length === 2

      ? { ...input.scene, characters: placed }

      : input.scene,

    characters.length === 1 ? identity(characters[0]) : { model, clip },

    latent,

    input.seed,

    layered ? guidance.denoise : 1,

    operation === "illustration"

      ? "one coherent scene, shared perspective and lighting, natural body proportions, contact shadows, characters physically present in the environment"

      : "",

  );

  function refineCharacters(width, height, denoise, seedOffset = 0, requireLora = true) {

    for (const [index, character] of characters.entries()) {

      if (requireLora && !character.profile?.lora?.length) continue;

      let mask = layerMasks[index];
      if (!mask) {
        const empty = add("SolidMask", { value: 0, width, height });
        const region = add("SolidMask", { value: 1, width: width / 2, height });
        const feather = add("FeatherMask", { mask: region, left: 32, top: 16, right: 32, bottom: 16 });
        mask = add("MaskComposite", {
          destination: empty, source: feather, x: (index * width) / 2, y: 0, operation: "add",
        });
      }

      const encoded = add("VAEEncode", { pixels: image, vae });

      const masked = add("SetLatentNoiseMask", { samples: encoded, mask });

      const refined = sample(

        { ...input.scene, characters: [character] },

        identity(character),

        masked,

        (input.seed + index + 1 + seedOffset) >>> 0,

        denoise,

        `refine the person on the ${index ? "right" : "left"}, preserve existing pose, clothing cut, furniture, shadows and perspective`,

      );

      image = add("ImageCompositeMasked", {

        destination: image,

        source: refined,

        mask,

        x: 0,

        y: 0,

        resize_source: false,

      });

    }

  }

  if (characters.length === 2) refineCharacters(width, height, 0.35);

  if (detail) {

    // Save the exact pre-detail frame for acceptance; it is not the published output.

    graph["901"] = { class_type: "SaveImage", inputs: {

      images: image, filename_prefix: "NarrativeEngine/integrated_before_detail",

    } };

    image = add("ImageScaleBy", { image, upscale_method: "bicubic", scale_by: detail.scale });

    if (characters.length === 2) {

      refineCharacters(width * detail.scale, height * detail.scale, detail.denoise, 100, false);

    } else {

      const encoded = add("VAEEncode", { pixels: image, vae });

      image = sample(input.scene, characters.length ? identity(characters[0]) : { model, clip },

        encoded, (input.seed + 100) >>> 0, detail.denoise,

        "preserve existing composition, expression, clothing cut, furniture and lighting");

    }

  }

  if (operation === "sprite" && input.localExpressions === true && input.faceDetector) {

    const modelName = filename(input.faceDetector,"face detector");

    let mask;

    if (modelName.endsWith(".xml")) {

      mask = add("NEAnimeFaceMask", {image,model_name:modelName});

    } else {

      const detector = add("LoadMediaPipeFaceLandmarker", {model_name:modelName});

      const faces = add("MediaPipeFaceLandmarker", {face_detection_model:detector,image,

        detector_variant:"both",num_faces:2,min_confidence:0.5,missing_frame_fallback:"empty"});

      mask = add("MediaPipeFaceMask", {face_landmarks:faces,regions:"all"});

    }

    const maskImage = add("MaskToImage", {mask});

    graph["902"] = {class_type:"SaveImage",inputs:{images:maskImage,filename_prefix:"NarrativeEngine/anchor_face"}};

  }

  if (operation === "sprite") {

    const removal = add("LoadBackgroundRemovalModel", {

      bg_removal_name: "birefnet.safetensors",

    });

    const foreground = add("RemoveBackground", {

      bg_removal_model: removal,

      image,

    });

    const alpha = add("InvertMask", { mask: foreground });

    image = add("JoinImageWithAlpha", { image, alpha });

  }

  graph["900"] = {

    class_type: "SaveImage",

    inputs: {

      images: image,

      filename_prefix: `NarrativeEngine/integrated_${operation}`,

    },

  };

  return graph;

}

module.exports = { integratedRecipe, buildIntegrated };
