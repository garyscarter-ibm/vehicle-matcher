import assert from 'node:assert/strict';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createContractDiagnostic,validateDiagnostic } from '../g42-safe-contract-diagnostic-2026-11-07/diagnostic.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function auditRetained({plan,directory,id,mode}) {
  const original=await readFile(join(directory,'collector-checkpoint.json'));const envelope=JSON.parse(original);const state=envelope.content;
  assert.equal(envelope.contentDigest,inputDigest(state));assert.equal(state.identity.stage.planDigest,inputDigest(plan));
  for(const name of ['accepted','duplicates','rejected'])assert.deepEqual(state[name],[]);
  assert.equal(state.counts.httpAttempts,3);assert.equal(state.counts.decodedBytes>0,true);
  const diagnostic=validateDiagnostic(state.diagnosticObservation,plan,mode);assert.equal(diagnostic.document.report.admitted,0);
  const receipt=JSON.parse(await readFile(join(directory,'receipt.json')));assert.equal(receipt.allocationId,id);
  assert.equal(receipt.reason,'source-contract-diagnostic-observed');assert.equal(receipt.actualAttempts,3);assert.deepEqual(receipt.counts,state.counts);
  assert.equal(receipt.acceptance,false);assert.equal(receipt.sourceCapacityCredit,0);assert.equal(receipt.newConfigurations,0);
  const exported=await readFile(join(directory,'diagnostic.json'));assert.equal(sha(exported),diagnostic.sha256);assert.equal(exported.length,diagnostic.bytes);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'collector-state.json'))).content,state);
  const events=(await readFile(join(directory,'source-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(events.length,6);
  for(let i=0;i<3;i++){
    assert.deepEqual(Object.keys(events[2*i]).sort(),['at','attempt','method','phase']);assert.equal(events[2*i].attempt,i+1);assert.equal(events[2*i].phase,'started');assert.equal(events[2*i].method,'GET');
    assert.deepEqual(Object.keys(events[2*i+1]).sort(),['at','attempt','phase','status']);assert.equal(events[2*i+1].attempt,i+1);assert.equal(events[2*i+1].phase,'headers-received');assert.equal(events[2*i+1].status,200);
  }
  const copied=await mkdtemp(join(tmpdir(),'breadth-resume-'));let calls=0;
  try{
    const statePath=join(copied,'collector-checkpoint.json');await writeFile(statePath,original);
    const resumed=await(await createContractDiagnostic({plan,statePath,mode,now:()=>Date.parse(plan.qualificationDate+'T12:00:00Z'),
      http:{kind:mode==='live'?'live':'fixture',...(mode==='live'?{allocation:{id,sourceVersion:plan.source.version,planDigest:inputDigest(plan),attempts:3,bytes:4194304}}:{}),fetch:async()=>{calls++;throw new Error('offline-audit-must-not-fetch');}}})).run();
    assert.equal(resumed.reason,'source-contract-diagnostic-observed');assert.equal(calls,0);assert.deepEqual(resumed.diagnostic,diagnostic);
  }finally{await rm(copied,{recursive:true,force:true});}
  assert.equal(sha(await readFile(join(directory,'collector-checkpoint.json'))),sha(original));
  const report=diagnostic.document.report;
  return {checksPassed:5,checks:['primary-plan-zero-admission-identity','safe-export-seal','real-three-GET-events','copied-primary-zero-fetch-resume','unchanged-primary'],
    primarySha256:sha(original),diagnosticSha256:diagnostic.sha256,diagnosticBytes:diagnostic.bytes,originalRefusal:report.originalRefusal,
    observedAliases:report.observedAliases,modelNodes:report.modelNodes.length,relationships:report.relationships.length,seedPresent:report.seedPresent,
    decodedBytes:state.counts.decodedBytes,admitted:0,sourceCapacityCredit:0,acceptance:false};
}
