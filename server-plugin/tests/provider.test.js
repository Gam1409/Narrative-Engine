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


const http = require('node:http');
const { requestJson } = require('../lib/provider');
async function localServer(t, handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return server.address().port;
}
test('real hostname transport supports Node all-address lookup and pinned DNS results', async t => {
    const port = await localServer(t, (_req,res) => res.end('{"ok":true}'));
    const controllers = new Set();
    assert.deepEqual(await requestJson(new URL(`http://localhost:${port}`), {autoSelectFamily:true,agent:false}, undefined,
        new Set(['127.0.0.1']), 2000, controllers), {ok:true});
    assert.equal(controllers.size,0);
    await assert.rejects(requestJson(new URL(`http://localhost:${port}`), {autoSelectFamily:true,agent:false}, undefined,
        new Set(['203.0.113.1']), 2000, controllers), /DNS result changed/);
    assert.equal(controllers.size,0);
});
test('mid-response disconnect rejects promptly and frees controllers instead of hanging', {timeout:3000}, async t => {
    const port = await localServer(t, (_req,res) => {
        res.writeHead(200, {'Content-Length':'100'}); res.write('{');
        setTimeout(() => res.destroy(), 10);
    });
    const controllers = new Set();
    await assert.rejects(requestJson(new URL(`http://127.0.0.1:${port}`), {}, undefined,
        new Set(['127.0.0.1']), 1000, controllers), /aborted|closed|reset/i);
    assert.equal(controllers.size,0);
});
test('stalled response timeout rejects and removes its controller', {timeout:3000}, async t => {
    const port = await localServer(t, (_req,res) => {res.writeHead(200);res.write('{');});
    const controllers = new Set();
    await assert.rejects(requestJson(new URL(`http://127.0.0.1:${port}`), {}, undefined,
        new Set(['127.0.0.1']), 50, controllers), /abort|timed out/i);
    assert.equal(controllers.size,0);
});
