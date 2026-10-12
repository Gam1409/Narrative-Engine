'use strict';

const crypto = require('node:crypto');
const { assertObject, rateLimiter, safeJson, validateId } = require('./security');
const { consolidateMemories, mergeState, searchMemories, selectSprite } = require('./services');

const PROMPTS = {
    pre: 'You are the Narrative Engine Director PRE pass. Return strict JSON only. Preserve user agency and canon. Produce compact continuity, relevant memory, active threads, world pressure, and direction.',
    post: 'You are the Narrative Engine Director POST pass. Return strict JSON only. Audit continuity and user agency, then produce state_delta, relationship_delta, knowledge_delta, thread_delta, world_event_delta, memory_candidates, and sprite_decisions.',
    reconcile: 'You are the Narrative Engine reconciliation pass. Return strict JSON only. Reconcile supplied accepted chat facts with structured state using explicit chat facts as highest priority.',
};

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res)).catch(next); }

function directorMessages(phase, body, maxBytes) {
    const fixedPrompt = PROMPTS[phase];
    if (body.messages === undefined) {
        const content = body.input ?? body.payload ?? body;
        return [{ role: 'system', content: fixedPrompt }, { role: 'user', content: safeJson(content, maxBytes) }];
    }
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 64) {
        throw Object.assign(new Error('messages must be a non-empty array of at most 64 items'), { status: 400 });
    }
    const allowedRoles = new Set(['system', 'user', 'assistant']);
    const clientSystem = [];
    const conversation = [];
    let contentBytes = 0;
    for (const message of body.messages) {
        if (!message || typeof message !== 'object' || Array.isArray(message) || !allowedRoles.has(message.role)) {
            throw Object.assign(new Error('Each message must have a supported role'), { status: 400 });
        }
        if (typeof message.content !== 'string' || message.content.length < 1) {
            throw Object.assign(new Error('Each message must have non-empty string content'), { status: 400 });
        }
        contentBytes += Buffer.byteLength(message.content);
        if (contentBytes > maxBytes) throw Object.assign(new Error('Message content is too large'), { status: 413 });
        if (message.role === 'system') clientSystem.push(message.content);
        else conversation.push({ role: message.role, content: message.content });
    }
    if (!conversation.length) throw Object.assign(new Error('messages must include a user or assistant message'), { status: 400 });
    const combinedSystem = clientSystem.length
        ? `${fixedPrompt}\n\n[CLIENT SYSTEM CONTEXT]\n${clientSystem.join('\n\n')}`
        : fixedPrompt;
    return [{ role: 'system', content: combinedSystem }, ...conversation];
}

function scopeChatId(req, rawId) {
    const id = validateId(rawId, 'chatId');
    const handle = String(req.user?.profile?.handle || req.user?.handle || 'default');
    const scope = crypto.createHash('sha256').update(handle).digest('hex').slice(0, 16);
    return `${scope}:${id}`;
}

function buildRoutes(router, { config, db, provider, logger = console }) {
    router.use(rateLimiter({ limit: config.rateLimit, windowMs: config.rateWindowMs }));
    router.use((req, res, next) => {
        const length = Number(req.headers['content-length'] || 0);
        if (length > config.bodyLimitBytes) return res.status(413).json({ error: 'Request body is too large' });
        try { if (req.body !== undefined) safeJson(req.body, config.bodyLimitBytes); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
        return next();
    });

    router.get('/health', asyncRoute(async (_req, res) => res.json({ ok: true, schemaVersion: 2, provider: await provider.healthCheck() })));

    for (const phase of ['pre', 'post', 'reconcile']) {
        router.post(`/director/${phase}`, asyncRoute(async (req, res) => {
            const body = assertObject(req.body);
            const started = Date.now();
            try {
                const messages = directorMessages(phase, body, config.bodyLimitBytes);
                const result = await provider.complete({ messages, maxTokens: phase === 'pre' ? 2000 : 2500 });
                const output = result?.choices?.[0]?.message?.content;
                if (typeof output !== 'string') throw Object.assign(new Error('Director response has no message content'), { status: 502 });
                res.json({ output, usage: result.usage || null, model: result.model || config.providerModel });
            } catch (error) {
                logger.warn?.(`[narrative-engine] Director ${phase} failed: ${error.message}`);
                error.status ||= 502;
                throw error;
            } finally {
                void started;
            }
        }));
    }

    router.post('/memory/embeddings', asyncRoute(async (req, res) => {
        const body = assertObject(req.body), scope = scopeChatId(req, body.chatId);
        if (!Array.isArray(body.texts) || !body.texts.length || body.texts.length > 64 || body.texts.some(t => typeof t !== 'string' || !t || t.length > 20000)) throw Object.assign(new Error('Invalid texts'), { status: 400 });
        const model = `${config.embeddingUrl}|${config.embeddingModel}`;
        if (!config.embeddingUrl || !config.embeddingModel) throw Object.assign(new Error('Embeddings not configured'), { status: 503 });
        const hashes = body.texts.map(t => crypto.createHash('sha256').update(t).digest('hex'));
        const cached = hashes.map(hash => db.db.prepare('SELECT vector_json,vector_blob FROM embedding_cache WHERE scope=? AND hash=? AND model=?').get(scope, hash, model));
        const missing = [...new Set(hashes.filter((_, i) => !cached[i]))];
        const fresh = missing.length ? await provider.embed(missing.map(hash => body.texts[hashes.indexOf(hash)])) : [];
        db.db.transaction(() => {
            const put = db.db.prepare('INSERT INTO embedding_cache(scope,hash,model,vector_json,vector_blob) VALUES (?,?,?,?,?) ON CONFLICT(scope,hash,model) DO NOTHING');
            missing.forEach((hash, i) => put.run(scope, hash, model, JSON.stringify(fresh[i]), Buffer.from(new Float32Array(fresh[i]).buffer)));
        })();
        const vectors = hashes.map((hash, i) => cached[i] ? JSON.parse(cached[i].vector_json) : fresh[missing.indexOf(hash)]);
        hashes.forEach((hash, i) => { if (cached[i] && !cached[i].vector_blob) db.db.prepare('UPDATE embedding_cache SET vector_blob=? WHERE scope=? AND hash=? AND model=?').run(Buffer.from(new Float32Array(vectors[i]).buffer), scope, hash, model); });
        let scores;
        if (db.vectorAvailable) {
            const placeholders = hashes.map(() => '?').join(',');
            const rows = db.db.prepare(`SELECT hash, 1-vec_distance_cosine(vector_blob, ?) AS similarity FROM embedding_cache WHERE scope=? AND model=? AND hash IN (${placeholders})`)
                .all(Buffer.from(new Float32Array(vectors[0]).buffer), scope, model, ...hashes);
            const byHash = new Map(rows.map(row => [row.hash, row.similarity]));
            scores = hashes.map(hash => byHash.get(hash));
        }
        // FTS sees only the caller's eligible candidate texts; quoting prevents MATCH syntax injection.
        if (db.ftsAvailable && Array.isArray(body.tokens) && body.tokens.length === hashes.length && body.tokens.every(t => typeof t === 'string' && t.length <= 20000)) {
            db.db.transaction(() => {
                const remove = db.db.prepare('DELETE FROM embedding_fts WHERE cache_key=?');
                const put = db.db.prepare('INSERT INTO embedding_fts(cache_key,text) VALUES (?,?)');
                hashes.forEach((hash, i) => { const key = `${scope}:${model}:${hash}`; remove.run(key); put.run(key, body.tokens[i]); });
            })();
            const terms = body.tokens[0].match(/[\p{L}\p{N}_-]+/gu) || [];
            if (terms.length && scores) {
                const match = terms.slice(0,64).map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ');
                const keys = hashes.map(hash => `${scope}:${model}:${hash}`);
                const rows = db.db.prepare(`SELECT cache_key FROM embedding_fts WHERE embedding_fts MATCH ? AND cache_key IN (${keys.map(() => '?').join(',')})`).all(match, ...keys);
                const hits = new Set(rows.map(row => row.cache_key));
                scores = scores.map((score, i) => 0.85 * score + 0.15 * (hits.has(keys[i]) ? 1 : 0));
            }
        }
        res.json({ model: crypto.createHash('sha256').update(model).digest('hex'), hashes, vectors: scores ? undefined : vectors, scores,
            engine: db.vectorAvailable ? (db.ftsAvailable ? 'sqlite-vec+fts5' : 'sqlite-vec') : 'portable-cosine' });
    }));
    router.post('/memory/search', asyncRoute(async (req, res) => {
        const body = assertObject(req.body); const chatId = scopeChatId(req, body.chatId);
        if (typeof body.query !== 'string' || body.query.length > 10000) throw Object.assign(new Error('Invalid query'), { status: 400 });
        res.json({ memories: searchMemories(db, chatId, body.query, body.topK) });
    }));
    router.post('/memory/consolidate', asyncRoute(async (req, res) => {
        const body = assertObject(req.body); const chatId = scopeChatId(req, body.chatId);
        res.json({ saved: consolidateMemories(db, chatId, body.memories) });
    }));
    router.get('/storage/:chatId/:field', asyncRoute(async (req, res) => {
        res.json(db.readField(scopeChatId(req, req.params.chatId), validateId(req.params.field, 'field')));
    }));
    router.post('/storage/:chatId/:field', asyncRoute(async (req, res) => {
        const body = assertObject(req.body);
        if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || !Object.hasOwn(body, 'value')) throw Object.assign(new Error('Expected revision and value required'), { status: 400 });
        res.json(db.writeField(scopeChatId(req, req.params.chatId), validateId(req.params.field, 'field'), body.value, body.expectedRevision));
    }));
    router.get('/storage/:chatId', asyncRoute(async (req, res) => {
        res.json({ fields: db.listFields(scopeChatId(req, req.params.chatId)) });
    }));

    router.get('/state/:chatId', asyncRoute(async (req, res) => res.json({ state: db.getState(scopeChatId(req, req.params.chatId)) })));
    router.post('/state/:chatId', asyncRoute(async (req, res) => {
        const chatId = scopeChatId(req, req.params.chatId); const body = assertObject(req.body);
        const state = body.delta ? mergeState(db.getState(chatId) || {}, assertObject(body.delta, 'delta')) : assertObject(body.state, 'state');
        if (body.delta) db.addDelta(chatId, body.delta, body.messageId ? validateId(body.messageId, 'messageId') : null);
        db.saveState(chatId, state, body.messageId ? validateId(body.messageId, 'messageId') : null);
        res.json({ ok: true, state });
    }));
    router.post('/state/:chatId/rebuild', asyncRoute(async (req, res) => {
        const chatId = scopeChatId(req, req.params.chatId); const body = assertObject(req.body || {});
        let state = body.baseState ? assertObject(body.baseState, 'baseState') : {};
        const deltas = Array.isArray(body.deltas) ? body.deltas : db.getDeltas(chatId);
        if (deltas.length > 10000) throw Object.assign(new Error('Too many deltas'), { status: 400 });
        for (const delta of deltas) state = mergeState(state, assertObject(delta, 'delta'));
        db.saveState(chatId, state); res.json({ ok: true, state, applied: deltas.length });
    }));
    router.post('/sprites/select', asyncRoute(async (req, res) => res.json(selectSprite(assertObject(req.body)))));

    router.use((error, _req, res, _next) => {
        const status = Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) logger.error?.(`[narrative-engine] Request failed: ${error.message}`);
        res.status(status).json({ error: status >= 500 ? 'Narrative Engine server error' : error.message });
    });
    return router;
}

module.exports = { PROMPTS, buildRoutes, directorMessages, scopeChatId };
