import {canonicalStringify} from '../utils/object.js';
import {textHash} from '../memory/semantic.js';

export const DAY_BOUNDARIES = Object.freeze({dawn:5, day:8, dusk:18, night:21});
const hash = value => textHash(canonicalStringify(value));
const known = value => value && value !== 'unknown';
export function atmosphere(scene, boundaries = DAY_BOUNDARIES) {
    const text = String(scene.location?.lighting || '').toLowerCase();
    const place = String(scene.location?.properties?.description || '').toLowerCase();
    const indoor = /lamp|candle|ламп|свеч/.test(text) || /indoor|interior|помещени|интерьер/.test(place);
    let time = 'unknown';
    const match = /^(\d{2}):(\d{2})$/.exec(scene.visualTime || '');
    if (indoor) time = 'indoor';
    else if (match && +match[1]<24 && +match[2]<60) {
        const hour=+match[1];
        time=hour<boundaries.dawn || hour>=boundaries.night ? 'night' : hour<boundaries.day ? 'dawn' : hour<boundaries.dusk ? 'day' : 'dusk';
    } else {
        for (const [key,pattern] of [['night',/night|ноч/],['dawn',/dawn|sunrise|рассвет/],['dusk',/dusk|sunset|закат|сумерк/],['day',/daylight|daytime|днев|день/]]) if(pattern.test(text)){time=key;break;}
    }
    const weatherText=String(scene.location?.weather || '').toLowerCase();
    let weather='unknown';
    for(const [key,pattern] of [['storm',/storm|thunder|гроз|шторм/],['snow',/snow|снег|снеж/],['rain',/rain|дожд/],['fog',/fog|mist|туман/],['cloud',/cloud|overcast|облач|пасмур/],['clear',/clear|sunny|ясн|солнеч/]])if(pattern.test(weatherText)){weather=key;break;}
    return {time,weather};
}
export function backgroundIdentity(scene) {
    const {lighting,weather,...location}=scene.location || {};
    return {location,fixtures:scene.backgroundFixtures || []};
}
export async function backgroundConfiguration(settings) {
    const workflow=settings.visualBackgroundWorkflow || 'background';
    return hash({workflow,recipe:settings.visualUserWorkflows?.find(row=>row.id===workflow)?.recipe || null,
        checkpoint:settings.visualCheckpoint || '',profile:settings.visualPromptProfile || 'sdxl',
        anima:settings.visualPromptProfile==='anima'?settings.visualAnimaVariant || 'base':null,
        encoder:settings.visualTextEncoder || '',vae:settings.visualVae || '',style:settings.visualStyle || '',
        positive:settings.visualPositive || '',negative:settings.visualNegative || ''});
}
/** Persist only public resource inputs and accepted-turn identifiers. No LLM calls. */
export async function prepareBackground(scene,settings,previous={}, {turns=[],force=false}={}) {
    const ledger=structuredClone(previous?.version===1?previous:{version:1,entries:{}});
    const policy=['location','location_atmosphere','any'].includes(settings.visualBackgroundPolicy)?settings.visualBackgroundPolicy:'location';
    const identity=backgroundIdentity(scene);
    const identityKey=await hash(identity),config=await backgroundConfiguration(settings);
    const key=await hash({identityKey,config,policy});
    const entry=ledger.entries[key] || {variants:{},history:[]};
    const turn=turns.at(-1) || 'initial';
    const ancestry=new Set(['initial',...turns]);
    // Rollback/swipe restores the last compatible observation; polling cannot advance hysteresis.
    entry.history=entry.history.filter(record=>ancestry.has(record.turn));
    let state=structuredClone(entry.history.at(-1)?.state || {atmosphere:atmosphere(scene),pending:{},revision:0});
    const observed=atmosphere(scene);
    const threshold=Math.max(1,Math.min(10,Math.floor(Number(settings.visualBackgroundHysteresis)||2)));
    let reason='kept (same location)', switched=false;
    const changes=[];
    if(policy==='location_atmosphere' && entry.history.at(-1)?.turn!==turn) {
        for(const field of ['time','weather']) {
            const value=observed[field],old=state.atmosphere[field];
            if(!known(value)){state.pending[field]=null;reason='kept (atmosphere unknown)';continue;}
            if(!known(old)){state.atmosphere[field]=value;state.pending[field]=null;continue;}
            if(value===old){state.pending[field]=null;continue;}
            const count=state.pending[field]?.value===value?state.pending[field].count+1:1;
            if(count>=threshold){state.atmosphere[field]=value;state.pending[field]=null;switched=true;changes.push(`${field} ${old} to ${value}`);}
            else {state.pending[field]={value,count};reason=`kept (hysteresis ${count}/${threshold})`;}
        }
    }
    if(switched) reason=`requested (atmosphere ${changes.join(', ')}, stable ${threshold} turns)`;
    let variant=policy==='location'?'location':policy==='any'?await hash({lighting:scene.location?.lighting,weather:scene.location?.weather}):await hash(state.atmosphere);
    // Learning an unknown bucket labels the existing image; it never creates GPU work.
    if(policy==='location_atmosphere' && state.variant && variant!==state.variant && entry.variants[state.variant] && !switched) entry.variants[variant]=entry.variants[state.variant];
    state.variant=variant;
    if(force){state.revision++;reason='requested (manual)';}
    let resource=entry.variants[variant];
    if(!resource || force) {
        const location=structuredClone(scene.location || {});
        if(policy==='location_atmosphere') {
            location.lighting=known(state.atmosphere.time)?state.atmosphere.time:location.lighting;
            location.weather=known(state.atmosphere.weather)?state.atmosphere.weather:location.weather;
        }
        const input={location,keyObjects:structuredClone(scene.backgroundFixtures || []),characters:[],preserve:['location.layout']};
        const id=await hash({identityKey,policy,variant,revision:state.revision,nonce:force?crypto.randomUUID():null});
        resource={id,scene:{...input,sceneId:id},seed:parseInt(id.slice(0,8),16),revision:state.revision};
        entry.variants[variant]=resource;
        if(reason==='kept (same location)') reason='requested (new location or configuration)';
    }
    const record={turn,state};
    if(entry.history.at(-1)?.turn===turn)entry.history[entry.history.length-1]=record;else entry.history.push(record);
    entry.history=entry.history.slice(-64);
    delete ledger.entries[key];ledger.entries[key]=entry;
    for(const old of Object.keys(ledger.entries).slice(0,-128))delete ledger.entries[old];
    const variants=Object.keys(entry.variants);for(const old of variants.slice(0,-64))if(old!==variant)delete entry.variants[old];
    return {ledger,background:{...structuredClone(resource),identity:identityKey,policy,config,reason,manual:resource.revision>0}};
}
