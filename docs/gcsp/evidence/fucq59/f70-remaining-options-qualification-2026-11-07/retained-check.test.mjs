/** Actual retained evidence only. No collector run or HTTP transport is invoked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validatePublicBmwOptionsObservations, validatePublicBmwOptionsPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url)); const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=async path=>JSON.parse(await readFile(path));const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const allocation=await read(join(base,'execution-plan.json'));
const output='/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-remaining-options/live';
const series=await read(join(output,'series-receipt.json'));
globalThis.fetch=()=>{throw new Error('retained-check-forbids-source-traffic');};
for(const id of allocation.contextIds)test(`${id}: actual semantic context/options, exact four200GETs and safe exports agree`,async()=>{
  const directory=join(base,id);const plan=await read(join(directory,'qualification-plan.json'));validatePublicBmwOptionsPlan(plan);
  assert.equal(inputDigest(plan),allocation.contextPlanDigests[id]);
  const raw=await readFile(join(directory,'collector-checkpoint.json'));const primary=JSON.parse(raw);const state=primary.content;
  assert.equal(primary.contentDigest,inputDigest(state));validatePublicBmwOptionsObservations(plan,state,'live');
  assert.deepEqual(await readFile(join(directory,'collector-state.json')),raw);
  assert.equal(state.halted,null);assert.deepEqual([state.accepted,state.rejected,state.duplicates],[[],[],[]]);
  assert.deepEqual(state.counts.operations,{page:1,settings:1,discover:1,options:1});assert.equal(state.counts.httpAttempts,4);
  const receipt=await read(join(directory,'receipt.json'));assert.equal(receipt.reason,'source-options-qualified');
  assert.equal(receipt.checkpointSha256,sha(raw));assert.deepEqual(receipt.line,plan.lineRegistration);
  const events=(await readFile(join(directory,'source-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const starts=events.filter(row=>row.phase==='started');const headers=events.filter(row=>row.phase==='headers-received');
  assert.equal(starts.length,4);assert.deepEqual(headers.map(row=>row.status),[200,200,200,200]);
  assert.deepEqual(starts.map(row=>row.attempt),[1,2,3,4]);assert.equal(starts.every(row=>row.method==='GET'),true);
  const settingsPath=state.cache.find(row=>row.operation==='page').payload.settingsPath;
  assert.match(settingsPath,/^\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/);
  assert.deepEqual(starts.map(row=>row.url),[allocation.contextUrls[id].page,'https://configure.bmw.co.uk'+settingsPath,allocation.contextUrls[id].discover,allocation.contextUrls[id].options]);
  assert.equal(starts.some(row=>/rulesolver|\/images\//.test(row.url)),false);
  assert.equal(state.cache.some(row=>row.operation==='settings'),false);
  for(const [field,name]of [['contextObservation','tree.json'],['optionsObservation','options.json']]){
    const artifact=state[field];const bytes=await readFile(join(directory,name));
    assert.equal(sha(bytes),artifact.sha256);assert.equal(bytes.length,artifact.bytes);assert.deepEqual(JSON.parse(bytes),artifact.document);
  }
  assert.deepEqual(await read(join(directory,'line-relationships.json')),state.trimRelationships);
  assert.equal((await readFile(join(directory,'accepted.jsonl'))).length,0);
  const definitions=state.optionsObservation.document.report.candidates[0].definitions;
  assert.equal(definitions.every(row=>row.code===row.option&&typeof row.optionType==='string'&&row.issues.length===0),true);
  if(plan.lineRegistration.optionsQuery.kind==='trim')assert.equal(definitions.some(row=>row.code===plan.lineRegistration.optionsQuery.code),true);
  else assert.equal(new URL(starts[3].url).search,'');
  assert.equal((await readdir(directory)).some(name=>name.includes('.writing-')||name.includes('.writer-')),false);
});
test('actual series consumed exactly the root-released plan once, within original bounds, with clean filesystem evidence',async()=>{
  const release=await read(join(base,'root-release.json'));assert.equal(release.allocationId,allocation.id);assert.equal(release.planDigest,allocation.planDigest);
  assert.equal(series.stop,'all-four-model-options-contexts-observed');assert.equal(series.publicGetAttempts,16);assert.equal(series.elapsedSeconds<=180,true);
  assert.deepEqual(series.contexts.map(row=>row.id),allocation.contextIds);assert.equal(series.codeIdentityUnchanged,true);
  assert.equal((await read(join(base,'execution-once.json'))).allocationId,allocation.id);
  let bytes=0;for(const row of series.contexts){
    assert.equal(row.retainedReceipt.actualAttempts,4);assert.equal(row.result.rc,0);assert.equal(row.result.issue,null);assert.deepEqual(row.writerMetadata,[]);
    assert.equal(row.result.peak_rss<=448*1024*1024,true);assert.equal(row.result.peak_scratch<=64*1024*1024,true);bytes+=row.checkpointCounts.decodedBytes;
    assert.equal(Object.values(row.checkpointCounts.operationBytes).every(value=>value<=1048576),true);
    assert.equal(row.cleanup.scratchAbsent,true);assert.equal(row.cleanup.groupsAbsent,true);assert.equal(row.cleanup.reservationAbsent,true);
    await assert.rejects(stat(row.cleanup.scratchRoot),{code:'ENOENT'});
    const manifest=await read(row.cleanup.manifest);assert.equal(manifest.state,'removed');assert.equal(manifest.root,row.cleanup.scratchRoot);
    assert.equal((await read(join(base,row.id,'execution-once.json'))).allocationId,allocation.id);
  }
  assert.equal(bytes<=16777216,true);
  for(const [path,pin]of Object.entries(allocation.codePins))assert.equal(sha(await readFile(join(root,path))),pin);
  assert.equal(series.newConfigurations,0);assert.equal(series.sourceCapacityCredit,0);assert.equal(series.acceptance,false);
});
test('actual retained facts reject resealed option and line-default substitutions without source traffic',async()=>{
  const id='1f7d';const plan=await read(join(base,id,'qualification-plan.json'));const primary=await read(join(base,id,'collector-checkpoint.json'));
  for(const kind of ['definition','default']){
    const state=structuredClone(primary.content);let artifact;
    if(kind==='definition'){artifact=state.optionsObservation;artifact.document.report.candidates[0].definitions[0].option='P9999';}
    else{artifact=state.contextObservation;state.trimRelationships[0].defaultModel.agModelCode='99ZZ';artifact.document.trimRelationships=structuredClone(state.trimRelationships);}
    const encoded=JSON.stringify(artifact.document)+'\n';artifact.bytes=Buffer.byteLength(encoded);artifact.sha256=sha(encoded);
    assert.throws(()=>validatePublicBmwOptionsObservations(plan,state,'live'),{code:kind==='definition'?'source-options-binding':'source-trim-binding'});
  }
});
