# Final requirements review: local version 1.0.0

Scope: the three user-supplied complementary specifications, reviewed against implementation, stage reports and recorded local tests on 2026-10-12. [Source names, SHA-256 and section inventory](stage6/spec-sources.json) identify the exact documents without redistributing them. This is an area-level acceptance matrix, not an assertion that every normative sentence is fully implemented.

Numbering below: v1 = Narrative_Engine_TZ.md; v2 = Narrative_Engine_TZ_v2.md; v2.1 = Narrative_Engine_TZ_v2-1.md. v2.1 expands inner life and G21-G27. The user requires English commands without aliases, international usage and no live ST/model/ComfyUI acceptance. Importable reference chats were explicitly removed from the current plan. Local scripted scenarios remain required.

Status: **Local** = implemented with local evidence; **Partial** = bounded implementation or remaining contract gap; **Unverified** = requires excluded live evaluation; **Decision** = deliberate architecture/scope choice.

| Requirement area | Spec sections | Status and evidence |
| --- | --- | --- |
| Two-model separation, extension/server boundary | v1 1-3; v2/v2.1 1-4 | Local: RP remains ST-owned, PRE/POST Director and server proxy; [architecture](architecture_decisions.md). |
| Baseline and upstream compatibility | v2/v2.1 2, 15, 19 stage 0 | Local source audit at pinned ST commit; runtime compatibility unverified. [preflight](st_upstream_preflight.md), [baseline](stage0_audit.md). |
| Typed entities, ownership and physical exclusivity | v1 4; v2/v2.1 5 | Local: owner/holder/container, atomic moves, references and cycles; G1/G2. [stage 2](stage2_implementation.md). |
| Extensible types and parameters | v1 4.4; v2/v2.1 5.4 | Local: author-only registry, rename/migration, archive/delete and typed values. Parameter setup is JSON/commands, not a graphical editor. |
| Truth hierarchy and player authority | v1 1, 7; v2/v2.1 1.2, 8-10 | Local structural author override and agency checks; semantic truth/extraction still depends on the model. G9/G25. |
| Emotion vs directed relationship | v1 5.1-5.3; v2/v2.1 6.1-6.3 | Local: causes, confidence, repetition, bounded changes and decay; G4/G5/G26. [stage 4](stage4_implementation.md). |
| Knowledge and false beliefs | v1 5.4; v2/v2.1 6.4 | Partial: visibility filtering and separate belief memory type exist. Legacy knowledge payloads remain flexible; a complete strictly typed epistemic model is not established. G3/G23 verify filtering, not model reasoning. |
| Hidden inner life | v2.1 6.5 | Local state/contracts: appraisal, expressed/felt, pending processing, mode/detail selection; G21-G27. Actual inferred psychological consistency is unverified. |
| Time, weather, plans and events | v1 6; v2/v2.1 7 | Local: game-time rules, deferred processing, restart/replay. Partial: conditions support time and one causal event; NPC plans do not autonomously move physical entities. G14/G22. |
| PRE/POST, strict rewrite, fallback | v1 7; v2/v2.1 8, 10 | Local: request binding, one strict rewrite/re-audit, pending reconciliation; G10-G12. Model output quality is unverified. |
| Immutable journal, delta status and confidence | v1 8; v2/v2.1 9 | Local append-only records/decisions and transaction commit. Partial: confidence is turn-level; disputed batches remain proposed/pending rather than automatically splitting independent safe operations. [stage 1](stage1_implementation.md). |
| Edit/swipe/delete/rebuild | v1 8; v2/v2.1 11 | Local G6-G8/G12/G13, branch equality, incompatible continuation invalidation, checkpoints and optimized lookup. [comparison](stage6/rebuild-comparison.json). |
| Semantic retrieval and cache | v1 9; v2/v2.1 12 | Local adapters, Unicode fallback, scoped embeddings, SQLite FTS5/vec and supersession. Authored multilingual lexical measurements exist; real multilingual embedding quality is unverified. [stage 3](stage3_implementation.md). |
| Session/campaign/selective continuity | v1 9.3; v2/v2.1 12.5 | Local G20 and scope/visibility filtering; no unrestricted cross-character import. |
| Budgets, latency and tokens | v1 13; v2/v2.1 13, 18.2 | Local packet limits, call rules, p50/p95, response quality and token availability counters. Real API latency/cost and extraction precision/recall are unverified. |
| Scene descriptors and sprite profiles | v1 10; v2/v2.1 14.1-14.3 | Local accepted-state descriptors, profile validation and sprite filtering. Pure illustration G16. [stage 5](stage5_implementation.md). |
| ComfyUI jobs and scene binding | v1 10.6; v2/v2.1 14.4 | Local queue, restart, uncertain POST protection, scoped image proxy, stale markers and G17. Gallery browser rendering unverified. |
| Identity continuity and partial redraw | v1 10.4-10.5; v2/v2.1 14.5 | Partial: seed reuse, references/LoRA bindings and fixed optional stage recipes. Real custom workflows/models, masks and identity/pose fidelity are not supplied or verified; no automatic mask generation. |
| Settings, commands and diagnostics | v1 12; v2/v2.1 16 | Local modes, thresholds, workflow selection, English commands without aliases, pending/subsystem summary and export. Partial: no separate configurable ask_player policy; current ambiguity flow is proposed/pending/rebuild or explicit author correction. |
| Storage, migrations, recovery | v1 13-14; v2/v2.1 17.1 | Local same adapter contract G19, actual SQLite restart/migration backups, atomic writes, idempotency and offline conflict preservation. |
| Untrusted output and private data | v1 14; v2/v2.1 17.2 | Local schema/operation allowlists, server-held keys, fixed endpoints, SSRF checks, scoped storage and redaction. G15 tests injected output boundaries. No claim of universal semantic prompt-injection resistance or absolute secret-proof logging. |
| Golden scenarios and load | v1 15; v2/v2.1 18 | Local [G1-G27 execution](stage6/golden-results.json), 126 client/44 server tests, 3000-turn/300-entity/30000-memory workload. Synthetic responses satisfy the recorded-response option; imported chat archives are outside scope. |
| Packaging, docs and extension instructions | v1 16 stage 6; v2/v2.1 19 stage 6 | Local README, parameter/visual contracts, reproducible commands and pack checks. Publishing this version is a separate action. |
| Architecture choices and open questions | v1 17-19; v2/v2.1 20-23 | Decision: retain SQLite + optional sqlite-vec, no Python sidecar or database-service rewrite. Live quality goals are not replaced by synthetic success claims. |

## Remaining work versus excluded proof

The local core has broad automated coverage; the whole specification must not be labelled fully accepted. Remaining implementation limits are: flexible legacy knowledge/state structures, no operation-level partial acceptance, no ask_player UI policy, limited event conditions/autonomous NPC plans, and custom visual workflow/mask integration. Some are deliberately conservative behavior rather than defects; expanding them needs separately scoped work and tests.

Operational additions not required for current local acceptance include visual job retention/cleanup and inclusion of visual profiles in world export. Existing visual output files are owned by ComfyUI; the extension does not promise their backup.

Excluded live proof includes actual ST UI/group/VN execution, model extraction and psychological quality, embedding model quality, real API token/latency statistics, visual likeness and image quality. These are unverified, not passing or failing results. No importable reference chat project is necessary to complete the agreed local checks.
