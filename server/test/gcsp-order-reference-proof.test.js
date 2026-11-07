import test from 'node:test';
import assert from 'node:assert/strict';
import { offlineFixture } from './helpers/offline-vehicle-fixture.js';
import { proveCurrentOrderReferences } from '../../docs/gcsp/evidence/fucq63/order-reference-2026-11-07/prove-orders.mjs';
test('order proof reconciles exact current-runUUIDs through direct consuming and actual HTTP ports',async t=>{
 const f=await offlineFixture(t);const report=await proveCurrentOrderReferences({repository:f.repository,registry:f.registry,context:f.context,stockReferences:f.stock.map(row=>row.orderUuid),repositoryProvider:'memory-fixture'});
 t.diagnostic(JSON.stringify({schemaVersion:report.schemaVersion,status:report.status,repositoryProvider:report.repositoryProvider,nativeProof:report.nativeProof,currentRunUnchanged:report.currentRunUnchanged,checked:report.checked,directErrors:report.directErrors,httpErrors:report.httpErrors,consumerErrors:report.consumerErrors,metrics:report.metrics,sourceCalls:report.sourceCalls,externalConnectAttempts:report.externalConnectAttempts,acceptance:false}));
 assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.checked,5);assert.equal(report.nativeProof,false);assert.equal(report.directErrors+report.httpErrors+report.consumerErrors,0);assert.equal(report.sourceCalls+report.externalConnectAttempts,0);assert.equal(report.currentRunUnchanged,true);assert.equal(report.acceptance,false);assert.equal(report.nativeAttempted,false);assert.equal(report.metrics.count,5);assert.ok(report.metrics.elapsedMs>0);assert.ok(report.metrics.p50Ms<=report.metrics.p95Ms&&report.metrics.p95Ms<=report.metrics.p99Ms);assert.equal(report.metrics.noSlaClaim,true);
});
test('stale-run order proof refuses before reads or HTTP',async()=>{
 let reads=0;const report=await proveCurrentOrderReferences({repository:{currentRun:async()=>({status:'ok',value:{runId:'next'}}),read:async()=>{reads++;}},context:{runId:'prior',environmentId:'demo',principalId:'proof',roles:['presenter']},stockReferences:['12345678-1234-4123-8123-123456789abc']});assert.equal(report.status,'blocked');assert.equal(reads,0);
});
test('order number and invalid or duplicateUUIDs refuse before repository access',async()=>{
 let calls=0;const repository={currentRun:async()=>{calls++;}};for(const stockReferences of [['1234567'],[],['12345678-1234-4123-8123-123456789abc','12345678-1234-4123-8123-123456789abc']])await assert.rejects(proveCurrentOrderReferences({repository,stockReferences}));assert.equal(calls,0);
});
