import {canonicalRequestKey} from './canonical-request-key.mjs';
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

const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));
const [store,output,cache]=process.argv.slice(2);assert([store,output,cache].every(isAbsolute));const expected=plan.expected;
assert.ok(expected.httpSample<=1024&&expected.httpComplement<=1024);
const options={approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:releaseLimits,sourceArtifactDirectory:cache,policyService:createPolicyService(),policyRead:{runId:'public-dot8-cold-restart',asOf:'2026-11-07T00:00:00.000Z'}};
const report=await verifyActiveFleet({root:store,requiredDistinct:expected.sourceConfigurations,offline:true,http:true,endpoint:'http://127.0.0.1:0',concurrency:1,sampleSize:expected.httpSample,...options});
await writeFile(join(output,'raw-active-audit.json'),JSON.stringify(report,null,2)+'\n');
assert.equal(report.status,plan.knownConsumerDefect.rawVerifierStatus);assert.equal(report.reason.code,'active-reconciliation-failed');assert.equal(report.manifest.sha256,plan.releaseId);
for(const field of ['sourceConfigurations','configurations','images','vinMappings'])assert.equal(report.actual[field],expected[field]);
assert.equal(report.audit.checked,expected.direct);assert.equal(report.audit.errors,expected.configuredConsumerFailed);assert.equal(report.http.requests,expected.httpSample);assert.equal(report.http.errors,0);assert.equal(report.http.serverClosed,true);assert.equal(report.egress.externalCalls,0);assert.equal(report.egress.sourceCalls,0);
if(globalThis.gc)globalThis.gc();
const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');let server;let sourceCalls=0;const failures=[];const actual=[];const dtoChunks=[];let dtoChecked=0;
const key=canonicalRequestKey;
const summaryPath='docs/gcsp/evidence/fucq62/fleet-dot8-1923-offline/summary.json';const summaryBytes=await readFile(new URL('../fleet-dot8-1923-offline/summary.json',import.meta.url));assert.equal(createHash('sha256').update(summaryBytes).digest('hex'),plan.offlineEvidence[summaryPath]);const expectedFailureKeys=JSON.parse(summaryBytes).configuredConsumer.failures.map(row=>key(row.request)).sort();const expectedFailureDigest=createHash('sha256').update(expectedFailureKeys.join('\n')+'\n').digest('hex');const followup=JSON.parse(await readFile(new URL('./followup-plan.json',import.meta.url)));assert.equal(expectedFailureDigest,followup.canonicalExpectedFailureRequestKeysSha256);
try{
 const registry=createSyntheticRegistry({root:store,...options});assert.equal((await registry.load()).active.manifestDigest,plan.releaseId);
 const checked=await validateCorpusDirectory(join(store,'versions',plan.releaseId),{...options,indexed:true});assert.equal(checked.status,'ok');const rows=checked.corpus;
 const lookup=createVehicleEvidenceLookup({registry});const consumer=createConfiguredVehicleDetails({lookup,timeoutMs:5000,maxAttempts:1});
 const imageAssociations=new Map();for(const image of rows.images){const ids=imageAssociations.get(image.configurationId)||[];ids.push(image.imageId);imageAssociations.set(image.configurationId,ids);}
 const requests=[...rows.configurations.metadataEntries()].map(e=>({kind:'configuration',id:e.key}));for(const e of rows.vins.metadataEntries())requests.push({kind:'vin',id:e.vin17});assert.equal(requests.length,expected.direct);
 // Count all actual consumer failures independently in bounded chunks. No fixed list or count of two is assumed.
 for(let offset=0;offset<requests.length;offset+=1024){const chunk=requests.slice(offset,offset+1024);let failed=0;
  for(const request of chunk){const direct=await lookup.resolve(request);const consumed=await consumer.resolve(request);const row=rows.configurations.get(direct.identity?.configurationId);const images=[...new Set([...(row?.imageIds||[]),...(imageAssociations.get(row?.configurationId)||[])])].map(id=>rows.images.get(id));
   assert.ok(matchesRetained(direct,row,images,plan.releaseId),'direct DTO differs from retained record');dtoChecked++;
   const consumerMatches=consumed.status===direct.status&&consumed.vehicle&&isDeepStrictEqual(consumed.vehicle,Object.fromEntries(Object.keys(consumed.vehicle).map(k=>[k,direct[k]])));
   if(!consumerMatches){assert.equal(consumed.status,'source-unavailable');assert.ok(Object.hasOwn(plan.knownConsumerDefect.expectedFailuresPerVgModelCode,row.configuration.vgModelCode));assert.ok(row.sourceContext.sourceRefs.some(ref=>new URL(ref).searchParams.has('mandatory-elements')&&new URL(ref).searchParams.get('mandatory-elements')===''));
    failures.push({request,requestKey:key(request),vgModelCode:row.configuration.vgModelCode,directStatus:direct.status,consumedStatus:consumed.status,matchesRetained:true,emptyMandatoryElementsCitation:true});failed++;}
  }dtoChunks.push({offset,checked:chunk.length,dtoPassed:chunk.length,consumerPassed:chunk.length-failed,consumerFailed:failed,requestKeys:chunk.map(key)});
 }
 assert.equal(dtoChecked,expected.direct);assert.equal(failures.length,report.audit.errors);assert.equal(failures.length,expected.configuredConsumerFailed);
 const failureKeyDigest=createHash('sha256').update(failures.map(f=>f.requestKey).sort().join('\n')+'\n').digest('hex');assert.deepEqual(failures.map(row=>row.requestKey).sort(),expectedFailureKeys);assert.equal(failureKeyDigest,expectedFailureDigest);
 const byModel={};for(const failure of failures)byModel[failure.vgModelCode]=(byModel[failure.vgModelCode]||0)+1;assert.deepEqual(byModel,plan.knownConsumerDefect.expectedFailuresPerVgModelCode);
 const all=requests.map(key);const sample=Array.from({length:expected.httpSample},(_,i)=>key(requests[Math.floor(i*requests.length/expected.httpSample)]));const sampled=new Set(sample);assert.equal(sampled.size,expected.httpSample);assert.equal(new Set(all).size,expected.direct);
 const remaining=requests.filter(r=>!sampled.has(key(r)));assert.equal(remaining.length,expected.httpComplement);
 const denied=()=>{sourceCalls++;throw Error('Source unavailable during offline parity');};server=buildServer({fetchRetailerStock:denied,fetchNearbyStock:denied,enrichColours:denied,fetchDealerDirectory:denied,geocodePostcode:denied,gcspVehicleEvidence:{lookup,resolveContext:async()=>({status:'source-unavailable'})}});server.listen(0,'127.0.0.1');await once(server,'listening');const endpoint=`http://127.0.0.1:${server.address().port}`;
 for(const request of remaining){const direct=await lookup.resolve(request);assert.equal(direct.versions.manifestDigest,plan.releaseId);const collection={configuration:'configurations',vin:'vins'}[request.kind];const response=await new Promise((resolve,reject)=>{const req=httpRequest(new URL(`/api/gcsp/vehicle-evidence/${collection}/${encodeURIComponent(request.id)}`,endpoint),res=>{let text='';let size=0;res.setEncoding('utf8');res.on('data',part=>{size+=Buffer.byteLength(part);if(size>2*1024*1024)req.destroy(Error('response budget'));else text+=part;});res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});req.setTimeout(5000,()=>req.destroy(Error('deadline')));req.on('error',reject);req.end();});assert.equal(response.status,vehicleEvidenceHttpStatus(direct));assert.deepEqual(response.body,direct);actual.push({requestKey:key(request),dtoSha256:createHash('sha256').update(JSON.stringify(response.body)).digest('hex'),manifestDigest:plan.releaseId});}
 const complement=actual.map(r=>r.requestKey);assert.equal(complement.filter(k=>sampled.has(k)).length,0);const union=new Set([...sample,...complement]);assert.equal(union.size,expected.httpUnique);assert.deepEqual([...union].sort(),[...all].sort());assert.equal(sourceCalls,0);assert.equal(guard.calls.length,0);
 await writeFile(join(output,'dto-http-proof.json'),JSON.stringify({schemaVersion:'fleet-dot8-canonical-followup-dto-http-proof.v1',proofBoundary:'zero-network restored retained pack with every asset chained to actual public SHA/size receipt; original public proof remains failed',status:'dto-http-passed-known-consumer-limitation',manifestDigest:plan.releaseId,rawAuditStatus:report.status,lookupDtoParity:{checked:dtoChecked,passed:dtoChecked,failed:0,chunks:dtoChunks},configuredConsumer:{checked:dtoChecked,passed:dtoChecked-failures.length,failed:failures.length,failures,failuresPerVgModelCode:byModel,failureRequestKeysSha256:failureKeyDigest,severity:plan.knownConsumerDefect.severity,acceptanceWaiver:false},http:{sampleKeys:sample,complement:actual,allRequestKeys:all,unionUnique:union.size,overlap:0},sourceCalls,externalCalls:guard.calls.length,acceptance:false},null,2)+'\n');
}finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}guard.restore();}
console.log(JSON.stringify({status:'dto-http-passed-known-consumer-limitation',lookupDtoParity:dtoChecked,configuredConsumerPassed:dtoChecked-failures.length,configuredConsumerFailed:failures.length,httpUnique:expected.httpUnique,httpOverlap:0,sourceCalls,externalCalls:guard.calls.length,acceptance:false}));
