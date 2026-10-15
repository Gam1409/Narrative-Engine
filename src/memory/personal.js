import { lexicalTokens } from './semantic.js';

// Only the already projected recipient context is accepted here; never the whole state.
export function personalMemoryScore(memory, personal) {
    if (!personal?.characterId) return 0;
    const text = [memory.text || memory.summary, ...(memory.topics || [])].join(' ');
    const terms = lexicalTokens(text);
    if (!terms.size) return 0;
    const cues = [
        ...(personal.causes || []).map(event => event.summary),
        ...(personal.appraisals || []).map(appraisal => appraisal.meaning),
        ...(personal.motivation || []).filter(value => typeof value === 'string'),
    ].filter(value => typeof value === 'string' && value.trim());
    let similarity = 0;
    for (const cue of cues) {
        const tokens = lexicalTokens(cue);
        const matches = [...tokens].filter(token => terms.has(token)).length;
        if (tokens.size) similarity = Math.max(similarity, matches / Math.sqrt(tokens.size * terms.size));
    }
    // Small tie-breaker, never an eligibility override or a confidence update.
    return Math.min(0.15, similarity * 0.15);
}
