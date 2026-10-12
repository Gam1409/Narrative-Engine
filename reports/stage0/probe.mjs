// Synthetic audit: local files and fabricated data only; no model/network calls.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { NarrativeRuntime } from '../../src/runtime/runtime.js';
import { StateManager } from '../../src/state/manager.js';
import { MemoryStorageAdapter } from '../../src/memory/storage.js';
import { EpisodicMemoryStore } from '../../src/memory/store.js';
import { ServerStorageAdapter } from '../../src/memory/serverStorage.js';
import { retrieveMemories, scoreMemory } from '../../src/memory/retrieval.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import { validateSchema } from '../../src/utils/schema.js';
import { getChatFingerprint } from '../../src/context/stContext.js';
const originalFetch = globalThis.fetch, originalST = globalThis.SillyTavern;
const root = new URL('../../', import.meta.url);
globalThis.fetch = async url => {
 const target = new URL(url);
 if (target.protocol !== 'file:' || !target.href.startsWith(root.href)) throw new Error('Audit forbids network');
 return new Response(await readFile(target));
};
const observations = [];
const record = (id, requirementMet, observed) => observations.push({ id, requirementMet, observed });
const schema = JSON.parse(await readFile(new URL('schemas/state.schema.json', root), 'utf8'));
function fixture() {
 const context = { chatId: 'audit', characterId: 0, characters: [{ name: 'Anna', avatar: 'Anna.png' }],
 chat: [{ is_user: true, mes: 'Take the sword.' }, { name: 'Anna', mes: 'Anna takes the sword.', send_date: 'stable-1', extra: {} }],
 chatMetadata: {}, saveMetadata: async () => {}, saveChat: async () => {} };
 globalThis.SillyTavern = { getContext: () => context };
 const runtime = new NarrativeRuntime();
 runtime.settings = { ...DEFAULT_SETTINGS, enabled: true, spriteDirector: false };
 runtime.storage = new MemoryStorageAdapter();
 runtime.stateManager = new StateManager({ storage: runtime.storage, chatFingerprint: getChatFingerprint(context), validator: s => validateSchema(schema, s) });
 runtime.memoryStore = new EpisodicMemoryStore({ storage: runtime.storage, key: `narrative-engine:${getChatFingerprint(context)}:memories` });
 runtime.spriteManifests = { loadParticipants: async () => [] };
 runtime.calls = 0;
 runtime.director = { run: async () => { runtime.calls++; return {
 audit: { valid: true, errors: [] }, state_delta: { time_advance_minutes: 5, objects: { sword: { holder: 'Anna' } } },
 relationship_delta: [], knowledge_delta: [], thread_delta: {}, world_event_delta: {},
 memory_candidates: [{ summary: 'Anna took the sword.' }], sprite_decisions: {} }; } };
 return { runtime, context };
}
try {
 const common = { importance: 0.5, createdAt: '2026-10-01T00:00:00Z' }, now = Date.parse('2026-10-12T00:00:00Z');
 const relevant = scoreMemory({ ...common, summary: 'скрипку' }, { message: 'скрипки' }, now);
 const unrelated = scoreMemory({ ...common, summary: 'яблоко' }, { message: 'скрипки' }, now);
 record('C2', relevant > unrelated, { relevant, unrelated });
 {
 const { runtime, context } = fixture(); await runtime.processPost(1, 'normal'); context.chat.pop(); await runtime.markDirtyAndRebuild(1);
 record('C3', runtime.memoryStore.items.length === 0, { memoriesAfterDelete: runtime.memoryStore.items.length, swordAfterDelete: runtime.stateManager.state.objects.sword ?? null });
 }
 {
 const { runtime, context } = fixture();
 runtime.director.run = async () => ({ audit: { valid: false, errors: [{ severity: 'high' }] }, state_delta: { scene: { location: 'hall' } } });
 await runtime.processPost(1, 'normal');
 record('C5', context.chatMetadata.narrative_engine.pendingReconciliation === true, { revision: runtime.stateManager.state.revision, pendingReconciliation: context.chatMetadata.narrative_engine.pendingReconciliation });
 }
 {
 const { runtime } = fixture(); await runtime.stateManager.applyDelta({ objects: { sword: { location: 'table', holder: 'missing-character', container: 'missing-bag' } } });
 record('C6', false, { invalidReferencesAccepted: true, conflictingPositionAccepted: true });
 }
 {
 const { runtime } = fixture(); await runtime.processPost(1, 'normal'); await runtime.processPost(1, 'normal');
 record('G12-same-runtime', runtime.calls === 1, { directorCalls: runtime.calls });
 await runtime.loadChat(); await runtime.processPost(1, 'normal');
 record('C8', runtime.stateManager.state.timeline.elapsedMinutes === 5, { minutesAfterReloadAndRender: runtime.stateManager.state.timeline.elapsedMinutes, directorCalls: runtime.calls });
 record('C7', false, { confidence: runtime.stateManager.deltas.at(-1).confidence, status: runtime.stateManager.deltas.at(-1).status ?? null });
 }
 {
 const { runtime, context } = fixture(); await runtime.processPost(1, 'normal'); context.chat[1].mes = 'Anna leaves the sword on the table.';
 await runtime.markDirtyAndRebuild(1); await runtime.processPost(1, 'normal');
 record('C9-edit', runtime.calls > 1, { holderAfterEdit: runtime.stateManager.state.objects.sword.holder, directorCalls: runtime.calls });
 }
 {
 const memories = [{ id: 'secret', summary: 'hidden key', visibleTo: ['Anna'], status: 'current' }, { id: 'old', summary: 'hidden key', visibleTo: ['Bob'], status: 'superseded' }];
 const found = retrieveMemories(memories, { message: 'hidden key', characters: ['Bob'], visibleTo: ['Bob'] });
 record('C10', found.length === 0, { returnedIds: found.map(m => m.id) });
 }
 {
 const { runtime, context } = fixture(); await runtime.processPost(1, 'normal');
 await new Promise(resolve => setTimeout(resolve, 10));
 const before = structuredClone(runtime.stateManager.state); await runtime.markDirtyAndRebuild(0);
 record('C11', JSON.stringify(before) === JSON.stringify(runtime.stateManager.state), { beforeAt: before.provenance['objects.sword.holder'].at, afterAt: runtime.stateManager.state.provenance['objects.sword.holder'].at, chatPreservesAt: Boolean(context.chat[1].extra.narrative_engine.at) });
 }
 {
 const manager = new StateManager({ checkpointEvery: 1 });
 await manager.applyDelta({ objects: { sword: 'table' } }, { messageIndex: 0 });
 await manager.applyDelta({ objects: { sword: 'Anna' } }, { messageIndex: 1 }); manager.markDirty(1);
 const history = [{ messageIndex: 0, delta: { objects: { sword: 'table' } } }, { messageIndex: 1, delta: { objects: { sword: 'Bob' } } }];
 await manager.rebuild({ deltas: history }); const first = manager.state.objects.sword;
 manager.markDirty(2); await manager.rebuild({ deltas: history });
 record('A1-stale-checkpoint', manager.state.objects.sword === first, { firstRebuild: first, laterRebuild: manager.state.objects.sword });
 }
 {
 const { runtime } = fixture(); await runtime.stateManager.applyDelta({ characters: { Anna: { trait: 'careful' } } }, { messageIndex: -1, source: 'character-card' });
 await runtime.markDirtyAndRebuild(0);
 record('A2-card-defaults', Boolean(runtime.stateManager.state.characters.Anna), { charactersAfterRebuild: runtime.stateManager.state.characters });
 }
 {
 const saved = [], adapter = new ServerStorageAdapter({}, { fetchImpl: async (_url, options) => {
 if (options.method === 'POST') saved.push(JSON.parse(options.body).state);
 return { ok: true, json: async () => ({ state: structuredClone(saved.at(-1) ?? null) }) }; } });
 for (let i = 1; i <= 100; i++) await adapter.setItem('narrative-engine:ne-abcdef12:bundle', { deltas: Array.from({ length: i }, (_, j) => ({ messageIndex: j, delta: { objects: { sword: 'Anna' } } })) });
 record('C4', saved.length <= 1, { writes: saved.length, retainedDeltaCopies: saved.reduce((sum, e) => sum + e.values.bundle.deltas.length, 0), sourceDeltas: 100, transport: 'mock HTTP, real adapter' });
 }
 {
 const adapter = new ServerStorageAdapter({}, { fetchImpl: async () => ({ ok: true, json: async () => ({ state: { __narrativeEngineStore: 1, values: { bundle: { revision: 9 } } } }) }) });
 const key = 'narrative-engine:ne-abcdef12:bundle', online = await adapter.getItem(key);
 adapter.fetch = async () => { throw new Error('offline'); }; const offline = await adapter.getItem(key);
 record('A3-fallback', offline?.revision === online.revision, { online, offline, degraded: adapter.degraded });
 }
 const require = createRequire(new URL('../../server-plugin/package.json', import.meta.url));
 let driver = false; try { require.resolve('better-sqlite3'); driver = true; } catch {}
 record('environment-better-sqlite3', driver, { available: driver });
 if (driver) {
 const { Database } = require('./lib/database.js');
 const db = new Database({ storageRoot: fileURLToPath(new URL('.', import.meta.url)), databasePath: ':memory:' });
 try {
 const adapter = new ServerStorageAdapter({}, { fetchImpl: async (_url, options) => {
 if (options.method === 'POST') db.saveState('audit', JSON.parse(options.body).state);
 return { ok: true, json: async () => ({ state: db.getState('audit') }) }; } });
 for (let i = 1; i <= 100; i++) await adapter.setItem('narrative-engine:ne-abcdef12:bundle', { deltas: Array.from({ length: i }, (_, j) => ({ messageIndex: j })) });
 const rows = db.db.prepare('SELECT state_json FROM state_snapshots').all();
 const total = rows.reduce((n, row) => n + JSON.parse(row.state_json).values.bundle.deltas.length, 0);
 const deltaRows = db.db.prepare('SELECT count(*) AS n FROM state_deltas').get().n;
 record('C4-real-sqlite', rows.length <= 1, { driverVersion: require('better-sqlite3/package.json').version, snapshots: rows.length, deltaCopies: total, structuredDeltaRows: deltaRows, latestDeltaCount: db.getState('audit').values.bundle.deltas.length });
 } finally { db.close(); }
 }
 {
 const { runtime, context } = fixture();
 runtime.director.run = async () => { throw new Error('synthetic director outage'); };
 await runtime.processPost(1, 'normal');
 const pendingBefore = context.chatMetadata.narrative_engine.pendingReconciliation;
 await runtime.markDirtyAndRebuild(0);
 record('A4-outage-rebuild', runtime.stateManager.state.timeline.elapsedMinutes === 5, { pendingBefore, pendingAfter: context.chatMetadata.narrative_engine.pendingReconciliation, revisionAfterRebuild: runtime.stateManager.state.revision, status: runtime.diagnostics.status });
 }

 console.log(JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, mode: 'synthetic audit; false means requirement not met, not live acceptance', observations }, null, 2));
} finally { globalThis.fetch = originalFetch; globalThis.SillyTavern = originalST; }
