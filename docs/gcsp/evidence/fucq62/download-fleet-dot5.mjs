import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fleetReleases } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
const run=promisify(execFile);const root=fileURLToPath(new URL('../../../../',import.meta.url));const output=process.argv[2];const scratch=process.env.TMPDIR;
const release=fleetReleases.find((r)=>r.version==='2026-11-07.5');const cacheRoot=join(scratch,'cache');const store=join(scratch,'restored');
async function sha(p){const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');}
const save=async(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n');
const capture=join(output,'public-network-receipt.json');const preload=join(scratch,'public-download-preload.mjs');
await writeFile(preload,`import {writeFileSync} from 'node:fs';
import {approvedAssetUrl} from ${JSON.stringify(pathToFileURL(join(root,'server/gcsp/vehicle-evidence/fleet-release.js')).href)};
const original=globalThis.fetch;const requests=[];let denied=0;
globalThis.fetch=async(url,options)=>{try{approvedAssetUrl(String(url));const headers=new Headers(options?.headers);if(headers.has('authorization')||headers.has('cookie'))throw Error('anonymous transport required');}catch(e){denied++;throw e;}
const response=await original(url,options);requests.push({host:new URL(url).hostname,status:response.status});return response;};
process.on('exit',()=>writeFileSync(${JSON.stringify(capture)},JSON.stringify({requests,denied,authorization:false,cookie:false})));`);
const env={PATH:process.env.PATH,TMPDIR:scratch,TMP:scratch,TEMP:scratch};
const restoreArgs=['--release',release.releaseId,'--store',store,'--cache',cacheRoot];
const first=await run(process.execPath,['--max-old-space-size=256','--import',preload,join(root,'server/scripts/fleet-artifacts.mjs'),'restore',...restoreArgs,'--network','download'],{cwd:root,env,maxBuffer:1048576});
const restored=JSON.parse(first.stdout);assert.equal(restored.status,'ok');assert.equal(restored.mode,'cold-restore');assert.equal(restored.active.manifestDigest,release.releaseId);
const network=JSON.parse(await readFile(capture));assert.equal(network.denied,0);assert.equal(network.requests.filter((r)=>r.status===200).length,19);assert.equal(restored.externalCalls,network.requests.length);
const files=[];for(const asset of release.assets){const p=join(cacheRoot,release.releaseId,asset.path);assert.equal((await stat(p)).size,asset.bytes);assert.equal(await sha(p),asset.sha256);files.push({name:asset.name,path:asset.path,bytes:asset.bytes,sha256:asset.sha256});}
assert.equal(files.length,20);assert.equal(files.filter((a)=>a.bytes===0).length,1);
for(const p of ['active.json','identity-inventory.json'])assert.deepEqual(await readFile(join(store,p)),await readFile(join(cacheRoot,release.releaseId,'store',p)));
await save('download-receipt.json',{status:'real-cli-anonymous-public-restore-passed',releaseId:release.releaseId,runtime:process.version,files,bytes:files.reduce((n,a)=>n+a.bytes,0),network,
 publicFiles:19,trustedEmptyLocalFiles:1,restore:restored,authorization:false,cookie:false,ordinaryPublicationExecuted:false});
const offlinePreload=join(scratch,'offline-preload.mjs');const offlineCapture=join(output,'offline-network-receipt.json');
await writeFile(offlinePreload,`import {writeFileSync} from 'node:fs';import {installFleetOfflineGuard} from ${JSON.stringify(pathToFileURL(join(root,'scripts/gcsp/fleet-offline-guard.mjs')).href)};const g=installFleetOfflineGuard();const control=g.control();process.on('exit',()=>writeFileSync(${JSON.stringify(offlineCapture)},JSON.stringify({control,calls:g.calls.length})));`);
if(globalThis.gc)globalThis.gc();
const second=await run(process.execPath,['--max-old-space-size=256','--import',offlinePreload,join(root,'server/scripts/fleet-artifacts.mjs'),'restore',...restoreArgs,'--network','offline'],{cwd:root,env,maxBuffer:1048576});
const offline=JSON.parse(second.stdout);assert.equal(offline.idempotent,true);assert.equal(offline.active.manifestDigest,release.releaseId);assert.equal(offline.externalCalls,0);assert.deepEqual(JSON.parse(await readFile(offlineCapture)),{control:'blocked',calls:0});
const verified=await run(process.execPath,['--max-old-space-size=256',join(root,'scripts/gcsp/verify-fleet.mjs'),'--active','--store',store,'--require-distinct','479','--offline','--http','--endpoint','http://127.0.0.1:0','--concurrency','1','--sample-size','481','--run-id','public-dot5-cold-restart','--as-of','2026-11-07T00:00:00.000Z'],{cwd:root,env,maxBuffer:1048576});
const audit=JSON.parse(verified.stdout);assert.equal(audit.status,'verified-active');assert.equal(audit.actual.images,1);assert.equal(audit.audit.checked,481);assert.equal(audit.audit.errors,0);assert.equal(audit.http.requests,481);assert.equal(audit.http.errors,0);assert.equal(audit.http.serverClosed,true);assert.equal(audit.egress.externalCalls,0);assert.equal(audit.egress.sourceCalls,0);
const image='assets/gcsp-vehicle-evidence/fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe.webp';assert.equal((await stat(join(root,image))).size,82798);assert.equal(await sha(join(root,image)),'fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe');
await save('offline-restart-receipt.json',{status:'actual-cli-fresh-offline-restart-passed',releaseId:release.releaseId,restore:offline,audit,staticImage:{asset:image,bytes:82798,sha256:await sha(join(root,image)),actualDeployedGetEvidence:'docs/gcsp/evidence/fucq62/render-build-restore-2026-11-07/layout-source.json'},providerEgress:0});
if(globalThis.gc)globalThis.gc();
const recovery=await run(process.execPath,['--max-old-space-size=256',join(root,'docs/gcsp/evidence/fucq62/recover-fleet-dot5.mjs'),output],{cwd:root,env,maxBuffer:1048576});console.log(recovery.stdout.trim());
await save('receipt.json',{status:'public-real-cli-and-offline-recovery-passed',releaseId:release.releaseId,publicFiles:19,localFiles:20,bytes:26096498,anonymousRequests:network.requests.length,direct:481,http:481,errors:0,providerEgress:0,recovery:JSON.parse(await readFile(join(output,'recovery-receipt.json'))),ordinaryPublicationExecuted:false,renderChanged:false});
console.log(JSON.stringify({status:'public-real-cli-and-offline-recovery-passed',publicFiles:19,localFiles:20,direct:481,http:481,errors:0,providerEgress:0}));
