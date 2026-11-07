import { readFile } from 'node:fs/promises';
import { bmwCatalogueV2LookupIdentity } from './bmw-catalogue-v2.js';
export { validateBmwCatalogueV2Envelope } from './bmw-catalogue-v2.js';

const VERSION = 'bmw-gb-i5-2026-11-01.v1';
const PROVIDER = 'bmw-catalogue-snapshot';
const PROVIDER_VERSION = '1';
const SCHEMA_VERSION = '1';
const VERSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,95}$/;
const SNAPSHOTS = new Map([[VERSION, new URL('./snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url)]]);
const IDENTITY_FIELDS = ['catalogueDate', 'market', 'locale', 'modelCode', 'modelRange', 'rawModelRange', 'agModelCode',
  'trim', 'orderDate', 'effectDate', 'productionDate', 'taxDate'];
const DATE_FIELDS = ['orderDate', 'effectDate', 'productionDate', 'taxDate'];
const MEASUREMENTS = {
  seats: ['N_SITZE', 'SEATS', 'COUNT'],
  luggageNormal: ['A_GEPR_V211', 'NORMAL', 'LITRES'],
  luggageExpanded: ['A_GEPR_V214', 'EXPANDED', 'LITRES'],
  acceleration: ['E_0_100KMH', '0–100 KM/H', 'SECONDS'],
};
const CODE = /^[A-Z0-9]{4,12}$/;
const SOURCES = new Set(['BMW UK catalogue', 'BMW UK OTD']);
const COMPLETENESS = new Set(['complete', 'partial']);
const REASONS = {
  'missing-value': 'missing value', 'placeholder-value': 'placeholder value',
  'malformed-value': 'malformed value', 'unmapped-unit': 'unit not mapped',
  'unmapped-meaning': 'meaning not mapped', 'unmapped-source': 'source not mapped',
  'invalid-provenance': 'source or date unavailable', 'no-resolved-evidence': 'no resolved evidence',
  'incomplete-selection': 'incomplete selection', 'unavailable-selection': 'selection evidence unavailable',
};

export function rejectOutbound() {
  throw new Error('Outbound transport disabled for catalogue snapshots');
}

async function loadLocalSnapshot(version) {
  return JSON.parse(await readFile(SNAPSHOTS.get(version), 'utf8'));
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function validCodes(codes) {
  return Array.isArray(codes) && codes.every((code) => typeof code === 'string' && CODE.test(code))
    && new Set(codes).size === codes.length;
}

function validRequest(request) {
  return request && typeof request === 'object' && !Array.isArray(request)
    && IDENTITY_FIELDS.every((key) => typeof request[key] === 'string' && request[key].length <= 32)
    && /^[A-Z]{2}$/.test(request.market) && /^[a-z]{2}-[A-Z]{2}$/.test(request.locale)
    && ['modelCode', 'agModelCode', 'trim'].every((key) => CODE.test(request[key]))
    && ['modelRange', 'rawModelRange'].every((key) => /^[A-Z0-9]{3,12}$/.test(request[key]))
    && validDate(request.catalogueDate) && DATE_FIELDS.every((key) => validDate(request[key]))
    && request.selectionComplete === true && validCodes(request.selectedOptions)
    && request.selectedOptions.length > 0 && request.selectedOptions.length <= 256
    && Array.isArray(request.selectedAccessories) && request.selectedAccessories.length <= 64
    && request.selectedAccessories.every((item) => item && typeof item.code === 'string'
      && CODE.test(item.code) && item.type === 'accessory' && Number.isSafeInteger(item.quantity) && item.quantity > 0)
    && new Set(request.selectedAccessories.map(({ code }) => code)).size === request.selectedAccessories.length
    && !request.selectedAccessories.some(({ code }) => request.selectedOptions.includes(code));
}

function identity(request) {
  const result = Object.fromEntries(IDENTITY_FIELDS.map((key) => [key, request[key]]));
  result.selectedOptions = [...request.selectedOptions].sort();
  result.selectedAccessories = request.selectedAccessories.map(({ code, type, quantity }) => ({ code, type, quantity }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return result;
}

/** Stable value identity only: JSON.stringify it for a cache key; no cache or live provider is enabled. */
export function bmwCatalogueLookupIdentity(request, options = {}) {
  if (options && Object.hasOwn(options, 'sourceContractVersion')) return bmwCatalogueV2LookupIdentity(request, options);
  if (!validRequest(request) || !options || typeof options !== 'object' || Array.isArray(options)) return null;
  const { provider = PROVIDER, providerVersion = PROVIDER_VERSION, schemaVersion = SCHEMA_VERSION,
    snapshotVersion = VERSION } = options;
  if (![provider, providerVersion, schemaVersion, snapshotVersion]
    .every((value) => typeof value === 'string' && VERSION_ID.test(value))) return null;
  return { provider, providerVersion, schemaVersion, snapshotVersion, ...identity(request) };
}

const FAILURES = {
  'invalid-request': ['Check the complete vehicle identity, dates and selection.', false],
  'unsupported-snapshot': ['This snapshot or version is not supported.', false],
  'unsupported-market': ['This market or language is not supported by the snapshot.', false],
  'snapshot-not-found': ['No snapshot is available for this model.', false],
  'snapshot-identity-mismatch': ['The snapshot describes a different configuration or date. No facts were substituted.', false],
  'artifact-missing': ['The local catalogue snapshot is missing.', true],
  'artifact-unreadable': ['The local catalogue snapshot could not be read.', true],
  'artifact-malformed': ['The local catalogue snapshot is not valid.', true],
  'artifact-incompatible': ['The local catalogue snapshot has an incompatible version.', true],
};
const FAILURE_STATUS = {
  'invalid-input': 'invalid-request', unsupported: 'unsupported-snapshot', 'not-found': 'snapshot-not-found',
  'identity-mismatch': 'snapshot-identity-mismatch', 'source-unavailable': 'artifact-unreadable',
};
function failure(code) {
  const [message, retryable] = FAILURES[code];
  return { code, message, retryable };
}

/** Apply only resolved known catalogue facts; unavailable/unknown evidence never erases caller facts. */
export function mergeBmwCatalogueFacts(existingFacts, result) {
  const merged = existingFacts && typeof existingFacts === 'object' && !Array.isArray(existingFacts)
    ? structuredClone(existingFacts) : {};
  if (['ok', 'partial'].includes(result?.status)) {
    for (const name of Object.keys(emptyFacts())) {
      if (result.facts?.[name]?.state === 'known') merged[name] = structuredClone(result.facts[name]);
    }
  }
  return merged;
}

function sourceIdentity(data) {
  const model = data.model || {};
  const compactDate = model.prodDate;
  return {
    catalogueDate: data.observedDate, market: data.market, locale: data.locale, modelCode: model.modelCode,
    modelRange: model.modelRange, rawModelRange: model.rawModelRange, agModelCode: model.agModelCode,
    trim: data.trim, orderDate: model.orderDate, effectDate: model.effectDate, taxDate: model.taxDate,
    productionDate: typeof compactDate === 'string'
      ? `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}` : null,
    selectedOptions: data.selectedOptions, selectedAccessories: data.selectedAccessories, selectionComplete: true,
  };
}

function validSnapshot(data, version) {
  return data && data.schemaVersion === '1' && data.snapshotVersion === version
    && validDate(data.observedDate) && validDate(data.retrievedDate)
    && validRequest(sourceIdentity(data)) && /^\d{8}$/.test(data.model.prodDate)
    && data.selectedOptions.length === 47 && data.selectedOptions.includes(data.trim);
}

function provenance(kind, observedDate) {
  if (kind === 'observed') return { kind, source: 'BMW UK catalogue', observedDate };
  if (kind === 'synthetic') return { kind, source: 'Illustrative fixture', observedDate: null };
  return { kind: 'unknown', source: null, observedDate: null };
}

function unknown(definition, unit, reason = 'no-resolved-evidence') {
  return { state: 'unknown', value: null, definition, unit, reason,
    completeness: 'unknown', provenance: provenance('unknown') };
}

function valueProblem(value) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return 'missing-value';
  if (typeof value === 'string' && /^(?:-+|0{4}|N\/?A|null|unknown)$/i.test(value.trim())) return 'placeholder-value';
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'malformed-value';
  return null;
}

function attributed(entry) {
  return entry && COMPLETENESS.has(entry.completeness)
    && (entry.origin === 'synthetic' || (entry.origin === 'observed'
      && SOURCES.has(entry.source) && validDate(entry.observedDate)));
}

function entryProvenance(entry) {
  return entry.origin === 'observed'
    ? { kind: 'observed', source: entry.source, observedDate: entry.observedDate }
    : provenance('synthetic');
}

function fact(entry, definition, unit) {
  const problem = valueProblem(entry?.value)
    || (entry.definition !== definition ? 'unmapped-meaning' : null)
    || (entry.unit !== unit ? 'unmapped-unit' : null)
    || (!attributed(entry) ? 'invalid-provenance' : null)
    || (unit === 'COUNT' && !Number.isSafeInteger(entry.value) ? 'malformed-value' : null);
  if (problem) return unknown(definition, unit, problem);
  return { state: 'known', value: entry.value, definition, unit,
    completeness: entry.completeness, provenance: entryProvenance(entry) };
}

function emptyFacts() {
  return {
    ...Object.fromEntries(Object.entries(MEASUREMENTS).map(([name, [, definition, unit]]) => [name, unknown(definition, unit)])),
    bodyLength: unknown('BODY LENGTH', 'MILLIMETRES'),
  };
}

function envelope(status, version, requestedIdentity = null, reason = FAILURE_STATUS[status], lookupIdentity = null) {
  return {
    provider: PROVIDER, providerVersion: PROVIDER_VERSION, schemaVersion: SCHEMA_VERSION, snapshotVersion: version,
    failure: reason ? failure(reason) : null, lookupIdentity, resolvedLookupIdentity: null,
    sourceKind: 'dated-snapshot', status, observedDate: null, retrievedDate: null,
    catalogueValidity: null, requestedIdentity, resolvedIdentity: null, identityProvenance: null,
    facts: emptyFacts(), unmappedMeasurements: [],
    equipment: { definitions: [], available: { state: 'unknown', codes: null },
      selected: { state: 'unknown', options: null, accessories: null, complete: false },
      verifiedFitted: { state: 'unknown', codes: null } },
    completeness: { measurements: 'unknown', optionDefinitions: 'unknown', availableOptions: 'unknown',
      selectedConfiguration: 'unknown', verifiedFitted: 'unknown' },
  };
}

function definitions(data) {
  const entries = data.definitions && typeof data.definitions === 'object' && !Array.isArray(data.definitions)
    ? Object.entries(data.definitions) : [];
  return entries.filter(([code]) => CODE.test(code))
    .sort(([a], [b]) => a.localeCompare(b)).map(([code, entry]) => {
      const known = attributed(entry) && safeLabel(entry.label);
      return { code, category: ['fabric', 'paint', 'other'].includes(entry?.optionType) ? entry.optionType : 'unknown',
        label: { state: known ? 'known' : 'unknown', value: known ? entry.label.trim() : null,
          completeness: known ? entry.completeness : 'unknown',
          provenance: known ? entryProvenance(entry) : provenance('unknown') } };
    });
}

function safeLabel(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256
    && !/[<>\u0000-\u001f\u007f]/.test(value);
}

function equipmentSection(data, name) {
  const entry = data.equipmentEvidence?.[name];
  return attributed(entry) ? { completeness: entry.completeness, provenance: entryProvenance(entry) } : null;
}

/** Four independent claims for one option; no catalogue claim establishes physical fitting. */
export function describeBmwEquipment(result, code) {
  if (typeof code !== 'string' || !CODE.test(code)) return null;
  const equipment = result?.equipment || {};
  const entry = equipment.definitions?.find((item) => item.code === code);
  const available = equipment.available || {};
  const selected = equipment.selected || {};
  const availabilityKnown = available.state === 'known' && Array.isArray(available.codes);
  const selectionKnown = selected.state === 'known' && Array.isArray(selected.options);
  const selection = selectionKnown && selected.options.includes(code) ? 'selected'
    : selectionKnown && selected.complete ? 'not-selected' : 'unknown';
  const defined = entry?.label.state === 'known' && safeLabel(entry.label.value);
  return {
    code,
    definition: { kind: 'option-definition', state: defined ? 'defined' : 'unknown',
      label: defined ? entry.label.value : null, completeness: defined ? entry.label.completeness : 'unknown',
      provenance: defined ? entry.label.provenance : provenance('unknown') },
    configurableAvailability: { kind: 'configurable-availability',
      state: availabilityKnown && available.codes.includes(code) ? 'available' : 'unknown',
      completeness: availabilityKnown ? available.completeness : 'unknown',
      provenance: available.provenance || provenance('unknown') },
    catalogueSelection: { kind: 'selected-catalogue-equipment', state: selection,
      reason: selection === 'unknown' ? (selectionKnown ? 'incomplete-selection' : 'unavailable-selection') : null,
      completeness: selectionKnown ? selected.completeness : 'unknown',
      provenance: selected.provenance || provenance('unknown') },
    verifiedVinFitted: { kind: 'verified-vin-fitted-equipment', state: 'unknown',
      reason: 'provider-does-not-verify-fitting', provenance: provenance('unknown') },
  };
}

/** Resolve a curated dated catalogue configuration through an injectable in-process port. */
export function createBmwCatalogueAdapter({ loadSnapshot = loadLocalSnapshot, transport = rejectOutbound, sourceRegistrations = [] } = {}) {
  if (!Array.isArray(sourceRegistrations) || sourceRegistrations.length > 10000) throw new TypeError('Invalid source registrations');
  const registered = new Map();
  for (const registration of sourceRegistrations) {
    const lookup = registration?.lookupIdentity;
    const options = lookup && Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion']
      .map((name) => [name, lookup[name]]));
    const valid = lookup && bmwCatalogueV2LookupIdentity({ configurationId: lookup.configurationId, bindingDigest: lookup.bindingDigest }, options);
    const key = valid && JSON.stringify(valid);
    if (!valid || JSON.stringify(lookup) !== key || typeof registration.qualifySnapshot !== 'function' || registered.has(key)) {
      throw new TypeError('Invalid source registration');
    }
    registered.set(key, registration.qualifySnapshot.bind(registration));
  }
  return {
    async resolve(request, options = {}) {
      // Versions are bounded identifiers; a caller can never turn them into a file path.
      const lookup = bmwCatalogueLookupIdentity(request, options);
      if (!lookup) return envelope('invalid-input', null);
      const { snapshotVersion, schemaVersion, providerVersion, provider } = lookup;
      if (Object.hasOwn(lookup, 'sourceContractVersion')) {
        const requested = { snapshotVersion, bindingDigest: lookup.bindingDigest, configurationId: lookup.configurationId };
        const result = { provider, providerVersion, schemaVersion, sourceContractVersion: lookup.sourceContractVersion, snapshotVersion,
          sourceKind: 'dated-snapshot', status: 'unsupported', observedDate: null, retrievedDate: null,
          requestedIdentity: requested, resolvedIdentity: null, lookupIdentity: lookup, resolvedLookupIdentity: null,
          identityProvenance: null, sourceBinding: null, facts: emptyFacts(),
          equipment: { definitions: [], available: { state: 'unknown', codes: [], complete: false, completeness: 'unknown',
            provenance: provenance('unknown') }, selected: { state: 'unknown', options: [], accessories: [],
            factoryComplete: false, accessoryCodesComplete: false, accessoryQuantitiesComplete: false, provenance: provenance('unknown') },
          verifiedFitted: { state: 'unknown', codes: [], reason: 'provider-does-not-verify-fitting', provenance: provenance('unknown') } },
          completeness: { factorySelection: 'unknown', accessoryCodes: 'unknown', accessoryQuantities: 'unknown',
            measurements: 'unknown', definitions: 'unknown', availability: 'unknown', verifiedFitted: 'unknown' },
          failure: failure('unsupported-snapshot') };
        const qualify = registered.get(JSON.stringify(lookup));
        if (!qualify) return result;
        const unavailable = (reason) => ({ ...result, status: 'source-unavailable', failure: failure(reason) });
        let snapshot;
        try { snapshot = await loadSnapshot(snapshotVersion, { transport, lookupIdentity: structuredClone(lookup) }); }
        catch (error) { return unavailable(error instanceof SyntaxError ? 'artifact-malformed'
          : error?.code === 'ENOENT' ? 'artifact-missing' : 'artifact-unreadable'); }
        try {
          const qualified = await qualify(snapshot);
          if (qualified?.status !== 'qualified' || JSON.stringify(qualified.envelope?.lookupIdentity) !== JSON.stringify(lookup)) {
            return unavailable('artifact-malformed');
          }
          return structuredClone(qualified.envelope);
        } catch { return unavailable('artifact-malformed'); }
      }
      const requested = identity(request);
      const unavailable = (reason) => envelope('source-unavailable', snapshotVersion, requested, reason, lookup);
      if (schemaVersion !== SCHEMA_VERSION || providerVersion !== PROVIDER_VERSION || provider !== PROVIDER
        || !SNAPSHOTS.has(snapshotVersion)) {
        return envelope('unsupported', snapshotVersion, requested, 'unsupported-snapshot', lookup);
      }
      if (request.market !== 'GB' || request.locale !== 'en-GB') {
        return envelope('unsupported', snapshotVersion, requested, 'unsupported-market', lookup);
      }
      let data;
      try {
        data = await loadSnapshot(snapshotVersion, { transport });
      } catch (error) {
        return unavailable(error instanceof SyntaxError ? 'artifact-malformed'
          : error?.code === 'ENOENT' ? 'artifact-missing' : 'artifact-unreadable');
      }
      if (data && (data.schemaVersion !== SCHEMA_VERSION || data.snapshotVersion !== snapshotVersion)) {
        return unavailable('artifact-incompatible');
      }
      if (!validSnapshot(data, snapshotVersion)) return unavailable('artifact-malformed');
      const result = envelope('not-found', snapshotVersion, requested, 'snapshot-not-found', lookup);
      result.observedDate = data.observedDate;
      result.retrievedDate = data.retrievedDate;
      if (request.modelCode !== data.model.modelCode) return result;
      const resolved = identity(sourceIdentity(data));
      result.resolvedIdentity = resolved;
      result.resolvedLookupIdentity = bmwCatalogueLookupIdentity(sourceIdentity(data), { snapshotVersion });
      result.identityProvenance = provenance('observed', data.observedDate);
      result.catalogueValidity = Object.fromEntries(DATE_FIELDS.map((key) => [key, resolved[key]]));
      if (JSON.stringify(requested) !== JSON.stringify(resolved)) {
        result.status = 'identity-mismatch';
        result.failure = failure('snapshot-identity-mismatch');
        return result;
      }
      result.failure = null;
      for (const [name, [reference, definition, unit]] of Object.entries(MEASUREMENTS)) {
        result.facts[name] = fact(data.measurements?.[reference], definition, unit);
      }
      result.facts.bodyLength = unknown('BODY LENGTH', 'MILLIMETRES',
        valueProblem(data.modelTree?.length?.value) || 'unmapped-source');
      const mapped = new Set(Object.values(MEASUREMENTS).map(([reference]) => reference));
      result.unmappedMeasurements = Object.keys(data.measurements || {}).filter((reference) => !mapped.has(reference))
        .map(() => ({ state: 'unknown', value: null, reason: 'unmapped-meaning' }));
      result.equipment.definitions = definitions(data);
      const available = equipmentSection(data, 'available');
      if (available && validCodes(data.availableOptions)) {
        result.equipment.available = { state: 'known', codes: [...data.availableOptions].sort(),
          complete: available.completeness === 'complete', ...available };
      }
      const selected = equipmentSection(data, 'selected');
      if (selected) {
        result.equipment.selected = { state: 'known', options: [...resolved.selectedOptions],
          accessories: resolved.selectedAccessories.map((item) => ({ ...item })),
          complete: selected.completeness === 'complete', ...selected };
      }
      const complete = Object.keys(MEASUREMENTS).every((key) => result.facts[key].state === 'known'
        && result.facts[key].completeness === 'complete') && !result.unmappedMeasurements.length;
      const definitionEvidence = equipmentSection(data, 'definitions');
      result.completeness = { measurements: complete ? 'complete' : 'partial',
        optionDefinitions: result.equipment.definitions.length ? definitionEvidence?.completeness || 'unknown' : 'unknown',
        availableOptions: result.equipment.available.completeness || 'unknown',
        selectedConfiguration: selected?.completeness || 'unknown', verifiedFitted: 'unknown' };
      const equipmentUsable = definitionEvidence && result.equipment.definitions.length > 0
        && result.equipment.definitions.every((entry) => entry.label.state === 'known')
        && result.equipment.available.state === 'known' && selected?.completeness === 'complete';
      result.status = complete && equipmentUsable ? 'ok' : 'partial';
      return result;
    },
  };
}

/** Plain text presentation of the public envelope; this does not mount or change a screen. */
export function presentBmwCatalogue(result) {
  if (!['ok', 'partial'].includes(result?.status)) {
    const status = Object.hasOwn(FAILURE_STATUS, result?.status) ? result.status : 'source-unavailable';
    const reason = Object.hasOwn(FAILURES, result?.failure?.code) ? result.failure.code : FAILURE_STATUS[status];
    return { status, source: null, sourceKind: 'dated-snapshot', failure: failure(reason), context: null,
      measurements: [], measurementEvidence: [], equipment: [], completeness: null };
  }
  const date = (value) => validDate(value)
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${value}T00:00:00Z`)) : 'unknown';
  const validity = result.catalogueValidity || {};
  const future = DATE_FIELDS.some((key) => validDate(validity[key]) && validDate(result.observedDate)
    && validity[key] > result.observedDate);
  const labels = {
    seats: ['Seats', (value) => `${value} seats`],
    luggageNormal: ['Luggage (normal)', (value) => `${value} litres (normal,`],
    luggageExpanded: ['Luggage (expanded)', (value) => `${value} litres (expanded,`],
    acceleration: ['Acceleration', (value) => `${value} seconds from 0–100 km/h`],
  };
  const measurements = Object.entries(MEASUREMENTS).map(([key, [, definition, unit]]) => {
    const entry = result.facts?.[key];
    const [label, text] = labels[key];
    if (entry?.state !== 'known' || entry.definition !== definition || entry.unit !== unit
      || !['observed', 'synthetic'].includes(entry.provenance?.kind)
      || typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value < 0) {
      return `${label}: unknown${REASONS[entry?.reason] ? ` (${REASONS[entry.reason]})` : ''}`;
    }
    const value = text(entry.value);
    return value.endsWith(',') ? `${value} ${entry.provenance.kind})` : `${value} (${entry.provenance.kind})`;
  });
  const measurementEvidence = Object.keys(MEASUREMENTS).map((key) => {
    const entry = result.facts?.[key];
    const origin = entry?.provenance;
    const source = SOURCES.has(origin?.source) || origin?.source === 'Illustrative fixture' ? origin.source : 'Source unknown';
    const completeness = COMPLETENESS.has(entry?.completeness) ? entry.completeness : 'unknown';
    return `${labels[key][0]}: ${source}, observed ${date(origin?.observedDate)}, ${completeness}.`;
  });
  const equipment = (result.equipment?.definitions || []).map(({ code }) => {
    const claim = describeBmwEquipment(result, code);
    if (!claim) return null;
    const selection = claim.catalogueSelection.state === 'selected' ? 'selected in this catalogue configuration'
      : claim.catalogueSelection.state === 'not-selected' ? 'not selected in this catalogue configuration'
        : `selection unknown (${REASONS[claim.catalogueSelection.reason]})`;
    return `${code} ${claim.definition.label || 'label unknown'}: configurable: ${claim.configurableAvailability.state}; ${selection}; VIN-fitted: unknown.`;
  }).filter(Boolean);
  const completeness = (key) => ['complete', 'partial', 'unknown'].includes(result.completeness?.[key])
    ? result.completeness[key] : 'unknown';
  return {
    status: result.status, sourceKind: 'dated-snapshot', failure: null,
    source: `BMW UK catalogue, observed ${date(result.observedDate)}`,
    context: `Order: ${date(validity.orderDate)}. Effect: ${date(validity.effectDate)}. Production: ${date(validity.productionDate)}. Tax: ${date(validity.taxDate)}.${future ? ' Future catalogue context relative to observation.' : ''}`,
    measurements, measurementEvidence, equipment,
    completeness: `Selection: ${completeness('selectedConfiguration')}; definitions: ${completeness('optionDefinitions')}; availability: ${completeness('availableOptions')}; measurements: ${completeness('measurements')}. VIN-fitted equipment: unknown.`,
  };
}
