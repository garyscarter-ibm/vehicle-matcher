/** Evidence-local lifecycle checks; finite synthetic protocol fixtures only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { createRangeInventory } from './inventory-source.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'inventory-life-')); t.after(() => rm(root, {recursive:true,force:true}));
  const plan = { schemaVersion:'bmw-source-range-inventory-plan.v1', planId:'inventory-life-fixture', qualificationDate:'2026-11-07',
    source:{id:'bmw-uk-public',kind:'public-bmw-uk',version:'f59-range-inventory-20261107.v1'},
    inventoryRegistration:{schemaVersion:'bmw-public-range-inventory-registration.v1',market:'GB',locale:'en-GB',catalogueRangeKey:'G42',pageModelCode:'2PMC',treeEffectDate:'2026-11-01',treeOrderDate:'2026-11-01'},
    limits:{maxAttempts:1,retryDelayMs:0,concurrency:1,imageRequests:0,sourceAttempts:3,sourceBytes:4194304,responseBytes:1048576,operationTimeoutMs:10000,deadlineMs:90000,checkpointBytes:4194304,cacheEntries:8,cacheRetentionMs:86400000,requestBudgets:{page:1,settings:1,discover:1}}};
  const calls=[]; let failTree=false; let limitTree=false;
  const http={kind:'fixture',fetch:async(url)=>{
    calls.push(url);
    if(url.includes('/configure/'))return new Response('settings.fixture.json',{headers:{'content-type':'text/html'}});
    if(url.includes('/settings.'))return Response.json({APP:{backend:{settingsVehicleTree:{'x-api-key':'PRIVATE_HEADER'}}}});
    if(failTree)throw new Error('fixture-disconnected');
    if(limitTree)return Response.json({2:{modelRanges:{G42:{models:{'2PMC':{modelCode:'2PMC',agModelCode:'12CM',modelRange:'G42',steering:'RL',orderDate:'2026-11-01',effectDate:'2027-01-05'}},lines:{S0337:{includedTransmissionVariants:Array.from({length:129},()=>({}))}}}}}});
    return Response.json({2:{modelRanges:{G42:{models:{'2PMC':{modelCode:'2PMC',agModelCode:'12CM',modelRange:'G42',steering:'RL',orderDate:'2026-11-01',effectDate:'2027-01-05'}}}}}});
  }};
  return {calls,plan,statePath:join(root,'retained-primary.json'),http,mode:'source-fixture',now:()=>Date.parse('2026-11-07T12:00:00Z'),fail:()=>{failTree=true;},limit:()=>{limitTree=true;}};
}
test('caller retains empty admission arrays, resumes exact completed inventory without HTTP and rejects inserted accepted records',async(t)=>{
  const f=await fixture(t); const r=await(await createRangeInventory(f)).run();assert.equal(r.reason,'source-range-inventory-observed');assert.equal(r.admission,false);
  assert.deepEqual(r.accepted,[]);assert.deepEqual(r.rejected,[]);assert.deepEqual(r.duplicates,[]);assert.equal(r.counts.httpAttempts,3);
  assert.deepEqual(await(await createRangeInventory(f)).run(),r);assert.equal(f.calls.length,3);
  const env=JSON.parse(await readFile(f.statePath));env.content.accepted.push({admission:true});env.contentDigest=inputDigest(env.content);await writeFile(f.statePath,JSON.stringify(env));
  await assert.rejects((await createRangeInventory(f)).run(),{code:'checkpoint-corrupt'});
});
test('partially retained bootstrap never repeats requests to recover an ephemeral header',async(t)=>{
  const f=await fixture(t);await(await createRangeInventory(f)).run();const env=JSON.parse(await readFile(f.statePath));
  env.content.inventoryObservation=null;env.contentDigest=inputDigest(env.content);await writeFile(f.statePath,JSON.stringify(env));
  const r=await(await createRangeInventory(f)).run();assert.equal(r.reason,'inventory-interrupted');assert.equal(f.calls.length,3);
  assert.equal((await(await createRangeInventory(f)).run()).reason,'inventory-interrupted');assert.equal(f.calls.length,3);
});
test('a source failure and changed actual observation day are durable and never gain construction credit',async(t)=>{
  for(const kind of ['tree','day']){
    const f=await fixture(t);if(kind==='tree')f.fail();else f.now=()=>Date.parse('2026-11-08T12:00:00Z');
    const r=await(await createRangeInventory(f)).run();assert.equal(r.reason,kind==='tree'?'source-failure':'source-observation-date');const n=f.calls.length;
    await(await createRangeInventory(f)).run();assert.equal(f.calls.length,n);assert.equal(r.inventory,null);assert.deepEqual(r.accepted,[]);
    assert.doesNotMatch(await readFile(f.statePath,'utf8'),/PRIVATE_HEADER/);
  }
});

test('safe inventory limit diagnostic survives a durable stop and no-fetch resume', async(t)=>{
  const f=await fixture(t);f.limit();const r=await(await createRangeInventory(f)).run();
  assert.equal(r.reason,'source-inventory-line-limit');assert.deepEqual(r.inventoryDiagnostic,{schemaVersion:'bmw-inventory-limit.v1',path:'/2/modelRanges/G42/lines/S0337/includedTransmissionVariants',kind:'entries',count:129,limit:128,type:'array'});
  const n=f.calls.length;assert.deepEqual(await(await createRangeInventory(f)).run(),r);assert.equal(f.calls.length,n);
  assert.doesNotMatch(await readFile(f.statePath,'utf8'),/PRIVATE_HEADER/);
});
