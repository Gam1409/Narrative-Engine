import { planLayers } from '../visual/layers.js';
import { getContext } from '../context/stContext.js';
const validUrl = (url) =>
    /^\/api\/plugins\/narrative-engine\/visual\/asset\/[A-Za-z0-9%_.-]+\/[A-Za-z0-9-]+$/.test(url || '');

/** Extension-owned VN stage; does not overwrite SillyTavern expression files. */
export function showVisualStage(runtime) {
    document.getElementById('ne-visual-stage-dialog')?.close();
    const dialog = document.createElement('dialog');
    dialog.id = 'ne-visual-stage-dialog';
    dialog.className = 'ne-visual-stage-dialog';
    const title = document.createElement('h3');
    title.textContent = 'Visual novel scene';
    const stage = document.createElement('div');
    stage.className = 'ne-visual-stage';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'menu_button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    dialog.append(title, stage, status, close);
    document.body.append(dialog);
    let revision = 0,
        rendered = '';
    const render = async () => {
        const currentRevision = ++revision;
        const scene = await runtime.visualDirector.scene();
        const plans = await planLayers(scene, runtime.settings);
        if (currentRevision !== revision || !dialog.isConnected) return;
        const composition = getContext().chatMetadata?.narrative_engine_layers;
        if (
            runtime.visualDirector.closed ||
            !runtime.settings.visualEnabled ||
            !composition ||
            plans.length !== composition.layers?.length ||
            plans.some((plan, index) => plan.layerKey !== composition.layers[index]?.layerKey) ||
            scene.sceneId !== composition.sceneId ||
            scene.canonVersion !== composition.canonVersion ||
            runtime.stateManager.pending.length
        ) {
            stage.replaceChildren();
            rendered = '';
            status.textContent = 'Current scene layers are not ready.';
            return;
        }
        const signature = JSON.stringify(composition);
        if (signature === rendered) return;
        rendered = signature;
        stage.replaceChildren();
        const layers = composition.layers || [];
        const sprites = layers.filter((layer) => layer.operation === 'sprite');
        for (const layer of layers) {
            if (layer.status !== 'done' || !validUrl(layer.url)) continue;
            const image = document.createElement('img');
            image.src = layer.url;
            image.alt = String(layer.label || layer.operation);
            image.className = layer.operation === 'background' ? 'ne-stage-background' : 'ne-stage-sprite';
            if (layer.operation === 'sprite') {
                image.style.left = `${(100 * (sprites.indexOf(layer) + 1)) / (sprites.length + 1)}%`;
                image.style.maxWidth = `${Math.min(60, 100 / Math.max(1, sprites.length))}%`;
            }
            image.addEventListener('error', () => {
                image.remove();
                status.textContent = 'A scene image could not be loaded.';
            });
            stage.append(image);
        }
        const incomplete = layers.filter((layer) => layer.status !== 'done');
        const anchorWarnings = layers.filter(layer => layer.anchorWarning).map(layer => `${layer.label || layer.slot}: ${layer.anchorWarning}`);
        status.textContent = incomplete.length
            ? incomplete.map((layer) => `${layer.label || layer.slot}: ${layer.error || layer.status}`).join('; ')
            : `Scene layers ready${Number.isFinite(composition.timing?.readyMs) ? ` (${(composition.timing.readyMs / 1000).toFixed(1)} s)` : ''}`;
        if (anchorWarnings.length) status.textContent += `  -  Face anchor: ${anchorWarnings.join('; ')}`;
    };
    const update = () =>
        render().catch((error) => {
            status.textContent = error.message;
        });
    globalThis.addEventListener('narrative-engine-layers', update);
    // Re-check canon on edits/swipes even when no new generation is requested.
    const timer = setInterval(update, 2000);
    dialog.addEventListener(
        'close',
        () => {
            revision++;
            clearInterval(timer);
            globalThis.removeEventListener('narrative-engine-layers', update);
            dialog.remove();
        },
        { once: true },
    );
    dialog.showModal();
    update();
    return 'Visual novel scene opened.';
}
