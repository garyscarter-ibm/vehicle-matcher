import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRelease, fleetReleases } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { rebuildFleetDot5 } from './rebuild-fleet-dot5.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url));const output=process.argv[2];const scratch=process.env.TMPDIR;
const plan=JSON.parse(await readFile(new URL('./fleet-2026-11-07-5-plan.json',import.meta.url)));
const rebuilt=await rebuildFleetDot5(scratch);const previous=fleetReleases.find((r)=>r.manifestDigest===plan.baseline.manifestDigest);assert.ok(previous);
const tag='fleet-2026-11-07-5';const assets=[];const sources=[];
async function asset(path,input,extra={}) {
 const h=createHash('sha256');for await(const b of createReadStream(input))h.update(b);const sha256=h.digest('hex');
 const bytes=(await stat(input)).size;const name=path.replaceAll('/','--');
 const value={name,path,bytes,sha256,role:'corpus',url:`https://github.com/garyscarter-ibm/vehicle-matcher/releases/download/${tag}/${name}`,...extra};assets.push(value);return value;
}
for(const p of ['active.json','last-good.json','identity-inventory.json'])await asset('store/'+p,join(rebuilt.isolatedStore,p));
for(const digest of [rebuilt.manifestDigest,previous.manifestDigest])for(const file of ['manifest.json','configurations.jsonl','vins.jsonl','images.jsonl']){
 const path=`versions/${digest}/${file}`;await asset('store/'+path,join(rebuilt.isolatedStore,path));
}
for(const existing of previous.sources){const original=previous.assets.find((a)=>a.path===existing.path);assert.ok(original?.origin);
 const copied=await asset(existing.path,join(root,'server/data/gcsp/vehicle-evidence/registered-sources',original.origin),{role:'source',origin:original.origin});
 assert.equal(copied.sha256,existing.sha256);assert.equal(copied.bytes,existing.bytes);
 sources.push({path:copied.path,sha256:copied.sha256,bytes:copied.bytes,manifestDigests:[rebuilt.manifestDigest,previous.manifestDigest]});
}
for(const input of plan.files){const path=`sources/${input.sha256}.jsonl`;const copied=await asset(path,join(root,'server/data/gcsp/vehicle-evidence/registered-sources',input.registeredOrigin),{role:'source',origin:input.registeredOrigin});
 assert.equal(copied.sha256,input.sha256);assert.equal(copied.bytes,input.bytes);sources.push({path,sha256:copied.sha256,bytes:copied.bytes,manifestDigests:[rebuilt.manifestDigest]});}
const descriptor=validateRelease({schemaVersion:'fleet-release.v1',releaseId:rebuilt.manifestDigest,manifestDigest:rebuilt.manifestDigest,previousManifestDigest:previous.manifestDigest,datasetId:'gcsp-source-fleet',version:plan.version,jsonlMaxBytes:67108864,assets,sources});
assert.equal(assets.length,20);assert.equal(assets.filter((a)=>a.bytes>0).length,19);assert.equal(sources.length,9);
await writeFile(join(output,'descriptor.json'),JSON.stringify(descriptor,null,2)+'\n');
await writeFile(join(output,'receipt.json'),JSON.stringify({status:'exact-rebuilt-and-described',...rebuilt,candidate:undefined,isolatedStore:undefined,
 files:assets.length,nonemptyPublicFiles:19,emptyLocalMaterializations:1,bytes:assets.reduce((n,a)=>n+a.bytes,0),sourceShards:sources.length,
 oldDescriptorUnchanged:true,ordinaryPublicationExecuted:false,publicUploadExecuted:false,descriptorFile:'descriptor.json'},null,2)+'\n');
console.log(JSON.stringify({status:'exact-rebuilt-and-described',releaseId:rebuilt.manifestDigest,files:20,publicFiles:19,bytes:assets.reduce((n,a)=>n+a.bytes,0)}));
