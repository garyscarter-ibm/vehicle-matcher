/** Retained actual evidence only. No public requests or original-primary mutation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { createContractDiagnostic, validateDiagnostic } from './diagnostic.mjs';
import { validatePublicBmwOptionsPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwModelOptionsRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
const read=async name=>JSON.parse(await readFile(new URL('./'+name,import.meta.url),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('spent allocation retains exact three HTTP200 observations and sealed primary identity',async()=>{
  const plan=await read('qualification-plan.json'),allocation=await read('execution-plan.json'),receipt=await read('receipt.json'),marker=await read('execution-once.json');
  const bytes=await readFile(new URL('./collector-checkpoint.json',import.meta.url)),state=JSON.parse(bytes);
  assert.equal(sha(bytes),'0e277490365f8089fd2b794a44a169b10a5efe64b3d9a4eb4c5bc572dc0897cc');assert.equal(inputDigest(state.content),state.contentDigest);
  assert.deepEqual(await readFile(new URL('./collector-state.json',import.meta.url)),bytes);
  assert.equal(marker.id,allocation.id);assert.equal(marker.planDigest,inputDigest(plan));assert.equal(receipt.actualAttempts,3);
  assert.equal(receipt.counts.decodedBytes,757135);assert.deepEqual(receipt.counts.operationBytes,{discover:118726,page:17763,settings:620646});
  const events=(await readFile(new URL('./source-events.jsonl',import.meta.url),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.filter(r=>r.phase==='headers-received').map(r=>[r.attempt,r.status]),[[1,200],[2,200],[3,200]]);
  const artifact=state.content.diagnosticObservation;validateDiagnostic(artifact,plan,'live');
  assert.equal(sha(await readFile(new URL('./diagnostic.json',import.meta.url))),artifact.sha256);
  assert.equal((await read('checkpoint-export.json')).checkpointSha256,sha(bytes));
});
test('actual diagnosis preserves the exact rejected line key and all bounded relationships',async()=>{
  const r=(await read('diagnostic.json')).report;
  assert.equal(r.originalRefusal,'source-inventory-line-key');assert.deepEqual(r.rejectedContract,{gate:'line',path:'/2/modelRanges/G42/lines/M_PERFORMANCE_LINE',key:'M_PERFORMANCE_LINE',type:'object'});
  assert.deepEqual(r.observedAliases,['2']);assert.equal(r.relationships.length,61);assert.equal(r.modelNodes.length,6);
  assert.deepEqual(r.modelNodes.map(n=>[n.modelKey,n.facts.agModelCode,n.facts.derivative]),[['2PBC','52FA','M240I'],['2PMA','12CM','220I'],['2PMB','22CM','230I'],['2PMC','52FA','M240I'],['2PPA','12CM','220I'],['2PPB','22CM','230I']]);
  assert.ok(r.modelNodes.every(n=>n.facts.steering==='RL'&&n.facts.modelRange==='G42'&&n.facts.orderDate==='2026-11-01'&&n.facts.effectDate==='2027-01-05'&&[n.missingFields,n.invalidFields,n.issues].every(a=>a.length===0)));
  const row=path=>r.relationships.find(x=>x.path===path);
  const prefix='/2/modelRanges/G42/lines/';assert.equal(row(prefix+'M_PERFORMANCE_LINE/defaultModel/modelCode').value,'2PMC');
  assert.equal(row(prefix+'M_PERFORMANCE_LINE/includedTransmissionVariants/0/configuration/modelCode').value,'2PMC');
  assert.equal(row(prefix+'M_PERFORMANCE_LINE/option'),undefined);
  assert.equal(row(prefix+'S0337/defaultModel/modelCode').value,'2PMA');assert.equal(row(prefix+'S0337/includedTransmissionVariants/1/configuration/modelCode').value,'2PMA');
  assert.equal(row(prefix+'S0337/includedTransmissionVariants/1/configuration/elements/S0337').type,'object');
});
test('copied actual checkpoint resumes with zero fetches and original primary stays byte-identical',async t=>{
  const root=await mkdtemp(join(tmpdir(),'g42-actual-copy-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=new URL('./collector-checkpoint.json',import.meta.url);const before=await readFile(source);const statePath=join(root,'collector-checkpoint.json');await copyFile(source,statePath);
  const plan=await read('qualification-plan.json'),allocation=await read('execution-plan.json');let attempts=0;
  const args={plan,statePath,mode:'live',now:()=>Date.parse('2026-11-07T04:00:00Z'),http:{kind:'live',allocation:{id:allocation.id,sourceVersion:plan.source.version,planDigest:allocation.planDigest,attempts:3,bytes:4194304},fetch:async()=>{attempts++;throw new Error('forbidden-fetch');}}};
  const first=await(await createContractDiagnostic(args)).run();const second=await(await createContractDiagnostic(args)).run();
  assert.equal(first.reason,'source-contract-diagnostic-observed');assert.deepEqual(first,second);assert.equal(attempts,0);assert.deepEqual(await readFile(source),before);
});
test('actual retained files exclude bootstrap material and retain zero admission/capacity',async()=>{
  const receipt=await read('receipt.json');for(const field of ['admitted','newConfigurations','sourceCapacityCredit','options','solver','images','browser','retries','sourceWrites'])assert.equal(receipt[field],0);
  assert.equal(receipt.acceptance,false);assert.equal(receipt.rawBodiesRetained,false);assert.equal(receipt.settingsRetained,false);assert.equal((await readFile(new URL('./accepted.jsonl',import.meta.url))).length,0);
  for(const name of ['collector-checkpoint.json','collector-state.json','diagnostic.json','source-events.jsonl'])assert.doesNotMatch(await readFile(new URL('./'+name,import.meta.url),'utf8'),/"x-api-key"|settingsVehicleTree|"APP"|"headers"|"rawBody"/);
  assert.deepEqual((await readdir(new URL('./',import.meta.url))).filter(name=>/writer-|writing-/.test(name)),[]);
});
test('next options proposal fits existing model/line registration without allocating traffic',async()=>{
  const proposal=await read('next-qualification.proposed.json');const plan=validatePublicBmwOptionsPlan(proposal.sourcePlan);
  assert.equal(proposal.diagnosticSha256,sha(await readFile(new URL('./diagnostic.json',import.meta.url))));
  const report=(await read('diagnostic.json')).report;const node=report.modelNodes.find(n=>n.modelKey==='2PMA');
  for(const field of ['modelCode','agModelCode','steering','orderDate','effectDate'])assert.equal(plan.modelRegistration[field],node.facts[field]);
  assert.equal(plan.modelRegistration.rawModelRange,node.facts.modelRange);assert.deepEqual(plan.modelRegistration.aliases,report.observedAliases);
  const value=path=>report.relationships.find(row=>row.path===path)?.value;const prefix=proposal.basis.linePointer;
  assert.equal(value(prefix+'/option'),plan.lineRegistration.optionsQuery.code);
  assert.equal(value(prefix+'/defaultModel/modelCode'),plan.lineRegistration.defaultModel.modelCode);
  assert.equal(value(prefix+'/defaultModel/agModelCode'),plan.lineRegistration.defaultModel.agModelCode);
  assert.equal(value(proposal.basis.includedModelPointer),plan.modelRegistration.modelCode);
  assert.equal(report.relationships.find(row=>row.path===proposal.basis.literalTrimPresencePointer).type,'object');
  assert.equal(proposal.status,'proposal-no-source-grant');assert.equal(plan.modelRegistration.modelCode,'2PMA');assert.equal(plan.lineRegistration.includedIndex,1);
  const urls=bmwModelOptionsRequestUrls({model:plan.modelRegistration,line:plan.lineRegistration});assert.equal(new URL(urls.options).search,'?trim=S0337');assert.equal(plan.limits.sourceAttempts,4);
  assert.deepEqual(plan.limits.requestBudgets,{page:1,settings:1,discover:1,options:1});
});
