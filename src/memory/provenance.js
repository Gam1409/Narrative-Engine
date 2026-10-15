import { resolveEvidence } from '../state/evidence.js';

/** Optional assertion provenance. Legacy entries remain explicitly unspecified. */
export function validateMemoryProvenance(candidate, { viewers, texts }) {
    if (!candidate.provenance) return candidate;
    const p = candidate.provenance;
    if (!p || !['observed', 'reported', 'inferred'].includes(p.kind)
        || typeof p.holder !== 'string' || !viewers.includes(p.holder)
        || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1) return null;
    try {
        const evidence = resolveEvidence(p.evidence, texts);
        // A player's assertion cannot establish an NPC's personal knowledge.
        if (evidence.source !== 'rp') return null;
        const belief = p.kind !== 'observed' || candidate.type === 'belief';
        return { ...candidate, ...(belief ? { type: 'belief' } : {}), factKey: undefined, supersedes: [],
            // Personal claims remain private even if the model requests public visibility.
            visibleTo: [p.holder],
            provenance: { holder: p.holder, kind: p.kind, confidence: p.confidence, evidence } };
    } catch { return null; }
}
