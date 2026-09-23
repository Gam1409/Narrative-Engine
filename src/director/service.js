import { loadPrompt } from './promptLoader.js';
import { loadSchema } from './schemaLoader.js';
import { parseAndValidateJson } from '../utils/json.js';

export class DirectorService {
    constructor(provider, diagnostics) {
        this.provider = provider;
        this.diagnostics = diagnostics;
    }

    async run(role, payload, { identity, signal, timeoutMs, maxTokens = 4096 } = {}) {
        const system = await loadPrompt(role);
        const schema = await loadSchema(role);
        const request = {
            role,
            identity,
            signal,
            timeoutMs,
            maxTokens,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: JSON.stringify(payload) },
            ],
        };
        const started = performance.now();
        try {
            const first = await this.provider.complete(request);
            return await parseAndValidateJson(first.content, schema, async ({ invalidOutput, error }) => {
                if (signal?.aborted) throw signal.reason;
                const retry = await this.provider.complete({
                    ...request,
                    messages: [
                        { role: 'system', content: `${system}\n\nThe prior output was invalid. Return JSON only, with every required field.` },
                        { role: 'user', content: JSON.stringify({ input: payload, invalid_output: String(invalidOutput).slice(0, 12000), validation_error: error }) },
                    ],
                });
                return retry.content;
            });
        } finally {
            this.diagnostics?.recordLatency?.(role, Math.round(performance.now() - started));
        }
    }

}
