'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { STORAGE_SCHEMA, installStorage } = require('./storage');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS state_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, message_id TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS state_deltas (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, message_id TEXT, delta_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, text TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', importance REAL NOT NULL DEFAULT 0.5, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS embedding_cache (scope TEXT NOT NULL, hash TEXT NOT NULL, model TEXT NOT NULL, vector_json TEXT NOT NULL, vector_blob BLOB, PRIMARY KEY(scope,hash,model));
CREATE TABLE IF NOT EXISTS memory_embeddings (memory_id TEXT PRIMARY KEY, model TEXT NOT NULL, embedding BLOB NOT NULL, FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS plot_threads (id TEXT NOT NULL, chat_id TEXT NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id, chat_id));
CREATE TABLE IF NOT EXISTS world_events (id TEXT NOT NULL, chat_id TEXT NOT NULL, data_json TEXT NOT NULL, due_at TEXT, PRIMARY KEY(id, chat_id));
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sprite_state (chat_id TEXT NOT NULL, character_id TEXT NOT NULL, sprite TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(chat_id, character_id));
CREATE TABLE IF NOT EXISTS provider_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT, phase TEXT NOT NULL, ok INTEGER NOT NULL, latency_ms INTEGER NOT NULL, error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_snapshots_chat ON state_snapshots(chat_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_deltas_chat ON state_deltas(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id, updated_at DESC);
INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schemaVersion', '1');`;

class Database {
    constructor(config, dependencies = {}) {
        fs.mkdirSync(config.storageRoot, { recursive: true, mode: 0o700 });
        const Sqlite = dependencies.Sqlite || require('better-sqlite3');
        this.db = new Sqlite(config.databasePath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.vectorAvailable = false; this.ftsAvailable = false;
        try { require('sqlite-vec').load(this.db); this.vectorAvailable = true; } catch { /* Portable lexical fallback remains available. */ }
        try {
            const hasMeta = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'").get();
            const version = hasMeta ? Number(this.db.prepare("SELECT value FROM schema_meta WHERE key='schemaVersion'").get()?.value || 1) : 0;
            if (version > 2) throw new Error('Database schema is newer than supported');
            if (version === 1 && config.databasePath !== ':memory:') {
                this.backupPath = `${config.databasePath}.pre-v2-${Date.now()}.bak`;
                this.db.prepare('VACUUM INTO ?').run(this.backupPath);
            }
            this.db.transaction(() => {
                this.db.exec(SCHEMA);
                this.db.exec(STORAGE_SCHEMA);
                if (!this.db.prepare('PRAGMA table_info(embedding_cache)').all().some(c => c.name === 'vector_blob')) this.db.exec('ALTER TABLE embedding_cache ADD COLUMN vector_blob BLOB');
        try { this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS embedding_fts USING fts5(cache_key UNINDEXED, text)'); this.ftsAvailable = true; } catch { /* SQLite builds without FTS5 can still use vectors. */ }

                this.db.prepare("UPDATE schema_meta SET value='2' WHERE key='schemaVersion'").run();
            })();
        } catch (error) { this.db.close(); throw error; }
    }
    ensureChat(chatId) { this.db.prepare('INSERT INTO chats(id) VALUES (?) ON CONFLICT(id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP').run(chatId); }
    getState(chatId) {
        const row = this.db.prepare('SELECT state_json FROM state_snapshots WHERE chat_id=? ORDER BY id DESC LIMIT 1').get(chatId);
        return row ? JSON.parse(row.state_json) : null;
    }
    saveState(chatId, state, messageId = null) {
        this.db.transaction(() => {
            this.ensureChat(chatId);
            this.db.prepare('INSERT INTO state_snapshots(chat_id,message_id,state_json) VALUES (?,?,?)').run(chatId, messageId, JSON.stringify(state));
            this.db.prepare('DELETE FROM state_snapshots WHERE chat_id=? AND id NOT IN (SELECT id FROM state_snapshots WHERE chat_id=? ORDER BY id DESC LIMIT 20)').run(chatId, chatId);
        })();
    }
    addDelta(chatId, delta, messageId = null) { this.ensureChat(chatId); this.db.prepare('INSERT INTO state_deltas(chat_id,message_id,delta_json) VALUES (?,?,?)').run(chatId, messageId, JSON.stringify(delta)); }
    getDeltas(chatId) { return this.db.prepare('SELECT delta_json FROM state_deltas WHERE chat_id=? ORDER BY id').all(chatId).map((row) => JSON.parse(row.delta_json)); }
    saveMemory(memory) {
        this.ensureChat(memory.chatId);
        this.db.prepare(`INSERT INTO memories(id,chat_id,text,tags_json,importance) VALUES (?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET text=excluded.text,tags_json=excluded.tags_json,importance=excluded.importance,updated_at=CURRENT_TIMESTAMP`)
            .run(memory.id, memory.chatId, memory.text, JSON.stringify(memory.tags || []), memory.importance ?? 0.5);
    }
    listMemories(chatId, limit = 500) { return this.db.prepare('SELECT id,text,tags_json,importance,updated_at FROM memories WHERE chat_id=? ORDER BY updated_at DESC LIMIT ?').all(chatId, limit).map((row) => ({ ...row, tags: JSON.parse(row.tags_json) })); }
    close() { this.db.close(); }
}

installStorage(Database);
module.exports = { Database, SCHEMA };
