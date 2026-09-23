import { fetchJson } from './http.js';
import { ProviderError } from './errors.js';

function base(endpoint) {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) throw new ProviderError('Ollama endpoint must use HTTP or HTTPS.');
    url.pathname = url.pathname.replace(/\/(?:v1)?\/?$/, '');
    return url.toString().replace(/\/$/, '');
}

export class OllamaProvider {
    constructor(settings) {
        this.settings = settings;
        this.baseUrl = base(settings.endpoint);
    }

    async complete(request) {
        if (!this.settings.model) throw new ProviderError('Select an Ollama Director model first.', { code: 'MODEL_REQUIRED' });
        const body = await fetchJson(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.settings.model,
                messages: request.messages,
                stream: false,
                format: 'json',
                options: { temperature: this.settings.temperature, num_predict: request.maxTokens || 4096 },
            }),
        }, { timeoutMs: request.timeoutMs, signal: request.signal });
        const content = body?.message?.content;
        if (typeof content !== 'string') throw new ProviderError('Ollama response has no message content.', { code: 'EMPTY_RESPONSE' });
        return { content, usage: null, model: body.model || this.settings.model };
    }

    async healthCheck(signal) {
        const started = performance.now();
        const body = await fetchJson(`${this.baseUrl}/api/tags`, { method: 'GET' }, {
            timeoutMs: this.settings.healthTimeoutMs, signal,
        });
        return { ok: Array.isArray(body?.models), latencyMs: Math.round(performance.now() - started) };
    }
}
