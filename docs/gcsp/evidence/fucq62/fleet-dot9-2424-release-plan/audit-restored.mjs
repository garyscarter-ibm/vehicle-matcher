// Unchanged strict verifier, raw invalid-active preserved; source-free retained assets only.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {verifyActiveFleet} from '../../../../../scripts/gcsp/verify-fleet.mjs';
import {PolicyService,FilePolicyProvider} from '../../../../../server/gcsp/policy/index.js';
import {APPROVED_CORPUS_IMAGES} from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import {releaseLimits} from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
const [store,cache,output]=process.argv.slice(2);assert.ok([store,cache,output].every(isAbsolute));const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));const options={sourceArtifactDirectory:cache,approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:releaseLimits,policyService:new PolicyService({provider:new FilePolicyProvider()}),policyRead:{runId:'public-dot9-strict',asOf:'2026-11-07T00:00:00.000Z'}};const raw=await verifyActiveFleet({root:store,requiredDistinct:2424,offline:true,http:false,concurrency:1,...options});await writeFile(join(output,'raw-active-audit.json'),JSON.stringify(raw,null,2)+'\n',{flag:'wx'});assert.equal(raw.status,'invalid-active');assert.equal(raw.manifest.sha256,plan.releaseId);assert.equal(raw.audit.checked,2426);assert.equal(raw.audit.errors,485);assert.equal(raw.actual.sourceConfigurations,2424);assert.equal(raw.actual.configurations,2425);assert.equal(raw.actual.images,2);assert.equal(raw.actual.vinMappings,1);assert.equal(raw.egress.externalCalls+raw.egress.sourceCalls,0);console.log(JSON.stringify({status:raw.status,checked:raw.audit.checked,errors:raw.audit.errors,acceptance:false}));
