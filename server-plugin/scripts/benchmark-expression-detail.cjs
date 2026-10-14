// node benchmark-expression-detail.cjs BASE_INPUT OUTPUT_DIR COMFY_URL PUBLIC_OUTPUT_DIR
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Database } = require('../lib/database');
const { VisualQueue } = require('../lib/visual');
const { integratedRecipe } = require('../lib/visual-integrated');
const [baseInput, outputDir, comfyUrl, publicOutputDir] = process.argv.slice(2);
if (!baseInput || !outputDir || !comfyUrl || !publicOutputDir) throw Error('Expected four arguments');
const base = JSON.parse(fs.readFileSync(baseInput, 'utf8'));
fs.mkdirSync(outputDir, {recursive: true});
const config = { storageRoot: outputDir, databasePath: path.join(outputDir, 'test.sqlite'), comfyUrl,
    allowHosts: new Set(), timeoutMs: 60000, visualJobTimeoutMs: 240000 };
const db = new Database(config), queue = new VisualQueue(config, db, { recipes: {
    scene_integrated_cfg3: { ...integratedRecipe('scene_integrated'), cfg: 3 },
} });
const reportFile = path.join(outputDir, 'results.json');
const results = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : [];
(async () => {
    try {
        for (const variant of (process.argv[6] ? [process.argv[6]] : ['emotions', 'emotions_details', 'emotions_details_cfg3', 'emotions_details_seed2'])) {
            const input = structuredClone(base);
            input.requestKey = variant;
            input.scene.characters[0].emotion = 'warm joyful smile, slightly parted smiling lips, raised cheeks, bright expressive eyes, relaxed eyebrows, looking at the other woman';
            input.scene.characters[1].emotion = 'pleasantly surprised, raised eyebrows, wide sparkling eyes, slightly open mouth, looking at the other woman';
            if (variant.startsWith('emotions_details')) input.composition.style =
                'anime illustration, delicate clean line art, soft natural shading, warm restrained colors, finely drawn hair strands, detailed irises, fine knit and fabric weave, precise seams and buttons, natural cloth folds, wood grain, soft reflected window light, nuanced contact shadows';
            if (variant.endsWith('_cfg3')) input.workflow = 'scene_integrated_cfg3';
            if (variant.endsWith('_seed2')) input.seed = 987654;
            input.scene.sceneId = crypto.createHash('sha256').update(JSON.stringify(input.scene)).digest('hex');
            const name = 'expression_test_' + variant;
            fs.writeFileSync(path.join(outputDir, name + '.input.json'), JSON.stringify(input, null, 2));
            const start = Date.now();
            let job = queue.enqueue('benchmark:expression-detail', input);
            fs.writeFileSync(path.join(outputDir, name + '.workflow.json'), JSON.stringify(queue.get('benchmark:expression-detail', job.id, true).graph, null, 2));
            while (!['done', 'failed_final', 'cancelled'].includes(job.status)) {
                await queue.tick(); job = queue.get('benchmark:expression-detail', job.id);
                if (!['done', 'failed_final', 'cancelled'].includes(job.status)) await new Promise(r => setTimeout(r, 500));
            }
            if (job.status !== 'done') throw Error(job.error || job.status);
            const image = await queue.image('benchmark:expression-detail', job.id, 0);
            fs.writeFileSync(path.join(outputDir, name + '.png'), image.bytes);
            fs.writeFileSync(path.join(publicOutputDir, name + '.png'), image.bytes);
            results.push({ variant, filename: name + '.png', elapsedMs: Date.now() - start, timing: job.timing, seed: input.seed, cfg: variant.endsWith('_cfg3') ? 3 : 4 });
            fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2));
            console.log(JSON.stringify(results.at(-1)));
        }
    } finally { queue.close(); db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
