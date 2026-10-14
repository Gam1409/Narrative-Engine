import test from 'node:test';
import assert from 'node:assert/strict';
import {planCompositeLayout,compositeSources} from '../src/visual/layout.js';
const input={width:1200,height:800,characters:[{id:'a',width:400,height:1000}]};
test('layout centers one character, preserves aspect and uses deterministic left/right order',()=>{
 const one=planCompositeLayout(input);assert.equal(one.slots[0].x+one.slots[0].width/2,600);assert.equal(one.slots[0].height,760);
 const two=planCompositeLayout({...input,characters:[...input.characters,{id:'b',width:500,height:1000}]});
 assert.ok(two.slots[0].x<two.slots[1].x);assert.deepEqual(two,planCompositeLayout({...input,characters:[...input.characters,{id:'b',width:500,height:1000}]}));
});
test('framing changes rectangles without stretching and rejects unsupported casts',()=>{
 const wide=planCompositeLayout({...input,camera:'wide shot, eye level'}),medium=planCompositeLayout({...input,camera:'medium shot, eye level'});
 assert.ok(wide.slots[0].height<medium.slots[0].height);assert.equal(medium.slots[0].y,0);
 assert.throws(()=>planCompositeLayout({...input,characters:[input.characters[0],input.characters[0]]}),/unique/);
 assert.throws(()=>planCompositeLayout({...input,characters:[{id:'a'},{id:'b'},{id:'c'}]}),/two/);
 assert.throws(()=>planCompositeLayout({...input,width:9000}),/dimensions/);
 assert.throws(()=>planCompositeLayout({...input,camera:'arbitrary'}),/framing/);
});
test('composite rejects stale wardrobe, missing sprites and changed canon instead of using substitutes',()=>{
 const scene={sceneId:'s',canonVersion:1,characters:[{id:'a'}]};const plans=[{slot:'background',layerKey:'bg'},{slot:'sprite:a',layerKey:'new-clothes'}];
 const composition={sceneId:'s',canonVersion:1,layers:plans.map(p=>({...p,status:'done',assetId:p.slot}))};
 assert.equal(compositeSources(scene,plans,composition).length,2);
 const old=structuredClone(composition);old.layers[1].layerKey='old-clothes';assert.throws(()=>compositeSources(scene,plans,old),/not ready/);
 assert.throws(()=>compositeSources({...scene,canonVersion:2},plans,composition),/not ready/);
 assert.throws(()=>compositeSources(scene,plans.slice(0,1),composition),/not ready/);
});
