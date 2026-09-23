const cache = new Map();

const FALLBACKS = {
    pre: 'Return strict JSON describing current truth and direction. Never invent user actions.',
    post: 'Return strict JSON with audit, deltas, memories, threads, and sprite decisions. Never invent user actions.',
    reconcile: 'Return strict JSON with a replacement field. Preserve voice and events; correct only listed continuity errors.',
};

export async function loadPrompt(name) {
    if (cache.has(name)) return cache.get(name);
    const fileNames = {
        pre: 'pre_director.md',
        post: 'post_director.md',
        reconcile: 'audit.md',
        memory: 'memory_consolidation.md',
        world: 'world_simulation.md',
        sprites: 'sprite_selection.md',
    };
    const file = fileNames[name];
    if (!file) return FALLBACKS[name] || '';
    try {
        const response = await fetch(new URL(`../../prompts/${file}`, import.meta.url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const prompt = await response.text();
        cache.set(name, prompt);
        return prompt;
    } catch (error) {
        console.warn(`[Narrative Engine] Could not load ${file}; using embedded fallback.`, error);
        return FALLBACKS[name] || FALLBACKS.post;
    }
}

export function clearPromptCache() {
    cache.clear();
}
