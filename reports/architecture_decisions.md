# Architecture decisions

## Runtime split

Narrative Engine uses exactly two physical LLM roles: the normal SillyTavern RP
connection and one Director provider. Logical jobs (continuity, memory, world,
plot, audit, sprites) are prompt sections in PRE/POST calls, not separate model
processes.

## Turn transaction

1. The interceptor captures chat/session/generation request identity.
2. PRE retrieves a bounded memory set, asks the Director for strict JSON, and
   builds a token-budgeted packet.
3. The packet is appended only to the outgoing interceptor chat.
4. The normal SillyTavern model writes prose.
5. `CHARACTER_MESSAGE_RENDERED` starts one POST transaction.
6. Validated deltas are applied to a cloned state, checkpointed, stored, and
   attached to message metadata for replay.
7. Sprite decisions are filtered by code and executed with official commands.

All requests carry `chatFingerprint`, `sessionId`, `generationId`, and
`requestId`. Switching chat aborts active controllers and invalidates late
responses.

## Storage

- `extensionSettings`: small non-secret configuration only.
- `chatMetadata.narrative_engine`: compact state summary, schema version,
  dirty/pending flags, and storage pointers.
- Browser mode: `localforage` for full state, memories, checkpoints, manifests,
  and diagnostics. An in-memory adapter exists for tests/private-mode fallback.
- Server mode: SQLite under `DATA_ROOT/_storage/narrative-engine`, never inside
  the updateable plugin directory.

## Validation and recovery

Director output follows JSON schemas. The client extracts JSON, validates it,
performs one JSON-repair retry through the Director, then falls back without
committing prose. State updates are clone-then-validate transactions. Edit,
delete, swipe, and World Info changes mark state dirty and rebuild from the
nearest checkpoint plus per-message deltas.

## Security boundary

Browser mode supports unauthenticated local endpoints, Ollama, the current ST
connection, or a saved SillyTavern Connection Profile. Profile mode delegates
OpenRouter and other keyed endpoints to ST's `ConnectionManagerRequestService`,
so credentials remain inside SillyTavern. Direct API keys are server-only. The
server plugin uses a configured fixed provider URL, DNS/IP SSRF checks, request
size limits, rate limiting, timeouts,
schema validation, parameterized SQLite statements, and redacted logs. It never
accepts arbitrary filesystem paths or evaluates generated code.

## UI direction

The settings panel is a compact continuity console that inherits SillyTavern's
type and color variables. A single vertical "story spine" connects operational
sections; provider health and pending reconciliation are visible without a grid
of decorative cards. Motion is limited to user-triggered disclosure, keyboard
focus is explicit, and reduced-motion preferences are respected.

## Stage 3: SQLite search and international usage (2026-10-12)

Use the existing SQLite deployment with FTS5 and optional sqlite-vec 0.1.9. The official [Node integration](https://alexgarcia.xyz/sqlite-vec/js.html) supplies a better-sqlite3 load function; the Windows x64 package was installed and actually loaded here. A binary Float32 scan over 10,000 synthetic 384-dimensional vectors measured about 15 ms p50; the earlier JSON representation took about 2.3 seconds. Keep the simpler SQLite service until larger-scale measurements justify another database.

The embedding provider is configured separately on the server. Cache keys include user/chat scope, endpoint/model identity and text SHA-256. Only eligible candidate text enters the embedding call. Native extension absence permits portable cosine scoring; provider absence permits filtered lexical retrieval.

Lexical fallback is Unicode word/character overlap, with no Russian-only dictionary or assumed story language. Cross-language semantic retrieval depends on the configured multilingual embedding model. No real model-quality claim is made without live evidence.

Session transfer is an explicit snapshot before the first accepted turn. Knowledge filtering remains mandatory in off/soft/strict audit modes. Shared PRE uses the intersection of scene and actual recipient permissions. Raw historical text and unannotated private state are not reintroduced into that shared packet.

Public slash commands use full English action names, with no aliases. See [implementation and commands](stage3_implementation.md).


## Stage 4 - deterministic simulation inside accepted turns

Simulation uses an additive version-1 state field and the existing immutable turn journal, rather than an independent background worker. Every accepted turn saves its effective policy. Decay, due events and processing therefore roll back and replay with the branch; SQLite keeps the same transactional bundle contract. No wall-clock timers or extra model calls were added. Relationship evidence is consumed per directed dimension; per-turn change caps apply across dimensions for the pair.

The Director interprets events and personality; code validates cause references, visibility, thresholds, agency declarations, time bounds and processing obligations. Group private guidance fails closed when the generation recipient is ambiguous. For normal group generation, the pinned upstream source confirms public context.characterId identifies the member selected before Generate. That ID is membership-checked and rechecked after PRE; private imports are unnecessary. See the source links in the stage-4 report.

## Stage 5: visual work stays outside canonical history (2026-10-12)

Scene descriptors are derived from accepted state. Visual profiles and SQLite jobs are separate from world deltas; completion only adds presentation metadata. A content hash plus accepted origin reference makes branch changes invalidate a result. Server-owned fixed recipes constrain ComfyUI graphs and independently toggle optional stages. Persist before POST; never automatically repeat an ambiguously accepted submission. Only history reads retry. See [stage 5](stage5_implementation.md) for configuration, recovery and unverified live-quality boundaries.
