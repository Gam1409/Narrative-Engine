const test = require('node:test');
const assert = require('node:assert/strict');
const { Database } = require('../lib/database');
const { DirectorProvider } = require('../lib/provider');
const { buildRoutes } = require('../lib/routes');

function fixture(t) {
    const db = new Database({ storageRoot: process.cwd(), databasePath: ':memory:' }); t.after(() => db.close());
    const handlers = new Map(), router = { use() {}, get() {}, post(path, fn) { handlers.set(path, fn); } };
    const config = { embeddingUrl: 'http://localhost:8080/v1', embeddingModel: 'test-model', rateLimit: 100, rateWindowMs: 1000, bodyLimitBytes: 512000 };
    const calls = []; const provider = { async embed(texts) { calls.push(texts); return texts.map(t => t.includes('match') ? [1,0] : [0,1]); } };
    buildRoutes(router, { db, config, provider });
    const invoke = async (texts, user = 'alice', tokens = texts) => {
        let output, error;
        await handlers.get('/memory/embeddings')({ body: { chatId: 'ne-a1', texts, tokens }, user: { handle: user } }, { json(value) { output = value; } }, e => { error = e; });
        if (error) throw error; return output;
    };
    return { db, config, calls, invoke, provider };
}

test('Windows SQLite vec/FTS5 ranks, caches hashes, and isolates model and user', async t => {
    const f = fixture(t);
    assert.equal(f.db.vectorAvailable, true); assert.equal(f.db.ftsAvailable, true);
    const result = await f.invoke(['match query', 'match episode', 'unrelated']);
    assert.equal(result.engine, 'sqlite-vec+fts5'); assert.ok(result.scores[1] > result.scores[2]);
    await f.invoke(['match query', 'match episode', 'unrelated']); assert.equal(f.calls.length, 1);
    await f.invoke(['match query', 'changed episode']); assert.deepEqual(f.calls.at(-1), ['changed episode']);
    f.config.embeddingModel = 'new-model'; await f.invoke(['match query']); assert.equal(f.calls.length, 3);
    await f.invoke(['match query'], 'bob'); assert.equal(f.calls.length, 4);
    assert.equal(f.db.db.prepare('SELECT count(*) n FROM embedding_cache').get().n, 6);
    f.provider.embed = async () => { throw new Error('offline'); };
    await assert.doesNotReject(f.invoke(['match query'], 'bob'));
    await assert.rejects(f.invoke(['uncached'], 'bob'), /offline/);
});

test('embedding provider uses configured URL/model and validates count, dimensions and finite numbers', async () => {
    let sent, response = { data: [{ index: 0, embedding: [1,0] }, { index: 1, embedding: [0,1] }] };
    const config = { embeddingUrl: 'http://localhost:8080/v1', embeddingModel: 'fixed', allowHosts: new Set(), timeoutMs: 10 };
    const provider = new DirectorProvider(config, { validateProviderUrl: async url => ({ url: new URL(url), addresses: new Set(['127.0.0.1']) }), requestJson: async (url, _opts, body) => { sent = { url: String(url), body: JSON.parse(body) }; return response; } });
    assert.deepEqual(await provider.embed(['one','two']), [[1,0],[0,1]]);
    assert.equal(sent.url, 'http://localhost:8080/v1/embeddings'); assert.equal(sent.body.model, 'fixed');
    response = { data: [{ index: 0, embedding: [1] }] }; await assert.rejects(provider.embed(['one','two']), /count/);
    response = { data: [{ index: 0, embedding: [NaN] }] }; await assert.rejects(provider.embed(['one']), /Invalid/);
    response = { data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1,0] }] }; await assert.rejects(provider.embed(['one','two']), /dimensions/);
});
