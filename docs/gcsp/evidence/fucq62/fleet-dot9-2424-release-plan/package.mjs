// Existing packer only; registration patch must already have received a separate root release.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {packFleetRelease} from '../../../../../server/gcsp/vehicle-evidence/fleet-artifacts.js';
import {fleetReleases} from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import {installFleetOfflineGuard} from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import {context,check,save} from './common.mjs';
const {plan,descriptor,output}=await context('pack');assert.deepEqual(fleetReleases.find(r=>r.releaseId===plan.releaseId),descriptor);const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');
try{for(const asset of descriptor.assets)await check({...asset,path:asset.role==='source'?join(plan.sourceRoot,asset.origin):join(plan.isolatedStore,asset.path.slice(6))});await mkdir(join(output,'pack'));const result=await packFleetRelease({releaseId:plan.releaseId,output:join(output,'pack'),store:plan.isolatedStore,sourceRoot:plan.sourceRoot});assert.equal(result.files,24);assert.equal(result.bytes,plan.expected.bytes);assert.equal(guard.calls.length,0);await save(output,'receipt.json',{...result,descriptorSha256:plan.descriptor.sha256,externalCalls:0,ordinaryPublicationExecuted:false,publicUploadExecuted:false,acceptance:false});}finally{guard.restore();}
