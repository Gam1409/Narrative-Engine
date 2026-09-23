function hashString(input) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getContext() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) throw new Error('Narrative Engine requires the SillyTavern context API.');
    return context;
}

export function getEventTypes(context = getContext()) {
    return context.eventTypes || context.event_types || {};
}

export function getChatFingerprint(context = getContext()) {
    const group = context.groupId ? context.groups?.find((item) => String(item.id) === String(context.groupId)) : null;
    const identity = group
        ? `group:${group.id}:${group.chat_id || context.chatId || ''}`
        : `character:${context.characters?.[context.characterId]?.avatar || context.characterId || 'none'}:${context.chatId || ''}`;
    return `ne-${hashString(identity)}`;
}

export function resolveParticipants(context = getContext()) {
    if (context.groupId) {
        const group = context.groups?.find((item) => String(item.id) === String(context.groupId));
        const members = Array.isArray(group?.members) ? group.members : [];
        return members.map((avatar) => context.characters?.find((character) => character.avatar === avatar))
            .filter(Boolean)
            .map(toParticipant);
    }
    const character = context.characters?.[context.characterId];
    return character ? [toParticipant(character)] : [];
}

function toParticipant(character) {
    return {
        id: String(character.avatar || character.name),
        name: String(character.name || character.avatar),
        avatar: String(character.avatar || ''),
        narrativeEngine: character.data?.extensions?.narrative_engine || null,
    };
}

export function resolveMessageSpeaker(message, context = getContext()) {
    if (!message || message.is_user) return { id: 'USER', name: context.name1 || 'User' };
    const avatar = message.original_avatar || message.force_avatar || '';
    const character = context.characters?.find((item) => (avatar && item.avatar === avatar) || item.name === message.name);
    return character ? toParticipant(character) : { id: String(avatar || message.name || 'UNKNOWN'), name: String(message.name || 'Unknown') };
}

export function messageId(message, index) {
    return String(message?.extra?.narrative_engine?.messageId || message?.send_date || `index:${index}`);
}

export function createRequestIdentity(context, generationId = null) {
    const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return {
        chatFingerprint: getChatFingerprint(context),
        sessionId: String(context.chatId || context.getCurrentChatId?.() || 'no-chat'),
        generationId: generationId || randomId,
        requestId: randomId,
    };
}

export function recentChat(context, limit) {
    return (context.chat || []).slice(-limit).map((message, offset, items) => ({
        id: messageId(message, (context.chat?.length || 0) - items.length + offset),
        role: message.is_user ? 'user' : message.is_system ? 'system' : 'assistant',
        name: String(message.name || ''),
        content: String(message.mes || ''),
        speaker: resolveMessageSpeaker(message, context),
    }));
}
