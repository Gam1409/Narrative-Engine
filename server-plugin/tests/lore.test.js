'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {importWorldInfo,LoreStore}=require('../lib/lore');
const {Database}=require('../lib/database');
const input={entries:{a:{uid:0,key:'room, kitchen',comment:42,content:'A quiet kitchen.',order:0},b:{uid:1,key:['room'],content:'Secret passage.',extensions:{narrative_engine:{visibility:'secret'}}}}};
function store(t){const db=new Database({storageRoot:process.cwd(),databasePath:':memory:'});t.after(()=>db.close());return new LoreStore(db.db);}
test('World Info normalizes dirty input with visibility closed by default',()=>{
 const result=importWorldInfo('\uFEFF'+JSON.stringify(input));
 assert.equal(result.report.public,0);assert.equal(result.entries[0].priority,0);assert.equal(result.entries[0].title,'42');
 assert.deepEqual(result.entries[0].keys,['room','kitchen']);
 const visible=importWorldInfo(input,['0','1']);assert.equal(visible.report.public,1);assert.equal(visible.entries[1].visibility,'hidden');
 assert.throws(()=>importWorldInfo({entries:[{uid:1,content:'a'},{uid:1,content:'b'}]}),/Duplicate/);
});
test('library is user-isolated, idempotent, versioned and deprecates missing entries',t=>{
 const s=store(t);assert.equal(s.save('alice','world',input,['0'],0).revision,1);
 assert.equal(s.save('alice','world',input,['0'],1).revision,1);
 assert.equal(s.read('bob','world').revision,0);
 assert.throws(()=>s.save('alice','world',input,['0'],0),/changed/);
 s.save('alice','world',{entries:{b:input.entries.b}},[],1);
 assert.equal(s.read('alice','world').entries.find(e=>e.id==='0').status,'deprecated');
 assert.equal(s.retrieve('alice','world','room').entries.length,0);
});
test('retrieval respects activation, public visibility, budget and always ceiling',t=>{
 const s=store(t);s.save('alice','world',input,['0'],0);
 assert.equal(s.retrieve('alice','world','room').entries.length,1);
 assert.equal(s.retrieve('alice','world','ocean').entries.length,0);
 assert.equal(s.retrieve('bob','world','room').entries.length,0);
 assert.equal(s.retrieve('alice','world','room',1).entries.length,0);
 const conditional={entries:[{uid:0,key:'room',keysecondary:'night',selective:true,content:'Evening scene.'},{uid:1,key:'room',selective:true,selectiveLogic:3,content:'unsupported'}]};
 s.save('alice','other',conditional,['0','1'],0);
 assert.equal(s.retrieve('alice','other','room').entries.length,0);
 assert.equal(s.retrieve('alice','other','room at night').entries.length,1);
});


test('character book import handles wrapped cards, order, disabled entries and case sensitivity', t=>{
 const s=store(t);
 const card={data:{creator_notes:'DO NOT IMPORT',system_prompt:'DO NOT IMPORT',character_book:{entries:[
  {id:7,keys:['Castle'],secondary_keys:['night'],selective:true,content:'The gate is closed.',enabled:true,insertion_order:0,priority:0,case_sensitive:true,name:'Gate'},
  {id:8,keys:['Castle'],content:'disabled',enabled:false,insertion_order:1},
 ]}}};
 const parsed=importWorldInfo(card,['7','8']);assert.equal(parsed.report.adapter,'character_book');
 assert.equal(parsed.entries[0].insertionOrder,0);assert.equal(parsed.entries[1].status,'disabled');
 assert.ok(!JSON.stringify(parsed).includes('DO NOT IMPORT'));
 s.save('u','card',card,['7','8'],0);
 assert.equal(s.retrieve('u','card','castle at night').entries.length,0);
 assert.equal(s.retrieve('u','card','Castle at night').entries.length,1);
 assert.equal(importWorldInfo(card.data.character_book).report.adapter,'character_book');
});
test('Markdown retains metadata, stable source ID, body and wiki links without auto-publication',t=>{
 const md='---\ntitle: Kitchen\nkeys: [kitchen, room]\nsummary: A small room\ntags:\n  - interior\npriority: 0\n---\n# Kitchen\nOld walls and [[Hall|a doorway]].';
 const options={format:'markdown',sourceName:'kitchen.md'};
 const result=importWorldInfo(md,[],options),entry=result.entries[0];
 assert.equal(entry.visibility,'hidden');assert.equal(entry.title,'Kitchen');assert.equal(entry.priority,0);
 assert.deepEqual(entry.links,['Hall']);assert.equal(entry.summary,'A small room');
 assert.equal(importWorldInfo(md+' More.',[],options).entries[0].id,entry.id);
 const s=store(t);s.save('u','md',md,[entry.id],0,options);
 assert.equal(s.retrieve('u','md','kitchen').entries.length,1);
});
test('Markdown rejects unsafe or ambiguous metadata and disables unsupported gating',()=>{
 const options={format:'markdown'};
 assert.throws(()=>importWorldInfo('---\nkeys: [room]\nkeys: [hall]\n---\nBody',[],options),/duplicate/);
 assert.throws(()=>importWorldInfo('---\nkeys: !exec bad\n---\nBody',[],options),/Unsupported/);
 assert.throws(()=>importWorldInfo('---\nkeys: [room]\nBody',[],options),/Unclosed/);
 const gated=importWorldInfo('---\nkeys: [room]\nera: medieval\n---\nBody',[],options);
 assert.equal(gated.entries[0].status,'disabled');assert.equal(gated.report.warnings.length,1);
 assert.equal(importWorldInfo('---\ntags: [lorebook-guide]\n---\nInstructions',[],options).entries.length,0);
 const secret='---\nid: private\nvisibility: secret # hidden\n---\nSecret';
 assert.equal(importWorldInfo(secret,['private'],options).entries[0].visibility,'hidden');
 assert.equal(importWorldInfo('---\n---\nBody',[],options).entries[0].body,'Body');
});

test('lore uses author summary before omitting, preserves source and excludes private entries from trace', t=>{
 const s=store(t), body='Long history. '.repeat(200);
 const input={entries:[{uid:'long',key:'room',content:body,summary:'Short history.',order:10},
  {uid:'short',key:'room',content:'Small fact.'},
  {uid:'huge',key:'room',content:body,summary:body,order:-1},
  {uid:'secret',key:'room',content:body,summary:'Secret summary.',extensions:{narrative_engine:{visibility:'secret'}}}]};
 s.save('u','w',input,['long','short','huge','secret'],0);
 const result=s.retrieve('u','w','room',100);
 assert.deepEqual(result.entries.map(e=>e.id),['long','short']);
 assert.equal(result.entries[0].body,'Short history.');
 assert.deepEqual(result.selection.map(e=>[e.id,e.mode]),[['long','summary'],['short','full'],['huge','omitted']]);
 assert.ok(result.estimatedTokens<=100);
 assert.equal(s.read('u','w').entries[0].body,body);
 assert.equal(s.retrieve('u','w','room',2000).entries[0].body,body);
 assert.throws(()=>importWorldInfo({entries:[{content:'a',summary:{text:'bad'}}]}),/Summary/);
});
test('summary fallback respects aggregate always ceiling and entry limit',t=>{
 const s=store(t);const entries=Array.from({length:12},(_,i)=>({uid:'e'+i,key:'room',content:'x'.repeat(3000),summary:'Fact.',constant:i<2,order:12-i}));
 s.save('u','w',{entries},entries.map(e=>e.uid),0);
 const result=s.retrieve('u','w','room',60);
 const always=result.selection.filter(e=>['e0','e1'].includes(e.id)&&e.mode!=='omitted');
 assert.ok(always.reduce((n,e)=>n+e.estimatedTokens,0)<=15);
 assert.ok(result.selection.some(e=>e.reason==='always_budget'));
 assert.ok(result.estimatedTokens<=60);
 const roomy=s.retrieve('u','w','room',2000);
 assert.equal(roomy.entries.length,10);assert.ok(roomy.selection.some(e=>e.reason==='entry_limit'));
});

test('lore gating requires canonical location, all participants and game time, including midnight',t=>{
 const s=store(t);const md='---\nid: night\nkeys: [room]\nlocation: kitchen\ncharacter_present: [Anna, Bob]\ntime_from: "22:00"\ntime_to: "06:00"\n---\nNight kitchen.';
 const options={format:'markdown'};s.save('u','night',md,['night'],0,options);
 const context={location:'kitchen',present:['Anna','Bob'],time:'23:00'};
 assert.equal(s.retrieve('u','night','room kitchen Anna Bob 23:00').entries.length,0);
 assert.equal(s.retrieve('u','night','room',450,context).entries.length,1);
 for(const patch of [{location:'hall'},{present:['Anna']},{time:'12:00'},{time:'06:00'},{time:'25:00'},{time:undefined}])
  assert.equal(s.retrieve('u','night','room',450,{...context,...patch}).entries.length,0);
 assert.equal(s.retrieve('u','night','room',450,{...context,time:'01:00'}).entries.length,1);
 const native={format:'narrative-engine.lore-library.v1',entries:s.read('u','night').entries};
 assert.deepEqual(importWorldInfo(native,['night']).entries[0].gating,{location:['kitchen'],characters:['Anna','Bob'],timeFrom:'22:00',timeTo:'06:00'});
 assert.throws(()=>importWorldInfo({entries:[{content:'a',extensions:{narrative_engine:{gating:{timeFrom:'22:00'}}}}]}),/gating/);
 assert.throws(()=>importWorldInfo({entries:[{content:'a',extensions:{narrative_engine:{gating:{unknown:'x'}}}}]}),/gating/);
});


test('explicit lore baselines survive native export format and budgeted public retrieval', t=>{
 const s=store(t);
 const baselines=[{entityId:'Anna',parameter:'temperament',value:'quiet'}];
 const document={entries:{anna:{uid:'anna',content:'Originally quiet.',key:['Anna'],extensions:{narrative_engine:{baselines}}}}};
 s.save('alice','world',document,['anna'],0);
 const retrieved=s.retrieve('alice','world','Anna',500);
 assert.deepEqual(retrieved.entries[0].baselines,baselines);
 assert.ok(retrieved.estimatedTokens<=500);
 const native={format:'narrative-engine.lore-library.v1',entries:s.read('alice','world').entries};
 assert.deepEqual(importWorldInfo(native,['anna']).entries[0].baselines,baselines);
 assert.equal(s.retrieve('bob','world','Anna',500).entries.length,0);
});

test('invalid baseline metadata fails import instead of silently creating authority',()=>{
 for(const baselines of [[{entityId:'Anna',parameter:'x',value:{nested:'unsupported'}}],
  [{entityId:'Anna',parameter:'x',value:1,path:'arbitrary'}],
  [{entityId:'Anna',parameter:'x',value:1},{entityId:'Anna',parameter:'x',value:2}],
  Array.from({length:21},(_,i)=>({entityId:'Anna',parameter:String(i),value:1}))]) {
  assert.throws(()=>importWorldInfo({entries:{x:{content:'text',extensions:{narrative_engine:{baselines}}}}}),/baselines/);
 }
});
