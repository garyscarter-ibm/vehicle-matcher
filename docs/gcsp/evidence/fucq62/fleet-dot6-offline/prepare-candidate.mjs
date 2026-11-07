// Existing F54 publisher, retained strict source rows and offline checks only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, open, writeFile, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexJsonl } from '../../../../../server/gcsp/vehicle-evidence/indexed-jsonl.js';
import { canonicalContent, validateCorpusDirectory, writeCorpusCandidate } from '../../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { fleetReleases } from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { installFleetOfflineGuard } from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));
const scratch=process.env.TMPDIR;assert.ok(isAbsolute(scratch));
const output=plan.outputRoot;const candidate=plan.candidateDirectory;
const hash=b=>createHash('sha256').update(b).digest('hex');
async function sha(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
for(const [path,expected]of Object.entries(plan.baseline.files))assert.equal(await sha(path),expected);
const baseline=plan.baseline.directory;
const oldLines=new Map((await readFile(join(baseline,'configurations.jsonl'),'utf8')).trimEnd().split('\n').map(line=>[JSON.parse(line).configurationId,line]));
assert.equal(oldLines.size,480);
const source=plan.registeredSource;
assert.equal(await sha(source.path),source.sha256);assert.equal((await stat(source.path)).size,source.bytes);
assert.equal(source.bytes<=33554432,true);
const options={indexed:true,approvedImages:APPROVED_CORPUS_IMAGES,policyService:new PolicyService({provider:new FilePolicyProvider()}),policyRead:{runId:'f62-dot6-offline',asOf:'2026-11-07T00:00:00.000Z'}};
const guard=installFleetOfflineGuard();const control=guard.control();assert.equal(control,'blocked');
let manifestDigest,prepared,checked;
try{
 const rows=await indexJsonl(source.path,{key:row=>row.configurationId});assert.equal(rows.length,390);
 const novel=new Set();const file=join(scratch,'new-configurations.jsonl');const writer=await open(file,'wx',0o600);
 const fields=['model','derivative','generation','body','powertrain','drive','transmission','engineCode','agModelCode','vgModelCode','market','region','steering','modelYear','productionEra','productionDate','plant'];
 try{
  for(const row of rows){
   assert.equal(row.admission,true);assert.equal(oldLines.has(row.configurationId),false);assert.equal(novel.has(row.configurationId),false);novel.add(row.configurationId);
   const c=row.catalogue,b=c.sourceBinding;const configuration=Object.fromEntries(fields.map(f=>[f,null]));
   Object.assign(configuration,{model:b.optionalFacts.modelName.value,generation:b.confirmedContext.rawModelRange.value,agModelCode:b.canonicalIdentity.agModelCode,vgModelCode:b.canonicalIdentity.vgModelCode,market:b.requestScope.market});
   await writer.writeFile(canonicalContent({configurationId:row.configurationId,snapshotVersion:c.snapshotVersion,canonicalIdentity:{...b.canonicalIdentity,provenance:c.identityProvenance},configuration,
    sourceContext:{sourceRefs:[...new Set(b.evidence.map(e=>e.request.url))].sort(),observedDate:c.observedDate,catalogueDate:c.observedDate,confidence:'Complete source factory selection; physical build unknown',unresolvedFacts:fields.filter(f=>configuration[f]===null),sourceKind:'dated-snapshot',selectedOptionCompleteness:c.completeness.factorySelection},catalogue:c,imageIds:[]}));
  }await writer.sync();
 }finally{await writer.close();}
 assert.equal(hash([...novel].sort().join('\n')+'\n'),plan.novelConfigurationIdsSha256);
 const metadata=JSON.parse(await readFile(join(baseline,'manifest.json')));
 for(const key of ['signaturePolicy','qualification','counts','coverage','completeness','checksums'])delete metadata[key];
 metadata.version=plan.version;
 for(const context of metadata.sourceContexts)if(context.observedDate==='2026-11-07'&&context.market==='GB')context.note='868 actual admitted v2 factory selections; physical build, technical measurements and scheme model breadth remain unknown; one representative image belongs only to the retained v1 configuration';
 prepared=await writeCorpusCandidate(candidate,{metadata,retainedCorpusDirectory:baseline,configurationsFile:file},options);
 assert.equal(prepared.status,'ok',JSON.stringify(prepared));assert.deepEqual(prepared.manifest.counts,plan.expected);
 checked=await validateCorpusDirectory(candidate,options);assert.equal(checked.status,'ok',JSON.stringify(checked));manifestDigest=checked.manifestDigest;
 const candidateLines=new Map((await readFile(join(candidate,'configurations.jsonl'),'utf8')).trimEnd().split('\n').map(line=>[JSON.parse(line).configurationId,line]));
 for(const [id,line]of oldLines)assert.equal(candidateLines.get(id),line);
 for(const file of ['vins.jsonl','images.jsonl'])assert.deepEqual(await readFile(join(candidate,file)),await readFile(join(baseline,file)));
 assert.deepEqual([...checked.corpus.images],APPROVED_CORPUS_IMAGES);
 const index=JSON.parse(await readFile(plan.finalCanonicalIndex.path));assert.equal(await sha(plan.finalCanonicalIndex.path),plan.finalCanonicalIndex.sha256);
 const extras=index.entries.filter(e=>!candidateLines.has(e.configurationId));assert.equal(extras.length,2);
 assert.deepEqual(extras.map(e=>hash(e.configurationId)).sort(),plan.finalCanonicalIndex.excludedRetainedPriorObservationIdsSha256);
 assert.ok(extras.every(e=>e.origins.every(o=>o.kind==='retained-prior-observation')));
 const previous=fleetReleases.find(r=>r.manifestDigest===plan.baseline.manifestDigest);assert.ok(previous);
 const files=[];
 for(const name of ['manifest.json','configurations.jsonl','vins.jsonl','images.jsonl'])files.push({name,path:join(candidate,name),bytes:(await stat(join(candidate,name))).size,sha256:await sha(join(candidate,name))});
 const sources=previous.sources.map(s=>({...s,origin:previous.assets.find(a=>a.path===s.path).origin,inputPath:join(root,'server/data/gcsp/vehicle-evidence/registered-sources',previous.assets.find(a=>a.path===s.path).origin),manifestDigests:[manifestDigest,previous.manifestDigest]}));
 sources.push({path:`sources/${source.sha256}.jsonl`,sha256:source.sha256,bytes:source.bytes,origin:source.origin,inputPath:source.path,manifestDigests:[manifestDigest]});
 for(const s of sources){assert.equal(await sha(s.inputPath),s.sha256);assert.equal((await stat(s.inputPath)).size,s.bytes);assert.ok(s.bytes<=33554432);}
 await writeFile(join(output,'descriptor-inputs.json'),JSON.stringify({schemaVersion:'fleet-dot6-descriptor-inputs.v1',candidateManifestDigest:manifestDigest,previousManifestDigest:previous.manifestDigest,version:plan.version,files,sources,
  previousDescriptor:previous,ordinaryStore:plan.baseline.store,ordinaryStoreInputPins:plan.baseline.files,
  nextSteps:'Root reviews candidate and uses existing SyntheticRegistry in an isolated store to derive new active/last-good/history assets, then existing validateRelease/packFleetRelease; no new publisher or wire format.',
  pending:['isolated durable history publication','final descriptor/asset pack','root public upload and Linux proof','root ordinary/YAML integration'],ordinaryPublicationExecuted:false,publicUploadExecuted:false},null,2)+'\n');
 assert.equal(guard.calls.length,0);
}finally{guard.restore();}
for(const [path,expected]of Object.entries(plan.baseline.files))assert.equal(await sha(path),expected);
const receipt={status:'offline-candidate-validated-descriptor-inputs-prepared',candidateManifestDigest:manifestDigest,counts:prepared.manifest.counts,old480LinesByteIdentical:true,vinBytesIdentical:true,imageBytesIdentical:true,
 canonicalIndex:{entries:872,candidateUnion:870,excludedRetainedPriorObservations:2},registeredSource:source,baselinePinsUnchanged:true,egress:{control,externalCalls:guard.calls.length},ordinaryPublicationExecuted:false,publicUploadExecuted:false,acceptance:false};
await writeFile(join(output,'candidate-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
