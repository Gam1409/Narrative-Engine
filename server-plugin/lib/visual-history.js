'use strict';

// Compact payloads, never delete identity records: request keys prevent duplicate GPU submissions.
class VisualHistoryMaintenance {
    constructor(db, config = {}) {
        this.db = db;
        this.enabled = config.visualGraphCompaction !== false;
        this.retentionMs = (config.visualGraphRetentionHours ?? 24) * 3600000;
        this.keepRecent = config.visualGraphKeepRecent ?? 100;
        this.nextRun = 0;
        this.lastResult = null;
        db.exec('CREATE INDEX IF NOT EXISTS visual_jobs_scope_status_updated ON visual_jobs(scope,status,updated_at DESC,id DESC)');
    }

    run(now = Date.now()) {
        if (!this.enabled || now < this.nextRun) return null;
        this.nextRun = now + 60000;
        const result = this.db.transaction(() => {
            const rows = this.db.prepare(`
                SELECT j.id, length(CAST(j.data_json AS BLOB)) AS bytes
                FROM visual_jobs j
                WHERE j.status IN ('done','cancelled','failed_final')
                  AND j.updated_at < ?
                  AND json_type(j.data_json,'$.graph') = 'object'
                  AND coalesce(json_extract(j.data_json,'$.submissionUnknown'),0) = 0
                  AND coalesce(json_extract(j.data_json,'$.submissionPending'),0) = 0
                  AND lower(coalesce(json_extract(j.data_json,'$.error'),'')) NOT LIKE '%unknown%'
                  AND j.id NOT IN (
                    SELECT recent.id FROM visual_jobs recent
                    WHERE recent.scope=j.scope AND recent.status IN ('done','cancelled','failed_final')
                    ORDER BY recent.updated_at DESC, recent.id DESC LIMIT ?
                  )
                ORDER BY j.updated_at ASC, j.id ASC LIMIT 50
            `).all(now - this.retentionMs, this.keepRecent);
            const update = this.db.prepare(`UPDATE visual_jobs
                SET data_json=json_set(json_remove(data_json,'$.graph'),'$.graphCompactedAt',?) WHERE id=?`);
            const size = this.db.prepare('SELECT length(CAST(data_json AS BLOB)) AS bytes FROM visual_jobs WHERE id=?');
            let bytesRemoved = 0;
            for (const row of rows) {
                update.run(now, row.id);
                bytesRemoved += row.bytes - size.get(row.id).bytes;
            }
            return { at: now, compacted: rows.length, bytesRemoved };
        })();
        this.lastResult = result;
        return result;
    }
}
module.exports = { VisualHistoryMaintenance };
