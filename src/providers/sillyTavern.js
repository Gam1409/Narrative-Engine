import { ProviderError } from './errors.js';
import { withTimeout } from './http.js';

export class SillyTavernProvider {
    constructor(settings, context) {
        this.settings = settings;
        this.context = context;
    }

    async complete(request) {
        if (typeof this.context.generateRaw !== 'function') {
            throw new ProviderError('The current SillyTavern connection cannot run background Director prompts.', { code: 'UNSUPPORTED' });
        }
        const timeout = withTimeout(request.signal, request.timeoutMs);
        const prompt = request.messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n');
        try {
            const generated = this.context.generateRaw({ prompt, quietToLoud: false, signal: timeout.signal });
            const content = await Promise.race([
                generated,
                new Promise((_, reject) => timeout.signal.addEventListener('abort', () => reject(timeout.signal.reason), { once: true })),
            ]);
            if (typeof content !== 'string') throw new ProviderError('SillyTavern Director response is empty.', { code: 'EMPTY_RESPONSE' });
            return { content, usage: null, model: 'current-sillytavern-connection' };
        } finally {
            timeout.dispose();
        }
    }

    async healthCheck() {
        return { ok: typeof this.context.generateRaw === 'function', latencyMs: 0 };
    }
}
