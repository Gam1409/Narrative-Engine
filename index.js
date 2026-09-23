import { registerCommands } from './src/commands/registerCommands.js';
import { getContext } from './src/context/stContext.js';
import { registerEvents } from './src/events/registerEvents.js';
import { installInterceptor, uninstallInterceptor } from './src/interceptors/narrativeEngineInterceptor.js';
import { NarrativeRuntime } from './src/runtime/runtime.js';
import { createUiActions, runtimeUiStatus } from './src/ui/actions.js';
import { mountUi } from './src/ui/index.js';

let runtime;
let ui;
let disposeEvents;
let disposeDiagnostics;
let bootPromise;

async function mountSettings(context, actions) {
    const host = document.querySelector('#extensions_settings2');
    if (!host) throw new Error('SillyTavern extensions settings container was not found.');
    let container = document.querySelector('#narrative-engine-settings-mount');
    if (!container) {
        container = document.createElement('div');
        container.id = 'narrative-engine-settings-mount';
        host.append(container);
    }
    return mountUi({
        container, context, extensionName: 'third-party/Narrative-Engine', templateName: 'settings',
        settings: runtime.settings,
        onSettingsChange: (next) => runtime.updateSettings(next),
        actions,
        status: runtimeUiStatus(runtime),
    });
}

export async function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
        const context = getContext();
        runtime = await new NarrativeRuntime().initialize(context);
        installInterceptor(runtime);
        const actions = createUiActions(runtime);
        ui = await mountSettings(context, actions);
        const refreshUi = () => ui?.updateStatus(runtimeUiStatus(runtime));
        disposeDiagnostics = runtime.diagnostics.subscribe(refreshUi);
        disposeEvents = registerEvents(context, runtime, refreshUi);
        registerCommands(context, runtime, actions);
        refreshUi();
        console.info('[Narrative Engine] Initialized against the public SillyTavern context API.');
        return runtime;
    })().catch((error) => {
        bootPromise = null;
        console.error('[Narrative Engine] Initialization failed.', error);
        globalThis.toastr?.error?.(String(error.message || error), 'Narrative Engine');
        throw error;
    });
    return bootPromise;
}

export async function onActivate() {
    return boot();
}

export async function onUpdate() {
    const active = await boot();
    await active.loadChat();
}

export async function onDisable() {
    if (!runtime) return;
    runtime.updateSettings({ enabled: false });
    runtime.generationStopped();
    runtime.diagnostics.update({ status: 'disabled' });
}

export async function onClean() {
    if (!runtime?.storage) return;
    const keys = await runtime.storage.keys();
    await Promise.all(keys.filter((key) => String(key).startsWith('narrative-engine:')).map((key) => runtime.storage.removeItem(key)));
    runtime.diagnostics.update({ lastPacket: '', lastAudit: null, retrievedMemories: [], errors: [] });
}

export function dispose() {
    disposeEvents?.();
    disposeDiagnostics?.();
    ui?.destroy?.();
    uninstallInterceptor();
    disposeEvents = disposeDiagnostics = ui = runtime = null;
    bootPromise = null;
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
    else void boot();
}
