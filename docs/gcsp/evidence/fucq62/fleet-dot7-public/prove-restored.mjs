import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {verifyActiveFleet} from '../../../../../scripts/gcsp/verify-fleet.mjs';
import {validateCorpusDirectory} from '../../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import {createSyntheticRegistry} from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import {createVehicleEvidenceLookup} from '../../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import {createConfiguredVehicleDetails} from '../../../../../server/gcsp/vehicle-evidence/application-vehicle-details.js';
import {vehicleEvidenceHttpStatus} from '../../../../../server/gcsp/vehicle-evidence/vehicle-details-contract.js';
import {createPolicyService} from '../../../../../server/gcsp/policy/index.js';
import {APPROVED_CORPUS_IMAGES} from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import {releaseLimits} from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import {installFleetOfflineGuard} from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import {buildServer} from '../../../../../server/index.js';
function matchesRetained(result, record, images, manifestDigest) {
  if (!['partial', 'complete'].includes(result?.status) || !record) return false;
  const source = record.sourceContext; const catalogue = record.catalogue; const configuration = record.configuration;
  return result.identity?.configurationId === record.configurationId && result.versions?.manifestDigest === manifestDigest
    && result.versions.snapshot === record.snapshotVersion
    && [['model', 'model'], ['derivative', 'derivative'], ['generation', 'generation'], ['bodyType', 'body']]
      .every(([field, stored]) => result.description?.[field]?.value === configuration[stored])
    && [['fuel', 'powertrain'], ['drive', 'drive'], ['transmission', 'transmission'], ['engine', 'engineCode']]
      .every(([field, stored]) => result.description?.powertrain?.[field]?.value === configuration[stored])
    && ['market', 'region', 'steering', 'agModelCode', 'vgModelCode', 'modelYear', 'productionEra', 'productionDate']
      .every((field) => result.source?.[field] === configuration[field])
    && result.source?.kind === source.sourceKind
    && result.source.observedDate === source.observedDate && result.source.catalogueDate === source.catalogueDate
    && isDeepStrictEqual(result.source.configurationIdentity, record.canonicalIdentity)
    && isDeepStrictEqual(result.source.references, source.sourceRefs)
    && isDeepStrictEqual(result.source.unresolvedFacts, source.unresolvedFacts)
    && result.completeness?.selectedOptions === source.selectedOptionCompleteness
    && (catalogue ? isDeepStrictEqual(result.equipment?.selected?.options, record.canonicalIdentity.factoryOptionCodes)
      : result.equipment?.selected?.state === 'unknown')
    && (!catalogue || Object.entries(catalogue.facts || {}).every(([key, fact]) => isDeepStrictEqual(result.technical?.[key], fact)))
    && isDeepStrictEqual((result.images?.items || []).map(({ imageId, asset, role, fidelity, sourceKind, observedDate }) =>
      ({ imageId, asset, role, fidelity, sourceKind, observedDate })), images.map(({ imageId, asset, role, fidelity, sourceKind, observedDate }) =>
      ({ imageId, asset, role, fidelity, sourceKind, observedDate })))
    && result.presentation?.syntheticLabel === 'Synthetic identity' && result.presentation?.unknownLabel === 'Unknown'
    && result.presentation?.sourceLabel === (source.sourceKind === 'dated-snapshot' ? 'Dated catalogue snapshot' : 'North American structural reference')
    && result.routing?.mode === 'offline' && result.routing.liveEligible === false;
}

const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));const [store,output,cache]=process.argv.slice(2);assert([store,output,cache].every(isAbsolute));const expected=plan.expected;
const options={approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:releaseLimits,sourceArtifactDirectory:cache,policyService:createPolicyService(),policyRead:{runId:'public-dot7-cold-restart',asOf:'2026-11-07T00:00:00.000Z'}};
const report=await verifyActiveFleet({root:store,requiredDistinct:expected.sourceConfigurations,offline:true,http:true,endpoint:'http://127.0.0.1:0',concurrency:1,sampleSize:expected.httpSample,...options});
await writeFile(join(output,'raw-active-audit.json'),JSON.stringify(report,null,2)+'\n');
assert.equal(report.status,'invalid-active');assert.equal(report.reason.code,'active-reconciliation-failed');assert.equal(report.manifest.sha256,plan.releaseId);assert.equal(report.actual.sourceConfigurations,expected.sourceConfigurations);assert.equal(report.actual.configurations,expected.configurations);assert.equal(report.actual.images,expected.images);assert.equal(report.audit.checked,expected.direct);assert.equal(report.audit.errors,expected.configuredConsumerFailed);assert.equal(report.http.requests,expected.httpSample);assert.equal(report.http.errors,0);assert.equal(report.http.serverClosed,true);assert.equal(report.egress.externalCalls,0);assert.equal(report.egress.sourceCalls,0);
if(globalThis.gc)globalThis.gc();
const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');let server;let sourceCalls=0;const known=[];const actual=[];
try{
 const registry=createSyntheticRegistry({root:store,...options});assert.equal((await registry.load()).active.manifestDigest,plan.releaseId);
 const checked=await validateCorpusDirectory(join(store,'versions',plan.releaseId),{...options,indexed:true});assert.equal(checked.status,'ok');const rows=checked.corpus;
 const lookup=createVehicleEvidenceLookup({registry});const consumer=createConfiguredVehicleDetails({lookup,timeoutMs:5000,maxAttempts:1});
 for(const expectedFailure of plan.knownConsumerFailures){const direct=await lookup.resolve(expectedFailure.request);const consumed=await consumer.resolve(expectedFailure.request);const row=rows.configurations.get(expectedFailure.request.id);assert.equal(row.configuration.vgModelCode,expectedFailure.vgModelCode);const images=[...rows.images].filter(i=>i.configurationId===row.configurationId);assert(matchesRetained(direct,row,images,plan.releaseId));assert.equal(consumed.status,'source-unavailable');known.push({request:expectedFailure.request,vgModelCode:expectedFailure.vgModelCode,directStatus:direct.status,consumedStatus:consumed.status,matchesRetained:true});}
 // These exact two failures exhaust the verifier error count; every other combined direct/consumer case passed.
 assert.equal(known.length,report.audit.errors);
 const requests=[...rows.configurations.metadataEntries()].map(e=>({kind:'configuration',id:e.key}));for(const e of rows.vins.metadataEntries())requests.push({kind:'vin',id:e.vin17});assert.equal(requests.length,expected.direct);
 const key=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');const all=requests.map(key);const sample=Array.from({length:expected.httpSample},(_,i)=>key(requests[Math.floor(i*requests.length/expected.httpSample)]));const sampled=new Set(sample);assert.equal(sampled.size,expected.httpSample);assert.equal(new Set(all).size,expected.direct);
 const remaining=requests.filter(r=>!sampled.has(key(r)));assert.equal(remaining.length,expected.httpComplement);
 const denied=()=>{sourceCalls++;throw Error('Source unavailable during offline parity');};server=buildServer({fetchRetailerStock:denied,fetchNearbyStock:denied,enrichColours:denied,fetchDealerDirectory:denied,geocodePostcode:denied,gcspVehicleEvidence:{lookup,resolveContext:async()=>({status:'source-unavailable'})}});server.listen(0,'127.0.0.1');await once(server,'listening');const endpoint=`http://127.0.0.1:${server.address().port}`;
 for(const request of remaining){const direct=await lookup.resolve(request);assert.equal(direct.versions.manifestDigest,plan.releaseId);const collection={configuration:'configurations',vin:'vins'}[request.kind];const response=await new Promise((resolve,reject)=>{const req=httpRequest(new URL(`/api/gcsp/vehicle-evidence/${collection}/${encodeURIComponent(request.id)}`,endpoint),res=>{let text='';let size=0;res.setEncoding('utf8');res.on('data',part=>{size+=Buffer.byteLength(part);if(size>2*1024*1024)req.destroy(Error('response budget'));else text+=part;});res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});req.setTimeout(5000,()=>req.destroy(Error('deadline')));req.on('error',reject);req.end();});assert.equal(response.status,vehicleEvidenceHttpStatus(direct));assert.deepEqual(response.body,direct);actual.push({requestKey:key(request),dtoSha256:createHash('sha256').update(JSON.stringify(response.body)).digest('hex'),manifestDigest:plan.releaseId});}
 const complement=actual.map(r=>r.requestKey);assert.equal(complement.filter(k=>sampled.has(k)).length,0);const union=new Set([...sample,...complement]);assert.equal(union.size,expected.httpUnique);assert.deepEqual([...union].sort(),[...all].sort());assert.equal(sourceCalls,0);assert.equal(guard.calls.length,0);
 await writeFile(join(output,'dto-http-proof.json'),JSON.stringify({status:'dto-http-passed-known-consumer-limitation',manifestDigest:plan.releaseId,rawAuditStatus:report.status,lookupDtoParity:{checked:expected.direct,passed:expected.direct,failed:0,evidence:'all-record combined audit has exactly two errors; both exact known consumers reproduced and their direct DTOs separately match retained rows'},configuredConsumer:{passed:expected.configuredConsumerPassed,failed:known.length,known,severity:'Medium',acceptanceWaiver:false},http:{sampleKeys:sample,complement:actual,allRequestKeys:all,unionUnique:union.size,overlap:0},sourceCalls,externalCalls:guard.calls.length,acceptance:false},null,2)+'\n');
}finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}guard.restore();}
console.log(JSON.stringify({status:'dto-http-passed-known-consumer-limitation',lookupDtoParity:expected.direct,configuredConsumerPassed:expected.configuredConsumerPassed,configuredConsumerFailed:known.length,httpUnique:expected.httpUnique,httpOverlap:0,sourceCalls,externalCalls:guard.calls.length,acceptance:false}));
