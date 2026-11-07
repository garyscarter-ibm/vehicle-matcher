/** One registered four-GET session in the exact separately released six-model series. */
import { readFile, appendFile, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPublicBmwOptionsQualification } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { validatePublicBmwOptionsPlan, validatePublicBmwOptionsObservations } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwModelOptionsRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url)),root=fileURLToPath(new URL('../../../../../',import.meta.url));
const id='scheme-breadth-remaining24-model-options-root-20261107-once',checking=process.argv[2]==='--check';
if(!checking&&process.env.BMW_BREADTH_REMAINING24_OPTIONS_ROOT_SOURCE_GRANT!==id)throw new Error('explicit-root-traffic-grant-required');
const allocation=JSON.parse(await readFile(join(base,'execution-plan.json')));
if(allocation.id!==id)throw new Error('source-allocation-mismatch');
const sha=b=>createHash('sha256').update(b).digest('hex'),encode=v=>JSON.stringify(v)+'\n';
const plans=[];
for(const context of allocation.contextIds){
  const p=validatePublicBmwOptionsPlan(JSON.parse(await readFile(join(base,context,'qualification-plan.json'))));plans.push(p);
  if(inputDigest(p)!==allocation.contextPlanDigests[context]||inputDigest(bmwModelOptionsRequestUrls({model:p.modelRegistration,line:p.lineRegistration}))!==inputDigest(allocation.contextUrls[context]))throw new Error('source-context-plan-or-urls-mismatch');
}
if(inputDigest(plans)!==allocation.planDigest)throw new Error('source-series-plan-digest-mismatch');
for(const [path,expected]of Object.entries(allocation.codePins))if(sha(await readFile(join(root,path)))!==expected)throw new Error('source-code-pin-mismatch');
for(const [path,expected]of Object.entries(allocation.runtimePins))if(sha(await readFile(path))!==expected)throw new Error('source-runtime-pin-mismatch');
if(checking){console.log(JSON.stringify({status:'prepared-only',planDigest:allocation.planDigest,contexts:allocation.contextIds,sourceTraffic:false,publicGetCeiling:96,admitted:0,sourceCapacityCredit:0}));}
else{
  const context=process.argv[2];if(!allocation.contextIds.includes(context))throw new Error('unregistered-context');
  const plan=plans[allocation.contextIds.indexOf(context)];if(plan.qualificationDate!==new Date().toISOString().slice(0,10))throw new Error('source-qualification-date-mismatch');
  const series=JSON.parse(await readFile(join(base,'execution-once.json')));if(series.allocationId!==id||series.planDigest!==allocation.planDigest)throw new Error('series-reservation-required');
  const directory=join(base,context),primary=join(directory,'collector-checkpoint.json');
  try{await stat(primary);throw new Error('existing-primary-preserved');}catch(error){if(error.code!=='ENOENT')throw error;}
  const save=async(name,value)=>{const file=await open(join(directory,name),'wx',0o600);try{await file.writeFile(encode(value));await file.sync();}finally{await file.close();}};
  await save('execution-once.json',{allocationId:id,context,planDigest:inputDigest(plan),state:'reserved-and-consumed',reservedAt:new Date().toISOString()});
  const folder=await open(directory,'r');try{await folder.sync();}finally{await folder.close();}
  let attempts=0,result,failure,checkpointSha256=null;const started=performance.now();
  try{
    const work=await createPublicBmwOptionsQualification({plan,statePath:primary,mode:'live',http:{kind:'live',allocation:{id,sourceVersion:plan.source.version,planDigest:inputDigest(plan),attempts:4,bytes:plan.limits.sourceBytes},
      fetch:async(url,options)=>{
        if(++attempts>4)throw new Error('four-get-ceiling');
        const request={attempt:attempts,method:options.method,at:new Date().toISOString()};
        await appendFile(join(directory,'source-events.jsonl'),encode({...request,phase:'started'}),{mode:0o600});
        const response=await globalThis.fetch(url,options);
        await appendFile(join(directory,'source-events.jsonl'),encode({...request,phase:'headers-received',status:response.status}),{mode:0o600});return response;
      }}});result=await work.run();
  }catch(error){failure=/^[a-z0-9-]{1,96}$/.test(error.code||'')?error.code:'model-options-execution-failed';}
  try{const bytes=await readFile(primary),envelope=JSON.parse(bytes);if(inputDigest(envelope.content)!==envelope.contentDigest)throw new Error('checkpoint-integrity');validatePublicBmwOptionsObservations(plan,envelope.content,'live');checkpointSha256=sha(bytes);}
  catch(error){failure||=error.code==='ENOENT'?'primary-unavailable':'model-options-retention-validation-failed';}
  const reason=failure||result?.reason||'model-options-result-unavailable';
  const receipt={schemaVersion:'scheme-breadth-model-options-context-receipt.v1',allocationId:id,planDigest:inputDigest(plan),sourceExecutionBase:allocation.baseCommit,
    modelCode:plan.modelRegistration.modelCode,agModelCode:plan.modelRegistration.agModelCode,line:plan.lineRegistration,
    status:reason==='source-options-qualified'?'observed-typed-options-only':'stopped',reason,elapsedMs:Math.round(performance.now()-started),actualAttempts:attempts,counts:result?.counts||null,checkpointSha256,
    admitted:0,newConfigurations:0,sourceCapacityCredit:0,solverRequests:0,imageRequests:0,sourceWrites:0,rawBodiesRetained:false,settingsRetained:false,retries:0,browser:0,acceptance:false};
  await save('receipt.json',receipt);console.log(JSON.stringify(receipt));if(reason!=='source-options-qualified')process.exitCode=1;
}
