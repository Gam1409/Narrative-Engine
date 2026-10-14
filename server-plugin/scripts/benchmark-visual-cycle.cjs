// Run with: node benchmark-visual-cycle.cjs INPUT_DIR OUTPUT_DIR COMFY_URL
// INPUT_DIR contains bg_bedroom, sprite_Wren_front, sprite_Wren_smile .input.json files.
const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('../lib/database');
const { VisualQueue } = require('../lib/visual');
const [inputDir, outputDir, comfyUrl] = process.argv.slice(2);
if (!inputDir || !outputDir || !comfyUrl) throw new Error('Expected INPUT_DIR OUTPUT_DIR COMFY_URL');
fs.mkdirSync(outputDir, { recursive: true });
const config = { storageRoot: outputDir, databasePath: path.join(outputDir, 'cycle.sqlite'),
    comfyUrl, allowHosts: new Set(), timeoutMs: 60000, visualJobTimeoutMs: 180000 };
const db = new Database(config);
const queue = new VisualQueue(config, db);
const report = { scope: 'Visual service only; excludes LLM and browser image loading', turns: [] };
(async () => {
    try {
        for (let turn = 0; turn < 4; turn++) {
            const started = Date.now();
            const names = ['bg_bedroom', turn === 2 ? 'sprite_Wren_smile' : 'sprite_Wren_front'];
            const jobs = [];
            for (const name of names) {
                const input = JSON.parse(fs.readFileSync(path.join(inputDir, name + '.input.json'), 'utf8'));
                let job = queue.enqueue('benchmark:cycle', { ...input, automatic: true, requestKey: `${turn}-${name}` });
                while (!['done', 'failed_final', 'cancelled'].includes(job.status)) {
                    await queue.tick();
                    job = queue.get('benchmark:cycle', job.id);
                    if (!['done', 'failed_final', 'cancelled'].includes(job.status))
                        await new Promise(resolve => setTimeout(resolve, 500));
                }
                jobs.push({ name, status: job.status, timing: job.timing, error: job.error });
                if (job.status !== 'done') throw new Error(job.error || job.status);
            }
            report.turns.push({ turn, elapsedMs: Date.now() - started, jobs });
            fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2));
            console.log(JSON.stringify(report.turns.at(-1)));
        }
    } finally { queue.close(); db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
