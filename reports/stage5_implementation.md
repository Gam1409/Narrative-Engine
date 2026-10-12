# Stage 5: visual director and asynchronous ComfyUI jobs

Version: 0.8.0. Local implementation and scripted verification only. No live SillyTavern, ComfyUI, model, GPU, image-quality or visual UI verification was performed.

## Behavior

The descriptor reads accepted canonical state: location, lighting, weather, characters, clothes, pose, observable expression, position, held/worn entities and objects in the location. Hidden feelings do not automatically become facial expressions. A stable content hash identifies the visual scene; an accepted message reference identifies its branch. Descriptor creation, submission and completion never write world deltas.

Visual profiles are stored separately per chat and bound to an existing entity/participant. Fields: appearance, references, LoRA weights, outfit descriptions, emotion/pose sets, generation parameters and compatible workflows. Profiles constrain sprite candidates as well as feeding workflow bindings. References name preinstalled ComfyUI input assets; they do not trigger downloads or uploads. Visual profiles and jobs are not included in the canonical world export.

Generation is disabled by default. Manual illustration is independent of sprite selection. Automatic generation runs after accepted turns and skips unchanged scenes already requested, including failed jobs; retry those manually. Completed images appear in the visual jobs gallery when their descriptor and originating branch still match. Old jobs remain inspectable with a stale marker. Results are stored in chat metadata and the separate queue, not inserted into chat message media.

## Setup

Install/update the server plugin even when the text Director uses another provider. Copy [the example recipe](../server-plugin/examples/comfy-workflows.example.json) to an administrator-controlled file outside the extension checkout. Replace the placeholder checkpoint with an installed checkpoint. Set these environment variables before starting SillyTavern:

```powershell
$env:NARRATIVE_ENGINE_COMFY_URL = 'http://127.0.0.1:8188'
$env:NARRATIVE_ENGINE_COMFY_WORKFLOWS = 'C:\SillyTavern\config\narrative-comfy-workflows.json'
# Optional when the deployment requires authorization:
# $env:NARRATIVE_ENGINE_COMFY_API_KEY = '<server-side key>'
# Optional overall job deadline, default 600000 milliseconds:
# $env:NARRATIVE_ENGINE_VISUAL_JOB_TIMEOUT_MS = '600000'
```

The shared `NARRATIVE_ENGINE_DIRECTOR_ALLOW_HOSTS` setting also controls non-loopback private ComfyUI hosts. Requests use the fixed configured endpoint and pinned DNS addresses. The client cannot supply a ComfyUI URL or arbitrary graph. Keys remain on the server.

In Visual director settings, enable generation and select `scene_full`. Keep automatic generation and optional stages off for initial setup. The bundled basic checkpoint workflow is a structural example, not a tested model preset.

New commands, without aliases:

```text
/narrative-describe-scene
/narrative-set-visual-profile {"entityId":"Anna","appearance":"dark hair","outfits":{"casual":"blue jacket"},"compatibleWorkflows":["scene_full"]}
/narrative-generate-illustration
/narrative-show-visual-jobs
```

Use the actual existing entity ID or participant name instead of Anna. The command returns job data; use the settings panel's visual jobs viewer to see the image gallery.

## Workflow contract

The recipe file maps workflow IDs to `{workflow, bindings, stages}`. `workflow` is a ComfyUI API graph. Each binding supplies a fixed node/input from a dotted source path in `{scene, seed, previous, stages, positive}`, with an optional default and stage guard. `positive` contains observable scene details and profile appearance. For example, bind `scene.characters.0.profile.references.0` to an installed reference loader, or bind a LoRA name/weight to the corresponding fixed node inputs. The basic example only binds text, seed and steps; other profile fields require explicit bindings.

ControlNet, IP-Adapter and mask stages each have independently selected `on`/`off` lists of fixed `{node,input,value}` patches. An enabled stage missing from the selected recipe fails visibly. Stage disabling must rewire/bypass the relevant nodes in the administrator's graph. The example has no such nodes; the switches do not install models or extensions.

Seed continuity reuses the latest completed job at the same location. Optional partial redraw selects a separate configured workflow and passes the previous output descriptor plus `changesSincePrevious` and `preserve`. Configure image loading/masking explicitly: ComfyUI output files are not automatically copied to its input directory. Partial redraw quality, character identity preservation and the best ControlNet/IP-Adapter settings remain unmeasured and require actual workflows/models. No automatic mask generation is implemented.

## Persistence and failure behavior

Jobs live in a separate SQLite table, scoped by authenticated user and chat. The lifecycle records requested, queued, running and done, or failed / failed_final. Running means submission or remote execution/polling, not verified GPU start. Up to ten active jobs per scope are accepted; the API lists the latest thirty. Job retention currently has no automatic cleanup.

The queue persists before submission. A lost POST acknowledgement or a restart without a known remote prompt ID ends as failed_final; it never blindly resubmits paid/GPU work. A known prompt ID resumes history polling after SQLite reopen. Failed history GETs retry three times with bounded backoff. The default deadline is ten minutes. Image reads are restricted to the owning job, limited to 16 MiB and served as PNG/JPEG/WebP after signature checks.

A chat switch stops client polling and prevents late attachment to another chat. Reload resumes inspection of the latest job. Browser polling is bounded to about twenty minutes; longer server deadlines can require reopening the viewer. Stale remote jobs are not cancelled automatically. ComfyUI failure does not fail text generation. Server-plugin unavailability reports a visual service error; it cannot create a server job while that server is unavailable.

## Verification

See [checks](stage5/checks.json), [client log](stage5/client-tests.txt), [server log](stage5/server-tests.txt) and [package dry run](stage5/package-check.json). Tests cover pure scene extraction, hidden-feeling exclusion, G16 illustration without world mutation, G17 service failure, stale branch results, deduplication, profile validation, fixed graph stage bindings, per-user job/image isolation, uncertain submission, bounded read retry and real SQLite close/reopen without duplicate submission. Existing stage 1-4 suites also pass.

Contracts were checked against the official [ComfyUI route documentation](https://docs.comfy.org/development/comfyui-server/comms_routes) and [API example](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/script_examples/websockets_api_example.py). Local mocks validate integration logic, not live compatibility or image quality.
