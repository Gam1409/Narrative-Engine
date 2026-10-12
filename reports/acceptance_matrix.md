# Acceptance matrix

Current local acceptance: [stage 6, version 1.0.0](stage6_implementation.md). The [G1-G27 catalog](../tests/fixtures/golden-scenarios.json) links exact scripted evidence; the [runner result](stage6/golden-results.json) reports execution rather than inferred coverage. Live quality remains unverified. Earlier counts below are historical.

Stage 4: [0.7.0 local implementation and boundaries](stage4_implementation.md). Causal emotion/relationship rules, deferred processing, world time and SQLite restart/replay are covered. Private group guidance uses the verified public current-recipient ID and is omitted when unknown or impersonating the player. Live model quality remains unmeasured.

Stage 3: [0.6.0 implementation and local verification](stage3_implementation.md). **91 client / 35 server tests pass**. G3/G18/G20, Unicode retrieval, real sqlite-vec/FTS5, cache isolation and English commands without aliases are covered. Real multilingual model quality remains unmeasured.

Stage 2: [0.5.0 local verification](stage2_implementation.md), **71 client / 31 server tests**. G1/G2 typed ownership and movement, G13 migration backup, parameter registry and author branch replay pass. SQLite tests use the real driver; no live ST/model claim.

Stage 1 implementation: [0.4.0 local verification](stage1_implementation.md), 65 client and 21 server tests. Synthetic runtime regressions and real SQLite migration checks pass; no live ST claim.

Current audit: [Stage 0, 2026-10-12](stage0_audit.md). The historical evidence below does not establish complete edit/swipe/delete, memory, or fallback correctness. The new audit reproduces defects despite all 57 existing tests passing. Live checks are excluded from the current scope by the user.

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
| Connection Profiles | OpenRouter-style profile delegation, safe metadata projection, missing/unavailable profile errors, and UI label tests |

Client suite: 39 tests. Server suite: 18 tests. All passed on 2026-09-23.
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

## Stage 5 local evidence (0.8.0)

G16 illustration without canonical changes and G17 unavailable/uncertain ComfyUI are covered by scripted client/server tests. Queue recovery also closes and reopens an actual SQLite file. Descriptors, profiles, stage toggles, job scoping and stale branch results are locally verified. Live generation, optional-node workflows, partial-redraw quality and SillyTavern gallery rendering remain unverified by agreement. See [implementation](stage5_implementation.md) and [checks](stage5/checks.json).
