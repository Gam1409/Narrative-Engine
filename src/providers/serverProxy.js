import { fetchJson } from './http.js';

export class ServerProxyProvider {
    constructor(settings, context) {
        this.settings = settings;
        this.context = context;
    }

    async complete(request) {
        const role = request.role || 'pre';
        const body = await fetchJson(`/api/plugins/narrative-engine/director/${role}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(this.context.getRequestHeaders?.() || {}) },
            body: JSON.stringify({
                identity: request.identity,
                messages: request.messages,
                maxTokens: request.maxTokens,
                temperature: this.settings.temperature,
            }),
        }, { timeoutMs: request.timeoutMs, signal: request.signal });
        return { content: typeof body.output === 'string' ? body.output : JSON.stringify(body.output), usage: body.usage || null, model: body.model || 'server-proxy' };
    }

    async healthCheck(signal) {
        const started = performance.now();
        const body = await fetchJson('/api/plugins/narrative-engine/health', {
            method: 'GET', headers: this.context.getRequestHeaders?.() || {},
        }, { timeoutMs: this.settings.healthTimeoutMs, signal });
        return { ok: body.ok === true || body.status === 'ok' || body.status === 'degraded', latencyMs: Math.round(performance.now() - started), details: body };
    }
}
