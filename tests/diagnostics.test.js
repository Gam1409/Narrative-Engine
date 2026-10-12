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

import { parseAndValidateJson } from '../src/utils/json.js';
import { subsystemStatus } from '../src/ui/actions.js';
const schema={type:'object',required:['ok'],properties:{ok:{type:'boolean'}},additionalProperties:false};
test('quality counts invalid initial and repair responses, including local repair, without treating no data as success',async()=>{
 const d=new Diagnostics(),observe=r=>d.recordResponse('post',r);
 assert.equal(d.snapshot().quality.strictRewriteRate,null);
 await parseAndValidateJson('{"ok":true,}',schema,null,observe);
 await parseAndValidateJson('bad',schema,async()=>'{"ok":true}',observe);
 await assert.rejects(parseAndValidateJson('bad',schema,async()=>'{"ok":"wrong"}',observe));
 assert.deepEqual(d.snapshot().quality.responses.post,{total:5,invalid:4,invalidRate:0.8});
 d.recordPostAttempt(false);d.recordPostAttempt(true);d.recordPostAttempt(true);d.recordStrictRewrite();
 assert.equal(d.snapshot().quality.postAttempts,3);assert.equal(d.snapshot().quality.strictRewriteRate,0.5);
 const copy=d.snapshot();copy.quality.responses.post.total=99;assert.equal(d.snapshot().quality.responses.post.total,5);
});
test('subsystem summary exposes pending and degraded storage without including private job payloads',()=>{
 const r={stateReady:true,storage:{degraded:true},stateManager:{pending:[{},{}]},settings:{innerLifeMode:'full',visualEnabled:true},diagnostics:{retrievalMode:'lexical_degraded'},visualDirector:{lastJobStatus:'failed_final',secret:'hidden'}};
 const s=subsystemStatus(r);assert.equal(s.pendingReconciliation,2);assert.equal(s.visual,'failed_final');assert.equal(s.storage,'degraded');assert.doesNotMatch(JSON.stringify(s),/hidden/);
});
