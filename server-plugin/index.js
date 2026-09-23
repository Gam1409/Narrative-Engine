'use strict';

const { loadConfig } = require('./lib/config');
const { Database } = require('./lib/database');
const { DirectorProvider } = require('./lib/provider');
const { buildRoutes } = require('./lib/routes');

let runtime = null;

async function init(router) {
    if (!router || typeof router.use !== 'function') throw new Error('Narrative Engine requires an Express-compatible router');
    const config = loadConfig();
    const db = new Database(config);
    const provider = new DirectorProvider(config);
    runtime = { db, provider };
    buildRoutes(router, { config, db, provider });
    console.info(`[narrative-engine] Server plugin ready; storage=${config.storageRoot}; provider=${config.providerUrl ? 'configured' : 'not configured'}`);
}

async function exit() {
    if (!runtime) return;
    runtime.provider.close();
    runtime.db.close();
    runtime = null;
}

const info = Object.freeze({
    id: 'narrative-engine',
    name: 'Narrative Engine Server',
    description: 'Secure Director proxy and persistent narrative storage',
});

module.exports = { exit, info, init };
