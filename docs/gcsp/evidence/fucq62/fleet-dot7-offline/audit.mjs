// Existing verifier: all direct records and its supported deterministic1024 HTTP sample.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyActiveFleet } from '../../../../../scripts/gcsp/verify-fleet.mjs';
import { indexJsonl } from '../../../../../server/gcsp/vehicle-evidence/indexed-jsonl.js';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { releaseLimits } from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));const output=plan.outputRoot;
const release=JSON.parse(await readFile(join(output,'descriptor.json')));const options={approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:releaseLimits,policyService:createPolicyService(),policyRead:{runId:'dot7-all-records',asOf:'2026-11-07T00:00:00.000Z'}};
const report=await verifyActiveFleet({root:join(output,'isolated-store'),requiredDistinct:1133,offline:true,http:true,endpoint:'http://127.0.0.1:0',concurrency:1,sampleSize:1024,...options});
assert.equal(report.status,'verified-active',JSON.stringify(report));assert.equal(report.audit.checked,1135);assert.equal(report.audit.errors,0);assert.equal(report.http.requests,1024);assert.equal(report.http.errors,0);assert.equal(report.http.serverClosed,true);assert.equal(report.egress.externalCalls,0);assert.equal(report.egress.sourceCalls,0);assert.equal(report.manifest.sha256,release.releaseId);
const configurations=await indexJsonl(join(plan.candidateDirectory,'configurations.jsonl'),{key:r=>r.configurationId});const vins=await indexJsonl(join(plan.candidateDirectory,'vins.jsonl'),{key:r=>r.vehicleId,metadata:r=>({vin17:r.vin17})});
const requests=[...configurations.metadataEntries()].map(e=>({kind:'configuration',id:e.key}));for(const e of vins.metadataEntries())requests.push({kind:'vin',id:e.vin17});assert.equal(requests.length,1135);
const key=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');const all=requests.map(key);const sample=Array.from({length:1024},(_,i)=>key(requests[Math.floor(i*requests.length/1024)]));assert.equal(new Set(all).size,1135);assert.equal(new Set(sample).size,1024);
await writeFile(join(output,'audit-receipt.json'),JSON.stringify({status:'all-direct-and-supported-http-sample-passed',manifestDigest:release.releaseId,report,allRequestKeys:all,httpSampleRequestKeys:sample,httpSampleAlgorithm:'requests[Math.floor(index*requests.length/1024)] in unchanged verifyActiveFleet',remainingHttpKeys:all.filter(k=>!new Set(sample).has(k)),limitation:{severity:'Medium',issue:'Existing verifier sampleSize cap1024; exact111 complement checked operationally without repairing production cap',backlogBug:'pending root filing; authenticated Jira unavailable'},ordinaryPublicationExecuted:false,acceptance:false},null,2)+'\n');console.log(JSON.stringify({direct:1135,http:1024,remainingHttp:111,errors:0,egress:0}));
