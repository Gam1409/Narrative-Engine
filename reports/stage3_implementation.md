# Stage 3 — memory, knowledge filters, and session scope

Version: 0.6.0. Local verification: 2026-10-12. No live SillyTavern, RP model, or embedding-model calls were made.

## What changed

Memory now carries text, type, entities, visibleTo, gameTime, importance, status, sourceDeltaId, campaignId, sessionId, and embeddingHash. The [memory schema](../schemas/memory.schema.json) defines new canonical records; older records remain readable. Legacy records without explicit visibility are excluded from character retrieval.

Campaign, session, visibility, status, and game-period filters run before scoring or embedding requests. Shared PRE context uses the intersection of permissions for scene participants and actual generation recipients. The latter prevents a new session's character from inheriting the previous cast's private knowledge. Queries use characters present in the scene instead of every character in the world.

PRE receives a restricted projection of state. Private thoughts, unannotated knowledge, hidden threads, provenance, off-scene objects and raw historical RP messages are omitted. Public spatial information and permitted facts remain available. The same filter runs with audit off, soft, and strict. Code supplies the final packet's retrieved memories and active threads, rather than accepting an invented memory list from PRE output.

These rules govern context added by Narrative Engine. They do not remove messages or character-card content already supplied independently by SillyTavern to its RP model. Correct extraction of visibility from narrative text still depends on the POST model; its live quality has not been measured.

## Languages and retrieval

The temporary Russian word-form dictionary was removed following user feedback. The fallback now uses Unicode NFKC normalization, words, and character n-grams. Latin, Cyrillic, CJK and mixed text use the same interface with no language setting. This is lexical overlap, not full morphological analysis, translation, or universal semantic understanding.

Semantic search uses the configured embedding endpoint. Choose a model with documented coverage of the languages used in the campaign, particularly for queries and memories in different languages. No embedding model is hard-coded or downloaded automatically.

Server configuration:

```text
NARRATIVE_ENGINE_EMBEDDING_URL=<OpenAI-compatible base URL, including /v1 if required>
NARRATIVE_ENGINE_EMBEDDING_MODEL=<your multilingual model ID>
NARRATIVE_ENGINE_EMBEDDING_API_KEY=<server-side key if required>
```

The server appends `/embeddings`. The existing provider-host allowlist applies. Enable **Semantic memory search (server embeddings)** in settings. Keys stay on the server; client requests cannot change the endpoint or model.

Embeddings are cached in SQLite by authenticated user/chat scope, exact SHA-256 text hash, and endpoint/model identity. A changed text or configured model creates another entry. Eligible candidates alone are sent for embedding. Initial indexing can require multiple batches and model calls; cached texts do not call the provider again. Old cache entries are retained, so large campaigns can increase disk usage.

The selected mechanism is **SQLite + FTS5 + sqlite-vec 0.1.9**, locally verified with better-sqlite3 12.4.1 on Windows/Node 24.14.0. Ranking combines vector similarity with a small FTS lexical contribution, then applies configurable similarity, importance, active-entity, location, game-time recency and historical-penalty weights. Top-K and a separate memory budget limit output.

If sqlite-vec is unavailable but embeddings work, the client computes cosine similarity. If the embedding provider fails, filtered Unicode retrieval continues and diagnostics show `lexical_degraded`. With embeddings disabled, this is also the normal fallback label. Failure does not switch off knowledge filters or block ordinary chat. The weights are editable under **Memory ranking weights**.

## History and stale memory

POST can replace a durable fact using the same factKey or explicit supersedes IDs. Only current memories from accepted records supersede earlier facts. Original delta and memory rows are not rewritten; status and supersededBy form a projection. Superseded/disputed memories are excluded from ordinary retrieval. Explicit historical retrieval can include superseded entries with their status and time.

Deleting or changing a turn restores the corresponding earlier projection. Replacement also works for memories inherited in a session baseline. Public and private facts are still filtered independently of their rank. Without a factKey or supersedes relation, automatic detection of arbitrary contradictory natural-language memories is not claimed.

## Session scope

Scope belongs to the session bundle and compact metadata, rather than a global switch. Configure it before the first accepted turn:

```text
/narrative-configure-session {"mode":"campaign","campaignId":"my-campaign"}
```

Run `/narrative-configure-session` without JSON to see its sessionId. In a new chat, copy that value into fromSession:

```text
/narrative-configure-session {"mode":"campaign","campaignId":"my-campaign","fromSession":"ne-a1"}
```

`ne-a1` is an example ID, not a fixed source. Campaign mode inherits a snapshot of state, relationships, memories and open threads. Source scope must match the campaign; a missing or pending source is rejected. Knowledge filters still apply when the new participant reads that snapshot.

Selective transfer supports lists of memoryIds, entities or types; these lists select memories and open threads. It does not clone an incomplete physical entity graph:

```text
/narrative-configure-session {"mode":"selective","campaignId":"my-campaign","fromSession":"ne-a1","types":["fact","thread"]}
```

Session-only mode imports nothing:

```text
/narrative-configure-session {"mode":"session_only","campaignId":"my-campaign"}
```

Transfer is a snapshot at session creation, not bidirectional live synchronization. Subsequent source-session edits do not rewrite an already-started session. This avoids retroactively changing its accepted turns. Session configuration and the imported baseline commit atomically.

## English commands

Only the following names are registered. There are **no aliases**, as explicitly requested; older macros must use the new names.

| Command | Action |
| --- | --- |
| `/narrative-engine on|off` | Enable or disable the extension |
| `/narrative-configure-session` | Show or configure memory scope |
| `/narrative-edit-world` | Apply an explicit author correction as `{reason,ops}` |
| `/narrative-show-registry` | Show entity types and parameter definitions |
| `/narrative-show-state` | Show current world state |
| `/narrative-show-threads` | Show plot threads |
| `/narrative-show-timeline` | Show game time |
| `/narrative-show-memory` | Inspect stored memories as the author |
| `/narrative-rebuild-state` | Reconcile accepted history and retry pending turns |
| `/narrative-reconnect-storage` | Recover storage without overwriting conflicts |
| `/narrative-show-audit` | Show the last audit |
| `/narrative-show-director-context` | Show the last generated packet |
| `/narrative-refresh-sprites` | Refresh sprite selection |
| `/narrative-export-world` | Export state as JSON |

Author inspection commands show the author's data; they are not NPC retrieval endpoints. Command names, help, and responses are English. Story content remains language-independent.

## Local evidence

All **91 client and 35 server tests pass**. Syntax checks passed for 85 JavaScript files, all 9 schemas parse, package versions agree, and package dry-run and diff checks pass. See [verification summary](stage3/checks.json).

The automated suites cover G3, G18 and G20, every audit mode, inherited-scene visibility, multilingual lexical retrieval, vector validation/fallback, cache reuse and invalidation, authenticated-user isolation, SQLite immutable rows, branch rollback, and command registration without aliases.

- [Client test log](stage3/client-tests.txt).
- [Server test log](stage3/server-tests.txt).
- [Reproducible benchmark](stage3/measure.mjs), [labelled fixtures](stage3/retrieval-fixtures.json), [measurements](stage3/metrics.json).

The small authored set contains 24 same-language or mixed-text queries across Russian, English, German, French, Spanish, Chinese, Japanese and Korean. Exact-word baseline Recall@1 is 12/24 (50%); Unicode fallback is 23/24 (95.8%). The eight Russian cases improve from 5/8 to 8/8. This is a regression fixture set, not an independent language benchmark or evidence of cross-language semantic quality. The failed paraphrase illustrates the fallback's limit.

On 10,000 synthetic records, seven runs gave Unicode retrieval p50/p95 about 127/134 ms and SQLite cosine ranking of 384-dimensional Float32 vectors about 15/16 ms. Initial JSON-vector scans took about 2.3 seconds at p50; storing binary Float32 removed repeated JSON decoding. Timing excludes network and embedding generation. Real embedding quality is explicitly null in the report.

There is no measured reason to add Chroma or Qdrant at this size. Larger datasets, simultaneous users, initial embedding cost, and a real multilingual model require separate measurements if live testing becomes available.

Next: stage 4 — emotions, relationships, NPC appraisal, delayed processing and world-time events. G23 here checks exclusion of stored private state; it does not establish the full emotional model required by G21–G27.
