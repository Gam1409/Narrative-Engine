import { retrieveMemories } from '../memory/retrieval.js';
import { prepareTurnMemories } from '../memory/turn.js';
import { consolidationBatch, memorySceneKey, hasPendingSceneTransition } from '../memory/consolidation.js';
import { eraseMemoryCopies } from '../memory/erase.js';
import { loreRequest, loreReferenceEntries } from '../lore/client.js';
import { observeQuality, acceptedQualityTurns, advanceQualityNote, qualityHintCategory, qualitySceneKey } from '../director/quality.js';
import { buildAutonomyPacket } from '../director/autonomy.js';
import { buildEvidenceCatalog } from '../state/evidence.js';
import { visualProfile } from '../visual/scene.js';
import { VisualDirector } from '../visual/director.js';
import { simulationPolicy, prepareSimulation, innerLifeContext, postSimulationState } from '../state/simulationContext.js';
import { pendingReactions } from '../state/simulation.js';
import { projectState, sceneViewers, audienceMemories, eligibleMemory } from '../memory/policy.js';
import { textHash } from '../memory/semantic.js';
import { VectorSearch } from '../memory/vectorSearch.js';
import { configureSession } from '../memory/session.js';
import { branchReferences } from '../state/history.js';
import { getChatFingerprint, getContext, createRequestIdentity, recentChat, resolveGenerationRecipient, resolveMessageSpeaker, resolveParticipants, messageId } from '../context/stContext.js';
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
    if (rawState.ops !== undefined) throw new Error('Use top-level ops in POST');
    const delta = settings.continuity || settings.characterState
        ? { ...rawState }
        : Object.fromEntries(Object.entries(rawState).filter(([key]) => ['time_advance_minutes', 'timeline', 'scene'].includes(key)));
    const relationships = byId(post.relationship_delta, 'pair');
    const knowledge = byId(post.knowledge_delta, 'fact_id');
    if (settings.relationships && Object.keys(relationships).length) delta.relationships = relationships;
    if (settings.knowledge && Object.keys(knowledge).length) delta.knowledge = knowledge;
    if (settings.plotManager && post.thread_delta && typeof post.thread_delta === 'object') delta.threads = post.thread_delta;
    if (settings.worldSimulation && post.world_event_delta && typeof post.world_event_delta === 'object') delta.world_events = post.world_event_delta;
    if (post.ops !== undefined) delta.ops = settings.continuity || settings.characterState ? post.ops : [];
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
        this.operationQueue = Promise.resolve();
        this.stateReady = false;
        this.spriteState = {};
    }

    async initialize(context = getContext()) {
        this.context = context;
        this.settings = getSettings(context);
        this.storage = this.createStorage(context);
        this.spriteManifests = new SpriteManifestStore({ storage: createStorageAdapter(globalThis.SillyTavern?.libs?.localforage) });
        try { await this.loadChat(context); } catch (error) { this.diagnostics.error(error, 'storage'); }
        this.recreateProvider(context);
        this.diagnostics.update({ status: this.settings.enabled ? (this.stateReady ? 'ready' : 'degraded') : 'disabled', provider: this.settings.provider });
        return this;
    }

    enqueue(operation) {
        const result = this.operationQueue.then(operation);
        this.operationQueue = result.catch(() => {});
        return result;
    }

    loadChat(context = getContext()) {
        this.gate.switchContext({ chatFingerprint: getChatFingerprint(context) });
        return this.enqueue(() => this.loadChatNow(context));
    }

    async loadChatNow(context = getContext(), {resumeVisual=true} = {}) {
        if (getChatFingerprint(context) !== getChatFingerprint(getContext())) return;
        this.context = context;
        this.stateReady = false;
        this.visualDirector?.close();
        const fingerprint = getChatFingerprint(context);
        const stateSchema = await loadSchema('state');
        this.gate.switchContext({ chatFingerprint: fingerprint, sessionId: String(context.chatId || context.getCurrentChatId?.() || 'no-chat') });
        this.stateManager = new StateManager({
            chatFingerprint: fingerprint, storage: this.storage,
            checkpointEvery: this.settings?.checkpointInterval || 10, validator: (state) => validateSchema(stateSchema, state),
        });
        this.memoryStore = new EpisodicMemoryStore({ storage: this.storage, key: `narrative-engine:${fingerprint}:memories` });
        await this.stateManager.load();
        if (getChatFingerprint(context) !== getChatFingerprint(getContext())) return;
        this.memoryStore.items = this.stateManager.memories;
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
        this.qualityNote = null;
        this.diagnostics.update({ lastPacket: '', retrievedMemories: [], packetAssembly: null, rpTextStatus: null, narrativeQuality: null, loreStatus: null });
        if (this.settings.enabled) {
            await this.stateManager.selectBranch(await branchReferences(context, Infinity, this.stateManager.canonVersion));
            this.memoryStore.items = this.stateManager.memories;
        }
        this.stateReady = true;
        this.visualDirector=new VisualDirector(this);
        try {this.spriteManifests.visualProfiles=await this.visualDirector.profiles();}
        catch(error) {this.spriteManifests.visualProfiles={};this.diagnostics.error(error,'visual');}
        if(resumeVisual && this.settings.visualEnabled)this.visualDirector.resume().catch(error=>this.diagnostics.error(error,'visual'));
        await this.persistCompactMetadata(context);
    }

    async clearData(kind, scope) {
        if(!['memory','state','lore','all'].includes(kind) || !['session','all'].includes(scope)) throw Error('Invalid cleanup');
        const context=getContext(), fingerprint=getChatFingerprint(context);
        this.gate.invalidate();
        return this.enqueue(async()=>{
            if(getChatFingerprint(getContext())!==fingerprint)throw Error('Chat changed; repeat cleanup');
            const server=this.storage instanceof ServerStorageAdapter;
            if(server && this.storage.degraded)throw Error('Reconnect storage before deleting server data');
            if(server)await Promise.all([...this.storage.queues.values()]);
            // Server deletion also handles embedding caches used with local state storage.
            let result={chatIds:[]};
            let serverCleared=false;
            try {
                const response=await fetch('/api/plugins/narrative-engine/data/clear',{
                    method:'POST',headers:{'Content-Type':'application/json',...(context.getRequestHeaders?.() || {})},
                    body:JSON.stringify({kind:!server && kind==='state'?'memory':kind,scope,chatId:fingerprint,confirm:'DELETE'}),
                });
                if(!response.ok)throw Error(`Cleanup failed (HTTP ${response.status}); some data may have been removed. Refresh before retrying.`);
                result=await response.json();
                serverCleared=true;
            } catch(error) {
                if(server || this.settings.embeddingSearch || ['lore','all'].includes(kind))throw error;
            }
            if(kind!=='lore') {
                if(server) {
                    const affected=new Set([...(result.chatIds || []),fingerprint]);
                    for(const key of await this.storage.fallback.keys()) {
                        const match=key.match(/^narrative-engine-cache:narrative-engine:(ne-[a-f0-9]+):/);
                        if(match && affected.has(match[1]))await this.storage.fallback.removeItem(key);
                    }
                } else {
                    for(const key of await this.storage.keys()) {
                        const match=key.match(/^narrative-engine:(ne-[a-f0-9]+):(.+)$/);
                        if(!match || scope==='session' && match[1]!==fingerprint)continue;
                        if(kind==='memory')await this.storage.setItem(key,eraseMemoryCopies(await this.storage.getItem(key),match[2]));
                        else await this.storage.removeItem(key);
                    }
                }
                await this.loadChatNow(context,{resumeVisual:false});
            }
            this.diagnostics.update({lastPacket:'',retrievedMemories:[],loreStatus:null});
            return serverCleared ? 'Cleanup completed. Chat messages and generated images were not deleted.' : 'Local cleanup completed. Server cleanup was unavailable; server data may remain.';
        });
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
        const previousAutonomy = this.settings.rpAutonomy;
        const previousLore = [this.settings.loreEnabled, this.settings.loreLibraryId];
        const previousQuality = [this.settings.antiSlopMode, this.settings.qualityWindow];
        this.settings = saveSettings(getContext(), { ...this.settings, ...patch });
        if (previousLore[0] !== this.settings.loreEnabled || previousLore[1] !== this.settings.loreLibraryId || previousAutonomy !== this.settings.rpAutonomy || previousQuality[0] !== this.settings.antiSlopMode || previousQuality[1] !== this.settings.qualityWindow) {
            this.gate.invalidate();
            this.diagnostics.update({ lastPacket: '', packetAssembly: null, rpTextStatus: null, narrativeQuality: null, loreStatus: null });
        }
        if (previousLore[0] !== this.settings.loreEnabled || previousLore[1] !== this.settings.loreLibraryId || previousAutonomy !== this.settings.rpAutonomy || previousQuality[0] !== this.settings.antiSlopMode || previousQuality[1] !== this.settings.qualityWindow) this.qualityNote = null;
        this.diagnostics.update({ narrativeQuality: null });
        this.stateManager.checkpointEvery = this.settings.checkpointInterval;
        this.recreateProvider(getContext());
        if (previousProvider !== this.settings.provider && (previousProvider === 'server' || this.settings.provider === 'server')) {
            this.storage = this.createStorage(getContext());
            this.spriteManifests = new SpriteManifestStore({ storage: createStorageAdapter(globalThis.SillyTavern?.libs?.localforage) });
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
        if (!this.settings.enabled || !this.stateReady) return null;
        const context = getContext();
        await this.enqueue(() => this.reconcile(context));
        if (getChatFingerprint(getContext()) !== getChatFingerprint(context)) return null;
        const identity = createRequestIdentity(context, this.activeGenerationId);
        const token = this.gate.begin(identity);
        const current = this.stateManager.snapshot();
        const lastUser = [...(context.chat || [])].reverse().find((message) => message?.is_user);
        const viewers = sceneViewers(current, this.participants);
        const recipient = resolveGenerationRecipient(context, type);
        const recipientId = recipient ? sceneViewers({...current,scene:{present:[]}}, [recipient])[0] : null;
        const safeState = projectState(current, viewers);
        const query = {
            message: String(lastUser?.mes || ''),
            characters: sceneViewers(current, this.participants, false),
            topics: Object.keys(safeState.threads || {}),
            location: current.scene?.location || '',
        };
        const searchOptions = { topK: this.settings.memoryTopK, tokenBudget: Math.floor(this.settings.packetTokenBudget / 2),
            policy: { ...this.stateManager.scope, viewers, through: current.timeline?.date && current.timeline?.time ? `${current.timeline.date}T${current.timeline.time}` : undefined },
            now: current.timeline?.date ? Date.parse(`${current.timeline.date}T${current.timeline.time || '00:00'}:00Z`) : 0,
            availability: { enabled: this.settings.memoryAvailability, halfLifeDays: this.settings.memoryAvailabilityHalfLifeDays },
            weights: this.settings.memoryWeights, signal: token.signal };
        let memories = this.settings.memoryRetrieval ? this.memoryStore.search(query, searchOptions) : [];
        this.diagnostics.update({ retrievalMode: 'lexical_degraded' });
        if (this.settings.memoryRetrieval && this.settings.embeddingSearch) {
            try {
                memories = await new VectorSearch(context, this.stateManager.chatFingerprint).search(this.memoryStore.items, query, searchOptions);
                this.diagnostics.update({ retrievalMode: 'vector', embeddingError: null });
            } catch (error) { if (this.gate.isCurrent(token)) this.diagnostics.update({ retrievalMode: 'lexical_degraded', embeddingError: error.message }); }
        }
        if (!this.gate.isCurrent(token)) { this.gate.finish(token); return null; }
        const qualityCategory = this.settings.antiSlopMode === 'soft' && this.settings.rpAutonomy ? qualityHintCategory(this.qualityNote, qualitySceneKey(current)) : null;
        const innerContext = innerLifeContext(current, this.participants, this.settings, viewers, recipient);
        if (recipientId && this.settings.memoryRetrieval) {
            const privateOptions = {...searchOptions, personal: innerContext.own, tokenBudget: Math.floor(this.settings.packetTokenBudget / 4), policy:{...searchOptions.policy,viewers:[recipientId]}};
            const sharedIds = new Set(memories.map(m => m.id));
            const privateItems = audienceMemories(this.memoryStore.items,privateOptions.policy).filter(m => !sharedIds.has(m.id));
            const privateMemories = new EpisodicMemoryStore();
            privateMemories.items = privateItems;
            let selected = privateMemories.search(query, privateOptions);
            if (this.settings.embeddingSearch && privateItems.some(m => eligibleMemory(m, privateOptions.policy))) {
                try { selected = await new VectorSearch(context, this.stateManager.chatFingerprint).search(privateItems, query, privateOptions); }
                catch (error) { if (!this.gate.isCurrent(token)) { this.gate.finish(token); return null; } }
            }
            if (!this.gate.isCurrent(token)) { this.gate.finish(token); return null; }
            selected = selected.filter(m => !sharedIds.has(m.id));
            if (selected.length) innerContext.privateMemories = {characterId:recipientId,rule:'Private recollections for this character only. They do not establish shared knowledge or current canonical facts.',entries:selected};
        }
        const turn = (context.chat || []).filter((message) => message?.is_user).length;
        const dueEvents = Object.values(safeState.world_events || {}).some((event) => event?.status === 'due');
        const payload = {
            identity, generation_type: type, context_size: contextSize,
            rp_autonomy: this.settings.rpAutonomy === true,
            latest_user_message: String(lastUser?.mes || ''),
            recent_messages: [], // Unannotated past RP text is not an authority for another character's knowledge.
            state: safeState,
            knowledge_viewers: viewers,
            inner_life: innerContext,
            relevant_memories: memories,
            roles: {
                continuity: this.settings.continuity,
                character_state: this.settings.characterState,
                relationships: this.settings.relationships,
                knowledge: this.settings.knowledge,
                plot_manager: this.settings.plotManager,
                world_simulation: this.settings.worldSimulation,
                scene_planner: !this.settings.rpAutonomy,
            },
            character_director_hints: {}, // Private card hints stay out of the shared generation packet.
            cadence: {
                plot_maintenance: shouldRunPlotMaintenance({ turn, interval: this.settings.plotInterval }),
                world_simulation: shouldRunWorldSimulation({ dueEvent: dueEvents, cadenceDue: turn % 3 === 0 }),
            },
            truth_priority: ['explicit user action', 'recent accepted chat', 'structured state', 'character/world canon', 'episodic memory', 'director inference'],
            user_agency: 'Never invent voluntary user actions, thoughts, dialogue, choices, or decisions.',
        };
        let lore = [];
        try {
            if (this.settings.loreEnabled && this.settings.rpAutonomy) {
                try {
                    const result = await loreRequest(context, 'retrieve', { libraryId: this.settings.loreLibraryId,
                        query: [String(lastUser?.mes || '').slice(0,8000), safeState.scene?.location || ''].join(' '),
                        budget: Math.floor(this.settings.packetTokenBudget * 0.3),
                        context:{location:safeState.scene?.location,present:safeState.scene?.present,time:safeState.timeline?.time} }, token.signal);
                    this.gate.assertCurrent(token);
                    lore = loreReferenceEntries(result.entries, safeState);
                    payload.world_lore_reference = lore;
                    this.diagnostics.update({ loreStatus: { status: 'retrieved', libraryId: this.settings.loreLibraryId, revision: result.revision, selectedIds: lore.map(e=>e.id),
                        divergences: lore.flatMap(e => (e.stateOverrides || []).map(item => ({entryId:e.id,...item}))),
                        selection: Array.isArray(result.selection) ? result.selection.slice(0,500).filter(e=>typeof e?.id==='string' && ['full','summary','omitted'].includes(e.mode)).map(e=>({id:e.id,mode:e.mode,...(['budget','always_budget','entry_limit'].includes(e.reason)?{reason:e.reason}:{})})) : [] } });
                } catch (error) {
                    this.gate.assertCurrent(token);
                    this.diagnostics.update({ loreStatus: { status: 'unavailable', error: String(error.message).slice(0,200) } });
                }
            } else this.diagnostics.update({ loreStatus: { status: this.settings.loreEnabled ? 'requires_rp_autonomy' : 'off' } });
            const promptAddendum = this.settings.rpAutonomy ? '' : await loadStatePromptBundle(this.settings, 'pre');
            const pre = await this.director.run('pre', payload, {
                identity, signal: token.signal, timeoutMs: this.settings.preDirectorTimeoutMs, promptAddendum,
            });
            this.gate.assertCurrent(token);
            if ((resolveGenerationRecipient(getContext(), type)?.id || null) !== (recipient?.id || null)) throw new Error('Stale generation recipient');
            const autonomy = this.settings.rpAutonomy ? buildAutonomyPacket({ state: safeState, pre, inner: innerContext, memories, qualityCategory, lore }, this.settings.packetTokenBudget) : null;
            const packet = autonomy ? autonomy.packet : buildDirectorPacket({ ...pre, inner_life: innerContext.own, private_memories: innerContext.privateMemories, observations: innerContext.observations, due_world_events: innerContext.events, relevant_memories: memories, active_threads: Object.values(safeState.threads),
                character_states: Object.fromEntries(Object.entries(pre.character_states || {}).filter(([id]) => viewers.includes(id))) }, this.settings.packetTokenBudget);
            this.diagnostics.update({ status: autonomy?.diagnostics.overflow ? 'degraded' : 'generating', lastPacket: packet || '', packetAssembly: autonomy?.diagnostics || null, retrievedMemories: memories });
            return packet;
        } catch (error) {
            if (this.gate.isCurrent(token)) {
                this.diagnostics.error(error, 'pre');
                if (this.settings.rpAutonomy && getChatFingerprint(getContext()) === getChatFingerprint(context)
                    && (resolveGenerationRecipient(getContext(), type)?.id || null) === (recipient?.id || null)) {
                    const fallback = buildAutonomyPacket({ state: safeState, inner: innerContext, memories, qualityCategory, lore }, this.settings.packetTokenBudget);
                    this.diagnostics.update({ status: 'degraded', lastPacket: fallback.packet || '', packetAssembly: { ...fallback.diagnostics, directorUnavailable: true } });
                    return fallback.packet;
                }
                this.diagnostics.update({ status: 'degraded', lastPacket: '', packetAssembly: null });
            }
            return null;
        } finally {
            this.gate.finish(token);
        }
    }

    processPost(messageIndex, type) {
        const context = getContext();
        return this.enqueue(() => this.reconcile(context, Math.max(messageIndex, ...this.stateManager.deltas.map(d => d.messageIndex)), type));
    }

    async reconcile(context, through = Infinity, type = 'normal') {
        if (!this.settings.enabled || !this.stateReady || getChatFingerprint(context) !== getChatFingerprint(getContext())) return;
        const manager = this.stateManager;
        if (manager.chatFingerprint !== getChatFingerprint(context)) return;
        const refs = await branchReferences(context, through, manager.canonVersion);
        await manager.selectBranch(refs);
        this.memoryStore.items = manager.memories;
        for (const ref of refs) {
            if (manager.findAccepted(ref.idempotencyKey)) continue;
            if (this.stateManager !== manager || getChatFingerprint(context) !== getChatFingerprint(getContext())) return;
            const accepted = await this.processTurn(context, ref.messageIndex, type, manager);
            if (!accepted) break;
        }
        if (this.stateManager === manager && getChatFingerprint(context) === getChatFingerprint(getContext())) {
            const qualityChat = (context.chat || []).map(m => ({ ...m }));
            const qualitySignature = JSON.stringify(qualityChat);
            const currentRefs = await branchReferences({ ...context, chat: qualityChat }, through, manager.canonVersion);
            await manager.selectBranch(currentRefs);
            if (this.stateManager !== manager || getChatFingerprint(context) !== getChatFingerprint(getContext())) return;
            let narrativeQuality = null;
            if (['observe', 'soft'].includes(this.settings.antiSlopMode) && JSON.stringify(context.chat || []) === qualitySignature) {
                const turns = acceptedQualityTurns(qualityChat, currentRefs, manager);
                narrativeQuality = observeQuality(turns, this.settings.qualityWindow);
                narrativeQuality.mode = this.settings.antiSlopMode;
                this.qualityNote = this.settings.antiSlopMode === 'soft' && this.settings.rpAutonomy
                    ? advanceQualityNote(this.qualityNote, narrativeQuality, turns.map(t => t.ref), qualitySceneKey(manager.snapshot())) : null;
                narrativeQuality.feedback = this.qualityNote ? { ...this.qualityNote, sceneKey: undefined } : null;
                if (this.settings.antiSlopMode === 'soft' && !this.settings.rpAutonomy) narrativeQuality.feedbackDisabled = 'Enable RP model autonomy for soft feedback; observation only.';
            } else this.qualityNote = null;
            this.diagnostics.update({ narrativeQuality });
            this.memoryStore.items = manager.memories;
            this.diagnostics.update({ status: manager.pending.length ? 'pending_reconciliation' : 'ready' });
            await this.persistCompactMetadata(context);
        }
    }

    async processTurn(context, messageIndex, type, manager) {
        const message = context.chat?.[messageIndex];
        if (!message || message.is_user || message.is_system) return false;
        let ref = (await branchReferences(context, messageIndex, manager.canonVersion)).at(-1);
        // Re-evaluate the prefix after a strict rewrite changed a preceding turn.
        const prefix = await branchReferences(context, messageIndex - 1, manager.canonVersion);
        await manager.selectBranch(prefix);
        if (manager.findAccepted(ref.idempotencyKey)) {
            await manager.selectBranch([...prefix, ref]); return true;
        }
        const identity = createRequestIdentity(context, this.activeGenerationId);
        const token = this.gate.begin(identity);
        const assertCurrent = async () => {
            this.gate.assertCurrent(token);
            if (this.stateManager !== manager || getChatFingerprint(getContext()) !== manager.chatFingerprint) throw new Error('Stale chat context');
            const current = (await branchReferences(context, messageIndex, manager.canonVersion)).at(-1);
            if (current?.idempotencyKey !== ref.idempotencyKey) throw new Error('Stale message content');
        };
        const stateBefore = manager.snapshot();
        const lastUser = [...context.chat.slice(0, messageIndex)].reverse().find(m => m?.is_user);
        const auditMode = this.settings.auditor ? this.settings.auditMode : 'off';
        this.diagnostics.recordPostAttempt(auditMode === 'strict');
        const speaker = resolveMessageSpeaker(message, context).name;
        const payload = {
            identity, generation_type: type, state_before: postSimulationState(stateBefore, simulationPolicy(this.settings, stateBefore, this.participants, context.name1)),
            simulation_policy: simulationPolicy(this.settings, stateBefore, this.participants, context.name1),
            pending_reactions: pendingReactions(stateBefore, sceneViewers(stateBefore, this.participants, false)),
            memory_scope: manager.scope, memory_audience_ids: sceneViewers(stateBefore, this.participants),
            user_message: String(lastUser?.mes || ''), rp_response: String(message.mes || ''),
            timeline: stateBefore.timeline, active_threads: stateBefore.threads,
            collect_memory: this.settings.memoryRetrieval,
            consolidate_memory: shouldRunMemoryConsolidation({ messageCount: manager.deltas.filter(d => d.source !== 'author' && d.messageIndex >= 0).length + 1, interval: this.settings.memoryConsolidationInterval, sceneChanged: hasPendingSceneTransition(manager.deltas, stateBefore) }),
            audit_mode: auditMode, sprite_director: this.settings.spriteDirector,
            sprite_candidates: this.settings.spriteDirector ? { [speaker]: this.spriteManifests.candidatesFor(speaker, stateBefore, 20) } : {},
            user_agency: 'Never assign voluntary actions or internal states to the player. NPC internal states require character-consistent evidence, not a player assertion.',
        };
        payload.consolidation_sources = payload.collect_memory && payload.consolidate_memory
            ? consolidationBatch(manager.memories, { scope: manager.scope, viewers: payload.memory_audience_ids, tokenBudget: this.settings.memoryConsolidationTokenBudget }) : [];
        payload.memory_link_sources = payload.collect_memory ? retrieveMemories(manager.memories, {
            message: payload.rp_response, location: stateBefore.scene?.location,
            characters: payload.memory_audience_ids,
        }, {
            policy: { ...manager.scope, viewers: payload.memory_audience_ids, mode: 'session_only',
                through: stateBefore.timeline?.date && stateBefore.timeline?.time ? `${stateBefore.timeline.date}T${stateBefore.timeline.time}` : undefined },
            topK: 8, tokenBudget: Math.min(1000, this.settings.memoryConsolidationTokenBudget), associationLimit: 0,
        }) : [];
        try {
            payload.evidence_catalog = await buildEvidenceCatalog({rp: payload.rp_response, user: payload.user_message});
            await assertCurrent();
            const promptAddendum = await loadStatePromptBundle(this.settings, 'post');
            let simulationValidationError = null;
            let extractionRepairUsed = false;
            const validatePost = result => {
                simulationValidationError = null;
                try { prepareSimulation(result, combineDelta(result, this.settings), stateBefore, payload.simulation_policy, {rp: payload.rp_response, user: payload.user_message, evidenceCatalog: payload.evidence_catalog}); }
                catch (error) { simulationValidationError = error.message; result.audit = {...result.audit, valid: false, errors: [...(result.audit?.errors || []), {severity:'high', kind:'simulation', message:error.message}]}; }
                return result;
            };
            const validateWithRepair = async result => {
                const auditWasValid = result.audit.valid;
                result = validatePost(result);
                if (!auditWasValid || !simulationValidationError || extractionRepairUsed) return result;
                extractionRepairUsed = true;
                this.diagnostics.recordRepair();
                const repaired = await this.director.run('post', {
                    ...payload,
                    extraction_repair: {
                        error: simulationValidationError,
                        invalid_output: result,
                        instruction: 'Correct only the extraction contract/evidence error using the unchanged current-turn text. Return a complete POST result. Prefer evidence:{ref} selected from evidence_catalog. Never invent a reference. Legacy quotes must be verbatim in the original language. Omit unsupported optional changes. Do not rewrite RP, invent facts, or dismiss legitimate audit concerns.',
                    },
                }, { identity, signal: token.signal, timeoutMs: this.settings.postDirectorTimeoutMs, promptAddendum });
                await assertCurrent();
                return validatePost(repaired);
            };
            let post = await this.director.run('post', payload, { identity, signal: token.signal, timeoutMs: this.settings.postDirectorTimeoutMs, promptAddendum });
            await assertCurrent();
            post = await validateWithRepair(post);
            if (!post.audit.valid && auditMode === 'strict' && !this.settings.rpAutonomy && highSeverity(post.audit)) {
                this.diagnostics.recordStrictRewrite();
                const rewritten = await this.rewriteOnce(payload, post.audit, identity, token.signal);
                await assertCurrent();
                if (rewritten) {
                    message.mes = rewritten;
                    ref = (await branchReferences(context, messageIndex, manager.canonVersion)).at(-1);
                    await assertCurrent();
                    await context.saveChat?.();
                    await assertCurrent();
                    context.updateMessageBlock?.(messageIndex, message, { rerenderMessage: true });
                    payload.rp_response = rewritten;
                    payload.evidence_catalog = await buildEvidenceCatalog({rp: rewritten, user: payload.user_message});
                    await assertCurrent();
                    post = await this.director.run('post', { ...payload, rp_response: rewritten, re_audit: true }, { identity, signal: token.signal, timeoutMs: this.settings.postDirectorTimeoutMs, promptAddendum });
                    await assertCurrent();
                    post = await validateWithRepair(post);
                }
            }
            const confidence = Number.isFinite(post.confidence) ? post.confidence : 0.5;
            // A disputed extraction remains one atomic proposal, including typed operations.
            let status = !post.audit.valid || confidence < this.settings.minimumConfidence ? 'proposed' : 'confirmed';
            const normalizedMemories = this.settings.memoryRetrieval ? await prepareTurnMemories(post.memory_candidates, {
                scope: manager.scope,
                gameTime: stateBefore.timeline?.date && stateBefore.timeline?.time ? `${stateBefore.timeline.date}T${stateBefore.timeline.time}` : null,
                sources: payload.consolidation_sources, linkSources: payload.memory_link_sources,
                viewers: payload.memory_audience_ids,
                texts: { rp: payload.rp_response, user: payload.user_message, evidenceCatalog: payload.evidence_catalog },
            }) : [];
            await assertCurrent();
            const delta = status === 'confirmed' ? prepareSimulation(post, combineDelta(post, this.settings), stateBefore, payload.simulation_policy, {rp:payload.rp_response,user:payload.user_message,evidenceCatalog:payload.evidence_catalog}) : {...combineDelta(post,this.settings), ...(post.simulation_delta ? {simulation: {...post.simulation_delta, policy:payload.simulation_policy}} : {})};
            status = await manager.recordTurn(delta, { ...ref, generationId: identity.generationId, requestId: identity.requestId }, {
                confidence, status, audit: post.audit,
                memories: normalizedMemories, memorySceneKey: memorySceneKey(stateBefore),
            });
            await assertCurrent();
            this.memoryStore.items = manager.memories;
            this.diagnostics.update({ lastAudit: post.audit, rpTextStatus: this.settings.rpAutonomy ? { text: 'unchanged', state: status, revision: 'not attempted', action: status === 'confirmed' ? 'none' : 'Review the audit and manually regenerate in SillyTavern if needed. Displayed RP text has not been corrected.' } : null });
            if (status !== 'confirmed') return false;
            message.extra ||= {};
            message.extra.narrative_engine = { messageId: ref.messageId, swipeId: ref.swipeId,
                idempotencyKey: ref.idempotencyKey, deltaId: manager.findAccepted(ref.idempotencyKey).deltaId, schemaVersion: 2 };
            await context.saveChat?.();
            await assertCurrent();
            if (this.settings.spriteDirector) this.spriteState = await applySpriteDecisions(post.sprite_decisions, {
                context, currentSpeaker: speaker, previous: this.spriteState,
                allowedCandidates: { [speaker]: this.spriteManifests.candidatesFor(speaker, manager.snapshot(), 20) },
            });
            if(this.settings.visualEnabled && this.settings.visualAutomatic) this.visualDirector?.request({automatic:true}).catch(error=>this.diagnostics.error(error,'visual'));
            return true;
        } catch (error) {
            // Never write another chat's state or metadata from a late completion.
            if (this.gate.isCurrent(token) && this.stateManager === manager && getChatFingerprint(getContext()) === manager.chatFingerprint) {
                const current = (await branchReferences(context, messageIndex, manager.canonVersion)).at(-1);
                if (current?.idempotencyKey === ref.idempotencyKey) {
                    if (!manager.findAccepted(ref.idempotencyKey)) await manager.setPending(ref, safeError(error));
                    this.diagnostics.error(error, 'post');
                }
            }
            return false;
        } finally { this.gate.finish(token); }
    }

    async rewriteOnce(payload, audit, identity, signal) {
        if (this.settings.rpAutonomy) return null;
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

    markDirtyAndRebuild(messageIndex = 0, { canonChanged = false } = {}) {
        this.qualityNote = null;
        const context = getContext();
        this.gate.invalidate();
        this.diagnostics.update({ lastPacket: '', packetAssembly: null, rpTextStatus: null, narrativeQuality: null, loreStatus: null });
        return this.enqueue(async () => {
            if (getChatFingerprint(context) !== getChatFingerprint(getContext())) return;
            if (canonChanged) await this.stateManager.commit({ canonVersion: this.stateManager.canonVersion + 1 });
            await this.reconcile(context);
        });
    }

    async persistCompactMetadata(context = getContext(), patch = {}) {
        const metadata = context.chatMetadata;
        if (getChatFingerprint(context) !== getChatFingerprint(getContext())) return;
        if (!metadata) return;
        const state = this.stateManager.snapshot();
        metadata[MODULE_NAME] = {
            ...metadata[MODULE_NAME],
            schemaVersion: state.schemaVersion, revision: state.revision,
            scene: state.scene, timeline: state.timeline,
            activeThreadIds: Object.keys(state.threads || {}).filter((id) => state.threads[id]?.status !== 'resolved'),
            memoryScope: this.stateManager.scope,
            storageKey: this.stateManager.prefix, dirty: this.stateManager.dirty,
            ...patch,
            pendingReconciliation: this.stateManager.pending.length > 0,
        };
        await context.saveMetadata?.();
    }

    async recoverStorage() {
        this.gate.invalidate();
        return this.enqueue(async () => {
            if (!this.storage.recover) return { recovered: false, reason: 'Browser storage is active' };
            await this.storage.recover();
            await this.loadChatNow(getContext());
            return { recovered: true };
        });
    }

    configureSession(options) {
        const context = getContext(); this.gate.invalidate();
        return this.enqueue(async () => {
            if (!this.stateReady || getChatFingerprint(context) !== getChatFingerprint(getContext())) throw new Error('State unavailable or chat changed');
            const scope = await configureSession(this.stateManager, options);
            this.memoryStore.items = this.stateManager.memories;
            await this.persistCompactMetadata(context); return scope;
        });
    }

    authorEdit(value) {
        const context = getContext();
        this.gate.invalidate();
        return this.enqueue(async () => {
            if (!this.stateReady || getChatFingerprint(context) !== getChatFingerprint(getContext())) throw new Error('World state is unavailable or chat changed');
            if (!value || !Array.isArray(value.ops) || Object.keys(value).some(k => !['reason', 'ops', 'simulation'].includes(k))) throw new Error('Expected { reason, ops }');
            await this.stateManager.selectBranch(await branchReferences(context, Infinity, this.stateManager.canonVersion));
            const state = await this.stateManager.authorEdit(value.ops, value.reason, value.simulation ? {...value.simulation, policy:{...simulationPolicy(this.settings, this.stateManager.state, this.participants, context.name1),...value.simulation.policy}} : undefined);
            await this.persistCompactMetadata(context);
            return state;
        });
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
            if (this.settings.spriteDirector) this.spriteState = await applySpriteDecisions(post.sprite_decisions, {
                context, currentSpeaker: speaker, previous: this.spriteState,
                allowedCandidates: { [speaker]: this.spriteManifests.candidatesFor(speaker, this.stateManager.snapshot(), 20) },
            });
            this.diagnostics.update({ lastSprites: this.spriteState });
            return post.sprite_decisions || {};
        } finally {
            this.gate.finish(token);
        }
    }

    async describeVisualScene() { return this.visualDirector.scene(); }
    async requestIllustration() { return this.visualDirector.request(); }
    async visualJobs() { return this.visualDirector.jobs(); }
    setVisualProfile(value) { return this.enqueue(()=>this.visualDirector.setProfile(value)); }

    async exportState() {
        return {
            schemaVersion: this.stateManager.state.schemaVersion, chatFingerprint: getChatFingerprint(getContext()),
            state: this.stateManager.snapshot(), memories: [...this.memoryStore.items],
            threads: Object.values(this.stateManager.state.threads || {}),
            timeline: this.stateManager.state.timeline, spriteState: { ...this.spriteState },
            visualProfiles: await this.visualDirector.profiles(),
        };
    }

    importState(value) {
        this.gate.invalidate();
        return this.enqueue(() => this.importStateNow(value));
    }

    async importStateNow(value) {
        const validation = validateSchema(await loadSchema('export'), value);
        if (!validation.valid) throw new Error(`Invalid Narrative Engine export: ${validation.errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
        if (value.visualProfiles) {
            for (const [id, profile] of Object.entries(value.visualProfiles)) {
                if (id !== profile.entityId) throw new Error('Visual profile ID mismatch');
                visualProfile(profile);
            }
        }
        await this.stateManager.importData(value);
        this.spriteManifests.visualProfiles = await this.visualDirector.profiles();
        this.memoryStore.items = this.stateManager.memories;
        this.spriteState = value.spriteState || {};
        await this.persistCompactMetadata();
    }
}
