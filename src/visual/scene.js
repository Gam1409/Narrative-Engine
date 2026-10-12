import { clone, canonicalStringify } from '../utils/object.js';
import { assertSafeData } from '../state/entities.js';
import { sceneViewers } from '../memory/policy.js';
import { textHash } from '../memory/semantic.js';

export function visualProfile(value) {
    assertSafeData(value);
    const keys=['entityId','appearance','references','lora','outfits','emotionSet','poseSet','genParams','compatibleWorkflows'];
    if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)) || typeof value.entityId!=='string' || !value.entityId.trim() || ['__proto__','prototype','constructor'].includes(value.entityId)) throw new Error('Invalid visual profile');
    const p={appearance:'',references:[],lora:[],outfits:{},emotionSet:[],poseSet:[],genParams:{},compatibleWorkflows:[],...clone(value)};
    if (typeof p.appearance!=='string' || p.appearance.length>4000 || JSON.stringify(p).length>20000) throw new Error('Visual profile too large');
    for (const key of ['references','emotionSet','poseSet','compatibleWorkflows']) if(!Array.isArray(p[key]) || p[key].length>32 || p[key].some(v=>typeof v!=='string'||v.length>500)) throw new Error(`Invalid ${key}`);
    if (p.references.some(v=>!v || /(^[\/]|\.\.|:|\\)/.test(v))) throw new Error('References must be ComfyUI input asset names, not URLs or paths');
    if (!Array.isArray(p.lora)||p.lora.length>8||p.lora.some(v=>!v || typeof v.name!=='string'||!Number.isFinite(v.weight)||Math.abs(v.weight)>2)) throw new Error('Invalid LoRA profile');
    for(const key of ['outfits','genParams']) if(!p[key]||typeof p[key]!=='object'||Array.isArray(p[key]))throw new Error(`Invalid ${key}`);
    if(Object.values(p.outfits).some(v=>typeof v!=='string'))throw new Error('Outfit descriptions must be text');
    return p;
}
export function visualCharacter(state,id) {
    const e=state.entities?.[id];
    const c=state.characters?.[id] || state.characters?.[e?.name] || {};
    const params=e?.params || {};
    const items=Object.values(state.entities || {}).filter(item=>item.status==='active' && item.position?.target===id);
    return {id,name:e?.name || id,outfit:params.outfit || c.costume || c.clothing?.costume || c.clothing || '',
        pose:params.pose || c.pose || c.posture || '',emotion:params.expression || c.expression || '',
        // Hidden feelings never determine an observable expression automatically.
        expressed:clone(state.simulation?.characters?.[id]?.expressedVsFelt?.expressed || []),
        position:clone(e?.position || c.position || c.location || null),
        holding:items.filter(i=>i.position.rel==='holds').map(i=>i.id),
        wearing:items.filter(i=>i.position.rel==='wears').map(i=>i.id)};
}
export async function describeScene(state,participants,profiles={},previous=null,messageRef=null) {
    const ids=sceneViewers(state,participants,false);
    const characters=ids.map(id=>({...visualCharacter(state,id),profile:profiles[id] ? visualProfile(profiles[id]) : null}));
    const location={id:state.scene?.location || '',lighting:state.scene?.lighting || '',weather:state.scene?.weather || ''};
    const keyObjects=Object.values(state.entities || {}).filter(e=>e.status==='active' && e.position?.target===location.id && ['on','in'].includes(e.position.rel)).map(e=>({id:e.id,name:e.name,position:clone(e.position)}));
    const content={location,characters,keyObjects};
    const sceneId=await textHash(canonicalStringify(content));
    const changesSincePrevious=Object.keys(content).filter(k=>canonicalStringify(content[k])!==canonicalStringify(previous?.[k]));
    const preserve=characters.map(c=>`${c.id}.appearance`).concat(['location.layout']);
    return {...content,sceneId,messageRef:clone(messageRef),changesSincePrevious,preserve};
}
