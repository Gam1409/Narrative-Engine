const cache = new Map();

const FALLBACKS = {
    pre: { type: 'object', required: ['scene', 'must_preserve', 'character_states', 'active_threads', 'scene_plan', 'user_agency'] },
    post: { type: 'object', required: ['audit', 'state_delta', 'relationship_delta', 'knowledge_delta', 'thread_delta', 'memory_candidates', 'sprite_decisions'] },
    reconcile: { type: 'object', required: ['replacement'], properties: { replacement: { type: 'string', minLength: 1 } }, additionalProperties: false },
    state: { type: 'object', required: ['schemaVersion', 'scene', 'characters', 'objects', 'timeline', 'relationships', 'knowledge', 'threads'] },
    export: { type: 'object', required: ['schemaVersion', 'chatFingerprint', 'state', 'memories', 'threads', 'timeline', 'spriteState'] },
};

export async function loadSchema(name) {
    if (cache.has(name)) return cache.get(name);
    const file = name === 'pre' ? 'pre_director.schema.json'
        : name === 'post' ? 'post_director.schema.json'
            : `${name}.schema.json`;
    try {
        const response = await fetch(new URL(`../../schemas/${file}`, import.meta.url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const schema = await response.json();
        cache.set(name, schema);
        return schema;
    } catch (error) {
        console.warn(`[Narrative Engine] Could not load ${file}; using embedded schema.`, error);
        return FALLBACKS[name];
    }
}
