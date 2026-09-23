export class ProviderError extends Error {
    constructor(message, { code = 'PROVIDER_ERROR', status = 0, retryable = false, cause } = {}) {
        super(message, { cause });
        this.name = 'ProviderError';
        this.code = code;
        this.status = status;
        this.retryable = retryable;
    }
}

export function safeError(error) {
    const text = error instanceof Error ? error.message : String(error);
    return text
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
        .slice(0, 500);
}
