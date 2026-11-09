import { bmwCatalogueLookupIdentity, mergeBmwCatalogueFacts, describeBmwEquipment }
  from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { bmwImageLookupIdentity, presentBmwImage } from '../../server/vehicle-evidence/bmw-image-adapter.js';
import { bmwLiveImageLookupIdentity, presentBmwLiveImage } from '../../server/vehicle-evidence/bmw-live-imagery.js';
import { qualifyBmwTechnicalObservation } from './bmw-technical-qualification.mjs';
import { inputDigest } from '../../server/gcsp/repository/core.js';

const METRICS = { seats: ['SEATS', 'COUNT'], luggageNormal: ['NORMAL', 'LITRES'],
  luggageExpanded: ['EXPANDED', 'LITRES'], acceleration: ['0–100 KM/H', 'SECONDS'],
  bodyLength: ['BODY LENGTH', 'MILLIMETRES'] };
const STATUSES = new Set(['ok', 'partial', 'invalid-input', 'unsupported', 'not-found',
  'identity-mismatch', 'source-unavailable']);
const REASONS = new Set(['missing-value', 'placeholder-value', 'malformed-value', 'unmapped-unit',
  'unmapped-meaning', 'unmapped-source', 'invalid-provenance', 'no-resolved-evidence']);
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const label = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 256
  && !/[<>\u0000-\u001f\u007f]|https?:\/\//i.test(value);
const code = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,95}$/.test(value);
const same = (left, right) => {
  if (left === null || right === null || left === undefined || right === undefined) return false;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const V1_CATALOGUE_OPTIONS = ['provider', 'providerVersion', 'schemaVersion', 'snapshotVersion'];
const V2_CATALOGUE_OPTIONS = ['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'];
const V2_LOOKUP_FIELDS = [...V2_CATALOGUE_OPTIONS, 'bindingDigest', 'configurationId'];
const V2_REQUEST_FIELDS = ['configurationId', 'bindingDigest'];
const V2_REQUEST_IDENTITY_FIELDS = ['snapshotVersion', ...V2_REQUEST_FIELDS];
const isV2Options = (options) => object(options) && Object.hasOwn(options, 'sourceContractVersion');
const safeDigest = (value) => { try { return inputDigest(value); } catch { return null; } };
const exactKeys = (value, fields) => object(value) && Object.keys(value).length === fields.length
  && fields.every((field) => Object.hasOwn(value, field));
const completeness = (value) => ['complete', 'partial', 'unknown'].includes(value) ? value : 'unknown';
const unknownProvenance = () => ({ kind: 'unknown', source: null, observedDate: null });
function provenance(value) {
  if (value?.kind === 'observed' && ['BMW UK catalogue', 'BMW UK OTD'].includes(value.source) && date(value.observedDate)) {
    return { kind: value.kind, source: value.source, observedDate: value.observedDate };
  }
  if (value?.kind === 'synthetic' && value.source === 'Illustrative fixture') {
    return { kind: 'synthetic', source: value.source, observedDate: null };
  }
  return unknownProvenance();
}
function identity(value, lookup, options) {
  if (!value || !object(value)) return null;
  if (isV2Options(options)) {
    const keys = Object.keys(value).sort();
    const allowed = [V2_REQUEST_FIELDS, V2_REQUEST_IDENTITY_FIELDS, V2_LOOKUP_FIELDS]
      .some((fields) => same(keys, [...fields].sort()));
    if (!allowed || (Object.hasOwn(value, 'snapshotVersion') && value.snapshotVersion !== options.snapshotVersion)
      || V2_CATALOGUE_OPTIONS.some((field) => Object.hasOwn(value, field) && value[field] !== options[field])) return null;
    return lookup({ configurationId: value.configurationId, bindingDigest: value.bindingDigest }, options);
  }
  return lookup({ ...value, selectionComplete: value.selectionComplete ?? true }, options);
}
function vehicleIdentity(lookup) {
  if (!lookup) return null;
  if (Object.hasOwn(lookup, 'sourceContractVersion')) {
    return { configurationId: lookup.configurationId, bindingDigest: lookup.bindingDigest };
  }
  const { provider, providerVersion, schemaVersion, snapshotVersion, viewpoint, size, ...vehicle } = lookup;
  return vehicle;
}
function context(result, expected, lookup) {
  const v2 = Boolean(expected && Object.hasOwn(expected, 'sourceContractVersion'));
  const options = expected && Object.fromEntries((v2 ? V2_CATALOGUE_OPTIONS : V1_CATALOGUE_OPTIONS)
    .map((key) => [key, expected[key]]));
  const requestedIdentity = vehicleIdentity(identity(result?.requestedIdentity, bmwCatalogueLookupIdentity, options));
  const resolvedIdentity = vehicleIdentity(identity(result?.resolvedIdentity, bmwCatalogueLookupIdentity, options));
  const requestedLookup = identity(result?.lookupIdentity, lookup, v2 ? options : result?.lookupIdentity);
  const resolvedLookup = identity(result?.resolvedLookupIdentity, lookup, v2 ? options : result?.resolvedLookupIdentity);
  const exactV2Shape = !v2 || (exactKeys(result?.requestedIdentity, V2_REQUEST_IDENTITY_FIELDS)
    && exactKeys(result?.resolvedIdentity, V2_REQUEST_IDENTITY_FIELDS)
    && exactKeys(result?.lookupIdentity, V2_LOOKUP_FIELDS)
    && exactKeys(result?.resolvedLookupIdentity, V2_LOOKUP_FIELDS));
  const exact = expected && options && Object.entries(options).every(([key, value]) => result?.[key] === value)
    && exactV2Shape
    && same(requestedIdentity, vehicleIdentity(expected)) && same(resolvedIdentity, vehicleIdentity(expected))
    && same(requestedLookup, expected) && same(resolvedLookup, expected);
  return { provider: code(result?.provider) ? result.provider : null,
    providerVersion: code(result?.providerVersion) ? result.providerVersion : null,
    schemaVersion: code(result?.schemaVersion) ? result.schemaVersion : null,
    snapshotVersion: code(result?.snapshotVersion) ? result.snapshotVersion : null,
    ...(v2 ? { sourceContractVersion: code(result?.sourceContractVersion) ? result.sourceContractVersion : null } : {}),
    sourceKind: result?.sourceKind === 'dated-snapshot' ? result.sourceKind : 'unknown',
    status: STATUSES.has(result?.status) ? result.status : 'source-unavailable',
    outcome: exact ? 'ok' : ['ok', 'partial'].includes(result?.status) ? 'identity-mismatch'
      : STATUSES.has(result?.status) ? result.status : 'source-unavailable', requestedIdentity, resolvedIdentity,
    lookupIdentity: requestedLookup, resolvedLookupIdentity: resolvedLookup,
    observedDate: date(result?.observedDate) ? result.observedDate : null,
    retrievedDate: date(result?.retrievedDate) ? result.retrievedDate : null };
}
function v2SourceBinding(result, expected) {
  const sourceBinding = result?.sourceBinding;
  const selection = sourceBinding?.selection;
  const canonicalIdentity = sourceBinding?.canonicalIdentity;
  const selected = result?.equipment?.selected;
  const equipment = result?.equipment;
  const requestScope = sourceBinding?.requestScope;
  const evidence = sourceBinding?.evidence;
  if (!exactKeys(sourceBinding, ['requestScope', 'confirmedContext', 'canonicalIdentity', 'selection', 'optionalFacts', 'evidence', 'producerPins'])
    || !exactKeys(selection, ['constructible', 'factoryComplete', 'accessoryCodesComplete', 'elements',
      'factoryOptionCodes', 'accessories', 'evidenceRefs', 'solverChanges'])
    || !exactKeys(canonicalIdentity, ['vgModelCode', 'agModelCode', 'factoryOptionCodes'])
    || !exactKeys(requestScope, ['market', 'locale', 'catalogueRangeKey', 'requests'])
    || !object(sourceBinding.confirmedContext) || !object(sourceBinding.optionalFacts) || !object(result?.completeness)
    || !object(sourceBinding.producerPins) || !code(canonicalIdentity.vgModelCode) || !code(canonicalIdentity.agModelCode)
    || selection.constructible !== true || selection.factoryComplete !== true || selection.accessoryCodesComplete !== true
    || !Array.isArray(selection.factoryOptionCodes) || !selection.factoryOptionCodes.length
    || !selection.factoryOptionCodes.every((item, index) => typeof item === 'string' && /^[A-Z0-9]{4,12}$/.test(item)
      && (!index || selection.factoryOptionCodes[index - 1] < item))
    || !Array.isArray(selection.accessories) || !Array.isArray(selection.elements) || !Array.isArray(selection.evidenceRefs)
    || !object(selection.solverChanges) || !Array.isArray(canonicalIdentity.factoryOptionCodes)
    || !same(canonicalIdentity.factoryOptionCodes, selection.factoryOptionCodes)
    || !['market', 'locale', 'catalogueRangeKey'].every((name) => typeof requestScope[name] === 'string')
    || !Array.isArray(requestScope.requests) || !object(result.facts)
    || !exactKeys(equipment, ['definitions', 'available', 'selected', 'verifiedFitted'])
    || !Array.isArray(equipment.definitions) || equipment.definitions.length > 256
    || !equipment.definitions.every((entry) => object(entry) && typeof entry.code === 'string' && object(entry.label))
    || !object(equipment.available) || !object(equipment.verifiedFitted)
    || !exactKeys(selected, ['state', 'options', 'accessories', 'factoryComplete', 'accessoryCodesComplete',
      'accessoryQuantitiesComplete', 'provenance']) || selected.state !== 'known' || selected.factoryComplete !== true
    || selected.accessoryCodesComplete !== true || !same(selected.options, selection.factoryOptionCodes)
    || !same(selected.accessories, selection.accessories) || !Array.isArray(evidence) || evidence.length === 0) return null;
  const evidenceFields = ['id', 'role', 'sourceId', 'sourceVersion', 'operation', 'responseSha256', 'retainedSha256',
    'observedAt', 'retrievedAt'];
  const projectedEvidence = [];
  for (const item of evidence) {
    if (!object(item) || !evidenceFields.every((name) => Object.hasOwn(item, name))
      || !evidenceFields.slice(0, 7).every((name) => typeof item[name] === 'string')
      || typeof item.observedAt !== 'string' || !(item.retrievedAt === null || typeof item.retrievedAt === 'string')) return null;
    projectedEvidence.push(Object.fromEntries(evidenceFields.map((name) => [name, item[name]])));
  }
  if (!expected || safeDigest(sourceBinding) !== expected.bindingDigest) return null;
  try {
    return { sourceBinding, selection, projectedEvidence, resolvedConfiguration: {
      requestScope: { market: requestScope.market, locale: requestScope.locale, catalogueRangeKey: requestScope.catalogueRangeKey },
      confirmedContext: structuredClone(sourceBinding.confirmedContext),
      canonicalIdentity: structuredClone(canonicalIdentity), selection: structuredClone(selection),
      optionalFacts: structuredClone(sourceBinding.optionalFacts),
    } };
  } catch { return null; }
}
function facts(result) {
  const safe = Object.fromEntries(Object.entries(METRICS).map(([name, [definition, unit]]) => {
    const fact = result.facts?.[name]; const origin = provenance(fact?.provenance);
    const known = fact?.state === 'known' && fact.definition === definition && fact.unit === unit
      && typeof fact.value === 'number' && Number.isFinite(fact.value) && fact.value >= 0
      && (unit !== 'COUNT' || Number.isSafeInteger(fact.value)) && origin.kind !== 'unknown'
      && ['complete', 'partial'].includes(fact.completeness);
    return [name, { state: known ? 'known' : 'unknown', value: known ? fact.value : null, definition, unit,
      reason: known ? null : REASONS.has(fact?.reason) ? fact.reason : 'no-resolved-evidence',
      completeness: known ? fact.completeness : 'unknown', provenance: known ? origin : unknownProvenance() }];
  }));
  return { ...safe, ...mergeBmwCatalogueFacts({}, { status: result.status, facts: safe }) };
}
function equipment(result, expected, v2Source = null) {
  const definitions = Array.isArray(result.equipment?.definitions) ? result.equipment.definitions : [];
  const selected = result.equipment?.selected;
  const selectionExact = v2Source
    ? selected?.state === 'known' && same(selected.options, v2Source.selection.factoryOptionCodes)
      && same(selected.accessories, v2Source.selection.accessories)
    : same(identity({ ...expected, selectedOptions: selected?.options,
      selectedAccessories: selected?.accessories }, bmwCatalogueLookupIdentity, expected), expected);
  const selectedProjection = v2Source ? { state: 'known', options: v2Source.selection.factoryOptionCodes,
    accessories: v2Source.selection.accessories, complete: v2Source.selection.factoryComplete,
    completeness: result.completeness?.factorySelection, provenance: selected?.provenance }
    : selectionExact ? selected : { state: 'unknown', options: null, complete: false };
  const safeResult = { equipment: { definitions,
    available: result.equipment?.available,
    selected: selectionExact ? selectedProjection : { state: 'unknown', options: null, complete: false } } };
  const codes = new Set([...definitions.map((entry) => entry?.code), ...(v2Source
    ? v2Source.selection.factoryOptionCodes : expected.selectedOptions)]);
  return [...codes].filter((entry) => typeof entry === 'string' && /^[A-Z0-9]{4,12}$/.test(entry)).sort().map((item) => {
    const claim = describeBmwEquipment(safeResult, item);
    const category = definitions.find((entry) => entry?.code === item)?.category;
    return { code: item,
      category: ['paint', 'fabric', 'other'].includes(category) ? category : 'unknown',
      definition: { ...claim.definition, label: label(claim.definition.label) ? claim.definition.label : null,
        state: label(claim.definition.label) ? claim.definition.state : 'unknown',
        completeness: completeness(claim.definition.completeness),
        provenance: provenance(claim.definition.provenance) },
      configurableAvailability: { ...claim.configurableAvailability,
        completeness: completeness(claim.configurableAvailability.completeness), provenance: provenance(claim.configurableAvailability.provenance) },
      catalogueSelection: { ...claim.catalogueSelection,
        completeness: completeness(claim.catalogueSelection.completeness), provenance: provenance(claim.catalogueSelection.provenance) },
      verifiedVinFitted: { ...claim.verifiedVinFitted, provenance: unknownProvenance() } };
  });
}

function trustedV2Appearance(output, record, catalogue, expected) {
  const binding = v2SourceBinding(catalogue, expected);
  const catalogueDigest = safeDigest(catalogue); const acceptedCatalogueDigest = safeDigest(record?.catalogue);
  if (!binding || !catalogueDigest || catalogueDigest !== acceptedCatalogueDigest
    || output.sources.catalogue.outcome !== 'ok' || !['ok', 'partial'].includes(catalogue?.status)
    || !same(catalogue?.lookupIdentity, expected) || !same(catalogue?.resolvedLookupIdentity, expected)
    || !object(catalogue.identityProvenance)) return;
  for (const [field, type] of [['paint', 'paint'], ['upholstery', 'upholstery']]) {
    const fact = record?.[field]; const value = fact?.value;
    if (fact?.state !== 'known' || !exactKeys(value, ['code', 'type']) || value.type !== type || !code(value.code)
      || !binding.selection.factoryOptionCodes.includes(value.code) || !Array.isArray(fact.evidenceRefs)) continue;
    try {
      output.appearance[field] = { state: 'known', selections: [{ code: value.code, type, label: null,
        provenance: structuredClone(catalogue.identityProvenance), evidenceRefs: structuredClone(fact.evidenceRefs) }] };
    } catch { /* Malformed detached source evidence cannot establish appearance. */ }
  }
}

/** Pure adapter-envelope projection only. The caller owns configurationId and all collection I/O/accounting. */
export function enrichConfiguration({ configurationId, request, catalogue, image, catalogueOptions = {},
  imageOptions = {}, retention, asOf } = {}) {
  const v2 = isV2Options(catalogueOptions);
  const v2RequestValid = !v2 || object(request)
    && Object.keys(request).every((key) => ['configurationId', 'bindingDigest', 'viewpoint', 'size'].includes(key));
  const catalogueRequest = v2 ? { configurationId: request?.configurationId, bindingDigest: request?.bindingDigest } : request;
  const expected = v2RequestValid ? bmwCatalogueLookupIdentity(catalogueRequest, catalogueOptions) : null;
  const expectedImage = v2 ? null : bmwImageLookupIdentity(request, imageOptions);
  const output = { configurationId: typeof configurationId === 'string' && configurationId.length > 0
    && configurationId.length <= 8192 && !/[\u0000-\u001f\u007f]|https?:\/\//i.test(configurationId) ? configurationId : null,
  scope: 'pure-enrichment', status: 'rejected', identity: vehicleIdentity(expected), facts: {}, unmappedMeasurements: [], equipment: [],
  appearance: { paint: { state: 'unknown', selections: [] }, upholstery: { state: 'unknown', selections: [] } }, image: null,
  sources: { catalogue: context(catalogue, expected, bmwCatalogueLookupIdentity),
    image: context(image, expectedImage, bmwImageLookupIdentity) },
  completeness: { selection: 'unknown', measurements: 'unknown', image: 'unknown',
    sharedAccounting: 'unvalidated', corpusIntegration: 'unvalidated' } };
  if (!output.configurationId || !expected || !date(asOf)) return output;
  const source = output.sources.catalogue;
  if (source.outcome === 'ok' && ['ok', 'partial'].includes(source.status) && source.observedDate && source.retrievedDate) {
    const v2Source = v2 ? v2SourceBinding(catalogue, expected) : null;
    if (v2 && !v2Source) source.outcome = 'identity-mismatch';
    else {
      output.facts = facts(catalogue); output.equipment = equipment(catalogue, expected, v2Source);
      output.unmappedMeasurements = Array.isArray(catalogue.unmappedMeasurements)
        ? catalogue.unmappedMeasurements.map(() => ({ state: 'unknown', value: null, reason: 'unmapped-meaning' })) : [];
      if (v2Source) {
        const factorySelection = completeness(catalogue.completeness?.factorySelection);
        const accessoryCodes = completeness(catalogue.completeness?.accessoryCodes);
        const accessoryQuantities = completeness(catalogue.completeness?.accessoryQuantities);
        output.completeness.factorySelection = factorySelection;
        output.completeness.accessoryCodes = accessoryCodes;
        output.completeness.accessoryQuantities = accessoryQuantities;
        output.completeness.selection = factorySelection === 'complete' && accessoryCodes === 'complete'
          ? accessoryQuantities === 'complete' ? 'complete' : 'partial' : 'unknown';
        const measured = Object.keys(METRICS).map((name) => output.facts[name]);
        output.completeness.measurements = measured.every((fact) => fact.state === 'unknown') ? 'unknown'
          : measured.every((fact) => fact.state === 'known' && fact.completeness === 'complete') ? 'complete' : 'partial';
        output.resolvedConfiguration = v2Source.resolvedConfiguration;
        output.sources.catalogue.evidence = v2Source.projectedEvidence;
        output.status = 'partial';
      } else {
        output.completeness.selection = output.equipment.every((claim) => claim.catalogueSelection.state !== 'unknown')
          ? completeness(catalogue.completeness?.selectedConfiguration) : 'unknown';
        for (const [name, category] of [['paint', 'paint'], ['upholstery', 'fabric']]) {
          const selections = output.equipment.filter((claim) => claim.category === category
            && claim.catalogueSelection.state === 'selected').map((claim) => ({ code: claim.code,
            label: claim.definition.label, provenance: structuredClone(claim.definition.provenance) }));
          output.appearance[name] = { state: selections.length ? 'known' : 'unknown', selections };
        }
        output.completeness.measurements = Object.values(output.facts).every((fact) => fact.state === 'unknown') ? 'unknown'
          : Object.values(output.facts).every((fact) => fact.state === 'known' && fact.completeness === 'complete') ? 'complete' : 'partial';
        output.status = Object.values(output.facts).some((fact) => fact.state === 'known') ? 'partial' : 'rejected';
      }
    }
  } else if (source.outcome === 'ok') source.outcome = 'source-unavailable';
  if (v2) {
    if (!image) return output;
    const registration = image.lookupIdentity?.requestRegistration; const shown = presentBmwLiveImage(image);
    const sourceBinding = v2SourceBinding(catalogue, expected); const canonical = sourceBinding?.sourceBinding.canonicalIdentity;
    const context = sourceBinding?.sourceBinding.confirmedContext; const sourceScope = sourceBinding?.sourceBinding.requestScope;
    const lookup = registration && bmwLiveImageLookupIdentity({ configurationId: expected.configurationId, bindingDigest: expected.bindingDigest,
      viewport: 'desktop', viewpoint: request.viewpoint, size: request.size, variantPointer: '/stage-fullscreen-views-legacy-newnames/desktop/namedImages/0/images/0' }, registration);
    const expectedImageIdentity = lookup && Object.fromEntries(Object.entries(lookup).filter(([k]) => !['provider', 'providerVersion', 'schemaVersion', 'snapshotVersion', 'viewpoint', 'size', 'viewport', 'variantPointer'].includes(k)));
    const variant = image.selectedVariant;
    const exact = output.status === 'partial' && lookup && shown.status === 'ok' && same(lookup, image.lookupIdentity)
      && same(lookup, image.resolvedLookupIdentity) && ['provider', 'providerVersion', 'schemaVersion', 'snapshotVersion'].every((k) => image[k] === lookup[k])
      && safeDigest(image.requestedIdentity) === safeDigest(expectedImageIdentity) && safeDigest(image.resolvedIdentity) === safeDigest(expectedImageIdentity)
      && exactKeys(image.identityProvenance, ['kind', 'observedDate', 'manifestIdentityEchoed', 'registrationDigest', 'acceptedLineSha256'])
      && image.identityProvenance.kind === 'independent-source-proof' && image.identityProvenance.manifestIdentityEchoed === false
      && image.identityProvenance.registrationDigest === safeDigest(registration)
      && image.identityProvenance.acceptedLineSha256 === registration.sourceAcceptedSha256
      && registration.configurationId === expected.configurationId && registration.bindingDigest === expected.bindingDigest
      && registration.model.modelCode === canonical?.vgModelCode && registration.model.agModelCode === canonical?.agModelCode
      && same(registration.factoryOptionCodes, canonical?.factoryOptionCodes)
      && registration.model.market === sourceScope?.market && registration.model.locale === sourceScope?.locale
      && registration.model.catalogueRangeKey === sourceScope?.catalogueRangeKey
      && ['modelCode', 'agModelCode', 'rawModelRange', 'orderDate', 'effectDate'].every((k) => context?.[k]?.value === registration.model[k])
      && exactKeys(variant, ['pointer', 'namedImage', 'distinctions']) && variant.pointer === lookup.variantPointer
      && typeof variant.namedImage === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(variant.namedImage)
      && exactKeys(variant.distinctions, ['BKGND', 'X', 'Y']) && Object.values(variant.distinctions).every((v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(v))
      && image.image.namedImage === variant.namedImage
      && same(image.image.size, lookup.size) && image.image.viewpoint === lookup.viewpoint
      && /^[a-f0-9]{64}$/.test(image.image.sha256) && Number.isSafeInteger(image.image.bytes) && image.image.bytes > 0 && image.image.bytes <= 2097152;
    output.sources.image = { provider: image.provider, providerVersion: image.providerVersion, schemaVersion: image.schemaVersion,
      snapshotVersion: image.snapshotVersion, sourceKind: 'dated-snapshot', outcome: exact ? 'ok' : 'identity-mismatch',
      status: exact ? 'ok' : 'identity-mismatch', observedDate: exact ? image.observedDate : null, retrievedDate: exact ? image.retrievedDate : null,
      lookupIdentity: exact ? structuredClone(lookup) : null, resolvedLookupIdentity: exact ? structuredClone(lookup) : null,
      identityProvenance: exact ? structuredClone(image.identityProvenance) : null };
    if (!exact) return output;
    if (retention?.status !== 'allowed' || !code(retention.decision)) { output.sources.image.outcome = 'retention-unknown'; return output; }
    output.image = { assetId: image.image.assetId, sha256: image.image.sha256, bytes: image.image.bytes, contentType: 'image/webp',
      role: 'representative-catalogue-render', viewpoint: lookup.viewpoint, size: structuredClone(lookup.size),
      modelCode: registration.model.modelCode, agModelCode: registration.model.agModelCode, modelRange: registration.model.rawModelRange,
      body: { state: 'unknown', value: null }, paint: { code: registration.paintCode, label: null }, fidelity: structuredClone(shown.fidelity),
      sourceDate: image.observedDate, observedDate: image.observedDate, retrievedDate: image.retrievedDate,
      retention: { status: 'allowed', decision: retention.decision }, expiresAt: null, selectedVariant: structuredClone(image.selectedVariant) };
    output.completeness.image = 'partial'; return output;
  }
  const imageSource = output.sources.image;
  const shown = presentBmwImage(image);
  if (imageSource.outcome !== 'ok') return output;
  if (shown.status !== 'ok' || shown.isFallback || !imageSource.observedDate || !imageSource.retrievedDate) {
    imageSource.outcome = 'image-unavailable'; return output;
  }
  if (retention?.status !== 'allowed' || !code(retention.decision)) {
    imageSource.outcome = retention?.status === 'denied' ? 'retention-denied' : 'retention-unknown'; return output;
  }
  if (image.expiresAt !== undefined && (!date(image.expiresAt) || image.expiresAt <= asOf)) {
    imageSource.outcome = date(image.expiresAt) ? 'expired' : 'freshness-unknown'; return output;
  }
  const asset = image.image;
  if (!expected.selectedOptions.includes(asset.paint.code) || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    imageSource.outcome = 'identity-mismatch'; return output;
  }
  output.image = { assetId: shown.assetId, sha256: asset.sha256, bytes: asset.bytes, contentType: asset.contentType,
    role: shown.role, viewpoint: expectedImage.viewpoint, size: { ...expectedImage.size },
    modelCode: expected.modelCode, agModelCode: expected.agModelCode, modelRange: expected.modelRange,
    body: { state: 'unknown', value: null }, paint: { code: asset.paint.code, label: label(asset.paint.label) ? asset.paint.label : null },
    fidelity: { ...shown.fidelity }, sourceDate: date(asset.sourceDate) ? asset.sourceDate : null,
    observedDate: imageSource.observedDate, retrievedDate: imageSource.retrievedDate,
    retention: { status: 'allowed', decision: retention.decision }, expiresAt: image.expiresAt || null };
  output.completeness.image = 'partial';
  return output;
}

/** Group registered content by hash while retaining each configuration's own source and appearance claims. */
export function reportEnrichment(records) {
  const counts = { total: records.length, partial: 0, rejected: 0 }; const assets = new Map();
  for (const record of records) {
    if (!['partial', 'rejected'].includes(record.status)) throw new Error('Unvalidated enrichment outcome');
    counts[record.status] += 1;
    if (!record.image) continue;
    const { sha256, bytes, contentType, size } = record.image;
    let asset = assets.get(sha256);
    const content = { sha256, bytes, contentType, size: structuredClone(size) };
    if (asset && !same(asset.content, content)) throw new Error('Conflicting asset metadata for content hash');
    if (!asset) { asset = { content, references: [] }; assets.set(sha256, asset); }
    asset.references.push({ configurationId: record.configurationId, image: structuredClone(record.image),
      source: structuredClone(record.sources.image) });
  }
  return { scope: 'pure-enrichment', counts, assets: [...assets.values()],
    coverage: records.map((record) => ({ configurationId: record.configurationId, status: record.status,
      completeness: structuredClone(record.completeness), catalogue: record.sources.catalogue.outcome,
      image: record.sources.image.outcome })) };
}

export const ENRICHMENT_VERSION = '1';
const requireEnrichment = (condition, errorCode, message) => {
  if (!condition) throw Object.assign(new Error(message), { code: errorCode });
};
const operationName = (name) => typeof name === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(name)
  && !['discover', 'solve'].includes(name);

/** Consume the real collector session. All I/O, accounting, retries and persistence remain session-owned.
 * Extra offline operations and their budgets must be registered before collection starts.
 * An image operation resolves retained metadata only; it never authorises image downloads.
 */
export async function enrichFleet({ session, accepted, catalogueOperation = 'catalogue', imageOperation = null,
  imageRequest = {}, catalogueOptions = {}, imageOptions = {}, retention = null, asOf,
  technicalOperation = null, technicalOptions = null, stageId = 'enrichment', onPhase = async () => {} } = {}) {
  requireEnrichment(typeof session?.withCheckpoint === 'function' && Array.isArray(accepted) && accepted.length <= 10000
    && operationName(catalogueOperation) && (imageOperation === null || operationName(imageOperation)
      && imageOperation !== catalogueOperation) && imageRequest !== null && typeof imageRequest === 'object'
    && !Array.isArray(imageRequest) && Object.keys(imageRequest).every((key) => ['viewpoint', 'size'].includes(key))
    && (technicalOperation === null || operationName(technicalOperation) && technicalOperation !== catalogueOperation
      && technicalOperation !== imageOperation && isV2Options(catalogueOptions) && object(technicalOptions))
    && date(asOf) && typeof onPhase === 'function',
  'invalid-enrichment', 'Inject a collector session, its accepted records, a dated policy and declared offline operations.');
  // Options carry only registration/pins: the session owns the accepted row and operation artifact.
  requireEnrichment(technicalOperation === null
    || Object.keys(technicalOptions).every((key) => ['registration', 'pins'].includes(key)),
  'technical-options-substitution', 'Technical options may add only registration and pins, never the accepted row or artifact.');
  // Snapshot caller input before any await; a changed selection/policy cannot resume prior outcomes.
  const input = structuredClone({ accepted, catalogueOperation, imageOperation, imageRequest,
    catalogueOptions, imageOptions, retention, asOf, ...(technicalOperation === null ? {} : { technicalOperation, technicalOptions }) });
  const stage = { id: stageId, version: ENRICHMENT_VERSION, inputDigest: inputDigest(input) };
  return session.withCheckpoint(async ({ state, stageState, execute, commit, stop, checkDeadline }) => {
    requireEnrichment(Array.isArray(state.accepted) && inputDigest(state.accepted) === inputDigest(input.accepted),
      'accepted-input-mismatch', 'Only the same accepted collector records may enter this enrichment stage.');
    const validRecord = (record) => {
      const lookup = bmwCatalogueLookupIdentity(record?.catalogueRequest, input.catalogueOptions);
      return typeof record?.configurationId === 'string' && record.configurationId.length > 0
        && record.configurationId.length <= 4096 && lookup !== null && record.lookupIdentity !== undefined
        && inputDigest(lookup) === inputDigest(record.lookupIdentity);
    };
    requireEnrichment(input.accepted.every(validRecord)
      && new Set(input.accepted.map((record) => record.configurationId)).size === input.accepted.length,
    'invalid-accepted-record', 'Accepted records must retain their exact resolved catalogue lookup and distinct configuration IDs.');
    requireEnrichment(Number.isSafeInteger(stageState.cursor) && stageState.cursor >= 0
      && stageState.cursor <= input.accepted.length && Array.isArray(stageState.records)
      && stageState.records.length === stageState.cursor && stageState.records.every((record, index) =>
        record.configurationId === input.accepted[index].configurationId && record.scope === 'session-enrichment'
          && ['partial', 'rejected'].includes(record.status)),
    'enrichment-state-invalid', 'The persisted enrichment cursor must match its committed ordered outcomes.');
    const report = (reason) => {
      const summary = reportEnrichment(stageState.records);
      return { ...summary, scope: 'session-enrichment', status: 'incomplete',
        processing: stageState.cursor === input.accepted.length ? 'finished' : 'stopped', reason,
        qualification: 'offline-session-not-source-qualified', pending: input.accepted.length - stageState.cursor,
        records: structuredClone(stageState.records), counts: structuredClone(state.counts),
        outcomes: summary.counts, deadlineAt: state.deadlineAt };
    };
    try {
      if (state.halted) stop(state.halted, true);
      while (stageState.cursor < input.accepted.length) {
        checkDeadline(); const record = input.accepted[stageState.cursor];
        const catalogue = await execute(input.catalogueOperation, record.catalogueRequest);
        await onPhase('enrichment-response-cached', { configurationId: record.configurationId, operation: input.catalogueOperation });
        const request = { ...record.catalogueRequest, ...input.imageRequest };
        // Image options may add only view/dimensions: they cannot replace a resolved source identity.
        const imageCatalogueIdentity = isV2Options(input.catalogueOptions)
          ? bmwCatalogueLookupIdentity(record.catalogueRequest, input.catalogueOptions)
          : bmwCatalogueLookupIdentity(request, input.catalogueOptions);
        requireEnrichment(same(imageCatalogueIdentity, record.lookupIdentity),
          'image-request-substitution', 'Image view/dimensions cannot substitute accepted catalogue context.');
        let image; let imageStop;
        if (input.imageOperation !== null) {
          try { image = await execute(input.imageOperation, request); }
          catch (error) { if (!error.stop) throw error; imageStop = error; }
        }
        if (input.imageOperation !== null && !imageStop) await onPhase('enrichment-response-cached', {
          configurationId: record.configurationId, operation: input.imageOperation });
        const output = enrichConfiguration({ configurationId: record.configurationId, request, catalogue, image,
          catalogueOptions: input.catalogueOptions, imageOptions: input.imageOptions, retention: input.retention, asOf: input.asOf });
        if (isV2Options(input.catalogueOptions)) trustedV2Appearance(output, record, catalogue,
          bmwCatalogueLookupIdentity(record.catalogueRequest, input.catalogueOptions));
        let technicalStop;
        if (input.technicalOperation && output.status === 'partial' && output.sources.catalogue.outcome === 'ok') {
          let artifact;
          try { artifact = await execute(input.technicalOperation, record.catalogueRequest); }
          catch (error) { if (!error.stop) throw error; technicalStop = error; }
          if (!technicalStop) {
            const qualified = qualifyBmwTechnicalObservation({ registration: input.technicalOptions.registration,
              pins: input.technicalOptions.pins, artifact, accepted: record });
            for (const [name, fact] of Object.entries(qualified.facts)) if (fact.state === 'known') output.facts[name] = fact;
            output.sources.technical = qualified.source; output.measurementEvidence = qualified.measurementEvidence;
            output.unmappedMeasurements.push(...qualified.unmappedKeys.map(() => ({ state: 'unknown', value: null, reason: 'unmapped-meaning' })));
            const measured = Object.keys(METRICS).map((name) => output.facts[name]);
            output.completeness.measurements = measured.every((fact) => fact.state === 'unknown') ? 'unknown'
              : measured.every((fact) => fact.state === 'known' && fact.completeness === 'complete') ? 'complete' : 'partial';
          } else output.sources.technical = { outcome: 'source-unavailable', execution: { status: 'stopped', reason: technicalStop.code } };
        }
        output.scope = 'session-enrichment'; output.completeness.sharedAccounting = 'shared-session-offline';
        if (imageStop) output.sources.image.execution = { status: 'stopped', reason: imageStop.code };
        stageState.records.push(output); stageState.cursor += 1; await commit('enrichment-outcome');
        await onPhase('enrichment-outcome-committed', { configurationId: record.configurationId, cursor: stageState.cursor });
        if (imageStop) throw imageStop;
        if (technicalStop) throw technicalStop;
      }
      return report('enrichment-processed');
    } catch (error) {
      if (!error.stop) throw error;
      if (error.sticky) state.halted = error.code;
      await commit('enrichment-stop'); return report(error.code);
    }
  }, { stage, initialState: { cursor: 0, records: [] } });
}
