// Exact retained comparator from pinned existing verifier; no production file change.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export function matchesRetained(result, record, images, manifestDigest, supplement) {
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
    && (!catalogue || Object.entries({ ...catalogue.facts, ...supplement?.facts }).every(([key, fact]) => isDeepStrictEqual(result.technical?.[key], fact)))
    && isDeepStrictEqual((result.images?.items || []).map(({ imageId, asset, role, fidelity, sourceKind, observedDate }) =>
      ({ imageId, asset, role, fidelity, sourceKind, observedDate })), images.map(({ imageId, asset, role, fidelity, sourceKind, observedDate }) =>
      ({ imageId, asset, role, fidelity, sourceKind, observedDate })))
    && result.presentation?.syntheticLabel === 'Synthetic identity' && result.presentation?.unknownLabel === 'Unknown'
    && result.presentation?.sourceLabel === (source.sourceKind === 'dated-snapshot' ? 'Dated catalogue snapshot' : 'North American structural reference')
    && result.routing?.mode === 'offline' && result.routing.liveEligible === false;
}
export async function assertRetainedHelperParity(){
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const source=await readFile(new URL('../../../../../scripts/gcsp/verify-fleet.mjs',import.meta.url),'utf8');
 const actual=source.slice(source.indexOf('function matchesRetained('),source.indexOf('function localHttpRead('));
 const own=await readFile(new URL('./matches-retained.mjs',import.meta.url),'utf8');
 const extracted=own.slice(own.indexOf('export function matchesRetained('),own.indexOf('export async function assertRetainedHelperParity(')).replace(/^export /,'');
 const expected='c7dfafd144736bad384272c65ea828b726f76151ce8b4044ad5a929469fc429c';
 assert.equal(digest(actual),expected);assert.equal(digest(extracted),expected);return {sourceBodySha256:expected,proofBodySha256:expected,bodyUnchanged:true,productionExportChanged:false};
}
