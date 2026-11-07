import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPolicyService } from '../gcsp/policy/index.js';
import { writeCorpusCandidate, validateCorpusDirectory } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/vehicle-lookup.js';
import { createConfiguredVehicleDetails } from '../gcsp/vehicle-evidence/application-vehicle-details.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { verifyActiveFleet } from '../../scripts/gcsp/verify-fleet.mjs';
import { qualifyBmwTechnicalObservation, BMW_OTD_MAPPING_AUTHORITY } from '../../scripts/gcsp/bmw-technical-qualification.mjs';
import { createHash } from 'node:crypto';
const registrationUrl = new URL('../data/gcsp/vehicle-evidence/registered-technical/1f7e-2026-11-07.json', import.meta.url);
const supplement = async () => JSON.parse(await readFile(registrationUrl));
const options={policyService:createPolicyService(),policyRead:{runId:'technical-supplement-proof',asOf:'2026-11-07T00:00:00.000Z'}};
async function fixture(t) {
 const scratch=await mkdtemp(join(tmpdir(),'technical-supplement-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
 const accepted=JSON.parse((await readFile(new URL('../data/gcsp/vehicle-evidence/registered-sources/f70-1f7e-first32-2026-11-07.jsonl',import.meta.url),'utf8')).split('\n')[0]);
 const c=accepted.catalogue,b=c.sourceBinding;const fields=['model','derivative','generation','body','powertrain','drive','transmission','engineCode','agModelCode','vgModelCode','market','region','steering','modelYear','productionEra','productionDate','plant'];
 const configuration=Object.fromEntries(fields.map(k=>[k,null]));Object.assign(configuration,{model:b.optionalFacts.modelName.value,generation:b.confirmedContext.rawModelRange.value,agModelCode:b.canonicalIdentity.agModelCode,vgModelCode:b.canonicalIdentity.vgModelCode,market:b.requestScope.market});
 const row={configurationId:accepted.configurationId,snapshotVersion:c.snapshotVersion,canonicalIdentity:{...b.canonicalIdentity,provenance:c.identityProvenance},configuration,catalogue:c,imageIds:[],sourceContext:{sourceRefs:[...new Set(b.evidence.map(e=>e.request.url))].sort(),observedDate:c.observedDate,catalogueDate:c.observedDate,sourceKind:'dated-snapshot',confidence:'Exact source selection; technical supplement separate',unresolvedFacts:fields.filter(k=>configuration[k]===null),selectedOptionCompleteness:'complete'}};
 const metadata={datasetId:'technical-supplement-retained-row',version:'1',schemaVersion:'1',profileRegistryVersion:'vin-profiles.v1',generatorVersion:'synthetic-identities.sha256-v1',seed:{value:'bounded-technical-proof',kind:'synthetic'},sourceContexts:[{sourceKind:'dated-snapshot',observedDate:c.observedDate,catalogueDate:c.observedDate,market:'GB',steering:null,note:'One retained source row; no scale or profile claim'}]};
 return {scratch,row,metadata};
}
test('retained four facts publish separately while original configuration and associations stay immutable',async t=>{
 const f=await fixture(t);const entry=await supplement();assert.equal(entry.catalogueDigest,inputDigest(f.row.catalogue));
 const before=join(f.scratch,'before'),after=join(f.scratch,'after'),store=join(f.scratch,'store');
 let made=await writeCorpusCandidate(before,{metadata:f.metadata,configurations:[f.row]},options);assert.equal(made.status,'ok',JSON.stringify(made));
 const registry=createSyntheticRegistry({root:store,...options});assert.equal((await registry.publish(before)).status,'ok');
 const historyBefore=JSON.parse(await readFile(join(store,'identity-inventory.json')));
 made=await writeCorpusCandidate(after,{metadata:{...f.metadata,version:'2'},configurations:[],retainedCorpusDirectory:before,technicalSupplements:[entry]},options);assert.equal(made.status,'ok',JSON.stringify(made));assert.equal(made.manifest.schemaVersion,'2');
 for(const name of ['configurations.jsonl','vins.jsonl','images.jsonl'])assert.deepEqual(await readFile(join(after,name)),await readFile(join(before,name)));
 assert.equal((await registry.publish(after)).status,'ok');assert.equal((await registry.publish(after)).idempotent,true);
 const historyAfter=JSON.parse(await readFile(join(store,'identity-inventory.json')));assert.deepEqual(historyAfter.configurations,historyBefore.configurations);assert.deepEqual(historyAfter.identities,historyBefore.identities);assert.equal(historyAfter.datasets.length,historyBefore.datasets.length+1);
 const cold=createSyntheticRegistry({root:store,...options});assert.equal((await cold.load()).status,'ok');const source=cold.getConfiguration(f.row.configurationId);assert.equal(source.record.catalogue.facts.seats.state,'unknown');assert.equal(source.technicalSupplement.facts.seats.value,5);
 const lookup=createVehicleEvidenceLookup({registry:cold});const dto=await lookup.resolve({kind:'configuration',id:f.row.configurationId});assert.deepEqual(Object.fromEntries(Object.keys(entry.facts).map(k=>[k,dto.technical[k]])),entry.facts);assert.equal(dto.technical.bodyLength.state,'unknown');assert.equal(dto.source.productionDate,null);assert.equal(dto.completeness.measurements,'partial');
 const consumed=await createConfiguredVehicleDetails({lookup}).resolve({kind:'configuration',id:f.row.configurationId});assert.equal(consumed.status,dto.status);assert.deepEqual(consumed.vehicle.technical,dto.technical);
 const report=await verifyActiveFleet({root:store,requiredDistinct:1,http:true,offline:true,endpoint:'http://127.0.0.1:0',sampleSize:1,...options});assert.equal(report.status,'verified-active',JSON.stringify(report));assert.equal(report.audit.errors,0);assert.equal(report.http.requests,1);assert.equal(report.http.errors,0);assert.equal(report.egress.externalCalls,0);assert.equal(report.egress.sourceCalls,0);
 const next=join(f.scratch,'next');made=await writeCorpusCandidate(next,{metadata:{...f.metadata,version:'3'},configurations:[],retainedCorpusDirectory:after},options);assert.equal(made.status,'ok',JSON.stringify(made));assert.deepEqual(made.manifest.technicalSupplements,[entry]);
 const current=JSON.parse(await readFile(join(store,'active.json'))).selected.manifestDigest;const currentManifest=join(store,'versions',current,'manifest.json');const changed=JSON.parse(await readFile(currentManifest));changed.technicalSupplements[0].facts.seats.value=6;await writeFile(currentManifest,JSON.stringify(changed)+'\n');
 const recovered=createSyntheticRegistry({root:store,...options});const recovery=await recovered.load();assert.equal(recovery.recovered,true);assert.equal(recovered.getConfiguration(f.row.configurationId).technicalSupplement,undefined);assert.equal(recovered.getConfiguration(f.row.configurationId).record.catalogue.facts.seats.state,'unknown');
});
test('supplement admission rejects altered units, values, binding and another configuration',async t=>{
 const f=await fixture(t);const entry=await supplement();
 for(const [i,change]of [(e)=>e.facts.seats.value=6,(e)=>e.facts.seats.unit='LITRES',(e)=>e.bindingDigest='0'.repeat(64),(e)=>e.configurationId=Buffer.from('OTHER:VALUE').toString('base64')].entries()){
  const changed=structuredClone(entry);change(changed);const made=await writeCorpusCandidate(join(f.scratch,'bad'+i),{metadata:f.metadata,configurations:[f.row],technicalSupplements:[changed]},options);assert.equal(made.status,'invalid-corpus');assert.equal(made.failure.code,'technical-supplement-mismatch');
 }
});

test('registration reproduces the four qualified retained facts with source-unit authority and no model broadcast',async()=>{
 const entry=await supplement();const base=new URL('../../docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/',import.meta.url);
 const raw=await readFile(new URL('technical.json',base));const document=JSON.parse(raw);const sha=b=>createHash('sha256').update(b).digest('hex');
 const acceptedBytes=await readFile(new URL('../data/gcsp/vehicle-evidence/registered-sources/f70-1f7e-first32-2026-11-07.jsonl',import.meta.url));const line=acceptedBytes.subarray(0,acceptedBytes.indexOf(10)+1);const accepted=JSON.parse(line);const plan=JSON.parse(await readFile(new URL('observation-plan.json',base)));
 const qualified=qualifyBmwTechnicalObservation({artifact:{document,sha256:sha(raw),bytes:raw.length},accepted,registration:plan.registration,pins:{retainedSha256:sha(raw),responseSha256:document.observation.responseSha256,acceptedLineSha256:sha(line),mappingDigest:BMW_OTD_MAPPING_AUTHORITY.digest}});
 assert.deepEqual(entry.facts,qualified.facts);assert.deepEqual(entry.measurementEvidence,qualified.measurementEvidence);assert.deepEqual(entry.source,qualified.source);assert.equal(Object.keys(entry.facts).length,4);for(const detail of Object.values(entry.measurementEvidence)){assert.equal(detail.sourceUnit,null);assert.equal(detail.unitAuthority,'approved-reference-code-mapping');}
});
