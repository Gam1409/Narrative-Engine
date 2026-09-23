'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROMPTS, buildRoutes, directorMessages, scopeChatId } = require('../lib/routes');

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

test('Director messages preserve conversation and merge client system context after fixed policy', () => {
    const messages = directorMessages('pre', { messages: [
        { role: 'system', content: 'Return the scene fields required by this chat.' },
        { role: 'user', content: 'The player opens the door.' },
        { role: 'assistant', content: 'The door opens.' },
    ] }, 10000);
    assert.equal(messages.length, 3);
    assert.equal(messages[0].role, 'system');
    assert.ok(messages[0].content.startsWith(PROMPTS.pre));
    assert.match(messages[0].content, /CLIENT SYSTEM CONTEXT/);
    assert.match(messages[0].content, /scene fields required/);
    assert.deepEqual(messages.slice(1), [
        { role: 'user', content: 'The player opens the door.' },
        { role: 'assistant', content: 'The door opens.' },
    ]);
});

test('Director messages keep input and payload compatibility', () => {
    const fromInput = directorMessages('post', { input: { state: 'before' } }, 10000);
    const fromPayload = directorMessages('reconcile', { payload: { accepted: true } }, 10000);
    assert.equal(fromInput[0].content, PROMPTS.post);
    assert.deepEqual(JSON.parse(fromInput[1].content), { state: 'before' });
    assert.equal(fromPayload[0].content, PROMPTS.reconcile);
    assert.deepEqual(JSON.parse(fromPayload[1].content), { accepted: true });
});

test('Director messages reject unsafe shapes, roles, and oversized content', () => {
    assert.throws(() => directorMessages('pre', { messages: [] }, 100), /non-empty array/);
    assert.throws(() => directorMessages('pre', { messages: [{ role: 'tool', content: 'x' }] }, 100), /supported role/);
    assert.throws(() => directorMessages('pre', { messages: [{ role: 'system', content: 'only system' }] }, 100), /user or assistant/);
    assert.throws(() => directorMessages('pre', { messages: [{ role: 'user', content: 'x'.repeat(101) }] }, 100), /too large/);
    assert.throws(() => directorMessages('pre', { messages: [{ role: 'user', content: { text: 'no' } }] }, 100), /string content/);
});
