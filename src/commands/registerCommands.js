function command(context, name, callback, helpString, aliases = []) {
    const { SlashCommandParser, SlashCommand } = context;
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name, aliases, callback, helpString }));
}

export function registerCommands(context, runtime, actions) {
    command(context, 'narrative-engine', (_args, value) => {
        const enabled = String(value || '').trim().toLowerCase() === 'on';
        runtime.updateSettings({ enabled });
        return `Narrative Engine ${enabled ? 'enabled' : 'disabled'}.`;
    }, 'Enable or disable Narrative Engine: /narrative-engine on|off');
    command(context, 'ne-state', async () => JSON.stringify(await actions.viewState(), null, 2), 'Return the current structured world state.');
    command(context, 'ne-threads', async () => JSON.stringify(await actions.viewPlotThreads(), null, 2), 'Return active plot threads.');
    command(context, 'ne-timeline', async () => JSON.stringify(await actions.viewTimeline(), null, 2), 'Return the in-world timeline.');
    command(context, 'ne-memory', async () => JSON.stringify(await actions.viewMemories(), null, 2), 'Return retrieved episodic memories.');
    command(context, 'ne-rebuild', async () => { await actions.rebuildState(); return 'Narrative Engine state rebuilt.'; }, 'Rebuild state from accepted message deltas.');
    command(context, 'ne-audit', () => JSON.stringify(runtime.diagnostics.lastAudit || {}, null, 2), 'Return the last continuity audit.');
    command(context, 'ne-director', () => runtime.diagnostics.lastPacket || '', 'Return the last ephemeral Director packet.');
    command(context, 'ne-sprite', async () => JSON.stringify(await actions.rerunSpriteSelection(), null, 2), 'Re-run sprite selection for the latest response.');
    command(context, 'ne-export', async () => JSON.stringify(await runtime.exportState(), null, 2), 'Export Narrative Engine state as JSON.');
}
