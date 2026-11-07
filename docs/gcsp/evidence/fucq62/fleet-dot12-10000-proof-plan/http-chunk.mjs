import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { once } from 'node:events';
import { writeFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { validateCorpusDirectory } from '../../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import { createConfiguredVehicleDetails } from '../../../../../server/gcsp/vehicle-evidence/application-vehicle-details.js';
import { vehicleEvidenceHttpStatus } from '../../../../../server/gcsp/vehicle-evidence/vehicle-details-contract.js';
import { installFleetOfflineGuard } from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import { buildServer } from '../../../../../server/index.js';
import {matchesRetained} from './matches-retained.mjs';
import { packet,requests,requestKey,hash,save } from './common.mjs';
const p=await packet();const chunk=Number(process.argv[2]);assert.ok([0,1,2,3,4,5,6,7,8,9].includes(chunk));const startIndex=chunk*1024,endIndex=Math.min(10002,startIndex+1024);let server,report;let sourceCalls=0;const actual=[];const measuredStart=performance.now();
const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');
async function progress(status){const path=join(p.output,`http-chunk${chunk}-progress.json`);const temp=path+'.tmp';await writeFile(temp,JSON.stringify({status,manifestDigest:p.receipt.candidateManifestDigest,chunk,startIndex,endIndex,completed:actual.length,actual,sourceCalls,externalCalls:guard.calls.length,acceptance:false},null,2)+'\n');await rename(temp,path);}
try {
 const checked=await validateCorpusDirectory(p.artifacts,p.options);assert.equal(checked.status,'ok');assert.equal(checked.manifestDigest,p.receipt.candidateManifestDigest);const all=requests(checked.corpus);const selected=all.slice(startIndex,endIndex);assert.equal(selected.length,[1024,1024,1024,1024,1024,1024,1024,1024,1024,786][chunk]);
 const imageAssociations=new Map();for(const image of checked.corpus.images){const ids=imageAssociations.get(image.configurationId)||[];ids.push(image.imageId);imageAssociations.set(image.configurationId,ids);}
 const registry=createSyntheticRegistry({root:p.store,...p.options});const loaded=await registry.load();assert.equal(loaded.active.manifestDigest,p.receipt.candidateManifestDigest);const lookup=createVehicleEvidenceLookup({registry});const consumer=createConfiguredVehicleDetails({lookup,timeoutMs:5000,maxAttempts:1});
 const denied=()=>{sourceCalls++;throw Error('Source unavailable during proof');};server=buildServer({fetchRetailerStock:denied,fetchNearbyStock:denied,enrichColours:denied,fetchDealerDirectory:denied,geocodePostcode:denied,gcspVehicleEvidence:{lookup,resolveContext:async()=>({status:'source-unavailable'})}});server.listen(0,'127.0.0.1');await once(server,'listening');const endpoint=`http://127.0.0.1:${server.address().port}`;
 for(const request of selected){const before=performance.now();const direct=await lookup.resolve(request);const consumed=await consumer.resolve(request);const collection={configuration:'configurations',vin:'vins'}[request.kind];
  const response=await new Promise((resolve,reject)=>{
   const req=httpRequest(new URL(`/api/gcsp/vehicle-evidence/${collection}/${encodeURIComponent(request.id)}`,endpoint),res=>{let body='';let bytes=0;res.setEncoding('utf8');res.on('data',part=>{bytes+=Buffer.byteLength(part);if(bytes>2*1024*1024)req.destroy(Error('response-budget'));else body+=part;});res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(body)});}catch{reject(Error('invalid-json-response'));}});});req.setTimeout(5000,()=>req.destroy(Error('http-deadline')));req.on('error',reject);req.end();
  });
  const record=checked.corpus.configurations.get(direct.identity?.configurationId),images=[...new Set([...(record?.imageIds||[]),...(imageAssociations.get(record?.configurationId)||[])])].map(id=>checked.corpus.images.get(id)),supplement=checked.manifest.technicalSupplements?.find(s=>s.configurationId===record?.configurationId);
  const retainedPassed=matchesRetained(direct,record,images,p.receipt.candidateManifestDigest,supplement);const directPassed=retainedPassed&&['partial','complete'].includes(direct.status)&&direct.versions?.manifestDigest===p.receipt.candidateManifestDigest&&direct.requested?.id===request.id&&direct.requested?.kind===request.kind;
  const httpPassed=response.status===vehicleEvidenceHttpStatus(direct)&&isDeepStrictEqual(response.body,direct);const consumerPassed=consumed.status===direct.status&&consumed.vehicle&&isDeepStrictEqual(consumed.vehicle,Object.fromEntries(Object.keys(consumed.vehicle).map(k=>[k,direct[k]])));
  actual.push({requestKey:requestKey(request),kind:request.kind,configurationIdSha256:hash(direct.identity?.configurationId||''),model:direct.source?.vgModelCode??null,directStatus:direct.status,retainedPassed,directPassed,httpStatus:response.status,httpPassed,consumerStatus:consumed.status,consumerPassed:Boolean(consumerPassed),consumerFailure:consumed.failure??null,dtoSha256:hash(JSON.stringify(direct)),elapsedMs:performance.now()-before});if(actual.length%64===0)await progress('in-progress');
 }
 assert.equal(guard.calls.length,0);assert.equal(sourceCalls,0);
 const directErrors=actual.filter(o=>!o.directPassed).length,httpErrors=actual.filter(o=>!o.httpPassed).length,consumerFailures=actual.filter(o=>!o.consumerPassed);const failuresByModel={};for(const o of consumerFailures)failuresByModel[o.model]=(failuresByModel[o.model]||0)+1;
 report={status:directErrors||httpErrors?'parity-failed':consumerFailures.length?'parity-passed-consumer-failed':'parity-and-consumer-passed',manifestDigest:p.receipt.candidateManifestDigest,chunk,startIndex,endIndex,count:actual.length,allRequestSetSha256:hash(all.map(requestKey).sort().join('\n')+'\n'),actual,directErrors,httpErrors,consumerErrors:consumerFailures.length,consumerFailuresByModel:failuresByModel,externalCalls:0,sourceCalls,codeIdentity:p.plan.codeIdentity,environment:{nodeVersion:process.version,platform:process.platform,arch:process.arch,offline:true},retainedComparatorBodySha256:p.plan.retainedHelperBodySha256,stockScope:'not-supplied; native current-run UUID proof unrun',ordinaryPublicationExecuted:false,acceptance:false};
}catch(error){await progress('failed-partial');throw error;}finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}guard.restore();}

await progress('completed');
const timings=actual.map(o=>o.elapsedMs).sort((a,b)=>a-b);const nth=p=>timings[Math.min(timings.length-1,Math.floor(timings.length*p))];await save(p.output,`http-chunk${chunk}-receipt.json`,{...report,serverClosed:true,metrics:{count:actual.length,elapsedMs:performance.now()-measuredStart,p50Ms:nth(.5),p95Ms:nth(.95),p99Ms:nth(.99),scope:'sequential direct+consumer+loopbackHTTP, includes registry load in total elapsed',noSlaClaim:true}});assert.equal(report.directErrors+report.httpErrors,0,'Actual parity failures retained; consumer failures remain acceptance gaps.');
