'use strict';
const { mapLore } = require('./lore-mapping');
const crypto = require('node:crypto');
const fail = message => { throw Object.assign(new Error(message), {status:400}); };
const list = value => Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',').map(v=>v.trim()).filter(Boolean) : [];

function scalar(text) {
    const trimmed=text.trim();
    const value=/^["']/.test(trimmed) ? trimmed : trimmed.replace(/\s+#.*$/, '').trim();
    if (!value) return [];
    if (value.startsWith('[')) {
        if (!value.endsWith(']')) fail('Unclosed Markdown list');
        return value.slice(1,-1).split(',').filter(Boolean).map(v=>scalar(v));
    }
    if (/^[&*!{|>]/.test(value)) fail('Unsupported Markdown metadata syntax');
    if (value.startsWith('"')) { try {return JSON.parse(value);} catch {fail('Invalid quoted metadata');} }
    if (value.startsWith("'")) {if(!value.endsWith("'"))fail('Invalid quoted metadata');return value.slice(1,-1).replace(/''/g,"'");}
    if (value==='true')return true;if(value==='false')return false;
    if (/^-?\d+(\.\d+)?$/.test(value))return Number(value);
    return value;
}

function markdown(input, sourceName) {
    if (typeof input!=='string')fail('Markdown input must be text');
    const text=input.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
    const meta=Object.create(null);let body=text;
    if(text.startsWith('---\n')) {
        const end=text.indexOf('\n---',3);
        if(end<0 || !/^\n---(?:\n|$)/.test(text.slice(end)))fail('Unclosed Markdown frontmatter');
        let current;
        for(const line of text.slice(4,end).split('\n')) {
            if(!line.trim() || line.trim().startsWith('#'))continue;
            const item=line.match(/^\s*-\s+(.+)$/);
            if(item){if(!current || !Array.isArray(meta[current]))fail('Unexpected Markdown list');meta[current].push(scalar(item[1]));continue;}
            const pair=line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
            if(!pair || Object.hasOwn(meta,pair[1]))fail('Unsupported or duplicate Markdown metadata');
            current=pair[1];meta[current]=scalar(pair[2]);
        }
        body=text.slice(end+4).replace(/^\n/,'');
    }
    if(list(meta.tags).includes('lorebook-guide'))return {entries:{},adapter:'markdown',warnings:['Guide document skipped']};
    const allowed=new Set(['id','title','keys','secondary_keys','summary','tags','type','priority','always','constant','status','visibility','location','character_present','time_from','time_to']);
    const unsupported=Object.keys(meta).filter(key=>!allowed.has(key));
    const id=meta.id ?? 'md-'+crypto.createHash('sha256').update(sourceName || 'document.md').digest('hex').slice(0,20);
    const title=meta.title ?? body.match(/^#\s+(.+)$/m)?.[1] ?? sourceName ?? 'Markdown';
    return {adapter:'markdown',warnings:unsupported.map(k=>'Unsupported metadata disables entry: '+k),entries:[{
        uid:id,comment:title,content:body,key:list(meta.keys),keysecondary:list(meta.secondary_keys),selective:list(meta.secondary_keys).length>0,
        order:meta.priority ?? 0,constant:meta.always===true || meta.constant===true,
        disable:unsupported.length>0 || ['disabled','deprecated','draft'].includes(meta.status),
        extensions:{narrative_engine:{visibility:meta.visibility,gating:{...(meta.location!==undefined?{location:meta.location}:{}),...(meta.character_present!==undefined?{characters:meta.character_present}:{}),...(meta.time_from!==undefined?{timeFrom:meta.time_from}:{}),...(meta.time_to!==undefined?{timeTo:meta.time_to}:{})}}},
        summary:typeof meta.summary==='string'?meta.summary:'',tags:list(meta.tags),loreType:meta.type || 'other',
        links:[...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m=>m[1]).slice(0,100),
    }]};
}

function adaptLore(input, {format='auto',sourceName='document.md',mappingProfile}={}) {
    if(typeof sourceName!=='string' || sourceName.length>255)fail('Invalid source filename');
    if(!['auto','world_info','character_book','markdown','mapped_json'].includes(format))fail('Unsupported lore format');
    if(typeof input==='string' && Buffer.byteLength(input)>500000)fail('Lore file exceeds 500 KB');
    if(format==='markdown')return markdown(input,sourceName);
    if(typeof input==='string') {try{input=JSON.parse(input.replace(/^\uFEFF/,''));}catch{fail('Invalid lore JSON');}}
    if(format==='mapped_json')return mapLore(input,mappingProfile);
    if(input?.format==='narrative-engine.lore-library.v1') {
        if(!Array.isArray(input.entries))fail('Invalid native lore entries');
        return {adapter:'native_json',warnings:[],entries:input.entries.map(e=>({
            uid:e.id,comment:e.title,content:e.body,key:e.keys,keysecondary:e.secondaryKeys,selective:e.selective===true,
            order:e.priority,insertionOrder:e.insertionOrder,caseSensitive:e.caseSensitive,constant:e.always,
            disable:e.status!=='active',summary:e.summary,tags:e.tags,loreType:e.type,links:e.links,
            extensions:{narrative_engine:{visibility:e.locked?'secret':e.visibility,visibleTo:e.visibleTo,gating:e.gating,baselines:e.baselines}},
        }))};
    }
    const nested=input?.data?.character_book ?? input?.character_book;
    const book=nested || input;
    const isBook=format==='character_book' || (format==='auto' && (nested || Array.isArray(book?.entries) && book.entries.some(e=>e && Object.hasOwn(e,'keys'))));
    if(!isBook)return {...input,adapter:'world_info',warnings:[]};
    if(!Array.isArray(book?.entries))fail('Expected character_book entries array');
    return {adapter:'character_book',warnings:[],entries:book.entries.map((e,index)=>{
        if(!e || typeof e!=='object')fail('Invalid character_book entry');
        return {uid:e.id ?? index,key:e.keys,keysecondary:e.secondary_keys,content:e.content,comment:e.name ?? e.comment ?? String(e.id ?? index),
            order:e.priority ?? 0,insertionOrder:e.insertion_order ?? index,caseSensitive:e.case_sensitive===true,
            constant:e.constant===true,selective:e.selective===true,disable:e.enabled!==true,extensions:e.extensions};
    })};
}
module.exports={adaptLore};
