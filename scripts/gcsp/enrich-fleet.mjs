import { bmwCatalogueLookupIdentity, mergeBmwCatalogueFacts, describeBmwEquipment }
  from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { bmwImageLookupIdentity, presentBmwImage } from '../../server/vehicle-evidence/bmw-image-adapter.js';

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
const same = (left, right) => left !== null && right !== null && JSON.stringify(left) === JSON.stringify(right);
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
  return value ? lookup({ ...value, selectionComplete: value.selectionComplete ?? true }, options) : null;
}
function vehicleIdentity(lookup) {
  if (!lookup) return null;
  const { provider, providerVersion, schemaVersion, snapshotVersion, viewpoint, size, ...vehicle } = lookup;
  return vehicle;
}
function context(result, expected, lookup) {
  const options = expected && Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'snapshotVersion']
    .map((key) => [key, expected[key]]));
  const requestedIdentity = vehicleIdentity(identity(result?.requestedIdentity, bmwCatalogueLookupIdentity, options));
  const resolvedIdentity = vehicleIdentity(identity(result?.resolvedIdentity, bmwCatalogueLookupIdentity, options));
  const requestedLookup = identity(result?.lookupIdentity, lookup, result?.lookupIdentity);
  const resolvedLookup = identity(result?.resolvedLookupIdentity, lookup, result?.resolvedLookupIdentity);
  const exact = expected && options && Object.entries(options).every(([key, value]) => result?.[key] === value)
    && same(requestedIdentity, vehicleIdentity(expected)) && same(resolvedIdentity, vehicleIdentity(expected))
    && same(requestedLookup, expected) && same(resolvedLookup, expected);
  return { provider: code(result?.provider) ? result.provider : null,
    providerVersion: code(result?.providerVersion) ? result.providerVersion : null,
    schemaVersion: code(result?.schemaVersion) ? result.schemaVersion : null,
    snapshotVersion: code(result?.snapshotVersion) ? result.snapshotVersion : null,
    sourceKind: result?.sourceKind === 'dated-snapshot' ? result.sourceKind : 'unknown',
    status: STATUSES.has(result?.status) ? result.status : 'source-unavailable',
    outcome: exact ? 'ok' : ['ok', 'partial'].includes(result?.status) ? 'identity-mismatch'
      : STATUSES.has(result?.status) ? result.status : 'source-unavailable', requestedIdentity, resolvedIdentity,
    lookupIdentity: requestedLookup, resolvedLookupIdentity: resolvedLookup,
    observedDate: date(result?.observedDate) ? result.observedDate : null,
    retrievedDate: date(result?.retrievedDate) ? result.retrievedDate : null };
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
function equipment(result, expected) {
  const definitions = Array.isArray(result.equipment?.definitions) ? result.equipment.definitions : [];
  const selected = result.equipment?.selected;
  const selectionExact = same(identity({ ...expected, selectedOptions: selected?.options,
    selectedAccessories: selected?.accessories }, bmwCatalogueLookupIdentity, expected), expected);
  const safeResult = { equipment: { definitions,
    available: result.equipment?.available,
    selected: selectionExact ? selected : { state: 'unknown', options: null, complete: false } } };
  const codes = new Set([...definitions.map((entry) => entry?.code), ...expected.selectedOptions]);
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

/** Pure adapter-envelope projection only. The caller owns configurationId and all collection I/O/accounting. */
export function enrichConfiguration({ configurationId, request, catalogue, image, catalogueOptions = {},
  imageOptions = {}, retention, asOf } = {}) {
  const expected = bmwCatalogueLookupIdentity(request, catalogueOptions);
  const expectedImage = bmwImageLookupIdentity(request, imageOptions);
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
    output.facts = facts(catalogue); output.equipment = equipment(catalogue, expected);
    output.unmappedMeasurements = Array.isArray(catalogue.unmappedMeasurements)
      ? catalogue.unmappedMeasurements.map(() => ({ state: 'unknown', value: null, reason: 'unmapped-meaning' })) : [];
    output.completeness.selection = output.equipment.every((claim) => claim.catalogueSelection.state !== 'unknown')
      ? completeness(catalogue.completeness?.selectedConfiguration) : 'unknown';
    for (const [name, category] of [['paint', 'paint'], ['upholstery', 'fabric']]) {
      const selections = output.equipment.filter((claim) => claim.category === category
        && claim.catalogueSelection.state === 'selected').map((claim) => ({ code: claim.code,
        label: claim.definition.label, provenance: structuredClone(claim.definition.provenance) }));
      output.appearance[name] = { state: selections.length ? 'known' : 'unknown', selections };
    }
    output.completeness.measurements = Object.values(output.facts).every((fact) => fact.state === 'known'
      && fact.completeness === 'complete') ? 'complete' : 'partial';
    output.status = Object.values(output.facts).some((fact) => fact.state === 'known') ? 'partial' : 'rejected';
  } else if (source.outcome === 'ok') source.outcome = 'source-unavailable';
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
