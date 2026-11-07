import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { projectContractDiagnostic, createContractDiagnostic } from './diagnostic.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const registration = {schemaVersion:'bmw-public-range-inventory-registration.v1',market:'GB',locale:'en-GB',catalogueRangeKey:'G42',pageModelCode:'2PMC',treeEffectDate:'2026-11-01',treeOrderDate:'2026-11-01'};
const model = {modelCode:'2PMC',agModelCode:'12CM',modelRange:'G42',steering:'RL',orderDate:'2026-11-01',effectDate:'2027-01-05'};
const raw = (key='BASE_LINE', index='0') => ({2:{modelRanges:{G42:{models:{'2PMC':{...model}},lines:{[key]:{option:'S0337',defaultModel:{modelCode:'2PMC',agModelCode:'12CM'},includedTransmissionVariants:{[index]:{modelCode:'2PMC',configuration:{elements:{[key]:{ignored:'RAW_PAYLOAD'}},modelCode:'2PMC'}}}}},unrelated:{token:'UNRELATED_SECRET'}}}}});

test('retains the exact rejected line key/path/type plus direct bounded relationships', () => {
  const r = projectContractDiagnostic(raw(), registration, ['PRIVATE_HEADER']);
  assert.equal(r.originalRefusal,'source-inventory-line-key');
  assert.deepEqual(r.rejectedContract,{gate:'line',path:'/2/modelRanges/G42/lines/BASE_LINE',key:'BASE_LINE',type:'object'});
  assert.equal(r.modelNodes[0].facts.modelCode,'2PMC');
  assert.equal(r.relationships.find(row=>row.path.endsWith('/defaultModel/modelCode')).value,'2PMC');
  assert.equal(r.relationships.find(row=>row.path.endsWith('/elements/BASE_LINE')).type,'object');
  assert.equal(r.admitted,0); assert.doesNotMatch(JSON.stringify(r),/RAW_PAYLOAD|UNRELATED_SECRET/);
});
test('distinguishes the variant gate and preserves production acceptance when no key is rejected', () => {
  const r = projectContractDiagnostic(raw('S0337','VARIANT_KEY_LONGER_THAN_16'),registration,[]);
  assert.equal(r.rejectedContract.gate,'variant'); assert.equal(r.rejectedContract.key,'VARIANT_KEY_LONGER_THAN_16');
  assert.match(r.rejectedContract.path,/\/includedTransmissionVariants\/VARIANT_KEY_LONGER_THAN_16$/);
  const valid=projectContractDiagnostic(raw('S0337'),registration,[]);
  assert.equal(valid.originalRefusal,null); assert.equal(valid.rejectedContract,null);
});
test('refuses secret-bearing keys and facts without including them in refusal text', () => {
  for(const key of ['PRIVATE_HEADER','https://example.invalid/?token=SECRET','WBA12345678901234','api_key_secret']) {
    assert.throws(()=>projectContractDiagnostic(raw(key),registration,['PRIVATE_HEADER']),e=>e.code==='diagnostic-privacy-refused'&&!e.message.includes(key));
  }
  const tree=raw(); tree[2].modelRanges.G42.models['2PMC'].modelName='PRIVATE_HEADER';
  assert.throws(()=>projectContractDiagnostic(tree,registration,['PRIVATE_HEADER']),{code:'diagnostic-privacy-refused'});
});
test('refuses finite relationship bounds without retaining raw values', () => {
  const tree=raw(); tree[2].modelRanges.G42.lines=Object.fromEntries(Array.from({length:129},(_,i)=>['LINE_'+i,{}]));
  assert.throws(()=>projectContractDiagnostic(tree,registration,[]),{code:'diagnostic-lines-limit'});
  const variants=raw(); variants[2].modelRanges.G42.lines.BASE_LINE.includedTransmissionVariants=Array.from({length:129},()=>({}));
  assert.throws(()=>projectContractDiagnostic(variants,registration,[]),{code:'diagnostic-variants-limit'});
});

const execFile=promisify(execFileCallback);
const plan=()=>({schemaVersion:'bmw-source-range-inventory-plan.v1',planId:'g42-safe-contract-diagnostic-20261107',qualificationDate:'2026-11-07',
  source:{id:'bmw-uk-public',kind:'public-bmw-uk',version:'f59-range-inventory-20261107.v1'},inventoryRegistration:registration,
  limits:{maxAttempts:1,retryDelayMs:0,concurrency:1,imageRequests:0,sourceAttempts:3,sourceBytes:4194304,responseBytes:1048576,operationTimeoutMs:10000,deadlineMs:90000,checkpointBytes:4194304,cacheEntries:8,cacheRetentionMs:86400000,requestBudgets:{page:1,settings:1,discover:1}}});
async function fixture(t,tree=raw()) {
  const root=await mkdtemp(join(tmpdir(),'g42-diagnostic-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  return {root,get calls(){return calls;},plan:plan(),mode:'source-fixture',statePath:join(root,'collector-checkpoint.json'),now:()=>Date.parse('2026-11-07T12:00:00Z'),
    http:{kind:'fixture',fetch:async url=>{calls++; if(url.includes('/configure/'))return new Response('settings.fixture.json',{headers:{'content-type':'text/html'}});
      if(url.includes('/settings.'))return Response.json({APP:{backend:{settingsVehicleTree:{'x-api-key':'PRIVATE_HEADER'}}}});
      return Response.json(tree);}}};
}
test('durably retains exact diagnostic and resumes without source or bootstrap material',async t=>{
  const f=await fixture(t); const first=await(await createContractDiagnostic(f)).run();
  assert.equal(first.reason,'source-contract-diagnostic-observed');assert.equal(first.counts.httpAttempts,3);assert.equal(f.calls,3);
  assert.equal(first.diagnostic.document.report.rejectedContract.key,'BASE_LINE');
  assert.deepEqual(await(await createContractDiagnostic(f)).run(),first);assert.equal(f.calls,3);
  assert.doesNotMatch(await readFile(f.statePath,'utf8'),/PRIVATE_HEADER|RAW_PAYLOAD|UNRELATED_SECRET/);
  const env=JSON.parse(await readFile(f.statePath));env.content.accepted.push({id:'FORBIDDEN'});env.contentDigest=inputDigest(env.content);await writeFile(f.statePath,JSON.stringify(env));
  await assert.rejects((await createContractDiagnostic(f)).run(),{code:'checkpoint-corrupt'});
});
test('privacy failure and incomplete primary are durable no-refetch stops',async t=>{
  const f=await fixture(t,raw('PRIVATE_HEADER'));const first=await(await createContractDiagnostic(f)).run();
  assert.equal(first.reason,'diagnostic-privacy-refused');assert.equal(first.diagnostic,null);assert.equal(f.calls,3);
  await(await createContractDiagnostic(f)).run();assert.equal(f.calls,3);assert.doesNotMatch(await readFile(f.statePath,'utf8'),/PRIVATE_HEADER/);
  const g=await fixture(t);await(await createContractDiagnostic(g)).run();const env=JSON.parse(await readFile(g.statePath));
  env.content.diagnosticObservation=null;env.contentDigest=inputDigest(env.content);await writeFile(g.statePath,JSON.stringify(env));
  assert.equal((await(await createContractDiagnostic(g)).run()).reason,'diagnostic-interrupted');assert.equal(g.calls,3);
});
test('primary exporter retains safe actual text before scratch removal',async t=>{
  const f=await fixture(t);await(await createContractDiagnostic(f)).run();
  await execFile('/usr/bin/python3',['-I','-B',fileURLToPath(new URL('./export-retained.py',import.meta.url)),f.root],{env:{PATH:'/usr/bin:/bin'},maxBuffer:65536});
  const doc=JSON.parse(await readFile(join(f.root,'diagnostic.json')));assert.equal(doc.report.rejectedContract.key,'BASE_LINE');
  assert.equal(JSON.parse(await readFile(join(f.root,'checkpoint-export.json'))).accepted,0);
  assert.doesNotMatch(await readFile(join(f.root,'collector-state.json'),'utf8'),/PRIVATE_HEADER|RAW_PAYLOAD/);
});
test('runner and supervisor refuse no-grant before marker, primary or transport',async()=>{
  for(const [exe,args] of [[process.execPath,[fileURLToPath(new URL('./run-live.mjs',import.meta.url))]],['/usr/bin/python3',['-I','-B',fileURLToPath(new URL('./supervise.py',import.meta.url)),'live']]]) {
    await assert.rejects(execFile(exe,args,{env:{PATH:'/opt/homebrew/bin:/usr/bin:/bin'},maxBuffer:65536}),e=>/explicit-root-traffic-grant-required/.test(e.stderr));
  }
  for(const name of ['execution-once.json','collector-checkpoint.json','source-events.jsonl']) await assert.rejects(readFile(new URL('./'+name,import.meta.url)),{code:'ENOENT'});
});
