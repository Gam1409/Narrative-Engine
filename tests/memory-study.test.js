import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {buildStoryCases,buildStoryRequest,validateStoryResponse} from '../scripts/memory-study.mjs';

const text='Earlier event.\nCurrent event.';
const manifest={sources:{'story.txt':crypto.createHash('sha256').update(text).digest('hex')},
 cases:[{id:'secret-case',source:'story.txt',start:15,end:text.length,checks:['EXPECTED_SECRET']} ]};

test('story probe uses verified source spans and no future narrative',()=>{
 const rows=buildStoryCases(manifest,{'story.txt':text});
 assert.equal(rows[0].current,'Current event.');assert.deepEqual(rows[0].history,['Earlier event.']);
 assert.throws(()=>buildStoryCases(manifest,{'story.txt':text+'changed'}),/hash mismatch/);
});
test('paired requests exclude evaluation metadata and keep model parameters and source text fixed',()=>{
 const row=buildStoryCases(manifest,{'story.txt':text})[0],config={model:'model',temperature:0.2,maxTokens:1800};
 const a=buildStoryRequest(row,false,config),b=buildStoryRequest(row,true,config);
 assert.equal(a.messages[0].content,b.messages[0].content);
 assert.equal(a.model,b.model);assert.equal(a.temperature,b.temperature);assert.equal(a.max_tokens,b.max_tokens);
 for(const req of [a,b])assert.doesNotMatch(JSON.stringify(req),/EXPECTED_SECRET|secret-case|checks|benchmark|test|experiment/);
 const pa=JSON.parse(a.messages[1].content),pb=JSON.parse(b.messages[1].content);
 assert.equal(pa.current_passage,pb.current_passage);assert.deepEqual(pa.historical_context,pb.historical_context.map(m=>m.text));
});
test('response validation rejects invented evidence rather than treating valid JSON as success',()=>{
 const response={frame:'current',location:'room',characters:[{id:'Anna',visible:'',inner:'',posture:'',clothing:'',action:'',evidenceQuotes:['Current event.']}]};
 assert.deepEqual(validateStoryResponse(JSON.stringify(response),'Current event.'),response);
 response.characters[0].evidenceQuotes=['invented'];
 assert.throws(()=>validateStoryResponse(JSON.stringify(response),'Current event.'),/evidence/);
});


test('reference mode uses the same production evidence catalog in both arms', () => {
    const row = {...buildStoryCases(manifest, {'story.txt': text})[0],
        evidenceCatalog: [{ref: 'rp:current:0', text: 'Current event.'}]};
    const config = {model: 'model', temperature: 0.2, maxTokens: 1800, evidenceRefs: true};
    const a = buildStoryRequest(row, false, config), b = buildStoryRequest(row, true, config);
    assert.equal(a.messages[0].content, b.messages[0].content);
    assert.match(a.messages[0].content, /evidenceRefs/);
    assert.doesNotMatch(a.messages[0].content, /evidenceQuotes/);
    for (const request of [a, b]) {
        assert.deepEqual(JSON.parse(request.messages[1].content).evidence_catalog, row.evidenceCatalog);
        assert.doesNotMatch(JSON.stringify(request), /EXPECTED_SECRET|secret-case|checks/);
    }
});

test('reference validation rejects unknown refs and quotes substituted for refs', () => {
    const catalog = [{ref: 'rp:current:0', text: 'Current event.'}];
    const character = {id: 'Anna', visible: '', inner: '', posture: '', clothing: '', action: '', evidenceRefs: ['rp:current:0']};
    const response = {frame: 'current', location: 'room', characters: [character]};
    assert.deepEqual(validateStoryResponse(JSON.stringify(response), 'Current event.', catalog), response);
    character.evidenceRefs = ['rp:previous:0'];
    assert.throws(() => validateStoryResponse(JSON.stringify(response), 'Current event.', catalog), /evidence/);
    delete character.evidenceRefs;
    character.evidenceQuotes = ['Current event.'];
    assert.throws(() => validateStoryResponse(JSON.stringify(response), 'Current event.', catalog), /evidence/);
});
