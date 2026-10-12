import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(path.join(root,'tests/fixtures/golden-scenarios.json'),'utf8'));
const ids=manifest.scenarios.map(s=>s.id);
if(ids.length!==27 || new Set(ids).size!==27 || ids.some((id,i)=>id!==`G${i+1}`))throw new Error('Expected G1-G27 exactly once');
const files=[...new Set(manifest.scenarios.flatMap(s=>s.localEvidence.map(e=>e.file)))];
const results=new Map();let log='';
for(const file of files){
 if(!/^(tests|server-plugin\/tests)\/[A-Za-z0-9_.-]+\.test\.(js|mjs)$/.test(file))throw new Error('Invalid evidence path');
 const run=spawnSync(process.execPath,['--test','--test-reporter=tap',file],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
 const output=(run.stdout || '')+(run.stderr || '');log+=`\n# ${file}\n${output}`;
 const passed=new Set([...output.matchAll(/^ok \d+ - (.+)$/gm)].map(m=>m[1].trim()));
 results.set(file,{ok:run.status===0&&!run.error,passed});
}
const scenarios=manifest.scenarios.map(s=>({id:s.id,status:s.localEvidence.every(e=>results.get(e.file)?.ok&&results.get(e.file).passed.has(e.test))?'passed':'failed',modelQualityVerified:false,evidence:s.localEvidence}));
const report={scope:manifest.scope,liveValidation:false,scenarios,passed:scenarios.filter(s=>s.status==='passed').length,total:27};
const out=path.join(root,'reports/stage6');mkdirSync(out,{recursive:true});
writeFileSync(path.join(out,'golden-tests.txt'),log);writeFileSync(path.join(out,'golden-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`Golden local contracts: ${report.passed}/27 passed; live model quality not evaluated.`);
if(report.passed!==27)process.exitCode=1;
