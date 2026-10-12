import test from 'node:test';
import assert from 'node:assert/strict';
import { Diagnostics } from '../src/runtime/diagnostics.js';

test('diagnostics separate reported tokens from unavailable usage and summarize bounded latency', () => {
    const diagnostics = new Diagnostics();
    diagnostics.recordUsage({ prompt_tokens: 10, completion_tokens: 5 });
    diagnostics.recordUsage(null); diagnostics.recordRepair();
    for (const ms of [10,20,30,40]) diagnostics.recordLatency('post', ms);
    const result = diagnostics.snapshot();
    assert.deepEqual(result.usage, { calls: 2, reportedTokens: 15, callsWithoutUsage: 1, jsonRepairs: 1 });
    assert.deepEqual(result.latencyStats.post, { count: 4, p50: 20, p95: 40 });
});
