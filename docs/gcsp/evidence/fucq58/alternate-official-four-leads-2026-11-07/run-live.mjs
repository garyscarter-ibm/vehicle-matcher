import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runContext} from '../../fucq59/scheme-line-breadth15-2026-11-07/contract-runner.mjs';
import {guardedRequests} from './request-guard.mjs';
const base=dirname(fileURLToPath(import.meta.url));const root=fileURLToPath(new URL('../../../../../',import.meta.url));
if(!process.env.BMW_F58_FOUR_MODEL_CONTEXT_GRANT||!process.env.BMW_F58_FOUR_MODEL_PHASE_GRANT)throw new Error('exact-root-context-and-phase-grants-required');
const read=async p=>JSON.parse(await readFile(p));const sha=b=>createHash('sha256').update(b).digest('hex');
const series=await read(join(base,'series-plan.json'));const entry=series.contexts.find(e=>e.id===process.argv[2]);
if(!entry||process.env.BMW_F58_FOUR_MODEL_CONTEXT_GRANT!==entry.allocationId)throw new Error('exact-root-context-and-phase-grants-required');
const phase=series.phases[entry.phase];const release=await read(join(base,phase.releaseFile));
if(process.env.BMW_F58_FOUR_MODEL_PHASE_GRANT!==phase.grantId||release.status!=='released-once'||release.phase!==entry.phase||release.allocationId!==series.id||release.planSha256!==sha(await readFile(join(base,'series-plan.json')))||release.GET!==phase.getCeiling||JSON.stringify(release.contexts)!==JSON.stringify(phase.contexts)||release.settingsBootstrapGET!==phase.contexts.length)throw new Error('exact-root-phase-release-required');
for(const [path,hash] of Object.entries({...series.codePins,...series.sourcePins}))if(sha(await readFile(join(root,path)))!==hash)throw new Error('source-code-or-input-pin-mismatch');
for(const [path,hash] of Object.entries(series.runtimePins))if(sha(await readFile(path))!==hash)throw new Error('source-runtime-pin-mismatch');
if(series.qualificationDate!==new Date().toISOString().slice(0,10))throw new Error('source-observation-date-mismatch');
if(entry.phase==='remaining'){
  if(release.reviewedFirstProofSha256!==sha(await readFile(join(series.outputRoot,'u06/live-validation.json')))||release.reviewedFirstReceiptSha256!==sha(await readFile(join(series.outputRoot,'first-receipt.json'))))throw new Error('actual-reviewed-first-evidence-required');
  const prior=await read(join(series.outputRoot,'first-receipt.json'));
  if(prior.reason!=='finite-first-exhausted'||prior.actualGets!==3||prior.completedContexts.length!==1||prior.completedContexts[0].context!=='u06'||prior.completedContexts[0].proofSha256!==release.reviewedFirstProofSha256)throw new Error('actual-complete-first-context-required');
}
const marker=await read(join(series.outputRoot,entry.phase+'-once.json'));
if(marker.id!==phase.grantId||marker.planSha256!==sha(await readFile(join(base,'series-plan.json')))||marker.releaseSha256!==sha(await readFile(join(base,phase.releaseFile)))||marker.state!=='reserved-and-consumed'||!Number.isFinite(Date.parse(marker.reservedAt))||Date.now()-Date.parse(marker.reservedAt)<0||Date.now()-Date.parse(marker.reservedAt)>=phase.maximumWallSeconds*1000)throw new Error('exact-consumed-current-phase-required');
const directory=join(series.outputRoot,entry.id);const plan=await read(join(root,entry.qualificationPlanPath));
const fetch=guardedRequests({entry,directory,fetch:globalThis.fetch});
// The unchanged evidence runner owns its separate internal context grant.
process.env.BMW_BREADTH15_CONTEXT_GRANT=entry.allocationId;
const receipt=await runContext({plan,directory,id:entry.allocationId,mode:'live',fetch});
console.log(JSON.stringify(receipt));if(receipt.reason!=='source-contract-diagnostic-observed')process.exitCode=1;
