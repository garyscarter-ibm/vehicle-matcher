/** Finite evidence-only range diagnostic; the production grammar is unchanged. */
import { readFile, open, stat, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContractDiagnostic } from '../g42-safe-contract-diagnostic-2026-11-07/diagnostic.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const encode=value=>JSON.stringify(value)+'\n';
export async function runContext({plan,directory,id,mode,fetch,now=Date.now}) {
  if(mode==='live' && process.env.BMW_BREADTH15_CONTEXT_GRANT!==id) throw new Error('explicit-root-context-grant-required');
  if(!['live','source-fixture'].includes(mode)) throw new Error('exact-transport-kind-required');
  const primary=join(directory,'collector-checkpoint.json');
  try {await stat(primary);throw new Error('existing-primary-preserved');} catch(error) {if(error.code!=='ENOENT')throw error;}
  const save=async(name,value)=>{const file=await open(join(directory,name),'wx',0o600);try{await file.writeFile(encode(value));await file.sync();}finally{await file.close();}};
  await save('execution-once.json',{id,state:'reserved-and-consumed',planDigest:inputDigest(plan),reservedAt:new Date(now()).toISOString()});
  const folder=await open(directory,'r');try{await folder.sync();}finally{await folder.close();}
  let attempts=0,result,failure;const start=performance.now();const startedAt=new Date(now()).toISOString();
  try {
    const work=await createContractDiagnostic({plan,statePath:primary,mode,now,http:{kind:mode==='live'?'live':'fixture',
      ...(mode==='live'?{allocation:{id,sourceVersion:plan.source.version,planDigest:inputDigest(plan),attempts:3,bytes:4194304}}:{}),
      fetch:async(url,options)=>{
        const attempt=++attempts;
        await appendFile(join(directory,'source-events.jsonl'),encode({attempt,phase:'started',method:options.method,at:new Date(now()).toISOString()}),{mode:0o600});
        const response=await fetch(url,options);
        await appendFile(join(directory,'source-events.jsonl'),encode({attempt,phase:'headers-received',status:response.status,at:new Date(now()).toISOString()}),{mode:0o600});
        return response;
      }}});
    result=await work.run();
  } catch(error) {failure=/^[a-z0-9-]{1,96}$/.test(error.code||'')?error.code:'diagnostic-execution-failed';}
  const reason=failure||result?.reason||'diagnostic-result-unavailable';
  const receipt={schemaVersion:'bmw-breadth-safe-diagnostic-receipt.v1',allocationId:id,planDigest:inputDigest(plan),mode,
    startedAt,completedAt:new Date(now()).toISOString(),elapsedMs:Math.round(performance.now()-start),
    status:reason==='source-contract-diagnostic-observed'?'observed-diagnostic-only':'stopped',reason,actualAttempts:attempts,counts:result?.counts||null,
    originalRefusal:result?.diagnostic?.document.report.originalRefusal||null,rejectedContract:result?.diagnostic?.document.report.rejectedContract||null,
    admitted:0,newConfigurations:0,sourceCapacityCredit:0,options:0,solver:0,images:0,browser:0,retries:0,sourceWrites:0,rawBodiesRetained:false,settingsRetained:false,acceptance:false};
  await save('receipt.json',receipt);return receipt;
}
