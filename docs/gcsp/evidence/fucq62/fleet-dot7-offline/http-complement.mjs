// Exact111 complement through the existing port and HTTP server; no runtime API change.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createSyntheticRegistry } from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import { vehicleEvidenceHttpStatus } from '../../../../../server/gcsp/vehicle-evidence/vehicle-details-contract.js';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { releaseLimits } from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { indexJsonl } from '../../../../../server/gcsp/vehicle-evidence/indexed-jsonl.js';
import { installFleetOfflineGuard } from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import { buildServer } from '../../../../../server/index.js';
const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));const output=plan.outputRoot;const prior=JSON.parse(await readFile(join(output,'audit-receipt.json')));const release=JSON.parse(await readFile(join(output,'descriptor.json')));
const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');let server;let sourceCalls=0;const actual=[];
try{
 const options={approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:releaseLimits,policyService:createPolicyService(),policyRead:{runId:'dot7-http-complement',asOf:'2026-11-07T00:00:00.000Z'}};
 const registry=createSyntheticRegistry({root:join(output,'isolated-store'),...options});const loaded=await registry.load();assert.equal(loaded.active.manifestDigest,release.releaseId);
 const configurations=await indexJsonl(join(plan.candidateDirectory,'configurations.jsonl'),{key:r=>r.configurationId});const vins=await indexJsonl(join(plan.candidateDirectory,'vins.jsonl'),{key:r=>r.vehicleId,metadata:r=>({vin17:r.vin17})});
 const requests=[...configurations.metadataEntries()].map(e=>({kind:'configuration',id:e.key}));for(const e of vins.metadataEntries())requests.push({kind:'vin',id:e.vin17});
 const key=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');assert.deepEqual(requests.map(key),prior.allRequestKeys);
 const selected=new Set(prior.httpSampleRequestKeys);const complement=requests.filter(r=>!selected.has(key(r)));assert.equal(complement.length,111);
 const lookup=createVehicleEvidenceLookup({registry});const denied=()=>{sourceCalls++;throw Error('Source unavailable during offline parity');};
 server=buildServer({fetchRetailerStock:denied,fetchNearbyStock:denied,enrichColours:denied,fetchDealerDirectory:denied,geocodePostcode:denied,gcspVehicleEvidence:{lookup,resolveContext:async()=>({status:'source-unavailable'})}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const endpoint=`http://127.0.0.1:${server.address().port}`;
 for(const request of complement){
  const direct=await lookup.resolve(request);assert.equal(direct.versions.manifestDigest,release.releaseId);const collection={configuration:'configurations',vin:'vins'}[request.kind];
  const response=await new Promise((resolve,reject)=>{const req=httpRequest(new URL(`/api/gcsp/vehicle-evidence/${collection}/${encodeURIComponent(request.id)}`,endpoint),res=>{let text='';let size=0;res.setEncoding('utf8');res.on('data',part=>{size+=Buffer.byteLength(part);if(size>2*1024*1024)req.destroy(Error('response budget'));else text+=part;});res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});req.setTimeout(5000,()=>req.destroy(Error('deadline')));req.on('error',reject);req.end();});
  assert.equal(response.status,vehicleEvidenceHttpStatus(direct));assert.deepEqual(response.body,direct);assert.equal(response.body.versions.manifestDigest,release.releaseId);
  actual.push({requestKey:key(request),dtoSha256:createHash('sha256').update(JSON.stringify(response.body)).digest('hex'),manifestDigest:release.releaseId});
 }
 const actualKeys=actual.map(r=>r.requestKey);assert.deepEqual(actualKeys,prior.remainingHttpKeys);assert.equal(actualKeys.filter(k=>selected.has(k)).length,0);const union=[...selected,...actualKeys];assert.equal(new Set(union).size,1135);assert.deepEqual([...new Set(union)].sort(),[...prior.allRequestKeys].sort());assert.equal(guard.calls.length,0);assert.equal(sourceCalls,0);
}finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}guard.restore();}
await writeFile(join(output,'http-complement-receipt.json'),JSON.stringify({status:'exact-http-complement-and1135-union-passed',manifestDigest:release.releaseId,actual,httpSampleKeys:prior.httpSampleRequestKeys,allRequestKeys:prior.allRequestKeys,unionUnique:1135,overlap:0,httpRequests:111,combinedHttpRequests:1135,directRequests:1135,dtoAndManifestExact:true,serverClosed:true,externalCalls:guard.calls.length,sourceCalls,ordinaryPublicationExecuted:false,acceptance:false},null,2)+'\n');console.log(JSON.stringify({direct:1135,combinedHttp:1135,complement:111,uniqueUnion:1135,overlap:0,egress:0}));
