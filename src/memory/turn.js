import { validatedMemoryLinks } from './links.js';
import { validateConsolidationCandidate } from './consolidation.js';
import { validateMemoryProvenance } from './provenance.js';
import { normalizeMemory } from './policy.js';
import { textHash } from './semantic.js';

export async function prepareTurnMemories(candidates, { scope, gameTime, sources, linkSources = [], viewers, texts }) {
    const memories = [];
    for (const candidate of candidates || []) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const consolidated = validateConsolidationCandidate(candidate, sources);
        const validated = consolidated && validateMemoryProvenance(consolidated, { viewers, texts });
        if (!validated || typeof (validated.text || validated.summary) !== 'string'
            || !(validated.text || validated.summary).trim()) continue;
        const memory = normalizeMemory(validated, { ...scope, gameTime });
        if (validated.sourceMemoryIds) {
            memory.sourceMemoryIds = [...validated.sourceMemoryIds];
            memory.sourceAssertions = validated.sourceAssertions;
        }
        const links = validatedMemoryLinks(validated, linkSources, texts);
        if (links.length) memory.links = links;
        memory.embeddingHash = await textHash(memory.text);
        memories.push(memory);
    }
    return memories;
}
