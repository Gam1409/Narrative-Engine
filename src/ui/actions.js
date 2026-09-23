import { clearPromptCache } from '../director/promptLoader.js';
import { clearStatePromptCache } from '../director/statePrompts.js';

function downloadJson(name, value) {
    if (typeof document === 'undefined') return value;
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return `Saved ${name}.`;
}

export function createUiActions(runtime) {
    return {
        testConnection: async () => {
            const result = await runtime.healthCheck();
            if (!result.ok) throw new Error(result.error || 'Director is offline.');
            return `Director connected (${result.latencyMs ?? 0} ms).`;
        },
        viewState: async () => runtime.stateManager.snapshot(),
        viewTimeline: async () => runtime.stateManager.snapshot().timeline,
        viewPlotThreads: async () => runtime.stateManager.snapshot().threads,
        viewMemories: async () => runtime.memoryStore.items,
        viewLastDirectorPacket: async () => runtime.diagnostics.lastPacket || 'No Director packet has been created yet.',
        rebuildState: async () => { await runtime.markDirtyAndRebuild(0); return 'State rebuilt.'; },
        exportState: async () => downloadJson('narrative-engine-state.json', await runtime.exportState()),
        importState: async (value) => { await runtime.importState(value); return 'State imported.'; },
        clearTransientCache: async () => {
            clearPromptCache();
            clearStatePromptCache();
            runtime.diagnostics.update({ lastPacket: '', retrievedMemories: [], errors: [] });
            return 'Transient cache cleared.';
        },
        exportDiagnostics: async () => downloadJson('narrative-engine-diagnostics.json', {
            exportedAt: new Date().toISOString(),
            diagnostics: runtime.diagnostics.snapshot(),
            stateRevision: runtime.stateManager.state.revision,
            settings: { ...runtime.settings, endpoint: runtime.settings.endpoint ? '[configured]' : '' },
        }),
        healthCheck: async () => runtime.healthCheck(),
        rerunSpriteSelection: async () => runtime.rerunSpriteSelection(),
    };
}

export function runtimeUiStatus(runtime) {
    const diagnostics = runtime.diagnostics.snapshot();
    const state = runtime.stateManager?.snapshot?.() || {};
    return {
        providerStatus: diagnostics.status,
        preLatency: diagnostics.latency.pre == null ? '—' : `${diagnostics.latency.pre} ms`,
        postLatency: diagnostics.latency.post == null ? '—' : `${diagnostics.latency.post} ms`,
        scene: state.scene || {}, time: state.timeline || {},
        presentCharacters: state.scene?.present || Object.keys(state.characters || {}),
        threads: state.threads || {}, retrievedMemories: diagnostics.retrievedMemories,
        lastAudit: diagnostics.lastAudit, spriteDecisions: diagnostics.lastSprites,
        tokenEstimates: diagnostics.lastPacket ? Math.ceil(diagnostics.lastPacket.length / 4) : 0,
        errors: diagnostics.errors, pendingReconciliation: Boolean(runtime.context?.chatMetadata?.narrative_engine?.pendingReconciliation),
    };
}
