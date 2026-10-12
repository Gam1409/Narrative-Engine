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
        this.samples = { pre: [], post: [], reconcile: [] };
        this.responses = {};
        this.postAttempts = 0;
        this.strictAttempts = 0;
        this.strictRewrites = 0;
        this.usage = { calls: 0, reportedTokens: 0, callsWithoutUsage: 0, jsonRepairs: 0 };
    }

    update(patch) {
        Object.assign(this, patch);
        this.emit();
    }

    recordUsage(usage) {
        this.usage.calls++;
        const total = usage?.total_tokens ?? (usage && (usage.prompt_tokens ?? usage.input_tokens) !== undefined
            ? Number(usage.prompt_tokens ?? usage.input_tokens) + Number(usage.completion_tokens ?? usage.output_tokens ?? 0) : null);
        if (Number.isFinite(total)) this.usage.reportedTokens += total;
        else this.usage.callsWithoutUsage++;
    }

    recordResponse(role, {valid}) {
        const value=this.responses[role] ||= {total:0, invalid:0};
        value.total++; if(!valid)value.invalid++;
    }

    recordPostAttempt(strict) { this.postAttempts++; if(strict)this.strictAttempts++; }
    recordStrictRewrite() { this.strictRewrites++; }

    recordRepair() { this.usage.jsonRepairs++; }

    recordLatency(role, value) {
        this.samples[role] = [...(this.samples[role] || []).slice(-499), value];
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
            retrievalMode: this.retrievalMode || 'not_run', embeddingError: this.embeddingError || null,
            quality: {
                scope: 'extension lifetime; POST processing attempts include reconciliation retries',
                responses: Object.fromEntries(Object.entries(this.responses).map(([role,v])=>[role,{...v,invalidRate:v.total?v.invalid/v.total:null}])),
                postAttempts:this.postAttempts, strictAttempts:this.strictAttempts, strictRewrites:this.strictRewrites,
                strictRewriteRate:this.strictAttempts?this.strictRewrites/this.strictAttempts:null,
            },
            errors: [...this.errors], usage: { ...this.usage },
            latencyStats: Object.fromEntries(Object.entries(this.samples).map(([role, samples]) => {
                const sorted = [...samples].sort((a,b) => a-b);
                const percentile = p => sorted.length ? sorted[Math.ceil(sorted.length*p)-1] : null;
                return [role, { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95) }];
            })),
        };
    }
}
