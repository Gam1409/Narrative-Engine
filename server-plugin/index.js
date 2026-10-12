'use strict';

const { loadConfig } = require('./lib/config');
const { Database } = require('./lib/database');
const { DirectorProvider } = require('./lib/provider');
const { VisualQueue } = require('./lib/visual');
const { buildRoutes } = require('./lib/routes');

let runtime = null;

async function init(router) {
    if (!router || typeof router.use !== 'function') throw new Error('Narrative Engine requires an Express-compatible router');
    const config = loadConfig();
    const db = new Database(config);
    const provider = new DirectorProvider(config);
    const visuals = new VisualQueue(config, db);
    runtime = { db, provider, visuals };
    visuals.start();
    buildRoutes(router, { config, db, provider, visuals });
    console.info(`[narrative-engine] Server plugin ready; storage=${config.storageRoot}; provider=${config.providerUrl ? 'configured' : 'not configured'}`);
}

async function exit() {
    if (!runtime) return;
    runtime.visuals.close();
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
