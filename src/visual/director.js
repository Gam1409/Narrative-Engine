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

    async scene() {
        const runtime = this.runtime,
            manager = runtime.stateManager;
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

    async generationKey(scene, workflow, settings) {
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
                compiler: 4,
            }),
        );
    }

    request(options = {}) {
        const task = this.submissions.then(() => this.submit(options));
        this.submissions = task.catch(() => {});
        return task;
    }

    async submit({ automatic = false, layers = false, resumeOnly = false } = {}) {
        const runtime = this.runtime,
            context = getContext(),
            fingerprint = getChatFingerprint(context);
        const manager = runtime.stateManager;
        const active = () =>
            !this.closed && manager === runtime.stateManager && getChatFingerprint(getContext()) === fingerprint;
        if (!runtime.settings.visualEnabled) return { skipped: 'Visual generation is disabled' };
        if (manager.pending.length) return { skipped: 'World state is pending reconciliation' };
        const settings = structuredClone(runtime.settings);
        const cooldown = Math.max(0, settings.visualCooldownMs ?? 15000);
        if (automatic && Date.now() - this.lastAutomaticAt < cooldown) {
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
        const scene = await this.scene();
        if (!active()) return { skipped: 'Scene changed' };
        if (layers || (automatic && settings.visualLayers)) {
            if (automatic) this.lastAutomaticAt = Date.now();
            return this.submitLayers(scene, settings, context, fingerprint, manager, active, { automatic, resumeOnly });
        }
        if (automatic && settings.visualIllustrationPolicy === 'manual')
            return { skipped: 'Illustrations are manual only' };
        const history = await this.api(`jobs/${fingerprint}`);
        if (automatic && settings.visualIllustrationPolicy === 'significant') {
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
        const workflow = settings.visualPartial && prior ? settings.visualPartialWorkflow : settings.visualWorkflow;
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
        const currentKey = await this.generationKey(scene, workflow, runtime.settings);
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
        if (!active()) return { skipped: 'Scene changed' };
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
            stages: settings.visualStages,
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

    async submitLayers(scene, settings, context, fingerprint, manager, active, { automatic = false, resumeOnly = false } = {}) {
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
                canonicalStringify(plans) === canonicalStringify(nextPlans)
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
            return prior ? { status: 'done', asset: { id: prior.assetId } } : { status: 'requested' };
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
            const pending = jobs.filter((job) => !TERMINAL.has(job.status));
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
                if (
                    job.generationKey &&
                    job.generationKey !== (await this.generationKey(current, job.workflow, runtime.settings))
                )
                    return;
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
        return (await this.api(`jobs/${fingerprint}`)).map((job) =>
            this.result(job, !this.matches(job, scene), fingerprint),
        );
    }

    async resume() {
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
