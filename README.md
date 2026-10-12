# Narrative Engine for SillyTavern

**English** | [???????](README_RU.md)

![Narrative Engine](assets/narrative-engine-hero.png)

Narrative Engine adds a separate Director model to SillyTavern. Your RP model writes the story; the Director tracks continuity, physical state, knowledge, relationships, world events and episodic memory. Optional sprite selection and ComfyUI jobs use accepted scene state.

**Version 1.0.0.** Local validation: **126 client tests, 44 server tests and 27 golden scenario mappings passed**. Integration was inspected against SillyTavern 1.19.0 release commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. Live SillyTavern, model and ComfyUI checks were excluded by agreement. Version 1.0.0 does not imply full empirical acceptance of every specification requirement. See the [final requirements review](reports/final_requirements_review.md).

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

When updating to 1.0.0, update both the extension and any installed server plugin, then restart SillyTavern. Visual generation stays disabled until explicitly enabled and configured. Export world state before changing a long-running campaign. World export does not include visual profiles or image jobs.

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

- No live ST UI/group/VN, real Director, embedding or ComfyUI quality validation was performed.
- Legacy knowledge structures remain flexible. Low-confidence/disputed batches stay proposed/pending; there is no operation-level partial acceptance or separate ask-player policy UI.
- Event conditions and autonomous NPC movement are limited; psychological inference depends on the Director model.
- Context filtering covers Narrative Engine's additions, not history/cards independently included by ST.
- Arbitrary semantic contradictions are not resolved automatically; supersession needs explicit links or fact keys.
- Custom visual workflows, automatic mask generation, image identity and partial-redraw quality remain outside verified functionality.
- Visual jobs have no automatic retention cleanup. Visual profiles/jobs are not included in canonical world export; ComfyUI owns image files.

The [requirements review](reports/final_requirements_review.md) distinguishes local implementation, partial requirements and excluded live proof. LLM output is untrusted data; it is never executed as shell, JavaScript or SQL. Operation validation, server-side keys, fixed endpoints, request limits and user scoping protect the implemented boundaries without claiming universal prompt-injection resistance.

License: [MIT](LICENSE).
