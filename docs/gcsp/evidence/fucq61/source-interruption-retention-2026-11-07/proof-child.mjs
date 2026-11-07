import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCollectionSession } from '../../../../../scripts/gcsp/collection-session.mjs';
import { createConfigurationKey } from '../../../../../scripts/gcsp/configuration-key.mjs';
import { qualifyBmwSelectionRecord } from '../../../../../scripts/gcsp/bmw-selection-binding.mjs';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const directory = dirname(fileURLToPath(import.meta.url));
const original = join(directory, '../source-batch32-2026-11-07');
const plan = JSON.parse(await readFile(join(original, 'collection-plan.json')));
const allocation = JSON.parse(await readFile(join(original, 'execution-plan.json')));
const key = await createConfigurationKey({ policyService: new PolicyService({provider:new FilePolicyProvider()}), policyRead:{runId:'retention-proof',...plan.policyRead} });
const artifact = (entry) => ({bytes:JSON.stringify(entry.document)+'\n',artifactSha256:entry.sha256,retrievedAt:entry.retrievedAt||entry.document.observation.observedAt});
const validate = (state) => {
  if(state.accepted.length!==1||state.accepted[0].admission!==true||state.sourceCaptures.length!==1)throw Error('proof-state');
  const registration={plan,configurationKey:key,producerPins:allocation.producerPins,snapshotVersion:allocation.snapshotVersion,
    artifacts:{tree:artifact(state.batchEvidence.tree),solver:artifact(state.sourceCaptures[0].solver)},definitionBinding:{options:artifact(state.batchEvidence.options)}};
  if(qualifyBmwSelectionRecord({...state.accepted[0],admission:false},registration).status!=='qualified')throw Error('proof-source-binding');
};
const retained = process.argv[3];
if(process.argv[2]==='verify'){
 const envelope=JSON.parse(await readFile(join(retained,'collector-checkpoint.json')));if(inputDigest(envelope.content)!==envelope.contentDigest)throw Error('proof-integrity');
 validate(envelope.content);console.log(JSON.stringify({status:'qualified-after-cleanup',admitted:1,configurationId:envelope.content.accepted[0].configurationId}));
}else{
 const all=JSON.parse(await readFile(join(original,'collector-state.json'))).content;
 const record=all.records[0];const capture=all.sourceCaptures.find(r=>r.solver.sha256===record.sourceEvidence.solver);
 const initial={batchEvidence:all.batchEvidence,sourceCaptures:[capture],records:[record],accepted:[{...record,admission:true}],rejected:[],duplicates:[],cursor:1};
 globalThis.fetch=()=>{throw Error('proof-network-forbidden');};
 const limits={requestBudgets:{proof:1},maxAttempts:1,operationTimeoutMs:1000,deadlineMs:30000,retryDelayMs:0,concurrency:1,imageRequests:0,cacheEntries:1,cacheRetentionMs:1000,checkpointBytes:2097152};
 const session=await createCollectionSession({identity:{id:'f61-retention-proof',version:'1'},operations:{proof:{kind:'offline',sourceId:'retention-proof',sourceVersion:'1',execute:async()=>({ok:true})}},limits,statePath:join(retained,'collector-checkpoint.json'),initialState:initial,validateState:validate});
 await session.withCheckpoint(async({commit})=>{await commit('accepted-source-binding');await writeFile(join(retained,'ready.json'),JSON.stringify({pid:process.pid,sourceBindingCommitted:true})+'\n',{flag:'wx'});await new Promise(()=>{setInterval(()=>{},1000);});});
}
