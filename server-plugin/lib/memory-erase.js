'use strict';
/** Remove episodic memory copies, not world state, events or relationships. */
function eraseMemoryCopies(value, field = '') {
    if (field === 'memories' || field === 'legacyMemories' || field === 'memoryIds') return [];
    if (field === 'memoryStatuses') return {};
    if (Array.isArray(value)) return value.map(item => eraseMemoryCopies(item));
    if (!value || typeof value !== 'object') return value;
    const result = structuredClone(value);
    for (const key of ['memories','legacyMemories','memoryIds','memoryStatuses','records','deltas','baseDeltas','checkpoints']) {
        if (Object.hasOwn(result,key)) result[key] = eraseMemoryCopies(result[key],key);
    }
    if (result.__narrativeEngineStore === 1 && result.values) {
        for (const key of Object.keys(result.values)) result.values[key] = eraseMemoryCopies(result.values[key],key);
    }
    return result;
}

function eraseStoredMemory(database, prefix, chatId = null, resetState = false) {
    const db=database.db;
    return db.transaction(()=>{
        const ids=db.prepare('SELECT id FROM chats UNION SELECT chat_id AS id FROM storage_fields UNION SELECT scope AS id FROM embedding_cache').all()
            .map(r=>r.id).filter(id=>id.startsWith(prefix) && (!chatId || id===chatId));
        if(chatId && !ids.includes(chatId)) ids.push(chatId);
        for(const id of ids) {
            // Materialize legacy fields so pre-cleanup writers cannot reuse revision zero.
            for(const field of database.listFields(id)) {
                if(!db.prepare('SELECT 1 FROM storage_fields WHERE chat_id=? AND field=?').get(id,field))
                    database.writeField(id,field,database.readField(id,field).value,0);
            }
            if(resetState && !db.prepare("SELECT 1 FROM storage_fields WHERE chat_id=? AND field='bundle'").get(id)) database.writeField(id,'bundle',null,0);
            for(const row of db.prepare('SELECT field,value_json FROM storage_fields WHERE chat_id=?').all(id)) {
                const clean=resetState ? null : eraseMemoryCopies(JSON.parse(row.value_json),row.field);
                db.prepare('UPDATE storage_fields SET value_json=?,revision=revision+1 WHERE chat_id=? AND field=?').run(JSON.stringify(clean),id,row.field);
            }
            if(resetState) {
                for(const table of ['turn_records','turn_decisions','turn_checkpoints','state_snapshots','state_deltas','plot_threads','world_events','audit_log','sprite_state']) db.prepare(`DELETE FROM ${table} WHERE chat_id=?`).run(id);
            }
            for(const [table,column] of [['turn_records','data_json'],['turn_checkpoints','data_json'],['state_snapshots','state_json'],['state_deltas','delta_json']]) {
                for(const row of db.prepare(`SELECT rowid,${column} AS json FROM ${table} WHERE chat_id=?`).all(id))
                    db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`).run(JSON.stringify(eraseMemoryCopies(JSON.parse(row.json))),row.rowid);
            }
            db.prepare('DELETE FROM turn_memories WHERE chat_id=?').run(id);
            db.prepare('DELETE FROM memories WHERE chat_id=?').run(id);
            db.prepare('DELETE FROM embedding_cache WHERE scope=?').run(id);
            if(database.ftsAvailable) db.prepare('DELETE FROM embedding_fts WHERE substr(cache_key,1,?)=?').run(id.length+1,id+':');
        }
        return {chatIds:ids.map(id=>id.slice(prefix.length)),chats:ids.length};
    }).immediate();
}
module.exports={eraseMemoryCopies,eraseStoredMemory};
