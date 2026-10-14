import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkflowFile,validateUserRecipe,saveUserWorkflow,selectedRecipe} from '../src/visual/workflows.js';
import {normalizeSettings} from '../src/settings.js';
import {VisualDirector} from '../src/visual/director.js';
import {planLayers} from '../src/visual/layers.js';
const recipe=()=>({operation:'illustration',version:1,outputNode:'1',workflow:{1:{class_type:'SaveImage',inputs:{text:'',seed:0}}},bindings:[{node:'1',input:'text',source:'positive'}]});
test('API import and recipe import are distinct; editor JSON and ambiguous bindings are rejected',()=>{
 assert.deepEqual(readWorkflowFile(JSON.stringify(recipe().workflow)).graph,recipe().workflow);
 assert.equal(readWorkflowFile(JSON.stringify(recipe())).recipe.operation,'illustration');
 assert.throws(()=>readWorkflowFile('{'),/JSON/);
 assert.throws(()=>readWorkflowFile('{"nodes":[]}'),/API format/);
 const r=recipe();r.bindings.push({node:'1',input:'text',source:'negative'});
 assert.throws(()=>validateUserRecipe(r),/one binding/);
 assert.throws(()=>validateUserRecipe({...recipe(),outputNode:'absent'}),/output node/);
});
test('imported recipes survive settings normalization and never alias caller data',()=>{
 const r=recipe();const rows=saveUserWorkflow({}, {id:'user-demo',name:'Demo',recipe:r});
 r.workflow['1'].inputs.text='mutated';assert.equal(rows[0].recipe.workflow['1'].inputs.text,'');
 const settings=normalizeSettings({visualUserWorkflows:rows,visualWorkflow:'user-demo'});
 assert.deepEqual(selectedRecipe(settings,'user-demo'),rows[0].recipe);
 assert.throws(()=>selectedRecipe(settings,'user-missing'),/missing/);
 assert.equal(selectedRecipe(settings,'scene_full'),null);
 assert.throws(()=>saveUserWorkflow({}, {id:'scene_full',recipe:recipe()}),/ID/);
});
test('edited imported graph invalidates illustration and layer identity',async()=>{
 const a={visualUserWorkflows:[{id:'user-demo',name:'Demo',recipe:recipe()}],visualWorkflow:'user-demo',visualBackgroundWorkflow:'user-demo'};
 const b=structuredClone(a);b.visualUserWorkflows[0].recipe.workflow['1'].inputs.seed=23;
 const scene={sceneId:'scene',backgroundId:'bg',location:{},keyObjects:[],characters:[],spriteIds:{}};
 assert.notEqual(await VisualDirector.prototype.generationKey(scene,'user-demo',a),await VisualDirector.prototype.generationKey(scene,'user-demo',b));
 const [pa]=await planLayers(scene,a),[pb]=await planLayers(scene,b);
 assert.notEqual(pa.layerKey,pb.layerKey);assert.deepEqual(pa.customRecipe,a.visualUserWorkflows[0].recipe);
});

test('prompt templates require explicit supported scene chips',()=>{
 const r=recipe();r.bindings[0].template='{{positive}}\n{{userPositive}}\nsoft light';assert.equal(validateUserRecipe(r).bindings[0].template,r.bindings[0].template);
 r.bindings[0].template='{{positive}} {{unknown}}';assert.throws(()=>validateUserRecipe(r),/chips/);
 r.bindings[0].template='{{positive}} {{userPositive';assert.throws(()=>validateUserRecipe(r),/Unclosed/);
});
