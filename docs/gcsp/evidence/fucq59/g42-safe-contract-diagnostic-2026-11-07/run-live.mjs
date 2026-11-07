/** Exact once-only three-GET diagnostic. No grant is present in the prepared files. */
import { readFile, open, stat, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createContractDiagnostic } from './diagnostic.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url));const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const id='g42-safe-contract-diagnostic-20261107-once';
if(process.env.BMW_G42_DIAGNOSTIC_SOURCE_GRANT!==id) throw new Error('explicit-root-traffic-grant-required');
const allocation=JSON.parse(await readFile(join(base,'execution-plan.json')));const plan=JSON.parse(await readFile(join(base,'qualification-plan.json')));
const sha=b=>createHash('sha256').update(b).digest('hex');const encode=v=>JSON.stringify(v)+'\n';
if(allocation.id!==id||plan.qualificationDate!==new Date().toISOString().slice(0,10)||inputDigest(plan)!==allocation.planDigest)throw new Error('source-plan-date-or-digest-mismatch');
for(const [path,expected] of Object.entries(allocation.codePins))if(sha(await readFile(join(root,path)))!==expected)throw new Error('source-code-pin-mismatch');
for(const [path,expected] of Object.entries(allocation.runtimePins))if(sha(await readFile(path))!==expected)throw new Error('source-runtime-pin-mismatch');
const primary=join(base,'collector-checkpoint.json');
try{await stat(primary);throw new Error('existing-primary-preserved');}catch(error){if(error.code!=='ENOENT')throw error;}
const save=async(name,value)=>{const f=await open(join(base,name),'wx',0o600);try{await f.writeFile(encode(value));await f.sync();}finally{await f.close();}};
await save('execution-once.json',{id,state:'reserved-and-consumed',planDigest:allocation.planDigest,reservedAt:new Date().toISOString()});
const folder=await open(base,'r');try{await folder.sync();}finally{await folder.close();}
let attempts=0,result,failure;const start=performance.now();const startedAt=new Date().toISOString();
try{
  const work=await createContractDiagnostic({plan,statePath:primary,mode:'live',http:{kind:'live',allocation:{id,sourceVersion:plan.source.version,planDigest:allocation.planDigest,attempts:3,bytes:4194304},
    fetch:async(url,options)=>{
      const attempt=++attempts;
      await appendFile(join(base,'source-events.jsonl'),encode({attempt,phase:'started',method:options.method,at:new Date().toISOString()}),{mode:0o600});
      const response=await globalThis.fetch(url,options);
      await appendFile(join(base,'source-events.jsonl'),encode({attempt,phase:'headers-received',status:response.status,at:new Date().toISOString()}),{mode:0o600});
      return response;
    }}});result=await work.run();
}catch(error){failure=/^[a-z0-9-]{1,96}$/.test(error.code||'')?error.code:'diagnostic-execution-failed';}
const reason=failure||result?.reason||'diagnostic-result-unavailable';
const receipt={schemaVersion:'bmw-safe-contract-diagnostic-receipt.v1',allocationId:id,planDigest:allocation.planDigest,startedAt,completedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-start),
  status:reason==='source-contract-diagnostic-observed'?'observed-diagnostic-only':'stopped',reason,actualAttempts:attempts,counts:result?.counts||null,
  originalRefusal:result?.diagnostic?.document.report.originalRefusal||null,rejectedContract:result?.diagnostic?.document.report.rejectedContract||null,
  admitted:0,newConfigurations:0,sourceCapacityCredit:0,options:0,solver:0,images:0,browser:0,retries:0,sourceWrites:0,rawBodiesRetained:false,settingsRetained:false,acceptance:false};
await save('receipt.json',receipt);console.log(JSON.stringify(receipt));
if(reason!=='source-contract-diagnostic-observed')process.exitCode=1;
