'use strict';
const fail = () => { throw Object.assign(Error('Invalid lore gating: use location, characters, timeFrom/timeTo'),{status:400}); };
const time = value => typeof value==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
function normalizeGating(value) {
    if(value===undefined)return {};
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!['location','characters','timeFrom','timeTo'].includes(k)))fail();
    const gate={};
    for(const key of ['location','characters']) if(Object.hasOwn(value,key)) {
        const values=typeof value[key]==='string'?[value[key]]:value[key];
        if(!Array.isArray(values) || !values.length || values.length>50 || values.some(v=>typeof v!=='string' || !v.trim() || v.length>200))fail();
        gate[key]=[...new Set(values.map(v=>v.trim()))];
    }
    if(Object.hasOwn(value,'timeFrom') || Object.hasOwn(value,'timeTo')) {
        if(!time(value.timeFrom) || !time(value.timeTo) || value.timeFrom===value.timeTo)fail();
        gate.timeFrom=value.timeFrom;gate.timeTo=value.timeTo;
    }
    return gate;
}
function matchesGating(raw, context={}) {
    let gate;try{gate=normalizeGating(raw);}catch{return false;}
    if(!context || typeof context!=='object')context={};
    if(gate.location && !gate.location.includes(context.location))return false;
    if(gate.characters && (!Array.isArray(context.present) || !gate.characters.every(id=>context.present.includes(id))))return false;
    if(gate.timeFrom) {
        if(!time(context.time))return false;
        const inRange=gate.timeFrom<gate.timeTo ? context.time>=gate.timeFrom && context.time<gate.timeTo : context.time>=gate.timeFrom || context.time<gate.timeTo;
        if(!inRange)return false;
    }
    return true;
}
module.exports={normalizeGating,matchesGating};
