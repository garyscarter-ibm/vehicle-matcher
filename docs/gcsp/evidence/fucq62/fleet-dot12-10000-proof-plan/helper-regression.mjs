// Narrow boundary regression: unchanged existing comparator against real DTO construction.
import assert from 'node:assert/strict';
import {sourceBackedInput} from '../../../../../server/test/helpers/vin-corpus-fixture.js';
import {vehicleEvidenceDetails} from '../../../../../server/gcsp/vehicle-evidence/vehicle-details-contract.js';
import {installFleetOfflineGuard} from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
import {matchesRetained,assertRetainedHelperParity} from './matches-retained.mjs';
import {packet,save} from './common.mjs';
const p=await packet(),guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');
try{
 const parity=await assertRetainedHelperParity(),input=await sourceBackedInput(),record=input.configurations[0],digest=p.receipt.candidateManifestDigest,request={kind:'configuration',id:record.configurationId};
 const image={imageId:'proof-regression-image',asset:{type:'local-fixture',path:'representative.png'},role:'front',fidelity:'representative-configuration',sourceKind:'dated-snapshot',observedDate:record.sourceContext.observedDate};
 const dto=(images=[],technicalSupplement)=>vehicleEvidenceDetails(request,{status:'partial',record,images,technicalSupplement,active:{datasetId:'proof-fixture',version:'fixture',manifestDigest:digest}});
 const base=dto();assert.equal(matchesRetained(base,record,[],digest),true);
 const supplement={configurationId:record.configurationId,facts:{seats:{...record.catalogue.facts.seats,state:'known',value:5}}},supplemented=dto([image],supplement);assert.equal(matchesRetained(supplemented,record,[image],digest,supplement),true);
 const mutations=[['description-value',d=>{d.description.model.value='wrong';}],['identity',d=>{d.identity.configurationId='wrong';}],['snapshot',d=>{d.versions.snapshot='wrong';}],['manifest',d=>{d.versions.manifestDigest='0'.repeat(64);}],['source-facts',d=>{d.source.market='XX';}],['image',d=>{d.images.items[0].fidelity='wrong';}],['unknown-label',d=>{d.presentation.unknownLabel='Hidden';}],['routing',d=>{d.routing.liveEligible=true;}],['technical-supplement',d=>{d.technical.seats.value=6;}],['selected-options',d=>{d.equipment.selected.options=[];}]];
 for(const [name,mutate]of mutations){const changed=structuredClone(supplemented);mutate(changed);assert.equal(matchesRetained(changed,record,[image],digest,supplement),false,name);}
 assert.equal(guard.calls.length,0);await save(p.output,'helper-regression-receipt.json',{status:'unchanged-retained-helper-boundaries-passed',manifestDigest:digest,parity,actualDtoConstructor:true,positiveCases:2,mutationCases:mutations.map(([name])=>name),externalCalls:0,sourceCalls:0,acceptance:false});
}finally{guard.restore();}
