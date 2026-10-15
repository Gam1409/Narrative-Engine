/** Local observations only: no prose, prompts, state writes or provider calls. */
function shingles(text) {
    const normalized = String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (normalized.length < 80) return new Set();
    const result = new Set();
    const bounded = normalized.slice(0, 12000);
    for (let i = 0; i <= bounded.length - 32; i++) result.add(bounded.slice(i, i + 32));
    return result;
}

export function observeQuality(turns, window = 6) {
    const size = Math.min(12, Math.max(4, Math.round(Number(window) || 6)));
    const recent = turns.slice(-size);
    const result = { mode: 'observe', window: size, sampled: recent.length, status: 'NONE', signals: [],
        scope: 'current accepted branch; latest response only',
        limitation: 'Lexical overlap is not proof of poor writing. Intentional refrains and character habits may repeat. No semantic assessment.' };
    if (recent.length < 3) return result;
    const latest = recent.at(-1), current = shingles(latest.text);
    if (!current.size) return result;
    const matches = [];
    for (const turn of recent.slice(0, -1)) {
        const previous = shingles(turn.text);
        if (!previous.size) continue;
        let common = 0;
        for (const item of current) if (previous.has(item)) common++;
        const overlap = common / Math.max(current.size, previous.size);
        if (overlap >= 0.45) matches.push({ ref: turn.ref, overlap: Math.round(overlap * 1000) / 1000 });
    }
    if (!matches.length) return result;
    result.status = matches.length >= 2 ? 'CONFIRMED_SIGNAL' : 'CANDIDATE';
    result.signals.push({ kind: 'lexical_repetition', source: 'local_shingles', status: result.status,
        evidence_refs: [...matches.map(m => m.ref), latest.ref], comparisons: matches,
        expires: 'recomputed on the next accepted response or branch change' });
    return result;
}

/** Stop at the first unaccepted turn; never assess an abandoned or disputed suffix. */
export function acceptedQualityTurns(chat, refs, manager) {
    const turns = [];
    for (const ref of refs) {
        if (!manager.findAccepted(ref.idempotencyKey)) break;
        const message = chat[ref.messageIndex];
        if (message && !message.is_user && !message.is_system) turns.push({ ref: ref.idempotencyKey, text: message.mes });
    }
    return turns;
}


export const REPETITION_HINT = 'Optional style observation: vary repeated wording when it adds no new meaning. Preserve intentional refrains, character habits and quiet scenes. Do not invent events or change anyone’s decisions merely to avoid repetition.';

/** Ephemeral, branch-bound advisory; durations count accepted responses, not wall time. */
export function advanceQualityNote(previous, observation, refs, sceneKey) {
    const turn = refs.length;
    const anchor = refs.at(-1);
    let note = previous;
    if (note && !refs.includes(note.anchor)) note = null;
    if (note && note.sceneKey !== sceneKey) {
        // Do not republish a signal assembled from the previous scene's prose.
        return anchor ? { ...note, sceneKey, anchor, lastSeen: anchor, createdTurn: turn, status: 'EXPIRED' } : null;
    }
    if (!anchor) return null;
    if (note?.lastSeen === anchor) return note;
    const repeated = observation?.status === 'CONFIRMED_SIGNAL';
    if (note) {
        note = { ...note, lastSeen: anchor };
        if (turn - note.createdTurn >= 2 || !repeated) note.status = 'EXPIRED';
        if (turn - note.createdTurn < 3) return note;
    }
    if (!repeated) return note;
    return { category: 'lexical_repetition', source: 'local_shingles', status: 'ACTIVE',
        anchor, lastSeen: anchor, sceneKey, createdTurn: turn, ttlTurns: 2, cooldownTurns: 3 };
}

export function qualityHintCategory(note, sceneKey) {
    return note?.status === 'ACTIVE' && note.sceneKey === sceneKey ? 'lexical_repetition' : null;
}

export function qualitySceneKey(state) {
    return JSON.stringify([state.scene?.location || null, [...(state.scene?.present || [])].map(v => typeof v === 'string' ? v : v?.id || v?.name || '').sort()]);
}
