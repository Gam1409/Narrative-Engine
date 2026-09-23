import { fetchJson, normalizeOpenAiBase } from './http.js';
import { ProviderError } from './errors.js';

export class OpenAiCompatibleProvider {
    constructor(settings, context) {
        this.settings = settings;
        this.context = context;
        this.baseUrl = normalizeOpenAiBase(settings.endpoint);
    }

    async complete(request) {
        if (!this.settings.model) throw new ProviderError('Select a Director model first.', { code: 'MODEL_REQUIRED' });
        const body = await fetchJson(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.settings.model,
                messages: request.messages,
                temperature: this.settings.temperature,
                max_tokens: request.maxTokens || 4096,
                stream: false,
                response_format: { type: 'json_object' },
            }),
        }, { timeoutMs: request.timeoutMs, signal: request.signal });
        const content = body?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new ProviderError('Director response has no message content.', { code: 'EMPTY_RESPONSE' });
        return { content, usage: body.usage || null, model: body.model || this.settings.model };
    }

    async healthCheck(signal) {
        const started = performance.now();
        const body = await fetchJson(`${this.baseUrl}/models`, { method: 'GET' }, {
            timeoutMs: this.settings.healthTimeoutMs, signal,
        });
        return { ok: Array.isArray(body?.data), latencyMs: Math.round(performance.now() - started) };
    }
}
