// node benchmark-local-expressions.cjs BASE_INPUT OUTPUT_DIR COMFY_URL PUBLIC_OUTPUT_DIR
const fs = require('node:fs'),
    path = require('node:path'),
    crypto = require('node:crypto');
const { PNG } = require('pngjs');
const { Database } = require('../lib/database');
const { VisualQueue } = require('../lib/visual');
const [source, root, comfyUrl, publicRoot] = process.argv.slice(2);
if (!source || !root || !comfyUrl || !publicRoot)
    throw Error('Expected four arguments');
fs.mkdirSync(root, { recursive: true });
const config = {
    storageRoot: root,
    databasePath: path.join(root, 'test.sqlite'),
    comfyUrl,
    allowHosts: new Set(),
    timeoutMs: 60000,
    visualJobTimeoutMs: 240000,
};
const db = new Database(config),
    q = new VisualQueue(config, db),
    results = [];
const base = JSON.parse(fs.readFileSync(source, 'utf8'));
base.localExpressions = true;
base.faceDetector = process.argv[6] || 'mediapipe_face_fp32.safetensors';
let original, anchor;
(async () => {
    try {
        for (const [name, emotion] of [
            ['neutral', 'neutral'],
            ['happy', 'joyful smile, smiling lips, raised cheeks, bright eyes'],
            [
                'surprise',
                'surprised expression, raised eyebrows, wide eyes, open mouth',
            ],
        ]) {
            const input = structuredClone(base);
            input.requestKey = 'local-expression-' + name;
            input.scene.characters[0].emotion = emotion;
            input.scene.sceneId = crypto
                .createHash('sha256')
                .update(JSON.stringify(input.scene))
                .digest('hex');
            input.resourceInput = input.scene.sceneId;
            const start = Date.now();
            let job = q.enqueue('test:expressions', input);
            while (
                !['done', 'failed_final', 'cancelled'].includes(job.status)
            ) {
                await q.tick();
                job = q.get('test:expressions', job.id);
                if (!['done', 'failed_final', 'cancelled'].includes(job.status))
                    await new Promise((r) => setTimeout(r, 500));
            }
            if (job.status !== 'done') throw Error(job.error || job.status);
            const img = await q.image('test:expressions', job.id, 0);
            const decoded = PNG.sync.read(img.bytes);
            const nameFile = 'local_expression_' + name + '.png';
            fs.writeFileSync(path.join(root, nameFile), img.bytes);
            fs.writeFileSync(path.join(publicRoot, nameFile), img.bytes);
            const result = {
                name,
                status: job.status,
                elapsedMs: Date.now() - start,
                timing: job.timing,
                anchorWarning: job.anchorWarning,
                expressionAnchor: job.expressionAnchor,
            };
            if (name === 'neutral') {
                original = decoded;
                anchor = q.anchors.find('test:expressions', job.anchorKey);
                result.anchor = anchor;
            } else {
                let outsideChanged = 0,
                    alphaChanged = 0,
                    insideChanged = 0;
                const f = anchor.face;
                for (let y = 0; y < decoded.height; y++)
                    for (let x = 0; x < decoded.width; x++) {
                        const i = (y * decoded.width + x) * 4,
                            changed = !decoded.data
                                .subarray(i, i + 4)
                                .equals(original.data.subarray(i, i + 4));
                        if (decoded.data[i + 3] !== original.data[i + 3])
                            alphaChanged++;
                        if (changed) {
                            if (
                                x < f.x ||
                                x >= f.x + f.width ||
                                y < f.y ||
                                y >= f.y + f.height
                            )
                                outsideChanged++;
                            else insideChanged++;
                        }
                    }
                Object.assign(result, {
                    outsideChanged,
                    alphaChanged,
                    insideChanged,
                });
                if (outsideChanged || alphaChanged)
                    throw Error('Pixel preservation failed');
            }
            results.push(result);
            fs.writeFileSync(
                path.join(root, 'results.json'),
                JSON.stringify(results, null, 2),
            );
            console.log(JSON.stringify(result));
            if (!anchor)
                throw Error(
                    job.anchorWarning || 'Automatic face anchor missing',
                );
        }
    } finally {
        q.close();
        db.close();
    }
})().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
