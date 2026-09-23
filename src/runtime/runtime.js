import { getChatFingerprint, getContext, createRequestIdentity, recentChat, resolveMessageSpeaker, resolveParticipants, messageId } from '../context/stContext.js';
import { DirectorService } from '../director/service.js';
import { loadStatePromptBundle } from '../director/statePrompts.js';
import { loadSchema } from '../director/schemaLoader.js';
import { buildDirectorPacket } from '../director/packet.js';
import { EpisodicMemoryStore } from '../memory/store.js';
import { createStorageAdapter } from '../memory/storage.js';
import { ServerStorageAdapter } from '../memory/serverStorage.js';
import { createProvider } from '../providers/index.js';
import { safeError } from '../providers/errors.js';
import { getSettings, MODULE_NAME, saveSettings } from '../settings.js';
import { applySpriteDecisions } from '../sprites/integration.js';
import { SpriteManifestStore } from '../sprites/store.js';
import { StateManager } from '../state/manager.js';
import { shouldRunMemoryConsolidation, shouldRunPlotMaintenance, shouldRunWorldSimulation } from '../utils/cadence.js';
import { RequestGate } from '../utils/requestGate.js';
import { validateSchema } from '../utils/schema.js';
import { Diagnostics } from './diagnostics.js';

function byId(items, key) {
    const output = {};
    for (const item of Array.isArray(items) ? items : []) {
        const id = item?.[key] || (key === 'pair' && Array.isArray(item?.pair) ? [...item.pair].sort().join('::') : null);
        if (id) output[id] = item;
    }
    return output;
}

function combineDelta(post, settings) {
    const rawState = post.state_delta || {};
    const delta = settings.continuity || settings.characterState
        ? { ...rawState }
        : Object.fromEntries(Object.entries(rawState).filter(([key]) => ['time_advance_minutes', 'timeline', 'scene'].includes(key)));
    const relationships = byId(post.relationship_delta, 'pair');
    const knowledge = byId(post.knowledge_delta, 'fact_id');
    if (settings.relationships && Object.keys(relationships).length) delta.relationships = relationships;
    if (settings.knowledge && Object.keys(knowledge).length) delta.knowledge = knowledge;
    if (settings.plotManager && post.thread_delta && typeof post.thread_delta === 'object') delta.threads = post.thread_delta;
    if (settings.worldSimulation && post.world_event_delta && typeof post.world_event_delta === 'object') delta.world_events = post.world_event_delta;
    return delta;
}

function highSeverity(audit) {
    return (audit?.errors || []).some((item) => typeof item === 'object'
        ? ['high', 'critical'].includes(String(item.severity).toLowerCase())
        : true);
}

export class NarrativeRuntime {
    constructor() {
        this.diagnostics = new Diagnostics();
        this.gate = new RequestGate();
        this.processed = new Set();
        this.activeGenerationId = null;
        this.spriteState = {};
    }

    async initialize(context = getContext()) {
        this.context = context;
        this.settings = getSettings(context);
        this.storage = this.createStorage(context);
        this.spriteManifests = new SpriteManifestStore({ storage: this.storage });
        await this.loadChat(context);
        this.recreateProvider(context);
        this.diagnostics.update({ status: this.settings.enabled ? 'ready' : 'disabled', provider: this.settings.provider });
        return this;
    }

    async loadChat(context = getContext()) {
        const fingerprint = getChatFingerprint(context);
        const stateSchema = await loadSchema('state');
        this.gate.switchContext({ chatFingerprint: fingerprint, sessionId: String(context.chatId || context.getCurrentChatId?.() || 'no-chat') });
        this.stateManager = new StateManager({
            chatFingerprint: fingerprint, storage: this.storage,
            checkpointEvery: this.settings?.checkpointInterval || 10, validator: (state) => validateSchema(stateSchema, state),
        });
        this.memoryStore = new EpisodicMemoryStore({ storage: this.storage, key: `narrative-engine:${fingerprint}:memories` });
        await Promise.all([this.stateManager.load(), this.memoryStore.load()]);
        this.participants = resolveParticipants(context);
        if (this.stateManager.state.revision === 0) {
            const characters = Object.fromEntries(this.participants
                .filter((participant) => participant.narrativeEngine?.stateDefaults)
                .map((participant) => [participant.name, participant.narrativeEngine.stateDefaults]));
            if (Object.keys(characters).length) {
                await this.stateManager.applyDelta({ characters }, { messageIndex: -1, source: 'character-card', confidence: 1 });
            }
        }
        const manifests = await this.spriteManifests.loadParticipants(this.participants);
        for (const result of manifests) if (result.status === 'rejected') this.diagnostics.error(result.reason, 'sprite-manifest');
        this.processed.clear();
        this.activeGenerationId = null;
        this.diagnostics.update({ lastPacket: '', retrievedMemories: [] });
        await this.persistCompactMetadata(context);
    }

    recreateProvider(context = getContext()) {
        this.provider = createProvider(this.settings, context);
        this.director = new DirectorService(this.provider, this.diagnostics);
        this.diagnostics.update({ provider: this.settings.provider });
    }

    createStorage(context = getContext()) {
        const browser = createStorageAdapter(globalThis.SillyTavern?.libs?.localforage);
        return this.settings.provider === 'server'
            ? new ServerStorageAdapter(context, { fallback: browser })
            : browser;
    }

    updateSettings(patch) {
        const previousProvider = this.settings.provider;
        this.settings = saveSettings(getContext(), { ...this.settings, ...patch });
        this.stateManager.checkpointEvery = this.settings.checkpointInterval;
        this.recreateProvider(getContext());
        if (previousProvider !== this.settings.provider && (previousProvider === 'server' || this.settings.provider === 'server')) {
            this.storage = this.createStorage(getContext());
            this.spriteManifests = new SpriteManifestStore({ storage: this.storage });
            void this.loadChat(getContext()).catch((error) => this.diagnostics.error(error, 'storage-switch'));
        }
        this.diagnostics.update({ status: this.settings.enabled ? 'ready' : 'disabled' });
        return this.settings;
    }

    generationStarted(type, params, dryRun) {
        if (dryRun) return;
        this.activeGenerationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${type}`;
        this.diagnostics.update({ status: this.settings.enabled ? 'preparing' : 'disabled', generationType: type });
    }

    generationStopped() {
        this.gate.invalidate();
        this.activeGenerationId = null;
        this.diagnostics.update({ status: this.settings.enabled ? 'ready' : 'disabled' });
    }

    async preparePacket(outgoingChat, contextSize, type) {
        if (!this.settings.enabled) return null;
        const context = getContext();
        const identity = createRequestIdentity(context, this.activeGenerationId);
        const token = this.gate.begin(identity);
        const current = this.stateManager.snapshot();
        const lastUser = [...(context.chat || [])].reverse().find((message) => message?.is_user);
        const query = {
            message: String(lastUser?.mes || ''),
            characters: Object.keys(current.characters || {}),
            topics: Object.keys(current.threads || {}),
            location: current.scene?.location || '',
        };
        const memories = this.settings.memoryRetrieval ? this.memoryStore.search(query, { topK: this.settings.memoryTopK }) : [];
        const turn = (context.chat || []).filter((message) => message?.is_user).length;
        const dueEvents = Object.values(current.world_events || {}).some((event) => event?.status === 'due');
        const payload = {
            identity, generation_type: type, context_size: contextSize,
            latest_user_message: String(lastUser?.mes || ''),
            recent_messages: recentChat(context, this.settings.recentMessages),
            state: current,
            relevant_memories: memories,
            roles: {
                continuity: this.settings.continuity,
                character_state: this.settings.characterState,
                relationships: this.settings.relationships,
                knowledge: this.settings.knowledge,
                plot_manager: this.settings.plotManager,
                world_simulation: this.settings.worldSimulation,
                scene_planner: true,
            },
            character_director_hints: Object.fromEntries((this.participants || []).map((participant) => [
                participant.name,
                Array.isArray(participant.narrativeEngine?.directorHints) ? participant.narrativeEngine.directorHints : [],
            ])),
            cadence: {
                plot_maintenance: shouldRunPlotMaintenance({ turn, interval: this.settings.plotInterval }),
                world_simulation: shouldRunWorldSimulation({ dueEvent: dueEvents, cadenceDue: turn % 3 === 0 }),
            },
            truth_priority: ['explicit user action', 'recent accepted chat', 'structured state', 'character/world canon', 'episodic memory', 'director inference'],
            user_agency: 'Never invent voluntary user actions, thoughts, dialogue, choices, or decisions.',
        };
        try {
            const promptAddendum = await loadStatePromptBundle(this.settings, 'pre');
            const pre = await this.director.run('pre', payload, {
                identity, signal: token.signal, timeoutMs: this.settings.preDirectorTimeoutMs, promptAddendum,
            });
            this.gate.assertCurrent(token);
            const packet = buildDirectorPacket(pre, this.settings.packetTokenBudget);
            this.diagnostics.update({ status: 'generating', lastPacket: packet, retrievedMemories: memories });
            return packet;
        } catch (error) {
            this.diagnostics.error(error, 'pre');
            this.diagnostics.update({ status: 'degraded', lastPacket: '' });
            return null;
        } finally {
            this.gate.finish(token);
        }
    }

    async processPost(messageIndex, type) {
        if (!this.settings.enabled) return;
        const context = getContext();
        const message = context.chat?.[messageIndex];
        if (!message || message.is_user || message.is_system) return;
        const stableMessageId = messageId(message, messageIndex);
        if (this.processed.has(stableMessageId)) return;
        this.processed.add(stableMessageId);
        const identity = createRequestIdentity(context, this.activeGenerationId);
        const token = this.gate.begin(identity);
        const stateBefore = this.stateManager.snapshot();
        const lastUser = [...context.chat.slice(0, messageIndex)].reverse().find((item) => item?.is_user);
        const sceneChanged = stateBefore.scene?.location && message.extra?.location && stateBefore.scene.location !== message.extra.location;
        const consolidate = shouldRunMemoryConsolidation({
            messageCount: context.chat.length, sceneChanged,
            interval: this.settings.memoryConsolidationInterval,
        });
        const auditMode = this.settings.auditor ? this.settings.auditMode : 'off';
        const payload = {
            identity, generation_type: type, state_before: stateBefore,
            user_message: String(lastUser?.mes || ''), rp_response: String(message.mes || ''),
            timeline: stateBefore.timeline, active_threads: stateBefore.threads,
            consolidate_memory: consolidate,
            audit_mode: auditMode,
            sprite_director: this.settings.spriteDirector,
            sprite_candidates: this.settings.spriteDirector
                ? { [resolveMessageSpeaker(message, context).name]: this.spriteManifests.candidatesFor(resolveMessageSpeaker(message, context).name, stateBefore, 20) }
                : {},
            user_agency: 'The RP response must not invent user actions, thoughts, dialogue, or decisions.',
        };
        try {
            const promptAddendum = await loadStatePromptBundle(this.settings, 'post');
            let post = await this.director.run('post', payload, {
                identity, signal: token.signal, timeoutMs: this.settings.postDirectorTimeoutMs, promptAddendum,
            });
            this.gate.assertCurrent(token);
            this.diagnostics.update({ lastAudit: post.audit });
            if (!post.audit.valid && auditMode === 'strict' && highSeverity(post.audit)) {
                const rewritten = await this.rewriteOnce(payload, post.audit, identity, token.signal);
                if (rewritten) {
                    message.mes = rewritten;
                    await context.saveChat?.();
                    context.updateMessageBlock?.(messageIndex, message, { rerenderMessage: true });
                    post = await this.director.run('post', { ...payload, rp_response: rewritten, re_audit: true }, {
                        identity, signal: token.signal, timeoutMs: this.settings.postDirectorTimeoutMs, promptAddendum,
                    });
                    this.gate.assertCurrent(token);
                    this.diagnostics.update({ lastAudit: post.audit });
                }
            }
            if (!post.audit.valid && auditMode !== 'off') {
                await this.persistCompactMetadata(context, { pendingReconciliation: false, lastAudit: post.audit });
                return;
            }
            const delta = combineDelta(post, this.settings);
            await this.stateManager.applyDelta(delta, { messageIndex, source: `message:${messageIndex}`, confidence: 1 });
            for (const candidate of this.settings.memoryRetrieval ? (post.memory_candidates || []) : []) {
                const memory = { ...candidate, id: candidate.id || `episode_${messageIndex}_${Math.random().toString(36).slice(2, 7)}` };
                if (memory.summary) await this.memoryStore.add(memory);
            }
            message.extra ||= {};
            message.extra.narrative_engine = { messageId: stableMessageId, delta, audit: post.audit, schemaVersion: 1 };
            await context.saveChat?.();
            const speaker = resolveMessageSpeaker(message, context).name;
            this.spriteState = await applySpriteDecisions(post.sprite_decisions, {
                context, currentSpeaker: speaker, previous: this.spriteState,
                allowedCandidates: payload.sprite_candidates,
            });
            this.diagnostics.update({ status: 'ready', lastSprites: this.spriteState });
            await this.persistCompactMetadata(context, { lastAudit: post.audit, pendingReconciliation: false });
        } catch (error) {
            this.diagnostics.error(error, 'post');
            this.diagnostics.update({ status: 'degraded' });
            await this.persistCompactMetadata(context, { pendingReconciliation: true, error: safeError(error) });
        } finally {
            this.gate.finish(token);
        }
    }

    async rewriteOnce(payload, audit, identity, signal) {
        const result = await this.director.run('reconcile', {
            state_before: payload.state_before,
            user_message: payload.user_message,
            previous_response: payload.rp_response,
            fix_only: audit.errors,
            preserve: 'tone, events, dialogue, and character voice',
            user_agency: 'Do not invent user actions or dialogue.',
        }, { identity, signal, timeoutMs: this.settings.postDirectorTimeoutMs });
        return result.replacement;
    }

    async markDirtyAndRebuild(messageIndex = 0) {
        this.stateManager.markDirty(messageIndex);
        const context = getContext();
        const deltas = (context.chat || []).flatMap((message, index) => {
            const delta = message?.extra?.narrative_engine?.delta;
            return delta ? [{ messageIndex: index, delta, source: `message:${index}`, confidence: 1 }] : [];
        });
        await this.stateManager.rebuild({ deltas });
        await this.persistCompactMetadata(context, { dirty: false });
        this.diagnostics.update({ status: 'ready' });
    }

    async persistCompactMetadata(context = getContext(), patch = {}) {
        const metadata = context.chatMetadata;
        if (!metadata) return;
        const state = this.stateManager.snapshot();
        metadata[MODULE_NAME] = {
            ...metadata[MODULE_NAME],
            schemaVersion: state.schemaVersion, revision: state.revision,
            scene: state.scene, timeline: state.timeline,
            activeThreadIds: Object.keys(state.threads || {}).filter((id) => state.threads[id]?.status !== 'resolved'),
            storageKey: this.stateManager.prefix, dirty: this.stateManager.dirty,
            ...patch,
        };
        await context.saveMetadata?.();
    }

    async healthCheck() {
        try {
            const health = await this.provider.healthCheck();
            this.diagnostics.update({ status: health.ok ? 'ready' : 'degraded', health });
            return health;
        } catch (error) {
            this.diagnostics.error(error, 'health');
            this.diagnostics.update({ status: 'offline' });
            return { ok: false, error: safeError(error) };
        }
    }

    async rerunSpriteSelection() {
        if (!this.settings.spriteDirector) return { skipped: 'Sprite Director is disabled.' };
        const context = getContext();
        const index = (context.chat || []).findLastIndex((message) => message && !message.is_user && !message.is_system);
        if (index < 0) return { skipped: 'No character response is available.' };
        const message = context.chat[index];
        const identity = createRequestIdentity(context, this.activeGenerationId);
        const token = this.gate.begin(identity);
        try {
            const promptAddendum = await loadStatePromptBundle(this.settings, 'post');
            const post = await this.director.run('post', {
                identity, sprite_only: true, state_before: this.stateManager.snapshot(),
                user_message: '', rp_response: String(message.mes || ''),
                audit_mode: 'off', sprite_director: true,
                sprite_candidates: { [resolveMessageSpeaker(message, context).name]: this.spriteManifests.candidatesFor(resolveMessageSpeaker(message, context).name, this.stateManager.snapshot(), 20) },
            }, { identity, signal: token.signal, timeoutMs: this.settings.postDirectorTimeoutMs, promptAddendum });
            this.gate.assertCurrent(token);
            const speaker = resolveMessageSpeaker(message, context).name;
            this.spriteState = await applySpriteDecisions(post.sprite_decisions, {
                context, currentSpeaker: speaker, previous: this.spriteState,
                allowedCandidates: { [speaker]: this.spriteManifests.candidatesFor(speaker, this.stateManager.snapshot(), 20) },
            });
            this.diagnostics.update({ lastSprites: this.spriteState });
            return post.sprite_decisions || {};
        } finally {
            this.gate.finish(token);
        }
    }

    async exportState() {
        return {
            schemaVersion: 1, chatFingerprint: getChatFingerprint(getContext()),
            state: this.stateManager.snapshot(), memories: [...this.memoryStore.items],
            threads: Object.values(this.stateManager.state.threads || {}),
            timeline: this.stateManager.state.timeline, spriteState: { ...this.spriteState },
        };
    }

    async importState(value) {
        const validation = validateSchema(await loadSchema('export'), value);
        if (!validation.valid) throw new Error(`Invalid Narrative Engine export: ${validation.errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
        await this.stateManager.importData(value);
        this.memoryStore.items = value.memories;
        this.spriteState = value.spriteState || {};
        await this.memoryStore.storage?.setItem(this.memoryStore.key, this.memoryStore.items);
        await this.persistCompactMetadata();
    }
}
