'use strict';

const crypto = require('node:crypto');
const { assertObject, rateLimiter, safeJson, validateId } = require('./security');
const { consolidateMemories, mergeState, searchMemories, selectSprite } = require('./services');

const PROMPTS = {
    pre: 'You are the Narrative Engine Director PRE pass. Return strict JSON only. Preserve user agency and canon. Produce compact continuity, relevant memory, active threads, world pressure, and direction.',
    post: 'You are the Narrative Engine Director POST pass. Return strict JSON only. Audit continuity and user agency, then produce state_delta, relationship_delta, knowledge_delta, thread_delta, memory_candidates, and sprite_decisions.',
    reconcile: 'You are the Narrative Engine reconciliation pass. Return strict JSON only. Reconcile supplied accepted chat facts with structured state using explicit chat facts as highest priority.',
};

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res)).catch(next); }

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

    router.get('/health', asyncRoute(async (_req, res) => res.json({ ok: true, schemaVersion: 1, provider: await provider.healthCheck() })));

    for (const phase of ['pre', 'post', 'reconcile']) {
        router.post(`/director/${phase}`, asyncRoute(async (req, res) => {
            const body = assertObject(req.body);
            const content = body.input ?? body.payload ?? body;
            const started = Date.now();
            try {
                const result = await provider.complete({ messages: [{ role: 'system', content: PROMPTS[phase] }, { role: 'user', content: safeJson(content, config.bodyLimitBytes) }], maxTokens: phase === 'pre' ? 2000 : 2500 });
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

    router.post('/memory/search', asyncRoute(async (req, res) => {
        const body = assertObject(req.body); const chatId = scopeChatId(req, body.chatId);
        if (typeof body.query !== 'string' || body.query.length > 10000) throw Object.assign(new Error('Invalid query'), { status: 400 });
        res.json({ memories: searchMemories(db, chatId, body.query, body.topK) });
    }));
    router.post('/memory/consolidate', asyncRoute(async (req, res) => {
        const body = assertObject(req.body); const chatId = scopeChatId(req, body.chatId);
        res.json({ saved: consolidateMemories(db, chatId, body.memories) });
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

module.exports = { PROMPTS, buildRoutes, scopeChatId };
