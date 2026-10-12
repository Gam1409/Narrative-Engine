import { clone } from '../utils/object.js';
import { selected } from './policy.js';
import { createInitialState } from '../state/model.js';
import { migrateState } from '../state/migrations.js';
import { createCheckpoint } from '../state/checkpoints.js';

export async function configureSession(manager, options) {
    if (!options || !['session_only', 'campaign', 'selective'].includes(options.mode)) throw new Error('Invalid memory scope');
    if (manager.records.length || manager.deltas.some(d => d.messageIndex >= 0)) throw new Error('Choose memory scope before the first accepted turn');
    if (typeof options.campaignId !== 'string' || !options.campaignId.trim() || options.campaignId.length > 200) throw new Error('campaignId is required');
    const scope = { mode: options.mode, campaignId: options.campaignId.trim(), sessionId: manager.chatFingerprint };
    for (const key of ['entities', 'types', 'memoryIds']) {
        if (options[key] !== undefined && (!Array.isArray(options[key]) || options[key].some(v => typeof v !== 'string'))) throw new Error(`Invalid ${key}`);
        scope[key] = clone(options[key] || []);
    }
    let state = manager.snapshot(), memories = [];
    if (options.fromSession && options.mode !== 'session_only') {
        if (!/^ne-[a-f0-9]+$/.test(options.fromSession) || options.fromSession === manager.chatFingerprint) throw new Error('Invalid source session');
        const source = await manager.storage.getItem(`narrative-engine:${options.fromSession}:bundle`);
        if (!source || source.scope?.campaignId !== scope.campaignId || source.pending?.length) throw new Error('Source session unavailable, pending, or outside campaign');
        if (options.mode === 'campaign') {
            state = migrateState(source.state);
            state.threads = Object.fromEntries(Object.entries(state.threads || {}).filter(([, v]) => !['resolved','closed','archived'].includes(v?.status)));
            memories = clone(source.memories || []);
        } else {
            state = createInitialState();
            memories = clone((source.memories || []).filter(m => selected(m, scope)));
            state.threads = Object.fromEntries(Object.entries(source.state?.threads || {}).filter(([id, v]) => !['resolved','closed','archived'].includes(v?.status) && selected({ id, type: 'thread', entities: v?.entities || [] }, scope)));
        }
        scope.fromSession = options.fromSession;
    }
    // Baseline is a snapshot: later edits in the source session do not rewrite this session.
    await manager.commit({ scope, state, memories, deltas: [], pending: [], checkpoints: [createCheckpoint(state, -1, { imported: true, memories })], canonVersion: manager.canonVersion + 1 });
    return clone(scope);
}
