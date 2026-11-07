import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetReleases } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { packFleetRelease } from '../../../../server/gcsp/vehicle-evidence/fleet-artifacts.js';
import { rebuildFleetDot5 } from './rebuild-fleet-dot5.mjs';
const run=promisify(execFile);const root=fileURLToPath(new URL('../../../../',import.meta.url));
const [output,target]=process.argv.slice(2);const scratch=process.env.TMPDIR;
assert.match(target,/^[a-f0-9]{40}$/);const gh='/Users/usget/.claude-tools/bin/gh';const repo='garyscarter-ibm/vehicle-matcher';const tag='fleet-2026-11-07-5';
const release=fleetReleases.find((r)=>r.releaseId==='7f4396b8fcddf14eb0d7386a47cbc41f58e1385d8ee30a0bda95f292c016e431');assert.ok(release);
const save=async(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n');
const api=async(args)=>JSON.parse((await run(gh,args,{cwd:root,maxBuffer:262144,timeout:60000})).stdout);
const fields='{id,tag_name,target_commitish,prerelease,draft,html_url,assets:[.assets[]|{id,name,size,state,digest,browser_download_url}]}';
const baseline=await api(['api',`repos/${repo}/releases/tags/fleet-2026-11-07-4`,'--jq',fields]);
const baselineIdentity=JSON.stringify(baseline);assert.equal(baseline.id,437264368);
const rebuilt=await rebuildFleetDot5(scratch);assert.equal(rebuilt.manifestDigest,release.releaseId);
if(globalThis.gc)globalThis.gc();await mkdir(join(scratch,'package'));
const packed=await packFleetRelease({releaseId:release.releaseId,store:rebuilt.isolatedStore,output:join(scratch,'package')});
assert.equal(packed.files,20);assert.equal(packed.bytes,26096498);
const committed=JSON.parse((await run('git',['show',`${target}:server/gcsp/vehicle-evidence/fleet-releases.json`],{cwd:root,maxBuffer:262144})).stdout);
assert.deepEqual(committed.find((r)=>r.releaseId===release.releaseId),release);
let created;
try {created=await api(['api',`repos/${repo}/releases/tags/${tag}`,'--jq',fields]);}
catch(error) {
 if(!String(error.stderr).includes('404'))throw error;
 const body={tag_name:tag,target_commitish:target,name:'GCSP configuration corpus 2026-11-07.5',prerelease:true,draft:false,
 body:'Checksum-pinned partial demonstration corpus:479 retained complete distinct source configurations,480 configurations total,one retained synthetic VIN and one approved representative configuration image. Source/model/profile/WMI breadth and whole Story acceptance remain incomplete. Raw assets preserve .5/.4 selections,durable history and nine admitted source shards; the exact WebP is supplied by the matching application checkout. Runtime lookup stays offline. Manifest '+release.releaseId+'. Runbook:docs/gcsp/evidence/fucq62/fleet-2026-11-07-5-plan.md at the target commit.'};
 await save('release-request.json',body);created=await api(['api','--method','POST',`repos/${repo}/releases`,'--input',join(output,'release-request.json'),'--jq',fields]);
}
assert.equal(created.target_commitish,target);assert.equal(created.prerelease,true);assert.equal(created.draft,false);
const ref=await api(['api',`repos/${repo}/git/ref/tags/${tag}`,'--jq','{ref,object}']);assert.equal(ref.object.type,'commit');assert.equal(ref.object.sha,target);
await save('release-created.json',{...created,verifiedTag:ref});
for(const remote of created.assets){const asset=release.assets.find((a)=>a.name===remote.name);assert.ok(asset&&asset.bytes>0);assert.equal(remote.size,asset.bytes);assert.equal(remote.digest,'sha256:'+asset.sha256);assert.equal(remote.browser_download_url,asset.url);}
const uploaded=[];
for(const asset of release.assets){
 if(asset.bytes===0){assert.equal(asset.sha256,createHash('sha256').digest('hex'));continue;}
 const existing=created.assets.find((a)=>a.name===asset.name);
 const value=existing??await api(['api','--method','POST',`https://uploads.github.com/repos/${repo}/releases/${created.id}/assets?name=${encodeURIComponent(asset.name)}`,'-H','Content-Type: application/octet-stream','--input',join(packed.directory,asset.path),'--jq','{id,name,size,state,digest,browser_download_url}']);
 assert.equal(value.name,asset.name);assert.equal(value.size,asset.bytes);assert.equal(value.state,'uploaded');assert.equal(value.digest,'sha256:'+asset.sha256);assert.equal(value.browser_download_url,asset.url);
 uploaded.push(value);await save('upload-checkpoint.json',{releaseId:release.releaseId,target,githubReleaseId:created.id,uploaded});
 console.log(JSON.stringify({uploaded:uploaded.length,total:19,name:value.name,bytes:value.size}));
}
const readback=await api(['api',`repos/${repo}/releases/tags/${tag}`,'--jq',fields]);assert.equal(readback.assets.length,19);
assert.equal(JSON.stringify(await api(['api',`repos/${repo}/releases/tags/fleet-2026-11-07-4`,'--jq',fields])),baselineIdentity);
await save('receipt.json',{status:'immutable-prerelease-published',releaseId:release.releaseId,target,verifiedTag:ref,githubRelease:readback,
 packed:{files:packed.files,bytes:packed.bytes},publicFiles:19,emptyLocalMaterializations:1,previousReleaseUnchanged:true,
 rebuilt:{manifestDigest:rebuilt.manifestDigest,priorRowsByteIdentical:rebuilt.priorRowsByteIdentical,sourceStoreUnchanged:rebuilt.sourceStoreUnchanged,egress:rebuilt.egress},
 ordinaryPublicationExecuted:false,renderChanged:false,actualPublicGetProof:'next separate phase'});
