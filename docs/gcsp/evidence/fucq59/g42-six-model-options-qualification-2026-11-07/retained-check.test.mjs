/** Retained actual evidence only. Every transport is forbidden. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPublicBmwOptionsQualification } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { validatePublicBmwOptionsObservations, validatePublicBmwOptionsPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url)),root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=async path=>JSON.parse(await readFile(path)),sha=b=>createHash('sha256').update(b).digest('hex');
const allocation=await read(join(base,'execution-plan.json'));
const series=await read(join(base,'series-receipt.json'));
globalThis.fetch=()=>{throw new Error('retained-check-forbids-source-traffic');};
for(const id of allocation.contextIds)test(`${id}: actual model/line/options, four HTTP200 GETs and sealed exports agree`,async()=>{
  const directory=join(base,id),plan=await read(join(directory,'qualification-plan.json'));validatePublicBmwOptionsPlan(plan);
  assert.equal(inputDigest(plan),allocation.contextPlanDigests[id]);
  const raw=await readFile(join(directory,'collector-checkpoint.json')),primary=JSON.parse(raw),state=primary.content;
  assert.equal(primary.contentDigest,inputDigest(state));validatePublicBmwOptionsObservations(plan,state,'live');
  assert.deepEqual(await readFile(join(directory,'collector-state.json')),raw);
  assert.equal(state.halted,null);assert.deepEqual([state.accepted,state.rejected,state.duplicates],[[],[],[]]);
  assert.deepEqual(state.counts.operations,{page:1,settings:1,discover:1,options:1});assert.equal(state.counts.httpAttempts,4);
  const receipt=await read(join(directory,'receipt.json'));assert.equal(receipt.reason,'source-options-qualified');
  assert.equal(receipt.allocationId,allocation.id);assert.equal(receipt.planDigest,allocation.contextPlanDigests[id]);
  assert.equal(receipt.modelCode,plan.modelRegistration.modelCode);assert.equal(receipt.agModelCode,plan.modelRegistration.agModelCode);
  assert.equal(receipt.checkpointSha256,sha(raw));assert.deepEqual(receipt.line,plan.lineRegistration);
  for(const field of ['solverRequests','imageRequests','sourceWrites','browser','admitted','newConfigurations','sourceCapacityCredit','retries'])assert.equal(receipt[field],0);
  const events=(await readFile(join(directory,'source-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const starts=events.filter(r=>r.phase==='started'),headers=events.filter(r=>r.phase==='headers-received');
  assert.equal(starts.length,4);assert.deepEqual(headers.map(r=>r.status),[200,200,200,200]);
  assert.deepEqual(starts.map(r=>r.attempt),[1,2,3,4]);assert.equal(starts.every(r=>r.method==='GET'),true);
  for(const event of events)assert.deepEqual(Object.keys(event).sort(),(event.phase==='started'?['attempt','method','at','phase']:['attempt','method','at','phase','status']).sort());
  assert.equal(state.cache.some(r=>r.operation==='settings'),false);
  for(const [field,name]of [['contextObservation','tree.json'],['optionsObservation','options.json']]){
    const artifact=state[field],bytes=await readFile(join(directory,name));
    assert.equal(sha(bytes),artifact.sha256);assert.equal(bytes.length,artifact.bytes);assert.deepEqual(JSON.parse(bytes),artifact.document);
  }
  assert.deepEqual(await read(join(directory,'line-relationships.json')),state.trimRelationships);
  assert.equal((await readFile(join(directory,'accepted.jsonl'))).length,0);
  const definitions=state.optionsObservation.document.report.candidates[0].definitions;
  assert.equal(definitions.every(r=>r.code===r.option&&typeof r.optionType==='string'&&r.issues.length===0),true);
  assert.equal(definitions.some(r=>r.code===plan.lineRegistration.optionsQuery.code),true);
  assert.equal((await readdir(directory)).some(n=>n.includes('.writing-')||n.includes('.writer-')),false);
});
test('actual series consumes the root release once and respects original bounds and clean manifests',async()=>{
  const release=await read(join(base,'parent-release.json'));
  assert.equal(release.sourceAllocation,allocation.id);assert.equal(release.planDigest,allocation.planDigest);assert.equal(release.sourceGrantReleased,true);
  assert.equal(release.executionPlanSha256,sha(await readFile(join(base,'execution-plan.json'))));
  assert.equal(series.stop,'all-six-model-options-contexts-observed');assert.equal(series.publicGetAttempts,24);assert.equal(series.elapsedSeconds<=600,true);
  assert.deepEqual(series.contexts.map(r=>r.id),allocation.contextIds);assert.equal(series.codeIdentityUnchanged,true);assert.equal(series.runtimeIdentityUnchanged,true);
  assert.equal((await read(join(base,'execution-once.json'))).allocationId,allocation.id);
  let bytes=0;for(const row of series.contexts){
    assert.equal(row.retainedReceipt.actualAttempts,4);assert.equal(row.result.rc,0);assert.equal(row.result.issue,null);assert.deepEqual(row.writerMetadata,[]);
    assert.equal(row.result.wall<=105,true);assert.equal(row.result.peak_rss<=448*1024*1024,true);assert.equal(row.result.peak_scratch<=64*1024*1024,true);
    assert.equal(row.checkpointCounts.decodedBytes<=4194304,true);bytes+=row.checkpointCounts.decodedBytes;
    assert.equal(Object.values(row.checkpointCounts.operationBytes).every(v=>v<=1048576),true);
    assert.equal(row.cleanup.scratchAbsent,true);assert.equal(row.cleanup.groupsAbsent,true);assert.equal(row.cleanup.reservationAbsent,true);
    await assert.rejects(stat(row.cleanup.scratchRoot),{code:'ENOENT'});
    const manifest=await read(row.cleanup.manifest);assert.equal(manifest.state,'removed');assert.equal(manifest.root,row.cleanup.scratchRoot);
    const marker=await read(join(base,row.id,'execution-once.json'));assert.equal(marker.allocationId,allocation.id);assert.equal(marker.planDigest,allocation.contextPlanDigests[row.id]);
  }
  assert.equal(bytes,series.decodedBytes);assert.equal(bytes<=25165824,true);
  for(const [path,pin]of Object.entries(allocation.codePins))assert.equal(sha(await readFile(join(root,path))),pin);
  for(const [path,pin]of Object.entries(allocation.runtimePins))assert.equal(sha(await readFile(path)),pin);
  assert.equal(series.newConfigurations,0);assert.equal(series.sourceCapacityCredit,0);assert.equal(series.acceptance,false);
});
test('actual retained evidence rejects resealed definition and default-model substitutions',async()=>{
  const plan=await read(join(base,'2pmc','qualification-plan.json')),primary=await read(join(base,'2pmc','collector-checkpoint.json'));
  for(const kind of ['definition','default']){
    const state=structuredClone(primary.content);let artifact;
    if(kind==='definition'){artifact=state.optionsObservation;artifact.document.report.candidates[0].definitions[0].option='P9999';}
    else{artifact=state.contextObservation;state.trimRelationships[0].defaultModel.agModelCode='99ZZ';artifact.document.trimRelationships=structuredClone(state.trimRelationships);}
    const encoded=JSON.stringify(artifact.document)+'\n';artifact.bytes=Buffer.byteLength(encoded);artifact.sha256=sha(encoded);
    assert.throws(()=>validatePublicBmwOptionsObservations(plan,state,'live'),{code:kind==='definition'?'source-options-binding':'source-trim-binding'});
  }
});
test('all six copied actual primaries resume without any fetch and originals remain byte-identical',async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'g42-six-retained-resume-'));
  try{for(const id of allocation.contextIds){
    const original=join(base,id,'collector-checkpoint.json'),before=await readFile(original),path=join(temporary,id+'.json');await copyFile(original,path);
    const plan=await read(join(base,id,'qualification-plan.json'));let attempts=0;
    const work=await createPublicBmwOptionsQualification({plan,statePath:path,mode:'live',http:{kind:'live',allocation:{id:allocation.id,sourceVersion:plan.source.version,planDigest:inputDigest(plan),attempts:4,bytes:plan.limits.sourceBytes},fetch:async()=>{attempts++;throw new Error('no-retained-refetch');}}});
    const result=await work.run();assert.equal(result.reason,'source-options-qualified');assert.equal(attempts,0);assert.equal(result.counts.httpAttempts,4);assert.deepEqual(await readFile(original),before);
  }}finally{await rm(temporary,{recursive:true,force:true});}
});
