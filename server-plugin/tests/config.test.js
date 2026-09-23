'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../lib/config');

test('configuration uses persistent DATA_ROOT storage and clamps limits', () => {
    const config = loadConfig({
        NARRATIVE_ENGINE_DIRECTOR_URL: 'http://127.0.0.1:1234/v1',
        NARRATIVE_ENGINE_DIRECTOR_MODEL: 'director',
        NARRATIVE_ENGINE_TIMEOUT_MS: '1',
        NARRATIVE_ENGINE_RETRIES: '99',
    }, path.join('data', 'root'));
    assert.equal(config.databasePath, path.join('data/root', '_storage', 'narrative-engine', 'narrative-engine.sqlite3'));
    assert.equal(config.timeoutMs, 1000);
    assert.equal(config.retries, 5);
    assert.equal(config.providerModel, 'director');
    assert.equal(Object.prototype.hasOwnProperty.call(config, 'providerKey'), true);
});

test('environment storage override is resolved and allowlist parsed', () => {
    const config = loadConfig({ NARRATIVE_ENGINE_STORAGE_DIR: './private-db', NARRATIVE_ENGINE_DIRECTOR_ALLOW_HOSTS: 'HOST.local, 10.2.3.4' });
    assert.equal(config.storageRoot, path.resolve('./private-db'));
    assert.deepEqual([...config.allowHosts], ['host.local', '10.2.3.4']);
});
