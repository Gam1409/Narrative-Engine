# Acceptance matrix

## Automated evidence

| Scenario | Evidence |
| --- | --- |
| Solo continuity | Atomic physical/clothing/object delta, timeline advance, checkpoint replay test |
| Four-character group | Group membership and actual message-speaker resolution test |
| Director offline | Interceptor leaves RP chat untouched; server storage falls back locally |
| Chat switch during PRE | Request gate aborts and rejects stale result |
| Swipe/edit/delete | Event handlers mark dirty; checkpoint/delta rebuild test verifies deterministic replay |
| 2000+ sprites | 2000-entry manifest shortlist test; out-of-shortlist names rejected; `KEEP` preserved |
| 1000+ message memory | 1000-episode retrieval test returns the old violin episode in bounded Top-K |
| JSON recovery | Local extraction/repair and exactly one external retry test |
| Server routes/security | Route inventory, user scoping, SSRF, limits, provider retry, state/memory/sprite tests |
| SQLite runtime | Real `better-sqlite3` create/write/read/close smoke test on Node 24 |

Client suite: 29 tests. Server suite: 15 tests. All passed on 2026-09-23.
All JavaScript files passed `node --check`, the root entry module imported, all
project JSON parsed, `git diff --check` passed, and npm package dry-run completed.

## Environment-dependent acceptance

The repository contains complete integration code, but this workspace did not
have a running, configured SillyTavern browser session or a real Director model.
The following are therefore installation acceptance steps, not claims from the
automated suite:

1. Install the extension into SillyTavern 1.19.0 release.
2. Configure a real Director and run one PRE/RP/POST turn with streaming.
3. Exercise STRICT rewrite against an intentionally contradictory response.
4. Exercise a real four-character VN group with Character Expressions assets.
5. Restart SillyTavern and confirm SQLite/browser persistence across sessions.

These checks require user-specific models, chats, cards, World Info, and sprite
assets and cannot be truthfully simulated as a live production proof in this
repository alone.
