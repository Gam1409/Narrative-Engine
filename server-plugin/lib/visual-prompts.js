'use strict';

const PROFILES = Object.freeze({
    sdxl: { format: 'natural', quality: [], negative: ['watermark'], family: 'sdxl' },
    anima: { format: 'tags', family: 'anima', quality: [], negative: [] },
    illustrious: {
        format: 'tags',
        family: 'illustrious',
        quality: ['masterpiece', 'best quality'],
        negative: ['watermark'],
    },
    pony: {
        format: 'tags',
        family: 'pony',
        quality: ['score_9', 'score_8_up', 'score_7_up', 'score_6_up', 'score_5_up', 'score_4_up'],
        negative: [],
    },
});
const COMPILER_VERSION = 4;

function words(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(words).filter(Boolean).join(', ');
    if (value && typeof value === 'object') {
        return Object.entries(value)
            .map(([key, item]) => {
                const text = words(item);
                return text ? `${key}: ${text}` : '';
            })
            .filter(Boolean)
            .join(', ');
    }
    return '';
}
function unique(items) {
    const seen = new Set();
    return items.map(words).filter((text) => {
        const key = text.toLocaleLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function itemText(item) {
    return [item.name || item.id, words(item.properties)].filter(Boolean).join(', ');
}

function compilePrompts(scene, options = {}) {
    const profileId = options.profile || 'sdxl';
    let profile = PROFILES[profileId];
    if (profileId === 'anima') {
        const variant = options.animaVariant || 'base';
        if (!['base','aesthetic','turbo'].includes(variant)) throw Error('Unknown Anima variant');
        profile = {...profile, quality: variant === 'base' ? ['masterpiece','best quality','score_7'] : ['masterpiece','best quality'],
            negative: ['worst quality','low quality', ...(variant === 'base' ? ['score_1','score_2','score_3'] : []), 'blurry','jpeg artifacts','chromatic aberration']};
    }
    if (!profile) throw new Error('Unknown checkpoint prompt profile');
    const operation = options.operation || 'illustration';
    const positive = [...profile.quality];
    const negative = [...profile.negative, ...(options.negative || [])];
    const composition = options.composition || {};
    if (typeof composition !== 'object' || Array.isArray(composition)) throw new Error('Invalid composition');
    for (const key of ['style', 'camera']) {
        if (composition[key] !== undefined && (typeof composition[key] !== 'string' || composition[key].length > 300))
            throw new Error(`Invalid composition ${key}`);
    }
    if (composition.style) positive.push(composition.style);
    if (composition.camera) positive.push(composition.camera);
    const location = scene.location || {};
    if (operation !== 'sprite') positive.push(location.name || location.id, words(location.properties));
    else positive.push(composition.camera ? 'single character, isolated' : 'single character, full body, isolated');
    if (operation !== 'sprite' && location.lighting) positive.push(`${words(location.lighting)} lighting`);
    if (operation !== 'sprite' && location.weather) positive.push(`${words(location.weather)} weather`);
    if (operation === 'background') {
        positive.push('environment only, empty of people');
        negative.push('people', 'characters');
    } else {
        for (const character of scene.characters || []) {
            const outfit = character.profile?.outfits?.[character.outfit] || words(character.outfit);
            const parts = [character.name, character.profile?.appearance, words(character.appearance)];
            if (outfit) parts.push(`wearing ${outfit}`);
            parts.push(words(character.clothing));
            for (const item of character.wardrobe || []) parts.push(`wearing ${itemText(item)}`);
            for (const item of character.heldObjects || []) parts.push(`holding ${itemText(item)}`);
            if (Array.isArray(character.holding) && !character.holding.length && !character.heldObjects?.length)
                parts.push('empty hands, not holding any objects');
            parts.push(character.pose, character.emotion, words(character.expressed));
            for (const lora of character.profile?.lora || []) parts.push(lora.triggerWords || '');
            const position = character.position;
            if (operation !== 'sprite' && position?.rel && position?.target)
                parts.push(`${position.rel} ${position.target}`);
            positive.push(unique(parts).join(', '));
        }
    }
    if (operation !== 'sprite') positive.push(...(scene.keyObjects || []).map(itemText));
    const generatedPositive = unique(positive).join(profile.format === 'tags' ? ', ' : '. ');
    const generatedNegative = unique(negative).join(', ');
    for (const key of ['userPositive','userNegative']) {
        if (options[key] !== undefined && (typeof options[key] !== 'string' || options[key].length > 2000)) throw Error('User prompt must be text up to 2000 characters');
    }
    if (options.userPositive) positive.push(options.userPositive.trim());
    if (options.userNegative) negative.push(options.userNegative.trim());
    const positives = unique(positive);
    const positiveTokens = new Set(
        positives.flatMap((text) => text.split(/[,;.]/)).map((text) => text.trim().toLowerCase()),
    );
    const negatives = unique(negative)
        .flatMap((text) => text.split(','))
        .map((text) => text.trim())
        .filter(Boolean);
    const conflicts = negatives.filter((text) => positiveTokens.has(text.toLowerCase()));
    if (conflicts.length) throw new Error(`Conflicting positive/negative terms: ${conflicts.join(', ')}`);
    const prompt = positives.join(profile.format === 'tags' ? ', ' : '. ');
    const negativePrompt = unique(negatives).join(', ');
    // Never silently truncate canonical clothing or identity.
    if (prompt.length > 12000 || negativePrompt.length > 2000)
        throw new Error('Visual prompt exceeds configured text budget');
    return {
        positive: prompt,
        generatedPositive, generatedNegative,
        userPositive: options.userPositive || '', userNegative: options.userNegative || '',
        negative: negativePrompt,
        profile: profileId,
        compilerVersion: COMPILER_VERSION,
        format: profile.format,
        operation,
    };
}

module.exports = { compilePrompts, PROFILES, COMPILER_VERSION };
