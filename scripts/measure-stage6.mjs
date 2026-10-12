import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {StateManager} from '../src/state/manager.js';
import {retrieveMemories} from '../src/memory/retrieval.js';
import {describeScene} from '../src/visual/scene.js';
import {SIMULATION_DEFAULTS} from '../src/state/simulation.js';
const at='2026-10-12T00:00:00Z';
const active=Array.from({length:6},(_,i)=>`actor${i}`);
const ops=Array.from({length:300},(_,i)=>({op:'create_entity',entity:{id:i<6?active[i]:`item${i}`,name:i<6?active[i]:`item${i}`,type:i<6?'character':'item',campaignId:'load'}}));
const policy={...SIMULATION_DEFAULTS,innerLifeMode:'light',activeCharacters:active,playerIds:[],characterEnabled:true,relationshipsEnabled:true};
const records=Array.from({length:3000},(_,i)=>({deltaId:`d${i}`,idempotencyKey:`t${i}`,messageIndex:i,source:i<2?'author':`message:${i}`,at,confidence:1,memories:[],messageRef:{messageIndex:i,swipeId:0},delta:i<2?{ops:ops.slice(i*150,(i+1)*150),scene:{present:active,location:'hall'}}:{time_advance_minutes:1,simulation:{policy}}}));
const decisions=records.map(r=>({decisionId:`a${r.deltaId}`,deltaId:r.deltaId,status:'confirmed',at}));
const memories=Array.from({length:30000},(_,i)=>({id:`m${i}`,summary:i===777?'violin rehearsal promise':`routine meal ${i}`,visibleTo:['*'],importance:0.5,createdAt:at}));
const samples=[];
for(let i=0;i<3;i++){
 const manager=new StateManager();await manager.commit({records,decisions});
 const started=performance.now();await manager.selectBranch(records);const rebuildMs=performance.now()-started;
 assert.equal(manager.state.timeline.elapsedMinutes,2998);assert.equal(Object.keys(manager.state.entities).length,300);
 const searchStart=performance.now();const found=retrieveMemories(memories,{message:'violin rehearsal',characters:active},{topK:6});const retrievalMs=performance.now()-searchStart;assert.equal(found[0].id,'m777');
 const visualStart=performance.now();const scene=await describeScene(manager.snapshot(),active.map(name=>({name})));const descriptorMs=performance.now()-visualStart;assert.equal(scene.characters.length,6);
 samples.push({rebuildMs,retrievalMs,descriptorMs});
}
const metrics=Object.fromEntries(['rebuildMs','retrievalMs','descriptorMs'].map(key=>{const s=samples.map(v=>v[key]).sort((a,b)=>a-b);return [key,{p50:s[1],p95:s[2]}];}));
const report={scope:'Synthetic CPU/in-memory storage: 3000 small deltas with light simulation, 300 entities, 30000 memories and six scene characters. Three samples; p95 is sample maximum. No real model, browser, network or GPU.',node:process.version,samples,metrics,realTokens:null,realModelLatency:null};
await mkdir(new URL('../reports/stage6/',import.meta.url),{recursive:true});await writeFile(new URL('../reports/stage6/load-metrics.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(metrics));
