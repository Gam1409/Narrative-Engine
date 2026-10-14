import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await fs.readFile('reports/director_commands_manifest.json','utf8'));
const results = JSON.parse(await fs.readFile('reports/director_commands_results.json','utf8'));
assert.equal(results.manifestSha256,createHash('sha256').update(JSON.stringify(manifest)).digest('hex'));
assert.equal(results.results.length,manifest.fixtures.length);
const extension = JSON.parse(await fs.readFile('reports/director_commands_extended_manifest.json','utf8'));
const extra = JSON.parse(await fs.readFile('reports/director_commands_rp_results.json','utf8'));
assert.equal(extra.manifestSha256,createHash('sha256').update(JSON.stringify(extension)).digest('hex'));
assert.equal(extra.results.length,8);
assert.equal(extension.system,manifest.system);
assert.deepEqual(extension.fixtures.slice(0,32),manifest.fixtures);
manifest.fixtures.push(...extension.fixtures.filter(c=>c.group==='rp_short'));
results.results.push(...extra.results);
const median = xs => {const s=[...xs].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;};
const flatten = (o,p='',out={}) => {for(const [k,v] of Object.entries(o)){const key=p?p+'.'+k:k;if(v&&typeof v==='object')flatten(v,key,out);else out[key]=v;}return out;};
for(const row of results.results){
 const c=manifest.fixtures.find(c=>c.id===row.id);
 row.textChars=c.payload.CURRENT.map(l=>l.text).join('\n').length;
 row.expectedChange=JSON.stringify(c.expectedState)!==JSON.stringify(c.payload.state_before);
 if(row.valid){
  const before=flatten(c.payload.state_before), expected=flatten(c.expectedState), actual=flatten(row.finalState);
  row.differences=Object.keys(expected).filter(k=>actual[k]!==expected[k]).map(k=>({field:k,before:before[k],expected:expected[k],actual:actual[k]}));
  row.falseChanges=row.differences.filter(d=>d.expected===d.before&&d.actual!==d.before).length;
  row.missedChanges=row.differences.filter(d=>d.expected!==d.before&&d.actual===d.before).length;
 }
}
const groups=['short','rp_short','short_rag','long_synthetic'].map(group=>{
 const rows=results.results.filter(r=>r.group===group);
 return {group,n:rows.length,valid:rows.filter(r=>r.valid).length,exact:rows.filter(r=>r.matchesExpected).length,medianSeconds:median(rows.map(r=>r.ms))/1000,minTextChars:Math.min(...rows.map(r=>r.textChars)),maxTextChars:Math.max(...rows.map(r=>r.textChars)),falseChangedFields:rows.reduce((n,r)=>n+(r.falseChanges||0),0),missedChangedFields:rows.reduce((n,r)=>n+(r.missedChanges||0),0)};
});
const summary={groups,failures:results.results.filter(r=>!r.valid||!r.matchesExpected),totalMs:results.results.reduce((n,r)=>n+r.ms,0),caveat:'Field error counts exclude rejected responses; exact counts include failures in denominator. Fixed initial states, not accumulated trajectory.'};
await fs.writeFile('reports/director_commands_metrics.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
