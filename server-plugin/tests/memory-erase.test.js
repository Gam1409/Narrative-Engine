'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {Database}=require('../lib/database');
const {eraseStoredMemory}=require('../lib/memory-erase');
const {scopeChatId}=require('../lib/routes');
function fixture(t){const db=new Database({storageRoot:process.cwd(),databasePath:':memory:'});t.after(()=>db.close());return db;}
const id=(user,chat)=>scopeChatId({user:{handle:user}},chat);
const bundle=()=>({historyVersion:2,state:{revision:4,relationships:{ab:'trust'},timeline:{time:'10:00'}},records:[{deltaId:'d',delta:{},memories:[{summary:'SECRET'}]}],deltas:[{deltaId:'d',delta:{},memories:[{summary:'SECRET'}]}],checkpoints:[{messageIndex:-1,state:{revision:0},memories:[{id:'base',summary:'OLD'}]}],decisions:[],memories:[{id:'m',summary:'SECRET'}]});
test('memory erasure removes recoverable copies and indexes, preserves state and isolates scope',t=>{
 const db=fixture(t),a=id('a','one'),b=id('a','two'),other=id('b','one');
 for(const scope of [a,b,other]) {
  db.writeField(scope,'bundle',bundle(),0);
  db.writeField(scope,'backup-author-x',bundle(),0);
  db.db.prepare('INSERT INTO embedding_cache(scope,hash,model,vector_json) VALUES (?,?,?,?)').run(scope,'h','m','[1]');
  if(db.ftsAvailable)db.db.prepare('INSERT INTO embedding_fts(cache_key,text) VALUES (?,?)').run(scope+':m:h','SECRET');
 }
 const before=db.readField(a,'bundle');
 eraseStoredMemory(db,a.slice(0,17),a);
 const after=db.readField(a,'bundle');
 assert.deepEqual(after.value.state,before.value.state);
 assert.deepEqual(after.value.memories,[]);assert.deepEqual(after.value.records[0].memories,[]);
 assert.deepEqual(after.value.checkpoints[0].memories,[]);
 assert.doesNotMatch(JSON.stringify(db.readField(a,'backup-author-x')),/SECRET|OLD/);
 assert.throws(()=>db.writeField(a,'bundle',before.value,before.revision),/revision/);
 assert.equal(db.readField(b,'bundle').value.memories.length,1);
 assert.equal(db.db.prepare('SELECT count(*) n FROM embedding_cache WHERE scope=?').get(a).n,0);
 eraseStoredMemory(db,a.slice(0,17));
 assert.equal(db.readField(b,'bundle').value.memories.length,0);
 assert.equal(db.readField(other,'bundle').value.memories.length,1);
 if(db.ftsAvailable)assert.equal(db.db.prepare('SELECT count(*) n FROM embedding_fts').get().n,1);
});
test('state reset deletes history, leaves revision tombstones and does not affect other users',t=>{
 const db=fixture(t),a=id('a','one'),other=id('b','one');
 db.writeField(a,'bundle',bundle(),0);db.writeField(other,'bundle',bundle(),0);
 db.saveState(a,{__narrativeEngineStore:1,values:{state:{old:true}}});
 eraseStoredMemory(db,a.slice(0,17),null,true);
 assert.equal(db.readField(a,'bundle').value,null);assert.equal(db.getState(a),null);
 assert.equal(db.db.prepare('SELECT count(*) n FROM turn_records WHERE chat_id=?').get(a).n,0);
 assert.ok(db.readField(other,'bundle').value);
 assert.throws(()=>db.writeField(a,'bundle',bundle(),1),/revision/);
});
