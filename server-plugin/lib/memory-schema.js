'use strict';

// Preserve public IDs and embedding ownership while changing the legacy global key.
function migrateScopedMemories(db) {
    const columns = db.prepare('PRAGMA table_info(memories)').all();
    if (columns.some(column => column.name === 'chat_id' && column.pk)) return;
    db.exec(`
        CREATE TABLE memories_scoped (
            id TEXT NOT NULL, chat_id TEXT NOT NULL, text TEXT NOT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]', importance REAL NOT NULL DEFAULT 0.5,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(chat_id,id)
        );
        INSERT INTO memories_scoped SELECT id,chat_id,text,tags_json,importance,created_at,updated_at FROM memories;
        CREATE TABLE memory_embeddings_scoped (
            chat_id TEXT NOT NULL, memory_id TEXT NOT NULL, model TEXT NOT NULL, embedding BLOB NOT NULL,
            PRIMARY KEY(chat_id,memory_id),
            FOREIGN KEY(chat_id,memory_id) REFERENCES memories_scoped(chat_id,id) ON DELETE CASCADE
        );
        INSERT INTO memory_embeddings_scoped(chat_id,memory_id,model,embedding)
            SELECT m.chat_id,e.memory_id,e.model,e.embedding FROM memory_embeddings e JOIN memories m ON m.id=e.memory_id;
        DROP TABLE memory_embeddings;
        DROP TABLE memories;
        ALTER TABLE memories_scoped RENAME TO memories;
        ALTER TABLE memory_embeddings_scoped RENAME TO memory_embeddings;
        CREATE INDEX idx_memories_chat ON memories(chat_id,updated_at DESC);
    `);
}
module.exports = { migrateScopedMemories };
