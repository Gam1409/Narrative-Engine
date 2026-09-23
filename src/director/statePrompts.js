const STATE_DEFINITIONS = Object.freeze({
    continuity: { file: 'continuity', setting: 'continuity' },
    characterState: { file: 'character_state', setting: 'characterState' },
    relationships: { file: 'relationships', setting: 'relationships' },
    knowledge: { file: 'knowledge', setting: 'knowledge' },
    plotManager: { file: 'plot', setting: 'plotManager' },
    worldSimulation: { file: 'world', setting: 'worldSimulation' },
    memoryRetrieval: { file: 'memory', setting: 'memoryRetrieval' },
    spriteDirector: { file: 'sprites', setting: 'spriteDirector' },
});

export const PROMPT_VARIANTS = Object.freeze(['light', 'balanced', 'strict']);

export const PROMPT_PRESETS = Object.freeze({
    balanced: {
        continuity: 'balanced', characterState: 'balanced', relationships: 'balanced', knowledge: 'strict',
        plotManager: 'balanced', worldSimulation: 'balanced', memoryRetrieval: 'balanced', spriteDirector: 'balanced',
    },
    strictContinuity: {
        continuity: 'strict', characterState: 'strict', relationships: 'balanced', knowledge: 'strict',
        plotManager: 'light', worldSimulation: 'light', memoryRetrieval: 'strict', spriteDirector: 'balanced',
    },
    livingWorld: {
        continuity: 'balanced', characterState: 'balanced', relationships: 'balanced', knowledge: 'strict',
        plotManager: 'strict', worldSimulation: 'strict', memoryRetrieval: 'balanced', spriteDirector: 'balanced',
    },
    characterDriven: {
        continuity: 'balanced', characterState: 'strict', relationships: 'strict', knowledge: 'strict',
        plotManager: 'balanced', worldSimulation: 'light', memoryRetrieval: 'strict', spriteDirector: 'strict',
    },
});

const cache = new Map();

export function resolvePromptVariants(settings = {}) {
    const preset = settings.promptPreset;
    const source = preset === 'custom' ? settings.promptVariants : PROMPT_PRESETS[preset] || PROMPT_PRESETS.balanced;
    return Object.fromEntries(Object.keys(STATE_DEFINITIONS).map((key) => [
        key,
        PROMPT_VARIANTS.includes(source?.[key]) ? source[key] : PROMPT_PRESETS.balanced[key],
    ]));
}

async function loadFragment(file, variant) {
    const key = `${file}/${variant}`;
    if (cache.has(key)) return cache.get(key);
    const response = await fetch(new URL(`../../prompts/states/${file}/${variant}.md`, import.meta.url));
    if (!response.ok) throw new Error(`State prompt ${key} returned HTTP ${response.status}.`);
    const value = (await response.text()).trim();
    cache.set(key, value);
    return value;
}

/** Builds one prompt addendum; it never creates extra Director calls. */
export async function loadStatePromptBundle(settings, role) {
    if (!['pre', 'post'].includes(role)) return '';
    const variants = resolvePromptVariants(settings);
    const enabled = Object.entries(STATE_DEFINITIONS).filter(([, definition]) => settings[definition.setting]);
    const sections = (await Promise.all(enabled.map(async ([key, definition]) => {
        try {
            const fragment = await loadFragment(definition.file, variants[key]);
            return `## ${key} (${variants[key]})\n${fragment}`;
        } catch (error) {
            console.warn(`[Narrative Engine] State prompt ${definition.file}/${variants[key]} unavailable.`, error);
            return '';
        }
    }))).filter(Boolean);
    const phaseRule = role === 'pre'
        ? 'PRE PHASE: use these rules to select constraints and guidance for the RP model; do not invent future changes.'
        : 'POST PHASE: use these rules to audit the completed response and emit only text-supported deltas.';
    return sections.length ? `STATE-SPECIFIC RULES\n${phaseRule}\n\n${sections.join('\n\n')}` : '';
}

export function clearStatePromptCache() { cache.clear(); }
