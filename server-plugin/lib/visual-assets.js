'use strict';
const crypto = require('node:crypto');
const { PNG } = require('pngjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((k) => [k, canonical(value[k])]),
        );
    return value;
}
function resourceKey(job) {
    return hash(
        JSON.stringify(
            canonical({
                version: 1,
                operation: job.operation,
                characterId: job.characterId,
                graph: job.graph,
                recipeVersion: job.recipeVersion,
                outputNode: job.outputNode,
                resource: job.resourceInput || job.scene.sceneId,
            }),
        ),
    );
}
function inspectPng(bytes, sprite = false) {
    if (
        !Buffer.isBuffer(bytes) ||
        bytes.length < 33 ||
        bytes.length > 16 * 1024 * 1024 ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.toString('ascii', 12, 16) !== 'IHDR'
    )
        throw new Error('Layer output must be a valid PNG (up to 16 MiB)');
    const width = bytes.readUInt32BE(16),
        height = bytes.readUInt32BE(20);
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216)
        throw new Error('Layer image dimensions exceed 16 megapixels');
    const png = PNG.sync.read(bytes, { checkCRC: true });
    let transparent = 0,
        visible = 0;
    for (let i = 3; i < png.data.length; i += 4) {
        if (png.data[i] === 0) transparent++;
        if (png.data[i] > 0) visible++;
    }
    if (sprite && (!transparent || !visible)) throw new Error('Sprite requires both transparent and visible pixels');
    return { width, height, transparent: transparent > 0 };
}
class VisualAssets {
    constructor(db, config = {}) {
        this.db = db;
        this.scopeLimit = config.visualAssetScopeBytes ?? 256 * 1024 * 1024;
        this.totalLimit = config.visualAssetTotalBytes ?? 1024 * 1024 * 1024;
        db.exec(`CREATE TABLE IF NOT EXISTS visual_assets (
            id TEXT NOT NULL, scope TEXT NOT NULL, resource_key TEXT NOT NULL,
            metadata_json TEXT NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY(scope,id), UNIQUE(scope,resource_key));`);
    }
    find(scope, key) {
        const row = this.db
            .prepare('SELECT metadata_json FROM visual_assets WHERE scope=? AND resource_key=?')
            .get(scope, key);
        return row ? JSON.parse(row.metadata_json) : null;
    }
    list(scope) {
        return this.db
            .prepare('SELECT metadata_json FROM visual_assets WHERE scope=? ORDER BY created_at DESC LIMIT 100')
            .all(scope)
            .map((r) => JSON.parse(r.metadata_json));
    }
    put(job, bytes) {
        const info = inspectPng(bytes, job.operation === 'sprite');
        return this.db.transaction(() => {
            const existing = this.find(job.scope, job.resourceKey);
            if (existing) return existing;
            const scoped = this.db
                .prepare('SELECT coalesce(sum(length(bytes)),0) AS n FROM visual_assets WHERE scope=?')
                .get(job.scope).n;
            const total = this.db.prepare('SELECT coalesce(sum(length(bytes)),0) AS n FROM visual_assets').get().n;
            if (scoped + bytes.length > this.scopeLimit || total + bytes.length > this.totalLimit)
                throw new Error('Visual asset quota reached; existing assets preserved');
            const id = crypto.randomUUID();
            const metadata = {
                id,
                resourceKey: job.resourceKey,
                anchorKey: job.anchorKey || null,
                expression: job.operation === 'sprite' ? {emotion: job.scene?.characters?.[0]?.emotion || '', expressed: job.scene?.characters?.[0]?.expressed || []} : null,
                expressionAnchorId: job.expressionAnchor?.id || null,
                operation: job.operation,
                characterId: job.characterId || null,
                resourceInput: job.resourceInput,
                workflow: job.workflow,
                seed: job.seed,
                createdAt: Date.now(),
                sha256: hash(bytes),
                byteLength: bytes.length,
                contentType: 'image/png',
                ...info,
            };
            this.db
                .prepare('INSERT INTO visual_assets VALUES(?,?,?,?,?,?)')
                .run(id, job.scope, job.resourceKey, JSON.stringify(metadata), bytes, metadata.createdAt);
            return metadata;
        })();
    }
    metadata(scope, id) {
        const row = this.db.prepare('SELECT metadata_json FROM visual_assets WHERE scope=? AND id=?').get(scope,id);
        if (!row) throw Object.assign(new Error('Visual asset not found'), {status:404});
        return JSON.parse(row.metadata_json);
    }
    image(scope, id) {
        const row = this.db.prepare('SELECT bytes FROM visual_assets WHERE scope=? AND id=?').get(scope, id);
        if (!row) throw Object.assign(new Error('Visual asset not found'), { status: 404 });
        return { bytes: row.bytes, contentType: 'image/png' };
    }
}
module.exports = { VisualAssets, resourceKey, inspectPng };
