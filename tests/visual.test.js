import test from 'node:test';
import assert from 'node:assert/strict';
import { describeScene, visualProfile } from '../src/visual/scene.js';
import { VisualDirector } from '../src/visual/director.js';
import { createInitialState } from '../src/state/model.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';

const state = () =>
    createInitialState({
        scene: { location: 'cafe', present: ['Anna'], weather: 'rain', lighting: 'warm' },
        characters: { Anna: { clothing: { costume: 'casual' }, pose: 'sitting', expression: 'neutral' } },
        simulation: { characters: { Anna: { expressedVsFelt: { expressed: ['smile'], felt: ['fear'] } } } },
    });
const participants = [{ name: 'Anna' }];
test('visual descriptor derives physical scene and excludes hidden feelings without mutating canon', async () => {
    const s = state(),
        before = structuredClone(s),
        scene = await describeScene(s, participants);
    assert.equal(scene.characters[0].outfit, 'casual');
    assert.equal(scene.characters[0].emotion, 'neutral');
    assert.doesNotMatch(JSON.stringify(scene), /fear/);
    assert.deepEqual(s, before);
    assert.deepEqual((await describeScene(s, participants, {}, scene)).changesSincePrevious, []);
    s.characters.Anna.clothing.costume = 'formal';
    assert.notEqual((await describeScene(s, participants)).sceneId, scene.sceneId);
});
test('visual profiles validate references and remain bound to entity IDs', () => {
    const profile = visualProfile({
        entityId: 'Anna',
        appearance: 'dark hair',
        references: ['anna.png'],
        lora: [{ name: 'Anna.safetensors', weight: 0.8 }],
        compatibleWorkflows: ['scene_full'],
    });
    assert.equal(profile.entityId, 'Anna');
    assert.throws(() => visualProfile({ entityId: '__proto__' }), /Invalid/);
    assert.throws(() => visualProfile({ ...profile, lora: [null] }), /LoRA/);
    assert.throws(() => visualProfile({ ...profile, references: ['https://host/a.png'] }), /asset/);
    assert.throws(() => visualProfile({ ...profile, lora: [{ name: 'x', weight: 99 }] }), /LoRA/);
});

function fixture(t, fetchImpl) {
    const old = globalThis.SillyTavern;
    const context = {
        chatId: 'one',
        characterId: 0,
        characters: [{ name: 'Anna', avatar: 'Anna.png' }],
        chatMetadata: {},
        saveMetadata: async () => {},
    };
    globalThis.SillyTavern = { getContext: () => context };
    t.after(() => (globalThis.SillyTavern = old));
    const s = state();
    const runtime = {
        stateManager: {
            prefix: 'narrative-engine:ne-one',
            chatFingerprint: 'ne-one',
            pending: [],
            deltas: [],
            snapshot: () => structuredClone(s),
        },
        storage: new MemoryStorageAdapter(),
        participants,
        spriteManifests: {},
        settings: { visualEnabled: true, visualWorkflow: 'scene_full', visualKeepSeed: true, visualStages: {} },
        diagnostics: { error: () => {} },
    };
    const director = new VisualDirector(runtime, { fetchImpl });
    t.after(() => director.close());
    return { director, runtime, context, s };
}
test('G16 illustration request and completion attach scene metadata without a state delta', async (t) => {
    let submitted;
    const { director, runtime, context, s } = fixture(t, async (_url, opts) => {
        if (opts.method === 'GET') return { ok: true, json: async () => [] };
        submitted = JSON.parse(opts.body);
        return {
            ok: true,
            json: async () => ({ id: 'job', status: 'done', scene: submitted.scene, outputs: [{ filename: 'a.png' }] }),
        };
    });
    const before = structuredClone(s);
    const job = await director.request();
    await director.follow(job, context, submitted.chatId, runtime.stateManager);
    assert.deepEqual(s, before);
    assert.equal(runtime.stateManager.deltas.length, 0);
    assert.ok(context.chatMetadata.narrative_engine_visual.images[0].includes('/visual/image/'));
});
test('G17 visual submission error never writes to the canonical manager', async (t) => {
    const { director, runtime, s } = fixture(t, async () => {
        throw new Error('offline');
    });
    const before = structuredClone(s);
    await assert.rejects(director.request(), /offline/);
    assert.deepEqual(s, before);
    assert.equal(runtime.stateManager.deltas.length, 0);
});
test('deleted/swiped origin or changed scene makes a visual result stale', async (t) => {
    const { director, runtime, s } = fixture(t, async () => {});
    const scene = await director.scene();
    const job = { scene: { ...scene, messageRef: { idempotencyKey: 'old' } } };
    assert.equal(director.matches(job, scene), false);
    runtime.stateManager.deltas = [{ idempotencyKey: 'old' }];
    assert.equal(director.matches(job, scene), true);
    s.scene.weather = 'snow';
    assert.equal(director.matches(job, await director.scene()), false);
});
test('automatic generation deduplicates an unchanged scene; manual requests still work', async (t) => {
    let history = [],
        posts = 0;
    const { director } = fixture(t, async (_url, options) => {
        if (options.method === 'GET') return { ok: true, json: async () => history };
        posts++;
        const body = JSON.parse(options.body);
        const job = { id: 'job', status: 'failed_final', scene: body.scene, outputs: [] };
        history = [job];
        return { ok: true, json: async () => job };
    });
    await director.request({ automatic: true });
    await director.request({ automatic: true });
    assert.equal(posts, 1);
    await director.request();
    assert.equal(posts, 2);
});

test('wardrobe damage changes sprite and scene identity while the background stays stable', async () => {
    const s = state();
    s.entities.dress = {
        id: 'dress',
        name: 'Ruffled dress with buttons',
        status: 'active',
        type: 'clothing',
        params: { color: 'blue', condition: 'clean', secret: 'hidden memory' },
        position: { rel: 'wears', target: 'Anna' },
    };
    const first = await describeScene(s, participants);
    s.entities.dress.params.condition = 'torn';
    const second = await describeScene(s, participants);
    assert.notEqual(first.sceneId, second.sceneId);
    assert.notEqual(first.spriteIds.Anna, second.spriteIds.Anna);
    assert.equal(first.backgroundId, second.backgroundId);
    assert.equal(second.characters[0].wardrobe[0].properties.condition, 'torn');
    assert.doesNotMatch(JSON.stringify(second), /hidden memory/);
    s.characters.Anna.expression = 'happy';
    assert.equal((await describeScene(s, participants)).backgroundId, first.backgroundId);
});

test('unchanged physical scene is independent of entity insertion order and private parameters', async () => {
    const s = state();
    const item = (id) => ({
        id,
        name: id,
        type: 'item',
        status: 'active',
        position: { rel: 'on', target: 'cafe' },
        params: {},
    });
    s.entities = { a: item('a'), b: item('b') };
    const before = await describeScene(s, participants);
    s.entities = { b: item('b'), a: item('a') };
    s.entities.a.params.privatePlan = 'something else';
    assert.equal((await describeScene(s, participants)).sceneId, before.sceneId);
});

test('stale and failed completion preserve the last valid image metadata', async (t) => {
    const { director, runtime, context, s } = fixture(t, async () => {});
    const fingerprint = (await import('../src/context/stContext.js')).getChatFingerprint(context);
    const scene = await director.scene();
    const valid = { id: 'last-good', images: ['good.png'] };
    context.chatMetadata.narrative_engine_visual = valid;
    s.scene.weather = 'snow';
    await director.follow(
        { id: 'late', status: 'done', scene, outputs: [{ filename: 'old.png' }] },
        context,
        fingerprint,
        runtime.stateManager,
    );
    assert.equal(context.chatMetadata.narrative_engine_visual, valid);
    await director.follow(
        { id: 'failure', status: 'failed_final', scene: await director.scene(), outputs: [] },
        context,
        fingerprint,
        runtime.stateManager,
    );
    assert.equal(context.chatMetadata.narrative_engine_visual, valid);
});

test('older selection and changed checkpoint cannot publish a matching scene', async (t) => {
    const { director, runtime, context } = fixture(t, async () => {});
    const fingerprint = (await import('../src/context/stContext.js')).getChatFingerprint(context);
    const scene = await director.scene();
    context.chatMetadata.narrative_engine_visual_selection = 'new';
    const job = { id: 'old', status: 'done', scene, outputs: [{ filename: 'old.png' }], selectionId: 'old' };
    await director.follow(job, context, fingerprint, runtime.stateManager);
    assert.equal(context.chatMetadata.narrative_engine_visual, undefined);
    job.selectionId = 'new';
    job.workflow = 'scene_full';
    job.generationKey = await director.generationKey(scene, job.workflow, runtime.settings);
    runtime.settings.visualPromptProfile = 'pony';
    await director.follow(job, context, fingerprint, runtime.stateManager);
    assert.equal(context.chatMetadata.narrative_engine_visual, undefined);
});

test('simultaneous automatic calls create one job and workflow changes invalidate deduplication', async (t) => {
    const history = [];
    let posts = 0;
    const { director, runtime } = fixture(t, async (_url, options) => {
        if (options.method === 'GET') return { ok: true, json: async () => history };
        posts++;
        const body = JSON.parse(options.body);
        const job = { ...body, id: String(posts), status: 'done', outputs: [{ filename: 'one.png' }] };
        history.unshift(job);
        return { ok: true, json: async () => job };
    });
    runtime.settings.visualCooldownMs = 0;
    await Promise.all([director.request({ automatic: true }), director.request({ automatic: true })]);
    assert.equal(posts, 1);
    runtime.settings.visualWorkflow = 'another';
    await director.request({ automatic: true });
    assert.equal(posts, 2);
});

test('pending reconciliation and reverted origin cannot publish a matching scene', async (t) => {
    const { director, runtime } = fixture(t, async () => {});
    const scene = await director.scene();
    const job = { scene: { ...scene, messageRef: { idempotencyKey: 'origin' } } };
    runtime.stateManager.deltas = [{ idempotencyKey: 'origin', deltaId: 'record' }];
    runtime.stateManager.records = [{ deltaId: 'record' }];
    runtime.stateManager.decisions = [{ deltaId: 'record', status: 'reverted' }];
    assert.equal(director.matches(job, scene), false);
    runtime.stateManager.decisions.push({ deltaId: 'record', status: 'confirmed' });
    assert.equal(director.matches(job, scene), true);
    runtime.stateManager.pending.push({ id: 'pending' });
    assert.equal(director.matches(job, scene), false);
});

test('layer planner reuses room on emotion/damage changes and isolates each identity', async () => {
    const { planLayers } = await import('../src/visual/layers.js');
    const s = state();
    const settings = { visualSpriteWorkflow: 'sprite', visualCheckpoint: 'model.safetensors' };
    const first = await planLayers(await describeScene(s, participants), settings);
    s.characters.Anna.expression = 'happy';
    const second = await planLayers(await describeScene(s, participants), settings);
    assert.equal(first[0].layerKey, second[0].layerKey);
    assert.equal(first[0].seed, second[0].seed);
    assert.notEqual(first[1].layerKey, second[1].layerKey);
    assert.equal(second[0].scene.characters.length, 0);
    assert.deepEqual(second[1].scene.location, {});
    s.characters.Anna.clothing.condition = 'torn';
    const third = await planLayers(await describeScene(s, participants), settings);
    assert.equal(second[0].layerKey, third[0].layerKey);
    assert.notEqual(second[1].layerKey, third[1].layerKey);
    assert.equal(third[1].scene.characters[0].clothing.condition, 'torn');
    const moved = await planLayers(await describeScene(s, participants), {
        ...settings,
        visualEndpoint: 'https://changed.example',
    });
    assert.deepEqual(
        moved.map((p) => p.layerKey),
        third.map((p) => p.layerKey),
    );
});

test('layer completion cannot overwrite a newer scene or show an old costume on failure', async (t) => {
    const { director, runtime, context, s } = fixture(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        return {
            ok: true,
            json: async () => ({
                id: crypto.randomUUID(),
                status: 'done',
                asset: { id: crypto.randomUUID() },
                outputs: [{}],
                scene: body.scene,
            }),
        };
    });
    runtime.settings.visualSpriteWorkflow = 'sprite';
    const callbacks = [];
    director.followLayers = async (jobs, publish, current) => {
        callbacks.push({ jobs, publish, current });
    };
    await director.request({ layers: true });
    assert.equal(context.chatMetadata.narrative_engine_layers.layers.length, 2);
    const old = callbacks[0];
    s.characters.Anna.clothing.condition = 'torn';
    await director.request({ layers: true });
    const latest = context.chatMetadata.narrative_engine_layers;
    assert.equal(await old.publish(), false);
    assert.equal(context.chatMetadata.narrative_engine_layers, latest);
    const next = callbacks[1];
    next.jobs[1] = { status: 'failed_final', error: 'bad alpha' };
    await next.publish();
    const composition = context.chatMetadata.narrative_engine_layers;
    assert.ok(composition.layers[0].url);
    assert.equal(composition.layers[1].url, null);
    assert.equal(composition.layers[1].error, 'bad alpha');
    runtime.stateManager.pending.push({});
    assert.equal(await next.publish(), false);
});

test('native fetch receives the browser global rather than the director instance', async (t) => {
    let receiver;
    const { director } = fixture(t, function () {
        receiver = this;
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    await director.capabilities();
    assert.equal(receiver, globalThis);
});


test('resume selects lookup-only when automatic generation is disabled',async()=>{
    const director=new VisualDirector({settings:{visualEnabled:true,visualLayers:true,visualAutomatic:false}});
    director.request=async options=>options;
    assert.deepEqual(await director.resume(),{layers:true,automatic:false,resumeOnly:true});
    director.runtime.settings.visualAutomatic=true;
    assert.deepEqual(await director.resume(),{layers:true,automatic:true,resumeOnly:false});
    director.close();
});


test('camera/style invalidate relevant layers while expression changes keep sampling seed', async () => {
    const { planLayers } = await import('../src/visual/layers.js');
    const scene = await describeScene(state(), participants);
    const settings = { visualBackgroundWorkflow: 'background_integrated', visualSpriteWorkflow: 'sprite_integrated' };
    const before = await planLayers(scene, settings);
    const camera = await planLayers(scene, { ...settings, visualCamera: 'profile portrait' });
    assert.equal(before[0].layerKey, camera[0].layerKey);
    assert.notEqual(before[1].layerKey, camera[1].layerKey);
    const style = await planLayers(scene, { ...settings, visualStyle: 'watercolor' });
    assert.notEqual(before[0].layerKey, style[0].layerKey);
    const changed = state(); changed.characters.Anna.expression = 'smile';
    const emotion = await planLayers(await describeScene(changed, participants), settings);
    assert.notEqual(before[1].layerKey, emotion[1].layerKey);
    assert.equal(before[1].seed, emotion[1].seed);
});


test('significant illustrations skip expressions but include wardrobe and allow manual shots', async (t) => {
    let history = [], posts = 0;
    const { director, runtime, s } = fixture(t, async (_url, options) => {
        if (options.method === 'GET') return { ok: true, json: async () => history };
        posts++;
        const body = JSON.parse(options.body);
        const job = { ...body, id: String(posts), status: 'failed_final', outputs: [] };
        history.unshift(job);
        return { ok: true, json: async () => job };
    });
    runtime.settings.visualIllustrationPolicy = 'significant';
    runtime.settings.visualCooldownMs = 0;
    await director.request({ automatic: true });
    s.characters.Anna.expression = 'happy';
    s.characters.Anna.pose = 'standing';
    assert.match((await director.request({ automatic: true })).skipped, /significant/);
    assert.equal(posts, 1);
    s.characters.Anna.clothing.costume = 'evening dress';
    await director.request({ automatic: true });
    assert.equal(posts, 2);
    runtime.settings.visualStyle = 'watercolor';
    await director.request({ automatic: true });
    assert.equal(posts, 3);
    await director.request();
    assert.equal(posts, 4);
    runtime.settings.visualIllustrationPolicy = 'manual';
    await director.request({ automatic: true });
    assert.equal(posts, 4);
});

test('illustration request returns while GPU job is still running', async (t) => {
    const { director } = fixture(t, async (_url, options) => ({
        ok: true,
        json: async () => options.method === 'GET' ? [] : {
            ...JSON.parse(options.body), id: 'slow-gpu', status: 'running', outputs: [],
        },
    }));
    const job = await director.request();
    assert.equal(job.status, 'running');
    assert.equal(director.waiters.size, 1);
});


test('local expression policy changes sprite plans without invalidating background', async () => {
    const {planLayers}=await import('../src/visual/layers.js');
    const scene=await describeScene(state(),participants);
    const settings={visualSpriteWorkflow:'sprite_integrated'};
    const before=await planLayers(scene,settings);
    const after=await planLayers(scene,{...settings,visualLocalExpressions:true,visualFaceDetector:'lbpcascade_animeface.xml'});
    assert.equal(before[0].layerKey,after[0].layerKey);
    assert.notEqual(before[1].layerKey,after[1].layerKey);
    assert.equal(after[1].localExpressions,true);
    assert.equal(after[1].faceDetector,'lbpcascade_animeface.xml');
});

test('enabled visual direction reaches illustration composition and stale canon blocks submission', async (t) => {
    let posts = 0, calls = 0;
    const { director, runtime, s } = fixture(t, async (_url, options) => {
        if (options.method === 'GET') return { ok: true, json: async () => [] };
        posts++;
        const body=JSON.parse(options.body);
        assert.equal(body.composition.camera, 'medium shot, eye level');
        return {ok:true,json:async()=>({...body,status:'failed_final'})};
    });
    runtime.settings.visualLlmIntent=true;
    runtime.provider={complete:async()=>{calls++;return {content:JSON.stringify({camera:'medium shot, eye level',characters:[{id:'Anna',eyes:'preserve',brows:'preserve',mouth:'small smile',cheeks:'preserve'}]})};}};
    await director.request();assert.equal(posts,1);assert.equal(calls,1);
    const old=await director.scene();s.characters.Anna.clothing.costume='changed';
    assert.equal(director.matches({scene:old},await director.scene()),false);
    assert.equal(calls,2);
});
