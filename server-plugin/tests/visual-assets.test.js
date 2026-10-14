'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const { Database } = require('../lib/database');
const { VisualQueue } = require('../lib/visual');
const { VisualAssets, inspectPng } = require('../lib/visual-assets');
function png(alpha = [255, 0]) {
    const image = new PNG({ width: 2, height: 1 });
    image.data.set([255, 0, 0, alpha[0], 0, 255, 0, alpha[1]]);
    return PNG.sync.write(image);
}
const recipe = {
    operation: 'sprite',
    outputNode: '1',
    version: 1,
    workflow: { 1: { class_type: 'SaveImage', inputs: { text: '' } } },
    bindings: [{ node: '1', input: 'text', source: 'positive' }],
};
const input = (operation = 'background', id = 'anna') => ({
    requestKey: crypto.randomUUID(),
    workflow: 'layer',
    seed: 42,
    operation,
    characterId: operation === 'sprite' ? id : null,
    resourceInput: 'a'.repeat(64),
    automatic: true,
    scene: {
        sceneId: 'b'.repeat(64),
        location: { name: 'room' },
        keyObjects: [],
        characters: operation === 'sprite' ? [{ id, name: id }] : [],
    },
});
const crypto = require('node:crypto');
function fixture(t, config = {}) {
    const db = new Database({ storageRoot: process.cwd(), databasePath: ':memory:' });
    const q = new VisualQueue(config, db, { recipes: { layer: recipe } });
    q.preflight = async () => {};
    t.after(() => {
        q.close();
        db.close();
    });
    return { q, db };
}
async function complete(q, job, bytes = png()) {
    q.api = async (route) =>
        route === '/prompt'
            ? { prompt_id: 'remote' }
            : route.startsWith('/view?')
              ? { bytes }
              : {
                    remote: {
                        status: { completed: true },
                        outputs: { 1: { images: [{ filename: 'result.png', type: 'output' }] } },
                    },
                };
    await q.tick();
    const raw = q.get('u:chat', job.id, true);
    raw.nextPoll = 0;
    q.save(raw);
    await q.tick();
    return q.get('u:chat', job.id);
}
test('PNG validation decodes alpha, rejects opaque/empty/truncated/oversized sprite data', () => {
    assert.equal(inspectPng(png(), true).transparent, true);
    assert.throws(() => inspectPng(png([255, 255]), true), /transparent/);
    assert.throws(() => inspectPng(png([0, 0]), true), /visible/);
    assert.throws(() => inspectPng(png().subarray(0, 40), true));
    const huge = Buffer.from(png());
    huge.writeUInt32BE(100000, 16);
    assert.throws(() => inspectPng(huge, true), /dimensions/);
});
test('layer persists locally, reuses across endpoint change and never crosses chat scope', async (t) => {
    const { q } = fixture(t);
    const request = input();
    const job = q.enqueue('u:chat', request);
    const done = await complete(q, job);
    assert.equal(done.status, 'done');
    assert.ok(done.asset.id);
    q.api = async () => {
        throw new Error('remote removed');
    };
    assert.deepEqual((await q.image('u:chat', job.id, 0)).bytes, png());
    assert.throws(() => q.assets.image('other:chat', done.asset.id), /not found/);
    const reused = q.enqueue('u:chat', { ...request, requestKey: 'new', endpoint: 'https://new.example' });
    assert.equal(reused.asset.id, done.asset.id);
    assert.equal(reused.reused, true);
    assert.equal(q.list('u:chat').length, 1);
    assert.equal(q.enqueue('other:chat', { ...request, requestKey: 'new' }).status, 'queued');
    q.recipes.layer = { ...recipe, workflow: { 1: { class_type: 'SaveImage', inputs: { text: '', newSetting: 1 } } } };
    assert.equal(q.enqueue('u:chat', { ...request, requestKey: 'changed-recipe' }).status, 'queued');
});
test('resource survives a real database reopen with ComfyUI offline', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-assets-'));
    const config = { storageRoot: root, databasePath: path.join(root, 'db.sqlite') };
    let db = new Database(config);
    let assets = new VisualAssets(db.db);
    const asset = assets.put(
        {
            scope: 'u:chat',
            resourceKey: 'key',
            operation: 'sprite',
            resourceInput: 'input',
            workflow: 'sprite',
            seed: 1,
        },
        png(),
    );
    db.close();
    db = new Database(config);
    assets = new VisualAssets(db.db);
    t.after(() => {
        db.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    assert.equal(assets.find('u:chat', 'key').id, asset.id);
    assert.deepEqual(assets.image('u:chat', asset.id).bytes, png());
});
test('invalid alpha and full quota cannot publish a sprite or delete existing assets', async (t) => {
    const { q } = fixture(t, { visualAssetScopeBytes: png().length });
    const valid = await complete(q, q.enqueue('u:chat', input('sprite')));
    assert.equal(valid.status, 'done');
    const invalid = await complete(q, q.enqueue('u:chat', input('sprite', 'bob')), png([255, 255]));
    assert.equal(invalid.status, 'failed_final');
    assert.match(invalid.error, /transparent/);
    const full = await complete(q, q.enqueue('u:chat', input('sprite', 'claire')));
    assert.equal(full.status, 'failed_final');
    assert.match(full.error, /quota/);
    assert.deepEqual(q.assets.image('u:chat', valid.asset.id).bytes, png());
});
test('sprites coalesce per character; identical inflight resources are not resubmitted', (t) => {
    const { q } = fixture(t);
    const a = q.enqueue('u:chat', input('sprite', 'anna'));
    const b = q.enqueue('u:chat', input('sprite', 'bob'));
    assert.equal(q.enqueue('u:chat', input('sprite', 'anna')).id, a.id);
    const changed = input('sprite', 'anna');
    changed.scene.characters[0].emotion = 'happy';
    q.enqueue('u:chat', changed);
    assert.equal(q.get('u:chat', a.id).status, 'cancelled');
    assert.equal(q.get('u:chat', b.id).status, 'queued');
});


test('uncertain submission survives automatic retry and restart; explicit retry is allowed', async t => {
    const {q,db}=fixture(t);let posts=0;
    q.api=async()=>{posts++;throw new Error('lost acknowledgement');};
    const first=q.enqueue('u:chat',input());await q.tick();
    const restarted=new VisualQueue({},db,{recipes:{layer:recipe}});t.after(()=>restarted.close());
    restarted.preflight=async()=>{};restarted.api=q.api;
    assert.equal(restarted.enqueue('u:chat',input()).id,first.id);
    await restarted.tick();assert.equal(posts,1);
    const retry=restarted.enqueue('u:chat',{...input(),retry:true});
    assert.notEqual(retry.id,first.id);await restarted.tick();assert.equal(posts,2);
});
test('cached and inflight selection cancel only obsolete queued tasks in their own slot', async t=>{
    const {q}=fixture(t);
    await complete(q,q.enqueue('u:chat',input()));
    const different=input();different.scene.location.name='garden';
    const stale=q.enqueue('u:chat',different);
    const sprite=q.enqueue('u:chat',input('sprite'));
    assert.equal(q.enqueue('u:chat',input()).reused,true);
    assert.equal(q.get('u:chat',stale.id).status,'cancelled');
    assert.equal(q.get('u:chat',sprite.id).status,'queued');
    const raw=q.get('u:chat',sprite.id,true);q.transition(raw,'running',{promptId:'active'});
    const changed=input('sprite');changed.scene.characters[0].emotion='happy';
    const obsolete=q.enqueue('u:chat',changed);
    assert.equal(q.enqueue('u:chat',input('sprite')).id,sprite.id);
    assert.equal(q.get('u:chat',obsolete.id).status,'cancelled');
});
test('lookup-only resumes existing work but never creates or cancels jobs', t=>{
    const {q}=fixture(t);
    assert.equal(q.enqueue('u:chat',{...input(),lookupOnly:true}).status,'cancelled');
    assert.equal(q.list('u:chat').length,0);
    const first=q.enqueue('u:chat',input());
    assert.equal(q.enqueue('u:chat',{...input(),lookupOnly:true}).id,first.id);
    assert.equal(q.list('u:chat').length,1);
});
