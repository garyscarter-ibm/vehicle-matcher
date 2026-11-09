// Produce a code-owned descriptor proposal only after measured offline proof.
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {validateRelease} from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import {installFleetOfflineGuard} from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import {prepareFollowthrough} from './prepare-followthrough.mjs';
import {packet,check,sha,hash,save} from './common.mjs';
const p=await packet();const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');
try {
 const summary=JSON.parse(await readFile(join(p.output,'offline-proof-summary.json')));assert.equal(summary.manifestDigest,p.receipt.candidateManifestDigest);assert.equal(summary.exactRequestUnion,true);assert.equal(summary.directErrors+summary.httpErrors,0);assert.equal(summary.strictReconciled,true);assert.equal(summary.acceptance,false);assert.ok(Number.isInteger(summary.consumerErrors)&&summary.consumerErrors>=0);
 const previous=JSON.parse(await readFile(p.candidate.baseline.descriptor.path));await check(p.candidate.baseline.descriptor);assert.equal(previous.manifestDigest,p.candidate.baseline.manifestDigest);
 const tag='fleet-2026-11-07-11';const current=p.receipt.candidateManifestDigest;const prior=p.candidate.baseline.manifestDigest;const assets=[],sources=[];
 const asset=async(path,file,role='corpus',origin)=>{const name=path.replaceAll('/','--');const a={name,path,bytes:(await stat(file)).size,sha256:await sha(file),role,url:`https://github.com/garyscarter-ibm/vehicle-matcher/releases/download/${tag}/${name}`,...(origin?{origin}:{})};assets.push(a);return a;};
 for(const name of ['active.json','last-good.json','identity-inventory.json'])await asset('store/'+name,join(p.store,name));
 for(const digest of [current,prior])for(const name of ['manifest.json','configurations.jsonl','vins.jsonl','images.jsonl'])await asset(`store/versions/${digest}/${name}`,join(p.store,'versions',digest,name));
 const origins=new Map(previous.assets.filter(a=>a.role==='source').map(a=>[a.sha256,{origin:a.origin,sha256:a.sha256,bytes:a.bytes,manifestDigests:[current,prior]}]));
 for(const row of p.receipt.novelSourceShards){assert.equal(origins.has(row.sha256),false);origins.set(row.sha256,{origin:row.origin,sha256:row.sha256,bytes:row.bytes,manifestDigests:[current]});}
 for(const row of origins.values()){const a=await asset(`sources/${row.sha256}.jsonl`,p.plan.sourcePins.find(pin=>pin.sha256===row.sha256&&pin.origin===row.origin).path,'source',row.origin);assert.equal(a.sha256,row.sha256);assert.equal(a.bytes,row.bytes);sources.push({path:a.path,sha256:a.sha256,bytes:a.bytes,manifestDigests:row.manifestDigests});}
 assert.equal(assets.length,29);assert.equal(sources.length,18);const descriptor=validateRelease({schemaVersion:'fleet-release.v1',releaseId:current,manifestDigest:current,previousManifestDigest:prior,datasetId:'gcsp-source-fleet',version:'2026-11-07.11',jsonlMaxBytes:268435456,assets,sources});
 const anchorPath=p.plan.releaseAnchor.path;const before=await readFile(anchorPath);assert.equal(hash(before),p.plan.releaseAnchor.sha256);const releases=JSON.parse(before);assert.equal(releases.some(r=>r.releaseId===current),false);const after=Buffer.from(JSON.stringify([...releases,descriptor],null,2)+'\n');assert.ok(after.length<=262144);assert.ok(releases.length+1<=16);
 await save(p.output,'descriptor-proposal.json',descriptor);await save(p.output,'fleet-releases-proposal.json',[...releases,descriptor]);assert.equal(await sha(anchorPath),p.plan.releaseAnchor.sha256);assert.equal(guard.calls.length,0);
 await save(p.output,'descriptor-proposal-receipt.json',{status:'offline-descriptor-and-release-anchor-proposal-only',manifestDigest:current,previousManifestDigest:prior,jsonlMaxBytes:268435456,assets:29,sources:18,totalAssetBytes:assets.reduce((n,a)=>n+a.bytes,0),descriptorSha256:await sha(join(p.output,'descriptor-proposal.json')),releaseAnchorBeforeSha256:hash(before),releaseAnchorProposalSha256:hash(after),consumerErrors:summary.consumerErrors,sourceCalls:0,externalCalls:0,runtimeRegistrationApplied:false,packageExecuted:false,ordinaryPublicationExecuted:false,publicUploadExecuted:false,acceptance:false});
 await prepareFollowthrough(p,descriptor,after);
}finally{guard.restore();}
