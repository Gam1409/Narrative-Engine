import { backgroundIdentity } from './background.js';
import { clone, canonicalStringify } from '../utils/object.js';
import { assertSafeData } from '../state/entities.js';
import { sceneViewers } from '../memory/policy.js';
import { textHash } from '../memory/semantic.js';

export function visualProfile(value) {
    assertSafeData(value);
    const keys = [
        'entityId',
        'appearance',
        'references',
        'lora',
        'outfits',
        'emotionSet',
        'poseSet',
        'genParams',
        'compatibleWorkflows',
    ];
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((k) => !keys.includes(k)) ||
        typeof value.entityId !== 'string' ||
        !value.entityId.trim() ||
        ['__proto__', 'prototype', 'constructor'].includes(value.entityId)
    )
        throw new Error('Invalid visual profile');
    const p = {
        appearance: '',
        references: [],
        lora: [],
        outfits: {},
        emotionSet: [],
        poseSet: [],
        genParams: {},
        compatibleWorkflows: [],
        ...clone(value),
    };
    if (typeof p.appearance !== 'string' || p.appearance.length > 4000 || JSON.stringify(p).length > 20000)
        throw new Error('Visual profile too large');
    for (const key of ['references', 'emotionSet', 'poseSet', 'compatibleWorkflows'])
        if (!Array.isArray(p[key]) || p[key].length > 32 || p[key].some((v) => typeof v !== 'string' || v.length > 500))
            throw new Error(`Invalid ${key}`);
    if (p.references.some((v) => !v || /(^[\/]|\.\.|:|\\)/.test(v)))
        throw new Error('References must be ComfyUI input asset names, not URLs or paths');
    if (
        !Array.isArray(p.lora) ||
        p.lora.length > 8 ||
        p.lora.some((v) => !v || typeof v.name !== 'string' || !Number.isFinite(v.weight) || Math.abs(v.weight) > 2)
    )
        throw new Error('Invalid LoRA profile');
    for (const lora of p.lora) {
        if (!lora.name.trim() || /(^[\\/]|\.\.|:)/.test(lora.name)) throw new Error('Invalid LoRA filename');
        if (lora.family !== undefined && !['sdxl', 'pony', 'illustrious', 'anima'].includes(lora.family))
            throw new Error('Invalid LoRA family');
        if (lora.clipWeight !== undefined && (!Number.isFinite(lora.clipWeight) || Math.abs(lora.clipWeight) > 2))
            throw new Error('Invalid LoRA CLIP weight');
        if (
            lora.triggerWords !== undefined &&
            (typeof lora.triggerWords !== 'string' || lora.triggerWords.length > 1000)
        )
            throw new Error('Invalid LoRA trigger words');
    }
    for (const key of ['outfits', 'genParams'])
        if (!p[key] || typeof p[key] !== 'object' || Array.isArray(p[key])) throw new Error(`Invalid ${key}`);
    if (Object.values(p.outfits).some((v) => typeof v !== 'string'))
        throw new Error('Outfit descriptions must be text');
    return p;
}
// Only explicitly visual fields may leave the canonical state for image generation.
// Custom parameter names can be mapped through their registered aliases.
const VISUAL_FIELDS = new Set([
    'appearance',
    'description',
    'color',
    'material',
    'pattern',
    'details',
    'condition',
    'damage',
    'cleanliness',
    'wetness',
    'style',
    'hairstyle',
    'hair',
    'accessories',
]);

export function visibleProperties(state, entity) {
    const properties = {};
    for (const [key, value] of Object.entries(entity?.params || {})) {
        const definition = state.registry?.parameters?.[key];
        const visualKey = [key, ...(definition?.aliases || [])].find((name) => VISUAL_FIELDS.has(name));
        if (visualKey && value !== undefined && value !== null) properties[visualKey] = clone(value);
    }
    return properties;
}

export function visualItem(state, entity) {
    return {
        id: entity.id,
        name: entity.name,
        position: clone(entity.position),
        properties: visibleProperties(state, entity),
    };
}

export function visualCharacter(state, id) {
    const entity = state.entities?.[id];
    const character = state.characters?.[id] || state.characters?.[entity?.name] || {};
    const params = entity?.params || {};
    const items = Object.values(state.entities || {})
        .filter((item) => item.status === 'active' && item.position?.target === id)
        .sort((a, b) => a.id.localeCompare(b.id));
    const wearing = items.filter((item) => item.position.rel === 'wears');
    const holding = items.filter((item) => item.position.rel === 'holds');
    const outfit = params.outfit ?? character.costume ?? character.clothing?.costume ?? character.clothing ?? '';
    const wardrobe = wearing.map((item) => visualItem(state, item));
    const clothing =
        typeof character.clothing === 'object' && character.clothing !== null
            ? Object.fromEntries(Object.entries(character.clothing).filter(([key]) => VISUAL_FIELDS.has(key)))
            : {};
    return {
        id,
        name: entity?.name || id,
        outfit: clone(outfit),
        pose: params.pose ?? character.pose ?? character.posture ?? '',
        emotion: params.expression ?? character.expression ?? '',
        // Hidden feelings never determine an observable expression automatically.
        expressed: clone(state.simulation?.characters?.[id]?.expressedVsFelt?.expressed || []),
        appearance: visibleProperties(state, entity),
        position: clone(entity?.position ?? character.position ?? character.location ?? null),
        holding: holding.map((item) => item.id),
        wearing: wearing.map((item) => item.id),
        wardrobe,
        heldObjects: holding.map((item) => visualItem(state, item)),
        clothing,
        // Empty preserves old manifests when only a legacy costume name is known.
        wardrobeSignature:
            wardrobe.length || Object.keys(clothing).length ? canonicalStringify({ outfit, wardrobe, clothing }) : '',
    };
}

export async function describeScene(state, participants, profiles = {}, previous = null, messageRef = null) {
    const ids = sceneViewers(state, participants, false).sort();
    const characters = ids.map((id) => ({
        ...visualCharacter(state, id),
        profile: profiles[id] ? visualProfile(profiles[id]) : null,
    }));
    const locationId = state.scene?.location || '';
    const entity = state.entities?.[locationId];
    const location = {
        id: locationId,
        name: entity?.name || locationId,
        properties: visibleProperties(state, entity),
        lighting: state.scene?.lighting || '',
        weather: state.scene?.weather || '',
    };
    const keyObjects = Object.values(state.entities || {})
        .filter(
            (item) =>
                item.status === 'active' &&
                item.type !== 'character' &&
                item.position?.target === location.id &&
                ['on', 'in'].includes(item.position.rel),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((item) => visualItem(state, item));
    const content = { location, characters, keyObjects };
    const sceneId = await textHash(canonicalStringify(content));
    // These are resource inputs, independent of narrative turn counters and private state.
    const backgroundFixtures = keyObjects.filter(item => state.entities?.[item.id]?.params?.backgroundRole === 'fixture');
    const backgroundId = await textHash(canonicalStringify(backgroundIdentity({location,backgroundFixtures})));
    const spriteIds = Object.fromEntries(
        await Promise.all(
            characters.map(async (character) => {
                const { position, ...sprite } = character;
                return [character.id, await textHash(canonicalStringify(sprite))];
            }),
        ),
    );
    const changesSincePrevious = Object.keys(content).filter(
        (key) => canonicalStringify(content[key]) !== canonicalStringify(previous?.[key]),
    );
    const preserve = characters.map((character) => `${character.id}.appearance`).concat(['location.layout']);
    return {
        ...content,
        sceneId,
        backgroundId,
        backgroundFixtures,
        visualTime: state.timeline?.time || '',
        spriteIds,
        messageRef: clone(messageRef),
        changesSincePrevious,
        preserve,
    };
}
