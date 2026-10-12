import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { retrieveMemories } from '../../src/memory/retrieval.js';
import { performance } from 'node:perf_hooks';
const cases = JSON.parse(readFileSync(new URL('./retrieval-fixtures.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const corpus = cases.map((c, i) => ({ id: String(i), text: c.text, summary: c.text, visibleTo: ['*'], importance: 0.5, status: 'current' }));
const raw = text => new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || []);
function exact(query, text) { const q = raw(query), d = raw(text); return [...q].filter(w => d.has(w)).length / Math.sqrt(q.size*d.size || 1); }
const rows = cases.map((c, i) => {
    const similarities = Object.fromEntries(corpus.map(m => [m.id, exact(c.query, m.text)]));
    const options = { topK: 3, now: 0, tokenBudget: 10000 };
    return { language: c.lang, query: c.query, expected: String(i),
        baseline: retrieveMemories(corpus, { message: c.query }, { ...options, similarities }).map(m => m.id),
        unicode: retrieveMemories(corpus, { message: c.query }, options).map(m => m.id) };
});
const metrics = group => Object.fromEntries(['baseline','unicode'].map(key => [key, { recallAt1: group.filter(r => r[key][0] === r.expected).length/group.length, recallAt3: group.filter(r => r[key].includes(r.expected)).length/group.length }]));
const percentile = values => { const a = [...values].sort((a,b) => a-b); return { p50Ms: a[Math.ceil(a.length*.5)-1], p95Ms: a[Math.ceil(a.length*.95)-1] }; };
const large = Array.from({ length: 10000 }, (_, i) => ({ ...corpus[i%corpus.length], id: String(i) }));
const lexicalTimes = [];
for (let i=0;i<7;i++) { const start = performance.now(); retrieveMemories(large, { message: cases[i].query }, { topK: 6 }); lexicalTimes.push(performance.now()-start); }
const require = createRequire(new URL('../../server-plugin/package.json', import.meta.url));
const { Database } = require('./lib/database'); const db = new Database({ storageRoot: process.cwd(), databasePath: ':memory:' });
const dimensions = 384, vector = index => Array.from({length:dimensions}, (_, j) => Math.sin(index+j*.17));
const put = db.db.prepare('INSERT INTO embedding_cache(scope,hash,model,vector_json,vector_blob) VALUES (?,?,?,?,?)');
db.db.transaction(() => { for (let i=0;i<10000;i++) put.run('bench',String(i),'synthetic-384',JSON.stringify(vector(i)),Buffer.from(new Float32Array(vector(i)).buffer)); })();
const query = Buffer.from(new Float32Array(vector(42)).buffer), vectorTimes = [];
for (let i=0;i<7;i++) { const start=performance.now(); db.db.prepare('SELECT hash,vec_distance_cosine(vector_blob,?) d FROM embedding_cache WHERE scope=? AND model=? ORDER BY d LIMIT 6').all(query,'bench','synthetic-384'); vectorTimes.push(performance.now()-start); }
const result = { fixtureCount: cases.length, corpusSize: corpus.length, quality: metrics(rows), byLanguage: Object.fromEntries([...new Set(cases.map(c=>c.lang))].map(lang=>[lang,metrics(rows.filter(r=>r.language===lang))])),
    performance: { count:10000, repetitions:7, lexical:percentile(lexicalTimes), sqliteVec384:percentile(vectorTimes) },
    sqliteVec: db.db.prepare('SELECT vec_version() v').get().v, fts5: db.ftsAvailable, realEmbeddingQuality:null, note:'Synthetic labelled fixtures and vectors; no live embedding/model calls.', rows };
db.close(); writeFileSync(new URL('./metrics.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({ quality:result.quality, performance:result.performance }));
