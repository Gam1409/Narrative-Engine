'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Sqlite = require('better-sqlite3');
const { Database, SCHEMA } = require('../lib/database');

test('G13 file migration backs up v1 before writing v2 and preserves legacy envelope', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-migration-'));
    const file = path.join(dir, 'legacy.sqlite3');
    let db;
    try {
        const legacy = new Sqlite(file); legacy.exec(SCHEMA);
        legacy.prepare('INSERT INTO state_snapshots(chat_id,state_json) VALUES (?,?)').run('chat', JSON.stringify({ __narrativeEngineStore: 1, values: { bundle: { state: { revision: 7 } } } })); legacy.close();
        db = new Database({ storageRoot: dir, databasePath: file });
        assert.ok(fs.existsSync(db.backupPath));
        const backup = new Sqlite(db.backupPath, { readonly: true });
        assert.equal(backup.prepare("SELECT value FROM schema_meta WHERE key='schemaVersion'").get().value, '1'); backup.close();
        assert.equal(db.readField('chat', 'bundle').value.state.revision, 7);
        db.writeField('chat', 'bundle', { state: { revision: 8 } }, 0);
        db.close(); db = new Database({ storageRoot: dir, databasePath: file });
        assert.equal(db.readField('chat', 'bundle').value.state.revision, 8);
        assert.equal(db.backupPath, undefined);
    } finally {
        db?.close();
        const resolved = path.resolve(dir);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('ne-migration-')) throw new Error('Unsafe test cleanup path');
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});

test('immutable row conflict rolls back whole bundle and remains chat scoped', () => {
    const db = new Database({ storageRoot: process.cwd(), databasePath: ':memory:' });
    try {
        const value = { historyVersion: 2, records: [{ deltaId: 'd1', delta: { x: 1 } }], decisions: [], deltas: [], checkpoints: [], memories: [] };
        db.writeField('alice:chat', 'bundle', value, 0);
        assert.equal(db.readField('bob:chat', 'bundle').value, null);
        assert.throws(() => db.writeField('alice:chat', 'bundle', { ...value, records: [{ deltaId: 'd1', delta: { x: 2 } }] }, 1), /Immutable record conflict/);
        assert.equal(db.readField('alice:chat', 'bundle').revision, 1);
        assert.equal(db.readField('alice:chat', 'bundle').value.records[0].delta.x, 1);
    } finally { db.close(); }
});

test('legacy snapshot route keeps at most twenty snapshots per chat', () => {
    const db = new Database({ storageRoot: process.cwd(), databasePath: ':memory:' });
    try {
        for (let n=0;n<50;n++) db.saveState('a', { n });
        assert.equal(db.db.prepare('SELECT count(*) n FROM state_snapshots').get().n, 20);
        assert.equal(db.getState('a').n, 49);
    } finally { db.close(); }
});
