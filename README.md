# Narrative Engine for SillyTavern

**English** | [Русский](README_RU.md)

![Narrative Engine](assets/narrative-engine-hero.png)

Narrative Engine adds a separate Director model to SillyTavern. Your RP model writes the story; the Director tracks continuity, physical state, knowledge, relationships, world events and episodic memory. Optional sprite selection and ComfyUI jobs use accepted scene state.

**Version 1.1.0.** Current local validation: **295 client / 135 server tests**. Earlier upstream inspection used SillyTavern 1.19.0 (`06bde939fb1e9c4c8d8641d810f0a916b5bce127`). Standalone LLM and ComfyUI experiments do not establish complete live SillyTavern acceptance. See [known limits](#known-limits).

## How it works

1. PRE retrieves permitted memories and prepares a compact Director packet.
2. SillyTavern runs the normal RP generation.
3. POST extracts changes, audits the response and commits accepted deltas.
4. Strict mode permits one targeted rewrite and one re-audit. Unresolved changes stay proposed/pending.

Records are immutable; status decisions are appended separately. Edit, delete and swipe rebuild the active branch. Late completions are bound to their originating chat and generation. If Director is unavailable, text generation continues and missed work can be reconciled later.

## Features

- Typed entities, item owner/holder/container, spatial constraints and an extensible parameter registry.
- Checkpoints, migration backups, atomic state/memory commits and offline storage recovery.
- Session-only, campaign and selective continuity; visibility filters run before retrieval in every audit mode.
- Unicode lexical fallback and optional multilingual embeddings with SQLite FTS5/sqlite-vec caching.
- Causal emotions, directed relationships, hidden/expressed feelings, delayed processing and game-time decay.
- Time, weather, scheduled events and configurable NPC detail.
- Existing sprite selection, scene descriptors, visual profiles and asynchronous ComfyUI jobs.
- Diagnostics for latency, reported tokens, response validity, strict rewrites and current subsystem state.

## Install and update

1. Open **Extensions ? Install extension** in SillyTavern.
2. Enter `https://github.com/Gam1409/Narrative-Engine` and reload.
3. Open **Extensions ? Narrative Engine**, select the Director provider and model/profile, and test the connection.
4. Enable the extension and choose the desired story systems.

When updating to 1.1.0, update both the extension and any installed server plugin, then restart SillyTavern. Visual generation stays disabled until explicitly enabled and configured. Export world state before changing a long-running campaign. World export includes visual profiles; image jobs and ComfyUI image files remain external.

### Director providers

| Provider | Configuration |
| --- | --- |
| Server plugin | Recommended for secret-bearing remote APIs and SQLite storage; see below. |
| OpenAI-compatible | Browser-accessible endpoint without a secret; CORS must allow requests. |
| Ollama | Local HTTP endpoint. |
| SillyTavern connection profile | A separate saved profile for Director; the main RP connection stays selected. |
| Current SillyTavern connection | Uses the current ST generation configuration and its supported capabilities. |

For OpenRouter, select it under **API Connections ? Chat Completion**, save the key and model in ST, save a Connection Profile, then select that profile in Narrative Engine. The extension stores its ID, not the key. Other compatible Chat/Text Completion profiles use the same integration. A profile connection test checks local availability and compatibility without a paid generation; the first PRE call is the actual network test. Missing/deleted profiles produce an explicit error.

### Server plugin

Copy [server-plugin](server-plugin) to `SillyTavern/plugins/narrative-engine`, run `npm install --omit=dev` there, and set `enableServerPlugins: true` in ST configuration. Set environment variables before restarting the server:

```text
NARRATIVE_ENGINE_DIRECTOR_URL=https://director.example/v1
NARRATIVE_ENGINE_DIRECTOR_MODEL=your-model
NARRATIVE_ENGINE_DIRECTOR_API_KEY=your-secret
```

The plugin is optional for browser-based text providers, but required for this extension's ComfyUI queue and server embeddings.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `NARRATIVE_ENGINE_DIRECTOR_URL` | empty | Fixed OpenAI-compatible base URL. |
| `NARRATIVE_ENGINE_DIRECTOR_MODEL` | empty | Director model. |
| `NARRATIVE_ENGINE_DIRECTOR_API_KEY` | empty | Server-side key. |
| `NARRATIVE_ENGINE_EMBEDDING_URL` | empty | Base URL; server appends `/embeddings`. |
| `NARRATIVE_ENGINE_EMBEDDING_MODEL` | empty | Embedding model supporting your languages. |
| `NARRATIVE_ENGINE_EMBEDDING_API_KEY` | empty | Optional server-side embedding key. |
| `NARRATIVE_ENGINE_COMFY_URL` | empty | Fixed ComfyUI endpoint. |
| `NARRATIVE_ENGINE_COMFY_API_KEY` | empty | Optional server-side ComfyUI key. |
| `NARRATIVE_ENGINE_COMFY_WORKFLOWS` | empty | Path to administrator-owned JSON workflow recipes. |
| `NARRATIVE_ENGINE_VISUAL_JOB_TIMEOUT_MS` | 600000 | Overall job deadline; 10000-3600000 ms. |
| `NARRATIVE_ENGINE_STORAGE_DIR` | `DATA_ROOT/_storage/narrative-engine` | Persistent SQLite directory. |
| `NARRATIVE_ENGINE_TIMEOUT_MS` | 30000 | Server HTTP timeout; 1000-120000 ms. |
| `NARRATIVE_ENGINE_RETRIES` | 2 | Director retry limit; 0-5. Ambiguous visual POSTs are not retried. |
| `NARRATIVE_ENGINE_BODY_LIMIT_BYTES` | 524288 | JSON body limit; 16 KiB-2 MiB. |
| `NARRATIVE_ENGINE_RATE_LIMIT` | 60 | Requests per rate-limit window. |
| `NARRATIVE_ENGINE_RATE_WINDOW_MS` | 60000 | Window duration. |
| `NARRATIVE_ENGINE_DIRECTOR_ALLOW_HOSTS` | empty | Explicit private host allowlist, shared by Director, embeddings and ComfyUI. |

Loopback is allowed for local services. Private/protected destinations require explicit configuration. Browser requests cannot override server provider URLs. Server plugins run with ST's privileges, not in a sandbox.

## Settings and simulation

Balanced, Strict continuity, Living world and Character driven presets select the eight story systems' prompt levels. Custom allows per-system Light/Balanced/Strict settings. [Prompt fragments](prompts/states) are editable; reload or clear transient cache after editing. Disabled systems are excluded from the prompt and their deltas are not applied.

Audit modes: **off** does not gate acceptance on model audit, **soft** keeps invalid changes unapplied, and **strict** permits one rewrite. Code validation, knowledge filtering and agency protection remain mandatory.

Inner-life modes are **off / light / full**; world simulation levels are **minimal / standard / living**. Full mode can schedule reassessment for the next game morning after a significant event. A valid game date/time is required. Background NPCs use lighter detail. Relationship changes need causal evidence and confidence; default maximum directed-pair change per turn is 0.15. Plans do not automatically move physical entities.

Private guidance is sent only to a known current character recipient. Player impersonation or an ambiguous group recipient receives no private guidance. Private state is hidden in author inspection by default; enabling **Show private state in author inspection** reveals it. World export always includes the complete state.

Story rhythm defaults: memory Top-K 6 (1-20), plot interval 3 (1-50), memory consolidation 8 (2-100), checkpoints 10 (2-100), packet budget 1500 (500-2000), PRE timeout 45 s (1-120), POST timeout 60 s (1-180).

## State, memory and recovery

Browser storage uses localforage; chat metadata contains compact summaries and storage references. Server storage uses SQLite with separate journal, decision, memory and checkpoint rows. Recovery preserves offline copies and refuses conflicting remote writes.

Accepted player actions take precedence over stale state; a player's statement about an NPC's hidden feelings does not itself establish those feelings. Use explicit author edits to correct canon or the registry. [Parameter/operation guide](reports/stage2_implementation.md) and [inner-life guide](reports/stage4_implementation.md) describe the contracts.

Memory visibility, campaign/session scope, status and game time are filtered before ranking or sending text to an embedding service. Superseded facts are excluded; rollback restores compatible facts. Semantic search is optional and degrades to Unicode lexical retrieval. Lexical matching is not universal semantic understanding. The multilingual fixture benchmark does not establish real embedding-model quality. See [memory guide](reports/stage3_implementation.md).

For pending reconciliation, restore Director connectivity and run **Rebuild state**. To reconnect storage, use the dedicated command below. Clear transient cache clears prompts and diagnostics, not persistent world history.

## Sprites and ComfyUI

Enable ST Character Expressions and supply a sprite manifest for sprite selection. The manifest shortlist can be large; code filters it before Director selects an existing filename or `KEEP`. Group selection uses the actual response speaker. Visual profiles also constrain expressions and poses. In a character card, set `data.extensions.narrative_engine.spriteManifest` to an HTTP(S) manifest URL or an inline array:

```json
[{"file":"neutral.png","character":"Seraphina","expression":"neutral","pose":"standing","costume":"default"}]
```

Files must already exist in Character Expressions. `file` is a basename, not a path. Optional fields include intensity, gaze and framing. The extension uses ST's `/expression-set` and `/costume` commands.

ComfyUI generation is disabled by default. Copy the [example recipe](server-plugin/examples/comfy-workflows.example.json) to a server-owned configuration file, replace the checkpoint placeholder with an installed model and set the ComfyUI environment variables. Enable Visual director and select `scene_full`.

Manual illustrations do not change canon. Automatic generation skips unchanged scenes already requested. Jobs persist in SQLite; results carry a scene hash and originating message reference. Stale outputs remain inspectable but are excluded from the current gallery. A lost submission acknowledgement does not cause a blind duplicate POST; known prompt IDs can resume polling after restart.

The seed can be reused. ControlNet, IP-Adapter, masks, LoRA and reference-image integration require fixed bindings and compatible server-side nodes/models. Partial redraw requires a separate configured workflow; switches do not install assets or create masks. The example does not prove image quality or identity continuity. See the [complete workflow/profile guide](reports/stage5_implementation.md).

## Commands

All 18 commands use full English names with **no aliases**. Story language is unrestricted.

| Command | Purpose |
| --- | --- |
| `/narrative-engine on` or `/narrative-engine off` | Enable/disable the extension. |
| `/narrative-configure-session` | Inspect or configure session/campaign/selective scope. |
| `/narrative-edit-world` | Explicit author correction using `{reason,ops}` and optional simulation data. |
| `/narrative-show-registry` | Inspect entity types and parameters. |
| `/narrative-show-state` | Inspect current state, respecting the private-inspection setting. |
| `/narrative-show-threads` | Inspect plot threads. |
| `/narrative-show-timeline` | Inspect game time. |
| `/narrative-show-memory` | Inspect memories as the author. |
| `/narrative-rebuild-state` | Replay the active branch and reconcile pending turns. |
| `/narrative-reconnect-storage` | Recover storage while preserving conflicts. |
| `/narrative-show-audit` | Inspect the last audit. |
| `/narrative-show-director-context` | Inspect the last packet. |
| `/narrative-refresh-sprites` | Repeat sprite selection. |
| `/narrative-export-world` | Return full world JSON. |
| `/narrative-describe-scene` | Describe the accepted visual scene. |
| `/narrative-set-visual-profile` | Store a profile from JSON. |
| `/narrative-generate-illustration` | Queue an illustration. |
| `/narrative-show-visual-jobs` | Inspect job status and scene freshness. |

Author inspection is distinct from the filtered context delivered to characters. Retired shortened commands are not registered; update old macros/Quick Replies.

## Diagnostics and troubleshooting

Director trace reports provider, PRE/POST latency, state summaries, memory mode, audit, sprite selection, tokens and errors. Quality metrics count invalid extracted/schema-validated responses before repair. Strict rewrite rate uses strict POST processing attempts, including reconciliation retries. Counters cover the extension lifetime; missing measurements are null. Visual subsystem state is last-observed status, not a live health assertion. Diagnostic export includes the subsystem summary.

- **Director offline:** check provider URL/model, CORS for browser providers, server env and `/api/plugins/narrative-engine/health`.
- **Missing server routes:** check plugin location, dependencies, `enableServerPlugins`, then restart ST.
- **Connection profile error:** enable Connection Manager, recreate/select the profile and refresh its authorization in ST.
- **Unchanged sprites:** enable Character Expressions, check manifest files and remember `KEEP` can be intentional.
- **Stale state:** rebuild the active branch; resolve pending Director or storage errors first.
- **Visual failure:** inspect the job and verify the installed checkpoint, recipe bindings and optional nodes. Text play remains available.

## Development and local verification

Client development requires Node 20+. Server package supports Node 20, 22, 23 or 24; recorded verification used Windows Node 24.14.0. Server tests require better-sqlite3 and the platform sqlite-vec package.

```powershell
npm ci --prefix server-plugin
npm test
npm run test:server
npm run test:golden
npm run test:load
npm run check
npm pack --dry-run
```

The [golden catalog](tests/fixtures/golden-scenarios.json) links G1-G27 prompts and expected outcomes to executed scripted tests. It is not a set of imported ST chats or evidence of model quality. Importable manual chat fixtures are outside the agreed scope.

The same full replay benchmark with 3000 small deltas and 300 entities improved from **9.49 s to 4.27 s median (2.22x)**. Retrieval over 30000 memories took about 0.61 s; scene extraction covered six characters. Both before/after replay runs used CPU profiling. Three samples do not establish a cross-machine latency guarantee. Every replayed state remains validated.

[Verification summary](reports/stage6/checks.json), [stage 6 report](reports/stage6_implementation.md), [performance evidence](reports/stage6/rebuild-comparison.json), [acceptance matrix](reports/acceptance_matrix.md), [architecture decisions](reports/architecture_decisions.md).

## Known limits

- Complete live ST UI/group/VN and embedding acceptance remains pending. Standalone Director and ComfyUI experiments cover selected scenarios, not general quality or end-to-end game behavior.
- Legacy knowledge structures remain flexible. Low-confidence/disputed batches stay proposed/pending; there is no operation-level partial acceptance or separate ask-player policy UI.
- Event conditions and autonomous NPC movement are limited; psychological inference depends on the Director model.
- Context filtering covers Narrative Engine's additions, not history/cards independently included by ST.
- Arbitrary semantic contradictions are not resolved automatically; supersession needs explicit links or fact keys.
- Custom workflow import and prompt bindings are locally tested. Arbitrary node compatibility, image identity, geometry and partial-redraw quality still require live checks; there is no automatic vision quality gate.
- Old terminal workflow graphs are compacted automatically; job rows and images are retained, so database growth is not fully bounded. World export includes visual profiles, but not image jobs or files. Layer PNGs are stored locally in plugin SQLite; standalone illustrations still depend on ComfyUI files.

The [requirements review](reports/final_requirements_review.md) distinguishes local implementation, partial requirements and excluded live proof. LLM output is untrusted data; it is never executed as shell, JavaScript or SQL. Operation validation, server-side keys, fixed endpoints, request limits and user scoping protect the implemented boundaries without claiming universal prompt-injection resistance.

License: [MIT](LICENSE).
## Visual automation development

Visual automation includes card LoRA profiles, reusable layers, integrated recipes, optional LLM visual direction and imported workflow bindings. The sections below distinguish implemented behavior from experimental quality results.

In **Visual Director**, set the current ComfyUI address, the exact installed checkpoint filename and its prompt profile: **SDXL**, **Pony** or **Illustrious**. An empty address uses server configuration. Changing the address never redirects existing jobs or forwards the configured server API key to a different address. Private network hosts still use the server allowlist. **Check ComfyUI models and nodes** reads inventory without launching generation.

**Edit current character LoRA** saves appearance, exact LoRA filenames, weights, family and trigger words to `data.extensions.narrative_engine.visual` while preserving other card extension fields. Select the matching world character ID. Duplicate active card identities/entity bindings fail explicitly. Existing JSON profiles remain readable; card profiles take precedence. A copied card receives a fresh visual ID when saved through the editor.

The built-in `scene_full` template works without a recipe file for SDXL-family models; configured recipes retain precedence. Its LoRA slots are connected to both model and text conditioning. Unknown/mismatched LoRA families and unconfigured multi-character regional conditioning stop the job rather than silently dropping identity LoRAs. Custom recipes need `checkpointBinding`, `loraSlots` and bindings for `positive`/`negative` as applicable. **Anima** uses dedicated `scene_anima`, `background_anima` and `sprite_anima` recipes; the SDXL template rejects it.

Automatic requests have a configurable cooldown (15 seconds by default) and combine superseded queued automatic work. One job is submitted at a time by default. Stale/failed results cannot replace the last valid visual metadata. Clothing item condition is part of sprite identity, and incompatible wardrobe candidates are excluded before ranking. Visual profiles are now part of atomic world import/export.

Stage 2 adds reusable backgrounds and transparent sprite layers. Select **Background workflow** (built-in `background`) and a dedicated **Sprite workflow**, then use **Build current scene layers** / **Open visual novel scene**. Enable **Automatic visual novel layers** together with automatic generation to update layers after accepted turns. A blank sprite workflow generates only the background. See the [sprite recipe contract](server-plugin/examples/visual-layers.md).

Layer PNGs persist in chat-scoped SQLite and survive a dynamic ComfyUI URL change. Emotion/wardrobe changes reuse the room and update the affected sprite. PNG decoding verifies real transparency; stale costumes are hidden while a replacement is pending. Binary quotas default to 256 MiB per chat / 1024 MiB total (`NARRATIVE_ENGINE_VISUAL_ASSET_SCOPE_MB` / `NARRATIVE_ENGINE_VISUAL_ASSET_TOTAL_MB`); exceeding them preserves existing assets and rejects new ones. Reinstall server dependencies (`npm install`) for pngjs, then restart ST.

Earlier stage validation: **142 client / 64 server tests**, plus a synthetic browser/queue/SQLite scenario. This does **not** establish live ST/ComfyUI quality. The stage uses its own viewer, not Character Expressions. Remaining limits include general spatial placement, illustration conditioning from saved layers, model file hash verification and full history/image retention. Opt-in LLM visual direction and terminal graph compaction are described below. Model filenames and recipe version determine reuse; bump the version if replacing a model under the same name. The compiler uses accepted state, with optional bounded LLM visual direction.


### Visual pacing and integrated scenes

The experimental `scene_integrated` recipe generates a whole scene, with separate identity passes for up to two characters. `background_integrated` and `sprite_integrated` use the same selected art style; sprites require BiRefNet nodes/model. These recipes support Anima when the exact diffusion model, text encoder and VAE filenames are configured. SDXL-family models use a checkpoint. Geometry, clothing detail and action fidelity still require visual acceptance; an optional upscale/img2img detail pass is available in configured integrated illustration recipes; a vision quality gate is not implemented.

Automatic illustrations now default to significant changes: location/environment, cast, appearance, wardrobe or objects. Expression/pose/position-only changes do not request a full illustration. Choose **Every visual change** for the earlier behavior or **Manual only** for on-demand illustrations. In layer mode, ordinary turns update only changed resources; full illustrations remain manual. Manual requests bypass the significance filter. Failed automatic layers are reused as failures until inputs change or **Build current scene layers** explicitly retries them. There is no automatic visual repair loop.

Visual requests remain asynchronous relative to accepted story turns. Old wardrobe sprites are hidden rather than presented as current; an unchanged ready background remains available. Server job diagnostics expose queue/processing/total time, including polling and transfer overhead, not pure GPU time. The stage reports time until layer metadata is ready, excluding browser image decoding and the LLM turn. See live cycle results and limits. Latest local validation: **146 client / 82 server tests**.


For selected illustrations, an integrated recipe can enable `detail: {"scale": 1.5, "denoise": 0.16}`. This saves the base frame for comparison, enlarges it and runs low-denoise refinement with separate character LoRA branches. It is disabled by default, costs additional GPU time and does not guarantee unchanged clothing or corrected geometry. See the [recipe contract](server-plugin/examples/visual-layers.md) and detail-pass evaluation.


### Local sprite expressions

Enable **Preserve sprite clothing when changing expressions**, select `sprite_integrated`, and configure an installed face detector. The Director's accepted visible expression drives automatic local edits; compatible identity, costume/condition and pose select the base sprite. The first sprite is detected automatically; **Inspect / adjust sprite face anchors** is an optional correction tool. With no detector, manual anchor selection remains available. Outfit/pose changes require a new base. Exact original pixels outside the selected face rectangle and original transparency are preserved after generation.

Anime setup and model installation: [optional ComfyUI node](comfy-node/README.md). The tested settings use `lbpcascade_animeface.xml`; built-in MediaPipe is also supported when installed but did not detect this sample. Missing/ambiguous detection reports a warning and does not guess an anchor. Live measurements and acceptance boundaries: local expressions took 10.5–12.4 s; browser/LLM time is excluded. Pixel preservation is verified, general image quality and the full ST browser flow are not.

### Compact LLM visual direction

The opt-in **LLM visual direction** setting uses the configured Director provider to select bounded facial features and illustration framing. Canon supplies clothing, pose, light, objects, appearance and LoRA; manual framing wins. Facial changes do not invalidate the background. Automatic pose/light changes are not implemented.

An in-memory cache holds up to 32 scenes and coalesces concurrent requests. Scope, scene, profile and provider instance isolate decisions; current turn provenance and canon version are reapplied. Unknown fields/values are rejected; omitted camera preserves current framing. Invalid responses block visual submission and are not retried on every poll; recreating the extension instance allows a fresh attempt. The bounded vocabulary does not prove semantic grounding of every selected feature.

Validation: 152 client / 82 server tests. Direct Qwen smoke: 3/3 responses, 1.65–2.04 s without ComfyUI. The diagnostic disables reasoning via API overrides; production providers retain their own configuration, so latency may differ. Full SillyTavern browser acceptance with this setting remains pending. Report.

The visual contract is model-neutral: the shared prompt explains downstream image generation without `/no_think`; plain JSON and a whole Markdown JSON fence are accepted with strict field validation. Model/endpoint/provider-profile changes invalidate cached decisions. Exploratory Qwen A/B: purpose context produced 4/4 usable responses versus 1/4 without it, with mean latency increasing from 2.42 to 3.11 s. Small sample; other LLMs remain untested live. Client tests: 155. Comparison.

Standalone RP check: 3/4 turns accepted; the fourth remained pending due to invalid event evidence. Added one bounded extraction repair before commit and protection against an in-place context chatId change. Client tests: 159. This uses a simulated ST host, not full game acceptance. Russian report.

User-story understanding probe: 20/20 structurally valid responses, with semantic failures including recalled clothing applied to the present, invented poses and a cafe cup carried into a street description. Two concurrent requests: median 49.21 s, p95 56.42 s. This independent probe does not measure accumulated ST state. The real runtime retest accepted 3/4 turns; the final turn failed a memory-status enum. Added exact evidence references and POST guidance on narrative time and emotion appraisals. 164 client tests passed. Russian analysis.

Typed state-command experiment: 39/40 Qwen 27B responses matched the predefined final states; one malformed JSON response was rejected. Eight short RP passages had a median latency of 4.10 s. Synthetic, single-pass fixtures with fixed initial states; complex psychology and accumulated trajectory errors remain untested. The experimental contract is not enabled in the runtime. Method, results and limitations (Russian).

Long-session maintenance now compacts workflow graphs in up to 50 terminal jobs per minute, older than 24 hours, preserving the newest 100 terminal jobs per chat. Job identities, deduplication keys, prompts and images remain intact; active and ambiguous submissions are excluded. This does not bound total database size. Configure `NARRATIVE_ENGINE_VISUAL_GRAPH_COMPACTION=false`, `NARRATIVE_ENGINE_VISUAL_GRAPH_RETENTION_HOURS`, and `NARRATIVE_ENGINE_VISUAL_GRAPH_KEEP_RECENT`. All 85 server tests pass, including 3000 jobs without GPU requests. Details and limitations (Russian).

### Imported workflows and prompt routing

Visual Director settings now accept ComfyUI **API JSON** or a recipe with bindings. Choose separate workflows for illustrations, backgrounds and sprites. The optional graph viewer shows actual nodes/connections and lets you assign positive/negative text inputs. Four chips insert compiled scene positive, compiled scene negative, user positive and user negative text; literal text and token order are preserved. The Director supplies scene intent; deterministic bindings choose the destination, independently of the LLM provider.

Up to 8 recipes are stored in extension settings (128 KiB each, 384 KiB total). Ordinary ComfyUI editor JSON must first be exported in API format. The graph is read-only apart from prompt assignments; automatic semantic routing for individual characters/regions is not implemented. Server validation checks bindings and performs model/node preflight before submission. Importing uses no GPU.

Anima settings expose separate diffusion model, text encoder and VAE files, plus Base/Preview (30 steps, CFG 4), Aesthetic (30, 4), and Turbo (10, 1) presets for built-in recipes. Imported workflows retain their sampler settings. The explicit Anima workflow button changes the three selections without enabling automatic generation or downloading models.

Local validation: **168 client / 89 server tests** and browser checks of persistence, prompt assignment, graph inspection and narrow layout. No live SillyTavern or GPU acceptance is claimed. See UI verification report.

To configure a custom graph: **Visual Director → Workflows for each image type → Import workflow JSON → Edit inputs and chips → View graph and choose prompt inputs**. Import [the example recipe](server-plugin/examples/importable-illustration.json) to inspect the mapping; replace its example checkpoint with an installed model before generation. Connections are edited in ComfyUI. Source chips use `{{positive}}`, `{{negative}}`, `{{userPositive}}`, and `{{userNegative}}`. The scene chips refer to compiler output, not an unchecked raw LLM response.

The imported-workflow library also provides **Check selected workflow (no generation)**. This refreshes ComfyUI inventory and checks saved graph inputs, links, installed nodes/models and the selected checkpoint. It does not create a job or upload assets. It is not full ComfyUI execution validation: scene-dependent bindings and character LoRAs are checked at generation time. An offline server is reported as unverified.

Workflow-check UI regression coverage: nine browser scenarios use the real UI modules with controlled responses (success, validation failure, offline server, stale settings, overlapping selections, malformed response and disposal). Run the local preview with `node server-plugin/scripts/settings-preview.cjs`; the browser harness is [workflow-check.js](tests/browser/workflow-check.js). These checks do not contact ComfyUI.

### Stable backgrounds (local implementation)

**Background updates** defaults to `location`: reuse the room while movable objects, expressions, pose, clothing, weather or wording of lighting change. Location identity includes its public name/properties and explicitly marked fixtures. Store permanent furniture in the location description or declare an entity parameter `backgroundRole` with value `fixture`; movable objects remain in illustration prompts, not background prompts. Changes to fixture state or public location properties redraw the environment.

`location_atmosphere` additionally waits for stable day/weather buckets (2 distinct accepted turns by default, configurable 1–10). Game `timeline.time` takes precedence; fallback keywords support Russian/English. Default hour boundaries are 05/08/18/21 in `src/visual/background.js`. Lamp/candle lighting selects `indoor`. Unknown buckets preserve the current image and reset pending transitions. `any` reacts to raw lighting/weather changes, still excluding movable objects. **Regenerate background only** bypasses cooldown and changes its sampling seed without submitting sprite jobs.

Public background inputs are frozen together with their resource key in chat metadata. Returning to a cached room reuses the ready asset. Layer key version changes to 6 for backgrounds only, preserving sprite keys. Observation history retains 64 turn states per entry; the ledger retains up to 128 location/configuration entries and 64 variants per entry. Deep rollback outside that retained window reinitializes atmosphere observations.

Legacy migration is conservative: within the same chat, current settings must reproduce a saved old background graph and its location must match. A server alias preserves the verified asset without GPU work. It examines up to 1000 recent completed background jobs. Compacted/missing graphs cannot establish equivalence and may require a new background. Reused legacy images can contain old objects; manual regeneration replaces them with the new object-free policy. This is partial migration acceptance, not a guarantee of zero generation for every old chat.

Local tests cover 30 changes → one background job, A → B → A reuse, hysteresis, unknown values, rollback/reload, private-state exclusion, manual refresh and scoped migration. No live GPU or full SillyTavern acceptance was performed. Composition preview is implemented below; layer-guided illustrations are being added in separate stages.

### Composition preview (no GPU)

Open **Visual novel scene**, then choose **View → Composition preview (no GPU)**. Ready background and current sprite assets are drawn on a canvas at the background's native aspect ratio, retaining transparency. One character is centered; two use left/right slots in scene order. Preview framing offers full body, medium and wide views without changing generation settings or canon. Medium framing can crop the lower body; broad sprites are width-limited without stretching.

Missing/stale layers, changed canon or more than two characters block composite preview. The ordinary VN layer viewer remains available. This is a placement preview, not a generated illustration: lighting, perspective, foreground occlusion and anatomy are not repaired. The server layer-guided recipe uses the same versioned layout contract; browser/server parity is tested.


### Layer-guided illustration: server foundation

The built-in `scene_layered` API recipe now composes a saved background and up to two transparent sprites, saves the composite at node 901, then refines the complete frame at denoise 0.45 (allowed 0.35–0.55). Two-character identity passes use separate LoRA branches and each sprite's alpha mask placed on the canvas. Only node 900 is the final output. The detail/upscale pass cannot yet be combined with this recipe.

References are asset IDs plus expected resource keys from the same chat. The server resolves filenames and layout, preserves PNG bytes on upload to the selected ComfyUI endpoint and checks installed nodes/models before submitting a prompt. Missing/wrong references fail explicitly; there is no implicit fresh-image fallback. See the [API contract](server-plugin/examples/visual-layers.md#layer-guidance-server-api).

**Illustration continuity** now exposes three sources: fresh (default), current layers, or layers with an explicit fresh fallback. Layer mode uses the dedicated built-in recipe; the selected illustration/partial workflow and optional conditioning stages apply only to fresh generation. Choose a background workflow and a transparent sprite workflow before requesting character layers.

For strict layers, **Missing layers** either fails immediately or builds missing layers asynchronously (120 seconds by default, adjustable 10–600 seconds). Ready layers are reused. Changes to scene/canon, settings or planned layer identities cancel waiting. A reload cancels a waiting request; request it again explicitly. The VN viewer displays waiting/error status. Failed layers or timeout do not silently trigger a fresh image; only the explicitly selected fallback mode permits it, records the reason and shows it in job/gallery metadata.

Before submission and publication, the client checks current reference IDs/keys along with scene and settings. Changing a background manually, changing clothes or replacing a sprite prevents the old result from becoming current. Local tests cover these contracts; live quality, clothing preservation, lighting and occlusion still require GPU acceptance.


### Visual task diagnostics

**Visual task counters (no GPU)** reads SQLite for the current authenticated chat. Background, sprite, illustration and local-expression rows distinguish non-cache jobs, submission attempts, completions, final failures and cache hits. Ambiguous submissions count as attempts; these are not GPU seconds or money. Cache events are deduplicated by request key and counted from feature installation; historical cache hits cannot be reconstructed.

**Illustration from current layers** makes a strict manual layer request without changing the saved source mode. Readiness/wait rules still apply. Results expose `guided`, reference IDs and `reason` for fresh images (existing source/fallback fields remain compatible). Client generation keys include recipe and layout version 1.

Local acceptance includes a 30-turn client-to-SQLite run: one background submission, 29 cache hits and one significant illustration, with all GPU responses simulated. A typed core-node inventory accepts the complete guided graph; missing dependencies remain rejected. Actual ComfyUI rendering and SillyTavern acceptance are still pending.


### Settings window

Expand Narrative Engine in the extensions panel and click **Show settings**. A dialog uses 80% of the desktop viewport, with six tabs for general settings, memory and pacing, story records, characters/world, visuals and diagnostics. Small screens use nearly the full viewport. Tabs support arrow keys, Home and End; Escape closes the dialog. Switching tabs preserves the mounted controls. Settings retain the existing save-on-change behavior; there is no separate Save button.

Settings open in English by default. Use **Interface language → English / Русский** to switch fixed settings labels and tabs; the choice is saved. This does not translate RP prompts, user content, server responses or diagnostic payloads. A **generation preset** combines a ComfyUI workflow with its generation parameters and bindings.

### RP model autonomy (opt-in)

Enable **RP model autonomy** under **Memory & pacing**. It defaults to off to preserve existing chats. The RP model owns NPC choices and prose; Director supplies an optional closed-vocabulary scene observation. It does not prescribe plot beats. Canonical continuity comes from the visibility-filtered state, not Director-invented constraints. Private character context remains recipient-specific.

With autonomy enabled, even Strict audit cannot rewrite the displayed response through Director. Disputed extraction stays unconfirmed; diagnostics explain that manual SillyTavern regeneration may be needed. JSON repair remains available. No additional mandatory model call is introduced.

**Packet assembly** diagnostics show inclusion, compression and omission. HARD facts are compacted without truncation before lower-priority context. If mandatory facts still exceed the configured budget, no partial packet is injected and overflow is reported; RP can continue without the NE packet. Estimates use characters / 4, not the provider tokenizer. Director outage falls back to canonical context when the request is still current. Turning autonomy off restores legacy behavior.

This autonomy contract is complemented by the limited repetition and lore features below; full AntiSlop/lore/offscreen simulation requirements remain open. It has local automated coverage; live Solo/Group/streaming and artistic quality remain unverified. No automatic RP revision adapter is supplied.

### Repetition monitoring (local observation)

Under **Memory & pacing**, set **Repetition monitoring → Observe only**. Default is Off; **Quality window** is 4–12 accepted replies (default 6). Diagnostics show lexical overlap for the latest accepted reply: one matching earlier response is a candidate; two or more are a confirmed statistical signal, not a literary verdict. Comparisons use normalized Unicode 32-character shingles, ignore responses shorter than 80 normalized characters and inspect at most 12,000 normalized characters per response. The provisional overlap threshold is 0.45 and needs calibration on real RP.

Only the accepted prefix of the current branch is assessed. Signals are recomputed during reconciliation, expire when new responses no longer match, and clear on history/chat changes. Diagnostics contain evidence IDs and overlap scores, not copied prose. Observe does not change PRE/POST prompts, RP text or canon and makes no model/GPU calls. No semantic stagnation, gesture interpretation or automated rewrite is implemented. Optional soft feedback is described below.

### Soft feedback for repetition

Choose **Repetition monitoring → Soft feedback** and enable **RP model autonomy**. Otherwise Soft remains observation-only, with the reason shown in diagnostics. A confirmed local repetition signal can supply one fixed, optional style hint to the RP context; it never quotes the repeated text, dictates NPC actions, or writes canon. It is the lowest-priority packet block and is omitted when the budget is full. No extra LLM call is made.

The note lasts for at most two newly accepted replies; the next trigger is allowed after three. Improvement expires it early. Scene changes expire the old note and start a three-reply cooldown. Edit/swipe/delete, chat changes and quality-setting changes clear it. Notes are ephemeral: reload discards their lifetime/cooldown history and the next reconciliation can produce a new note from the current accepted branch. Repeated PRE attempts without an accepted reply do not advance its age. Diagnostics show eligibility/lifetime; Packet assembly shows whether it actually fitted in the packet. Live artistic benefit is not yet measured.

### World lore: first World Info import

The **Lore** tab imports SillyTavern World Info JSON (entries object/array, optional UTF-8 BOM). Update the server plugin as well as the extension. Choose a library ID, preview a file, explicitly check public entries, then save. Unchecked entries remain hidden. Re-import resets visibility to the reviewed selection, replaces matching IDs and marks missing entries deprecated. Libraries are stored as managed JSON files with separate original-source files, isolated by ST user and shared between that user's chats. Legacy SQLite libraries migrate on access. The active library ID is a setting; libraries are not included in world export. Saves use revision checks to prevent overwriting concurrent imports.

Enable **Lore retrieval** plus **RP model autonomy** to use it. Keyword matching searches the latest user message and canonical location; constant entries are capped at 25% of the lore budget. At most ten public active entries are selected, using up to roughly 30% of the packet budget. They reach Director as reference data and the RP packet below hard canon and memory. Lore does not create deltas or images. Server failure falls back to RP without lore (request timeout 5 seconds). Diagnostics list revision and IDs, never hidden bodies.

Initial limits: 500 KB input (also subject to server HTTP body limit), 500 imported entries, 20,000 characters per entry, 1,000 entries including deprecated history. Order 0 and numeric comments are supported. Selective activation supports primary keys plus any secondary key; unsupported selective logic disables the entry. Source entries explicitly marked secret/self/restricted in NE extensions cannot be made public by this importer.

This is a limited first implementation: only hidden/public visibility and keyword/tag selection; no private lore, advanced ST gating, semantic conflict detector, lore-derived visual appearance or DeepLore integration yet. Markdown and character-book adapters are described below. Explicit public selection is an author decision, not inferred from tags. Canon priority is stated to the model and protected in packet allocation; semantic obedience still requires live evaluation. Import text is treated as untrusted data, not a guarantee against all prompt injection. Browser import flow was exercised with the real SQLite service behind a test transport, not a deployed SillyTavern instance.

### Markdown and character-book lore imports

The Lore file picker also accepts `.md` and JSON character cards. JSON auto-detection accepts `data.character_book`, `character_book`, and a standalone book whose entries have `keys`. Only book entries are imported; card system prompts, creator notes and other character fields are excluded. The mapping follows the [Character Card V2 specification](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md): keys/secondary keys, enabled, constant, case sensitivity, priority and insertion order. PNG cards and automatic synchronization with the active character are not supported.

One Markdown file produces one entry; importing a different file into the same library replaces the library snapshot and deprecates missing entries. Use a separate library ID when needed. This is not a folder or multi-file importer. A stable explicit `id` is recommended; otherwise identity derives from the filename.

```markdown
---
id: kitchen
title: Kitchen
keys: [kitchen, room]
summary: A small stone kitchen
priority: 0
visibility: hidden
---
# Kitchen
Stone walls surround a wooden table. A door leads to [[Hall]].
```

Supported frontmatter: `id`, `title`, `keys`, `secondary_keys`, `summary`, `tags`, `type`, `priority`, `always`/`constant`, `status`, `visibility`. Supports scalar values, simple inline lists and block lists, not full YAML. Duplicate keys, tags/anchors and nested/block scalar syntax are rejected. Unknown metadata (including unsupported gating) disables the entry with a warning. `lorebook-guide` documents are skipped. Wiki links and summary are retained as metadata; recursive expansion and summary retrieval are not implemented. All formats remain hidden until the author explicitly selects public entries; secret/self/restricted markings remain locked.

### File-backed lore storage

Production lore lives under `<storageRoot>/lore/<hashed-user-scope>/`. Each library has a readable JSON file (`narrative-engine.lore-library.v1`) containing entries, visibility and revision. Imported Markdown is retained verbatim in a separate `.md`; imported JSON is retained as `.json`. Source sidecars have content-hashed filenames and are not overwritten. The JSON library is the active source of truth; changing an original sidecar does not update it. Download, edit and re-import a source through the preview to apply changes.

The Lore tab provides **Download library JSON** and **Download original source**. Native library JSON can be re-imported within the existing import size/count limits, with public entries reviewed again. Downloads may include hidden entries: these are deliberate author exports, not RP packets.

Saving writes the source first and atomically replaces the library JSON. SQLite is retained for legacy migration and serializing writes, not as the primary lore store. Old rows are not deleted. A migrated library has no original source download unless a source has subsequently been imported; its normalized JSON can always be downloaded. Corrupt JSON produces an error, not silent fallback to older SQLite data. Do not manually delete managed library files: legacy rows may be migrated again on access. When manually editing active JSON, preserve its schema and increment revision; re-import through preview is preferable. No file watcher or automatic source-sidecar cleanup is supplied. Back up the whole lore directory; filenames must not be treated as authorization boundaries outside ST.


### Custom JSON lore mapping and freeform tags

In **Lore → Custom JSON mapping**, enter a profile and select a JSON file. **Preview import** reruns preview after editing the profile; edits invalidate the previous approval. For example:

```json
{"profile":"world","format":"json","entriesPath":"$.world.items[*]","fields":{"id":"$.id","title":"$.name","body":"$.description","keys":"$.triggers","tags":"$.labels","priority":"$.weight"},"tagMap":{"place":{"type":"location"},"secret":{"visibility":"secret"},"known:*":{"visibility":"restricted","visibleTo":"$1"}},"defaults":{"visibility":"hidden","type":"other"}}
```

Paths support dot-separated properties and a terminal `[*]` for the entries array; no expressions or executable code. Map stable IDs for reliable re-import (otherwise array indices are used). The profile is included in the exported library JSON; the original source remains unchanged.

Arbitrary tags remain active search metadata, even without a `tagMap` rule. Preview reports these as search tags, not errors. Public entries can be retrieved by a keyword **or** a literal tag in the query; tags use word boundaries, NFKC normalization and the entry's case-sensitivity setting. Existing secondary-key gates, visibility, priority and token limits still apply. Tags do not infer permissions: all entries start hidden, public selection is explicit, and private mappings remain locked regardless of other tags. `visibleTo` is retained as metadata; actor-specific private retrieval is not implemented. This is lexical retrieval, not embedding search: synonyms, inflections and semantic ranking are not yet supported.


### Lore budget fallback

If the complete entry exceeds the remaining retrieval budget, the server tries its author-provided `summary`; if that also fails to fit, it omits the entry. No extra LLM call or change to the source library occurs. The aggregate 25% cap for always entries and the ten-entry limit still apply. `loreStatus.selection` in diagnostics records `full`, `summary` or `omitted`, with `budget`, `always_budget` or `entry_limit` for omissions. It contains IDs, not lore text, and does not expose filtered private entries. These are retrieval decisions; final packet allocation is reported separately. Token counts remain character-based estimates.


### Current relationships and personal causes

In RP autonomy mode, the public projection of current relationships is mandatory context. An unambiguous NPC recipient also receives their own visible relationships privately: current dimensions, the latest three changes per relationship and accessible causal events, including resolved events. This respects the relationships setting independently of characterState. Ambiguous recipients receive no private block; other characters' private relationships and inaccessible events are excluded.

Current private context is budgeted alongside HARD before lore and optional blocks. Overflow returns diagnostics and no partial packet, increasing the minimum required budget. Historical lore must not reset current feelings, motivations or relationships; appraisals remain subjective interpretations. Local tests verify packet composition and isolation, not live model compliance. Evidence-backed tendencies are described below; semantic conflict resolution remains unimplemented and baseline profile changes still require author correction.


### Data cleanup

**Data management** offers memory/RAG cleanup for the current session (chat) or all sessions, state/history resets including memory, deletion of all lore libraries, and a full reset of these categories. Each action requires typing `DELETE`; cancellation does nothing. SillyTavern messages, settings, original user files and generated images remain. Reprocessing old chat messages later may therefore create new events and memories.

Server memory, embedding caches and FTS live in SQLite; local memory lives in browser storage. Lore uses managed JSON/Markdown files on the server. Memory cleanup also strips journal, checkpoint and internal backup-field copies while preserving state, events and relationships. State reset removes those too. Server operations are account-scoped; local operations target browser storage. All-session server cleanup includes unopened chats. External exports and database backup files are not erased. Offline server cleanup is refused. Export before deletion; a failed multi-step full cleanup may be partial and is reported as such.

Local tests cover replay after erasure, account isolation, stale storage revision rejection and lore-file removal. Browser checks cover six actions, cancellation, typed confirmation and EN/RU with stub deletion handlers, not a deployed SillyTavern instance.


### Evidence-backed behavioral tendencies

POST may propose `simulation_delta.characters[].development` with a stable ID, unchanged description/context, eventId, supports/contradicts direction, interpretation and confidence. Code requires a known occurred event and a personal appraisal with confidence >= 0.7, and rejects reused events. Source-turn provenance comes from code; multiple events within one turn cannot accelerate promotion.

Evidence-coverage labels are hypothesis below three independent turns, forming at three, established at five; any counterevidence yields contested. These are conservative operational heuristics, not psychological measurements. Contested labels do not automatically clear. Limits are 12 tendencies and 40 evidence records each, with explicit rejection rather than silent truncation. Legacy events without source-turn provenance are ineligible.

Tendencies remain separate from the baseline profile. Active characters in light/full inner-life mode receive their own tendencies with the latest three supporting/counter evidence records in mandatory private context. They persist/replay/roll back with state; RAG cleanup preserves them and state reset removes them. Local tests verify contracts, not live LLM psychological accuracy. A dedicated tendency editor and semantic deduplication remain future work.


### Lore activation conditions

Markdown frontmatter supports `location` (one value or alternatives), `character_present` (all listed characters), and paired quoted `time_from`/`time_to` values in HH:MM format. Native JSON entries use `gating: {location, characters, timeFrom, timeTo}`; World Info/character_book use `extensions.narrative_engine.gating`. Custom JSON mapping does not yet map conditions.

Conditions combine with AND; location alternatives use OR. Identifiers match canonical scene location/present values exactly. Time ranges include the start and exclude the end, allowing midnight crossings such as 22:00–06:00. Missing scene facts fail the corresponding condition. Malformed JSON gates are rejected on import; unsupported frontmatter still disables entries. Chat mentions and PRE guesses cannot substitute for scene state. Always entries do not bypass gating or visibility. Advanced ST conditions, eras, scene types and entry dependencies remain unsupported.

### Reliability fixes after the full code review

Durable memory candidates are collected on every accepted NPC turn, including the opening greeting. The consolidation interval counts accepted NPC turns and only controls the compaction hint; intermediate episodes are not discarded. Shared retrieval and the current NPC's private recollections are separate. A correction unknown to that NPC leaves its previous knowledge available as `belief / last_known`, not as current world truth.

Typed entity parameters now have author-controlled `visibility`: `public` values reach RP continuity; `private` values do not. Existing definitions without this field stay private. To expose an existing physical parameter, explicitly update its definition, for example:

```text
/narrative-edit-world {"reason":"Expose observable clothing to RP","ops":[{"op":"update_parameter","key":"clothing","patch":{"visibility":"public"}}]}
```

This applies to the entire parameter value; do not mark a mixed public/private object as public. Director output cannot change parameter visibility.

The server database now uses schema version 3 (the world-state schema is separate). On opening a v1/v2 database, the plugin creates a `.pre-v3-*.bak` backup and migrates legacy memories and embeddings to chat-scoped keys. IDs and embeddings are preserved. Lore previews carry both revision and a persistent generation; after clearing lore, create a fresh preview before importing again. Update the browser extension and server plugin together.

Provider hostname resolution, interrupted responses, early cancellation, avatar matching, external settings changes, manual background updates, sprite anchor invalidation and LoRA routing to the selected image output have regression coverage. These local checks do not replace live SillyTavern/LLM/ComfyUI acceptance.

### Memory relevance and retrieval budget

Retrieval checks relevance separately from importance and recency. A textual cue, an explicit matching participant/location, or sufficient embedding similarity is required; empty queries and unmatched queries can return no memories. A location alone can recall an old conversation. Initial lexical/semantic thresholds are engineering heuristics (0.12/0.35), not calibrated probabilities; Unicode lexical fallback is not semantic understanding and common English/Russian function words are ignored as topical cues.

Top-K caps the final fitting selection. Oversized records are skipped without truncation and subsequent relevant candidates can fill the remaining budget. Equivalent entries are suppressed only in retrieval; source records remain intact. Different times, entities, belief types and contradictory texts are retained. This does not implement psychological salience, associative traversal or cross-episode consolidation.

### Consolidating accumulated episodes

At the consolidation interval, POST receives up to 16 accepted, unprocessed events from the current session. **Consolidation context budget (tokens)** in Memory accepts 256–16000 (default 3000). It estimates the source JSON at characters / 4; it is not a model tokenizer or the total POST/output limit. No additional LLM call is made. Oversized episodes remain pending.

Summaries retain validated `sourceMemoryIds`, preserve source visibility and never replace original events or mutate canon. Only accepted summaries acknowledge sources on the active branch; rollback restores pending work. The initial implementation groups events with identical visibility, accessible to the POST audience. The model may omit a summary for unrelated events. Semantic fidelity still requires live acceptance. Scene boundaries and initial personal ranking are described below.

### Memory: scene boundaries, provenance and personal retrieval

An accepted location/cast transition triggers consolidation on the next POST regardless of interval; no additional call is made. Without a next turn, processing waits. Weather and cast ordering do not count. Legacy records without a scene marker retain interval-based processing.

Optional personal assertion `provenance` records holder, acquisition kind (`observed`, `reported`, `inferred`), confidence and verified current-RP evidence. Reports and inferences remain beliefs. Personal assertions are private to their holder and cannot supersede objective facts. Legacy entries do not receive invented provenance. Code verifies the quote, not its semantic sufficiency. Summaries preserve source provenance in `sourceAssertions`.

Unambiguous recipient retrieval receives a bounded lexical ranking bonus from projected motivation, appraisals and causes of emotions/relationship changes. This is a heuristic, not a psychological model; eligibility and independent relevance remain mandatory. Already delivered shared memories are excluded; additional public episodes may enter the private block. Retrieval never changes confidence or canon.

Local verification: 250 client tests. Live consolidation, provenance interpretation and personal relevance quality remain unverified.

### Memory relationships and bounded chain retrieval

The Director may attach `caused_by`, `causes`, `supports` or `contradicts` links to a current episode. Targets must come from the supplied current-session history (up to 8 entries and 1000 estimated tokens, capped by the consolidation context setting). This POST context is separate from consolidation sources. Current-RP evidence is required; invalid links are dropped without losing the episode. A link is an extracted interpretation, not proof of causality, and never increases confidence or replaces facts.

A selected relevant memory may bring in up to two associated entries at depth at most two, including summary sources. `retrieval` metadata records edge type and traversal direction; reverse traversal does not reverse causality. All entries share the original top-K and token budget. Cycles cannot duplicate entries; oversized associates do not block remaining direct matches.

Visibility, session/campaign scope, status and game time are filtered before traversal. References and embedded source metadata pointing to excluded entries are removed from output. Rollback uses only active-branch records. Empty or irrelevant queries do not activate traversal. Private retrieval retains audience restrictions. No confidence reinforcement, recursive summary consolidation or unbounded graph traversal is implemented.

Local verification: 258 client tests. Live semantic accuracy of causal links remains unverified.

### Optional memory accessibility

Memory now offers **Use game-time memory accessibility** (off by default) and a decay half-life of 1–3650 game days (default 30). This is an engineering ranking heuristic, not a validated psychological model.

Accessibility decays toward a nonzero floor of 0.25–0.75 depending on importance. Source text is never shortened or deleted. Missing or invalid episode/current game dates disable decay; real application downtime is irrelevant. Text/semantic cues can restore accessibility fully; matching location restores it partially. Independent relevance remains mandatory.

Up to three eligible event records with `supports` links provide a bounded accessibility bonus. Multiple entries from one accepted turn count once; summaries, beliefs, disputed entries and hidden sources do not reinforce retrieval. Extracted links do not prove witness independence or factual truth. Repeated retrieval never writes state or increases confidence. Rollback or policy exclusion removes the respective bonus.

Local tests cover invalid/missing dates, game intervals, cues, privacy, repeated retrieval, setting bounds and disabled-mode compatibility. Live comparisons are still needed to calibrate parameters and establish RP quality.

### Lore versus current-state diagnostics

Authors may bind an initial lore value to an entity parameter. World Info / character_book use `extensions.narrative_engine.baselines`; native library entries use `baselines`:

```json
[{"entityId":"Anna","parameter":"temperament","value":"quiet"}]
```

If accepted `Anna.params.temperament` becomes `assertive`, the reference gains `stateOverrides` containing baseline/current values and `current_state_wins`. **Diagnostics → Lore retrieval → divergences** exposes `lore_state_divergence`. Comparison uses only audience-projected public state: the author must declare the parameter with `visibility: public`. Hidden or unknown fields are neither compared nor disclosed. Original lore is not edited and no state delta is created.

Up to 20 unique bindings per entry accept strings of at most 1000 characters, finite numbers and booleans, with strict type comparison. Unstructured prose is not automatically checked for semantic contradictions, psychological parameters are not inferred from adjectives, and reasons for change are not invented. Markdown/frontmatter and arbitrary-JSON mapping do not yet map bindings. Current-state precedence over reference lore applies even without bindings.

### Repeatable blinded two-story probe

The diagnostic probe selects six passages from `test_story.txt` and six from `tri_golosa_nad_propastiu.md`, with two requests per passage. The same historical text is compared as plain references versus explicitly scoped earlier reference material. This tests temporal story grounding, not the full runtime or all new memory features.

`node scripts/run-memory-study.mjs --source-dir PATH --output NEW_DIRECTORY` verifies source hashes and writes requests without network calls. Add `--run --endpoint URL --model MODEL` for an OpenAI-compatible base URL (e.g. ending in `/v1`); authentication optionally uses `NE_STUDY_API_KEY`. Defaults: 24 sequential calls, temperature 0.2, max_tokens 1800, 120-second timeout, no automatic retry. `--repeats 1..5` multiplies calls.

The runner supports `--evidence-refs` to use the production evidence catalog instead of copied quotes. Optional `--options FILE.json` accepts only `reasoning_effort` and `chat_template_kwargs` provider options (for example, disabling thinking when supported). It stops after two consecutive invalid responses. A valid reference proves only that a source fragment exists, not that the interpretation is true. This is a narrow paired semantic probe, not complete runtime acceptance.

The output directory must be new. Outputs are `requests.json`, `results.json` with timing/usage, separate arm `key.json`, and `review-ru.json` for blinded Russian-language human review. Do not show the reviewer requests or the arm key. Evaluation criteria and case IDs never enter model requests. Valid JSON and exact quotes do not establish emotional correctness. Original stories remain outside the repository; the manifest stores hashes and passage spans. Keep run artifacts under `reports/` and out of commits.

Experimental semantic decomposition: `scripts/run-event-memory-study.mjs --baseline PRIOR_REPORT_DIRECTORY --output NEW_DIRECTORY --endpoint BASE_URL` reuses twelve saved plain-reference requests, separates physical event extraction from psychology, and now enforces a shared 40-second deadline per case (target 30 seconds). `scripts/run-memory-claim-audit.mjs --input EVENT_REPORT_DIRECTORY --output NEW_DIRECTORY --endpoint BASE_URL` can replay a claim verifier when at least 12 seconds remain in that budget. This replay sums separately measured calls; it is not an end-to-end scheduler acceptance test. Neither experiment changes production canon; failed/late audit results are not accepted. An aborted HTTP request does not guarantee server-side generation cancellation.

Offline typed-event regressions reuse the existing state engine through an experimental adapter (`scripts/typed-story-events.mjs`). `node scripts/prepare-typed-story-study.mjs NEW_DIRECTORY` prepares twelve authored short cases without network calls or expected answers in model messages. These are development regressions, not an independent holdout, and do not establish accuracy on another RP writer such as Cydonia. The adapter is not wired into the production runtime; current/past and fact/claim classification remain unverified model responsibilities.
