# Narrative Engine for SillyTavern

Narrative Engine turns a SillyTavern role-play chat into a persistent world
simulation without forking SillyTavern. The normal SillyTavern connection remains
the RP writer. A separate Director model maintains continuity, state, knowledge,
relationships, plot pressure, long-term memory, audits, and exact sprite choices.

Tested against SillyTavern release 1.19.0 at commit
`06bde939fb1e9c4c8d8641d810f0a916b5bce127`. See `reports/` for the upstream
API preflight and architecture record.

## Install the UI extension

1. In SillyTavern, open **Extensions → Install extension**.
2. Enter `https://github.com/Gam1409/Narrative-Engine`.
3. Reload SillyTavern and open **Extensions → Narrative Engine**.
4. Select a Director provider, model, audit mode, and story systems.
5. Test the connection, then enable the engine.

Browser-only choices are an unauthenticated local OpenAI-compatible endpoint,
Ollama, or the current SillyTavern connection. Browser mode intentionally has no
API-key field: browser extension settings are plaintext. For a keyed endpoint,
use the server plugin.

## Install the optional server plugin

Copy `server-plugin` to `SillyTavern/plugins/narrative-engine`, run
`npm install --omit=dev` inside that directory, and set:

```yaml
enableServerPlugins: true
```

Configure the SillyTavern server environment, then restart it:

```text
NARRATIVE_ENGINE_DIRECTOR_URL=https://director.example/v1
NARRATIVE_ENGINE_DIRECTOR_MODEL=qwen3-coder-heretic
NARRATIVE_ENGINE_DIRECTOR_API_KEY=your-secret
```

Optional controls include `NARRATIVE_ENGINE_TIMEOUT_MS`,
`NARRATIVE_ENGINE_RETRIES`, `NARRATIVE_ENGINE_STORAGE_DIR`, body/rate limits,
and `NARRATIVE_ENGINE_DIRECTOR_ALLOW_HOSTS` for explicitly trusted private-network
hosts. Loopback endpoints work without an allowlist. The plugin stores SQLite
under SillyTavern's persistent `DATA_ROOT/_storage/narrative-engine` by default.

## Turn lifecycle

```text
user message → PRE Director → ephemeral Director packet → RP model
             → completed response → POST audit/delta → persistent state/sprites
```

PRE runs once per user turn. POST runs after the complete rendered response, not
per streamed token. Normal mode is therefore one Director PRE call, one regular
RP call, and one Director POST call. STRICT audit permits at most one targeted
rewrite followed by one re-audit.

Every async transaction carries chat, session, generation, and request identity.
Changing chat aborts pending work; late responses are rejected. If the Director
is offline, the RP request continues without a stale packet and the console shows
degraded/offline state.

## State and memory

The engine stores scene, characters, physical objects, locations, timeline,
relationships, knowledge boundaries, plot threads, NPC plans, and world events.
Deltas are immutable transactions with provenance. Checkpoints and per-message
deltas support rebuild after edits, deletes, and swipes.

Browser mode keeps large data in `localforage`; only a compact summary and
storage pointer are written to `chatMetadata`. Server mode uses SQLite. Memory is
layered: recent chat, scene state, episodic retrieval, and structured canon.
Only relevant Top-K episodes enter PRE; the old chat is never dumped wholesale.

World Info and Character Cards remain canon. A card may define:

```json
{
  "data": {
    "extensions": {
      "narrative_engine": {
        "spriteManifest": "https://example.test/kenzie-sprites.json",
        "stateDefaults": {},
        "directorHints": []
      }
    }
  }
}
```

## Sprites, groups, and VN mode

Sprite manifests can contain thousands of entries. Code filters by character,
costume, expression family, and pose before the Director sees at most 5-30
candidates. A decision must be an allowed exact filename or `KEEP`. Changes are
applied through SillyTavern's public `/expression-set` and `/costume` commands.
In groups, the actual message speaker is resolved by avatar/name; other members'
sprite state is not reset.

## Commands

`/narrative-engine on|off`, `/ne-state`, `/ne-threads`, `/ne-timeline`,
`/ne-memory`, `/ne-rebuild`, `/ne-audit`, `/ne-director`, `/ne-sprite`, and
`/ne-export`.

The settings console also provides state/timeline/thread/memory/packet viewers,
import/export, health checking, redacted diagnostics, rebuild, cache clearing,
and sprite reselection. Imported state must match the current chat fingerprint.

## Security

- Secrets never enter `extensionSettings`, chat metadata, diagnostics, or logs.
- The server accepts a fixed environment-configured provider, not a request URL.
- Provider DNS/IP validation blocks protected networks unless explicitly allowed,
  while supporting loopback for local models.
- Requests have JSON/body limits, rate limits, timeouts, retries, and response
  limits. SQL is parameterized. Generated text is never evaluated.
- Server plugins are not sandboxed; install only reviewed code.

## Development

```powershell
npm test
npm run test:server
npm run check
```

The server runtime additionally requires `better-sqlite3`; its tests use injected
fakes and do not require the native module. For live integration, install the UI
extension and server plugin into a current SillyTavern release instance, configure
a real Director, then exercise solo, group/VN, streaming, swipe/edit, offline,
large-sprite, and long-chat scenarios.

## Troubleshooting

- **Director offline:** verify endpoint/model, CORS in browser mode, or server
  environment variables and `/api/plugins/narrative-engine/health`.
- **Server route missing:** set `enableServerPlugins: true` and restart ST.
- **No sprite change:** enable Character Expressions, validate the manifest, and
  ensure the Director selected one of the shortlisted files.
- **State pending reconciliation:** restore the Director and run **Rebuild state**.
- **Old facts after an edit/swipe:** `/ne-rebuild` replays accepted message deltas.

License: MIT.
