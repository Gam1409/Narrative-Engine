export const COMPOSITE_CAMERAS = Object.freeze({
    'full body, eye level': 0.95,
    'medium shot, eye level': 1.35,
    'wide shot, eye level': 0.72,
});
/** Pixel rectangles for preview; parity-tested against the server recipe. Preserve image aspect ratios. */
export function planCompositeLayout({width, height, characters, camera = 'full body, eye level'}) {
    if (![width,height].every(v => Number.isInteger(v) && v > 0 && v <= 8192) || width*height>16777216) throw Error('Invalid composite dimensions');
    if (!Object.hasOwn(COMPOSITE_CAMERAS,camera)) throw Error('Unsupported composite framing');
    if (!Array.isArray(characters) || characters.length > 2) throw Error('Composite preview supports up to two characters');
    const ids=new Set();
    const slots=characters.map((character,index)=>{
        if(typeof character.id!=='string' || !character.id || ids.has(character.id)) throw Error('Character identity must be unique');
        ids.add(character.id);
        if(![character.width,character.height].every(v=>Number.isInteger(v)&&v>0&&v<=8192)) throw Error('Invalid sprite dimensions');
        const center=characters.length===1?0.5:index===0?0.28:0.72;
        const targetHeight=Math.round(height*COMPOSITE_CAMERAS[camera]);
        const maxWidth=width*(characters.length===1?0.9:0.52);
        const scale=Math.min(targetHeight/character.height,maxWidth/character.width);
        const w=Math.max(1,Math.round(character.width*scale)),h=Math.max(1,Math.round(character.height*scale));
        // Medium framing crops the lower body; upper edge remains visible.
        const y=h>height?0:height-h;
        return {characterId:character.id,x:Math.round(width*center-w/2),y,width:w,height:h};
    });
    return {version:1,width,height,camera,slots};
}

export function compositeSources(scene, plans, composition) {
    if(!composition || scene.sceneId!==composition.sceneId || scene.canonVersion!==composition.canonVersion) throw Error('Current scene layers are not ready');
    if(scene.characters.length>2) throw Error('Composite preview supports up to two characters');
    const wanted=['background',...scene.characters.map(c=>'sprite:'+c.id)];
    return wanted.map(slot=>{
        const plan=plans.find(p=>p.slot===slot),layer=composition.layers?.find(l=>l.slot===slot);
        if(!plan || !layer || plan.layerKey!==layer.layerKey || layer.status!=='done' || !layer.assetId) throw Error(`Current layer is not ready: ${slot}`);
        return layer;
    });
}
