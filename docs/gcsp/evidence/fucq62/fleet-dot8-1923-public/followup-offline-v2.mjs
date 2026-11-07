import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {cp,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {canonicalRequestKey} from './canonical-request-key.mjs';
import {installFleetOfflineGuard} from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));const base=fileURLToPath(new URL('./',import.meta.url));
const plan=JSON.parse(await readFile(join(base,'plan.json')));const followup=JSON.parse(await readFile(join(base,'followup-plan.json')));const output=process.argv[2];const scratch=process.env.TMPDIR;assert([output,scratch].every(isAbsolute));
async function sha(path){const h=createHash('sha256');for await(const bytes of createReadStream(path))h.update(bytes);return h.digest('hex');}
const save=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n');
for(const [name,pin]of [['plan.json',followup.originalPlanSha256],['run.mjs',followup.originalRunnerSha256],['prove-restored.mjs',followup.originalProofHelperSha256]])assert.equal(await sha(join(base,name)),pin);
assert.equal(await sha(followup.publicReceipt),followup.publicReceiptSha256);const publicReceipt=JSON.parse(await readFile(followup.publicReceipt));assert.equal(publicReceipt.status,'real-cli-anonymous-public-restore-passed');assert.equal(publicReceipt.releaseId,plan.releaseId);assert.equal(publicReceipt.restore.mode,'cold-restore');assert.equal(publicReceipt.network.attempts,plan.network.anonymousMaxRequests);assert.equal(publicReceipt.network.denied,0);
// Regression: canonical request keys are invariant to property insertion order.
assert.equal(canonicalRequestKey({kind:'configuration',id:'example'}),canonicalRequestKey({id:'example',kind:'configuration'}));
const release=JSON.parse(await readFile(join(plan.packageRoot,'descriptor.json')));assert.equal(await sha(join(plan.packageRoot,'descriptor.json')),plan.descriptorSha256);assert.equal(publicReceipt.files.length,release.assets.length);
const chained=[];for(const asset of release.assets){const observed=publicReceipt.files.find(row=>row.path===asset.path);assert.deepEqual(observed,{name:asset.name,path:asset.path,bytes:asset.bytes,sha256:asset.sha256});const source=join(plan.packageRoot,'pack',plan.releaseId,asset.path);assert.equal((await stat(source)).size,asset.bytes);assert.equal(await sha(source),asset.sha256);chained.push(observed);}
const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');const run=promisify(execFile);const cacheRoot=join(scratch,'cache');await mkdir(cacheRoot);const cache=join(cacheRoot,plan.releaseId);const store=join(scratch,'restored');
await cp(join(plan.packageRoot,'pack',plan.releaseId),cache,{recursive:true,force:false,errorOnExist:true});
const capture=join(scratch,'child-network.json');const preload=join(scratch,'offline-child.mjs');await writeFile(preload,`import {writeFileSync} from 'node:fs';import {installFleetOfflineGuard} from ${JSON.stringify(pathToFileURL(join(root,'scripts/gcsp/fleet-offline-guard.mjs')).href)};const g=installFleetOfflineGuard();const control=g.control();process.on('exit',()=>writeFileSync(${JSON.stringify(capture)},JSON.stringify({control,calls:g.calls.length})));`);
const env={PATH:process.env.PATH,TMPDIR:scratch,TMP:scratch,TEMP:scratch};async function cli(){const child=await run(process.execPath,['--max-old-space-size=256','--import',preload,join(root,'server/scripts/fleet-artifacts.mjs'),'restore','--release',plan.releaseId,'--store',store,'--cache',cacheRoot,'--network','offline'],{cwd:root,env,maxBuffer:1048576,timeout:180000});assert.deepEqual(JSON.parse(await readFile(capture)),{control:'blocked',calls:0});return JSON.parse(child.stdout);}
let cold,repeated,proof;
try{
 cold=await cli();assert.equal(cold.mode,'cold-restore');assert.equal(cold.active.manifestDigest,plan.releaseId);assert.equal(cold.externalCalls,0);
 for(const name of ['active.json','last-good.json','identity-inventory.json'])assert.deepEqual(await readFile(join(store,name)),await readFile(join(cache,'store',name)));
 repeated=await cli();assert.equal(repeated.idempotent,true);assert.equal(repeated.active.manifestDigest,plan.releaseId);assert.equal(repeated.externalCalls,0);
 await save('offline-restore-receipt.json',{status:'same-public-sha-bytes-offline-cold-and-repeat-passed',releaseId:plan.releaseId,chainedAssets:chained,publicReceiptSha256:followup.publicReceiptSha256,cold,repeated,historySha256:await sha(join(store,'identity-inventory.json')),externalCalls:0});
 // The proof owns its guard in verifyActiveFleet and its continuation; preloading the same guard would collide.
 const child=await run(process.execPath,['--max-old-space-size=256','--expose-gc',join(base,'prove-restored-canonical.mjs'),store,output,cache],{cwd:root,env,maxBuffer:1048576,timeout:240000});proof=JSON.parse(child.stdout);assert.equal(proof.lookupDtoParity,plan.expected.direct);assert.equal(proof.httpUnique,plan.expected.httpUnique);assert.equal(proof.configuredConsumerFailed,plan.expected.configuredConsumerFailed);assert.equal(guard.calls.length,0);
}finally{guard.restore();}
await save('receipt.json',{schemaVersion:'fleet-dot8-same-byte-offline-followup.v1',status:'same-byte-offline-followup-passed-known-consumer-limitation',releaseId:plan.releaseId,publicReceiptSha256:followup.publicReceiptSha256,chainedAssets:chained,offlineRestoreSha256:await sha(join(output,'offline-restore-receipt.json')),dtoHttpProofSha256:await sha(join(output,'dto-http-proof.json')),rawAuditSha256:await sha(join(output,'raw-active-audit.json')),canonicalFailureRequestKeysSha256:followup.canonicalExpectedFailureRequestKeysSha256,proof,originalPublicProofStatus:followup.originalPublicProofStatus,originalPublicProofCompleted:false,newPublicTraffic:0,sourceProviderEgress:0,changedSourceAndImageRecoveryReused:'exact unchanged .8 offline recovery-results.json; public changed-edge step remains unrun',ordinaryActivationExecuted:false,acceptance:false});
console.log(JSON.stringify({status:'same-byte-offline-followup-passed',direct:proof.lookupDtoParity,httpUnique:proof.httpUnique,consumerFailed:proof.configuredConsumerFailed,newPublicTraffic:0}));
