import { clone } from '../utils/object.js';

export async function branchReferences(context, through = Infinity, canonVersion = 0) {
    let parent = String(canonVersion);
    const refs = [];
    for (const [index, message] of (context.chat || []).entries()) {
        if (index > through) break;
        const body = JSON.stringify([parent, message.is_user === true, message.is_system === true,
            message.name || '', message.original_avatar || '', message.send_date || index,
            message.swipe_id ?? 0, message.mes || '']);
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
        parent = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
        if (!message.is_user && !message.is_system) refs.push({
            idempotencyKey: parent, messageIndex: index,
            messageId: String(message.send_date || `index:${index}`), swipeId: message.swipe_id ?? 0,
        });
    }
    return refs;
}

export function latestStatus(decisions, deltaId) {
    return decisions.findLast(d => d.deltaId === deltaId)?.status;
}

export function decision(deltaId, status, reason = '') {
    return { decisionId: crypto.randomUUID(), deltaId, status, reason, at: new Date().toISOString() };
}

export function activeMemories(records) {
    const memories = records.flatMap(record => (record.memories || []).map((memory, index) => ({
        ...clone(memory), id: `${record.deltaId}:memory:${index}`, sourceDeltaId: record.deltaId,
        messageRef: clone(record.messageRef), status: memory.status || 'current', createdAt: record.at,
        memoryId: `${record.deltaId}:memory:${index}`, campaignId: memory.campaignId || record.campaignId || record.chatFingerprint, sessionId: memory.sessionId || record.sessionId,
    })));
    return projectMemoryStatuses(memories);
}

export function projectMemoryStatuses(input) {
    const memories = clone(input);
    const byId = new Map(), facts = new Map();
    for (const memory of memories) {
        if (memory.status !== 'current') { byId.set(memory.id, memory); continue; }
        const key = memory.factKey ? `${memory.campaignId}:${memory.factKey}` : null;
        const predecessors = [...(memory.supersedes || []).map(id => byId.get(id)), key ? facts.get(key) : null];
        for (const previous of predecessors.filter(Boolean)) {
            if (previous.campaignId === memory.campaignId) { previous.status = 'superseded'; previous.supersededBy = memory.id; }
        }
        byId.set(memory.id, memory); if (key) facts.set(key, memory);
    }
    return memories;
}
