import { textHash } from '../memory/semantic.js';

/** Catalog is created by the engine from this turn, never from model output. */
export async function buildEvidenceCatalog(texts) {
    const catalog = [];
    for (const [key, source] of [['user', 'user_action'], ['rp', 'rp']]) {
        const text = String(texts[key] || '');
        const digest = (await textHash(source + '\0' + text)).slice(0, 16);
        // Keep exact original substrings, including punctuation and language.
        const lines = text.match(/[^\r\n]+/g) || [];
        let index = 0;
        for (const line of lines) {
            for (let offset = 0; offset < line.length; offset += 600) {
                const quote = line.slice(offset, offset + 600);
                if (!quote.trim()) continue;
                catalog.push({ ref: `${source}:${digest}:${index++}`, source, quote });
            }
        }
    }
    if (catalog.length > 256) throw new Error('Evidence catalog exceeds turn budget');
    return catalog;
}

export function resolveEvidence(evidence, texts) {
    if (evidence && Object.hasOwn(evidence, 'ref')) {
        if (Object.keys(evidence).join() !== 'ref' || typeof evidence.ref !== 'string') throw new Error('Simulation: Invalid evidence reference shape');
        const entry = texts.evidenceCatalog?.find(item => item.ref === evidence.ref);
        if (!entry) throw new Error('Simulation: Unknown current-turn evidence reference');
        evidence = { source: entry.source, quote: entry.quote };
    }
    if (!evidence || !['rp','user_action'].includes(evidence.source) || typeof evidence.quote !== 'string' || !evidence.quote.trim()
        || !String(evidence.source === 'rp' ? texts.rp : texts.user).includes(evidence.quote)) throw new Error('Simulation: Event evidence must quote the current turn');
    return { source: evidence.source, quote: evidence.quote };
}
