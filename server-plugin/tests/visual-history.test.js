'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Database } = require('../lib/database');
const { VisualQueue } = require('../lib/visual');
const { loadConfig } = require('../lib/config');

function fixture(t, config = {}) {
    const db = new Database({storageRoot:process.cwd(),databasePath:':memory:'});
    const q = new VisualQueue(config, db);
    t.after(() => {q.close(); db.close();});
    const insert = db.db.prepare('INSERT INTO visual_jobs VALUES (?,?,?,?,?,?)');
    const now = Date.now();
    function add(id, scope='u:c', status='done', patch={}, time=now-2*86400000) {
        const job = {id,scope,requestKey:id,status,scene:{sceneId:'a'.repeat(64)},workflow:'scene_full',createdAt:time,
            history:[{status,at:time}],graph:{1:{class_type:'Test',inputs:{text:'x'.repeat(10000)}}},
            prompts:{positive:'preserved'},outputs:[{assetId:'saved'}],...patch};
        insert.run(id,scope,id,status,JSON.stringify(job),time);
        return job;
    }
    return {db,q,add,now};
}

test('compaction bounds batches, retains per-chat recent history and idempotency without network', async t => {
    const {db,q,add,now} = fixture(t);
    for(let i=0;i<3000;i++) add(String(i).padStart(4,'0'));
    const other = add('other','other:chat');
    let calls=0; q.api=async()=>{calls++;throw Error('network forbidden');};
    const first=q.historyMaintenance.run(now);
    assert.equal(first.compacted,50);
    assert.ok(first.bytesRemoved>490000);
    assert.equal(q.historyMaintenance.run(now+1),null);
    for(let i=1;i<=58;i++) q.historyMaintenance.run(now+i*60000);
    const count=db.db.prepare("SELECT count(*) n FROM visual_jobs WHERE scope='u:c' AND json_type(data_json,'$.graph')='object'").get().n;
    assert.equal(count,100);
    assert.deepEqual(q.get('other:chat','other',true),other);
    const compacted=q.get('u:c','0000',true);
    assert.equal(compacted.graph,undefined);
    assert.equal(compacted.prompts.positive,'preserved');
    assert.equal(compacted.outputs[0].assetId,'saved');
    assert.equal(q.enqueue('u:c',{requestKey:'0000',scene:{sceneId:'a'.repeat(64),characters:[]},workflow:'scene_full'}).id,'0000');
    q.assets.image=(scope,id)=>({bytes:Buffer.from(scope+id)});
    assert.equal((await q.image('u:c','0000',0)).bytes.toString(),'u:csaved');
    await q.tick(); assert.equal(calls,0);
    assert.equal(db.db.prepare('SELECT count(*) n FROM visual_jobs').get().n,3001);
});

test('active, recent and ambiguous submissions survive; old known terminal jobs compact', t => {
    const {q,add,now} = fixture(t,{visualGraphKeepRecent:1});
    for(const status of ['queued','running','failed','requested']) add(status,'u:c',status);
    add('unknown','u:c','failed_final',{submissionUnknown:true});
    add('pending','u:c','failed_final',{submissionPending:true});
    add('legacy','u:c','failed_final',{error:'remote acceptance unknown'});
    add('fresh','u:c','done',{},now);
    add('cancelled','u:c','cancelled'); add('failed_final','u:c','failed_final');
    assert.equal(q.historyMaintenance.run(now).compacted,2);
    for(const id of ['queued','running','failed','requested','unknown','pending','legacy','fresh']) assert.ok(q.get('u:c',id,true).graph,id);
});

test('history compaction can be disabled and configuration is clamped', t => {
    const {q,add,now}=fixture(t,{visualGraphCompaction:false,visualGraphKeepRecent:0});
    add('old'); assert.equal(q.historyMaintenance.run(now),null); assert.ok(q.get('u:c','old',true).graph);
    const c=loadConfig({NARRATIVE_ENGINE_VISUAL_GRAPH_RETENTION_HOURS:'0',NARRATIVE_ENGINE_VISUAL_GRAPH_KEEP_RECENT:'999999',NARRATIVE_ENGINE_VISUAL_GRAPH_COMPACTION:'false'});
    assert.equal(c.visualGraphRetentionHours,1); assert.equal(c.visualGraphKeepRecent,10000); assert.equal(c.visualGraphCompaction,false);
});
