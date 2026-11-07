/** Offline safety checks only: no HTTP transport/grant; subprocess fetch tripwire. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validatePublicBmwInventoryPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base=dirname(fileURLToPath(import.meta.url));const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const read=p=>JSON.parse(readFileSync(p,'utf8'));const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const allocation=read(join(base,'execution-plan.json'));const plan=read(join(base,'qualification-plan.json'));
const unspent=['execution-once.json','collector-checkpoint.json','collector-state.json','inventory.json','source-events.jsonl','receipt.json'];

test('strict inventory plan allocates only exact request inputs and three GETs',()=>{
  assert.deepEqual(validatePublicBmwInventoryPlan(plan),plan);assert.equal(plan.source.version,'f59-range-inventory-20261107.v1');
  assert.deepEqual(plan.inventoryRegistration,{schemaVersion:'bmw-public-range-inventory-registration.v1',market:'GB',locale:'en-GB',catalogueRangeKey:'G42',pageModelCode:'2PMC',treeEffectDate:'2026-11-01',treeOrderDate:'2026-11-01'});
  assert.equal(plan.limits.sourceAttempts,3);assert.deepEqual(plan.limits.requestBudgets,{page:1,settings:1,discover:1});
  assert.deepEqual(allocation.requestSequence,['page','settings','discover']);assert.equal(allocation.attempts,3);
  for(const k of ['optionsAllowance','solverAllowance','candidateAllowance','sourceCapacityCredit'])assert.equal(allocation[k],0);
  assert.equal(allocation.acceptance,false);
});
test('historical official seed is a request lead with all returned vehicle facts explicitly unknown',()=>{
  const p=read(join(base,'seed-provenance.json'));assert.equal(p.pageUrl,'https://configure.bmw.co.uk/en_GB/configure/G42/2PMC');
  assert.equal(p.historicalExtractAcquiredDate,'2026-10-18');assert.equal(p.currentSourceVerified,false);assert.equal(p.originalExtractIndependentlyFetched,false);
  assert.deepEqual(p.requestScope,plan.inventoryRegistration);assert.deepEqual(allocation.historicalSeedBasis,p);
  assert.deepEqual(p.unknownReturnedFacts,['agModelCode','rawModelRange','aliases','steering','modelOrderDate','modelEffectDate','lineRelationships']);
});
test('frozen pins, bounded resource reservation and first-write primary retention agree',()=>{
  assert.equal(inputDigest(plan),allocation.planDigest);assert.equal(allocation.codeCommit,'f6273b88c5992788c548d1a4816002f36295ed00');
  for(const [p,expected]of Object.entries(allocation.codePins))assert.equal(sha(join(root,p)),expected,p);
  assert.equal(sha(join(base,'prepare.py')),allocation.preparerSha256);const r=read(join(base,'execution-reservation.json'));
  assert.equal(r.status,'prepared-unspent-no-traffic-grant');assert.equal(r.allocationId,allocation.id);assert.equal(r.planDigest,allocation.planDigest);
  assert.equal(r.executionPlanSha256,sha(join(base,'execution-plan.json')));assert.equal(r.exclusiveMarkerCreatedOnlyByLiveRunner,join(base,'execution-once.json'));
  assert.deepEqual(allocation.resources,{workers:1,retries:0,scratchBytes:67108864,hostRamBytes:536870912,childRamBytes:469762048});
  assert.equal(allocation.sourceDeadlineSeconds,90);assert.equal(allocation.supervisorChildSeconds,105);assert.equal(allocation.supervisorChunkSeconds,120);
  const retention=read(join(base,'retained-deliverables.json'));assert.equal(retention.disposable,false);assert.equal(retention.retainOnInterruption,true);
  assert.equal(retention.exportBeforeScratchCleanup,true);assert.equal(retention.primary,join(base,'collector-checkpoint.json'));assert.deepEqual(retention.embeddedArtifacts,['inventoryObservation']);
  for(const n of unspent)assert.equal(existsSync(join(base,n)),false,n);
});
test('prepared scripts parse without source execution',()=>{
  const p=spawnSync('/usr/bin/python3',['-I','-B','-c','import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(), filename=p) for p in sys.argv[1:]]',join(base,'prepare.py'),join(base,'supervise.py')],{encoding:'utf8',timeout:10000});assert.equal(p.status,0,p.stderr);
  const n=spawnSync(process.execPath,['--check',join(base,'run-live.mjs')],{encoding:'utf8',timeout:10000});assert.equal(n.status,0,n.stderr);
});
test('runner refuses missing grant before marker, primary or fetch',()=>{
  const env={...process.env};delete env.BMW_RANGE_INVENTORY_SOURCE_GRANT;
  const tripwire='data:text/javascript,globalThis.fetch=async()=>{process.stderr.write("FORBIDDEN_FETCH_REACHED");throw new Error("forbidden-offline-fetch")};';
  const c=spawnSync(process.execPath,['--import',tripwire,join(base,'run-live.mjs')],{encoding:'utf8',timeout:10000,maxBuffer:65536,env});
  assert.equal(c.status,1,c.stderr);assert.match(c.stderr,/explicit-root-traffic-grant-required/);assert.doesNotMatch(c.stderr+c.stdout,/FORBIDDEN_FETCH_REACHED/);
  for(const n of unspent)assert.equal(existsSync(join(base,n)),false,n);
});
test('supervisor refuses missing grant before resource allocation or child start',()=>{
  const env={...process.env};delete env.BMW_RANGE_INVENTORY_SOURCE_GRANT;
  const c=spawnSync('/usr/bin/python3',['-I','-B',join(base,'supervise.py'),'live'],{encoding:'utf8',timeout:10000,maxBuffer:65536,env});
  assert.equal(c.status,1,c.stderr);assert.match(c.stderr,/explicit-root-traffic-grant-required/);assert.equal(existsSync(allocation.scratchRoot),false);
  for(const n of unspent)assert.equal(existsSync(join(base,n)),false,n);
});
