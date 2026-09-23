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

Browser mode supports unauthenticated local endpoints, Ollama, or the current ST
connection. API keys are server-only. The server plugin uses a configured fixed
provider URL, DNS/IP SSRF checks, request size limits, rate limiting, timeouts,
schema validation, parameterized SQLite statements, and redacted logs. It never
accepts arbitrary filesystem paths or evaluates generated code.

## UI direction

The settings panel is a compact continuity console that inherits SillyTavern's
type and color variables. A single vertical "story spine" connects operational
sections; provider health and pending reconciliation are visible without a grid
of decorative cards. Motion is limited to user-triggered disclosure, keyboard
focus is explicit, and reduced-motion preferences are respected.
