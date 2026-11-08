import { isDeepStrictEqual } from 'node:util';
import { canonicalVehicleIdentifier } from './vehicle-lookup.js';
import { vehicleEvidenceFailure, VEHICLE_DETAILS_VERSION } from './vehicle-details-contract.js';
import { createLookupVehicleAdapter } from './lookup-adapter.js';
import { createAlternateOfflineVehicleAdapter } from './alternate-offline-adapter.js';
import { createVehicleIdentityRouting } from './identity-routing.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 8192;
const nullableText = (v) => v === null || text(v);
const date = (v) => v === null || typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const keys = (v, names) => object(v) && Object.keys(v).every((k) => names.includes(k))
  && names.every((k) => Object.hasOwn(v, k));
const stringList = (v) => Array.isArray(v) && v.every(text);
const only = (v, names) => object(v) && Object.keys(v).every((k) => names.includes(k));
const safeReference = (v) => {
  if (!text(v)) return false;
  if (!v.includes('://')) return !/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.includes('?')
    && !v.startsWith('//') && !v.includes('\\') && !v.split('/').includes('..');
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search
      && !/^(localhost|.*\.local|127\..*|0\..*|10\..*|192\.168\..*|172\.(1[6-9]|2\d|3[01])\..*|\[.*\])$/.test(u.hostname);
  } catch { return false; }
};
// Public source citations may select their documented language. This does not
// relax executable/image asset references or allow opaque credential parameters.
const safeSourceReference = (v) => {
  if (safeReference(v)) return true;
  try {
    const url = new URL(v); const entries = [...url.searchParams];
    if (entries.length !== 1 || entries[0][0] !== 'language' || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(entries[0][1])) return false;
    url.search = ''; return safeReference(url.href);
  } catch { return false; }
};
// Retained v2 public catalogue citations keep their documented GET context.
// These rules apply only to source citations, never executable/image references.
const safeV2SourceReference = (value) => {
  if (safeSourceReference(value)) return true;
  try {
    const url = new URL(value);
    if (!text(value) || url.protocol !== 'https:' || url.hostname !== 'prod.ucp.bmw.cloud'
      || url.port || url.username || url.password || url.hash) return false;
    const day = '[0-9]{4}-[0-9]{2}-[0-9]{2}';
    const context = `brands/bmwCar/countries/[a-z]{2}/effect-dates/${day}/order-dates/${day}`;
    let allowed;
    if (new RegExp(`^/localisations/overridden-vehicle-data/sources/pcaso/${context}/applications/connext/models/[A-Z0-9]{4,12}/options/languages/[a-z]{2}$`).test(url.pathname)) {
      allowed = { trim: /^[A-Z0-9]{4,12}$/ };
    } else if (new RegExp(`^/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/${context}$`).test(url.pathname)) {
      allowed = { 'gfs-policy': /^none$/, cluster: /^default$/, 'model-ranges': /^[A-Z0-9]{3,12}$/,
        'future-models': /^(true|false)$/, 'closest-fallback': /^(true|false)$/ };
    } else if (new RegExp(`^/rulesolver/constructibility-check/rule-sets/pcaso,con/${context}/models/[A-Z0-9]{4,12}$`).test(url.pathname)) {
      allowed = { application: /^connext$/, 'add-rules-for-mandatory-element-classes': /^(fabric|paint|rim)(,(fabric|paint|rim))*$/,
        'included-elements': /^[A-Z0-9]{4,12}(,[A-Z0-9]{4,12})*$/, 'mandatory-elements': /^[A-Z0-9]{4,12}(,[A-Z0-9]{4,12})*$/ };
    } else return false;
    const entries = [...url.searchParams];
    return entries.length > 0 && new Set(entries.map(([name]) => name)).size === entries.length
      && entries.every(([name, entry]) => Object.hasOwn(allowed, name) && allowed[name].test(entry));
  } catch { return false; }
};
const states = ['complete', 'partial', 'unknown'];
const failureStatuses = ['invalid-input', 'not-found', 'unsupported', 'source-unavailable', 'identity-mismatch'];
const expectedFields = ['configurationId', 'vehicleId', 'datasetId', 'originatingDatasetId', 'corpusVersion',
  'snapshotVersion', 'profileId', 'market', 'model', 'bodyType', 'powertrain', 'agModelCode', 'vgModelCode',
  'observedDate', 'catalogueDate', 'productionDate', 'registrationDate', 'effectDate', 'orderDate', 'taxDate'];
const projection = ['requested', 'resolved', 'identity', 'versions', 'description', 'technical', 'equipment',
  'images', 'source', 'completeness', 'presentation'];
const measurements = { seats: ['SEATS', 'COUNT'], luggageNormal: ['NORMAL', 'LITRES'],
  luggageExpanded: ['EXPANDED', 'LITRES'], acceleration: ['0–100 KM/H', 'SECONDS'],
  bodyLength: ['BODY LENGTH', 'MILLIMETRES'] };

function provenance(p) {
  return keys(p, ['kind', 'source', 'observedDate']) && ['observed', 'reference', 'unknown'].includes(p.kind)
    && date(p.observedDate) && (p.kind === 'unknown' ? p.source === null && p.observedDate === null
      : (text(p.source) && safeV2SourceReference(p.source) || stringList(p.source) && p.source.length > 0 && p.source.every(safeV2SourceReference))
        && p.observedDate !== null);
}
function fact(f, numeric = false) {
  if (!only(f, ['state', 'value', 'reason', 'completeness', 'provenance', ...(numeric ? ['definition', 'unit'] : [])])
    || !['known', 'unknown'].includes(f.state) || !states.includes(f.completeness) || !provenance(f.provenance)) return false;
  return f.state === 'known' ? f.completeness !== 'unknown' && f.provenance.kind !== 'unknown' && (numeric
    ? typeof f.value === 'number' && Number.isFinite(f.value) && f.value >= 0 : text(f.value))
    : f.value === null && text(f.reason) && f.completeness === 'unknown' && f.provenance.kind === 'unknown';
}
function appearance(a) {
  return only(a, ['state', 'selections', 'reason']) && ['known', 'unknown'].includes(a.state) && Array.isArray(a.selections)
    && (a.state === 'unknown' ? a.selections.length === 0 && text(a.reason) : a.selections.length > 0)
    && a.selections.every((s) => keys(s, ['code', 'label', 'claim']) && text(s.code)
      && fact(s.label) && s.claim === 'selected-catalogue-equipment');
}
function quantity(q) {
  if (!keys(q, ['state', 'value', 'reason', 'evidenceRefs']) || !Array.isArray(q.evidenceRefs) || q.evidenceRefs.length > 32) return false;
  return q.state === 'known' ? Number.isSafeInteger(q.value) && q.value > 0 && q.reason === null
    && q.evidenceRefs.length > 0 && q.evidenceRefs.every((ref) => keys(ref, ['evidenceId', 'locatorName']) && text(ref.evidenceId) && text(ref.locatorName))
    : q.state === 'unknown' && q.value === null && q.reason === 'quantity-not-exposed' && q.evidenceRefs.length === 0;
}
function boundCatalogueIdentity(i) {
  return keys(i, ['snapshotVersion', 'bindingDigest', 'configurationId']) && text(i.snapshotVersion)
    && typeof i.bindingDigest === 'string' && /^[a-f0-9]{64}$/.test(i.bindingDigest)
    && !!canonicalVehicleIdentifier('configuration', i.configurationId);
}
function equipment(e, v2 = false) {
  if (!keys(e, ['definitions', 'available', 'selected', 'verifiedFitted']) || !Array.isArray(e.definitions)
    || !e.definitions.every((d) => keys(d, ['code', 'category', 'label']) && text(d.code) && text(d.category) && fact(d.label))
    || !only(e.available, ['state', 'codes', 'complete', 'completeness', 'provenance'])
    || !only(e.selected, v2 ? ['state', 'options', 'accessories', 'factoryComplete', 'accessoryCodesComplete', 'accessoryQuantitiesComplete', 'provenance'] : ['state', 'options', 'accessories', 'complete', 'completeness', 'provenance'])
    || !keys(e.verifiedFitted, ['state', 'codes', 'reason'])) return false;
  const selected = e.selected;
  const validSelected = v2 ? keys(selected, ['state', 'options', 'accessories', 'factoryComplete', 'accessoryCodesComplete', 'accessoryQuantitiesComplete', 'provenance'])
    && selected.state === 'known' && stringList(selected.options) && Array.isArray(selected.accessories)
    && selected.factoryComplete === true && selected.accessoryCodesComplete === true
    && selected.accessories.every((a) => keys(a, ['code', 'type', 'quantity']) && text(a.code) && a.type === 'accessory' && quantity(a.quantity))
    && selected.accessoryQuantitiesComplete === selected.accessories.every((a) => a.quantity.state === 'known')
    : ['known', 'unknown'].includes(selected.state) && states.includes(selected.completeness)
      && typeof selected.complete === 'boolean'
      && (selected.state === 'known' ? stringList(selected.options) && Array.isArray(selected.accessories)
        && selected.accessories.every((a) => keys(a, ['code', 'type', 'quantity']) && text(a.code)
          && a.type === 'accessory' && Number.isSafeInteger(a.quantity) && a.quantity > 0)
        : selected.options === null && selected.accessories === null && !selected.complete);
  return ['known', 'unknown'].includes(e.available.state) && states.includes(e.available.completeness)
    && (e.available.state === 'known' ? stringList(e.available.codes) : v2
      ? Array.isArray(e.available.codes) && e.available.codes.length === 0 && e.available.complete === false && e.available.completeness === 'unknown'
      : e.available.codes === null)
    && validSelected && (selected.provenance === undefined || provenance(selected.provenance))
    && (e.available.provenance === undefined || provenance(e.available.provenance))
    && e.verifiedFitted.state === 'unknown' && e.verifiedFitted.codes === null
    && e.verifiedFitted.reason === 'source-does-not-verify-fitting';
}

function imageEvidence(i) {
  return keys(i, ['state', 'label', 'items']) && Array.isArray(i.items)
    && (i.items.length ? i.state === 'representative' && i.label === 'Representative imagery'
      : i.state === 'unknown' && i.label === 'Images unavailable')
    && i.items.every((x) => keys(x, ['imageId', 'asset', 'role', 'fidelity', 'sourceKind', 'observedDate', 'label'])
      && text(x.imageId) && safeReference(x.asset) && ['representative-model', 'representative-configuration'].includes(x.role)
      && x.role === x.fidelity && x.sourceKind === 'dated-snapshot' && date(x.observedDate) && x.observedDate !== null
      && x.label === (x.fidelity === 'representative-configuration' ? 'Representative configuration image' : 'Representative model image'));
}
function sourceEvidence(s) {
  const names = ['kind', 'references', 'confidence', 'observedDate', 'retrievedDate', 'catalogueDate', 'catalogueValidity',
    'requestedIdentity', 'resolvedIdentity', 'configurationIdentity', 'market', 'region', 'steering', 'agModelCode',
    'vgModelCode', 'modelYear', 'productionEra', 'productionDate', 'registrationDate', 'profile', 'profileSources',
    'profileConfidence', 'completeVinDecoded', 'unresolvedFacts', 'identityProvenance'];
  return keys(s, names) && ['dated-snapshot', 'north-american-reference'].includes(s.kind)
    && stringList(s.references) && s.references.every(boundCatalogueIdentity(s.resolvedIdentity) ? safeV2SourceReference : safeSourceReference) && s.references.length > 0 && text(s.confidence)
    && ['observedDate', 'retrievedDate', 'catalogueDate', 'productionDate', 'registrationDate'].every((k) => date(s[k]))
    && s.observedDate !== null && text(s.market) && s.completeVinDecoded === false
    && ['region', 'steering', 'agModelCode', 'vgModelCode', 'productionEra', 'profileConfidence'].every((k) => nullableText(s[k]))
    && (s.modelYear === null || Number.isInteger(s.modelYear)) && stringList(s.unresolvedFacts)
    && keys(s.configurationIdentity, ['vgModelCode', 'agModelCode', 'factoryOptionCodes', 'provenance'])
    && text(s.configurationIdentity.vgModelCode) && nullableText(s.configurationIdentity.agModelCode)
    && stringList(s.configurationIdentity.factoryOptionCodes)
    && keys(s.identityProvenance, ['kind', 'source', 'observedDate']) && ['synthetic', 'observed'].includes(s.identityProvenance.kind)
    && text(s.identityProvenance.source) && date(s.identityProvenance.observedDate)
    && isDeepStrictEqual(s.identityProvenance, s.configurationIdentity.provenance)
    && (s.requestedIdentity === null || catalogueIdentity(s.requestedIdentity))
    && (s.resolvedIdentity === null || catalogueIdentity(s.resolvedIdentity))
    && (s.profile === null || keys(s.profile, ['profileId', 'profileVersion', 'registryVersion', 'referenceOnly'])
      && ['profileId', 'profileVersion', 'registryVersion'].every((k) => text(s.profile[k])) && typeof s.profile.referenceOnly === 'boolean')
    && (s.profileSources === null || Array.isArray(s.profileSources) && s.profileSources.every((p) =>
      keys(p, ['id', 'kind', 'scope', 'source', 'observedDate', 'sourceDate']) && ['id', 'kind', 'scope'].every((k) => text(p[k]))
      && safeSourceReference(p.source) && date(p.observedDate) && date(p.sourceDate)))
    && (s.catalogueValidity === null || keys(s.catalogueValidity, ['effectDate', 'orderDate', 'productionDate', 'taxDate'])
      && Object.values(s.catalogueValidity).every((v) => date(v) && v !== null));
}
function catalogueIdentity(i) {
  if (boundCatalogueIdentity(i)) return true;
  const dates = ['catalogueDate', 'effectDate', 'orderDate', 'productionDate', 'taxDate'];
  const names = ['agModelCode', 'locale', 'market', 'modelCode', 'modelRange', 'rawModelRange', 'trim'];
  return keys(i, [...dates, ...names, 'selectedOptions', 'selectedAccessories'])
    && dates.every((k) => date(i[k]) && i[k] !== null) && names.every((k) => text(i[k]))
    && stringList(i.selectedOptions) && Array.isArray(i.selectedAccessories)
    && i.selectedAccessories.every((a) => keys(a, ['code', 'type', 'quantity']) && text(a.code)
      && a.type === 'accessory' && Number.isSafeInteger(a.quantity) && a.quantity > 0);
}
function validSuccess(w) {
  if (!object(w) || !['complete', 'partial'].includes(w.status) || w.failure !== null
    || !keys(w.requested, ['kind', 'id']) || !keys(w.resolved, ['kind', 'id', 'configurationId'])
    || !keys(w.identity, ['kind', 'identityKind', 'configurationId', 'vehicleId', 'datasetId', 'originatingDatasetId', 'orderUuid', 'orderNumber', 'vin', 'usage'])
    || !['configuration', 'stock', 'vin'].includes(w.identity.kind) || !text(w.identity.identityKind)
    || !canonicalVehicleIdentifier('configuration', w.identity.configurationId)
    || !text(w.identity.datasetId) || !text(w.identity.originatingDatasetId)
    || !['vehicleId', 'orderUuid', 'orderNumber', 'vin'].every((k) => nullableText(w.identity[k]))
    || !keys(w.versions, ['corpus', 'manifestDigest', 'snapshot', 'profileRegistry', 'generator'])
    || !['corpus', 'manifestDigest', 'snapshot'].every((k) => text(w.versions[k]))
    || !['profileRegistry', 'generator'].every((k) => nullableText(w.versions[k]))) return false;
  const d = w.description;
  return keys(d, ['model', 'derivative', 'generation', 'bodyType', 'powertrain', 'paint', 'upholstery'])
    && ['model', 'derivative', 'generation', 'bodyType'].every((k) => fact(d[k]))
    && keys(d.powertrain, ['fuel', 'drive', 'transmission', 'engine']) && Object.values(d.powertrain).every((f) => fact(f))
    && appearance(d.paint) && appearance(d.upholstery) && keys(w.technical, Object.keys(measurements))
    && Object.entries(measurements).every(([k, [meaning, unit]]) => fact(w.technical[k], true)
      && w.technical[k].definition === meaning && w.technical[k].unit === unit)
    && equipment(w.equipment, boundCatalogueIdentity(w.source?.resolvedIdentity)) && imageEvidence(w.images) && sourceEvidence(w.source)
    && keys(w.completeness, ['record', 'selectedOptions', 'measurements', 'optionDefinitions', 'availableOptions', 'verifiedFitted', 'images'])
    && w.completeness.record === w.status && w.completeness.verifiedFitted === 'unknown'
    && ['selectedOptions', 'measurements', 'optionDefinitions', 'availableOptions'].every((k) => states.includes(w.completeness[k]))
    && w.completeness.images === w.images.state
    && keys(w.presentation, ['syntheticLabel', 'associationLabel', 'sourceLabel', 'verifiedFittedLabel', 'unknownLabel', 'imageLabel'])
    && w.presentation.syntheticLabel === 'Synthetic identity' && text(w.presentation.associationLabel)
    && w.presentation.verifiedFittedLabel === 'VIN-fitted equipment unknown' && w.presentation.unknownLabel === 'Unknown'
    && w.presentation.sourceLabel === (w.source.kind === 'dated-snapshot' ? 'Dated catalogue snapshot' : 'North American structural reference')
    && w.presentation.imageLabel === w.images.label && w.routing?.mode === 'offline' && w.routing.liveEligible === false;
}
function matches(request, w) {
  const i = w.identity; const s = w.source;
  if (w.requested.kind !== request.kind || w.requested.id !== request.id || w.resolved.kind !== request.kind
    || w.resolved.id !== request.id || i.kind !== request.kind || i.identityKind !== 'synthetic'
    || w.resolved.configurationId !== i.configurationId) return false;
  if (request.kind === 'configuration' && (i.configurationId !== request.id || i.vehicleId !== null || i.vin !== null
    || i.orderUuid !== null || i.orderNumber !== null || i.usage !== 'configuration')) return false;
  if (request.kind === 'stock' && (i.orderUuid !== request.id || !/^\d{7}$/.test(i.orderNumber)
    || !text(i.vehicleId) || i.vin !== null || i.usage !== 'stock')) return false;
  if (request.kind === 'vin' && (i.vin !== request.id || !text(i.vehicleId) || i.orderUuid !== null
    || i.orderNumber !== null || !['current-car', 'delivered-car'].includes(i.usage))) return false;
  if (!isDeepStrictEqual(s.requestedIdentity, s.resolvedIdentity)) return false;
  const config = s.configurationIdentity;
  if (Buffer.from(`${config.vgModelCode}:${config.factoryOptionCodes.join(',')}`).toString('base64') !== i.configurationId) return false;
  if (boundCatalogueIdentity(s.resolvedIdentity)) {
    if (s.resolvedIdentity.configurationId !== i.configurationId || s.resolvedIdentity.snapshotVersion !== w.versions.snapshot
      || !isDeepStrictEqual(config.factoryOptionCodes, w.equipment.selected.options)) return false;
  } else if (s.resolvedIdentity && (s.resolvedIdentity.modelCode !== s.vgModelCode || s.resolvedIdentity.market !== s.market
    || s.resolvedIdentity.agModelCode !== s.agModelCode || s.resolvedIdentity.catalogueDate !== s.catalogueDate
    || !isDeepStrictEqual(s.resolvedIdentity.selectedOptions, w.equipment.selected.options)
    || !['effectDate', 'orderDate', 'productionDate', 'taxDate'].every((k) => s.resolvedIdentity[k] === s.catalogueValidity?.[k]))) return false;
  const actual = { configurationId: i.configurationId, vehicleId: i.vehicleId, datasetId: i.datasetId,
    originatingDatasetId: i.originatingDatasetId, corpusVersion: w.versions.corpus, snapshotVersion: w.versions.snapshot,
    profileId: s.profile?.profileId, market: s.market, model: w.description.model.value,
    bodyType: w.description.bodyType.value, powertrain: w.description.powertrain.fuel.value,
    agModelCode: s.agModelCode, vgModelCode: s.vgModelCode, observedDate: s.observedDate,
    catalogueDate: s.catalogueDate, productionDate: s.productionDate, registrationDate: s.registrationDate,
    effectDate: s.catalogueValidity?.effectDate, orderDate: s.catalogueValidity?.orderDate, taxDate: s.catalogueValidity?.taxDate };
  return Object.entries(request.expected || {}).every(([k, v]) => actual[k] === v);
}
const unavailableTransport = () => ({ protocol: null, status: null, attempts: 0, outcome: 'unavailable' });
function failure(status, kind, transport) {
  return { contractVersion: VEHICLE_DETAILS_VERSION, status, vehicle: null,
    failure: vehicleEvidenceFailure(status, kind).failure, transport: transport || unavailableTransport() };
}

/** Application-service port: trusted requests in, provider-independent facts or typed failure out. */
export function createVehicleDetailsConsumer({ adapter } = {}) {
  return Object.freeze({ async resolve(request, { context } = {}) {
    const id = canonicalVehicleIdentifier(request?.kind, request?.id);
    if (!object(request) || Object.keys(request).some((k) => !['kind', 'id', 'expected'].includes(k)) || !id
      || request.expected !== undefined && (!object(request.expected)
        || Object.entries(request.expected).some(([k, v]) => !expectedFields.includes(k) || !text(v)))) {
      return failure('invalid-input', request?.kind);
    }
    const trusted = structuredClone({ ...request, id });
    if (trusted.kind === 'stock' && (!object(context) || !['runId', 'environmentId', 'principalId'].every((k) => text(context[k]))
      || !Array.isArray(context.roles) || !context.roles.every(text))) return failure('source-unavailable', request.kind);
    let response;
    try { response = await adapter?.resolve(trusted, { context: context && structuredClone(context) }); }
    catch { return failure('source-unavailable', request.kind); }
    const t = response?.transport;
    if (!object(t) || !['in-process', 'offline'].includes(t.protocol) || !Number.isInteger(t.attempts)
      || t.attempts < 1 || t.attempts > 2 || !['answered', 'unavailable'].includes(t.outcome)
      || t.status !== null && (!Number.isInteger(t.status) || t.status < 100 || t.status > 599)) return failure('source-unavailable', request.kind);
    const transport = { protocol: t.protocol, status: t.status, attempts: t.attempts, outcome: t.outcome };
    if (transport.outcome !== 'answered' || transport.status !== null && transport.status !== 200) {
      return failure('source-unavailable', request.kind, transport);
    }
    const w = response.result;
    if (!object(w) || w.contractVersion !== VEHICLE_DETAILS_VERSION || w.schemaVersion !== '1') return failure('source-unavailable', request.kind, transport);
    if (failureStatuses.includes(w.status)) {
      if (!object(w.failure) || w.identity !== null || w.resolved !== null) return failure('source-unavailable', request.kind, transport);
      return failure(w.status, request.kind, transport);
    }
    if (!validSuccess(w)) return failure('source-unavailable', request.kind, transport);
    if (!matches(trusted, w)) return failure('identity-mismatch', request.kind, transport);
    return { contractVersion: VEHICLE_DETAILS_VERSION, status: w.status,
      vehicle: structuredClone(Object.fromEntries(projection.map((k) => [k, w[k]]))), failure: null, transport };
  } });
}

/** Construction is server-owned. Request objects cannot select a provider or a URL. */
export function createConfiguredVehicleDetails({ provider = 'lookup', lookup, identityLookup = lookup, alternateRead, timeoutMs, maxAttempts } = {}) {
  const route = createVehicleIdentityRouting({ identityLookup, provider });
  const adapter = provider === 'lookup' ? createLookupVehicleAdapter({ lookup, route, timeoutMs, maxAttempts })
    : createAlternateOfflineVehicleAdapter({ read: alternateRead, route, timeoutMs, maxAttempts });
  return createVehicleDetailsConsumer({ adapter });
}
