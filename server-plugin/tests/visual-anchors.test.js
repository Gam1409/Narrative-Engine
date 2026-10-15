const test = require('node:test');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const { Database } = require('../lib/database');
const { VisualQueue } = require('../lib/visual');
const {
    faceBox,
    preserveOutsideFace,
    detectedFace,
} = require('../lib/visual-anchors');
function image(color = 40) {
    const p = new PNG({ width: 96, height: 128 });
    for (let i = 0; i < p.data.length; i += 4)
        p.data.set([color, 50, 60, i === 0 ? 0 : 255], i);
    return PNG.sync.write(p);
}
function input() {
    return {
        requestKey: 'base',
        workflow: 'sprite_integrated',
        operation: 'sprite',
        characterId: 'A',
        resourceInput: 'a'.repeat(64),
        seed: 42,
        checkpoint: 'base.safetensors',
        promptProfile: 'anima',
        modelFiles: { textEncoder: 'clip.safetensors', vae: 'vae.safetensors' },
        scene: {
            sceneId: 'b'.repeat(64),
            location: {},
            characters: [
                {
                    id: 'A',
                    outfit: 'red dress',
                    pose: 'standing',
                    emotion: 'neutral',
                },
            ],
        },
    };
}
function setup(t) {
    const db = new Database({
        storageRoot: process.cwd(),
        databasePath: ':memory:',
    });
    const q = new VisualQueue({}, db);
    t.after(() => {
        q.close();
        db.close();
    });
    return q;
}
test('anchor edits preserve every outside RGBA byte and every alpha byte', () => {
    const a = image(40),
        b = image(200),
        face = { x: 24, y: 16, width: 32, height: 32 };
    const result = PNG.sync.read(preserveOutsideFace(a, b, face)),
        original = PNG.sync.read(a);
    let changes = 0;
    for (let y = 0; y < 128; y++)
        for (let x = 0; x < 96; x++) {
            const i = (y * 96 + x) * 4;
            assert.equal(result.data[i + 3], original.data[i + 3]);
            if (x < 24 || x >= 56 || y < 16 || y >= 48)
                assert.deepEqual(
                    result.data.subarray(i, i + 4),
                    original.data.subarray(i, i + 4),
                );
            else if (result.data[i] !== original.data[i]) changes++;
        }
    assert.ok(changes > 0);
    assert.throws(
        () => faceBox({ x: 0, y: 0, width: 96, height: 128 }, 96, 128),
        /35%/,
    );
});
test('compatible emotion uses anchor, wardrobe/pose changes and other scopes cannot', (t) => {
    const q = setup(t),
        base = input(),
        job = q.enqueue('u:chat', base),
        raw = q.get('u:chat', job.id, true);
    const asset = q.assets.put(raw, image());
    const anchor = q.anchors.pin('u:chat', asset.id, {
        x: 24,
        y: 16,
        width: 32,
        height: 32,
    });
    const next = {
        ...base,
        localExpressions: true,
        requestKey: 'smile',
        scene: {
            ...base.scene,
            characters: [{ ...base.scene.characters[0], emotion: 'happy' }],
        },
    };
    const result = q.enqueue('u:chat', next);
    assert.equal(result.expressionAnchor.id, anchor.id);
    const graph = q.get('u:chat', result.id, true).graph;
    assert.equal(
        Object.values(graph).filter((n) => n.class_type === 'LoadImage').length,
        1,
    );
    assert.equal(
        Object.values(graph).filter((n) => n.class_type === 'EmptyLatentImage')
            .length,
        0,
    );
    for (const [key, value] of [
        ['outfit', 'blue dress'],
        ['pose', 'sitting'],
    ]) {
        const changed = q.enqueue('u:chat', {
            ...next,
            requestKey: key,
            scene: {
                ...next.scene,
                characters: [{ ...next.scene.characters[0], [key]: value }],
            },
        });
        assert.equal(changed.expressionAnchor, null);
    }
    assert.throws(
        () => q.anchors.pin('other:chat', asset.id, anchor.face),
        /not found/,
    );
    const other = q.enqueue('other:chat', next);
    assert.equal(other.expressionAnchor, null);
    const forged = q.enqueue('u:chat', {
        ...base,
        requestKey: 'forged',
        expressionAnchor: { filename: 'evil.png' },
    });
    assert.equal(forged.expressionAnchor, undefined);
});
test('automatic detection graph is opt-in and expression variants skip detection', (t) => {
    const q = setup(t),
        job = q.enqueue('u:chat', {
            ...input(),
            localExpressions: true,
            faceDetector: 'detector.safetensors',
        });
    assert.equal(job.autoAnchor, true);
    const graph = q.get('u:chat', job.id, true).graph;
    assert.equal(graph['902'].class_type, 'SaveImage');
    assert.ok(
        Object.values(graph).some(
            (n) =>
                n.class_type === 'MediaPipeFaceLandmarker' &&
                n.inputs.num_faces === 2,
        ),
    );
});
test('detected mask requires exactly one substantial connected face', () => {
    const png = new PNG({ width: 96, height: 128 });
    png.data.fill(0);
    const rectangle = (x0, y0) => {
        for (let y = y0; y < y0 + 20; y++)
            for (let x = x0; x < x0 + 20; x++)
                png.data.set([255, 255, 255, 255], (y * 96 + x) * 4);
    };
    assert.throws(
        () => detectedFace(PNG.sync.write(png), 96, 128),
        /not detected/,
    );
    rectangle(20, 20);
    assert.deepEqual(detectedFace(PNG.sync.write(png), 96, 128), {
        x: 20,
        y: 20,
        width: 20,
        height: 20,
    });
    rectangle(60, 70);
    assert.throws(() => detectedFace(PNG.sync.write(png), 96, 128), /Multiple/);
});

test('anime detector selects optional node; no detector is silently substituted', (t) => {
    const q = setup(t),
        job = q.enqueue('u:chat', {
            ...input(),
            localExpressions: true,
            faceDetector: 'lbpcascade_animeface.xml',
        });
    const nodes = Object.values(q.get('u:chat', job.id, true).graph);
    assert.ok(nodes.some((n) => n.class_type === 'NEAnimeFaceMask'));
    assert.ok(!nodes.some((n) => n.class_type === 'MediaPipeFaceLandmarker'));
});

test('anchor upload uses checked dynamic endpoint and does not leak configured credentials', async (t) => {
    const q = setup(t),
        base = input(),
        job = q.enqueue('u:chat', base);
    const asset = q.assets.put(q.get('u:chat', job.id, true), image());
    const anchor = q.anchors.pin('u:chat', asset.id, {
        x: 24,
        y: 16,
        width: 32,
        height: 32,
    });
    q.config.comfyUrl = 'https://old.example';
    q.config.comfyKey = 'secret';
    q.validate = async (url) => ({ url, addresses: new Set(['127.0.0.1']) });
    q.request = async (url, options, bytes) => {
        assert.equal(url.href, 'https://new.example/comfy/upload/image');
        assert.equal(options.headers.authorization, undefined);
        assert.ok(Buffer.isBuffer(bytes));
        assert.ok(bytes.includes(Buffer.from(anchor.filename)));
        return { name: anchor.filename, subfolder: '' };
    };
    await q.uploadAnchor({
        scope: 'u:chat',
        endpoint: 'https://new.example/comfy',
        expressionAnchor: anchor,
    });
});


test('returning to the anchor expression reuses its original PNG without GPU work',t=>{
 const q=setup(t),base=input(),job=q.enqueue('u:chat',base);
 const asset=q.assets.put(q.get('u:chat',job.id,true),image());
 q.anchors.pin('u:chat',asset.id,{x:24,y:16,width:32,height:32});
 const reused=q.enqueue('u:chat',{...base,localExpressions:true,requestKey:'return-neutral'});
 assert.equal(reused.status,'done');assert.equal(reused.reused,true);assert.equal(reused.asset.id,asset.id);
});


test('prompt overrides and Anima variant changes cannot reuse an incompatible face anchor', t => {
    const q=setup(t), base=input(), job=q.enqueue('u:chat',base);
    const asset=q.assets.put(q.get('u:chat',job.id,true),image());
    q.anchors.pin('u:chat',asset.id,{x:24,y:16,width:32,height:32});
    for (const [index, changes] of [
        {userPositive:'watercolor style'}, {userNegative:'flat shading'}, {animaVariant:'turbo'},
    ].entries()) {
        const changed=q.enqueue('u:chat',{
            ...base,...changes,localExpressions:true,requestKey:'changed-anchor-'+index,
        });
        assert.equal(changed.status,'queued',changed.error);
        assert.equal(changed.expressionAnchor,null);
        assert.equal(changed.reused,undefined);
        const nodes=Object.values(q.get('u:chat',changed.id,true).graph);
        assert.ok(nodes.some(n=>n.class_type==='EmptyLatentImage'));
        assert.ok(!nodes.some(n=>n.class_type==='LoadImage'));
    }
    const unchanged=q.enqueue('u:chat',{
        ...base,animaVariant:'base',userPositive:'',userNegative:'',
        localExpressions:true,requestKey:'unchanged-anchor',
    });
    assert.equal(unchanged.status,'done');
    assert.equal(unchanged.asset.id,asset.id);
});
