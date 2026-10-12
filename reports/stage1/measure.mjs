import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { StateManager } from '../../src/state/manager.js';
import { retrieveMemories } from '../../src/memory/retrieval.js';
import { ServerStorageAdapter } from '../../src/memory/serverStorage.js';
const require = createRequire(new URL('../../server-plugin/package.json', import.meta.url));
const { Database } = require('./lib/database.js');
const now = '2026-10-12T00:00:00Z';
const records = Array.from({ length: 1000 }, (_, i) => ({ deltaId: `d${i}`, idempotencyKey: `turn-${i}`, messageIndex: i,
    delta: { time_advance_minutes: 1 }, source: `message:${i}`, at: now, confidence: 0.8, memories: [{ summary: `event ${i}` }], messageRef: { messageIndex: i, swipeId: 0 } }));
const decisions = records.map(r => ({ decisionId: `decision-${r.deltaId}`, deltaId: r.deltaId, status: 'confirmed', at: now }));
const manager = new StateManager(); await manager.commit({ records, decisions });
async function measure(run, iterations = 7) {
    const samples = [];
    for (let i=0;i<iterations;i++) { const start = performance.now(); await run(); samples.push(performance.now()-start); }
    const sorted = [...samples].sort((a,b) => a-b);
    return { samplesMs: samples.map(n => +n.toFixed(3)), p50Ms: +sorted[Math.ceil(sorted.length*.5)-1].toFixed(3), p95Ms: +sorted[Math.ceil(sorted.length*.95)-1].toFixed(3) };
}
const branch1000 = await measure(async () => { await manager.selectBranch(records); assert.equal(manager.state.timeline.elapsedMinutes, 1000); });
const memories = Array.from({ length: 10000 }, (_, i) => ({ id: `m${i}`, summary: i===777 ? 'violin rehearsal promise' : `routine event ${i}`, importance: 0.5, createdAt: now }));
const retrieval10000 = await measure(() => { const result = retrieveMemories(memories, { message: 'violin rehearsal' }); assert.equal(result[0].id, 'm777'); });
const db = new Database({ storageRoot: process.cwd(), databasePath: ':memory:' });
let transmittedBytes = 0;
try {
    const storage = new ServerStorageAdapter({}, { fetchImpl: async (url, options) => {
        const [chat, field] = url.split('/').slice(-2).map(decodeURIComponent);
        let result;
        if (options.method === 'POST') { transmittedBytes += Buffer.byteLength(options.body); const body = JSON.parse(options.body); result = db.writeField(chat, field, body.value, body.expectedRevision); }
        else result = db.readField(chat, field);
        return { ok: true, json: async () => result };
    } });
    const journal = new StateManager({ storage, chatFingerprint: 'ne-a1', checkpointEvery: 10 }); await journal.load();
    const writeSamples = [];
    for (let i=0;i<100;i++) { const start = performance.now(); await journal.recordTurn({ time_advance_minutes: 1 }, { idempotencyKey: `t${i}`, messageIndex: i }, { memories: [{ summary: `e${i}` }] }); writeSamples.push(performance.now()-start); }
    const count = table => db.db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
    const sorted = [...writeSamples].sort((a,b)=>a-b);
    const result = { measuredAt: new Date().toISOString(), node: process.version,
        scope: 'Synthetic local CPU/SQLite measurements; no ST, network or model latency; small per-turn deltas',
        branch1000, lexicalRetrieval10000: retrieval10000,
        sqlite100Turns: { p50Ms: +sorted[49].toFixed(3), p95Ms: +sorted[94].toFixed(3), transmittedBytes,
            records: count('turn_records'), decisions: count('turn_decisions'), memories: count('turn_memories'), checkpoints: count('turn_checkpoints'), snapshots: count('state_snapshots') },
        realDirectorLatency: null, realTokenUsage: null, extractionQuality: null };
    await writeFile(new URL('./metrics.json', import.meta.url), JSON.stringify(result, null, 2)+'\n'); console.log(JSON.stringify(result,null,2));
} finally { db.close(); }
