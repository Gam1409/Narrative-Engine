# Stage 6: diagnostics and reproducible local acceptance

Version 1.0.0. Local verification only; live ST/model/ComfyUI validation remains excluded by agreement.

## Diagnostics

Director trace and diagnostics export include response quality and subsystem summaries. Invalid-response rates count each initial or model-repair response once, after extraction and schema validation but before local repair. Locally repaired invalid input is therefore still counted as invalid. A failed transport produces no response and is not in that denominator. Rates are per PRE/POST/reconcile role; raw responses are not stored in the counters.

Strict rewrite rate is rewrite attempts divided by strict POST processing attempts. Reconciliation retries count as processing attempts; this is not a claim about unique story turns. Empty denominators produce null. Counters cover the extension lifetime, across chat switches, and reset on reload. Existing p50/p95 samples retain the latest 500 calls per role. Token totals only include provider-reported usage; unavailable usage remains separately counted.

Subsystem status is current-chat state readiness, storage fallback, pending count, retrieval mode, inner-life mode and the last observed visual job status. It does not poll a server or declare a service healthy based on configuration. Last-observed visual status is reset by constructing the next chat's visual director; other historical session counters retain their documented scope.

## Reference scenarios and runner

[Golden scenario catalog](../tests/fixtures/golden-scenarios.json) contains G1-G27 reference prompts, expected outcomes and exact test names. These are scenario specifications, not imported full SillyTavern transcripts. Multi-step action/replay details are implemented in the linked tests. Tests supply scripted Director responses; G24 proves preservation of distinct appraisals, not a real model's ability to infer them. G15 supplies malicious scripted output and verifies code boundaries, not real-model prompt-injection resistance.

```powershell
npm test
npm run test:server
npm run test:golden
npm run test:load
```

The golden runner executes the actual referenced test files, verifies each named test passed, rejects missing evidence and exits nonzero on failure. It does not pass a scenario merely because its ID appears in source. Both storage implementations execute for G19. Reports are [scenario results](stage6/golden-results.json), [TAP evidence](stage6/golden-tests.txt), [client tests](stage6/client-tests.txt) and [server tests](stage6/server-tests.txt).

To evaluate a real model later, use each catalog prompt with its specified setup from the linked test and compare resulting state/packet against expected outcomes. Do not treat the scripted result as model-quality evidence. Importable chat transcripts are outside the agreed local scope; empirical dialogue-quality scores remain unmeasured.

## Load measurement

[Load report](stage6/load-metrics.json) measures combined local work: replay of 3000 small deltas with light simulation over 300 entities, retrieval over 30000 memories, and extraction of a six-character visual scene. Setup operations respect the 200-operation batch limit. Assertions check final elapsed time, entity count, retrieval target and scene membership. Three samples are recorded; p95 is the maximum of those three, not a statistically robust service-level estimate. Storage here is in-memory; separate golden tests verify actual SQLite persistence/reopen.

These results exclude network, actual embeddings, full psychological inference, browser layout and GPU generation. No fixed cross-machine timing threshold is asserted. Use the report to find regressions on the same machine, not to predict API latency or token cost.

## Remaining boundaries

Installation/update and configuration are in [README](../README.md). Parameter and workflow extension contracts remain in the [stage 2](stage2_implementation.md) and [stage 5](stage5_implementation.md) guides. Visual identity, partial redraw quality, model extraction/retrieval quality and real token/latency measurements remain unverified. Optional workflow recipes/masks require the actual ComfyUI deployment. Visual job retention has no automatic cleanup and visual profiles are outside world export. No deployment or publication is implied by these checks.

## Rebuild optimization and final requirements review

CPU sampling found repeated structured cloning and journal scans. Physical-field validation now derives holder/location/container from position without cloning the entire entity. Branch selection builds temporary indexes for latest decisions, latest eligible records and author anchors. Indexes are rebuilt per call, so no stale persistent cache is introduced. Replay still applies and validates every delta; transaction snapshots remain independent copies.

The same profiled workload improved from 9486 ms to 4271 ms median (2.22x). These are full rebuilds, not warm checkpoint timings. See [before](stage6/load-before-optimization.json), [after](stage6/load-metrics.json) and [CPU summary](stage6/rebuild-comparison.json). Performance can vary by machine and journal complexity; large-state copies still occur. New regressions cover frozen entity validation, conflicting derived positions, superseded versions and branch reactivation.

The [final requirements matrix](final_requirements_review.md) reconciles all three supplied specifications by requirement area and separately records limitations and excluded live acceptance. Importable ST chats are not a required local deliverable: the v2.1 golden-scenario definition expressly permits recorded model outputs, and the user removed manual/live chat preparation from this scope.
