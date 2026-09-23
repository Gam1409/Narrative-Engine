'use strict';

const path = require('node:path');

function integer(value, fallback, min, max) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function loadConfig(env = process.env, dataRoot = globalThis.DATA_ROOT) {
    const storageRoot = env.NARRATIVE_ENGINE_STORAGE_DIR
        ? path.resolve(env.NARRATIVE_ENGINE_STORAGE_DIR)
        : path.join(dataRoot || process.cwd(), '_storage', 'narrative-engine');
    return Object.freeze({
        providerUrl: env.NARRATIVE_ENGINE_DIRECTOR_URL || '',
        providerKey: env.NARRATIVE_ENGINE_DIRECTOR_API_KEY || '',
        providerModel: env.NARRATIVE_ENGINE_DIRECTOR_MODEL || '',
        allowHosts: new Set((env.NARRATIVE_ENGINE_DIRECTOR_ALLOW_HOSTS || '')
            .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)),
        storageRoot,
        databasePath: path.join(storageRoot, 'narrative-engine.sqlite3'),
        timeoutMs: integer(env.NARRATIVE_ENGINE_TIMEOUT_MS, 30000, 1000, 120000),
        retries: integer(env.NARRATIVE_ENGINE_RETRIES, 2, 0, 5),
        bodyLimitBytes: integer(env.NARRATIVE_ENGINE_BODY_LIMIT_BYTES, 512 * 1024, 16 * 1024, 2 * 1024 * 1024),
        rateLimit: integer(env.NARRATIVE_ENGINE_RATE_LIMIT, 60, 5, 1000),
        rateWindowMs: integer(env.NARRATIVE_ENGINE_RATE_WINDOW_MS, 60000, 1000, 3600000),
    });
}

module.exports = { loadConfig };
