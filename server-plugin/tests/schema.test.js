'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SCHEMA } = require('../lib/database');

test('SQLite migration declares all required server-assisted tables', () => {
    for (const table of ['chats', 'state_snapshots', 'state_deltas', 'memories', 'memory_embeddings', 'plot_threads', 'world_events', 'audit_log', 'sprite_state', 'provider_calls']) {
        assert.match(SCHEMA, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
    }
    assert.match(SCHEMA, /schemaVersion/);
});
