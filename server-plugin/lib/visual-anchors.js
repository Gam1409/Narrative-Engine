'use strict';
const crypto = require('node:crypto');
const { PNG } = require('pngjs');
const { inspectPng } = require('./visual-assets');
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((k) => [k, stable(value[k])]),
        );
    return value;
}
function anchorKey(input, recipe) {
    const { emotion, expressed, position, ...character } =
        input.scene.characters[0];
    return crypto
        .createHash('sha256')
        .update(
            JSON.stringify(
                stable({
                    character,
                    workflow: input.workflow,
                    recipe,
                    checkpoint: input.checkpoint || '',
                    profile: input.promptProfile || 'sdxl',
                    composition: input.composition || {},
                    modelFiles: input.modelFiles || {},
                    stages: input.stages || {},
                    seed: input.seed,
                }),
            ),
        )
        .digest('hex');
}
function faceBox(face, width, height) {
    if (
        !face ||
        !['x', 'y', 'width', 'height'].every((k) =>
            Number.isInteger(face[k]),
        ) ||
        face.x < 0 ||
        face.y < 0 ||
        face.width < 16 ||
        face.height < 16 ||
        face.x + face.width > width ||
        face.y + face.height > height ||
        face.width * face.height > width * height * 0.35
    )
        throw Error(
            'Select a face rectangle within the image (up to 35% of its area)',
        );
    return { x: face.x, y: face.y, width: face.width, height: face.height };
}
function preserveOutsideFace(original, generated, face) {
    const info = inspectPng(original, true);
    inspectPng(generated);
    faceBox(face, info.width, info.height);
    const base = PNG.sync.read(original),
        next = PNG.sync.read(generated);
    if (base.width !== next.width || base.height !== next.height)
        throw Error('Expression output changed image dimensions');
    // Preserve exact original RGBA outside the rectangle and alpha everywhere.
    for (let y = face.y; y < face.y + face.height; y++)
        for (let x = face.x; x < face.x + face.width; x++) {
            const i = (y * base.width + x) * 4;
            if (!base.data[i + 3]) continue;
            const blend = Math.min(
                1,
                (x - face.x) / 8,
                (face.x + face.width - 1 - x) / 8,
                (y - face.y) / 8,
                (face.y + face.height - 1 - y) / 8,
            );
            for (let c = 0; c < 3; c++)
                base.data[i + c] = Math.round(
                    base.data[i + c] * (1 - blend) + next.data[i + c] * blend,
                );
        }
    return PNG.sync.write(base);
}
function uploadImage(bytes) {
    const png = PNG.sync.read(bytes);
    for (let i = 0; i < png.data.length; i += 4) {
        const alpha = png.data[i + 3] / 255;
        for (let c = 0; c < 3; c++)
            png.data[i + c] = Math.round(
                png.data[i + c] * alpha + 255 * (1 - alpha),
            );
        png.data[i + 3] = 255;
    }
    return PNG.sync.write(png);
}
function detectedFace(bytes, width, height) {
    const info = inspectPng(bytes);
    if (info.width !== width || info.height !== height)
        throw Error('Face mask dimensions differ');
    const png = PNG.sync.read(bytes),
        seen = new Uint8Array(width * height),
        groups = [];
    const white = (i) => png.data[i * 4] > 127 && png.data[i * 4 + 3] > 0;
    for (let start = 0; start < seen.length; start++) {
        if (seen[start] || !white(start)) continue;
        let minX = width,
            minY = height,
            maxX = 0,
            maxY = 0,
            count = 0;
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
            const i = stack.pop(),
                x = i % width,
                y = Math.floor(i / width);
            count++;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            for (const n of [
                x > 0 ? i - 1 : -1,
                x + 1 < width ? i + 1 : -1,
                y > 0 ? i - width : -1,
                y + 1 < height ? i + width : -1,
            ])
                if (n >= 0 && !seen[n] && white(n)) {
                    seen[n] = 1;
                    stack.push(n);
                }
        }
        if (count >= 16)
            groups.push({
                x: minX,
                y: minY,
                width: maxX - minX + 1,
                height: maxY - minY + 1,
            });
        if (groups.length > 1)
            throw Error('Multiple detected faces; anchor not selected');
    }
    if (groups.length !== 1)
        throw Error('Face not detected; anchor not selected');
    return faceBox(groups[0], width, height);
}
class VisualAnchors {
    constructor(db, assets) {
        this.db = db;
        this.assets = assets;
        db.exec(
            'CREATE TABLE IF NOT EXISTS visual_anchors(scope TEXT NOT NULL, anchor_key TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(scope,anchor_key))',
        );
    }
    list(scope) {
        return this.db
            .prepare('SELECT data_json FROM visual_anchors WHERE scope=?')
            .all(scope)
            .map((r) => JSON.parse(r.data_json));
    }
    find(scope, key) {
        const row = this.db
            .prepare(
                'SELECT data_json FROM visual_anchors WHERE scope=? AND anchor_key=?',
            )
            .get(scope, key);
        return row ? JSON.parse(row.data_json) : null;
    }
    pin(scope, assetId, face) {
        const asset = this.assets.metadata(scope, assetId);
        if (asset.operation !== 'sprite' || !asset.anchorKey)
            throw Error('Generate a compatible base sprite first');
        const anchor = {
            id: crypto.randomUUID(),
            key: asset.anchorKey,
            assetId,
            characterId: asset.characterId,
            expression: asset.expression || null,
            width: asset.width,
            height: asset.height,
            face: faceBox(face, asset.width, asset.height),
            filename: 'ne_anchor_' + asset.sha256 + '.png',
            createdAt: Date.now(),
        };
        this.db
            .prepare(
                'INSERT INTO visual_anchors VALUES(?,?,?) ON CONFLICT(scope,anchor_key) DO UPDATE SET data_json=excluded.data_json',
            )
            .run(scope, anchor.key, JSON.stringify(anchor));
        return anchor;
    }
    remove(scope, key) {
        this.db
            .prepare(
                'DELETE FROM visual_anchors WHERE scope=? AND anchor_key=?',
            )
            .run(scope, key);
    }
}
module.exports = {
    VisualAnchors,
    anchorKey,
    faceBox,
    preserveOutsideFace,
    uploadImage,
    detectedFace,
};
