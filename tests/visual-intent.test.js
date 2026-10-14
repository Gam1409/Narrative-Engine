import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualIntentPlanner, validateIntent, applyIntent, parseIntent, intentRequest } from '../src/visual/intent.js';
const scene = () => ({sceneId:'scene',backgroundId:'background',spriteIds:{a:'sprite'},canonVersion:1,messageRef:{id:'first'},location:{id:'room'},characters:[{id:'a',emotion:'smile',outfit:'blue dress',pose:'standing',profile:{lora:[{name:'a.safetensors'}]}}]});
const intent = () => ({camera:'medium shot, eye level',characters:[{id:'a',eyes:'preserve',brows:'preserve',mouth:'small smile',cheeks:'preserve'}]});
test('visual intent rejects invented fields, cast and unbounded facial text', () => {
    assert.throws(()=>validateIntent({...intent(),outfit:'red'},scene()));
    const wrong=intent();wrong.characters[0].eyes='holding a knife';assert.throws(()=>validateIntent(wrong,scene()));
    const cast=intent();cast.characters[0].id='b';assert.throws(()=>validateIntent(cast,scene()));
    const absent=scene();absent.characters[0].emotion='';assert.throws(()=>validateIntent(intent(),absent));
});
test('visual intent preserves wardrobe, pose, LoRA and background while invalidating sprite',async()=>{
    const source=scene(),copy=structuredClone(source),out=await applyIntent(source,intent());
    assert.deepEqual(source,copy);assert.equal(out.backgroundId,source.backgroundId);
    for(const k of ['outfit','pose','profile'])assert.deepEqual(out.characters[0][k],source.characters[0][k]);
    assert.notEqual(out.spriteIds.a,source.spriteIds.a);assert.notEqual(out.sceneId,source.sceneId);
});
test('visual planner coalesces calls but uses fresh canon provenance and isolates scope/provider',async()=>{
    let calls=0;const provider={complete:async()=>{calls++;return {content:JSON.stringify(intent())};}};
    const planner=new VisualIntentPlanner(),a=scene(),b={...scene(),canonVersion:2,messageRef:{id:'second'}};
    const [first,second]=await Promise.all([planner.prepare(a,provider,'sdxl','chat'),planner.prepare(b,provider,'sdxl','chat')]);
    assert.equal(calls,1);assert.equal(first.canonVersion,1);assert.equal(second.canonVersion,2);assert.equal(second.messageRef.id,'second');
    await planner.prepare(a,provider,'sdxl','other');assert.equal(calls,2);
    await planner.prepare(a,{...provider},'sdxl','other');assert.equal(calls,3);planner.close();
});
test('invalid intent is not retried on polling',async()=>{
    let calls=0;const provider={complete:async()=>{calls++;return {content:'{}'};}};const planner=new VisualIntentPlanner();
    await assert.rejects(planner.prepare(scene(),provider,'sdxl','chat'));
    await assert.rejects(planner.prepare(scene(),provider,'sdxl','chat'));assert.equal(calls,1);planner.close();
});

test('omitted camera safely preserves framing without accepting extra keys', () => {
    assert.equal(validateIntent({characters:intent().characters},scene()).camera,'preserve');
    assert.throws(()=>validateIntent({characters:intent().characters,lighting:'new'},scene()));
});

test('provider-neutral prompt explains downstream image generation without model control tokens', () => {
    const request=intentRequest(scene(),'pony');
    assert.match(request.messages[0].content,/downstream image generation/);
    assert.doesNotMatch(request.messages[0].content,/Qwen|no_think|enable_thinking/);
    assert.equal(JSON.parse(request.messages[1].content).profile,'pony');
});
test('JSON fences are tolerated but prose and extra state fields are rejected', () => {
    const json=JSON.stringify(intent());
    assert.deepEqual(parseIntent('```json\n'+json+'\n```',scene()),intent());
    assert.throws(()=>parseIntent('Here is my answer: '+json,scene()));
    assert.throws(()=>parseIntent('```json\n'+JSON.stringify({...intent(),outfit:'red'})+'\n```',scene()));
});
test('changing model on the same provider invalidates cached visual direction',async()=>{
    let calls=0;const provider={settings:{model:'first',endpoint:'http://local'},complete:async()=>{calls++;return {content:JSON.stringify(intent())};}};
    const planner=new VisualIntentPlanner();
    await planner.prepare(scene(),provider,'sdxl','chat');
    provider.settings.model='second';
    await planner.prepare(scene(),provider,'sdxl','chat');
    assert.equal(calls,2);planner.close();
});
