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

    router.get('/health', asyncRoute(async (_req, res) => res.json({ ok: true, schemaVersion: 1, provider: await provider.healthCheck() })));

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

module.exports = { PROMPTS, buildRoutes, directorMessages, scopeChatId };
