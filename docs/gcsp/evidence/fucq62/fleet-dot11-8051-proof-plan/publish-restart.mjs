import assert from 'node:assert/strict';
import { cp,readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createSyntheticRegistry } from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import { installFleetOfflineGuard } from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import { packet,check,hash,save } from './common.mjs';
const p=await packet();const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');
try {
 async function members(directory,prefix=''){const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=prefix+entry.name;assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())result.push(...await members(join(directory,entry.name),path+'/'));else{assert.ok(entry.isFile());result.push(path);}}return result.sort();}
 assert.deepEqual(await members(p.candidate.baseline.isolatedHistoryStore),p.candidate.baseline.isolatedHistoryPins.map(r=>r.relativePath).sort());
 for(const pin of p.candidate.baseline.isolatedHistoryPins)await check(pin);
 await cp(p.candidate.baseline.isolatedHistoryStore,p.store,{recursive:true,force:false,errorOnExist:true});
 const historyBefore=JSON.parse(await readFile(join(p.store,'identity-inventory.json')));const pointerBefore=JSON.parse(await readFile(join(p.store,'active.json')));assert.equal(pointerBefore.selected.manifestDigest,p.candidate.baseline.manifestDigest);
 const registry=createSyntheticRegistry({root:p.store,...p.options});const published=await registry.publish(p.artifacts);assert.equal(published.status,'ok',JSON.stringify(published));assert.equal(published.active.manifestDigest,p.receipt.candidateManifestDigest);
 const activeBytes=await readFile(join(p.store,'active.json'));const historyBytes=await readFile(join(p.store,'identity-inventory.json'));const historyAfter=JSON.parse(historyBytes);assert.equal(historyBefore.configurations.length,4667);assert.equal(historyAfter.configurations.length,8052);assert.deepEqual(historyAfter.identities,historyBefore.identities);assert.equal(historyAfter.datasets.length,historyBefore.datasets.length+1);assert.equal(historyAfter.revision,historyBefore.revision+1);
 const configurations=new Map(historyAfter.configurations.map(row=>[row.configurationId,row]));for(const row of historyBefore.configurations)assert.deepEqual(configurations.get(row.configurationId),row);for(const row of historyBefore.datasets)assert.deepEqual(historyAfter.datasets.find(r=>r.datasetId===row.datasetId&&r.version===row.version),row);
 for(const pin of p.candidate.baseline.isolatedHistoryPins.filter(r=>r.relativePath.startsWith('versions/')))await check({...pin,path:join(p.store,pin.relativePath)});
 for(const pin of p.receipt.files)await check({...pin,path:join(p.store,'versions',p.receipt.candidateManifestDigest,pin.name)});
 assert.deepEqual(await members(p.store),[...p.candidate.baseline.isolatedHistoryPins.map(r=>r.relativePath),...['manifest.json','configurations.jsonl','vins.jsonl','images.jsonl','publication-owner.json'].map(name=>`versions/${p.receipt.candidateManifestDigest}/${name}`)].sort());
 const pointer=JSON.parse(activeBytes);assert.equal(pointer.selected.manifestDigest,p.receipt.candidateManifestDigest);assert.deepEqual(pointer.previous,pointerBefore.selected);assert.deepEqual(JSON.parse(await readFile(join(p.store,'last-good.json'))),{schemaVersion:'1',selected:pointerBefore.selected});
 const repeated=await registry.publish(p.artifacts);assert.equal(repeated.idempotent,true);assert.deepEqual(await readFile(join(p.store,'active.json')),activeBytes);assert.deepEqual(await readFile(join(p.store,'identity-inventory.json')),historyBytes);
 const restarted=createSyntheticRegistry({root:p.store,...p.options});const loaded=await restarted.load();assert.equal(loaded.status,'ok');assert.equal(loaded.active.manifestDigest,p.receipt.candidateManifestDigest);const supplement=JSON.parse(await readFile(p.candidate.technicalSupplement.path));const lookup=createVehicleEvidenceLookup({registry:restarted});const direct=await lookup.resolve({kind:'configuration',id:supplement.configurationId});for(const [key,value]of Object.entries(supplement.facts))assert.deepEqual(direct.technical[key],value);assert.equal(direct.technical.bodyLength.state,'unknown');
 for(const pin of p.candidate.baseline.isolatedHistoryPins)await check(pin);assert.equal(guard.calls.length,0);
 await save(p.output,'publish-restart-receipt.json',{status:'isolated-additive-publish-restart-idempotence-passed',manifestDigest:p.receipt.candidateManifestDigest,previousManifestDigest:p.candidate.baseline.manifestDigest,configurationCount:8052,retainedPriorConfigurations:4667,priorIdentitiesUnchanged:true,priorDatasetsUnchanged:true,priorVersionFilesByteIdentical:true,addedDatasetVersions:1,technicalSupplementExact:true,bodyLengthUnknown:true,activeSha256:hash(activeBytes),historySha256:hash(historyBytes),externalCalls:0,ordinaryPublicationExecuted:false,publicUploadExecuted:false,acceptance:false});
}finally{guard.restore();}
