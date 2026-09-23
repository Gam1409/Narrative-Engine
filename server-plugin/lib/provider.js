'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { validateProviderUrl } = require('./security');

function completionUrl(base) {
    const url = new URL(base.toString());
    url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
    url.search = '';
    return url;
}

function requestJson(url, options, body, allowedAddresses, timeoutMs, controllers) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        controllers.add(controller);
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request(url, {
            ...options,
            signal: controller.signal,
            lookup(hostname, lookupOptions, callback) {
                require('node:dns').lookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
                    if (error) return callback(error);
                    const match = addresses.find((item) => allowedAddresses.has(item.address));
                    if (!match) return callback(new Error('Director DNS result changed after validation'));
                    callback(null, match.address, match.family);
                });
            },
        }, (response) => {
            const chunks = [];
            let total = 0;
            response.on('data', (chunk) => {
                total += chunk.length;
                if (total > 2 * 1024 * 1024) controller.abort(new Error('Director response is too large'));
                else chunks.push(chunk);
            });
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                if (response.statusCode < 200 || response.statusCode >= 300) return reject(Object.assign(new Error(`Director returned HTTP ${response.statusCode}`), { retryable: response.statusCode >= 500 }));
                try { resolve(JSON.parse(text)); } catch { reject(new Error('Director returned invalid JSON')); }
            });
        });
        const timer = setTimeout(() => controller.abort(new Error('Director request timed out')), timeoutMs);
        timer.unref?.();
        req.on('error', reject);
        req.on('close', () => { clearTimeout(timer); controllers.delete(controller); });
        req.end(body);
    });
}

class DirectorProvider {
    constructor(config, dependencies = {}) {
        this.config = config;
        this.validate = dependencies.validateProviderUrl || validateProviderUrl;
        this.request = dependencies.requestJson || requestJson;
        this.controllers = new Set();
    }

    async complete({ messages, temperature = 0.2, maxTokens = 2000 }) {
        if (!this.config.providerUrl || !this.config.providerModel) throw Object.assign(new Error('Director provider is not configured'), { status: 503 });
        if (!Array.isArray(messages) || !messages.length || messages.length > 64) throw Object.assign(new Error('messages must be a non-empty array'), { status: 400 });
        const validated = await this.validate(this.config.providerUrl, this.config.allowHosts);
        const url = completionUrl(validated.url);
        const body = JSON.stringify({ model: this.config.providerModel, messages, temperature, max_tokens: maxTokens, stream: false });
        let lastError;
        for (let attempt = 0; attempt <= this.config.retries; attempt += 1) {
            try {
                return await this.request(url, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'content-length': Buffer.byteLength(body),
                        ...(this.config.providerKey ? { authorization: `Bearer ${this.config.providerKey}` } : {}),
                    },
                }, body, validated.addresses, this.config.timeoutMs, this.controllers);
            } catch (error) {
                lastError = error;
                if (attempt >= this.config.retries || error.retryable === false) break;
                await new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** attempt, 1000)));
            }
        }
        throw lastError;
    }

    async healthCheck() {
        if (!this.config.providerUrl || !this.config.providerModel) return { ok: false, configured: false };
        try { await this.validate(this.config.providerUrl, this.config.allowHosts); return { ok: true, configured: true }; }
        catch (error) { return { ok: false, configured: true, error: error.message }; }
    }

    close() { for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
}

module.exports = { DirectorProvider, completionUrl, requestJson };
