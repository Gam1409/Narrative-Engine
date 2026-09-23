export class RequestGate {
    #epoch = 0;
    #identity = {};
    #controllers = new Set();
    #latest = new Map();
    #sequence = 0;

    switchContext(identity = {}) {
        this.#epoch += 1;
        this.#identity = { ...identity };
        for (const controller of this.#controllers) controller.abort('context changed');
        this.#controllers.clear();
        this.#latest.clear();
        return this.#epoch;
    }

    begin(identity = {}) {
        const controller = new AbortController();
        this.#controllers.add(controller);
        const slot = identity.slot || identity.role || 'default';
        const sequence = ++this.#sequence;
        this.#latest.set(slot, sequence);
        const token = Object.freeze({ ...this.#identity, ...identity, slot, sequence, epoch: this.#epoch, controller, signal: controller.signal });
        return token;
    }

    isCurrent(token) {
        if (!token || token.epoch !== this.#epoch || token.signal?.aborted) return false;
        if (this.#latest.get(token.slot || 'default') !== token.sequence) return false;
        for (const key of ['chatFingerprint', 'sessionId', 'generationId']) {
            if (this.#identity[key] !== undefined && token[key] !== this.#identity[key]) return false;
        }
        return true;
    }

    assertCurrent(token) {
        if (!this.isCurrent(token)) {
            const error = new Error('Stale asynchronous response rejected');
            error.name = 'StaleResponseError';
            throw error;
        }
        return true;
    }

    finish(token) { if (token?.controller) this.#controllers.delete(token.controller); }
    invalidate() { return this.switchContext(this.#identity); }
    issue(identity) { return this.begin(identity); }
    accepts(token) { return this.isCurrent(token); }
    get identity() { return { ...this.#identity }; }
}
