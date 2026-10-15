'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');

/** JSON is the committed library; source files are immutable sidecars written first. */
class LoreFiles {
    constructor(root) {this.root=path.resolve(root);this.directory(this.root);}
    directory(dir) {
        fs.mkdirSync(dir,{recursive:true,mode:0o700});
        if(fs.lstatSync(dir).isSymbolicLink() || !fs.lstatSync(dir).isDirectory())throw Error('Lore directory cannot be a link');
    }
    clearScope(scope) {
        const dir=path.resolve(this.root,digest(String(scope)));
        if(path.dirname(dir)!==this.root)throw Error('Invalid lore directory');
        if(!fs.existsSync(dir))return;
        if(fs.lstatSync(dir).isSymbolicLink())throw Error('Lore directory cannot be a link');
        const files=fs.readdirSync(dir).map(name=>path.join(dir,name));
        if(files.some(file=>!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()))throw Error('Unexpected lore directory entry');
        for(const file of files)fs.unlinkSync(file);
        fs.rmdirSync(dir);
    }
    location(scope,id) {
        const dir=path.join(this.root,digest(String(scope)));
        this.directory(dir);
        const name=String(id).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,40)+'-'+digest(String(id)).slice(0,16);
        return {dir,file:path.join(dir,name+'.json'),name};
    }
    readFile(file) {
        const stat=fs.lstatSync(file);
        if(stat.isSymbolicLink() || !stat.isFile() || stat.size>25000000)throw Error('Invalid lore file');
        return fs.readFileSync(file,'utf8');
    }
    read(scope,id) {
        const {file}=this.location(scope,id);
        let text;
        try{text=this.readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
        const value=JSON.parse(text);
        if(value.format!=='narrative-engine.lore-library.v1' || value.libraryId!==id || !Number.isInteger(value.revision) || value.revision<1 || !Array.isArray(value.entries) || value.entries.length>1000)throw Error('Invalid lore library JSON');
        const ids=new Set();
        for(const e of value.entries) {
            if(!e || typeof e.id!=='string' || ids.has(e.id) || typeof e.body!=='string' || e.body.length>20000 || typeof e.title!=='string' || !Array.isArray(e.keys) || e.keys.some(k=>typeof k!=='string') || !Array.isArray(e.secondaryKeys) || e.secondaryKeys.some(k=>typeof k!=='string') || !['public','hidden'].includes(e.visibility) || !['active','disabled','deprecated'].includes(e.status))throw Error('Invalid lore entry in library JSON');
            if(e.locked && e.visibility==='public')throw Error('Locked lore entry cannot be public');
            ids.add(e.id);
        }
        return value;
    }
    atomic(file,text) {
        if(Buffer.byteLength(text)>25000000)throw Error('Lore file exceeds 25 MB');
        if(fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())throw Error('Lore file cannot be a link');
        const temp=file+'.'+crypto.randomUUID()+'.tmp';
        try {
            const fd=fs.openSync(temp,'wx',0o600);
            try{fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
            fs.renameSync(temp,file);
        } finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
    }
    write(scope,id,value,input,options={}) {
        const {dir,file,name}=this.location(scope,id);
        let source=value.sourceFile || null;
        if(input!==undefined) {
            const text=typeof input==='string'?input:JSON.stringify(input,null,2);
            const extension=options.format==='markdown'?'md':'json';
            source=`${name}.source-${digest(text)}.${extension}`;
            const target=path.join(dir,source);
            if(!fs.existsSync(target))this.atomic(target,text);
            else if(this.readFile(target)!==text)throw Error('Lore source checksum mismatch');
        }
        const result={...value,format:'narrative-engine.lore-library.v1',libraryId:id,sourceFile:source};
        this.atomic(file,JSON.stringify(result,null,2)+'\n');
        return result;
    }
    export(scope,id,kind='library') {
        const value=this.read(scope,id);
        if(!value)throw Object.assign(new Error('Lore library not found'),{status:404});
        if(kind==='library')return {name:'lore-library.json',content:JSON.stringify(value,null,2)};
        const {dir,name}=this.location(scope,id);
        if(kind!=='source' || typeof value.sourceFile!=='string' || !value.sourceFile.startsWith(name+'.source-') || !/\.source-[a-f0-9]{64}\.(md|json)$/.test(value.sourceFile) || path.basename(value.sourceFile)!==value.sourceFile)throw Object.assign(new Error('Original source unavailable'),{status:404});
        return {name:value.sourceFile.endsWith('.md')?'lore-source.md':'lore-source.json',content:this.readFile(path.join(dir,value.sourceFile))};
    }
}
module.exports={LoreFiles};
