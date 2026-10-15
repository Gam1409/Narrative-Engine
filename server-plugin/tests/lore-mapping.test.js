'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {importWorldInfo, LoreStore} = require('../lib/lore');
const {Database} = require('../lib/database');
const profile = {profile:'world',format:'json',entriesPath:'$.world.items[*]',
 fields:{id:'$.id',title:'$.name',body:'$.description',keys:'$.triggers',tags:'$.labels',priority:'$.weight'},
 tagMap:{place:{type:'location'},open:{visibility:'public'},secret:{visibility:'secret'},'known:*':{visibility:'restricted',visibleTo:'$1'}},
 defaults:{visibility:'hidden',type:'other'}};
const row = (id, labels) => ({id,name:id,description:'A room.',triggers:['room'],labels,weight:0});
const input = {world:{items:[row('room',['place','open']),row('secret',['secret','open']),row('unknown',['typo','open']),row('known',['known:alice','open'])]}};
const options = {format:'mapped_json',mappingProfile:profile};
test('mapping preserves fields, keeps public opt-in, locks private tags independent of ordering', () => {
 const hidden=importWorldInfo(input,[],options); assert.equal(hidden.report.public,0);
 const result=importWorldInfo(input,['room','secret','known'],options);
 assert.equal(result.entries[0].type,'location');assert.equal(result.entries[0].priority,0);
 assert.equal(result.entries[0].visibility,'public');
 for(const i of [1,3]){assert.equal(result.entries[i].visibility,'hidden');assert.equal(result.entries[i].locked,true);}
 assert.deepEqual(result.entries[3].visibleTo,['alice']);
 assert.equal(result.entries[2].status,'active');assert.match(result.report.warnings[0],/typo/);
 assert.deepEqual(result.mappingProfile,profile);
});
test('mapping rejects executable, inherited and unsupported paths and malformed rows', () => {
 for(const entriesPath of ['$.constructor.items[*]','$.world..items','$.world.items[?(@.secret)]','$.world.items[*].name'])
  assert.throws(()=>importWorldInfo(input,[],{...options,mappingProfile:{...profile,entriesPath}}));
 const inherited=Object.create({world:input.world});assert.throws(()=>importWorldInfo(inherited,[],options),/array/);
 for(const fields of [{body:'$.missing'},{body:'$.description',oops:'$.id'},{body:'$.description',tags:'$.weight'}])
  assert.throws(()=>importWorldInfo(input,[],{...options,mappingProfile:{...profile,fields}}));
 assert.throws(()=>importWorldInfo(input,[],{format:'mapped_json'}),/profile/);
 assert.throws(()=>importWorldInfo({world:{items:Array(501).fill(row('a',[]))}},[],options),/500/);
});
test('mapped import is idempotent, deprecates removed IDs and retrieves public freeform tags but never private tags', t => {
 const db=new Database({storageRoot:process.cwd(),databasePath:':memory:'});t.after(()=>db.close());const store=new LoreStore(db.db);
 assert.equal(store.save('u','world',input,['room','secret','unknown','known'],0,options).revision,1);
 assert.equal(store.save('u','world',input,['room','secret','unknown','known'],1,options).revision,1);
 assert.deepEqual(store.retrieve('u','world','room').entries.map(e=>e.id),['room','unknown']);
 store.save('u','world',{world:{items:[row('second',['place'])]}},[],1,options);
 assert.equal(store.read('u','world').entries.find(e=>e.id==='room').status,'deprecated');
 assert.equal(store.retrieve('u','world','room').entries.length,0);
});

test('freeform tags activate only public lore, respect word boundaries, case and secondary gates',t=>{
 const db=new Database({storageRoot:process.cwd(),databasePath:':memory:'});t.after(()=>db.close());const store=new LoreStore(db.db);
 const entries=[
  {uid:'public',content:'Harbor lore',tags:['port','Night Market']},
  {uid:'hidden',content:'Hidden lore',tags:['port']},
  {uid:'secret',content:'Secret lore',tags:['port'],extensions:{narrative_engine:{visibility:'secret'}}},
  {uid:'gated',content:'Conditional lore',tags:['port'],selective:true,keysecondary:['night']},
  {uid:'case',content:'Case sensitive lore',tags:['PORT'],caseSensitive:true},
 ];
 store.save('u','world',{entries},['public','secret','gated','case'],0);
 assert.deepEqual(store.retrieve('u','world','port').entries.map(e=>e.id),['public']);
 assert.equal(store.retrieve('u','world','transport').entries.length,0);
 assert.deepEqual(store.retrieve('u','world','night market').entries.map(e=>e.id),['public']);
 assert.deepEqual(store.retrieve('u','world','port at night').entries.map(e=>e.id),['gated','public']);
 assert.deepEqual(store.retrieve('u','world','PORT').entries.map(e=>e.id),['case','public']);
 assert.equal(store.retrieve('u','world','port',1).entries.length,0);
});
