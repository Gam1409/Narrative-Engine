import { getEventTypes } from '../context/stContext.js';

export function registerEvents(context, runtime, refreshUi = () => {}) {
    const events = getEventTypes(context);
    const source = context.eventSource;
    const subscriptions = [];
    const on = (event, handler) => {
        if (!event || !source?.on) return;
        source.on(event, handler);
        subscriptions.push([event, handler]);
    };
    const safe = (phase, handler) => async (...args) => {
        try { await handler(...args); }
        catch (error) { runtime.diagnostics.error(error, phase); }
        finally { refreshUi(); }
    };

    on(events.APP_INITIALIZED, safe('app-initialized', async () => {}));
    on(events.APP_READY, safe('app-ready', async () => {}));
    on(events.MESSAGE_SENT, safe('message-sent', async () => {}));
    on(events.MESSAGE_RECEIVED, safe('message-received', async () => {}));
    on(events.USER_MESSAGE_RENDERED, safe('user-message-rendered', async () => {}));
    on(events.CHARACTER_MESSAGE_RENDERED, safe('post', (index, type) => runtime.processPost(Number(index), type)));
    for (const event of [events.MESSAGE_EDITED, events.MESSAGE_DELETED, events.MESSAGE_SWIPED]) {
        on(event, safe('rebuild', (index) => runtime.markDirtyAndRebuild(Number(index) || 0)));
    }
    on(events.GENERATION_AFTER_COMMANDS, safe('generation-after-commands', async () => {}));
    on(events.GENERATION_STARTED, safe('generation-started', (type, params, dryRun) => runtime.generationStarted(type, params, dryRun)));
    on(events.GENERATION_STOPPED, safe('generation-stopped', async () => runtime.generationStopped()));
    on(events.GENERATION_ENDED, safe('generation-ended', async () => {
        if (runtime.settings.enabled && runtime.diagnostics.status === 'generating') runtime.diagnostics.update({ status: 'post-processing' });
    }));
    on(events.CHAT_CHANGED, safe('chat-changed', async () => {
        runtime.generationStopped();
        await runtime.loadChat();
        runtime.recreateProvider();
    }));
    on(events.CHAT_CREATED, safe('chat-created', async () => runtime.loadChat()));
    on(events.CONNECTION_PROFILE_LOADED, safe('connection-profile', async () => runtime.recreateProvider()));
    on(events.WORLDINFO_UPDATED, safe('world-info', () => runtime.markDirtyAndRebuild(0)));
    on(events.WORLDINFO_SETTINGS_UPDATED, safe('world-info-settings', () => runtime.markDirtyAndRebuild(0)));

    return () => {
        for (const [event, handler] of subscriptions) source.removeListener?.(event, handler);
    };
}
