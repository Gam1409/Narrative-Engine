import { illustrationSource, MissingIllustrationLayers } from './illustration.js';
import { prepareBackground } from './background.js';
import { selectedRecipe } from './workflows.js';
import { VisualIntentPlanner } from './intent.js';
import { illustrationMilestone } from './cadence.js';
import { planLayers, composeLayers } from './layers.js';
import { describeScene, visualProfile } from './scene.js';
import { cardProfiles } from './cards.js';
import { canonicalStringify } from '../utils/object.js';
import { textHash } from '../memory/semantic.js';
import { getContext, getChatFingerprint } from '../context/stContext.js';
import { latestStatus } from '../state/history.js';

const TERMINAL = new Set(['done', 'failed_final', 'cancelled']);

export class VisualDirector {
    constructor(runtime, { fetchImpl = globalThis.fetch } = {}) {
        this.runtime = runtime;
        this.intentPlanner = new VisualIntentPlanner();
        this.fetch = (...args) => fetchImpl.call(globalThis, ...args);
        this.closed = false;
        this.lastScene = null;
        this.waiters = new Map();
        this.submissions = Promise.resolve();
        this.backgroundPlanning = Promise.resolve();
        this.lastAutomaticAt = 0;
        this.deferred = null;
    }

    key() {
        return `${this.runtime.stateManager.prefix}:visual-profiles`;
    }

    async profiles() {
        const runtime = this.runtime;
        const stored = runtime.stateManager.visualProfiles ?? (await runtime.storage.getItem(this.key())) ?? {};
        return cardProfiles(getContext(), runtime.stateManager.snapshot(), stored);
    }

    async setProfile(value) {
        const profile = visualProfile(value);
        const runtime = this.runtime,
            state = runtime.stateManager.snapshot();
        if (
            !state.entities?.[profile.entityId] &&
            !state.characters?.[profile.entityId] &&
            !runtime.participants.some((p) => p.name === profile.entityId)
        ) {
            throw new Error('Profile must refer to an existing entity or participant');
        }
        const profiles = await this.profiles();
        profiles[profile.entityId] = profile;
        if (runtime.stateManager.commit) await runtime.stateManager.commit({ visualProfiles: profiles });
        else await runtime.storage.setItem(this.key(), profiles);
        runtime.spriteManifests.visualProfiles = profiles;
        return profile;
    }

    async scene({intent = true, forceBackground = false} = {}) {
        const runtime = this.runtime,
            manager = runtime.stateManager;
        const context = getContext(), fingerprint = getChatFingerprint(context), head = manager.state;
        const state = manager.snapshot();
        const tail = manager.deltas.findLast((d) => d.source !== 'author' && d.messageIndex >= 0);
        const scene = await describeScene(
            state,
            runtime.participants,
            await this.profiles(),
            this.lastScene,
            tail?.messageRef || null,
        );
        scene.canonVersion = manager.canonVersion || 0;
        const planning = this.backgroundPlanning.then(async () => {
            const active = () => manager === runtime.stateManager && manager.state === head && getChatFingerprint(getContext()) === fingerprint && !this.closed;
            if (!active()) throw Error('Scene changed while planning background');
            const prepared = await prepareBackground(scene, runtime.settings, context.chatMetadata?.narrative_engine_backgrounds, {
                turns: manager.deltas.filter(d => d.source !== 'author' && d.messageIndex >= 0).map(d => d.deltaId || d.idempotencyKey).filter(Boolean),
                force: forceBackground,
            });
            if (!active()) throw Error('Scene changed while planning background');
            context.chatMetadata ||= {};
            context.chatMetadata.narrative_engine_backgrounds = prepared.ledger;
            return prepared;
        });
        this.backgroundPlanning = planning.then(() => {}, () => {});
        const prepared = await planning;
        scene.background = prepared.background;
        scene.backgroundId = prepared.background.id;
        return intent ? this.directScene(scene, manager) : scene;
    }

    directScene(scene, manager) {
        const runtime = this.runtime;
        return runtime.settings.visualLlmIntent
            ? this.intentPlanner.prepare(scene, runtime.provider, runtime.settings.visualPromptProfile, manager.prefix, runtime.diagnostics)
            : scene;
    }

    async api(path, body) {
        const response = await this.fetch(`/api/plugins/narrative-engine/visual/${path}`, {
            method: body ? 'POST' : 'GET',
            headers: { ...getContext().getRequestHeaders?.(), 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.error || `Visual service returned HTTP ${response.status}`);
        }
        return response.json();
    }

    capabilities() {
        return this.api('capabilities', { endpoint: this.runtime.settings.visualEndpoint });
    }

    checkWorkflow(item) {
        return this.api('check-workflow', {
            workflow: item.id, customRecipe: item.recipe, operation: item.recipe.operation,
            endpoint: this.runtime.settings.visualEndpoint,
            checkpoint: this.runtime.settings.visualCheckpoint,
        });
    }

    matches(job, scene) {
        const manager = this.runtime.stateManager,
            key = job.scene.messageRef?.idempotencyKey;
        if (manager.pending.length || scene.sceneId !== job.scene.sceneId) return false;
        if (job.scene.canonVersion !== undefined && job.scene.canonVersion !== scene.canonVersion) return false;
        if (!key) return true;
        const delta = manager.deltas.find((d) => d.idempotencyKey === key);
        if (!delta) return false;
        const record = manager.records?.findLast((record) => record.deltaId === delta.deltaId);
        return !record || latestStatus(manager.decisions || [], record.deltaId) === 'confirmed';
    }

    async generationKey(scene, workflow, settings, forceLayers = false) {
        if (forceLayers) settings = {...settings, visualIllustrationSource:'layers'};
        return textHash(
            canonicalStringify({
                scene: scene.sceneId,
                workflow,
                customRecipe: selectedRecipe(settings, workflow),
                selectedWorkflow: settings.visualWorkflow,
                partialWorkflow: settings.visualPartialWorkflow,
                partial: settings.visualPartial === true,
                endpoint: settings.visualEndpoint || '',
                checkpoint: settings.visualCheckpoint || '',
                profile: settings.visualPromptProfile || 'sdxl',
                animaVariant: settings.visualPromptProfile === 'anima' ? settings.visualAnimaVariant || 'base' : null,
                stages: settings.visualStages || {},
                composition: {style: settings.visualStyle || '', camera: settings.visualCamera || scene.visualCamera || ''},
                modelFiles: {textEncoder: settings.visualTextEncoder || '', vae: settings.visualVae || ''},
                userPositive: settings.visualPositive || '', userNegative: settings.visualNegative || '',
                ...(settings.visualIllustrationSource && settings.visualIllustrationSource !== 'fresh' ? {
                    illustrationSource: settings.visualIllustrationSource,
                    guidance: await illustrationSource(scene, settings, getContext().chatMetadata?.narrative_engine_layers),
                } : {}),
                compiler: 4,
            }),
        );
    }

    request(options = {}) {
        const task = this.submissions.then(() => this.submit(options));
        this.submissions = task.catch(() => {});
        return task;
    }

    async submit({ automatic = false, layers = false, resumeOnly = false, backgroundOnly = false, forceBackground = false, illustrationTicket = null, fromLayers = false } = {}) {
        const runtime = this.runtime,
            context = getContext(),
            fingerprint = getChatFingerprint(context);
        const manager = runtime.stateManager;
        const active = () =>
            !this.closed && manager === runtime.stateManager && getChatFingerprint(getContext()) === fingerprint;
        if (!runtime.settings.visualEnabled) return { skipped: 'Visual generation is disabled' };
        if (manager.pending.length) return { skipped: 'World state is pending reconciliation' };
        const settings = structuredClone(runtime.settings);
        if (fromLayers) settings.visualIllustrationSource = 'layers';
        // Observe each accepted turn before cooldown; reads/polls never count as new turns.
        const backgroundScene = await this.scene({intent:false, forceBackground});
        if (!active()) return { skipped: 'Scene changed' };
        await context.saveMetadata?.();
        const cooldown = Math.max(0, settings.visualCooldownMs ?? 15000);
        if (automatic && !illustrationTicket && Date.now() - this.lastAutomaticAt < cooldown) {
            if (!this.deferred) {
                this.deferred = setTimeout(
                    () => {
                        this.deferred = null;
                        if (active() && runtime.settings.visualAutomatic)
                            this.request({ automatic: true }).catch((error) =>
                                runtime.diagnostics.error(error, 'visual'),
                            );
                    },
                    cooldown - (Date.now() - this.lastAutomaticAt),
                );
                this.deferred.unref?.();
            }
            return { skipped: 'Latest scene deferred until cooldown ends' };
        }
        // Match the viewer's directed scene identity while retaining the manual
        // background decision; another observation would replace its reason.
        const scene = backgroundOnly ? await this.directScene(backgroundScene, manager) : await this.scene();
        if (!active()) return { skipped: 'Scene changed' };
        if (layers || backgroundOnly || (automatic && !illustrationTicket && settings.visualLayers)) {
            if (automatic) this.lastAutomaticAt = Date.now();
            return this.submitLayers(scene, settings, context, fingerprint, manager, active, { automatic, resumeOnly, backgroundOnly });
        }
        if (automatic && settings.visualIllustrationPolicy === 'manual')
            return { skipped: 'Illustrations are manual only' };
        if (illustrationTicket && this.illustrationTicket !== illustrationTicket)
            return {skipped: 'Illustration request superseded'};
        const ticket = illustrationTicket || crypto.randomUUID();
        this.illustrationTicket = ticket;
        if (!illustrationTicket) delete context.chatMetadata.narrative_engine_illustration_wait;
        let source;
        try {
            source = await illustrationSource(scene, settings, context.chatMetadata.narrative_engine_layers);
        } catch (error) {
            if (!(error instanceof MissingIllustrationLayers) || settings.visualLayersNotReady === 'fail' || illustrationTicket)
                throw error;
            return this.deferIllustration(scene, settings, context, fingerprint, manager, active, automatic, ticket, fromLayers);
        }
        const history = await this.api(`jobs/${fingerprint}`);
        if (automatic && settings.visualIllustrationPolicy === 'significant' && source.source === 'fresh' && !source.fallbackReason) {
            const latest = history.find((job) => job.status !== 'cancelled' &&
                (!job.operation || job.operation === 'illustration') &&
                (job.endpointSelection || '') === (settings.visualEndpoint || ''));
            if (latest && illustrationMilestone(latest.scene) === illustrationMilestone(scene) &&
                latest.generationKey === await this.generationKey(latest.scene, latest.workflow, settings))
                return { skipped: 'No significant illustration change' };
        }
        const prior = history.find(
            (job) =>
                job.status === 'done' &&
                (!job.operation || job.operation === 'illustration') &&
                job.scene.location.id === scene.location.id &&
                (job.endpointSelection || '') === (settings.visualEndpoint || ''),
        );
        const workflow = source.source === 'layers' ? 'scene_layered' : settings.visualPartial && prior ? settings.visualPartialWorkflow : settings.visualWorkflow;
        if (!workflow) throw new Error('Choose a configured visual workflow');
        const generationKey = await this.generationKey(scene, workflow, settings);
        if (
            automatic &&
            history.some(
                (job) =>
                    job.status !== 'cancelled' &&
                    this.matches(job, scene) &&
                    (job.generationKey ? job.generationKey === generationKey : job.workflow === workflow),
            )
        ) {
            return { skipped: 'Scene already requested' };
        }
        if (!active() || !this.matches({ scene }, await this.scene())) return { skipped: 'Scene changed' };
        const currentKey = await this.generationKey(scene, workflow, runtime.settings, fromLayers);
        if (currentKey !== generationKey) return { skipped: 'Visual settings changed' };
        scene.changesSincePrevious = ['location', 'characters', 'keyObjects'].filter(
            (key) => canonicalStringify(scene[key]) !== canonicalStringify(prior?.scene?.[key]),
        );
        const seed = settings.visualKeepSeed && prior ? prior.seed : crypto.getRandomValues(new Uint32Array(1))[0];
        const requestKey = automatic
            ? await textHash(canonicalStringify({ generationKey, origin: scene.messageRef, canon: scene.canonVersion }))
            : crypto.randomUUID();
        const selectionId = crypto.randomUUID();
        context.chatMetadata.narrative_engine_visual_selection = selectionId;
        await context.saveMetadata?.();
        const finalHead = manager.state;
        const finalScene = await this.scene();
        if (!active() || this.illustrationTicket !== ticket || manager.pending.length || manager.state !== finalHead ||
            !this.matches({scene}, finalScene) || generationKey !== await this.generationKey(finalScene, workflow, runtime.settings, fromLayers))
            return {skipped: 'Scene, references or settings changed'};
        if (!active() || manager.state !== finalHead || manager.pending.length) return {skipped: 'Scene changed'};
        const job = await this.api('jobs', {
            chatId: fingerprint,
            requestKey,
            generationKey,
            selectionId,
            automatic,
            workflow,
            customRecipe: selectedRecipe(settings, workflow),
            scene,
            seed,
            stages: source.source === 'layers' ? {} : settings.visualStages,
            forceLayers: fromLayers,
            illustrationSource: source.source,
            fallbackReason: source.fallbackReason || null,
            ...(source.source === 'layers' ? {layerReferences: source.layerReferences, layerCamera: source.layerCamera, layerDenoise: source.layerDenoise} : {}),
            endpoint: settings.visualEndpoint || '',
            checkpoint: settings.visualCheckpoint || '',
            promptProfile: settings.visualPromptProfile || 'sdxl',
            animaVariant: settings.visualAnimaVariant || 'base',
            composition: {style: settings.visualStyle || '', camera: settings.visualCamera || scene.visualCamera || ''},
            modelFiles: {textEncoder: settings.visualTextEncoder || '', vae: settings.visualVae || ''},
            userPositive: settings.visualPositive || '', userNegative: settings.visualNegative || '',
            previous: prior?.outputs?.[0] || null,
        });
        // Idempotent jobs keep the original publication token.
        if (active()) context.chatMetadata.narrative_engine_visual_selection = job.selectionId || selectionId;
        this.lastScene = scene;
        if (automatic) this.lastAutomaticAt = Date.now();
        if (active())
            this.follow(job, context, fingerprint, manager).catch((error) =>
                runtime.diagnostics.error(error, 'visual'),
            );
        return job;
    }

    async deferIllustration(scene, settings, context, fingerprint, manager, active, automatic, ticket, fromLayers = false) {
        if (scene.characters.length && !settings.visualSpriteWorkflow)
            throw Error('Choose a transparent sprite workflow before waiting for character layers');
        context.chatMetadata.narrative_engine_visual_selection = ticket;
        const deadline = Date.now() + Math.max(10000, Math.min(600000, settings.visualLayersTimeoutMs ?? 120000));
        const initialPlans = await planLayers(scene, settings);
        const signature = canonicalStringify([settings, initialPlans.map(plan => plan.layerKey)]);
        const setStatus = async (status, reason = '') => {
            if (!active() || this.illustrationTicket !== ticket) return;
            context.chatMetadata.narrative_engine_illustration_wait = {ticket, status, reason, deadline};
            await context.saveMetadata?.();
        };
        await setStatus('waiting', 'Building missing scene layers');
        await this.submitLayers(scene, settings, context, fingerprint, manager, active, {automatic, missingOnly:true});
        const run = async () => {
            while (active() && this.illustrationTicket === ticket) {
                if (Date.now() >= deadline) throw Error('Timed out waiting for illustration layers');
                const now = await this.scene();
                const plans = await planLayers(now, this.runtime.settings);
                if (!this.runtime.settings.visualEnabled || manager.pending.length || !this.matches({scene}, now) ||
                    signature !== canonicalStringify([fromLayers ? {...this.runtime.settings,visualIllustrationSource:'layers'} : this.runtime.settings, plans.map(plan => plan.layerKey)]))
                    throw Error('Scene or settings changed while waiting for layers');
                try {
                    await illustrationSource(now, settings, context.chatMetadata.narrative_engine_layers);
                    await setStatus('ready');
                    // The original request has returned; serialize the resumed submission with new user requests.
                    const job = await this.request({automatic, illustrationTicket:ticket, fromLayers});
                    await setStatus(job.skipped ? 'cancelled' : job.status === 'failed_final' ? 'failed' : 'submitted', job.skipped || job.error || '');
                    return;
                } catch (error) {
                    if (!(error instanceof MissingIllustrationLayers)) throw error;
                    const failed = context.chatMetadata.narrative_engine_layers?.layers?.find(layer => ['failed_final','cancelled'].includes(layer.status));
                    if (failed) throw Error(failed.error || 'A required illustration layer failed');
                }
                await new Promise(resolve => {
                    const timer = setTimeout(() => {this.waiters.delete(timer); resolve();}, 500);
                    timer.unref?.();
                    this.waiters.set(timer, resolve);
                });
            }
        };
        // Do not hold the submission queue or the story turn while layers are generated.
        queueMicrotask(() => run().catch(async error => {
            await setStatus('failed', error.message);
            this.runtime.diagnostics.error(error, 'visual');
        }));
        return {status:'waiting', operation:'illustration', deadline, message:'Waiting for current background and sprites'};
    }

    async submitLayers(scene, settings, context, fingerprint, manager, active, { automatic = false, resumeOnly = false, backgroundOnly = false, missingOnly = false } = {}) {
        const requestedAt = Date.now();
        const plans = await planLayers(scene, settings);
        const token = crypto.randomUUID();
        const current = async () => {
            if (
                !active() ||
                !this.runtime.settings.visualEnabled ||
                context.chatMetadata.narrative_engine_layers_selection !== token
            )
                return false;
            const head = manager.state;
            const now = await this.scene();
            const nextPlans = await planLayers(now, this.runtime.settings);
            return (
                active() &&
                manager.state === head &&
                this.matches({ scene }, now) &&
                context.chatMetadata.narrative_engine_layers_selection === token &&
                canonicalStringify(plans.map(p=>p.layerKey)) === canonicalStringify(nextPlans.map(p=>p.layerKey))
            );
        };
        context.chatMetadata.narrative_engine_layers_selection = token;
        const previousLayers = context.chatMetadata.narrative_engine_layers?.layers || [];
        const jobs = plans.map((plan) => {
            const prior = previousLayers.find(
                (layer) =>
                    layer.slot === plan.slot &&
                    layer.layerKey === plan.layerKey &&
                    layer.status === 'done' &&
                    layer.assetId,
            );
            return prior ? { status: 'done', asset: { id: prior.assetId, resourceKey: prior.resourceKey } } : { status: 'requested' };
        });
        const publish = async () => {
            const head = manager.state;
            if (
                !(await current()) ||
                !active() ||
                manager.state !== head ||
                manager.pending.length ||
                context.chatMetadata.narrative_engine_layers_selection !== token
            )
                return false;
            const composition = composeLayers(scene, plans, jobs, fingerprint);
            const previous = context.chatMetadata.narrative_engine_layers;
            if (
                previous?.sceneId === composition.sceneId &&
                previous?.canonVersion === composition.canonVersion &&
                canonicalStringify(previous.layers) === canonicalStringify(composition.layers)
            )
                return true;
            composition.timing = {
                requestedAt,
                observedAt: Date.now(),
                readyMs: composition.layers.every((layer) => layer.status === 'done') ? Date.now() - requestedAt : null,
            };
            context.chatMetadata.narrative_engine_layers = composition;
            globalThis.dispatchEvent?.(new Event('narrative-engine-layers'));
            await context.saveMetadata?.();
            return true;
        };
        // Remove incompatible old sprites immediately; no old costume is used as a placeholder.
        if (!(await publish())) return { skipped: 'Scene changed' };
        for (const [index, plan] of plans.entries()) {
            if (missingOnly && jobs[index].status === 'done' && jobs[index].asset?.resourceKey) continue;
            if (backgroundOnly && plan.operation !== 'background') continue;
            if (!(await current())) return { skipped: 'Scene changed' };
            try {
                jobs[index] = await this.api('jobs', {
                    ...plan,
                    chatId: fingerprint,
                    automatic: true,
                    requestKey: crypto.randomUUID(),
                    lookupOnly: resumeOnly,
                    retry: !automatic && !resumeOnly,
                });
            } catch (error) {
                jobs[index] = { status: 'failed_final', error: error.message };
            }
        }
        await publish();
        this.followLayers(jobs, publish, current).catch((error) => this.runtime.diagnostics.error(error, 'visual'));
        return { operation: 'layers', jobs };
    }

    async followLayers(jobs, publish, current) {
        for (let count = 0; count < 600 && !this.closed; count++) {
            if (!(await current())) return;
            const pending = jobs.filter((job) => job.id && !TERMINAL.has(job.status));
            if (!pending.length) return;
            await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    this.waiters.delete(timer);
                    resolve();
                }, 2000);
                timer.unref?.();
                this.waiters.set(timer, resolve);
            });
            if (!(await current())) return;
            const fingerprint = getChatFingerprint(getContext());
            try {
                const updates = await this.api('status', { chatId: fingerprint, ids: pending.map((job) => job.id) });
                for (let index = 0; index < jobs.length; index++) {
                    const updated = updates.find((job) => job.id === jobs[index].id);
                    if (updated) jobs[index] = updated;
                }
            } catch (error) {
                this.runtime.diagnostics.error(error, 'visual');
            }
            if (!(await publish())) return;
        }
    }

    async follow(job, context, fingerprint, manager) {
        const runtime = this.runtime;
        const active = () =>
            !this.closed && manager === runtime.stateManager && getChatFingerprint(getContext()) === fingerprint;
        for (let count = 0; count < 600 && active(); count++) {
            this.lastJobStatus = job.status;
            if (TERMINAL.has(job.status)) {
                if (job.status !== 'done' || !job.outputs?.length) return;
                const stateHead = manager.state;
                const current = await this.scene();
                if (!active() || !this.matches(job, current)) return;
                if (job.selectionId && context.chatMetadata.narrative_engine_visual_selection !== job.selectionId)
                    return;
                if (!runtime.settings.visualEnabled) return;
                try {
                    if (job.generationKey && job.generationKey !== await this.generationKey(current, job.workflow, runtime.settings, job.forceLayers)) return;
                } catch { return; } // Missing/stale layers are a normal reason not to publish.
                if (!active() || manager.state !== stateHead || manager.pending.length) return;
                if (job.selectionId && context.chatMetadata.narrative_engine_visual_selection !== job.selectionId)
                    return;
                const previous = context.chatMetadata.narrative_engine_visual;
                if (previous?.createdAt > job.createdAt) return;
                context.chatMetadata.narrative_engine_visual = {
                    ...this.result(job, false, fingerprint),
                    publishedAt: Date.now(),
                    readyMs: Number.isFinite(job.createdAt) ? Math.max(0, Date.now() - job.createdAt) : null,
                };
                await context.saveMetadata?.();
                return;
            }
            await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    this.waiters.delete(timer);
                    resolve();
                }, 2000);
                timer.unref?.();
                this.waiters.set(timer, resolve);
            });
            if (!active()) return;
            job = await this.api(`jobs/${fingerprint}/${job.id}`);
        }
    }

    result(job, stale, fingerprint) {
        return {
            ...job,
            stale,
            images:
                job.status === 'done'
                    ? job.outputs.map(
                          (_, index) =>
                              `/api/plugins/narrative-engine/visual/image/${encodeURIComponent(fingerprint)}/${encodeURIComponent(job.id)}/${index}`,
                      )
                    : [],
        };
    }

    async jobs() {
        const fingerprint = getChatFingerprint(getContext()),
            scene = await this.scene();
        return Promise.all((await this.api(`jobs/${fingerprint}`)).map(async job => {
            let stale = !this.matches(job, scene);
            if (!stale && job.generationKey && (!job.operation || job.operation === 'illustration')) {
                try { stale = job.generationKey !== await this.generationKey(scene, job.workflow, this.runtime.settings, job.forceLayers); }
                catch { stale = true; }
            }
            return this.result(job, stale, fingerprint);
        }));
    }

    async resume() {
        const resumeContext = getContext();
        const waiting = resumeContext.chatMetadata?.narrative_engine_illustration_wait;
        if (waiting?.status === 'waiting' && waiting.ticket !== this.illustrationTicket) {
            waiting.status = 'cancelled';
            waiting.reason = 'Waiting interrupted by reload; request the illustration again';
            await resumeContext.saveMetadata?.();
        }
        if (this.runtime.settings.visualEnabled && this.runtime.settings.visualLayers)
            return this.request({ layers: true, automatic: this.runtime.settings.visualAutomatic === true, resumeOnly: !this.runtime.settings.visualAutomatic });
        const runtime = this.runtime,
            context = getContext(),
            manager = runtime.stateManager;
        const fingerprint = getChatFingerprint(context),
            jobs = await this.jobs();
        const job = jobs.find((item) => !item.stale && !['failed_final', 'cancelled'].includes(item.status));
        if (job && !this.closed)
            this.follow(job, context, fingerprint, manager).catch((error) =>
                runtime.diagnostics.error(error, 'visual'),
            );
    }

    close() {
        this.closed = true;
        this.intentPlanner.close();
        clearTimeout(this.deferred);
        for (const [timer, wake] of this.waiters) {
            clearTimeout(timer);
            wake();
        }
        this.waiters.clear();
    }
}
