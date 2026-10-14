import { compositeSources } from './layout.js';
import { planLayers } from './layers.js';

export class MissingIllustrationLayers extends Error {}

export async function illustrationSource(scene, settings, composition) {
    const source = settings.visualIllustrationSource || 'fresh';
    if (source === 'fresh') return { source: 'fresh' };
    if (!['layers', 'layers_or_fresh'].includes(source)) throw Error('Unknown illustration source');
    try {
        if (scene.characters.length > 2) throw Error('Layer illustration supports up to two characters');
        const plans = await planLayers(scene, settings);
        const layers = compositeSources(scene, plans, composition);
        if (layers.some(layer => !/^[a-f0-9]{64}$/.test(layer.resourceKey || '')))
            throw Error('Layer metadata needs refreshing before illustration');
        return {
            source: 'layers',
            recipeVersion: 1, layoutVersion: 1,
            layerReferences: layers.map(layer => ({assetId: layer.assetId, resourceKey: layer.resourceKey})),
            layerCamera: settings.visualLayerCamera || 'full body, eye level',
            layerDenoise: settings.visualLayerDenoise ?? 0.45,
        };
    } catch (error) {
        if (source === 'layers_or_fresh') return {source: 'fresh', fallbackReason: error.message};
        if (scene.characters.length > 2) throw error;
        throw new MissingIllustrationLayers(error.message);
    }
}
