import test from 'node:test';
import assert from 'node:assert/strict';
import { proveCurrentOrderReferences } from '../../docs/gcsp/evidence/fucq63/order-reference-2026-11-07/prove-orders.mjs';
test('stale-run order proof refuses before reads or HTTP',async()=>{
 let reads=0;const report=await proveCurrentOrderReferences({repository:{currentRun:async()=>({status:'ok',value:{runId:'next'}}),read:async()=>{reads++;}},context:{runId:'prior',environmentId:'demo',principalId:'proof',roles:['presenter']},stockReferences:['12345678-1234-4123-8123-123456789abc']});assert.equal(report.status,'blocked');assert.equal(reads,0);
});
test('order number and invalid or duplicateUUIDs refuse before repository access',async()=>{
 let calls=0;const repository={currentRun:async()=>{calls++;}};for(const stockReferences of [['1234567'],[],['12345678-1234-4123-8123-123456789abc','12345678-1234-4123-8123-123456789abc']])await assert.rejects(proveCurrentOrderReferences({repository,stockReferences}));assert.equal(calls,0);
});
