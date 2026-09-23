import { ProviderError } from './errors.js';

export function withTimeout(parentSignal, timeoutMs) {
    const controller = new AbortController();
    const abort = () => controller.abort(parentSignal?.reason || new DOMException('Aborted', 'AbortError'));
    parentSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Director request timed out', 'TimeoutError')), timeoutMs);
    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timer);
            parentSignal?.removeEventListener('abort', abort);
        },
    };
}

export async function fetchJson(url, options, { timeoutMs, signal } = {}) {
    const timeout = withTimeout(signal, timeoutMs || 30000);
    try {
        const response = await fetch(url, { ...options, signal: timeout.signal });
        const text = await response.text();
        let body = null;
        try {
            body = text ? JSON.parse(text) : {};
        } catch {
            throw new ProviderError(`Director returned non-JSON data (HTTP ${response.status}).`, {
                code: 'INVALID_HTTP_JSON', status: response.status,
            });
        }
        if (!response.ok) {
            throw new ProviderError(`Director request failed (HTTP ${response.status}).`, {
                code: 'HTTP_ERROR', status: response.status, retryable: response.status >= 500,
            });
        }
        return body;
    } catch (error) {
        if (error instanceof ProviderError) throw error;
        const timeoutLike = error?.name === 'TimeoutError' || (error?.name === 'AbortError' && !signal?.aborted);
        throw new ProviderError(timeoutLike ? 'Director request timed out.' : 'Director endpoint is unreachable.', {
            code: timeoutLike ? 'TIMEOUT' : 'NETWORK_ERROR', retryable: true, cause: error,
        });
    } finally {
        timeout.dispose();
    }
}

export function normalizeOpenAiBase(endpoint) {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) throw new ProviderError('Director endpoint must use HTTP or HTTPS.');
    url.hash = '';
    url.search = '';
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/v1') ? path : `${path}/v1`;
    return url.toString().replace(/\/$/, '');
}
