# Layer workflow contract

Use `NARRATIVE_ENGINE_COMFY_WORKFLOWS` to point at the server recipe JSON, then restart the plugin. This stage adds recipe selection, not browser workflow import. Keep the existing illustration recipe alongside your background/sprite recipes.

`background` is available as a built-in SDXL-family recipe. A custom sprite recipe must contain:

- `operation: "sprite"` and `version` (bump it when replacing model files under unchanged names).
- `workflow`: a ComfyUI **API-format** graph tested with the installed background-removal/alpha-save nodes.
- `outputNode`: the string ID of the node whose `history.outputs[id].images` contains the final transparent PNG. Only its first output image is used for the layer; previews from other nodes are ignored.
- `bindings` for `positive`, `negative`, and `seed`, using the same `{node, input, source}` format as the [illustration example](./comfy-workflows.example.json).
- `checkpointBinding` when selecting a checkpoint from extension settings.
- `loraSlots`: IDs of connected `LoraLoader` nodes sufficient for the selected card's identity LoRAs. Family and file availability checks still apply. A recipe without LoRA slots is only suitable for a character without configured identity LoRAs.

A graph marked `operation: "sprite"` is not automatically made transparent. The server decodes its final PNG and rejects fully opaque or fully invisible results. Correct masking and visual identity still need live inspection. Node/model preflight runs before `/prompt`; it does not prove output quality.

Sprite inputs contain one character with canonical wardrobe/condition and no room description. Background inputs contain the environment with no characters. Layer requests currently pass no optional stage toggles; put required conditioning stages directly in each tested graph. Built-in SDXL graphs cannot load Anima.

Assets are served from authenticated, chat-scoped `/visual/asset/:chatId/:id` routes and saved in the plugin SQLite database. Changing the ComfyUI URL preserves reusable assets. Replacing a checkpoint/LoRA binary under the same filename is not detected automatically; bump recipe `version` or use a new filename.

Unused declared identity LoRA slots receive zero model and CLIP weights. Their configured files must still pass inventory validation. After an uncertain ComfyUI submission, automatic updates and reloads preserve the failed task instead of spending GPU again; **Build current scene layers** is the explicit retry. With automatic generation disabled, reopening a chat only attaches to existing work/resources.


Integrated recipes may override classifier-free guidance with `cfg` (finite number 1–12). For example, a named server recipe `{ "adapter": "integrated-v1", "operation": "illustration", "outputNode": "900", "version": 1, "cfg": 3 }` applies CFG 3 to the base and identity passes. Default CFG remains 4 for Anima and 6 for other profiles. CFG is not LLM temperature: changing seeds explores alternative compositions, while changing CFG alters prompt guidance. The tested override does not add a new browser setting.


### Optional illustration detail pass

A server recipe can enable a conservative second pass, for example:

```json
{
  "scene_detailed": {
    "adapter": "integrated-v1",
    "operation": "illustration",
    "version": 1,
    "outputNode": "900",
    "cfg": 4,
    "detail": { "scale": 1.5, "denoise": 0.16 }
  }
}
```

Select `scene_detailed` as the illustration workflow after loading the recipe configuration. Scale is restricted to 1.5 or 2, denoise to 0.05–0.3, and the feature to illustrations. The base frame is saved at node 901; only final node 900 is published. Upscaling uses bicubic interpolation followed by img2img. Two-character scenes retain separate identity LoRA branches and feathered left/right masks; these are not segmentation masks and can include furniture. This can preserve existing defects and still alter details. It is disabled in built-in recipes by default and is not a visual quality gate. GPU/memory costs increase; use for selected illustrations, not every dialogue turn.
