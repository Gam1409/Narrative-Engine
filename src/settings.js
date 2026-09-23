export const MODULE_NAME = 'narrative_engine';
export const SCHEMA_VERSION = 1;

export const DEFAULT_PROMPT_VARIANTS = Object.freeze({
    continuity: 'balanced', characterState: 'balanced', relationships: 'balanced', knowledge: 'strict',
    plotManager: 'balanced', worldSimulation: 'balanced', memoryRetrieval: 'balanced', spriteDirector: 'balanced',
});

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    provider: 'server',
    endpoint: 'http://127.0.0.1:8080/v1',
    model: '',
    connectionProfileId: '',
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
    auditMode: 'soft',
    recentMessages: 12,
    memoryTopK: 6,
    plotInterval: 3,
    memoryConsolidationInterval: 8,
    checkpointInterval: 10,
    worldEventChance: 0,
    packetTokenBudget: 1500,
    preDirectorTimeoutMs: 45000,
    postDirectorTimeoutMs: 60000,
    healthTimeoutMs: 5000,
    temperature: 0.2,
});

function clampNumber(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

/** Returns a normalized copy. Secrets are deliberately not part of the schema. */
export function normalizeSettings(candidate = {}) {
    const merged = { ...DEFAULT_SETTINGS, ...(candidate && typeof candidate === 'object' ? candidate : {}) };
    const providers = new Set(['server', 'openai', 'ollama', 'sillytavern', 'connectionProfile']);
    const auditModes = new Set(['off', 'soft', 'strict']);
    const promptPresets = new Set(['balanced', 'strictContinuity', 'livingWorld', 'characterDriven', 'custom']);
    const promptVariants = new Set(['light', 'balanced', 'strict']);
    merged.provider = providers.has(merged.provider) ? merged.provider : DEFAULT_SETTINGS.provider;
    merged.auditMode = auditModes.has(merged.auditMode) ? merged.auditMode : DEFAULT_SETTINGS.auditMode;
    merged.promptPreset = promptPresets.has(merged.promptPreset) ? merged.promptPreset : DEFAULT_SETTINGS.promptPreset;
    merged.promptVariants = Object.fromEntries(Object.keys(DEFAULT_PROMPT_VARIANTS).map((key) => [
        key,
        promptVariants.has(merged.promptVariants?.[key]) ? merged.promptVariants[key] : DEFAULT_PROMPT_VARIANTS[key],
    ]));
    merged.endpoint = String(merged.endpoint || DEFAULT_SETTINGS.endpoint).trim();
    merged.model = String(merged.model || '').trim();
    merged.connectionProfileId = String(merged.connectionProfileId || '').trim().slice(0, 200);
    merged.recentMessages = clampNumber(merged.recentMessages, 2, 50, 12);
    merged.memoryTopK = clampNumber(merged.memoryTopK, 1, 20, 6);
    merged.plotInterval = clampNumber(merged.plotInterval, 1, 50, 3);
    merged.memoryConsolidationInterval = clampNumber(merged.memoryConsolidationInterval, 2, 100, 8);
    merged.checkpointInterval = clampNumber(merged.checkpointInterval, 2, 100, 10);
    merged.worldEventChance = clampNumber(merged.worldEventChance, 0, 1, 0);
    merged.packetTokenBudget = clampNumber(merged.packetTokenBudget, 500, 2000, 1500);
    merged.preDirectorTimeoutMs = clampNumber(merged.preDirectorTimeoutMs, 1000, 120000, 45000);
    merged.postDirectorTimeoutMs = clampNumber(merged.postDirectorTimeoutMs, 1000, 180000, 60000);
    merged.healthTimeoutMs = clampNumber(merged.healthTimeoutMs, 500, 30000, 5000);
    merged.temperature = clampNumber(merged.temperature, 0, 2, 0.2);
    delete merged.apiKey;
    delete merged.api_key;
    delete merged.authorization;
    delete merged.secret;
    delete merged.secretId;
    delete merged.secret_id;
    delete merged['secret-id'];
    delete merged.token;
    return merged;
}

export function getSettings(context = globalThis.SillyTavern?.getContext?.()) {
    if (!context?.extensionSettings) throw new Error('SillyTavern extension settings are unavailable.');
    const normalized = normalizeSettings(context.extensionSettings[MODULE_NAME]);
    context.extensionSettings[MODULE_NAME] = normalized;
    return normalized;
}

export function saveSettings(context, next) {
    const normalized = normalizeSettings(next);
    context.extensionSettings[MODULE_NAME] = normalized;
    context.saveSettingsDebounced?.();
    return normalized;
}
