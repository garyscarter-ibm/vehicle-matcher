import { readFile } from 'node:fs/promises';

const VERSION = 'bmw-gb-i5-2026-11-01.v1';
const SNAPSHOTS = new Map([[VERSION, new URL('./snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url)]]);
const IDENTITY_FIELDS = ['market', 'locale', 'modelCode', 'modelRange', 'rawModelRange', 'agModelCode',
  'trim', 'orderDate', 'effectDate', 'productionDate', 'taxDate'];
const DATE_FIELDS = ['orderDate', 'effectDate', 'productionDate', 'taxDate'];
const MEASUREMENTS = {
  seats: ['N_SITZE', 'SEATS', 'COUNT'],
  luggageNormal: ['A_GEPR_V211', 'NORMAL', 'LITRES'],
  luggageExpanded: ['A_GEPR_V214', 'EXPANDED', 'LITRES'],
  acceleration: ['E_0_100KMH', '0–100 KM/H', 'SECONDS'],
};
const CODE = /^[A-Z0-9]{4,12}$/;

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
  return request && typeof request === 'object'
    && IDENTITY_FIELDS.every((key) => typeof request[key] === 'string' && request[key].length <= 32)
    && /^[A-Z]{2}$/.test(request.market) && /^[a-z]{2}-[A-Z]{2}$/.test(request.locale)
    && ['modelCode', 'agModelCode', 'trim'].every((key) => CODE.test(request[key]))
    && ['modelRange', 'rawModelRange'].every((key) => /^[A-Z0-9]{3,12}$/.test(request[key]))
    && DATE_FIELDS.every((key) => validDate(request[key]))
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

function sourceIdentity(data) {
  const model = data.model || {};
  const compactDate = model.prodDate;
  return {
    market: data.market, locale: data.locale, modelCode: model.modelCode,
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
    && data.selectedOptions.length === 47 && data.selectedOptions.includes(data.trim)
    && validCodes(data.availableOptions) && data.definitions && typeof data.definitions === 'object'
    && data.measurements && typeof data.measurements === 'object';
}

function provenance(kind, observedDate) {
  if (kind === 'observed') return { kind, source: 'BMW UK catalogue', observedDate };
  if (kind === 'synthetic') return { kind, source: 'Illustrative fixture', observedDate: null };
  return { kind: 'unknown', source: null, observedDate: null };
}

function unknown(definition, unit) {
  return { state: 'unknown', value: null, definition, unit, provenance: provenance('unknown') };
}

function fact(entry, definition, unit, date) {
  if (!entry || !['observed', 'synthetic'].includes(entry.origin)
    || typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value <= 0) {
    return unknown(definition, unit);
  }
  return { state: 'known', value: entry.value, definition, unit, provenance: provenance(entry.origin, date) };
}

function emptyFacts() {
  return {
    ...Object.fromEntries(Object.entries(MEASUREMENTS).map(([name, [, definition, unit]]) => [name, unknown(definition, unit)])),
    bodyLength: unknown('BODY LENGTH', 'MILLIMETRES'),
  };
}

function envelope(status, version, requestedIdentity = null) {
  return {
    provider: 'bmw-catalogue-snapshot', providerVersion: '1', schemaVersion: '1', snapshotVersion: version,
    sourceKind: 'dated-snapshot', status, observedDate: null, retrievedDate: null,
    catalogueValidity: null, requestedIdentity, resolvedIdentity: null, identityProvenance: null,
    facts: emptyFacts(),
    equipment: { definitions: [], available: { state: 'unknown', codes: null },
      selected: { state: 'unknown', options: null, accessories: null, complete: false },
      verifiedFitted: { state: 'unknown', codes: null } },
    completeness: { measurements: 'unknown', optionDefinitions: 'unknown', availableOptions: 'unknown',
      selectedConfiguration: 'unknown', verifiedFitted: 'unknown' },
  };
}

function definitions(data) {
  return Object.entries(data.definitions).filter(([code]) => CODE.test(code))
    .sort(([a], [b]) => a.localeCompare(b)).map(([code, entry]) => {
      const known = entry && ['observed', 'synthetic'].includes(entry.origin)
        && typeof entry.label === 'string' && entry.label.trim() && !/[<>]/.test(entry.label);
      return { code, category: ['fabric', 'paint', 'other'].includes(entry?.optionType) ? entry.optionType : 'unknown',
        label: { state: known ? 'known' : 'unknown', value: known ? entry.label : null,
          provenance: provenance(known ? entry.origin : 'unknown', data.observedDate) } };
    });
}

/** Resolve a curated dated catalogue configuration through an injectable in-process port. */
export function createBmwCatalogueAdapter({ loadSnapshot = loadLocalSnapshot, transport = rejectOutbound } = {}) {
  return {
    async resolve(request, { snapshotVersion = VERSION } = {}) {
      // A caller-controlled version is an identifier only; never resolve it as a path.
      if (!validRequest(request)) return envelope('invalid-input', null);
      const requested = identity(request);
      if (!SNAPSHOTS.has(snapshotVersion)) return envelope('unsupported', null, requested);
      if (request.market !== 'GB' || request.locale !== 'en-GB') return envelope('unsupported', snapshotVersion, requested);
      let data;
      try {
        data = await loadSnapshot(snapshotVersion, { transport });
        if (!validSnapshot(data, snapshotVersion)) return envelope('source-unavailable', snapshotVersion, requested);
      } catch {
        return envelope('source-unavailable', snapshotVersion, requested);
      }
      const result = envelope('not-found', snapshotVersion, requested);
      result.observedDate = data.observedDate;
      result.retrievedDate = data.retrievedDate;
      if (request.modelCode !== data.model.modelCode) return result;
      const resolved = identity(sourceIdentity(data));
      result.resolvedIdentity = resolved;
      result.identityProvenance = provenance('observed', data.observedDate);
      result.catalogueValidity = Object.fromEntries(DATE_FIELDS.map((key) => [key, resolved[key]]));
      if (JSON.stringify(requested) !== JSON.stringify(resolved)) {
        result.status = 'identity-mismatch';
        return result;
      }
      for (const [name, [reference, definition, unit]] of Object.entries(MEASUREMENTS)) {
        result.facts[name] = fact(data.measurements[reference], definition, unit, data.observedDate);
      }
      result.facts.bodyLength = fact(data.modelTree?.length, 'BODY LENGTH', 'MILLIMETRES', data.observedDate);
      result.equipment.definitions = definitions(data);
      result.equipment.available = { state: 'known', codes: [...data.availableOptions].sort(),
        complete: false, provenance: provenance('observed', data.observedDate) };
      result.equipment.selected = { state: 'known', options: [...resolved.selectedOptions],
        accessories: resolved.selectedAccessories.map((item) => ({ ...item })), complete: true,
        provenance: provenance('observed', data.observedDate) };
      const complete = Object.keys(MEASUREMENTS).every((key) => result.facts[key].state === 'known');
      result.completeness = { measurements: complete ? 'complete' : 'partial', optionDefinitions: 'partial',
        availableOptions: 'partial', selectedConfiguration: 'complete', verifiedFitted: 'unknown' };
      result.status = complete ? 'ok' : 'partial';
      return result;
    },
  };
}

/** Plain text presentation of the public envelope; this does not mount or change a screen. */
export function presentBmwCatalogue(result) {
  if (!['ok', 'partial'].includes(result?.status)) {
    return { status: result?.status || 'source-unavailable', source: null, context: null, measurements: [] };
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
      || typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value <= 0) return `${label}: unknown`;
    const value = text(entry.value);
    return value.endsWith(',') ? `${value} ${entry.provenance.kind})` : `${value} (${entry.provenance.kind})`;
  });
  return {
    status: result.status,
    source: `BMW UK catalogue, observed ${date(result.observedDate)}`,
    context: `Order: ${date(validity.orderDate)}. Effect: ${date(validity.effectDate)}. Production: ${date(validity.productionDate)}. Tax: ${date(validity.taxDate)}.${future ? ' Future catalogue context relative to observation.' : ''}`,
    measurements,
  };
}
