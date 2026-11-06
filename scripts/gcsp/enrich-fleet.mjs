import { bmwCatalogueLookupIdentity, mergeBmwCatalogueFacts, describeBmwEquipment }
  from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { bmwImageLookupIdentity, presentBmwImage } from '../../server/vehicle-evidence/bmw-image-adapter.js';
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
  stageId = 'enrichment', onPhase = async () => {} } = {}) {
  requireEnrichment(typeof session?.withCheckpoint === 'function' && Array.isArray(accepted) && accepted.length <= 10000
    && operationName(catalogueOperation) && (imageOperation === null || operationName(imageOperation)
      && imageOperation !== catalogueOperation) && imageRequest !== null && typeof imageRequest === 'object'
    && !Array.isArray(imageRequest) && Object.keys(imageRequest).every((key) => ['viewpoint', 'size'].includes(key))
    && date(asOf) && typeof onPhase === 'function',
  'invalid-enrichment', 'Inject a collector session, its accepted records, a dated policy and declared offline operations.');
  // Snapshot caller input before any await; a changed selection/policy cannot resume prior outcomes.
  const input = structuredClone({ accepted, catalogueOperation, imageOperation, imageRequest,
    catalogueOptions, imageOptions, retention, asOf });
  const stage = { id: stageId, version: ENRICHMENT_VERSION, inputDigest: inputDigest(input) };
  return session.withCheckpoint(async ({ state, stageState, execute, commit, stop, checkDeadline }) => {
    requireEnrichment(Array.isArray(state.accepted) && inputDigest(state.accepted) === inputDigest(input.accepted),
      'accepted-input-mismatch', 'Only the same accepted collector records may enter this enrichment stage.');
    const validRecord = (record) => {
      const lookup = bmwCatalogueLookupIdentity(record?.catalogueRequest);
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
        requireEnrichment(same(bmwCatalogueLookupIdentity(request), record.lookupIdentity),
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
        output.scope = 'session-enrichment'; output.completeness.sharedAccounting = 'shared-session-offline';
        if (imageStop) output.sources.image.execution = { status: 'stopped', reason: imageStop.code };
        stageState.records.push(output); stageState.cursor += 1; await commit('enrichment-outcome');
        await onPhase('enrichment-outcome-committed', { configurationId: record.configurationId, cursor: stageState.cursor });
        if (imageStop) throw imageStop;
      }
      return report('enrichment-processed');
    } catch (error) {
      if (!error.stop) throw error;
      if (error.sticky) state.halted = error.code;
      await commit('enrichment-stop'); return report(error.code);
    }
  }, { stage, initialState: { cursor: 0, records: [] } });
}
