function command(context, name, callback, helpString) {
    const { SlashCommandParser, SlashCommand } = context;
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name, callback, helpString }));
}

export function registerCommands(context, runtime, actions) {
    command(context, 'narrative-engine', (_args, value) => {
        const enabled = String(value || '').trim().toLowerCase() === 'on';
        runtime.updateSettings({ enabled });
        return `Narrative Engine ${enabled ? 'enabled' : 'disabled'}.`;
    }, 'Enable or disable Narrative Engine: /narrative-engine on|off');
    command(context, 'narrative-configure-session', async (_args, value) => value?.trim() ? JSON.stringify(await runtime.configureSession(JSON.parse(value))) : JSON.stringify(runtime.stateManager.scope), 'Show session ID and scope, or configure a new session: {mode,campaignId,fromSession?,entities?,types?,memoryIds?}.');
    command(context, 'narrative-edit-world', async (_args, value) => JSON.stringify(await runtime.authorEdit(JSON.parse(value))), 'Explicit author correction: /narrative-edit-world {"reason":"...","ops":[...]}. Registry changes and canon edits are audited and backed up.');
    command(context, 'narrative-show-registry', () => JSON.stringify(runtime.stateManager.snapshot().registry, null, 2), 'Show entity types and parameter definitions.');
    command(context, 'narrative-reconnect-storage', async () => JSON.stringify(await runtime.recoverStorage()), 'Reconnect storage; preserve offline data and refuse conflicting remote changes.');
    command(context, 'narrative-show-state', async () => JSON.stringify(await actions.viewState(), null, 2), 'Return the current structured world state.');
    command(context, 'narrative-show-threads', async () => JSON.stringify(await actions.viewPlotThreads(), null, 2), 'Return active plot threads.');
    command(context, 'narrative-show-timeline', async () => JSON.stringify(await actions.viewTimeline(), null, 2), 'Return the in-world timeline.');
    command(context, 'narrative-show-memory', async () => JSON.stringify(await actions.viewMemories(), null, 2), 'Return retrieved episodic memories.');
    command(context, 'narrative-rebuild-state', async () => { await actions.rebuildState(); return 'Narrative Engine state rebuilt.'; }, 'Rebuild state from accepted message deltas.');
    command(context, 'narrative-show-audit', () => JSON.stringify(runtime.diagnostics.lastAudit || {}, null, 2), 'Return the last continuity audit.');
    command(context, 'narrative-show-director-context', () => runtime.diagnostics.lastPacket || '', 'Return the last ephemeral Director packet.');
    command(context, 'narrative-refresh-sprites', async () => JSON.stringify(await actions.rerunSpriteSelection(), null, 2), 'Re-run sprite selection for the latest response.');
    command(context, 'narrative-export-world', async () => JSON.stringify(await runtime.exportState(), null, 2), 'Export Narrative Engine state as JSON.');
}
