'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoutes, scopeChatId } = require('../lib/routes');

test('chat storage identifiers are isolated by authenticated user', () => {
    const a = scopeChatId({ user: { profile: { handle: 'alice' } } }, 'chat-1');
    const b = scopeChatId({ user: { profile: { handle: 'bob' } } }, 'chat-1');
    assert.notEqual(a, b);
    assert.match(a, /^[a-f0-9]{16}:chat-1$/);
});

test('all required server routes are registered', () => {
    const registered = [];
    const router = {
        use(handler) { registered.push(['USE', typeof handler]); },
        get(path) { registered.push(['GET', path]); },
        post(path) { registered.push(['POST', path]); },
    };
    buildRoutes(router, {
        config: { rateLimit: 10, rateWindowMs: 1000, bodyLimitBytes: 10000 },
        db: {}, provider: {}, logger: { warn() {}, error() {} },
    });
    const routes = registered.filter(([method]) => method !== 'USE').map(([method, path]) => `${method} ${path}`);
    assert.deepEqual(routes, [
        'GET /health',
        'POST /director/pre', 'POST /director/post', 'POST /director/reconcile',
        'POST /memory/search', 'POST /memory/consolidate',
        'GET /state/:chatId', 'POST /state/:chatId', 'POST /state/:chatId/rebuild',
        'POST /sprites/select',
    ]);
});
