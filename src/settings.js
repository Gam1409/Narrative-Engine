import { SIMULATION_DEFAULTS } from './state/simulation.js';
export const MODULE_NAME = 'narrative_engine';
export const SCHEMA_VERSION = 1;

export const DEFAULT_PROMPT_VARIANTS = Object.freeze({
    continuity: 'balanced', characterState: 'balanced', relationships: 'balanced', knowledge: 'strict',
    plotManager: 'balanced', worldSimulation: 'balanced', memoryRetrieval: 'balanced', spriteDirector: 'balanced',
});

export const DEFAULT_SETTINGS = Object.freeze({
    ...SIMULATION_DEFAULTS,
    showInternalState: false,
    visualUserWorkflows: [], visualAnimaVariant: 'base', visualPositive: '', visualNegative: '',
    visualIllustrationPolicy: 'significant',
    visualLlmIntent: false, visualLocalExpressions: false, visualFaceDetector: '',
    visualLayers: false, visualBackgroundWorkflow: 'background', visualSpriteWorkflow: '',
    visualEndpoint: '', visualCheckpoint: '', visualPromptProfile: 'sdxl', visualCooldownMs: 15000,
    visualStyle: '', visualCamera: '', visualTextEncoder: '', visualVae: '',
    visualEnabled: false, visualAutomatic: false, visualKeepSeed: true, visualPartial: false,
    visualWorkflow: 'scene_full', visualPartialWorkflow: '', visualStages: {controlnet:false,ipadapter:false,mask:false},
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
    minimumConfidence: 0.5,
    recentMessages: 12,
    memoryTopK: 6,
    embeddingSearch: false,
    memoryWeights: { semantic: 0.55, importance: 0.2, entities: 0.1, location: 0.1, recency: 0.05, old: 0.3 },
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
    merged.innerLifeMode = ['off','light','full'].includes(merged.innerLifeMode) ? merged.innerLifeMode : 'light';
    merged.simulationLevel = ['minimal','standard','living'].includes(merged.simulationLevel) ? merged.simulationLevel : 'standard';
    merged.showInternalState = merged.showInternalState === true;
    for (const key of ['significanceThreshold','relationshipConfidence','relationshipMaxChange']) merged[key] = clampNumber(merged[key],0,1,SIMULATION_DEFAULTS[key]);
    merged.repetitionThreshold = Math.round(clampNumber(merged.repetitionThreshold,2,20,3));
    merged.minTurnMinutes = clampNumber(merged.minTurnMinutes,0,525600,0);
    merged.maxTurnMinutes = clampNumber(merged.maxTurnMinutes,merged.minTurnMinutes,525600,1440);
    for(const key of ['visualEnabled','visualAutomatic','visualKeepSeed','visualPartial','visualLayers','visualLocalExpressions','visualLlmIntent']) merged[key]=merged[key]===true;
    for(const key of ['visualWorkflow','visualPartialWorkflow','visualBackgroundWorkflow','visualSpriteWorkflow']) merged[key]=String(merged[key] || '').trim().slice(0,100);
    merged.visualUserWorkflows = Array.isArray(merged.visualUserWorkflows) ? structuredClone(merged.visualUserWorkflows.slice(0,8)) : [];
    merged.visualEndpoint = String(merged.visualEndpoint || '').trim().slice(0, 2000);
    for (const key of ['visualStyle','visualCamera']) merged[key] = String(merged[key] || '').trim().slice(0,300);
    for (const key of ['visualTextEncoder','visualVae','visualFaceDetector']) merged[key] = String(merged[key] || '').trim().slice(0,500);
    merged.visualAnimaVariant = ['base','aesthetic','turbo'].includes(merged.visualAnimaVariant) ? merged.visualAnimaVariant : 'base';
    for (const key of ['visualPositive','visualNegative']) merged[key] = String(merged[key] || '').trim().slice(0,2000);
    merged.visualCheckpoint = String(merged.visualCheckpoint || '').trim().slice(0, 500);
    merged.visualPromptProfile = ['sdxl', 'pony', 'illustrious', 'anima'].includes(merged.visualPromptProfile) ? merged.visualPromptProfile : 'sdxl';
    merged.visualIllustrationPolicy = ['significant', 'all', 'manual'].includes(merged.visualIllustrationPolicy) ? merged.visualIllustrationPolicy : 'significant';
    merged.visualCooldownMs = clampNumber(merged.visualCooldownMs, 1000, 300000, 15000);
    merged.visualStages=Object.fromEntries(['controlnet','ipadapter','mask'].map(k=>[k,merged.visualStages?.[k]===true]));
    merged.embeddingSearch = merged.embeddingSearch === true;
    merged.memoryWeights = Object.fromEntries(Object.entries(DEFAULT_SETTINGS.memoryWeights).map(([key, value]) => [key, clampNumber(merged.memoryWeights?.[key], 0, 2, value)]));
    merged.memoryTopK = clampNumber(merged.memoryTopK, 1, 20, 6);
    merged.plotInterval = clampNumber(merged.plotInterval, 1, 50, 3);
    merged.memoryConsolidationInterval = clampNumber(merged.memoryConsolidationInterval, 2, 100, 8);
    merged.checkpointInterval = clampNumber(merged.checkpointInterval, 2, 100, 10);
    merged.worldEventChance = clampNumber(merged.worldEventChance, 0, 1, 0);
    merged.packetTokenBudget = clampNumber(merged.packetTokenBudget, 500, 2000, 1500);
    merged.preDirectorTimeoutMs = clampNumber(merged.preDirectorTimeoutMs, 1000, 120000, 45000);
    merged.postDirectorTimeoutMs = clampNumber(merged.postDirectorTimeoutMs, 1000, 180000, 60000);
    merged.healthTimeoutMs = clampNumber(merged.healthTimeoutMs, 500, 30000, 5000);
    merged.minimumConfidence = clampNumber(merged.minimumConfidence, 0, 1, 0.5);
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
