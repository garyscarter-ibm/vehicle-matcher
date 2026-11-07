// Scoped cross-runtime restored boundary: five actual references. Prior 10002 observations remain historical evidence; corrected runtime receives only this scoped check.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {validateCorpusDirectory} from '../../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import {createSyntheticRegistry} from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import {createVehicleEvidenceLookup} from '../../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import {createConfiguredVehicleDetails} from '../../../../../server/gcsp/vehicle-evidence/application-vehicle-details.js';
import {vehicleEvidenceHttpStatus} from '../../../../../server/gcsp/vehicle-evidence/vehicle-details-contract.js';
import {PolicyService,FilePolicyProvider} from '../../../../../server/gcsp/policy/index.js';
import {APPROVED_CORPUS_IMAGES} from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import {releaseLimits} from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import {installFleetOfflineGuard} from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import {buildServer} from '../../../../../server/index.js';
const hash=b=>createHash('sha256').update(b).digest('hex');const key=r=>hash(JSON.stringify([r.kind,r.id]));
const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));const [store,cache,output]=process.argv.slice(2);assert.ok([store,cache,output].every(isAbsolute));
const expectedBytes=await readFile(new URL('./boundary-observations.json',import.meta.url));assert.equal(hash(expectedBytes),plan.boundaryObservations.sha256);const expected=JSON.parse(expectedBytes).actual;
const options={indexed:true,approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:releaseLimits,sourceArtifactDirectory:cache,policyService:new PolicyService({provider:new FilePolicyProvider()}),policyRead:{runId:'dot12-owned-offline-proof',asOf:'2026-11-07T00:00:00.000Z'}};
const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');let server;let sourceCalls=0;const actual=[];const start=performance.now();
async function progress(status){const file=join(output,'boundary-progress.json');await writeFile(file+'.tmp',JSON.stringify({status,manifestDigest:plan.releaseId,actual,acceptance:false},null,2)+'\n');await rename(file+'.tmp',file);}
try{
 const registry=createSyntheticRegistry({root:store,...options});assert.equal((await registry.load()).active.manifestDigest,plan.releaseId);const corpus=await validateCorpusDirectory(join(store,'versions',plan.releaseId),options);assert.equal(corpus.status,'ok');const all=[...corpus.corpus.configurations.metadataEntries()].map(e=>({kind:'configuration',id:e.key}));for(const e of corpus.corpus.vins.metadataEntries())all.push({kind:'vin',id:e.vin17});assert.equal(all.length,10002);assert.equal(hash(all.map(key).sort().join('\n')+'\n'),plan.expected.allRequestSetSha256);
 const lookup=createVehicleEvidenceLookup({registry});const consumer=createConfiguredVehicleDetails({lookup,timeoutMs:5000,maxAttempts:1});const supplement=corpus.manifest?.technicalSupplements??JSON.parse(await readFile(join(store,'versions',plan.releaseId,'manifest.json'))).technicalSupplements;assert.equal(supplement.length,1);const exact=await lookup.resolve({kind:'configuration',id:supplement[0].configurationId});for(const [name,fact] of Object.entries(supplement[0].facts))assert.deepEqual(exact.technical[name],fact);assert.equal(exact.technical.bodyLength.state,'unknown');
 const denied=()=>{sourceCalls++;throw Error('Source unavailable during public proof');};server=buildServer({fetchRetailerStock:denied,fetchNearbyStock:denied,enrichColours:denied,fetchDealerDirectory:denied,geocodePostcode:denied,gcspVehicleEvidence:{lookup,resolveContext:async()=>({status:'source-unavailable'})}});server.listen(0,'127.0.0.1');await once(server,'listening');const endpoint=`http://127.0.0.1:${server.address().port}`;
 for(const selected of expected){const request={kind:selected.kind,id:selected.id};const direct=await lookup.resolve(request);const consumed=await consumer.resolve(request);const collection={configuration:'configurations',vin:'vins'}[request.kind];const response=await new Promise((resolve,reject)=>{const req=httpRequest(new URL(`/api/gcsp/vehicle-evidence/${collection}/${encodeURIComponent(request.id)}`,endpoint),res=>{let text='',bytes=0;res.setEncoding('utf8');res.on('data',part=>{bytes+=Buffer.byteLength(part);if(bytes>2097152)req.destroy(Error('response budget'));else text+=part;});res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});req.setTimeout(5000,()=>req.destroy(Error('HTTP deadline')));req.on('error',reject);req.end();});const observed={requestKey:key(request),dtoSha256:hash(JSON.stringify(direct)),directStatus:direct.status,httpStatus:response.status,consumerStatus:consumed.status,consumerPassed:Boolean(consumed.status===direct.status&&consumed.vehicle&&isDeepStrictEqual(consumed.vehicle,Object.fromEntries(Object.keys(consumed.vehicle).map(k=>[k,direct[k]])))),consumerFailure:consumed.failure??null};
  assert.equal(direct.versions?.manifestDigest,plan.releaseId);assert.equal(response.status,vehicleEvidenceHttpStatus(direct));assert.deepEqual(response.body,direct);const prior=selected.expected;for(const name of Object.keys(observed))assert.deepEqual(observed[name],prior[name],name+' differs from exact offline observation');actual.push(observed);if(actual.length%64===0)await progress('in-progress');
 }
 assert.equal(sourceCalls,0);assert.equal(guard.calls.length,0);
}catch(error){await progress('failed-partial');throw error;}finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}guard.restore();}
await progress('completed');const failed=actual.filter(r=>!r.consumerPassed);const receipt={status:failed.length?'exact-public-dto-http-parity-consumer-acceptance-failed':'exact-public-dto-http-and-consumer-parity',manifestDigest:plan.releaseId,count:actual.length,actual,consumerErrors:failed.length,sourceCalls,externalCalls:guard.calls.length,serverClosed:true,elapsedMs:performance.now()-start,acceptance:false};await writeFile(join(output,'boundary-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({count:actual.length,consumerErrors:failed.length,externalCalls:guard.calls.length,sourceCalls,acceptance:false}));
