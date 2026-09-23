import { applyStateDelta, createInitialState } from './model.js';
import { createCheckpoint, nearestCheckpoint } from './checkpoints.js';
import { migrateState } from './migrations.js';
import { clone } from '../utils/object.js';
import { MemoryStorageAdapter } from '../memory/storage.js';

export class StateManager {
    constructor({ chatFingerprint = 'default', storage = new MemoryStorageAdapter(), validator, checkpointEvery = 10 } = {}) {
        this.chatFingerprint = chatFingerprint;
        this.storage = storage;
        this.validator = validator;
        this.checkpointEvery = Math.max(1, Number(checkpointEvery) || 10);
        this.state = createInitialState();
        this.deltas = [];
        this.checkpoints = [];
        this.dirty = false;
    }

    get prefix() { return `narrative-engine:${this.chatFingerprint}`; }

    async load() {
        const bundle = await this.storage.getItem(`${this.prefix}:bundle`);
        if (bundle) {
            this.state = migrateState(bundle.state || createInitialState());
            this.deltas = bundle.deltas || [];
            this.checkpoints = bundle.checkpoints || [];
            return this.snapshot();
        }
        const [state, deltas, checkpoints] = await Promise.all([
            this.storage.getItem(`${this.prefix}:state`),
            this.storage.getItem(`${this.prefix}:deltas`),
            this.storage.getItem(`${this.prefix}:checkpoints`),
        ]);
        this.state = migrateState(state || createInitialState());
        this.deltas = deltas || [];
        this.checkpoints = checkpoints || [];
        return this.snapshot();
    }

    snapshot() { return clone(this.state); }

    async applyDelta(delta, metadata = {}) {
        const before = this.state;
        const candidate = applyStateDelta(before, delta, metadata);
        const validation = this.validator?.(candidate);
        if (validation === false || validation?.valid === false) {
            const error = new Error('State transaction failed validation');
            error.validationErrors = validation?.errors || [];
            throw error;
        }
        const entry = {
            messageIndex: Number.isInteger(metadata.messageIndex) ? metadata.messageIndex : this.deltas.length,
            delta: clone(delta),
            source: metadata.source || 'director',
            confidence: metadata.confidence ?? 1,
            at: metadata.at || new Date().toISOString(),
        };
        // Commit only after every fallible operation above succeeds.
        const nextDeltas = [...this.deltas, entry];
        const nextCheckpoints = (entry.messageIndex + 1) % this.checkpointEvery === 0
            ? [...this.checkpoints.filter((item) => item.messageIndex !== entry.messageIndex), createCheckpoint(candidate, entry.messageIndex)]
            : this.checkpoints;
        // Persist a single bundle before changing live state. A failed write
        // therefore leaves the complete transaction rolled back.
        await this.persistBundle(candidate, nextDeltas, nextCheckpoints);
        this.state = candidate;
        this.deltas = nextDeltas;
        this.checkpoints = nextCheckpoints;
        this.dirty = false;
        return this.snapshot();
    }

    checkpoint(messageIndex = this.deltas.at(-1)?.messageIndex ?? -1) {
        const point = createCheckpoint(this.state, messageIndex);
        this.checkpoints = [...this.checkpoints.filter((item) => item.messageIndex !== messageIndex), point];
        return clone(point);
    }

    async restoreCheckpoint(messageIndex = Infinity) {
        const point = nearestCheckpoint(this.checkpoints, messageIndex);
        if (!point) throw new Error('No checkpoint available');
        const restored = migrateState(point.state);
        await this.persistBundle(restored, this.deltas, this.checkpoints);
        this.state = restored;
        this.dirty = false;
        return this.snapshot();
    }

    markDirty(fromMessageIndex = 0) {
        this.dirty = true;
        this.dirtyFrom = Math.max(0, Number(fromMessageIndex) || 0);
    }

    /** Replays accepted per-message deltas, optionally replacing the history. */
    async rebuild({ throughMessageIndex = Infinity, deltas = this.deltas } = {}) {
        const ordered = [...deltas]
            .filter((entry) => entry.messageIndex <= throughMessageIndex)
            .sort((a, b) => a.messageIndex - b.messageIndex);
        // A checkpoint at/after an edited message is stale; otherwise start at
        // the newest checkpoint and replay only its tail.
        const checkpointCeiling = this.dirty
            ? Math.min(throughMessageIndex, (this.dirtyFrom ?? 0) - 1)
            : throughMessageIndex;
        const point = nearestCheckpoint(this.checkpoints, checkpointCeiling);
        let rebuilt = point ? migrateState(point.state) : createInitialState();
        const replayed = [];
        for (const entry of ordered) {
            if (point && entry.messageIndex <= point.messageIndex) continue;
            rebuilt = applyStateDelta(rebuilt, entry.delta, entry);
            const validation = this.validator?.(rebuilt);
            if (validation === false || validation?.valid === false) throw new Error(`Invalid replay delta at message ${entry.messageIndex}`);
            replayed.push(clone(entry));
        }
        const nextDeltas = clone(deltas);
        await this.persistBundle(rebuilt, nextDeltas, this.checkpoints);
        this.state = rebuilt;
        this.deltas = nextDeltas;
        this.dirty = false;
        this.dirtyFrom = undefined;
        return { state: this.snapshot(), replayed: replayed.length, checkpoint: point ? clone(point) : null };
    }

    async persist() {
        return this.persistBundle(this.state, this.deltas, this.checkpoints);
    }

    async persistBundle(state, deltas, checkpoints) {
        return this.storage.setItem(`${this.prefix}:bundle`, { state, deltas, checkpoints });
    }

    exportData({ memories = [], spriteState = {} } = {}) {
        return {
            schemaVersion: this.state.schemaVersion,
            chatFingerprint: this.chatFingerprint,
            state: this.snapshot(),
            memories: clone(memories),
            threads: clone(this.state.threads),
            timeline: clone(this.state.timeline),
            spriteState: clone(spriteState),
        };
    }

    async importData(bundle) {
        if (!bundle || bundle.chatFingerprint !== this.chatFingerprint || !bundle.state) throw new Error('Import does not match current chat');
        const candidate = migrateState(bundle.state);
        const validation = this.validator?.(candidate);
        if (validation === false || validation?.valid === false) throw new Error('Imported state failed validation');
        const checkpoints = [createCheckpoint(candidate, -1, { imported: true })];
        await this.persistBundle(candidate, [], checkpoints);
        this.state = candidate;
        this.deltas = [];
        this.checkpoints = checkpoints;
        this.dirty = false;
        return this.snapshot();
    }
}
