const DEFAULT_PROMPT_VARIANTS = Object.freeze({
    continuity: 'balanced',
    characterState: 'balanced',
    relationships: 'balanced',
    knowledge: 'strict',
    plotManager: 'balanced',
    worldSimulation: 'balanced',
    memoryRetrieval: 'balanced',
    spriteDirector: 'balanced',
});

const DEFAULT_UI_SETTINGS = Object.freeze({
    enabled: false,
    provider: 'server',
    endpoint: '',
    model: '',
    connectionProfileId: '',
    auditMode: 'soft',
    recentMessages: 12,
    memoryTopK: 6,
    plotInterval: 3,
    memoryConsolidationInterval: 8,
    checkpointInterval: 10,
    continuity: true,
    characterState: true,
    relationships: true,
    knowledge: true,
    plotManager: true,
    worldSimulation: true,
    memoryRetrieval: true,
    auditor: true,
    spriteDirector: true,
    promptPreset: 'balanced',
    promptVariants: DEFAULT_PROMPT_VARIANTS,
});

const PROFILE_DESCRIPTIONS = Object.freeze({
    balanced: 'Even guidance across continuity, characters, plot, and world state.',
    strictContinuity: 'Prioritizes established facts and memory; plot and world intervention stay light.',
    livingWorld: 'Lets plot threads and the world advance more actively between character turns.',
    characterDriven: 'Focuses on character state, relationships, memory, and expressive sprite choices.',
    custom: 'Tune the guidance level for each story state below.',
});

const NUMBER_SETTINGS = new Set([
    'recentMessages', 'memoryTopK', 'plotInterval', 'memoryConsolidationInterval', 'checkpointInterval',
]);

const STATUS_FIELDS = [
    'providerStatus', 'preLatency', 'postLatency', 'scene', 'time', 'presentCharacters',
    'threads', 'retrievedMemories', 'lastAudit', 'spriteDecisions', 'tokenEstimates', 'errors',
];

const DEBUG_FUNCTIONS = Object.freeze([
    ['clear-transient-cache', 'Clear transient cache', 'Clear short-lived Narrative Engine caches.', 'clearTransientCache'],
    ['rebuild-state', 'Rebuild state', 'Rebuild the current chat state from checkpoints and message deltas.', 'rebuildState'],
    ['export-diagnostics', 'Export diagnostics', 'Export redacted Narrative Engine diagnostics.', 'exportDiagnostics'],
    ['health-check', 'Health check', 'Check the configured Director provider.', 'healthCheck'],
    ['rerun-sprite-selection', 'Re-run sprite selection', 'Run sprite selection again for the current message.', 'rerunSpriteSelection'],
]);

/** Create a complete UI settings object without mutating stored settings. */
export function normalizeUiSettings(settings = {}) {
    return {
        ...DEFAULT_UI_SETTINGS,
        ...settings,
        ...(settings.modules && typeof settings.modules === 'object' ? settings.modules : {}),
        promptVariants: {
            ...DEFAULT_PROMPT_VARIANTS,
            ...(settings.promptVariants && typeof settings.promptVariants === 'object' ? settings.promptVariants : {}),
        },
    };
}

/** Read a dot-delimited setting path. */
export function getSettingValue(settings, path) {
    return String(path).split('.').reduce((value, key) => value?.[key], settings);
}

/** Set a dot-delimited setting path while preserving its sibling values. */
export function setSettingValue(settings, path, value) {
    const keys = String(path).split('.').filter(Boolean);
    if (!keys.length) return settings;
    let target = settings;
    for (const key of keys.slice(0, -1)) {
        const child = target[key];
        target[key] = child && typeof child === 'object' && !Array.isArray(child) ? child : {};
        target = target[key];
    }
    target[keys.at(-1)] = value;
    return settings;
}

/** Convert diagnostic values to bounded, readable text without producing HTML. */
export function formatDebugValue(value, fallback = '—') {
    if (value === undefined || value === null || value === '') return fallback;
    if (Array.isArray(value)) return value.length ? value.map(item => formatDebugValue(item, '')).join(', ') : fallback;
    if (typeof value === 'object') {
        try { return JSON.stringify(value, null, 2); } catch { return '[Unavailable]'; }
    }
    return String(value);
}

function boundedProfileText(value, fallback = '') {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return fallback;
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Build a plain-text label without exposing credentials or other profile fields. */
export function formatConnectionProfileLabel(profile = {}) {
    const name = boundedProfileText(profile.name, 'Unnamed profile');
    const api = boundedProfileText(profile.api);
    const model = boundedProfileText(profile.model);
    const hint = [api, model].filter(Boolean).join(' · ');
    return hint ? `${name} — ${hint}` : name;
}

/** Register the five required functions through SillyTavern's public debug API. */
export function registerDebugFunctions(context, actions = {}) {
    if (typeof context?.registerDebugFunction !== 'function') return [];
    const registered = [];
    for (const [id, name, description, actionName] of DEBUG_FUNCTIONS) {
        if (typeof actions[actionName] !== 'function') continue;
        const functionId = `narrative-engine:${id}`;
        context.registerDebugFunction(functionId, name, description, () => actions[actionName]());
        registered.push(functionId);
    }
    return registered;
}

function statusState(status) {
    const raw = String(status?.providerStatus ?? status?.provider ?? 'unknown').toLowerCase();
    if (/(online|ready|healthy|connected|ok)/.test(raw)) return 'online';
    if (/(degraded|pending|checking)/.test(raw)) return raw.includes('pending') || raw.includes('checking') ? 'pending' : 'degraded';
    if (/(offline|failed|error|unhealthy)/.test(raw)) return raw.includes('error') || raw.includes('failed') ? 'error' : 'offline';
    return 'unknown';
}

function viewerText(data) {
    if (typeof data === 'string') return data;
    if (data === undefined) return 'No data returned.';
    try { return JSON.stringify(data, null, 2); } catch { return String(data); }
}

function setNotice(root, message, kind = 'info') {
    const notice = root.querySelector('#ne-notice');
    if (!notice) return;
    notice.textContent = message || '';
    notice.dataset.kind = kind;
    notice.hidden = !message;
}

async function showViewer(root, context, title, data) {
    const wrapper = document.createElement('section');
    const heading = document.createElement('h3');
    const content = document.createElement('pre');
    heading.textContent = title;
    content.className = 'ne-popup-content';
    content.textContent = viewerText(data);
    wrapper.append(heading, content);

    if (typeof context?.Popup === 'function' && context?.POPUP_TYPE?.TEXT !== undefined) {
        const popup = new context.Popup(wrapper, context.POPUP_TYPE.TEXT, '', {
            wide: true,
            large: true,
            okButton: 'Close',
        });
        await popup.show();
        return;
    }

    const dialog = root.querySelector('[data-viewer]');
    if (!dialog) return;
    dialog.querySelector('[data-viewer-title]').textContent = title;
    dialog.querySelector('[data-viewer-content]').textContent = viewerText(data);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
}

function readControlValue(control) {
    if (control.type === 'checkbox') return control.checked;
    if (NUMBER_SETTINGS.has(control.dataset.setting)) {
        const numericValue = Number(control.value);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }
    return control.value;
}

function renderSettings(root, settings) {
    for (const control of root.querySelectorAll('[data-setting]')) {
        const value = getSettingValue(settings, control.dataset.setting);
        if (control.type === 'checkbox') control.checked = Boolean(value);
        else control.value = value ?? '';
    }
    for (const control of root.querySelectorAll('[data-module]')) {
        control.checked = Boolean(settings[control.dataset.module]);
    }
    const endpointField = root.querySelector('[data-provider-field="endpoint"]');
    if (endpointField) endpointField.hidden = settings.provider === 'sillytavern' || settings.provider === 'connectionProfile';
    const modelField = root.querySelector('[data-provider-field="model"]');
    if (modelField) modelField.hidden = settings.provider === 'connectionProfile';
    const connectionProfileField = root.querySelector('[data-provider-field="connectionProfile"]');
    if (connectionProfileField) connectionProfileField.hidden = settings.provider !== 'connectionProfile';
    const customVariants = root.querySelector('[data-custom-variants]');
    if (customVariants) customVariants.hidden = settings.promptPreset !== 'custom';
    const profileDescription = root.querySelector('[data-profile-description]');
    if (profileDescription) profileDescription.textContent = PROFILE_DESCRIPTIONS[settings.promptPreset] ?? PROFILE_DESCRIPTIONS.balanced;
}

/** Update every debug field. All untrusted values are assigned through textContent. */
export function renderUiStatus(root, status = {}) {
    if (!root) return;
    for (const field of STATUS_FIELDS) {
        const output = root.querySelector(`[data-status="${field}"]`);
        if (!output) continue;
        const fallback = field === 'errors' ? 'None' : '—';
        output.textContent = formatDebugValue(status[field], fallback);
    }
    const badge = root.querySelector('#ne-provider-badge');
    if (badge) {
        const label = badge.querySelector('[data-status-label]');
        const providerStatus = formatDebugValue(status.providerStatus ?? status.provider, 'Not checked');
        badge.dataset.state = statusState(status);
        if (label) label.textContent = providerStatus;
    }
    const reconciliation = root.querySelector('[data-reconciliation]');
    if (reconciliation) {
        const pending = Boolean(status.pendingReconciliation) || String(status.reconciliation ?? '').toLowerCase() === 'pending';
        reconciliation.dataset.state = pending ? 'pending' : 'ready';
        reconciliation.textContent = pending ? 'Reconciliation pending' : formatDebugValue(status.reconciliation, 'State up to date');
    }
}

/**
 * Bind the Narrative Engine settings template to storage and runtime actions.
 * Returns updateStatus and destroy hooks for the extension integration layer.
 */
export function initUi({ root = document, context = {}, settings = {}, onSettingsChange = () => {}, actions = {}, status = {} } = {}) {
    const panel = root.matches?.('#narrative-engine-settings') ? root : root.querySelector?.('#narrative-engine-settings');
    if (!panel) throw new Error('Narrative Engine settings root was not found.');

    const current = normalizeUiSettings(settings);
    const controller = new AbortController();
    const { signal } = controller;
    const profileSelect = panel.querySelector('#ne-connection-profile');
    const profileStatus = panel.querySelector('#ne-connection-profile-status');
    const profileSubscriptions = [];
    let profileRefreshId = 0;
    let profileCount = 0;
    let destroyed = false;

    const setProfileStatus = (message, state) => {
        if (!profileStatus) return;
        profileStatus.textContent = message;
        profileStatus.dataset.state = state;
    };

    const updateProfileStatus = ({ available = true, count = profileCount } = {}) => {
        if (!profileSelect || !profileStatus) return;
        const selectedProfileId = String(current.connectionProfileId ?? '').trim();
        if (!available) {
            setProfileStatus('Connection profiles are unavailable in this SillyTavern version.', 'unavailable');
        } else if (selectedProfileId && !Array.from(profileSelect.options).some(option => option.value === selectedProfileId)) {
            setProfileStatus('The selected connection profile is missing. Choose another profile.', 'missing');
        } else if (!count) {
            setProfileStatus('No supported connection profiles found. Create one in SillyTavern Connections.', 'empty');
        } else if (!current.enabled) {
            setProfileStatus('Narrative Engine is disabled. This profile will be used when enabled.', 'disabled');
        } else if (!selectedProfileId) {
            setProfileStatus('Choose the SillyTavern profile used by the Director.', 'missing');
        } else {
            setProfileStatus('Credentials stay in SillyTavern and are not copied into extension settings.', 'ready');
        }
    };

    const refreshConnectionProfiles = async () => {
        if (!profileSelect) return;
        const refreshId = ++profileRefreshId;
        const service = context?.ConnectionManagerRequestService;
        if (typeof service?.getSupportedProfiles !== 'function') {
            profileCount = 0;
            profileSelect.replaceChildren();
            profileSelect.disabled = true;
            updateProfileStatus({ available: false, count: 0 });
            return;
        }
        profileSelect.disabled = true;
        setProfileStatus('Loading connection profiles…', 'loading');
        try {
            const rawProfiles = await service.getSupportedProfiles();
            if (destroyed || refreshId !== profileRefreshId) return;
            const profiles = Array.isArray(rawProfiles) ? rawProfiles : [];
            const seenIds = new Set();
            const placeholder = profileSelect.ownerDocument.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select a Director connection profile';
            const options = [placeholder];
            for (const profile of profiles) {
                const id = String(profile?.id ?? '').trim();
                if (!id || seenIds.has(id)) continue;
                seenIds.add(id);
                const option = profileSelect.ownerDocument.createElement('option');
                option.value = id;
                option.textContent = formatConnectionProfileLabel(profile);
                options.push(option);
            }
            profileSelect.replaceChildren(...options);
            profileSelect.value = String(current.connectionProfileId ?? '').trim();
            profileSelect.disabled = options.length === 1;
            profileCount = options.length - 1;
            updateProfileStatus();
        } catch {
            if (destroyed || refreshId !== profileRefreshId) return;
            profileCount = 0;
            profileSelect.replaceChildren();
            profileSelect.disabled = true;
            updateProfileStatus({ available: false, count: 0 });
        }
    };
    renderSettings(panel, current);
    renderUiStatus(panel, status);

    const commit = (path, value) => {
        setSettingValue(current, path, value);
        renderSettings(panel, current);
        updateProfileStatus();
        onSettingsChange(current, { path, value });
    };

    for (const control of panel.querySelectorAll('[data-setting]')) {
        control.addEventListener('change', () => commit(control.dataset.setting, readControlValue(control)), { signal });
    }
    for (const control of panel.querySelectorAll('[data-module]')) {
        control.addEventListener('change', () => commit(control.dataset.module, control.checked), { signal });
    }

    panel.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button || !panel.contains(button)) return;
        const actionName = button.dataset.action;
        if (actionName === 'chooseImport') {
            panel.querySelector('[data-import-input]')?.click();
            return;
        }
        const action = actions[actionName];
        if (typeof action !== 'function') {
            setNotice(panel, `${button.textContent.trim()} is not available.`, 'error');
            return;
        }
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        setNotice(panel, '');
        try {
            const result = await action();
            if (button.dataset.viewerTitle) await showViewer(panel, context, button.dataset.viewerTitle, result);
            else if (typeof result === 'string' && result) setNotice(panel, result);
        } catch (error) {
            setNotice(panel, error instanceof Error ? error.message : String(error), 'error');
        } finally {
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }
    }, { signal });

    panel.querySelector('[data-import-input]')?.addEventListener('change', async event => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (typeof actions.importState !== 'function') throw new Error('Import state is not available.');
            await actions.importState(parsed, file);
            setNotice(panel, 'State imported.');
        } catch (error) {
            setNotice(panel, error instanceof Error ? error.message : String(error), 'error');
        } finally {
            input.value = '';
        }
    }, { signal });

    registerDebugFunctions(context, actions);
    const eventTypes = context?.eventTypes || context?.event_types || {};
    for (const eventName of [
        eventTypes.CONNECTION_PROFILE_CREATED,
        eventTypes.CONNECTION_PROFILE_UPDATED,
        eventTypes.CONNECTION_PROFILE_DELETED,
    ]) {
        if (!eventName || typeof context?.eventSource?.on !== 'function') continue;
        context.eventSource.on(eventName, refreshConnectionProfiles);
        profileSubscriptions.push([eventName, refreshConnectionProfiles]);
    }
    void refreshConnectionProfiles();
    return {
        settings: current,
        updateStatus(nextStatus) { renderUiStatus(panel, nextStatus); },
        destroy() {
            destroyed = true;
            profileRefreshId += 1;
            controller.abort();
            for (const [eventName, handler] of profileSubscriptions) {
                if (typeof context.eventSource?.removeListener === 'function') context.eventSource.removeListener(eventName, handler);
                else context.eventSource?.off?.(eventName, handler);
            }
        },
    };
}

/** Render the trusted local template with the public ST renderer, then bind it. */
export async function mountUi({ container, context, extensionName = 'third-party/Narrative-Engine', templateName = 'settings', ...options }) {
    if (!container) throw new Error('A settings container is required.');
    if (typeof context?.renderExtensionTemplateAsync !== 'function') {
        return initUi({ root: container, context, ...options });
    }
    const html = await context.renderExtensionTemplateAsync(extensionName, templateName);
    const template = document.createElement('template');
    template.innerHTML = html;
    container.replaceChildren(template.content.cloneNode(true));
    return initUi({ root: container, context, ...options });
}

export { DEFAULT_UI_SETTINGS };
