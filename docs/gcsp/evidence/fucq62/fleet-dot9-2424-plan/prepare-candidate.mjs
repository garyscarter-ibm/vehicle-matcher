// Prepared for separate parent review. Requires the pinned registration patch first.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, open, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexJsonl } from '../../../../../server/gcsp/vehicle-evidence/indexed-jsonl.js';
import { canonicalContent, validateCorpusDirectory, writeCorpusCandidate } from '../../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { installFleetOfflineGuard } from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';

const base=fileURLToPath(new URL('./',import.meta.url));
const plan=JSON.parse(await readFile(join(base,'plan.json')));
assert.match(process.env.TMPDIR||'',/\/test-stamp-shard-[a-f0-9]+$/);
const hash=b=>createHash('sha256').update(b).digest('hex');
async function sha(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
async function check(pin){assert.equal((await stat(pin.path)).size,pin.bytes);assert.equal(await sha(pin.path),pin.sha256);}
for(const pin of [plan.canonical,plan.spent,plan.parentAudit,plan.baseline.descriptor,...plan.baseline.files,...plan.baseline.retainedPackAssets,...plan.baseline.isolatedHistoryPins,...plan.novelRows.originFilePins,plan.technicalSupplement,...plan.productionCodePins,...plan.preparedScripts])await check(pin);
assert.equal(await sha(plan.sourceRegistrationProposal.path),plan.sourceRegistrationProposal.afterSha256,'Reviewed code-owned source registration must be applied before execution.');
const aggregate=join(plan.outputRoot,plan.novelRows.aggregate.origin);
const candidate=join(plan.outputRoot,'candidate');
const baseline=plan.baseline.candidateDirectory;
const oldLines=new Map((await readFile(join(baseline,'configurations.jsonl'),'utf8')).trimEnd().split('\n').map(line=>[JSON.parse(line).configurationId,line]));
assert.equal(oldLines.size,1924);
const guard=installFleetOfflineGuard();const control=guard.control();assert.equal(control,'blocked');
try {
 const selected=new Map();
 for(const p of plan.novelRows.originalLinePins){const pins=selected.get(p.path)||new Map();assert.equal(pins.has(p.line),false);pins.set(p.line,p);selected.set(p.path,pins);}
 const originalLines=new Map();
 for(const [path,pins]of selected){const lines=(await readFile(path,'utf8')).split('\n');for(const [n,p]of pins){const line=lines[n-1]+'\n';assert.equal(Buffer.byteLength(line),p.bytes);assert.equal(hash(line),p.sha256);const row=JSON.parse(line);assert.equal(hash(row.configurationId),p.configurationIdSha256);assert.equal(row.admission,true);assert.equal(oldLines.has(row.configurationId),false);assert.equal(originalLines.has(row.configurationId),false);originalLines.set(row.configurationId,line);}}
 assert.equal(originalLines.size,501);const ordered=[...originalLines.keys()].sort();assert.equal(hash(ordered.join('\n')+'\n'),plan.novelRows.idSetSha256);
 const out=await open(aggregate,'wx',0o600);try{for(const id of ordered)await out.writeFile(originalLines.get(id));await out.sync();}finally{await out.close();}
 assert.equal((await stat(aggregate)).size,plan.novelRows.aggregate.bytes);assert.equal(await sha(aggregate),plan.novelRows.aggregate.sha256);assert.ok((await stat(aggregate)).size<=plan.novelRows.aggregate.maxBytes);
 // The reviewed code-owned digest authorizes exactly these bytes on restart too.
 await copyFile(aggregate,plan.sourceRegistrationProposal.registeredSourcePath,1);
 assert.equal(await sha(plan.sourceRegistrationProposal.registeredSourcePath),plan.novelRows.aggregate.sha256);
 const options={indexed:true,approvedImages:APPROVED_CORPUS_IMAGES,policyService:new PolicyService({provider:new FilePolicyProvider()}),policyRead:{runId:'f62-dot9-offline',asOf:'2026-11-07T00:00:00.000Z'}};
 const rows=await indexJsonl(aggregate,{key:row=>row.configurationId});assert.equal(rows.length,501);assert.equal(rows.checksum,plan.novelRows.aggregate.sha256);
 const additions=join(process.env.TMPDIR,'new-configurations.jsonl');const writer=await open(additions,'wx',0o600);
 const fields=['model','derivative','generation','body','powertrain','drive','transmission','engineCode','agModelCode','vgModelCode','market','region','steering','modelYear','productionEra','productionDate','plant'];
 try{for(const row of rows){const c=row.catalogue,b=c.sourceBinding;const configuration=Object.fromEntries(fields.map(f=>[f,null]));Object.assign(configuration,{model:b.optionalFacts.modelName.value,generation:b.confirmedContext.rawModelRange.value,agModelCode:b.canonicalIdentity.agModelCode,vgModelCode:b.canonicalIdentity.vgModelCode,market:b.requestScope.market});await writer.writeFile(canonicalContent({configurationId:row.configurationId,snapshotVersion:c.snapshotVersion,canonicalIdentity:{...b.canonicalIdentity,provenance:c.identityProvenance},configuration,sourceContext:{sourceRefs:[...new Set(b.evidence.map(e=>e.request.url))].sort(),observedDate:c.observedDate,catalogueDate:c.observedDate,confidence:'Complete source factory selection; physical build unknown',unresolvedFacts:fields.filter(f=>configuration[f]===null),sourceKind:'dated-snapshot',selectedOptionCompleteness:c.completeness.factorySelection},catalogue:c,imageIds:[]}));}await writer.sync();}finally{await writer.close();}
 const metadata=JSON.parse(await readFile(join(baseline,'manifest.json')));for(const key of ['signaturePolicy','qualification','counts','coverage','completeness','checksums'])delete metadata[key];metadata.version=plan.version;
 for(const context of metadata.sourceContexts)if(context.observedDate==='2026-11-07'&&context.market==='GB')context.note='2423 actual admitted v2 factory selections and one retained historical source configuration; two representative images retain exact dated associations; four qualified measurements apply only to one exact configuration; physical build, visual fidelity and scheme breadth remain unverified';
 const supplement=JSON.parse(await readFile(plan.technicalSupplement.path));
 const prepared=await writeCorpusCandidate(candidate,{metadata,retainedCorpusDirectory:baseline,configurationsFile:additions,technicalSupplements:[supplement]},options);assert.equal(prepared.status,'ok',JSON.stringify(prepared));
 const counts={...plan.expected};delete counts.technicalSupplementAssociations;delete counts.novelConfigurations;assert.deepEqual(prepared.manifest.counts,counts);
 const checked=await validateCorpusDirectory(candidate,options);assert.equal(checked.status,'ok',JSON.stringify(checked));assert.equal(checked.manifest.schemaVersion,'2');assert.deepEqual(checked.manifest.technicalSupplements,[supplement]);
 const lines=new Map((await readFile(join(candidate,'configurations.jsonl'),'utf8')).trimEnd().split('\n').map(line=>[JSON.parse(line).configurationId,line]));assert.equal(lines.size,2425);for(const [id,line]of oldLines)assert.equal(lines.get(id),line);for(const name of ['vins.jsonl','images.jsonl'])assert.deepEqual(await readFile(join(candidate,name)),await readFile(join(baseline,name)));
 const index=JSON.parse(await readFile(plan.canonical.path));const extras=index.entries.filter(e=>!lines.has(e.configurationId));assert.equal(extras.length,2);assert.deepEqual(extras.map(e=>hash(e.configurationId)).sort(),plan.excludedPriorObservations.map(e=>e.configurationIdSha256).sort());assert.ok(extras.every(e=>e.origins.every(o=>o.kind==='retained-prior-observation')));
 for(const p of plan.baseline.isolatedHistoryPins)await check(p);assert.equal(guard.calls.length,0);
 const files=[];for(const name of ['manifest.json','configurations.jsonl','vins.jsonl','images.jsonl'])files.push({name,path:join(candidate,name),bytes:(await stat(join(candidate,name))).size,sha256:await sha(join(candidate,name))});
 const receipt={status:'offline-candidate-validated',candidateManifestDigest:checked.manifestDigest,previousManifestDigest:plan.baseline.manifestDigest,version:plan.version,counts:checked.manifest.counts,files,technicalSupplements:1,old1924LinesByteIdentical:true,vinBytesIdentical:true,imageBytesIdentical:true,novelSourceAggregate:{path:aggregate,...plan.novelRows.aggregate},canonicalIndex:{entries:2427,candidateUnion:2425,excludedRetainedPriorObservations:2},baselineHistoryPinsUnchanged:true,egress:{control,externalCalls:guard.calls.length},ordinaryPublicationExecuted:false,publicUploadExecuted:false,acceptance:false};
 await writeFile(join(plan.outputRoot,'candidate-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));
}finally{guard.restore();}
