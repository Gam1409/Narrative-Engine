import { validateSimulationState } from './simulation.js';
import { validateWorld } from './entities.js';
import { applyStateDelta, createInitialState } from './model.js';
import { createCheckpoint, nearestCheckpoint } from './checkpoints.js';
import { migrateState } from './migrations.js';
import { clone, deepFreeze } from '../utils/object.js';
import { MemoryStorageAdapter } from '../memory/storage.js';
import { decision, latestStatus, activeMemories, projectMemoryStatuses } from './history.js';

export class StateManager {
    constructor({ chatFingerprint = 'default', storage = new MemoryStorageAdapter(), validator, checkpointEvery = 10 } = {}) {
        Object.assign(this, { chatFingerprint, storage, validator, checkpointEvery: Math.max(1, Number(checkpointEvery) || 10) });
        this.state = createInitialState(); this.deltas = []; this.checkpoints = [];
        this.records = []; this.decisions = []; this.pending = []; this.memories = [];
        this.scope = { mode: 'session_only', campaignId: chatFingerprint, sessionId: chatFingerprint };
        this.canonVersion = 0; this.dirty = false; this.legacyMemories = [];
    }
    get prefix() { return `narrative-engine:${this.chatFingerprint}`; }
    snapshot() { return clone(this.state); }
    validate(candidate) {
        validateWorld(candidate);
        validateSimulationState(candidate);
        const result = this.validator?.(candidate);
        if (result === false || result?.valid === false) throw new Error('State transaction failed validation');
    }
    async load() {
        let bundle = await this.storage.getItem(`${this.prefix}:bundle`);
        if (!bundle) {
            const [state, deltas, checkpoints] = await Promise.all(['state', 'deltas', 'checkpoints'].map(k => this.storage.getItem(`${this.prefix}:${k}`)));
            if (state) bundle = { state, deltas: deltas || [], checkpoints: checkpoints || [] };
        }
        if (!bundle) return this.snapshot();
        if (bundle.historyVersion > 2) throw new Error('History version is newer than supported');
        this.validate(migrateState(bundle.state));
        if (bundle.historyVersion !== 2) {
            const backupKey = `${this.prefix}:backup-v1`;
            if (!await this.storage.getItem(backupKey)) await this.storage.setItem(backupKey, bundle);
            bundle = { ...bundle, historyVersion: 2, records: [], decisions: [], pending: [],
                legacyMemories: await this.storage.getItem(`${this.prefix}:memories`) || [] };
        }
        if ((bundle.state?.schemaVersion || 0) < 2) {
            const backupKey = `${this.prefix}:backup-state-v1`;
            if (!await this.storage.getItem(backupKey)) await this.storage.setItem(backupKey, bundle);
        }
        this.state = migrateState(bundle.state);
        for (const key of ['deltas', 'checkpoints', 'records', 'decisions', 'pending', 'memories', 'legacyMemories']) this[key] = clone(bundle[key] || []);
        this.records = deepFreeze(this.records);
        this.canonVersion = bundle.canonVersion || 0;
        this.scope = clone(bundle.scope || this.scope);
        return this.snapshot();
    }
    bundle(patch = {}) {
        return clone({ historyVersion: 2, state: this.state, deltas: this.deltas, checkpoints: this.checkpoints,
            records: this.records, decisions: this.decisions, pending: this.pending, memories: this.memories,
            legacyMemories: this.legacyMemories, scope: this.scope, canonVersion: this.canonVersion, ...patch });
    }
    async commit(patch) {
        const bundle = this.bundle(patch);
        bundle.checkpoints = bundle.checkpoints.filter(p => p.messageIndex < 0).concat(bundle.checkpoints.filter(p => p.messageIndex >= 0).slice(-20));
        this.validate(bundle.state);
        await this.storage.setItem(`${this.prefix}:bundle`, bundle);
        for (const key of Object.keys(bundle)) if (key !== 'historyVersion') this[key] = bundle[key];
        this.records = deepFreeze(this.records);
        this.dirty = false;
    }
    async applyDelta(delta, metadata = {}) {
        if (metadata.idempotencyKey && this.deltas.some(d => d.idempotencyKey === metadata.idempotencyKey)) return this.snapshot();
        const entry = { deltaId: crypto.randomUUID(), delta: clone(delta),
            messageIndex: Number.isInteger(metadata.messageIndex) ? metadata.messageIndex : this.deltas.length,
            source: metadata.source || 'director', confidence: metadata.confidence ?? 1,
            at: metadata.at || new Date().toISOString(), ...clone(metadata) };
        const state = applyStateDelta(this.state, delta, entry);
        const deltas = [...this.deltas, entry];
        const checkpoints = (entry.messageIndex + 1) % this.checkpointEvery === 0
            ? [...this.checkpoints.filter(p => p.messageIndex !== entry.messageIndex), createCheckpoint(state, entry.messageIndex)] : this.checkpoints;
        await this.commit({ state, deltas, checkpoints });
        return this.snapshot();
    }
    findAccepted(key) {
        return this.records.findLast(r => r.idempotencyKey === key && ['confirmed', 'reverted'].includes(latestStatus(this.decisions, r.deltaId)));
    }
    async recordTurn(delta, ref, { confidence = 0.5, status = 'confirmed', audit = {}, memories = [] } = {}) {
        if (!['confirmed', 'proposed', 'rejected'].includes(status)) throw new Error('Invalid initial decision');
        if (status === 'confirmed' && this.findAccepted(ref.idempotencyKey)) return 'confirmed';
        const supersedes = this.records.filter(r => r.idempotencyKey === ref.idempotencyKey && latestStatus(this.decisions, r.deltaId) === 'proposed').map(r => r.deltaId);
        const record = { supersedes, deltaId: crypto.randomUUID(), idempotencyKey: ref.idempotencyKey,
            messageIndex: ref.messageIndex, messageRef: clone(ref), delta: clone(delta),
            source: `message:${ref.messageIndex}`, confidence, at: new Date().toISOString(),
            audit: clone(audit), memories: clone(memories) };
        Object.assign(record, { chatFingerprint: this.chatFingerprint, sessionId: this.scope.sessionId, campaignId: this.scope.campaignId,
            recordedAt: record.at, gameTime: this.state.timeline?.date && this.state.timeline?.time ? `${this.state.timeline.date}T${this.state.timeline.time}` : null,
            ops: clone(delta.ops || []), evidence: typeof audit.evidence === 'string' ? audit.evidence : '' });
        let state = this.state, deltas = this.deltas, checkpoints = this.checkpoints;
        if (status === 'confirmed') {
            try {
                const candidate = applyStateDelta(state, record.delta, record);
                this.validate(candidate); state = candidate;
            } catch (error) {
                status = 'rejected'; record.audit = { ...record.audit, validationError: error.message };
            }
        }
        if (status === 'confirmed') {
            deltas = [...deltas, record];
            if ((ref.messageIndex + 1) % this.checkpointEvery === 0) checkpoints = [...checkpoints.filter(p => p.messageIndex !== ref.messageIndex), createCheckpoint(state, ref.messageIndex, { deltaId: record.deltaId, createdAt: record.at })];
        }
        const records = [...this.records, record];
        const decisions = [...this.decisions, ...supersedes.map(id => decision(id, 'superseded', 'new POST interpretation')), decision(record.deltaId, status, 'POST audit and validation')];
        const pending = this.pending.filter(p => p.idempotencyKey !== ref.idempotencyKey);
        if (status !== 'confirmed') pending.push({ ...clone(ref), reason: status });
        await this.commit({ state, deltas, checkpoints, records, decisions, pending, memories: projectMemoryStatuses([...(this.checkpoints.find(p => p.messageIndex === -1)?.memories || []), ...activeMemories(deltas)]) });
        return status;
    }
    async authorEdit(ops, reason, simulation) {
        if (typeof reason !== 'string' || !reason.trim()) throw new Error('Author correction requires a reason');
        const tail = this.deltas.findLast(r => r.source !== 'author' && r.messageIndex >= 0);
        const record = { deltaId: crypto.randomUUID(), idempotencyKey: `author:${crypto.randomUUID()}`,
            source: 'author', messageIndex: tail?.messageIndex ?? -1, anchorKey: tail?.idempotencyKey ?? null,
            delta: { ops: clone(ops), ...(simulation ? { simulation: clone(simulation) } : {}) }, confidence: 1, at: new Date().toISOString(),
            audit: { valid: true, reason }, memories: [], messageRef: {}, supersedes: [] };
        Object.assign(record, { chatFingerprint: this.chatFingerprint, sessionId: this.scope.sessionId, campaignId: this.scope.campaignId, recordedAt: record.at,
            gameTime: this.state.timeline?.date && this.state.timeline?.time ? `${this.state.timeline.date}T${this.state.timeline.time}` : null,
            ops: clone(ops), evidence: reason });
        const state = applyStateDelta(this.state, record.delta, record); this.validate(state);
        const backupKey = `${this.prefix}:backup-author-${record.deltaId}`;
        await this.storage.setItem(backupKey, this.bundle());
        // Cached continuations were extracted before this explicit correction.
        const decisions = [...this.decisions, ...this.records.filter(r => latestStatus(this.decisions, r.deltaId) === 'reverted')
            .map(r => decision(r.deltaId, 'superseded', 'explicit author correction')), decision(record.deltaId, 'confirmed', reason)];
        await this.commit({ state, records: [...this.records, record], deltas: [...this.deltas, record], decisions,
            checkpoints: this.checkpoints.filter(p => p.messageIndex === -1) });
        return this.snapshot();
    }
    async setPending(ref, reason) {
        await this.commit({ pending: [...this.pending.filter(p => p.idempotencyKey !== ref.idempotencyKey), { ...clone(ref), reason }] });
    }
    async selectBranch(refs) {
        // Local indexes preserve last-decision/last-compatible-record semantics.
        const statuses = new Map(this.decisions.map(d => [d.deltaId, d.status]));
        const accepted = new Map();
        for (const record of this.records) if (['confirmed', 'reverted'].includes(statuses.get(record.deltaId))) accepted.set(record.idempotencyKey, record);
        const chosen = [];
        // Stop at the first gap: later turns depend on the missing predecessor.
        for (const ref of refs) {
            const record = accepted.get(ref.idempotencyKey);
            if (!record) break;
            chosen.push(record);
        }
        const turns = [...chosen];
        const authorRecords = this.records.filter(r => r.source === 'author' && ['confirmed', 'reverted'].includes(statuses.get(r.deltaId)));
        const ordered = [];
        const authorsByAnchor = new Map();
        for (const record of authorRecords) { const list = authorsByAnchor.get(record.anchorKey) || []; list.push(record); authorsByAnchor.set(record.anchorKey,list); }
        const appendAuthors = key => ordered.push(...(authorsByAnchor.get(key) || []));
        appendAuthors(null);
        for (const turn of turns) { ordered.push(turn); appendAuthors(turn.idempotencyKey); }
        chosen.splice(0, chosen.length, ...ordered);
        const base = this.checkpoints.find(p => p.messageIndex === -1);
        const selectedByIndex = new Map(chosen.map(r => [r.messageIndex, r.deltaId]));
        // A checkpoint is reusable only if its immutable turn belongs to this exact prefix.
        const checkpoints = this.checkpoints.filter(p => p.messageIndex === -1 || (!authorRecords.length && p.deltaId && selectedByIndex.get(p.messageIndex) === p.deltaId));
        const point = nearestCheckpoint(checkpoints, Infinity);
        let state = point ? migrateState(point.state) : createInitialState();
        for (const record of chosen) {
            if (point && record.source !== 'author' && record.messageIndex <= point.messageIndex) continue;
            state = applyStateDelta(state, record.delta, record); this.validate(state);
            if (!authorRecords.length && (record.messageIndex + 1) % this.checkpointEvery === 0) checkpoints.push(createCheckpoint(state, record.messageIndex, { createdAt: record.at, deltaId: record.deltaId }));
        }
        const selected = new Set(chosen.map(r => r.deltaId));
        const decisions = [...this.decisions];
        for (const r of this.records) {
            const status = statuses.get(r.deltaId);
            if (status === 'confirmed' && !selected.has(r.deltaId)) decisions.push(decision(r.deltaId, 'reverted', 'branch changed'));
            if (status === 'reverted' && selected.has(r.deltaId)) decisions.push(decision(r.deltaId, 'confirmed', 'compatible branch restored'));
        }
        const pending = refs.slice(turns.length).map(ref => ({ ...ref, reason: 'missing or stale POST' }));
        const patch = { state, checkpoints: checkpoints.filter(p => p.messageIndex < 0).concat(checkpoints.filter(p => p.messageIndex >= 0).slice(-20)), deltas: chosen, decisions, pending, memories: projectMemoryStatuses([...(base?.memories || []), ...activeMemories(chosen)]) };
        if (JSON.stringify(this.bundle(patch)) !== JSON.stringify(this.bundle())) await this.commit(patch);
        return pending;
    }
    checkpoint(messageIndex = this.deltas.at(-1)?.messageIndex ?? -1) {
        const point = createCheckpoint(this.state, messageIndex);
        this.checkpoints = [...this.checkpoints.filter(p => p.messageIndex !== messageIndex), point]; return clone(point);
    }
    async restoreCheckpoint(messageIndex = Infinity) {
        const point = nearestCheckpoint(this.checkpoints, messageIndex);
        if (!point) throw new Error('No checkpoint available');
        await this.commit({ state: migrateState(point.state) }); return this.snapshot();
    }
    markDirty(fromMessageIndex = 0) { this.dirty = true; this.dirtyFrom = Math.max(0, Number(fromMessageIndex) || 0); }
    async rebuild({ throughMessageIndex = Infinity, deltas = this.deltas } = {}) {
        const ceiling = this.dirty ? Math.min(throughMessageIndex, this.dirtyFrom - 1) : throughMessageIndex;
        const checkpoints = this.checkpoints.filter(p => p.messageIndex <= ceiling);
        const point = nearestCheckpoint(checkpoints, ceiling);
        let state = point ? migrateState(point.state) : createInitialState(), replayed = 0;
        for (const entry of [...deltas].filter(d => d.messageIndex <= throughMessageIndex).sort((a,b) => a.messageIndex - b.messageIndex)) {
            if (point && entry.messageIndex <= point.messageIndex && !(entry.source === 'author' && point.messageIndex === -1)) continue;
            state = applyStateDelta(state, entry.delta, entry); this.validate(state); replayed++;
        }
        await this.commit({ state, deltas: clone(deltas), checkpoints }); this.dirtyFrom = undefined;
        return { state: this.snapshot(), replayed, checkpoint: point ? clone(point) : null };
    }
    async persist() { await this.commit({}); }
    async persistBundle(state, deltas, checkpoints) { await this.commit({ state, deltas, checkpoints }); }
    exportData({ memories = this.memories, spriteState = {} } = {}) {
        return { schemaVersion: this.state.schemaVersion, chatFingerprint: this.chatFingerprint,
            state: this.snapshot(), memories: clone(memories), threads: clone(this.state.threads), timeline: clone(this.state.timeline), spriteState: clone(spriteState) };
    }
    async importData(bundle) {
        if (!bundle || bundle.chatFingerprint !== this.chatFingerprint || !bundle.state) throw new Error('Import does not match current chat');
        const state = migrateState(bundle.state); this.validate(state);
        await this.commit({ state, deltas: [], checkpoints: [createCheckpoint(state, -1, { imported: true, memories: clone(bundle.memories || []) })],
            records: [], decisions: [], pending: [], memories: bundle.memories || [], canonVersion: this.canonVersion + 1 });
        return this.snapshot();
    }
}
