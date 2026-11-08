import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateCorpusDirectory} from '../../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import {createSyntheticRegistry} from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import {createVehicleEvidenceLookup} from '../../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import {createConfiguredVehicleDetails} from '../../../../../server/gcsp/vehicle-evidence/application-vehicle-details.js';
import {createPolicyService} from '../../../../../server/gcsp/policy/index.js';
import {APPROVED_CORPUS_IMAGES} from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import {releaseLimits} from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import {installFleetOfflineGuard} from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';
function matchesRetained(result, record, images, manifestDigest) {
  if (!['partial', 'complete'].includes(result?.status) || !record) return false;
  const source = record.sourceContext; const catalogue = record.catalogue; const configuration = record.configuration;
  return result.identity?.configurationId === record.configurationId && result.versions?.manifestDigest === manifestDigest
    && result.versions.snapshot === record.snapshotVersion
    && [['model', 'model'], ['derivative', 'derivative'], ['generation', 'generation'], ['bodyType', 'body']]
      .every(([field, stored]) => result.description?.[field]?.value === configuration[stored])
    && [['fuel', 'powertrain'], ['drive', 'drive'], ['transmission', 'transmission'], ['engine', 'engineCode']]
      .every(([field, stored]) => result.description?.powertrain?.[field]?.value === configuration[stored])
    && ['market', 'region', 'steering', 'agModelCode', 'vgModelCode', 'modelYear', 'productionEra', 'productionDate']
      .every((field) => result.source?.[field] === configuration[field])
    && result.source?.kind === source.sourceKind
    && result.source.observedDate === source.observedDate && result.source.catalogueDate === source.catalogueDate
    && isDeepStrictEqual(result.source.configurationIdentity, record.canonicalIdentity)
    && isDeepStrictEqual(result.source.references, source.sourceRefs)
    && isDeepStrictEqual(result.source.unresolvedFacts, source.unresolvedFacts)
    && result.completeness?.selectedOptions === source.selectedOptionCompleteness
    && (catalogue ? isDeepStrictEqual(result.equipment?.selected?.options, record.canonicalIdentity.factoryOptionCodes)
      : result.equipment?.selected?.state === 'unknown')
    && (!catalogue || Object.entries(catalogue.facts || {}).every(([key, fact]) => isDeepStrictEqual(result.technical?.[key], fact)))
    && isDeepStrictEqual((result.images?.items || []).map(({ imageId, asset, role, fidelity, sourceKind, observedDate }) =>
      ({ imageId, asset, role, fidelity, sourceKind, observedDate })), images.map(({ imageId, asset, role, fidelity, sourceKind, observedDate }) =>
      ({ imageId, asset, role, fidelity, sourceKind, observedDate })))
    && result.presentation?.syntheticLabel === 'Synthetic identity' && result.presentation?.unknownLabel === 'Unknown'
    && result.presentation?.sourceLabel === (source.sourceKind === 'dated-snapshot' ? 'Dated catalogue snapshot' : 'North American structural reference')
    && result.routing?.mode === 'offline' && result.routing.liveEligible === false;
}

const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url)));const output=plan.outputRoot;const release=JSON.parse(await readFile(join(output,'descriptor.json')));const options={indexed:true,approvedImages:APPROVED_CORPUS_IMAGES,jsonlLimitsForManifest:releaseLimits,policyService:createPolicyService(),policyRead:{runId:'dot8-diagnose-direct',asOf:'2026-11-07T00:00:00.000Z'}};
const guard=installFleetOfflineGuard();assert.equal(guard.control(),'blocked');const mismatches=[];
try{const checked=await validateCorpusDirectory(plan.candidateDirectory,options);assert.equal(checked.status,'ok');const rows=checked.corpus;const registry=createSyntheticRegistry({root:join(output,'isolated-store'),...options});assert.equal((await registry.load()).active.manifestDigest,release.releaseId);const lookup=createVehicleEvidenceLookup({registry});const consumer=createConfiguredVehicleDetails({lookup,timeoutMs:5000,maxAttempts:1});
 const imageAssociations=new Map();for(const image of rows.images){const references=imageAssociations.get(image.configurationId)||[];references.push(image.imageId);imageAssociations.set(image.configurationId,references);}
 const requests=[...rows.configurations.metadataEntries()].map(e=>({kind:'configuration',id:e.key}));for(const e of rows.vins.metadataEntries())requests.push({kind:'vin',id:e.vin17});
 for(const request of requests){const direct=await lookup.resolve(request);const consumed=await consumer.resolve(request);const row=rows.configurations.get(direct.identity?.configurationId);const images=[...new Set([...(row?.imageIds||[]),...(imageAssociations.get(row?.configurationId)||[])])].map(id=>rows.images.get(id));const matches=matchesRetained(direct,row,images,release.releaseId);const consumption=consumed.status===direct.status&&consumed.vehicle&&isDeepStrictEqual(consumed.vehicle,Object.fromEntries(Object.keys(consumed.vehicle).map(k=>[k,direct[k]])));
 if(!matches||!consumption)mismatches.push({request,matchesRetained:matches,consumerMatches:!!consumption,row,images,direct,consumed});}
 assert.equal(guard.calls.length,0);
}finally{guard.restore();}
await writeFile(join(output,'diagnose-receipt.json'),JSON.stringify({status:'direct-discrepancies-located',manifestDigest:release.releaseId,mismatches,externalCalls:guard.calls.length,ordinaryPublicationExecuted:false},null,2)+'\n');console.log(JSON.stringify({mismatches:mismatches.length,externalCalls:guard.calls.length}));
