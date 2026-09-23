# `sigmareaver/rooms` reference analysis

Reviewed commit `51718f8cbebd5df86d20f312309aaabb25ad42b3`.

## Patterns retained

- A manifest `generate_interceptor` mutates only the outgoing chat context.
- `GENERATION_STARTED` is suitable for fresh pre-generation bookkeeping.
- `MESSAGE_RECEIVED`, `USER_MESSAGE_RENDERED`, and
  `CHARACTER_MESSAGE_RENDERED` carry message indexes and can stamp/reconcile
  message metadata.
- Per-chat metadata is the correct home for compact location/presence pointers.
- Group speaker identity should be derived from the actual message name/avatar,
  not only the global character index.
- Provider selection belongs behind one call interface, and network errors need
  actionable messages.

## Patterns intentionally changed

- Rooms imports SillyTavern internals directly. Narrative Engine uses only
  `SillyTavern.getContext()` to reduce release breakage.
- Rooms stores an API key in `extensionSettings`. Narrative Engine never stores
  browser secrets; authenticated external calls go through the optional server
  plugin.
- Rooms is a single large file. Narrative Engine separates context, events,
  providers, director orchestration, state, memory, sprites, and UI.
- Rooms logs full prompts and raw model responses. Narrative Engine diagnostics
  contain timings, request ids, and redacted errors, not secrets or full private
  conversations.
- Rooms indexes characters by the mutable global array index in several places.
  Narrative Engine resolves a stable identity from avatar/name and records the
  actual speaker on each accepted message.

## Result

The reference validates the extension lifecycle and group-aware event strategy,
but it is an architectural reference only; no source was copied.
