# SillyTavern upstream preflight

Checked on 2026-09-23 against SillyTavern `release` commit
`06bde939fb1e9c4c8d8641d810f0a916b5bce127` (package version 1.19.0) and
SillyTavern-Docs commit `70e5e4d3c239253fca4692fe82e3936cb9c4b1b1`.

## Confirmed public integration surface

- Third-party UI extensions are loaded as modules from
  `scripts/extensions/third-party`; relative ES module imports are supported.
- `SillyTavern.getContext()` exposes the current `chat`, `characters`, `groups`,
  `groupId`, `chatId`, `chatMetadata`, `saveMetadata`, `extensionSettings`,
  `saveSettingsDebounced`, event emitter/types, `generateRaw`, token counters,
  slash-command classes/parser, template rendering, debug registration, and
  command execution.
- A `generate_interceptor` manifest entry names a global async function with
  signature `(chat, contextSize, abort, type)`. Interceptors execute in ascending
  `loading_order`; exceptions are isolated by core. The supplied `chat` is the
  outgoing mutable context, so adding a marked system message there is an
  ephemeral injection and does not write to accepted chat history.
- `chatMetadata` references change on chat switch. The extension must call
  `SillyTavern.getContext()` each time and persist through `saveMetadata()`.
- `renderExtensionTemplateAsync()` is current; the synchronous template method
  is deprecated.
- Server plugins export `init(router)`, optional `exit()`, and `info`. Their
  routes are mounted at `/api/plugins/{info.id}`. Plugins are disabled by
  default and are not sandboxed.

## Event payloads used

| Event | Release payload |
| --- | --- |
| `MESSAGE_SENT`, `USER_MESSAGE_RENDERED` | message index |
| `MESSAGE_RECEIVED`, `CHARACTER_MESSAGE_RENDERED` | message index, generation type |
| `MESSAGE_EDITED`, `MESSAGE_UPDATED`, `MESSAGE_SWIPED` | message index |
| `MESSAGE_DELETED` | new chat length |
| `GENERATION_STARTED`, `GENERATION_AFTER_COMMANDS` | type, generation params, dry-run flag |
| `GENERATION_STOPPED` | no stable payload required |
| `GENERATION_ENDED` | chat length |
| `CHAT_CHANGED` | current chat id |
| `CONNECTION_PROFILE_LOADED` | profile name or sentinel |
| `WORLDINFO_UPDATED` | world name, world data |
| `WORLDINFO_SETTINGS_UPDATED` | no stable payload required |

`CHARACTER_MESSAGE_RENDERED` is the POST trigger because it fires after a full
streamed response; POST is deduplicated by message identity.

## Character Expressions

The release exports `sendExpressionCall` internally, but does not expose it from
`SillyTavern.getContext()`. The supported slash commands are
`/expression-set` (aliases `/sprite`, `/emote`) and
`/expression-folder-override` (alias `/costume`). Narrative Engine therefore
uses `executeSlashCommandsWithOptions()` instead of importing private modules.
Exact sprite targeting is applied to the current/last speaking character; other
group members keep their existing state.

## Vectors

The built-in vectors extension uses internal `/api/vector/*` routes and does not
publish a retrieval API through `getContext()`. Narrative Engine does not import
its private functions. Browser mode uses deterministic keyword/Fuse-style
retrieval; server-assisted mode owns its memory index and may use a configured
embedding endpoint. This keeps Function Calling optional.

## Compatibility decisions

- `minimum_client_version` is `1.19.0`.
- Both `eventTypes` and legacy `event_types` are accepted by the adapter.
- No Extras API dependency.
- No direct import from `script.js` or built-in extension internals.
- World Info remains canon; Narrative Engine reacts to its update events and
  rebuilds dynamic state rather than duplicating the World Info database.
