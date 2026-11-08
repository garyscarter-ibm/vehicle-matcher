// Local runtime diagnosis only: actual default buildServer and local registry.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { request } from 'node:http';
import { getHeapStatistics } from 'node:v8';
import { pathToFileURL } from 'node:url';
const [planPath,checkpointPath]=process.argv.slice(2);const plan=JSON.parse(await readFile(planPath));
const start=performance.now();let guard,server;let samples=0;let maxSelfRss=0;
const state={schemaVersion:'local-default-startup-probe.v1',runtime:'local Node26/darwin/arm64; not Render Node20',node:process.version,execArgv:process.execArgv,heapSizeLimitBytes:getHeapStatistics().heap_size_limit,environment:{GCSP_OFFLINE:process.env.GCSP_OFFLINE,databaseConfigured:Boolean(process.env.GCSP_DATABASE_URL),accessKeyConfigured:Boolean(process.env.DEMO_ACCESS_KEY)},ordinaryManifest:plan.manifestDigest,configurationIdSha256:createHash('sha256').update(plan.configurationId).digest('hex'),phase:'initial',sourceCalls:0,acceptance:false};
async function save(){state.elapsedMs=performance.now()-start;state.memory={samples,maxSelfRss,last:process.memoryUsage()};state.externalConnectAttempts=guard?.calls.length??0;await writeFile(checkpointPath,JSON.stringify(state,null,2)+'\n');}
const timer=setInterval(()=>{samples++;maxSelfRss=Math.max(maxSelfRss,process.memoryUsage().rss);},25);timer.unref();
async function get(path) {
 const before=performance.now();
 return new Promise((resolve,reject)=>{
  const req=request(new URL(path,state.endpoint),res=>{
   let body='';let bytes=0;res.setEncoding('utf8');
   res.on('data',part=>{bytes+=Buffer.byteLength(part);if(bytes>2*1024*1024)req.destroy(Error('response-budget'));else body+=part;});
   res.on('error',reject);
   res.on('end',()=>{try{resolve({statusCode:res.statusCode,body:JSON.parse(body),elapsedMs:performance.now()-before,bytes});}catch{reject(Error('invalid-json-response'));}});
  });
  req.setTimeout(80000,()=>req.destroy(Error('request-timeout')));req.on('error',reject);req.end();
 });
}
try {
 const {installFleetOfflineGuard}=await import(pathToFileURL(plan.root+'/scripts/gcsp/fleet-offline-guard.mjs'));
 guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');state.phase='guard-installed';await save();
 const {buildServer}=await import(pathToFileURL(plan.root+'/server/index.js'));state.phase='module-imported';await save();
 server=buildServer();state.phase='server-built-registry-loading';await save();
 server.listen(0,'127.0.0.1');await once(server,'listening');state.endpoint=`http://127.0.0.1:${server.address().port}`;state.phase='listening';await save();
 state.health=await get('/health');state.phase='health-returned';await save();assert.equal(state.health.statusCode,200);assert.deepEqual(state.health.body,{ok:true});
 state.phase='configuration-request-started';await save();const dto=await get('/api/gcsp/vehicle-evidence/configurations/'+encodeURIComponent(plan.configurationId));state.dto={statusCode:dto.statusCode,status:dto.body.status,identityMatches:dto.body.identity?.configurationId===plan.configurationId,manifestMatches:dto.body.versions?.manifestDigest===plan.manifestDigest,elapsedMs:dto.elapsedMs,bytes:dto.bytes,sha256:createHash('sha256').update(JSON.stringify(dto.body)).digest('hex')};state.phase='configuration-returned';await save();assert.ok([200,206].includes(dto.statusCode));assert.ok(['complete','partial'].includes(dto.body.status));assert.equal(state.dto.identityMatches,true);assert.equal(state.dto.manifestMatches,true);assert.equal(guard.calls.length,0);state.status='passed';
}catch(error){state.status='failed';state.error={name:error.name,message:String(error.message).slice(0,300)};process.exitCode=1;}
finally{clearInterval(timer);if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}if(guard){state.externalConnectAttempts=guard.calls.length;guard.restore();}state.phaseAtCompletion=state.phase;state.phase='closed';await save();console.log(JSON.stringify(state));}
