import { selectedRecipe } from './workflows.js';
import { canonicalStringify } from '../utils/object.js';
import { textHash } from '../memory/semantic.js';

/** Resource scenes contain exactly the inputs used by their own compiler. */
export async function planLayers(scene, settings) {
    const common = {
        endpoint: settings.visualEndpoint || '',
        userPositive: settings.visualPositive || '', userNegative: settings.visualNegative || '',
        checkpoint: settings.visualCheckpoint || '',
        promptProfile: settings.visualPromptProfile || 'sdxl',
        animaVariant: settings.visualAnimaVariant || 'base',
        stages: {},
        modelFiles: {textEncoder: settings.visualTextEncoder || '', vae: settings.visualVae || ''},
    };
    const layers = [
        {
            slot: 'background',
            operation: 'background',
            workflow: settings.visualBackgroundWorkflow || 'background',
            resourceInput: scene.backgroundId,
            scene: {
                sceneId: scene.backgroundId,
                location: scene.location,
                keyObjects: scene.keyObjects,
                characters: [],
                preserve: ['location.layout'],
            },
        },
    ];
    if (settings.visualSpriteWorkflow) {
        if (scene.characters.length > 8) throw new Error('Layered scenes support up to eight characters');
        for (const character of scene.characters) {
            const { position, ...sprite } = character;
            layers.push({
                slot: `sprite:${character.id}`,
                operation: 'sprite',
                characterId: character.id,
                workflow: settings.visualSpriteWorkflow,
                resourceInput: scene.spriteIds[character.id],
                scene: {
                    sceneId: scene.spriteIds[character.id],
                    location: {},
                    keyObjects: [],
                    characters: [sprite],
                    preserve: [],
                },
            });
        }
    }
    return Promise.all(
        layers.map(async (layer) => {
            const customRecipe = selectedRecipe(settings, layer.workflow);
            const composition = {style: settings.visualStyle || '', camera: layer.operation === 'background' ? '' : settings.visualCamera || ''};
            const key = await textHash(
                canonicalStringify({
                    resource: layer.resourceInput,
                    workflow: layer.workflow,
                    customRecipe,
                    operation: layer.operation,
                    checkpoint: common.checkpoint,
                    profile: common.promptProfile,
                    animaVariant: common.promptProfile === 'anima' ? common.animaVariant : null,
                    composition,
                    modelFiles: common.modelFiles,
                    localExpressions: layer.operation === 'sprite' && settings.visualLocalExpressions === true,
                    faceDetector: layer.operation === 'sprite' ? settings.visualFaceDetector || '' : '',
                    userPositive: common.userPositive, userNegative: common.userNegative,
                    version: 5,
                }),
            );
            // Pose/emotion changes invalidate the resource, but keep the character's sampling seed stable.
            const seedKey = await textHash(canonicalStringify({identity: layer.characterId || layer.resourceInput, checkpoint: common.checkpoint, profile: common.promptProfile}));
            return { ...common, ...layer, customRecipe, composition, localExpressions: layer.operation === 'sprite' && settings.visualLocalExpressions === true, faceDetector: layer.operation === 'sprite' ? settings.visualFaceDetector || '' : '', seed: parseInt(seedKey.slice(0, 8), 16), layerKey: key };
        }),
    );
}

export function assetUrl(chatId, assetId) {
    return `/api/plugins/narrative-engine/visual/asset/${encodeURIComponent(chatId)}/${encodeURIComponent(assetId)}`;
}

export function composeLayers(scene, plans, jobs, chatId) {
    return {
        sceneId: scene.sceneId,
        canonVersion: scene.canonVersion,
        location: scene.location,
        createdAt: Date.now(),
        layers: plans.map((plan, index) => {
            const job = jobs[index];
            return {
                slot: plan.slot,
                operation: plan.operation,
                characterId: plan.characterId || null,
                label:
                    plan.operation === 'background'
                        ? scene.location.name || scene.location.id
                        : scene.characters.find((c) => c.id === plan.characterId)?.name,
                layerKey: plan.layerKey,
                status: job?.status || 'requested',
                error: job?.error || null,
                anchorWarning: job?.anchorWarning || null,
                timing: job?.timing || null,
                assetId: job?.status === 'done' ? job.asset?.id || null : null,
                url: job?.status === 'done' && job.asset?.id ? assetUrl(chatId, job.asset.id) : null,
            };
        }),
    };
}
