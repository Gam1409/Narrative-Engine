export class Diagnostics {
    constructor() {
        this.status = 'disabled';
        this.provider = 'unknown';
        this.latency = { pre: null, post: null, reconcile: null };
        this.lastPacket = '';
        this.lastAudit = null;
        this.lastSprites = {};
        this.retrievedMemories = [];
        this.errors = [];
        this.listeners = new Set();
    }

    update(patch) {
        Object.assign(this, patch);
        this.emit();
    }

    recordLatency(role, value) {
        this.latency = { ...this.latency, [role]: value };
        this.emit();
    }

    error(error, phase = 'runtime') {
        const message = String(error?.message || error).replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 500);
        this.errors = [...this.errors.slice(-19), { phase, message, at: new Date().toISOString() }];
        this.emit();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.snapshot());
        return () => this.listeners.delete(listener);
    }

    emit() {
        const snapshot = this.snapshot();
        for (const listener of this.listeners) listener(snapshot);
    }

    snapshot() {
        return {
            status: this.status, provider: this.provider, latency: { ...this.latency },
            lastPacket: this.lastPacket, lastAudit: this.lastAudit,
            lastSprites: { ...this.lastSprites }, retrievedMemories: [...this.retrievedMemories],
            errors: [...this.errors],
        };
    }
}
