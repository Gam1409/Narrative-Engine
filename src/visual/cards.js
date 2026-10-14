import { canonicalStringify, clone } from '../utils/object.js';
import { visualProfile } from './scene.js';

/** Only participating cards may supply visual identity to this chat. */
export function cardProfiles(context, state, fallback = {}) {
    const profiles = clone(fallback);
    const seen = new Set(),
        entities = new Set();
    const group = context.groups?.find((group) => String(group.id) === String(context.groupId));
    const avatars = new Set(
        context.groupId ? group?.members || [] : [context.characters?.[context.characterId]?.avatar],
    );
    for (const card of context.characters || []) {
        if (!avatars.has(card.avatar)) continue;
        const visual = card.data?.extensions?.narrative_engine?.visual;
        if (!visual) continue;
        if (visual.version !== 1 || typeof visual.cardId !== 'string' || !visual.cardId)
            throw new Error('Unsupported character visual metadata');
        if (seen.has(visual.cardId))
            throw new Error('Duplicate visual card ID; assign a new identity to the copied card');
        seen.add(visual.cardId);
        const value = visual.profile;
        if (!value) continue;
        const profile = visualProfile(value);
        if (state.entities?.[profile.entityId]?.type === 'character' || state.characters?.[profile.entityId]) {
            if (entities.has(profile.entityId))
                throw new Error('Multiple character cards target the same world entity');
            entities.add(profile.entityId);
            profiles[profile.entityId] = profile;
        }
    }
    return profiles;
}

export async function saveCardVisual(context, index, value, fetchImpl = globalThis.fetch) {
    const card = context.characters?.[index];
    if (!card || typeof context.writeExtensionField !== 'function')
        throw new Error('Character card editing is unavailable');
    const profile = visualProfile(value);
    const old = clone(card.data?.extensions?.narrative_engine || {});
    const duplicate = context.characters.some(
        (other) =>
            other !== card &&
            old.visual?.cardId &&
            other.data?.extensions?.narrative_engine?.visual?.cardId === old.visual.cardId,
    );
    const visual = { version: 1, cardId: (!duplicate && old.visual?.cardId) || crypto.randomUUID(), profile };
    const next = { ...old, visual };
    const oldJson = card.json_data;
    try {
        await context.writeExtensionField(index, 'narrative_engine', next);
        // ST may log a failed write without rejecting. Read the saved card before declaring success.
        const response = await fetchImpl('/api/characters/get', {
            method: 'POST',
            headers: { ...context.getRequestHeaders?.(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatar_url: card.avatar }),
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('Could not verify character card save');
        const saved = await response.json();
        if (canonicalStringify(saved.data?.extensions?.narrative_engine?.visual) !== canonicalStringify(visual)) {
            // Discard the optimistic update made by ST when persistence could not be confirmed.
            throw new Error('Character visual profile was not saved; retry after checking the connection');
        }
        return visual;
    } catch (error) {
        card.data ||= {};
        card.data.extensions ||= {};
        card.data.extensions.narrative_engine = old;
        if (oldJson !== undefined) card.json_data = oldJson;
        const editor = globalThis.document?.querySelector('#character_json_data');
        if (editor && Number(context.characterId) === Number(index) && oldJson !== undefined) editor.value = oldJson;
        throw error;
    }
}
