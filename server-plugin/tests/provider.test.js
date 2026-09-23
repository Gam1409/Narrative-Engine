'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DirectorProvider, completionUrl } = require('../lib/provider');

const config = {
    providerUrl: 'http://127.0.0.1:8080/v1', providerModel: 'director', providerKey: 'secret',
    allowHosts: new Set(), retries: 1, timeoutMs: 1000,
};

test('completion URL is fixed beneath configured endpoint', () => {
    assert.equal(completionUrl(new URL(config.providerUrl)).toString(), 'http://127.0.0.1:8080/v1/chat/completions');
});

test('provider uses fixed model, retries, and never accepts request URL', async () => {
    let calls = 0;
    const provider = new DirectorProvider(config, {
        validateProviderUrl: async (url) => ({ url: new URL(url), addresses: new Set(['127.0.0.1']) }),
        requestJson: async (_url, _options, body) => {
            calls += 1;
            if (calls === 1) throw new Error('temporary');
            const parsed = JSON.parse(body);
            assert.equal(parsed.model, 'director');
            return { choices: [{ message: { content: '{}' } }] };
        },
    });
    const result = await provider.complete({ messages: [{ role: 'user', content: 'test' }], url: 'http://evil.test' });
    assert.equal(calls, 2);
    assert.equal(result.choices.length, 1);
});

test('unconfigured provider reports offline without throwing', async () => {
    const provider = new DirectorProvider({ ...config, providerUrl: '', providerModel: '' });
    assert.deepEqual(await provider.healthCheck(), { ok: false, configured: false });
    await assert.rejects(provider.complete({ messages: [{ role: 'user', content: 'x' }] }), /not configured/);
});
