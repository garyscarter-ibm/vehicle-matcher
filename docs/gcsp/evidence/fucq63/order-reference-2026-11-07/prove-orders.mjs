/** Bounded read-only proof around existing stock lookup ports. No generation, reset or migration. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createVehicleEvidenceLookup, canonicalVehicleIdentifier } from '../../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import { createConfiguredVehicleDetails } from '../../../../../server/gcsp/vehicle-evidence/application-vehicle-details.js';
import { vehicleEvidenceHttpStatus } from '../../../../../server/gcsp/vehicle-evidence/vehicle-details-contract.js';
import { installFleetOfflineGuard } from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import { buildServer } from '../../../../../server/index.js';
const fields=['description','technical','equipment','images','source','completeness','presentation','routing'];
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateInputs(context,stockReferences) {
 assert.ok(Array.isArray(stockReferences)&&stockReferences.length>0&&stockReferences.length<=32&&new Set(stockReferences).size===stockReferences.length&&stockReferences.every(id=>canonicalVehicleIdentifier('stock',id)===id),'Supply1–32 exact canonical orderUUIDs.');
 assert.ok(context&&['runId','environmentId','principalId'].every(k=>typeof context[k]==='string'&&context[k].length>0)&&Array.isArray(context.roles)&&context.roles.every(role=>typeof role==='string'&&role.length>0));
}
export async function proveCurrentOrderReferences({repository,registry,context,stockReferences,repositoryProvider='injected-unverified'}={}) {
 validateInputs(context,stockReferences);const proofStart=performance.now();
 const before=await repository.currentRun(context.environmentId);
 if(before.status!=='ok'||before.value?.runId!==context.runId)return {status:'blocked',reason:'current-run-mismatch-or-unavailable',nativeProof:false,repositoryProvider,acceptance:false};
 const expected=[];for(const id of stockReferences){const found=await repository.read(context,{table:'stock',key:{runId:context.runId,orderUuid:id}});if(found.status!=='ok')return {status:'blocked',reason:'exact-stock-reference-unavailable',repositoryProvider,nativeProof:false,acceptance:false};expected.push(found.value);}
 const lookup=createVehicleEvidenceLookup({registry,repository});const consumer=createConfiguredVehicleDetails({lookup});const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');let server;let sourceCalls=0;const observations=[];
 try {
  const denied=()=>{sourceCalls++;throw Error('Source unavailable during order proof');};server=buildServer({fetchRetailerStock:denied,fetchNearbyStock:denied,enrichColours:denied,fetchDealerDirectory:denied,geocodePostcode:denied,gcspVehicleEvidence:{lookup,resolveContext:async()=>({status:'ok',value:context})}});server.listen(0,'127.0.0.1');await once(server,'listening');const endpoint=`http://127.0.0.1:${server.address().port}`;
  for(const row of expected){const start=performance.now();const request={kind:'stock',id:row.orderUuid};const direct=await lookup.resolve(request,{context});const configuration=await lookup.resolve({kind:'configuration',id:row.configurationId},{context});const consumed=await consumer.resolve(request,{context});const response=await new Promise((resolve,reject)=>{const headers=process.env.DEMO_ACCESS_KEY?{'X-Access-Key':process.env.DEMO_ACCESS_KEY}:{};const req=httpRequest(new URL(`/api/gcsp/vehicle-evidence/stock/${encodeURIComponent(row.orderUuid)}`,endpoint),{headers},res=>{let text='';let bytes=0;res.setEncoding('utf8');res.on('data',part=>{bytes+=Buffer.byteLength(part);if(bytes>2*1024*1024)req.destroy(Error('Response budget'));else text+=part;});res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});req.setTimeout(5000,()=>req.destroy(Error('HTTP deadline')));req.on('error',reject);req.end();});
   const association=row.facts?.syntheticIdentity;const directPassed=['partial','complete'].includes(direct.status)&&direct.identity?.configurationId===row.configurationId&&direct.identity.orderUuid===row.orderUuid&&direct.identity.orderNumber===row.orderNumber&&direct.identity.vehicleId===association?.vehicleId&&direct.identity.originatingDatasetId===association?.originatingDatasetId&&direct.versions?.snapshot===association?.snapshotVersion&&['corpus','manifestDigest','snapshot'].every(k=>direct.versions?.[k]===configuration.versions?.[k])&&direct.versions?.generator===(association?.generatorVersion||null)&&fields.every(k=>isDeepStrictEqual(direct[k],configuration[k]));
   const consumerPassed=consumed.status===direct.status&&consumed.vehicle&&isDeepStrictEqual(consumed.vehicle,Object.fromEntries(Object.keys(consumed.vehicle).map(k=>[k,direct[k]])));
   observations.push({orderUuid:row.orderUuid,orderNumber:row.orderNumber,configurationIdSha256:sha(row.configurationId),directStatus:direct.status,directPassed,httpPassed:response.status===vehicleEvidenceHttpStatus(direct)&&isDeepStrictEqual(response.body,direct),consumerStatus:consumed.status,consumerPassed:Boolean(consumerPassed),dtoSha256:sha(direct),elapsedMs:performance.now()-start});
  }
  const after=await repository.currentRun(context.environmentId);const currentRunUnchanged=after.status==='ok'&&after.value?.runId===context.runId;const directErrors=observations.filter(o=>!o.directPassed).length;const httpErrors=observations.filter(o=>!o.httpPassed).length;const consumerErrors=observations.filter(o=>!o.consumerPassed).length;
  const passed=currentRunUnchanged&&directErrors===0&&httpErrors===0&&consumerErrors===0&&sourceCalls===0&&guard.calls.length===0;const elapsedMs=performance.now()-proofStart;const timings=observations.map(o=>o.elapsedMs).sort((a,b)=>a-b);const percentile=p=>timings[Math.max(0,Math.ceil(timings.length*p)-1)];
  return {schemaVersion:'current-order-reference-proof.v1',status:passed?'passed':'failed',repositoryProvider,nativeAttempted:repositoryProvider==='postgresql',nativeProof:passed&&repositoryProvider==='postgresql',metrics:{scope:'sequential exact-order sample; direct plus consumer plus loopback HTTP per observation',count:observations.length,elapsedMs,ordersPerSecond:observations.length*1000/elapsedMs,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),node:process.version,platform:process.platform,architecture:process.arch,noSlaClaim:true},runId:context.runId,environmentId:context.environmentId,currentRunUnchanged,scope:'explicit exact current-run orderUUID sample',checked:observations.length,directErrors,httpErrors,consumerErrors,observations,sourceCalls,externalConnectAttempts:guard.calls.length,databaseTraffic:'Existing injected repository reads; native execution requires separately approved runtime plan. No fixture fallback.',acceptance:false};
 } finally {if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}guard.restore();}
}

async function main() {
 const [flag,planPath,receiptFlag,receiptPath]=process.argv.slice(2);assert.equal(flag,'--plan');assert.equal(receiptFlag,'--receipt');assert.ok([planPath,receiptPath].every(isAbsolute));assert.match(process.env.TMPDIR||'',/\/test-stamp-shard-[a-f0-9]+$/);
 const plan=JSON.parse(await readFile(planPath));assert.equal(plan.schemaVersion,'native-current-order-proof-plan.v1');assert.equal(plan.repositoryProvider,'postgresql');assert.equal(plan.sourceRequests,0);assert.equal(plan.maxOrderReferences,32);assert.ok(isAbsolute(plan.store));assert.ok(plan.asOf&&Number.isFinite(Date.parse(plan.asOf)));
 validateInputs(plan.context,plan.stockReferences);
 let repository;let report;
 try {
  if(!process.env.GCSP_DATABASE_URL)report={status:'blocked',reason:'native-database-configuration-unavailable',nativeProof:false,acceptance:false};
  else {
   const {createPostgresRepository}=await import('../../../../../server/gcsp/repository/postgres.js');
   const {createSyntheticRegistry}=await import('../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js');
   const {createPolicyService,FilePolicyProvider}=await import('../../../../../server/gcsp/policy/index.js');
   const {releaseLimits}=await import('../../../../../server/gcsp/vehicle-evidence/fleet-release.js');
   const {APPROVED_CORPUS_IMAGES}=await import('../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js');
   repository=createPostgresRepository({migrate:false,schema:plan.schema||'public'});const opened=await repository.open();
   if(opened.status!=='ok')report={status:'blocked',reason:'native-database-open-or-migration-status-unavailable',nativeProof:false,acceptance:false};
   else {
    const registry=createSyntheticRegistry({root:plan.store,policyService:createPolicyService({provider:new FilePolicyProvider()}),policyRead:{runId:plan.context.runId,asOf:plan.asOf},jsonlLimitsForManifest:releaseLimits,approvedImages:APPROVED_CORPUS_IMAGES});const loaded=await registry.load();
    report=loaded.status==='ok'?await proveCurrentOrderReferences({repository,registry,context:plan.context,stockReferences:plan.stockReferences,repositoryProvider:'postgresql'}):{status:'blocked',reason:'native-current-corpus-unavailable',nativeProof:false,acceptance:false};
   }
  }
 } catch {report={status:'blocked',reason:'native-order-proof-unavailable',nativeProof:false,acceptance:false};}
 finally {if(repository)await repository.close();}
 await writeFile(receiptPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));process.exitCode=report.status==='passed'?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
