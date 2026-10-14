'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { validateProviderUrl, validateId } = require('./security');
const { requestJson } = require('./provider');
const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const { checkGraph, summarizeInventory } = require('./visual-capabilities');
const { compilePrompts } = require('./visual-prompts');
const { builtinRecipe } = require('./visual-recipes');
const { buildWorkflow } = require('./visual-workflow');
const { userRecipe } = require('./visual-user-recipes');
const { reuseLegacyBackground } = require('./visual-background');
const { resolveLayerGuidance } = require('./visual-guidance');
const { VisualAssets, resourceKey } = require('./visual-assets');
const { VisualHistoryMaintenance } = require('./visual-history');
const { VisualAnchors, anchorKey, preserveOutsideFace, uploadImage, detectedFace } = require('./visual-anchors');
class VisualQueue {
    constructor(config, db, deps = {}) {
        this.config = config;
        this.db = db.db;
        this.assets = new VisualAssets(this.db, config);
        this.anchors = new VisualAnchors(this.db, this.assets);
        this.request = deps.requestJson || requestJson;
        this.validate = deps.validateProviderUrl || validateProviderUrl;
        this.controllers = new Set();
        this.busy = false;
        this.closed = false;
        this.inventoryCache = new Map();
        try {
            this.recipes =
                deps.recipes ||
                (config.comfyWorkflows
                    ? JSON.parse(fs.readFileSync(config.comfyWorkflows, 'utf8').replace(/^\uFEFF/, ''))
                    : {});
        } catch {
            this.recipes = {};
        }
        this.db.exec(
            'CREATE TABLE IF NOT EXISTS visual_jobs (id TEXT PRIMARY KEY, scope TEXT NOT NULL, request_key TEXT NOT NULL, status TEXT NOT NULL, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(scope,request_key));',
        );
        this.db.exec('CREATE TABLE IF NOT EXISTS visual_background_aliases (scope TEXT NOT NULL, resource_key TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(scope,resource_key))');
        this.db.exec('CREATE TABLE IF NOT EXISTS visual_reuse_events (scope TEXT NOT NULL, request_key TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(scope,request_key))');
        this.historyMaintenance = new VisualHistoryMaintenance(this.db, config);
        // A crash during submission is ambiguous. Never spend GPU work by resubmitting blindly.
        for (const row of this.db.prepare("SELECT data_json FROM visual_jobs WHERE status='running'").all()) {
            const job = JSON.parse(row.data_json);
            if (job.promptId) continue;
            this.transition(job, 'failed_final', { error: 'Submission interrupted; remote acceptance unknown', submissionUnknown: true });
        }
    }
    save(job) {
        this.db
            .prepare(
                'INSERT INTO visual_jobs(id,scope,request_key,status,data_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data_json=excluded.data_json,updated_at=excluded.updated_at',
            )
            .run(job.id, job.scope, job.requestKey, job.status, JSON.stringify(job), Date.now());
        return this.public(job);
    }
    metrics(scope) {
        const counts = Object.fromEntries(['background','sprite','illustration','local_expression'].map(kind =>
            [kind, {jobs:0, submitted:0, completed:0, failed:0, reused:0}]));
        const rows = this.db.prepare(`SELECT
            CASE WHEN json_type(data_json,'$.expressionAnchor')='object' THEN 'local_expression'
                 ELSE coalesce(json_extract(data_json,'$.operation'),'illustration') END AS kind,
            count(*) AS jobs,
            sum(CASE WHEN EXISTS(SELECT 1 FROM json_each(json_extract(data_json,'$.history'))
                WHERE json_extract(value,'$.status')='running') THEN 1 ELSE 0 END) AS submitted,
            sum(CASE WHEN status='done' AND coalesce(json_extract(data_json,'$.reused'),0)=0 THEN 1 ELSE 0 END) AS completed,
            sum(CASE WHEN status='failed_final' THEN 1 ELSE 0 END) AS failed
            FROM visual_jobs WHERE scope=? AND coalesce(json_extract(data_json,'$.reused'),0)=0 GROUP BY kind`).all(scope);
        for (const row of rows) if (counts[row.kind]) Object.assign(counts[row.kind], row);
        for (const row of this.db.prepare('SELECT kind,count(*) AS n FROM visual_reuse_events WHERE scope=? GROUP BY kind').all(scope))
            if (counts[row.kind]) counts[row.kind].reused = row.n;
        return {counts, scope:'current chat', note:'Submitted includes ambiguous attempts; these are task counts, not GPU duration or cost. Cache hits counted since this feature was installed.'};
    }

    public(job) {
        const { scope, graph, ...safe } = job;
        const started = job.history?.find((event) => event.status === 'running')?.at;
        const ended = job.history?.find((event) => ['done', 'failed_final', 'cancelled'].includes(event.status))?.at;
        safe.timing = {
            queueMs: started == null ? null : Math.max(0, started - job.createdAt),
            processingMs: started == null || ended == null ? null : Math.max(0, ended - started),
            totalMs: ended == null ? null : Math.max(0, ended - job.createdAt),
            reused: job.reused === true,
        };
        return clone(safe);
    }
    transition(job, status, patch = {}) {
        Object.assign(job, patch, { status });
        job.history.push({ status, at: Date.now() });
        return this.save(job);
    }
    get(scope, id, raw = false) {
        const row = this.db.prepare('SELECT data_json FROM visual_jobs WHERE scope=? AND id=?').get(scope, id);
        if (!row) fail('Visual job not found', 404);
        const job = JSON.parse(row.data_json);
        return raw ? job : this.public(job);
    }
    list(scope) {
        return this.db
            .prepare('SELECT data_json FROM visual_jobs WHERE scope=? ORDER BY updated_at DESC LIMIT 30')
            .all(scope)
            .map((row) => this.public(JSON.parse(row.data_json)));
    }
    endpoint(value) {
        const raw = value || this.config.comfyUrl;
        if (!raw) fail('ComfyUI is not configured', 503);
        let url;
        try {
            url = new URL(raw);
        } catch {
            fail('Invalid ComfyUI URL');
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            fail('ComfyUI URL must be HTTP(S), without credentials, query or fragment');
        }
        return url.href.replace(/\/$/, '');
    }
    async inventory(endpoint, refresh = false) {
        const key = this.endpoint(endpoint);
        const cached = this.inventoryCache.get(key);
        if (!refresh && cached && Date.now() - cached.at < 60000) return cached.value;
        const value = await this.api('/object_info', undefined, false, key);
        if (!value || typeof value !== 'object' || !Object.keys(value).length) fail('Invalid ComfyUI inventory', 502);
        if (this.inventoryCache.size >= 8) this.inventoryCache.delete(this.inventoryCache.keys().next().value);
        this.inventoryCache.set(key, { at: Date.now(), value });
        return value;
    }
    async capabilities(endpoint) {
        const inventory = await this.inventory(endpoint, true);
        return {
            ...summarizeInventory(inventory),
            checkedAt: new Date().toISOString(),
            workflows: [...new Set(['scene_full', 'background', 'scene_integrated', 'background_integrated', 'sprite_integrated', 'scene_anima', 'background_anima', 'sprite_anima', ...Object.keys(this.recipes)])],
        };
    }
    async checkWorkflow(input) {
        const recipe = userRecipe(input);
        if (input.checkpoint !== undefined && typeof input.checkpoint !== 'string') fail('Checkpoint must be text');
        if (recipe.checkpointBinding && input.checkpoint?.trim()) {
            const {node, input: field} = recipe.checkpointBinding;
            recipe.workflow[node].inputs[field] = input.checkpoint.trim();
        }
        // Inventory lookup only: no enqueue, uploads, compilation or /prompt request.
        const inventory = await this.inventory(input.endpoint, true);
        const errors = checkGraph(recipe.workflow, inventory);
        if (!inventory[recipe.workflow[recipe.outputNode].class_type]?.output_node)
            errors.push(`${recipe.outputNode}: selected image output is not an output node`);
        return {
            ok: errors.length === 0, errors, checkedAt: new Date().toISOString(),
            scope: 'saved-graph-inventory',
            note: 'Checks saved graph values and the selected checkpoint only. Scene bindings, character LoRAs and generated image quality require generation-time validation. No job was created.',
        };
    }
    async uploadAnchor(job) {
        return this.uploadReference(job, job.expressionAnchor, true);
    }
    async uploadReference(job, anchor, flatten = false) {
        const original = this.assets.image(job.scope, anchor.assetId).bytes;
        const bytes = flatten ? uploadImage(original) : original;
        const boundary = 'ne-' + crypto.randomUUID();
        const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${anchor.filename}"\r\nContent-Type: image/png\r\n\r\n`),
            bytes, Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`),
        ]);
        const checked = await this.validate(job.endpoint, this.config.allowHosts);
        const url = new URL(checked.url); url.pathname = url.pathname.replace(/\/$/,'') + '/upload/image';
        const result = await this.request(url, {method:'POST',headers:{
            'content-type':`multipart/form-data; boundary=${boundary}`, 'content-length':body.length,
            ...(this.config.comfyKey && this.endpoint(job.endpoint)===this.endpoint(this.config.comfyUrl) ? {authorization:`Bearer ${this.config.comfyKey}`} : {}),
        }}, body, checked.addresses, this.config.timeoutMs, this.controllers);
        if (result.name !== anchor.filename || (result.subfolder || '') !== '') throw Error('Reference upload returned an unexpected filename');
    }
    async preflight(job) {
        if (job.layerGuidance) {
            // Fetch every asset before the first upload, so missing local references fail without partial transfer.
            for (const ref of job.layerGuidance.references) this.assets.image(job.scope, ref.assetId);
            for (const ref of job.layerGuidance.references) await this.uploadReference(job, ref);
            this.inventoryCache.delete(this.endpoint(job.endpoint));
        }
        if (job.expressionAnchor) {
            await this.uploadAnchor(job);
            this.inventoryCache.delete(this.endpoint(job.endpoint));
        }
        const errors = checkGraph(job.graph, await this.inventory(job.endpoint));
        if (errors.length) fail(errors.slice(0, 20).join('; '));
    }
    enqueue(scope, input) {
        validateId(input.requestKey, 'requestKey');
        validateId(input.workflow, 'workflow');
        if (
            !input.scene ||
            !/^[a-f0-9]{64}$/.test(input.scene.sceneId) ||
            !Array.isArray(input.scene.characters) ||
            JSON.stringify(input.scene).length > 200000
        )
            fail('Invalid visual scene');
        if (input.endpoint) this.endpoint(input.endpoint);
        if (input.operation && !['illustration', 'background', 'sprite'].includes(input.operation))
            fail('Unsupported visual operation');
        if (
            input.operation === 'sprite' &&
            (input.scene.characters.length !== 1 || input.characterId !== input.scene.characters[0].id)
        )
            fail('Sprite needs exactly one matching character');
        if (input.operation === 'background' && input.scene.characters.length)
            fail('Background scene must not include characters');
        if (input.operation && input.operation !== 'illustration' && !/^[a-f0-9]{64}$/.test(input.resourceInput || ''))
            fail('Layer needs a resource input hash');
        const old = this.db
            .prepare('SELECT data_json FROM visual_jobs WHERE scope=? AND request_key=?')
            .get(scope, input.requestKey);
        if (old) {
            const job = JSON.parse(old.data_json);
            if (job.scene.sceneId !== input.scene.sceneId || job.workflow !== input.workflow)
                fail('Request key conflict', 409);
            return this.public(job);
        }
        if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) fail('Invalid seed');
        if (
            Object.keys(input.stages || {}).some((k) => !['controlnet', 'ipadapter', 'mask'].includes(k)) ||
            Object.values(input.stages || {}).some((v) => typeof v !== 'boolean')
        )
            fail('Invalid processing stages');
        for (const c of input.scene.characters)
            if (c.profile?.compatibleWorkflows?.length && !c.profile.compatibleWorkflows.includes(input.workflow))
                fail(`Workflow incompatible with ${c.id}`);
        const job = {
            id: crypto.randomUUID(),
            scope,
            requestKey: input.requestKey,
            scene: clone(input.scene),
            workflow: input.workflow,
            seed: input.seed,
            stages: clone(input.stages || {}),
            status: 'queued',
            history: [
                { status: 'requested', at: Date.now() },
                { status: 'queued', at: Date.now() },
            ],
            createdAt: Date.now(),
            attempts: 0,
            nextPoll: 0,
            outputs: [],
            endpoint: input.endpoint ? this.endpoint(input.endpoint) : this.config.comfyUrl || null,
            endpointSelection: input.endpoint || '',
            automatic: input.automatic === true,
            operation: input.operation || 'illustration',
            generationKey: input.generationKey || null,
            forceLayers: input.forceLayers === true,
            guided: false, reason: typeof input.fallbackReason === 'string' ? input.fallbackReason.slice(0,300) : 'fresh requested',
            illustrationSource: input.illustrationSource === 'layers' ? 'layers' : 'fresh',
            fallbackReason: typeof input.fallbackReason === 'string' ? input.fallbackReason.slice(0,300) : null,
            selectionId: input.selectionId || null,
            resourceInput: input.resourceInput || null,
            characterId: input.characterId || null,
            backgroundPolicy: input.operation === 'background' ? input.backgroundPolicy || null : null,
            backgroundDecision: input.operation === 'background' ? String(input.backgroundDecision || '').slice(0,200) : null,
        };
        try {
            if (input.customRecipe && !String(input.workflow).startsWith('user-')) fail('Imported recipes cannot override built-in or server workflows');
            const recipe = String(input.workflow).startsWith('user-')
                ? userRecipe(input)
                : this.recipes[input.workflow] || builtinRecipe(input.workflow, input);
            if (job.operation === 'sprite' && (recipe?.operation !== 'sprite' || !recipe.outputNode))
                fail(
                    'Sprite requires a dedicated recipe with operation: sprite, outputNode and transparent PNG output',
                );
            // Reference filenames/rectangles are always server-owned, never supplied by the job caller.
            const generation = { ...input, expressionAnchor: undefined, layerGuidance: undefined };
            if (recipe?.guidance === 'layers') {
                job.illustrationSource = 'layers';
                job.guided = true; job.reason = null;
                job.layerGuidance = resolveLayerGuidance(this.assets, scope, input, recipe);
                generation.layerGuidance = job.layerGuidance;
            } else if (input.layerReferences !== undefined) {
                fail('Selected workflow does not support layer guidance');
            }
            if (job.operation === 'sprite' && recipe.adapter === 'integrated-v1') {
                job.anchorKey = anchorKey(input, recipe);
                if (input.localExpressions === true) job.expressionAnchor = this.anchors.find(scope, job.anchorKey);
                if (job.expressionAnchor) generation.expressionAnchor = job.expressionAnchor;
            }
            job.graph = buildWorkflow(recipe, generation);
            job.autoAnchor = Boolean(job.anchorKey && !job.expressionAnchor && input.localExpressions === true && input.faceDetector && job.graph['902']);
            job.outputNode = recipe.outputNode || null;
            job.recipeVersion = recipe.version || 1;
            if (job.outputNode && !Object.hasOwn(job.graph, job.outputNode))
                fail('Recipe outputNode is missing from graph');
            job.prompts = compilePrompts(input.scene, {
                profile: input.promptProfile || recipe?.promptProfile,
                animaVariant: input.animaVariant,
                userPositive: input.userPositive, userNegative: input.userNegative,
                operation: input.operation,
                composition: input.composition,
            });
            job.resourceKey = resourceKey(job);
            if (job.operation !== 'illustration') {
                let asset = this.assets.find(scope, job.resourceKey);
                if (!asset) {
                    asset = reuseLegacyBackground(this,scope,job,recipe,input);
                    if(asset) job.backgroundDecision = 'reused cached (verified legacy background; may include old objects)';
                }
                if (!asset && job.expressionAnchor?.expression &&
                    JSON.stringify(job.expressionAnchor.expression) === JSON.stringify({emotion:input.scene.characters[0].emotion || '', expressed:input.scene.characters[0].expressed || []}))
                    asset = this.assets.metadata(scope,job.expressionAnchor.assetId);
                if (asset) {
                    job.status = 'done';
                    job.asset = asset;
                    job.outputs = [{ assetId: asset.id }];
                    job.reused = true;
                    job.history.push({ status: 'done', at: Date.now() });
                }
            }
            if (job.operation === 'background' && !job.reused && !job.backgroundDecision?.startsWith('requested'))
                job.backgroundDecision = 'requested (no ready background for chosen inputs)';
            job.prompts.negativeBound = recipe.adapter === 'integrated-v1' || (recipe.bindings || []).some((binding) => binding.source === 'negative');
        } catch (error) {
            job.status = 'failed_final';
            job.error = error.message;
            job.history.push({ status: job.status, at: Date.now() });
        }
        return this.db.transaction(() => {
            let selected = job.reused ? job : null;
            if (!selected && job.status === 'queued' && job.operation !== 'illustration') {
                const candidates = this.db.prepare("SELECT data_json FROM visual_jobs WHERE scope=? AND status IN ('queued','running','failed','failed_final') AND json_extract(data_json,'$.resourceKey')=? ORDER BY CASE WHEN status='failed_final' THEN 1 ELSE 0 END, updated_at DESC").all(scope,job.resourceKey);
                for (const row of candidates) {
                    const existing = JSON.parse(row.data_json);
                    if (existing.resourceKey !== job.resourceKey) continue;
                    const active = ['queued', 'running', 'failed'].includes(existing.status);
                    const uncertain = existing.status === 'failed_final' &&
                        (existing.submissionUnknown || /acceptance.*unknown/i.test(existing.error || ''));
                    if (active || ((uncertain || input.automatic === true) && input.retry !== true)) { selected = existing; break; }
                }
            }
            // A lookup may attach to saved/running work, but never schedules GPU work.
            if (input.lookupOnly === true) {
                return this.public(selected || { ...job, status: 'cancelled', error: 'No existing layer task or asset' });
            }
            if (input.automatic && (selected || job.status === 'queued')) {
                for (const row of this.db.prepare("SELECT data_json FROM visual_jobs WHERE scope=? AND status='queued'").all(scope)) {
                    const prior = JSON.parse(row.data_json);
                    if (prior.id !== selected?.id && prior.automatic && prior.operation === job.operation && prior.characterId === job.characterId)
                        this.transition(prior, 'cancelled', { error: 'Superseded by a newer automatic scene' });
                }
            }
            if (selected) {
                if (selected.reused) this.db.prepare('INSERT OR IGNORE INTO visual_reuse_events VALUES(?,?,?)')
                    .run(scope,input.requestKey,selected.expressionAnchor ? 'local_expression' : selected.operation);
                return this.public(selected);
            }
            if (
                job.status === 'queued' &&
                this.db
                    .prepare(
                        "SELECT count(*) AS n FROM visual_jobs WHERE scope=? AND status IN ('queued','requested','running','failed')",
                    )
                    .get(scope).n >= 10
            ) {
                fail('Visual queue limit reached', 429);
            }
            return this.save(job);
        })();
    }
    async api(route, body, binary = false, endpoint = this.config.comfyUrl) {
        if (!endpoint) fail('ComfyUI is not configured', 503);
        const checked = await this.validate(endpoint, this.config.allowHosts);
        const url = new URL(checked.url);
        const routeUrl = new URL(route, 'http://local/');
        url.pathname = url.pathname.replace(/\/$/, '') + routeUrl.pathname;
        url.search = routeUrl.search;
        const text = body === undefined ? undefined : JSON.stringify(body);
        return this.request(
            url,
            {
                method: text ? 'POST' : 'GET',
                headers: {
                    ...(text ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } : {}),
                    ...(this.config.comfyKey && this.endpoint(endpoint) === this.endpoint(this.config.comfyUrl)
                        ? { authorization: `Bearer ${this.config.comfyKey}` }
                        : {}),
                },
            },
            text,
            checked.addresses,
            this.config.timeoutMs,
            this.controllers,
            binary,
        );
    }
    async tick() {
        if (this.busy || this.closed) return;
        this.busy = true;
        try {
            this.historyMaintenance.run();
            const active = this.db
                .prepare(
                    "SELECT data_json FROM visual_jobs WHERE status IN ('queued','running','failed') ORDER BY updated_at ASC",
                )
                .all()
                .map((row) => JSON.parse(row.data_json));
            const inflight = active.filter((job) => ['running', 'failed'].includes(job.status));
            const job =
                inflight.find((job) => job.nextPoll <= Date.now()) ||
                (inflight.length < (this.config.visualConcurrency || 1)
                    ? active.find((job) => job.status === 'queued')
                    : null);
            if (!job) return;
            if (Date.now() - job.createdAt > (this.config.visualJobTimeoutMs || 600000))
                return this.transition(job, 'failed_final', { error: 'Visual job deadline exceeded' });
            if (job.status === 'queued') {
                try {
                    await this.preflight(job);
                } catch (error) {
                    return this.transition(job, 'failed_final', { error: `Preflight: ${error.message}` });
                }
                if (this.closed || this.get(job.scope, job.id).status !== 'queued') return;
                this.transition(job, 'running', { submissionPending: true });
                try {
                    const response = await this.api(
                        '/prompt',
                        { prompt: job.graph, client_id: job.id },
                        false,
                        job.endpoint || this.config.comfyUrl,
                    );
                    if (
                        typeof response.prompt_id !== 'string' ||
                        response.error ||
                        Object.keys(response.node_errors || {}).length
                    )
                        throw new Error('ComfyUI rejected workflow');
                    this.transition(job, 'running', {
                        submissionPending: false,
                        promptId: response.prompt_id,
                        nextPoll: Date.now() + 1000,
                    });
                } catch {
                    this.transition(job, 'failed_final', {
                        error: 'Submission failed; remote acceptance may be unknown. Not resubmitted.',
                        submissionUnknown: true,
                    });
                }
            } else {
                try {
                    const history = await this.api(
                        `/history/${encodeURIComponent(job.promptId)}`,
                        undefined,
                        false,
                        job.endpoint || this.config.comfyUrl,
                    );
                    const result = history[job.promptId];
                    if (result?.status?.status_str === 'error')
                        return this.transition(job, 'failed_final', { error: 'ComfyUI execution failed' });
                    if (result?.status?.completed) {
                        const outputs = (
                            job.outputNode
                                ? [result.outputs?.[job.outputNode] || {}]
                                : Object.values(result.outputs || {})
                        )
                            .flatMap((v) => v.images || [])
                            .filter((v) => typeof v.filename === 'string' && v.type === 'output')
                            .map((v) => ({ filename: v.filename, subfolder: v.subfolder || '', type: 'output' }))
                            .slice(0, 8);
                        if (outputs.length && job.operation !== 'illustration') {
                            const image = await this.api(
                                '/view?' + new URLSearchParams(outputs[0]),
                                undefined,
                                true,
                                job.endpoint || this.config.comfyUrl,
                            );
                            try {
                                const bytes = job.expressionAnchor
                                    ? preserveOutsideFace(this.assets.image(job.scope, job.expressionAnchor.assetId).bytes, image.bytes, job.expressionAnchor.face)
                                    : image.bytes;
                                job.asset = this.assets.put(job, bytes);
                            } catch (error) {
                                return this.transition(job, 'failed_final', { error: error.message });
                            }
                            if (job.autoAnchor && !this.anchors.find(job.scope,job.anchorKey)) {
                                try {
                                    const maskOutput=result.outputs?.['902']?.images?.find(v=>v.type==='output');
                                    if(!maskOutput) throw Error('Face detector returned no mask');
                                    const mask=await this.api('/view?'+new URLSearchParams(maskOutput),undefined,true,job.endpoint || this.config.comfyUrl);
                                    this.anchors.pin(job.scope,job.asset.id,detectedFace(mask.bytes,job.asset.width,job.asset.height));
                                } catch(error) { job.anchorWarning=error.message; }
                            }
                            outputs.splice(0, outputs.length, { assetId: job.asset.id });
                        }
                        return this.transition(job, outputs.length ? 'done' : 'failed_final', {
                            outputs,
                            error: outputs.length ? null : 'Workflow completed without images',
                        });
                    }
                    this.transition(job, 'running', { attempts: 0, nextPoll: Date.now() + 2000 });
                } catch {
                    job.attempts++;
                    this.transition(job, job.attempts >= 3 ? 'failed_final' : 'failed', {
                        error: 'ComfyUI history unavailable',
                        nextPoll: Date.now() + Math.min(2000 * 2 ** job.attempts, 30000),
                    });
                }
            }
        } finally {
            this.busy = false;
        }
    }
    async image(scope, id, index) {
        const job = this.get(scope, id, true),
            output = job.outputs[index];
        if (job.status !== 'done' || !output) fail('Image not available', 404);
        if (output.assetId) return this.assets.image(scope, output.assetId);
        return this.api('/view?' + new URLSearchParams(output), undefined, true, job.endpoint || this.config.comfyUrl);
    }
    start() {
        this.timer = setInterval(() => this.tick().catch(() => {}), 1000);
        this.timer.unref?.();
    }
    close() {
        this.closed = true;
        clearInterval(this.timer);
        for (const c of this.controllers) c.abort();
    }
}
module.exports = { VisualQueue, buildWorkflow };
