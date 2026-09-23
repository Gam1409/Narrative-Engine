function section(title, value) {
    if (value === undefined || value === null) return '';
    const content = Array.isArray(value)
        ? value.map((item) => typeof item === 'string' ? `- ${item}` : `- ${JSON.stringify(item)}`).join('\n')
        : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return content ? `${title}\n${content}` : '';
}

function estimateTokens(text) {
    return Math.ceil(String(text).length / 4);
}

export function buildDirectorPacket(pre, tokenBudget = 1500) {
    const blocks = [
        section('SCENE', pre.scene),
        section('PRESENT', pre.present || pre.character_states),
        section('PHYSICAL CONTINUITY', pre.must_preserve),
        section('CHARACTER STATES', pre.character_states),
        section('RELEVANT MEMORY', pre.relevant_memories),
        section('ACTIVE THREADS', pre.active_threads),
        section('WORLD EVENTS', pre.due_world_events || pre.world_pressure),
        section('KNOWLEDGE CONSTRAINTS', pre.knowledge_constraints),
        section('DIRECTION', pre.direction || pre.scene_plan),
    ].filter(Boolean);
    const header = '[DIRECTOR CONTEXT]\n\n';
    const footer = '\n\nWrite only the roleplay response. Do not output service JSON or decide actions for the user.';
    let packet = header;
    for (const block of blocks) {
        const candidate = `${packet}${packet === header ? '' : '\n\n'}${block}`;
        if (estimateTokens(candidate + footer) > tokenBudget) break;
        packet = candidate;
    }
    return packet + footer;
}
