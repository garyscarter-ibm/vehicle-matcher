// Existing staged verifier once; no monolithic active/direct/consumer replay.
import assert from 'node:assert/strict';
import {verifyStagedFleet} from '../../../../../scripts/gcsp/verify-fleet.mjs';
import {installFleetOfflineGuard} from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import {packet,save} from './common.mjs';
const p=await packet(),guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');
try{const report=await verifyStagedFleet({artifacts:p.artifacts,requiredDistinct:10000,...p.options});await save(p.output,'staged-semantic-report.json',report);assert.equal(report.status,'verified-staged');assert.equal(report.targetMet,true);assert.equal(report.actual.completeResolvedDistinct,10000);assert.equal(report.actual.distinctConfigurations,10001);assert.equal(report.manifest.sha256,p.receipt.candidateManifestDigest);assert.equal(guard.calls.length,0);await save(p.output,'staged-semantic-receipt.json',{status:'existing-staged-semantic-verifier-passed',manifestDigest:p.receipt.candidateManifestDigest,completeResolvedDistinct:10000,distinctConfigurations:10001,codeIdentity:p.plan.codeIdentity,externalCalls:0,sourceCalls:0,report,activeStrictCliExecuted:false,acceptance:false});}finally{guard.restore();}
