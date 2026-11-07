// One root-authorized Linux observation; builtins only, no retry, redirect or source-provider request.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('.',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(join(base,'plan.json'));assert.equal(hash(bytes),process.env.REVIEWED_PLAN_SHA256);
const plan=JSON.parse(bytes),limit=plan.limits;
assert.ok(['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME));assert.equal(process.env.GITHUB_REF,'refs/heads/gcsp-poc');assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');assert.equal(process.platform,'linux');assert.ok(!process.env.REQUESTED_PLAN_SHA256||process.env.REQUESTED_PLAN_SHA256===process.env.REVIEWED_PLAN_SHA256);
assert.equal(plan.diagnosticId,'fleet-dot12-linux-live-20261107-2');assert.equal(plan.manifestDigest,'3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30');assert.equal(plan.status,'prepared-unexecuted-root-review-and-narrow-integration-push-required');assert.equal(plan.deployment.state,'success');assert.equal(plan.deployment.code,'c87b6f075c4e79bee93b71e1965ad23310ab8473');assert.match(plan.deployment.actualDeploymentId,/^dep-[a-z0-9]+$/);assert.ok(Number.isSafeInteger(plan.deployment.githubDeploymentId));assert.ok(Number.isFinite(Date.parse(plan.deployment.completedAt)));assert.equal(Object.keys(plan.runtimePins).length,4);assert.equal(plan.origin,'https://gcsp-api.onrender.com');
assert.deepEqual([limit.newGETs,limit.healthMilliseconds,limit.laterRequestMilliseconds,limit.totalMilliseconds,limit.retries,limit.redirects,limit.responseBodyBytes],[3,90000,30000,150000,0,0,1048576]);
for(const [path,digest] of Object.entries(plan.runtimePins))assert.equal(hash(await readFile(join(process.env.GITHUB_WORKSPACE,path))),digest);
const deploymentBytes=await readFile(join(base,plan.deployment.evidenceFile));assert.equal(hash(deploymentBytes),plan.deployment.evidenceSha256);
const deployment=JSON.parse(deploymentBytes);assert.equal(deployment.state,'success');assert.equal(deployment.code,plan.deployment.code);assert.equal(deployment.actualDeploymentId,plan.deployment.actualDeploymentId);assert.equal(deployment.githubDeploymentId,plan.deployment.githubDeploymentId);assert.equal(deployment.completedAt,plan.deployment.completedAt);assert.equal(deployment.environmentUrl,plan.origin);
const priorBytes=await readFile(join(base,plan.expectedObservationFile));assert.equal(hash(priorBytes),plan.expectedObservationSha256);const prior=JSON.parse(priorBytes),expected=prior.observation;
assert.equal(prior.sourceReceipt.sha256,'d5518728f7c6d84f331c242d4b5ed5499998ae6f5ec3e43d8e3ef14bcd1a4929');assert.equal(prior.sourceReceipt.bytes,632368);assert.equal(prior.manifestDigest,plan.manifestDigest);assert.equal(expected.requestKey,plan.firstReference.rowKey);assert.equal(expected.directPassed,true);assert.equal(expected.httpPassed,true);assert.equal(expected.consumerPassed,true);assert.equal(expected.httpStatus,200);assert.equal(expected.dtoSha256,plan.firstReference.expectedDtoSha256);assert.equal(expected.dtoSha256,'82712c8d703e6546d6c4298fa3a168b2ea48f09c73931ee9eb061ee36f98e2e4');assert.equal(hash(plan.firstReference.encodedPath),plan.firstReference.pathSha256);assert.equal(plan.firstReference.encodedPath,'/api/gcsp/vehicle-evidence/configurations/'+encodeURIComponent(plan.firstReference.request.id));
const output=process.env.PHASE_OUTPUT;assert.ok(output&&output===process.env.TMPDIR);
const started=Date.now(),observations=[];let requests=0,pending=null,failure=null;
async function checkpoint(status){
 const value={schemaVersion:'linux-live-three-get-receipt.v1',diagnosticId:plan.diagnosticId,githubRunId:process.env.GITHUB_RUN_ID,attempt:1,environment:'Linux-GitHubActions',status,code:plan.deployment.code,actualDeploymentId:plan.deployment.actualDeploymentId,manifestDigest:plan.manifestDigest,requests,newGetCeiling:3,sourceCalls:0,startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),pending,observations,failure,expectedDtoSha256:expected.dtoSha256,acceptance:false,originalLocalTimeoutCauseProved:false};
 const path=join(output,['passed','failed'].includes(status)?'receipt.json':'progress.json');const raw=JSON.stringify(value);assert.ok(Buffer.byteLength(raw)<=16384,'receipt-bound');await writeFile(path+'.tmp',raw+'\n');await rename(path+'.tmp',path);
}
const sensitive=/^(?:set-cookie|cookie|authorization|proxy-authorization|x-access-key)$/i;
function boundedHeaders(headers){let count=0;const rows=[];for(const [name,value]of headers){let text=sensitive.test(name)?'[redacted]':value.slice(0,2048);while(Buffer.byteLength(text)>2048)text=text.slice(0,-1);count+=Buffer.byteLength(name+text);assert.ok(count<=16384,'header-byte-bound');rows.push([name,text]);}return JSON.stringify(rows);}
async function get(label,path,milliseconds){
 assert.ok(requests<3);assert.ok(path.startsWith('/')&&!path.startsWith('//'));const remaining=150000-(Date.now()-started);assert.ok(remaining>0,'total-deadline');requests++;pending={label,ordinal:requests,pathSha256:hash(path),state:'reserved-before-fetch'};await checkpoint('in-progress');
 let response,received=0,headerDigest=null;const chunks=[],tick=performance.now();
 try{
  response=await fetch(plan.origin+path,{method:'GET',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(Math.min(milliseconds,remaining))});
  const rawHeaders=boundedHeaders(response.headers);headerDigest=hash(rawHeaders);await writeFile(join(output,label+'-headers.json'),rawHeaders+'\n',{flag:'wx'});
  for await(const chunk of response.body){assert.ok(received+chunk.length<=1048576,'response-byte-bound');received+=chunk.length;chunks.push(chunk);}
  const body=Buffer.concat(chunks);await writeFile(join(output,label+'-body.bin'),body,{flag:'wx'});const entry={label,status:response.status,bodySha256:hash(body),bodyBytes:body.length,headersSha256:headerDigest,elapsedMs:performance.now()-tick};observations.push(entry);pending=null;await checkpoint('in-progress');return {entry,body:JSON.parse(body.toString('utf8'))};
 }catch(error){
  const partial=Buffer.concat(chunks);if(partial.length)await writeFile(join(output,label+'-partial-body.bin'),partial,{flag:'wx'});
  failure={reason:'request-failed',label,name:String(error.name||'Error').slice(0,64),code:String(error.code||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64),status:response?.status??null,receivedBytes:received,headersSha256:headerDigest,elapsedMs:performance.now()-tick,pending};throw error;
 }
}
try{
 await checkpoint('in-progress');
 const health=await get('health','/health',90000);if(health.entry.status!==200||health.body?.ok!==true){failure={reason:'health-unavailable',status:health.entry.status};throw Error('health-unavailable');}
 const readiness=await get('readiness','/health/vehicle-evidence',30000);const state=readiness.body?.vehicleEvidence;const sanitized={ok:readiness.body?.ok===true,status:['ready','loading','unavailable'].includes(state?.status)?state.status:'invalid',manifestDigest:/^[a-f0-9]{64}$/.test(state?.manifestDigest||'')?state.manifestDigest:null,recovered:state?.recovered===true};readiness.entry.sanitizedReadiness=sanitized;await checkpoint('in-progress');
 if(readiness.entry.status!==200||sanitized.ok!==true||sanitized.status!=='ready'||sanitized.manifestDigest!==plan.manifestDigest){failure={reason:'readiness-not-exact-ready',status:readiness.entry.status,readiness:sanitized};throw Error('readiness-not-exact-ready');}
 const actual=await get('configuration',plan.firstReference.encodedPath,30000);actual.entry.dtoSha256=hash(JSON.stringify(actual.body));actual.entry.match=actual.entry.status===200&&actual.entry.dtoSha256===expected.dtoSha256&&actual.body?.versions?.manifestDigest===plan.manifestDigest;await checkpoint('in-progress');
 if(!actual.entry.match){failure={reason:[401,403].includes(actual.entry.status)?'access-key-required':'exact-first-dto-mismatch',status:actual.entry.status};throw Error('first-dto-mismatch');}
 assert.equal(requests,3);assert.ok(Date.now()-started<=150000,'total-deadline');await checkpoint('passed');console.log(JSON.stringify({status:'passed',requests,expectedDtoSha256:expected.dtoSha256,acceptance:false}));
}catch(error){failure??={reason:'probe-failed',name:String(error.name||'Error').slice(0,64),pending};await checkpoint('failed');console.log(JSON.stringify({status:'failed',requests,failure,acceptance:false}));process.exitCode=1;}
