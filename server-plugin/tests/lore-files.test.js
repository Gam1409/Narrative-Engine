'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {Database}=require('../lib/database');const {LoreStore,importWorldInfo}=require('../lib/lore');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ne-lore-files-'));
 const db=new Database({storageRoot:root,databasePath:':memory:'});
 t.after(()=>{db.close();if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('ne-lore-files-'))fs.rmSync(root,{recursive:true,force:true});});
 return {root,db,store:new LoreStore(db.db,{fileRoot:path.join(root,'lore')})};
}
const text='---\nid: room\nkeys: [room]\n---\nA warm room.';
test('file-backed lore stores exact Markdown, JSON library and survives service recreation',t=>{
 const {store,db,root}=fixture(t);
 store.save('user','world',text,['room'],0,{format:'markdown',sourceName:'room.md'});
 assert.equal(store.export('user','world','source').content,text);
 const native=JSON.parse(store.export('user','world','library').content);
 assert.equal(native.entries[0].visibility,'public');
 assert.equal(importWorldInfo(native,['room']).entries[0].body,'A warm room.');
 const reopened=new LoreStore(db.db,{fileRoot:path.join(root,'lore')});
 assert.equal(reopened.retrieve('user','world','room').entries.length,1);
 assert.equal(reopened.read('other','world').revision,0);
 assert.equal(db.db.prepare('SELECT count(*) n FROM lore_libraries').get().n,0);
});
test('legacy SQLite migrates without changing visibility or losing historical entries',t=>{
 const {store,db}=fixture(t);const old=new LoreStore(db.db);
 old.save('legacy','world',{entries:[{uid:1,key:'room',content:'Hidden room'}]},[],0);
 const migrated=store.read('legacy','world');assert.equal(migrated.entries[0].visibility,'hidden');
 assert.equal(migrated.revision,1);assert.equal(migrated.sourceFile,null);
 assert.throws(()=>store.export('legacy','world','source'),/unavailable/);
 assert.equal(db.db.prepare('SELECT count(*) n FROM lore_libraries').get().n,1);
});
test('failed atomic publication preserves prior library and corrupt JSON never falls back silently',t=>{
 const {store}=fixture(t);const options={format:'markdown'};
 store.save('u','world',text,['room'],0,options);
 const original=store.files.atomic.bind(store.files);
 store.files.atomic=(file,body)=>{if(file===store.files.location('u','world').file)throw Error('disk failure');return original(file,body);};
 assert.throws(()=>store.save('u','world',text+' changed',['room'],1,options),/disk failure/);
 assert.equal(store.read('u','world').revision,1);
 store.files.atomic=original;
 fs.writeFileSync(store.files.location('u','world').file,'broken');
 assert.throws(()=>store.read('u','world'));
});
test('source export rejects paths outside the managed library directory',t=>{
 const {store}=fixture(t);store.save('u','world',text,[],0,{format:'markdown'});
 const file=store.files.location('u','world').file,value=JSON.parse(fs.readFileSync(file,'utf8'));
 value.sourceFile='../outside.md';fs.writeFileSync(file,JSON.stringify(value));
 assert.throws(()=>store.export('u','world','source'),/unavailable/);
});

test('custom mapping profile and raw JSON survive file export and repeat import',t=>{
 const {store}=fixture(t);
 const input=JSON.stringify({items:[{id:'room',text:'Room',keys:['room']}]});
 const mappingProfile={entriesPath:'$.items[*]',fields:{id:'$.id',body:'$.text',keys:'$.keys'}};
 const options={format:'mapped_json',mappingProfile};
 store.save('u','mapped',input,['room'],0,options);
 const library=JSON.parse(store.export('u','mapped','library').content);
 assert.deepEqual(library.mappingProfile,mappingProfile);
 assert.equal(store.export('u','mapped','source').content,input);
 assert.equal(store.save('u','mapped',input,['room'],1,options).revision,1);
 assert.equal(importWorldInfo(library,['room']).entries[0].body,'Room');
});

test('clearing lore removes native files, exact source copies and isolates users',t=>{
 const {store}=fixture(t);
 store.save('alice','world',text,[],0,{format:'markdown'});
 store.save('bob','world',text,[],0,{format:'markdown'});
 const dir=store.files.location('alice','world').dir;
 store.files.clearScope('alice');
 assert.equal(fs.existsSync(dir),false);
 assert.equal(store.read('bob','world').revision,1);
 assert.equal(store.read('alice','world').revision,0);
});


test('clear invalidates stale previews across recreation and service reload',t=>{
 const {store,db,root}=fixture(t),options={format:'markdown'};
 store.save('alice','world',text,['room'],0,options);
 const old=store.read('alice','world');assert.equal(old.generation,0);
 store.clear('alice');
 const reopened=new LoreStore(db.db,{fileRoot:path.join(root,'lore')});
 const empty=reopened.read('alice','world');assert.equal(empty.revision,0);assert.equal(empty.generation,1);
 assert.throws(()=>reopened.save('alice','new',text,[],0,options),/cleared/);
 reopened.save('alice','world',text+' new',['room'],0,{...options,expectedGeneration:empty.generation});
 assert.equal(reopened.read('alice','world').revision,old.revision);
 assert.throws(()=>reopened.save('alice','world',text,[],old.revision,{...options,expectedGeneration:old.generation}),/cleared/);
 assert.equal(reopened.read('alice','world').entries[0].body,'A warm room. new');
 reopened.save('bob','world',text,[],0,options);
 assert.equal(reopened.read('bob','world').generation,0);
});


test('HTTP lore preview and import carry generation through clear and reject old clients',async t=>{
 const {db,root}=fixture(t), handlers=new Map();
 const {buildRoutes}=require('../lib/routes');
 const router={use(){},get(){},post(route,handler){handlers.set(route,handler);}};
 buildRoutes(router,{db,config:{storageRoot:root,rateLimit:100,rateWindowMs:1000,bodyLimitBytes:512000},provider:{}});
 async function call(route,body) {
  let output,failure;
  await handlers.get(route)({body,user:{handle:'alice'}},{json(value){output=value;}},error=>{failure=error;});
  if(failure)throw failure;return output;
 }
 const request={libraryId:'world',input:text,format:'markdown',publicIds:['room']};
 const original=await call('/lore/preview',request);
 await call('/lore/import',{...request,expectedRevision:original.revision,expectedGeneration:original.generation});
 await call('/data/clear',{chatId:'one',scope:'all',kind:'lore',confirm:'DELETE'});
 const fresh=await call('/lore/preview',request);assert.equal(fresh.generation,1);
 await assert.rejects(call('/lore/import',{...request,expectedRevision:0}),error=>error.status===409);
 const saved=await call('/lore/import',{...request,expectedRevision:fresh.revision,expectedGeneration:fresh.generation});
 assert.equal(saved.generation,1);
 await assert.rejects(call('/lore/import',{...request,expectedRevision:saved.revision,expectedGeneration:0}),error=>error.status===409);
});
test('partial lore clear failure still invalidates previews without silently losing old entries',t=>{
 const {store}=fixture(t);store.save('u','w',text,[],0,{format:'markdown'});
 store.files.clearScope=()=>{throw Error('disk failure');};
 assert.throws(()=>store.clear('u'),/disk failure/);
 assert.equal(store.read('u','w').generation,1);
 assert.equal(store.read('u','w').entries.length,1);
 assert.throws(()=>store.save('u','w',text,[],1,{format:'markdown'}),/cleared/);
});
