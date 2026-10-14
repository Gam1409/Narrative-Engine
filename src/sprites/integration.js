function quote(value) {
    return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export async function applySpriteDecisions(decisions, { context, currentSpeaker, previous = {}, allowedCandidates = {} } = {}) {
    if (!decisions || typeof decisions !== 'object' || typeof context?.executeSlashCommandsWithOptions !== 'function') return previous;
    const next = { ...previous };
    for (const [character, raw] of Object.entries(decisions)) {
        const decision = typeof raw === 'string' ? { action: raw === 'KEEP' ? 'KEEP' : 'SET', sprite: raw } : raw;
        if (!decision || decision.action === 'KEEP') continue;
        // The public slash API targets the current/last speaker in group/VN mode.
        if (currentSpeaker && character !== currentSpeaker) continue;
        const allowed = allowedCandidates[character];
        const isAllowed = Array.isArray(allowed) && allowed.some((entry) => {
            const file = String(entry.file || entry);
            if (decision.costume && entry.costume !== decision.costume) return false;
            return file === decision.sprite || file.replace(/\.[^.]+$/, '') === String(decision.sprite).replace(/\.[^.]+$/, '');
        });
        if (decision.sprite && isAllowed && (decision.costume || next[character] !== decision.sprite)) {
            if (decision.costume) {
                await context.executeSlashCommandsWithOptions(`/costume name=${quote(character)} ${quote(decision.costume)}`, { handleParserErrors: true });
            }
            await context.executeSlashCommandsWithOptions(`/expression-set type=sprite ${quote(decision.sprite)}`, { handleParserErrors: true });
            next[character] = decision.sprite;
        }
    }
    return next;
}
