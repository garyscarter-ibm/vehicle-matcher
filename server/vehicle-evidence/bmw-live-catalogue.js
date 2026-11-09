import { bmwCatalogueLookupIdentity, createBmwCatalogueAdapter, BMW_OTD_MEASUREMENT_MAPPING as MEASUREMENTS,
  emptyFacts, presentBmwCatalogue, provenance, safeLabel, unknown, valueProblem } from './bmw-catalogue-adapter.js';

export const BMW_LIVE_CATALOGUE_PROVIDER = 'bmw-catalogue-live';
export const BMW_LIVE_CATALOGUE_SOURCE = 'bmw-ucp-gb-public-configurator.v1';
export const BMW_CATALOGUE_PROVIDER_ENV = 'GCSP_CATALOGUE_PROVIDER';
export const BMW_UCP_KEY_ENV = 'GCSP_BMW_UCP_API_KEY';

const ORIGIN = 'https://prod.ucp.bmw.cloud';
const MAX_BYTES = 4194304;
const LOOKUP_OPTIONS = { provider: BMW_LIVE_CATALOGUE_PROVIDER, providerVersion: '1', snapshotVersion: BMW_LIVE_CATALOGUE_SOURCE };
const LOOKUP_ONLY = ['provider', 'providerVersion', 'schemaVersion', 'snapshotVersion'];
const MODEL_FIELDS = ['modelCode', 'modelRange', 'rawModelRange', 'agModelCode', 'orderDate', 'effectDate', 'taxDate', 'productionDate'];
const CHANGE_KEYS = { addedElements: 'added', removedElements: 'removed', ignoredElements: 'ignored', invalidElements: 'invalid' };
const CODE = /^[A-Z0-9]{4,12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FAILURES = {
  'invalid-request': ['Check the complete vehicle identity, dates and selection.', false],
  'source-not-selected': ['The live catalogue provider is not selected.', false],
  'unsupported-market': ['This market or language is not supported by the live catalogue.', false],
  'transport-unavailable': ['The live catalogue connection is not configured.', false],
  'credentials-unavailable': ['Live catalogue access is not configured.', false],
  'source-failed': ['The live catalogue could not be read. No facts were substituted.', true],
  'live-not-found': ['The live catalogue has no such model for these dates.', false],
  'live-identity-mismatch': ['The live catalogue describes a different configuration or date. No facts were substituted.', false],
  'live-not-constructible': ['The live catalogue says this configuration cannot be built. No facts were substituted.', false],
};
const OFFER_SNAPSHOT = new Set(['source-not-selected', 'transport-unavailable', 'credentials-unavailable', 'source-failed']);
const failure = (code) => ({ code, message: FAILURES[code][0], retryable: FAILURES[code][1] });
const snapshotChoice = () => ({ kind: 'explicit-snapshot-selection', provider: 'bmw-catalogue-snapshot',
  snapshotVersion: 'bmw-gb-i5-2026-11-01.v1', label: 'Use the dated snapshot observed on 1 November 2026', automatic: false });

export function bmwCatalogueProviderSelection(env = {}) {
  const value = env?.[BMW_CATALOGUE_PROVIDER_ENV];
  return value === undefined || value === '' || value === 'snapshot' ? 'snapshot' : value === 'bmw-ucp-live' ? 'live' : 'unrecognised';
}

/** Snapshot stays the default; an unrecognised selection fails closed and never falls back silently. */
export function createBmwCatalogueProvider({ env = process.env, transport, snapshotAdapter = createBmwCatalogueAdapter(), clock } = {}) {
  const selection = bmwCatalogueProviderSelection(env);
  if (selection === 'snapshot') return snapshotAdapter;
  return createBmwLiveCatalogueProvider({ selected: selection === 'live', transport, getCredential: () => env?.[BMW_UCP_KEY_ENV], clock });
}

/** The deliberate, separate snapshot choice; a live failure never calls this. */
export async function selectBmwCatalogueSnapshot(request, { adapter = createBmwCatalogueAdapter() } = {}) {
  const result = await adapter.resolve(request);
  return { ...result, selection: { kind: 'explicit-snapshot', provider: 'bmw-catalogue-snapshot' } };
}

function base(lookup, requestedIdentity) {
  return {
    provider: BMW_LIVE_CATALOGUE_PROVIDER, providerVersion: '1', schemaVersion: '1', snapshotVersion: null,
    sourceVersion: BMW_LIVE_CATALOGUE_SOURCE, sourceKind: 'live', sourceRoute: 'unsupported-demo',
    failure: null, lookupIdentity: lookup, resolvedLookupIdentity: null, status: 'source-unavailable',
    observedDate: null, retrievedDate: null, catalogueValidity: null, requestedIdentity, resolvedIdentity: null,
    identityProvenance: null,
    resolution: { exact: false, constructible: null, differences: [],
      options: { added: [], removed: [], retyped: [], ignored: [], invalid: [], unrecognised: [] } },
    facts: emptyFacts(), unmappedMeasurements: [],
    equipment: { definitions: [], available: { state: 'unknown', codes: null },
      selected: { state: 'unknown', options: null, accessories: null, complete: false },
      verifiedFitted: { state: 'unknown', codes: null } },
    completeness: { measurements: 'unknown', optionDefinitions: 'unknown', availableOptions: 'unknown',
      selectedConfiguration: 'unknown', verifiedFitted: 'unknown' },
    snapshotChoice: null,
  };
}

function finish(out, status, code) {
  out.status = status;
  out.failure = failure(code);
  out.snapshotChoice = OFFER_SNAPSHOT.has(code) ? snapshotChoice() : null;
  return out;
}

const FAILED = Symbol('source-failed');

/** Single attempt, fixed failure: FUCQ-47 owns timeout, retry, cache and the failure taxonomy at this seam. */
async function read(transport, key, path) {
  let response;
  try {
    response = await transport({ method: 'GET', url: `${ORIGIN}${path}`, headers: { 'x-api-key': key, accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', retries: 0, maxResponseBytes: MAX_BYTES });
  } catch { throw FAILED; }
  const body = response?.body;
  if (response?.status !== 200 || response.redirected === true) throw FAILED;
  if (!(typeof body === 'string' ? Buffer.byteLength(body) <= MAX_BYTES : body instanceof Uint8Array && body.length <= MAX_BYTES)) throw FAILED;
  try {
    const parsed = JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* fixed failure below */ }
  throw FAILED;
}

function collectModels(root) {
  const models = new Map();
  const stack = [[root, 0]];
  for (let seen = 0; stack.length && seen < 50000; seen += 1) {
    const [node, depth] = stack.pop();
    if (typeof node.modelCode === 'string' && !models.has(node.modelCode)) models.set(node.modelCode, node);
    if (depth < 16) for (const child of Object.values(node)) if (child && typeof child === 'object') stack.push([child, depth + 1]);
  }
  return models;
}

const text = (value) => (typeof value === 'string' ? value : null);
function modelFields(node) {
  const day = node?.prodDate;
  return { modelCode: text(node?.modelCode), modelRange: text(node?.modelRange), rawModelRange: text(node?.rawModelRange),
    agModelCode: text(node?.agModelCode), orderDate: text(node?.orderDate), effectDate: text(node?.effectDate),
    taxDate: text(node?.taxDate), productionDate: typeof day === 'string' && /^\d{8}$/.test(day)
      ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}` : null };
}

function changeCodes(value) {
  const items = Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : item?.code))
    : value && typeof value === 'object' ? Object.keys(value) : value === undefined ? [] : null;
  return items && items.length <= 512 && items.every((code) => typeof code === 'string' && CODE.test(code)) ? items : null;
}

function parseSolver(body) {
  if (typeof body.constructible !== 'boolean') return null;
  const elements = new Map();
  const configuration = body.configuration;
  if (configuration !== undefined) {
    const entries = configuration && typeof configuration === 'object' ? configuration.elements : null;
    if (typeof configuration?.modelCode !== 'string' || !entries || typeof entries !== 'object'
      || Object.keys(entries).length > 512) return null;
    for (const [code, item] of Object.entries(entries)) {
      if (!CODE.test(code) || item?.code !== code) return null;
      const quantity = Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : null;
      elements.set(code, { type: text(item.type), quantity });
    }
  } else if (body.constructible) return null;
  const changes = { added: [], removed: [], ignored: [], invalid: [], unrecognised: [] };
  const raw = body.configurationChanges ?? {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  for (const [name, value] of Object.entries(raw)) {
    if (CHANGE_KEYS[name]) {
      const codes = changeCodes(value);
      if (!codes) return null;
      changes[CHANGE_KEYS[name]] = codes;
    } else if (value && (typeof value !== 'object' || Object.keys(value).length)) {
      changes.unrecognised.push(/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'unrecognisedChange');
    }
  }
  return { constructible: body.constructible, modelCode: configuration?.modelCode ?? null, elements, changes };
}

const unique = (list) => [...new Set(list)].sort();

function optionLabels(body) {
  const items = Array.isArray(body) ? body.map((item) => [item?.option, item]) : Object.entries(body).map(([key, item]) => [item?.option ?? key, item]);
  return new Map(items.slice(0, 5000).filter(([code, item]) => typeof code === 'string' && CODE.test(code) && item && typeof item === 'object'));
}

function measurements(body, retrievedDate, node) {
  const values = Array.isArray(body.values) ? body.values : body.values && typeof body.values === 'object' ? Object.values(body.values) : null;
  if (!values || values.length > 2000) throw FAILED;
  const facts = emptyFacts();
  const mapped = new Set(Object.values(MEASUREMENTS).map(([reference]) => reference));
  for (const [name, [reference, definition, unit]] of Object.entries(MEASUREMENTS)) {
    const matches = values.filter((item) => item?.referenceName === reference);
    const problem = matches.length > 1 ? 'malformed-value' : valueProblem(matches[0]?.targetValue)
      || (unit === 'COUNT' && !Number.isSafeInteger(matches[0].targetValue) ? 'malformed-value' : null);
    facts[name] = problem ? unknown(definition, unit, problem) : { state: 'known', value: matches[0].targetValue, definition, unit,
      completeness: 'complete', provenance: { kind: 'observed', source: 'BMW UK OTD', observedDate: retrievedDate } };
  }
  facts.bodyLength = unknown('BODY LENGTH', 'MILLIMETRES', valueProblem(node?.technicalData?.length) || 'unmapped-source');
  const unmapped = values.filter((item) => !mapped.has(item?.referenceName))
    .map(() => ({ state: 'unknown', value: null, reason: 'unmapped-meaning' }));
  return { facts, unmapped };
}

/** Live catalogue provider for the C13 envelope. Transport and credential are injected; it never reads the network itself. */
export function createBmwLiveCatalogueProvider({ selected = false, transport, getCredential, clock = () => new Date() } = {}) {
  async function resolve(request) {
    const lookup = bmwCatalogueLookupIdentity(request, LOOKUP_OPTIONS);
    if (!lookup) return finish(base(null, null), 'invalid-input', 'invalid-request');
    const requested = Object.fromEntries(Object.entries(lookup).filter(([name]) => !LOOKUP_ONLY.includes(name)));
    const out = base(lookup, requested);
    if (!selected) return finish(out, 'source-unavailable', 'source-not-selected');
    if (requested.market !== 'GB' || requested.locale !== 'en-GB') return finish(out, 'unsupported', 'unsupported-market');
    if (typeof transport !== 'function') return finish(out, 'source-unavailable', 'transport-unavailable');
    let key;
    try { key = await getCredential(); } catch { key = undefined; }
    if (typeof key !== 'string' || !key || key.length > 4096 || /[\r\n]/.test(key)) return finish(out, 'source-unavailable', 'credentials-unavailable');
    let retrievedDate;
    try { retrievedDate = clock().toISOString().slice(0, 10); } catch { retrievedDate = ''; }
    if (!ISO_DATE.test(retrievedDate)) return finish(out, 'source-unavailable', 'source-failed');
    const { modelCode, modelRange, agModelCode, trim, orderDate, effectDate } = requested;
    const dated = `effect-dates/${effectDate}/order-dates/${orderDate}`;
    const get = (path) => read(transport, key, path);
    try {
      const matrix = collectModels(await get(`/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/${requested.catalogueDate}/order-dates/${orderDate}?gfs-policy=none&cluster=default&model-ranges=${modelRange}&future-models=true&closest-fallback=true`));
      out.observedDate = out.retrievedDate = retrievedDate;
      const node = matrix.get(modelCode);
      if (!node) return finish(out, 'not-found', 'live-not-found');
      const stated = modelFields(node);
      const identity = (fields, options, accessories) => ({ catalogueDate: requested.catalogueDate, market: 'GB', locale: 'en-GB',
        modelCode: fields.modelCode, modelRange: fields.modelRange, rawModelRange: fields.rawModelRange, agModelCode: fields.agModelCode,
        trim, orderDate: fields.orderDate, effectDate: fields.effectDate, productionDate: fields.productionDate,
        taxDate: fields.taxDate, selectedOptions: options, selectedAccessories: accessories });
      const provenanceOf = (basis) => ({ kind: 'observed', source: 'BMW UK catalogue', observedDate: retrievedDate,
        basis: 'live-model-matrix-and-rule-solver', marketBasis: 'request-path', accessoryQuantityBasis: basis });
      const differ = (fields) => MODEL_FIELDS.filter((name) => fields[name] !== requested[name])
        .map((field) => ({ field, requested: requested[field], resolved: fields[field] }));
      const mismatch = (differences, resolved, code, solved) => {
        out.resolvedIdentity = resolved;
        out.resolvedLookupIdentity = resolved.selectedOptions && bmwCatalogueLookupIdentity({ ...resolved, selectionComplete: true }, LOOKUP_OPTIONS);
        out.identityProvenance = provenanceOf(solved?.basis ?? 'not-applicable');
        out.resolution = { exact: false, constructible: solved?.constructible ?? null, differences, options: solved?.options ?? out.resolution.options };
        return finish(out, 'identity-mismatch', code);
      };
      const matrixDifferences = differ(stated);
      if (matrixDifferences.length) return mismatch(matrixDifferences, identity(stated, null, null), 'live-identity-mismatch');

      const requestedCodes = unique([...requested.selectedOptions, ...requested.selectedAccessories.map(({ code }) => code)]);
      const solved = parseSolver(await get(`/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/${dated}/models/${modelCode}?included-elements=${requestedCodes.join(',')}&mandatory-elements=${trim}&add-rules-for-mandatory-element-classes=fabric,paint,rim&application=connext`));
      if (!solved) throw FAILED;
      const wanted = new Map([...requested.selectedOptions.map((code) => [code, 'option']),
        ...requested.selectedAccessories.map(({ code }) => [code, 'accessory'])]);
      const options = { added: unique([...solved.changes.added, ...[...solved.elements.keys()].filter((code) => !wanted.has(code))]),
        removed: unique([...solved.changes.removed, ...[...wanted.keys()].filter((code) => !solved.elements.has(code))]),
        retyped: unique([...solved.elements].filter(([code, { type }]) => !['option', 'accessory'].includes(type)
          || (wanted.has(code) && wanted.get(code) !== type)).map(([code]) => code)),
        ignored: unique(solved.changes.ignored), invalid: unique(solved.changes.invalid), unrecognised: unique(solved.changes.unrecognised) };
      const resolvedOptions = unique([...solved.elements].filter(([, { type }]) => type === 'option').map(([code]) => code));
      let basis = requested.selectedAccessories.length ? 'source' : 'not-applicable';
      const resolvedAccessories = [...solved.elements].filter(([, { type }]) => type === 'accessory').map(([code, { quantity }]) => {
        const asked = requested.selectedAccessories.find((item) => item.code === code)?.quantity;
        if (quantity === null) basis = asked ? (basis === 'assumed' ? basis : 'request') : 'assumed';
        return { code, type: 'accessory', quantity: quantity ?? asked ?? 1 };
      }).sort((a, b) => a.code.localeCompare(b.code));
      const resolvedFields = solved.modelCode === modelCode ? stated : modelFields(matrix.get(solved.modelCode));
      if (solved.modelCode !== null && resolvedFields.modelCode === null) resolvedFields.modelCode = solved.modelCode;
      const resolved = identity(resolvedFields, solved.modelCode === null ? null : resolvedOptions,
        solved.modelCode === null ? null : resolvedAccessories);
      const differences = differ(resolvedFields);
      if (JSON.stringify(resolved.selectedOptions) !== JSON.stringify(requested.selectedOptions)) {
        differences.push({ field: 'selectedOptions', requested: requested.selectedOptions, resolved: resolved.selectedOptions });
      }
      if (JSON.stringify(resolved.selectedAccessories) !== JSON.stringify(requested.selectedAccessories)) {
        differences.push({ field: 'selectedAccessories', requested: requested.selectedAccessories, resolved: resolved.selectedAccessories });
      }
      if (!resolvedOptions.includes(trim)) differences.push({ field: 'trim', requested: trim, resolved: null });
      const exact = solved.constructible && !differences.length && !Object.values(options).some((list) => list.length);
      if (!exact) {
        return mismatch(differences, resolved, solved.constructible ? 'live-identity-mismatch' : 'live-not-constructible',
          { constructible: solved.constructible, options, basis });
      }

      const resolvedCodes = unique([...resolvedOptions, ...resolvedAccessories.map(({ code }) => code)]);
      const labels = optionLabels(await get(`/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/${dated}/applications/connext/models/${modelCode}/options/languages/en?trim=${trim}`));
      const otd = measurements(await get(`/otd/country-groups/eu27+/ag-models/${agModelCode}/validity-dates/${effectDate}/otd-for-configuration?included-options=${resolvedCodes.join(',')}`),
        retrievedDate, node);
      const observed = { kind: 'observed', source: 'BMW UK catalogue', observedDate: retrievedDate };
      const definitions = resolvedOptions.map((code) => {
        const entry = labels.get(code);
        const label = entry?.phrases?.longDescription;
        const known = safeLabel(label);
        return { code, category: ['fabric', 'paint', 'other'].includes(entry?.optionType) ? entry.optionType : 'unknown',
          label: { state: known ? 'known' : 'unknown', value: known ? label.trim() : null, completeness: known ? 'complete' : 'unknown',
            provenance: known ? { ...observed } : provenance('unknown') } };
      });
      Object.assign(out, { resolvedIdentity: resolved, identityProvenance: provenanceOf(basis), facts: otd.facts, unmappedMeasurements: otd.unmapped,
        resolvedLookupIdentity: bmwCatalogueLookupIdentity({ ...resolved, selectionComplete: true }, LOOKUP_OPTIONS),
        catalogueValidity: Object.fromEntries(['orderDate', 'effectDate', 'productionDate', 'taxDate'].map((name) => [name, resolved[name]])),
        resolution: { exact: true, constructible: true, differences: [], options }, status: 'partial', failure: null });
      out.equipment = { definitions,
        available: { state: 'known', codes: [...labels.keys()].sort(), complete: false, completeness: 'partial', provenance: { ...observed } },
        selected: { state: 'known', options: resolvedOptions, accessories: resolvedAccessories, complete: true,
          completeness: 'complete', provenance: { ...observed } },
        verifiedFitted: { state: 'unknown', codes: null } };
      const measured = Object.keys(MEASUREMENTS).every((name) => otd.facts[name].state === 'known') && !otd.unmapped.length;
      out.completeness = { measurements: measured ? 'complete' : 'partial',
        optionDefinitions: definitions.every(({ label }) => label.state === 'known') ? 'complete' : 'partial',
        availableOptions: 'partial', selectedConfiguration: 'complete', verifiedFitted: 'unknown' };
      if (measured && out.completeness.optionDefinitions === 'complete' && definitions.length) out.status = 'ok';
      return out;
    } catch {
      out.resolvedIdentity = out.resolvedLookupIdentity = out.identityProvenance = out.catalogueValidity = null;
      return finish(Object.assign(out, { facts: emptyFacts(), unmappedMeasurements: [] }), 'source-unavailable', 'source-failed');
    }
  }
  return Object.freeze({ provider: BMW_LIVE_CATALOGUE_PROVIDER, resolve });
}


const SHOWN_CODE = /^[A-Z0-9]{3,12}$/;
const FAILURE_STATUSES = new Set(['source-unavailable', 'identity-mismatch', 'not-found', 'unsupported', 'invalid-input']);
const FIELD_LABELS = { modelCode: 'Model', modelRange: 'Range', rawModelRange: 'Raw range', agModelCode: 'AG model', orderDate: 'Order date',
  effectDate: 'Effect date', taxDate: 'Tax date', productionDate: 'Production date', selectedOptions: 'Options',
  selectedAccessories: 'Accessories', trim: 'Trim' };
const LISTS = [['added', 'Options added'], ['removed', 'Options removed'], ['retyped', 'Retyped'], ['ignored', 'Ignored by source'],
  ['invalid', 'Invalid in source']];

const isoDate = (value) => typeof value === 'string' && ISO_DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const longDate = (value) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${value}T00:00:00Z`));
const shownCode = (value) => (typeof value === 'string' && SHOWN_CODE.test(value) ? value : null);
const shownDate = (value) => (isoDate(value) ? value : null);
const count = (list, noun) => `${list.length} ${list.length === 1 ? noun : `${noun}s`}`;
const accessories = (list) => `${list.length} ${list.length === 1 ? 'accessory' : 'accessories'}`;

function shownValue(value, field) {
  if (Array.isArray(value)) return field === 'selectedAccessories' ? accessories(value) : count(value, 'option');
  return shownCode(value) || shownDate(value) || 'unknown';
}

function identitySummary(identity) {
  if (!identity || typeof identity !== 'object') return 'unknown';
  const market = /^[A-Z]{2}$/.test(identity.market) ? identity.market : 'unknown';
  const locale = /^[a-z]{2}-[A-Z]{2}$/.test(identity.locale) ? identity.locale : 'unknown';
  const options = Array.isArray(identity.selectedOptions) ? count(identity.selectedOptions, 'option') : 'options unknown';
  const extras = Array.isArray(identity.selectedAccessories) ? accessories(identity.selectedAccessories) : 'accessories unknown';
  return `${shownCode(identity.modelCode) || 'unknown'} (${shownCode(identity.modelRange) || 'unknown'} / ${shownCode(identity.rawModelRange) || 'unknown'}, `
    + `AG ${shownCode(identity.agModelCode) || 'unknown'}), ${market} ${locale}, trim ${shownCode(identity.trim) || 'unknown'}, `
    + `order ${shownDate(identity.orderDate) || 'unknown'}, effect ${shownDate(identity.effectDate) || 'unknown'}, `
    + `production ${shownDate(identity.productionDate) || 'unknown'}, tax ${shownDate(identity.taxDate) || 'unknown'}, ${options}, ${extras}`;
}

function differenceLines(resolution) {
  const lines = [];
  for (const item of Array.isArray(resolution?.differences) ? resolution.differences : []) {
    if (Object.hasOwn(FIELD_LABELS, item?.field)) {
      lines.push(`${FIELD_LABELS[item.field]}: requested ${shownValue(item.requested, item.field)}, resolved ${shownValue(item.resolved, item.field)}.`);
    }
  }
  for (const [key, label] of LISTS) {
    const codes = (Array.isArray(resolution?.options?.[key]) ? resolution.options[key] : []).map(shownCode).filter(Boolean);
    if (codes.length) lines.push(`${label}: ${codes.join(', ')}.`);
  }
  const unrecognised = resolution?.options?.unrecognised;
  if (Array.isArray(unrecognised) && unrecognised.length) lines.push(`Unrecognised source changes: ${unrecognised.length}.`);
  if (resolution?.constructible === false) lines.push('Not constructible.');
  return lines;
}

function liveFailure(result, malformed) {
  const code = !malformed && Object.hasOwn(FAILURES, result?.failure?.code) ? result.failure.code : 'source-failed';
  const status = !malformed && FAILURE_STATUSES.has(result?.status) ? result.status : 'source-unavailable';
  return { status, label: status === 'identity-mismatch' ? 'Live catalogue mismatch' : 'Live catalogue unavailable', sourceKind: 'live',
    source: null, failure: { code, message: FAILURES[code][0] }, context: null, measurements: [], measurementEvidence: [], equipment: [],
    completeness: null,
    identities: { requested: identitySummary(malformed ? null : result.requestedIdentity),
      resolved: identitySummary(malformed ? null : result.resolvedIdentity) },
    differences: malformed ? [] : differenceLines(result.resolution),
    snapshotChoice: !malformed && result.snapshotChoice?.automatic === false ? snapshotChoice().label : null };
}

/** Plain text presentation of a live or snapshot envelope; labels never cross and nothing is mounted. */
export function presentBmwLiveCatalogue(result) {
  if (result?.provider === 'bmw-catalogue-snapshot' && result.sourceKind === 'dated-snapshot') {
    const shown = presentBmwCatalogue(result);
    const usable = ['ok', 'partial'].includes(shown.status);
    return { ...shown, sourceKind: 'dated-snapshot', label: usable ? 'Dated snapshot' : 'Dated snapshot unavailable',
      selection: result.selection?.kind === 'explicit-snapshot' ? 'Dated snapshot explicitly selected.' : null };
  }
  if (result?.provider !== BMW_LIVE_CATALOGUE_PROVIDER || result.sourceKind !== 'live') return liveFailure(result, true);
  if (!['ok', 'partial'].includes(result.status)) return liveFailure(result, false);
  if (result.resolution?.exact !== true || !isoDate(result.retrievedDate)) return liveFailure({ ...result, status: 'source-unavailable' }, false);
  return { ...presentBmwCatalogue(result), sourceKind: 'live', label: 'Live catalogue (unsupported demo route)',
    source: `BMW UK configurator, live, retrieved ${longDate(result.retrievedDate)}`,
    identities: { requested: identitySummary(result.requestedIdentity), resolved: identitySummary(result.resolvedIdentity) },
    differences: [], snapshotChoice: null };
}
