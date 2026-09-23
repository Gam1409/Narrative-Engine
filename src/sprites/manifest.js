function normalize(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

export function validateSpriteManifest(entries) {
    if (!Array.isArray(entries)) return { valid: false, errors: ['Sprite manifest must be an array.'] };
    const errors = [];
    const normalized = [];
    entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return errors.push(`Entry ${index} must be an object.`);
        if (!entry.file || !entry.character) return errors.push(`Entry ${index} requires file and character.`);
        if (/[/\\]|\.\./.test(entry.file)) return errors.push(`Entry ${index} file must be a basename.`);
        normalized.push({
            file: String(entry.file), character: String(entry.character), expression: String(entry.expression || ''),
            intensity: String(entry.intensity || ''), pose: String(entry.pose || ''), gaze: String(entry.gaze || ''),
            costume: String(entry.costume || ''), framing: String(entry.framing || ''),
        });
    });
    return { valid: errors.length === 0, errors, entries: normalized };
}

export function filterSpriteCandidates(entries, query, limit = 20) {
    const character = normalize(query.character);
    const costume = normalize(query.costume);
    const expression = normalize(query.expression);
    const pose = normalize(query.pose);
    return entries
        .filter((entry) => normalize(entry.character) === character)
        .map((entry) => {
            let score = 1;
            if (costume && normalize(entry.costume) === costume) score += 8;
            else if (costume && entry.costume) score -= 4;
            if (expression && normalize(entry.expression).includes(expression)) score += 6;
            if (pose && normalize(entry.pose).includes(pose)) score += 3;
            return { ...entry, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
        .slice(0, Math.max(5, Math.min(30, limit)));
}
