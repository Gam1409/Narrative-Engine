// Local synthetic browser fixture. No SillyTavern cards, models or GPU are accessed.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { Database } = require('../lib/database');
const { VisualQueue } = require('../lib/visual');
const root = path.resolve(__dirname, '../..');
const db = new Database({ storageRoot: require('node:os').tmpdir(), databasePath: ':memory:' });
const recipe = {
    operation: 'sprite',
    outputNode: '1',
    version: 1,
    workflow: { 1: { class_type: 'SaveImage', inputs: { text: '' } } },
    bindings: [{ node: '1', input: 'text', source: 'positive' }],
};
const q = new VisualQueue({}, db, { recipes: { background: recipe, sprite: recipe } });
q.preflight = async () => {};
let posts = 0;
const remote = new Map();
q.api = async (route, body) => {
    if (route === '/prompt') {
        const id = String(++posts);
        remote.set(id, body.prompt['1'].inputs.text);
        return { prompt_id: id };
    }
    if (route.startsWith('/history/')) {
        const id = route.split('/').at(-1);
        return {
            [id]: {
                status: { completed: true },
                outputs: { 1: { images: [{ filename: id + '.png', type: 'output' }] } },
            },
        };
    }
    if (route.startsWith('/view?')) {
        const id = new URL(route, 'http://local').searchParams.get('filename').split('.')[0];
        const text = remote.get(id) || '';
        const sprite = text.includes('single character');
        const image = new PNG({ width: 320, height: 220 });
        for (let y = 0; y < 220; y++)
            for (let x = 0; x < 320; x++) {
                const i = (y * 320 + x) * 4;
                const visible = !sprite || (x > 110 && x < 210 && y > 20);
                image.data.set(
                    [sprite ? 180 : 35, text.includes('torn') ? 30 : 100, sprite ? 80 : 140, visible ? 255 : 0],
                    i,
                );
            }
        return { bytes: PNG.sync.write(image), contentType: 'image/png' };
    }
    throw new Error('Unexpected fixture route');
};
const html = `<!doctype html><meta charset="utf-8"><title>Visual layers synthetic smoke test</title><link rel="stylesheet" href="/style.css">
<style>body{font:16px sans-serif;background:#20242c;color:#eee;padding:24px}button{padding:12px;margin:4px}dialog{color:#eee;background:#20242c}</style>
<h1>Visual layers · synthetic fixture</h1><p>No real GPU or SillyTavern data.</p>
<button id="build">Build layers</button><button id="view">View scene</button><button id="emotion">Change emotion</button><button id="damage">Tear clothing</button><button id="move">Change room</button><pre id="result"></pre>
<script type="module">
import {VisualDirector} from '/src/visual/director.js';
import {showVisualStage} from '/src/ui/visualStage.js';
import {createInitialState} from '/src/state/model.js';
const state=createInitialState({scene:{location:'room',present:['Anna']},characters:{Anna:{clothing:{costume:'ruffled dress',condition:'clean'},expression:'neutral'}}});
const context={chatId:'smoke',characterId:0,characters:[{name:'Anna',avatar:'anna.png'}],chatMetadata:{},saveMetadata:async()=>{}};
globalThis.SillyTavern={getContext:()=>context};
const runtime={stateManager:{prefix:'smoke',state,pending:[],deltas:[],canonVersion:1,visualProfiles:{},snapshot:()=>structuredClone(state)},
settings:{visualEnabled:true,visualLayers:true,visualSpriteWorkflow:'sprite',visualBackgroundWorkflow:'background'},participants:[{name:'Anna'}],diagnostics:{error:console.error}};
runtime.visualDirector=new VisualDirector(runtime);
globalThis.smoke={runtime,context,state};
const build=async()=>{const result=await runtime.visualDirector.request({layers:true});document.getElementById('result').textContent=JSON.stringify(result,null,2);};
document.getElementById('build').onclick=build;
document.getElementById('view').onclick=()=>showVisualStage(runtime);
document.getElementById('emotion').onclick=()=>{state.characters.Anna.expression='happy';build();};
document.getElementById('damage').onclick=()=>{state.characters.Anna.clothing.condition='torn';build();};
document.getElementById('move').onclick=()=>{state.scene.location='garden';build();};
</script>`;
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://local');
        if (url.pathname === '/') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.end(html);
        }
        if (url.pathname === '/smoke-stats') {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ posts, assets: q.assets.list('smoke').length }));
        }
        const prefix = '/api/plugins/narrative-engine/visual/';
        if (url.pathname.startsWith(prefix)) {
            const parts = url.pathname.slice(prefix.length).split('/');
            if (parts[0] === 'asset') {
                res.setHeader('Content-Type', 'image/png');
                return res.end(q.assets.image('smoke', parts[2]).bytes);
            }
            let result;
            if (req.method === 'POST') {
                let body = '';
                for await (const chunk of req) {
                    body += chunk;
                    if (body.length > 200000) throw new Error('Too large');
                }
                const parsed = JSON.parse(body);
                result =
                    parts[0] === 'status' ? parsed.ids.map((id) => q.get('smoke', id)) : q.enqueue('smoke', parsed);
            } else result = parts[2] ? q.get('smoke', parts[2]) : q.list('smoke');
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(result));
        }
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
        res.setHeader(
            'Content-Type',
            file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/plain',
        );
        res.end(fs.readFileSync(file));
    } catch (error) {
        res.statusCode = error.status || 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error.message }));
    }
});
q.start();
server.listen(8847, '127.0.0.1', () => console.log('Synthetic visual layers: http://127.0.0.1:8847'));
process.on('SIGINT', () => {
    q.close();
    db.close();
    server.close();
    process.exit(0);
});
