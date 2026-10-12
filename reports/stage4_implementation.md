# Stage 4 - emotions, relationships and world time

Version 0.7.0. Local implementation and scripted verification, 2026-10-12.
No live SillyTavern or model calls. This report distinguishes deterministic behavior from model interpretation and integration checks against pinned upstream source.

## Implemented

- A versioned `state.simulation` extension stores character profiles, mood, motivation, appraisal, concurrent emotions, bodily state, expectations, expressed/felt separation and pendingProcessing. Existing world schema 2 and journal version 2 remain readable; this optional additive field requires no destructive migration. Invalid imported simulation state is rejected before commit.
- Every emotion references an occurred event known to that character, has intensity 0..1 and an explicit decay law: exponential half-life in game minutes, half per location/scene transition, or none. Mood decays toward neutral more slowly (24 game hours). Replay uses saved policy and game time, never real time or current settings.
- Relationships are directed pairs with independent dimensions, causal history, interpretation, confidence and source. A change requires a significant event or a configurable number of distinct same-kind interactions involving the target. The absolute sum per directed pair per turn is capped. Reusing consumed evidence for the same dimension is rejected. An emotion alone never changes trust.
- In full mode, a significant appraisal schedules emotional aftermath for 08:00 the next game day. When due, an active character must receive a renewed appraisal and processing interpretation in POST. Missing processing makes the whole extraction a proposal rather than silently confirming an unexplained time jump. Background characters retain due items until they are active in full mode again. Reconciliation retries use the ordinary history mechanism.
- Events support an absolute game-time trigger, next_morning, a prerequisite occurred-event ID, or both. Scheduled effects may change weather and lighting. Events fire once per active branch and revert with it. Daily schedules select the latest activity/location plan in living mode; a plan does not teleport the physical entity.
- minimal: game time only for world simulation; standard: lighting, weather and delayed events; living: also recurring NPC activity plans. Weather is explicit or scheduled, not a random generator. Ordinary time changes cannot run backwards and obey configurable min/max per turn. Direct date patches update elapsedMinutes consistently.
- The client validates causal evidence and agency before accepting POST, including audit off. New extractions cannot bypass the causal contract through legacy relationship, world-event or character-inner-state maps. Old saved deltas retain their original replay behavior.
- Profile edits are explicit author corrections with the existing backup and immutable journal. New command names remain English without aliases; no command was added or renamed in this stage.

## Settings and defaults

| Setting | Default | Meaning |
| --- | --- | --- |
| Inner life | light | off: simple emotions; light: mood, appraisal, expectations; full: body, masking, delayed processing |
| World simulation | standard | minimal / standard / living |
| Significant event threshold | 0.7 | Significant causal event and automatic full-mode aftermath |
| Relationship confidence | 0.7 | Minimum confidence for durable relationship changes |
| Maximum relationship change per turn | 0.15 | Absolute total for each directed pair |
| Repeated events required | 3 | Same-kind interactions involving the target |
| Minimum / maximum minutes per turn | 0 / 1440 | Increase maximum explicitly for longer skips |
| Show private state in author inspection | off | Reveal internal state in state/packet viewers; exports always retain it |

Appraisal confidence uses the existing Minimum confidence setting (default 0.5). Profile prompt strength (light/balanced/strict) remains separate from the new inner-life detail level. No additional LLM call was introduced.

## Author setup and POST contract

Configure traits and formative experience with the existing author command. For a current participant named Anna (or replace with its registered stable ID):

```text
/narrative-edit-world {"reason":"Initial personality","ops":[],"simulation":{"characters":[{"characterId":"Anna","profile":{"age":22,"traits":{"temperament":"reserved","values":["honesty","safety"],"defenses":["humor"],"attachment":"cautious"},"formativeExperiences":[{"id":"bio-1","summary":"A promise was broken before","salience":0.7}],"behaviorTendencies":{"likelyTo":["ask for time"],"unlikelyTo":["trust instantly"]}}}]}}
```

Use an existing registered character for off-scene profiles. The author may supply simulation.policy overrides with an explicit correction; ordinary POST cannot. Existing legacy card fields remain readable, but new structured profiles are configured through this author operation rather than silently rewriting earlier canon.

The [simulation contract](../schemas/simulation.schema.json) defines the optional POST simulation_delta arrays: events, characters, relationships, schedules and resolveEvents. The same structure is accepted as simulation in an author correction. Runtime adds a trusted policy to the immutable delta. Events extracted by POST must quote current RP text or a player action; event categorization and psychological interpretation still depend on the model.

POST prompts now request appraisal even when the narrative never names the feeling. They require profile-consistency reasoning, player-agency checks and renewed interpretation for due aftermath. Contradictory profile assessments or player_assertion reactions remain proposals. Code can validate explicit evidence, IDs, bounds and declared audit results; it cannot prove that a model understood natural-language psychology correctly. Sensitive scenes require documented adult age in the prompt; this is not claimed as an independent semantic age/content classifier.

## Privacy and context budget

Shared state remains filtered as in stage 3. Private guidance is added only when one generation recipient is unambiguous. Another recipient gets observable expression only if present when it was expressed and still in the same location. PRE receives a compact own-character summary, not a complete autobiography. Background POST records omit detailed appraisal/profile content and keep at most two emotions. Private viewer output is opt-in; raw exports intentionally contain the full simulation.

The packet builder skips an oversized section and continues with other useful sections while staying within the existing character-count token estimate. This remains an approximate tokenizer budget.

Group recipient resolution uses public context.characterId, checks membership, and rechecks identity after PRE. Impersonation and unknown recipients get no private guidance. This was verified against the pinned SillyTavern 1.19.0 source, not a live server: [group member selection](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js#L969) and [public context](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/st-context.js#L121). Tests cover switching recipients and rejecting a stale PRE completion.

Other limits: lighting assumes simple game-clock bands, per_scene decay currently means a location transition, and living mode selects daily plans without autonomously executing movement. Complex condition expressions, recurrence for arbitrary events, and automatic long-term personality rewriting are not implemented. Conditional events currently use one prerequisite event ID.

## Local evidence

All **115 client and 36 server tests pass**. Syntax checks cover 89 JavaScript files; all 10 JSON schemas parse. Package versions agree and package dry-run and whitespace checks pass.

- [Client tests](stage4/client-tests.txt), including G4/G5/G14/G21-G27, runtime PRE/POST, all audit modes, inspection privacy, import rejection and replay.
- [Server tests](stage4/server-tests.txt), including a real file-backed SQLite close/reopen, pending aftermath and schedule persistence, morning processing, rollback and branch reactivation.
- [Verification summary](stage4/checks.json).

G24 checks separate per-character appraisal/emotion storage with scripted Director outputs; it does not measure a real model's ability to derive distinct reactions from traits. G23 proves filtering and packet boundaries, not that a real RP model never verbalizes a private hint. Live quality remains outside the user-authorized testing scope.
