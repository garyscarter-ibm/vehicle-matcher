import { inputDigest } from '../gcsp/repository/core.js';

export const BMW_CATALOGUE_V2_CONTRACT = 'bmw-public-solver-selection.v1';
const PROVIDER = 'bmw-catalogue-snapshot';
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,95}$/;
const CODE = /^[A-Z0-9]{4,12}$/;
const HASH = /^[a-f0-9]{64}$/;
const REASONS = new Set(['absent-evidence', 'unsupported-physical-evidence', 'quantity-not-exposed']);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, names) => plain(v) && Object.keys(v).length === names.length
  && names.every((name) => Object.hasOwn(v, name));
const equal = (a, b) => inputDigest(a) === inputDigest(b);
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max
  && !/[<>\u0000-\u001f\u007f]/.test(v);
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const instant = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)
  && date(v.slice(0, 10)) && Number.isFinite(Date.parse(v))
  && new Date(v).toISOString() === (v.length === 20 ? v.replace('Z', '.000Z') : v);
const codes = (v, max = 256) => Array.isArray(v) && v.length <= max
  && v.every((item, i) => typeof item === 'string' && CODE.test(item) && (!i || v[i - 1] < item));
const must = (condition) => { if (!condition) throw new TypeError('Invalid v2 envelope'); };

function validConfigurationId(value) {
  if (typeof value !== 'string' || value.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  if (Buffer.from(decoded).toString('base64') !== value) return false;
  const parts = decoded.split(':');
  return parts.length === 2 && CODE.test(parts[0]) && codes(parts[1].split(','))
    && parts[1].length > 0 && !parts[1].split(',').some((code) => code.startsWith('SE'));
}

/** Strict dispatch is selected only by the explicit source-contract option. */
export function bmwCatalogueV2LookupIdentity(request, options) {
  if (!keys(request, ['configurationId', 'bindingDigest'])
    || !keys(options, ['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'])
    || options.provider !== PROVIDER || options.providerVersion !== '2' || options.schemaVersion !== '2'
    || options.sourceContractVersion !== BMW_CATALOGUE_V2_CONTRACT
    || typeof options.snapshotVersion !== 'string' || !VERSION.test(options.snapshotVersion)
    || typeof request.bindingDigest !== 'string' || !HASH.test(request.bindingDigest)
    || !validConfigurationId(request.configurationId)) return null;
  return { provider: PROVIDER, providerVersion: '2', schemaVersion: '2',
    sourceContractVersion: BMW_CATALOGUE_V2_CONTRACT, snapshotVersion: options.snapshotVersion,
    bindingDigest: request.bindingDigest, configurationId: request.configurationId };
}

// Walk JSON before JSON.parse discards repeated member names. Decoding each key also
// catches escaped duplicates; the same walk bounds depth and rejects prototype names.
function parseClosedJson(raw) {
  must(typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') <= 2 * 1024 * 1024);
  let at = 0;
  const whitespace = () => { while (at < raw.length && /[\t\r\n ]/.test(raw[at])) at += 1; };
  const string = () => {
    const start = at++;
    while (at < raw.length) {
      const char = raw[at++];
      if (char === '\\') { at += 1; continue; }
      if (char === '"') return JSON.parse(raw.slice(start, at));
    }
    throw new SyntaxError('Unterminated string');
  };
  const value = (depth) => {
    must(depth <= 32); whitespace();
    if (raw[at] === '{') {
      at += 1; whitespace(); const seen = new Set();
      if (raw[at] === '}') { at += 1; return; }
      while (at < raw.length) {
        must(raw[at] === '"'); const name = string();
        must(!seen.has(name) && !['__proto__', 'constructor', 'prototype'].includes(name)); seen.add(name);
        whitespace(); must(raw[at++] === ':'); value(depth + 1); whitespace();
        const delimiter = raw[at++]; if (delimiter === '}') return;
        must(delimiter === ','); whitespace();
      }
    } else if (raw[at] === '[') {
      at += 1; whitespace(); if (raw[at] === ']') { at += 1; return; }
      while (at < raw.length) {
        value(depth + 1); whitespace(); const delimiter = raw[at++];
        if (delimiter === ']') return; must(delimiter === ',');
      }
    } else if (raw[at] === '"') { string(); return; }
    else {
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(at));
      must(token); at += token[0].length; return;
    }
    throw new SyntaxError('Incomplete JSON');
  };
  value(0); whitespace(); must(at === raw.length);
  return JSON.parse(raw);
}

const safeUrl = (v) => {
  if (!text(v, 8192)) return false;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      && ![...url.searchParams.keys()].some((key) => /authorization|token|api.?key|secret|password/i.test(key));
  } catch { return false; }
};
const pointer = (v) => typeof v === 'string' && v.length <= 1024
  && (v === '' || v.startsWith('/')) && !/~(?:[^01]|$)/.test(v) && !/[\u0000-\u001f\u007f]/.test(v);
const provenance = (v, observedDate, allowUnknown = true) => keys(v, ['kind', 'source', 'observedDate'])
  && ((allowUnknown && v.kind === 'unknown' && v.source === null && v.observedDate === null)
    || (v.kind === 'synthetic' && v.source === 'Illustrative fixture' && v.observedDate === null)
    || (v.kind === 'observed' && ['BMW UK catalogue', 'BMW UK OTD'].includes(v.source) && v.observedDate === observedDate));

function validateBinding(binding, trusted) {
  must(keys(binding, ['requestScope', 'confirmedContext', 'canonicalIdentity', 'selection', 'optionalFacts', 'evidence', 'producerPins']));
  const { requestScope: scope, confirmedContext: context, canonicalIdentity: canonical,
    selection, optionalFacts: optional, evidence, producerPins: pins } = binding;
  must(keys(pins, ['projectorSha256', 'qualifierSha256', 'sessionSha256', 'policyVersion'])
    && [pins.projectorSha256, pins.qualifierSha256, pins.sessionSha256].every((v) => typeof v === 'string' && HASH.test(v))
    && text(pins.policyVersion, 96) && equal(pins, trusted.producerPins)
    && typeof trusted.configurationKey === 'function' && trusted.configurationKey.policyVersion === pins.policyVersion);
  must(Array.isArray(evidence) && evidence.length > 0 && evidence.length <= 16
    && Array.isArray(trusted.evidencePins) && equal(evidence, trusted.evidencePins));
  const records = new Map();
  let previousEvidenceId = '';
  for (const item of evidence) {
    must(keys(item, ['id', 'role', 'sourceId', 'sourceVersion', 'operation', 'request', 'responseSha256',
      'retainedSha256', 'observedAt', 'retrievedAt', 'locators'])
      && text(item.id, 96) && item.id > previousEvidenceId && !records.has(item.id) && ['model-tree', 'solver', 'definitions'].includes(item.role)
      && text(item.sourceId, 96) && text(item.sourceVersion, 96) && text(item.operation, 96)
      && keys(item.request, ['method', 'url']) && item.request.method === 'GET' && safeUrl(item.request.url)
      && typeof item.responseSha256 === 'string' && HASH.test(item.responseSha256)
      && typeof item.retainedSha256 === 'string' && HASH.test(item.retainedSha256)
      && instant(item.observedAt) && (item.retrievedAt === null || instant(item.retrievedAt))
      && (item.retrievedAt === null || item.observedAt <= item.retrievedAt)
      && Array.isArray(item.locators) && item.locators.length > 0 && item.locators.length <= 512);
    const names = new Set();
    for (const locator of item.locators) {
      must(keys(locator, ['name', 'sourcePointer', 'retainedPointer']) && text(locator.name, 96)
        && !names.has(locator.name) && pointer(locator.sourcePointer) && pointer(locator.retainedPointer));
      names.add(locator.name);
    }
    records.set(item.id, item);
    previousEvidenceId = item.id;
  }
  const refs = (values, role, name, nonempty = true) => {
    must(Array.isArray(values) && values.length <= 32 && (!nonempty || values.length > 0));
    const seen = new Set();
    for (const value of values) {
      must(keys(value, ['evidenceId', 'locatorName']));
      const item = records.get(value.evidenceId);
      must(item && (!role || item.role === role) && (!name || value.locatorName === name)
        && item.locators.some((locator) => locator.name === value.locatorName));
      const key = `${value.evidenceId}:${value.locatorName}`; must(!seen.has(key)); seen.add(key);
    }
  };
  const evidenceValue = (value, typed, role, name, required = false, unknownReason = null) => {
    must(keys(value, ['state', 'value', 'reason', 'evidenceRefs']));
    if (value.state === 'known') {
      must(typed(value.value) && value.reason === null); refs(value.evidenceRefs, role, name);
    } else {
      must(!required && value.state === 'unknown' && value.value === null && REASONS.has(value.reason)
        && (!unknownReason || value.reason === unknownReason) && Array.isArray(value.evidenceRefs) && value.evidenceRefs.length === 0);
    }
  };
  must(keys(scope, ['market', 'locale', 'catalogueRangeKey', 'requests'])
    && /^[A-Z]{2}$/.test(scope.market) && /^[a-z]{2}-[A-Z]{2}$/.test(scope.locale)
    && text(scope.catalogueRangeKey, 96) && Array.isArray(scope.requests) && scope.requests.length > 0 && scope.requests.length <= 16
    && equal(scope, trusted.requestScope));
  for (const request of scope.requests) {
    must(keys(request, ['operation', 'method', 'url', 'modelCode', 'orderDate', 'effectDate', 'includedCodes',
      'mandatoryCodes', 'excludedCodes', 'trimInput']) && text(request.operation, 96)
      && request.method === 'GET' && safeUrl(request.url)
      && (request.modelCode === null || (typeof request.modelCode === 'string' && CODE.test(request.modelCode)))
      && [request.orderDate, request.effectDate].every((v) => v === null || date(v))
      && [request.includedCodes, request.mandatoryCodes, request.excludedCodes].every((v) => codes(v))
      && (request.trimInput === null || (typeof request.trimInput === 'string' && CODE.test(request.trimInput))));
    const url = new URL(request.url);
    for (const [name, value] of [['modelCode', request.modelCode], ['orderDate', request.orderDate], ['effectDate', request.effectDate]]) {
      if (url.searchParams.has(name)) must(url.searchParams.getAll(name).length === 1 && url.searchParams.get(name) === value);
    }
  }
  must(keys(context, ['modelCode', 'agModelCode', 'rawModelRange', 'orderDate', 'effectDate', 'taxDate', 'steeringLiteral'])
    && equal(context, trusted.confirmedContext));
  for (const name of ['modelCode', 'agModelCode', 'rawModelRange', 'orderDate', 'effectDate', 'taxDate', 'steeringLiteral']) {
    const typed = ['orderDate', 'effectDate', 'taxDate'].includes(name) ? date
      : name === 'steeringLiteral' ? (v) => text(v, 32) : (v) => typeof v === 'string' && /^[A-Z0-9]{3,12}$/.test(v);
    evidenceValue(context[name], typed, 'model-tree', name, ['modelCode', 'agModelCode', 'orderDate', 'effectDate'].includes(name));
  }
  must(keys(canonical, ['vgModelCode', 'agModelCode', 'factoryOptionCodes'])
    && canonical.vgModelCode === context.modelCode.value && canonical.agModelCode === context.agModelCode.value
    && codes(canonical.factoryOptionCodes) && canonical.factoryOptionCodes.length > 0
    && !canonical.factoryOptionCodes.some((code) => code.startsWith('SE')));
  const solvers = evidence.filter((item) => item.role === 'solver');
  must(solvers.length === 1); const solver = solvers[0];
  must(solver.operation === 'solve' && solver.retrievedAt !== null);
  const requests = scope.requests.filter((item) => item.operation === solver.operation && equal(item.url, solver.request.url));
  must(requests.length === 1); const solve = requests[0];
  must(solve.modelCode === canonical.vgModelCode && solve.orderDate === context.orderDate.value && solve.effectDate === context.effectDate.value);
  const trees = evidence.filter((item) => item.role === 'model-tree');
  must(trees.length > 0 && trees.every((tree) => tree.sourceId === solver.sourceId && tree.sourceVersion === solver.sourceVersion
    && scope.requests.some((request) => request.operation === tree.operation && request.url === tree.request.url && request.modelCode === canonical.vgModelCode)));
  must(keys(selection, ['constructible', 'factoryComplete', 'accessoryCodesComplete', 'elements', 'factoryOptionCodes',
    'accessories', 'evidenceRefs', 'solverChanges']) && selection.constructible === true && selection.factoryComplete === true
    && selection.accessoryCodesComplete === true && codes(selection.factoryOptionCodes) && equal(selection.factoryOptionCodes, canonical.factoryOptionCodes)
    && Array.isArray(selection.elements) && selection.elements.length > 0 && selection.elements.length <= 320
    && Array.isArray(selection.accessories) && selection.accessories.length <= 64);
  refs(selection.evidenceRefs, 'solver');
  for (const name of ['modelCode', 'constructible', 'elements']) must(selection.evidenceRefs.some((ref) => ref.evidenceId === solver.id && ref.locatorName === name));
  for (let i = 0; i < selection.elements.length; i += 1) {
    const element = selection.elements[i];
    must(keys(element, ['code', 'type']) && typeof element.code === 'string' && CODE.test(element.code)
      && ['option', 'accessory'].includes(element.type) && (!i || selection.elements[i - 1].code < element.code)
      && (element.type !== 'option' || !element.code.startsWith('SE')));
  }
  must(equal(selection.elements.filter((v) => v.type === 'option').map((v) => v.code), canonical.factoryOptionCodes));
  must(equal(selection.elements.filter((v) => v.type === 'accessory').map((v) => v.code), selection.accessories.map((v) => v.code)));
  for (const accessory of selection.accessories) {
    must(keys(accessory, ['code', 'type', 'quantity']) && accessory.type === 'accessory');
    evidenceValue(accessory.quantity, (v) => Number.isSafeInteger(v) && v > 0, 'solver', null, false, 'quantity-not-exposed');
    if (accessory.quantity.state === 'known') {
      const index = selection.elements.findIndex((item) => item.code === accessory.code);
      for (const ref of accessory.quantity.evidenceRefs) {
        const locator = records.get(ref.evidenceId).locators.find((item) => item.name === ref.locatorName);
        const syntheticArray = ref.locatorName === 'quantity' && locator.sourcePointer === `/elements/${index}/quantity`
          && locator.retainedPointer === `/elements/${index}/quantity`;
        const sourceMap = ref.locatorName === `quantity-${accessory.code}`
          && locator.sourcePointer === `/configuration/elements/${accessory.code}/quantity`
          && locator.retainedPointer === `/report/configuration/elements/${accessory.code}/quantity`;
        must(syntheticArray || sourceMap);
      }
    }
  }
  const changes = selection.solverChanges;
  must(keys(changes, ['added', 'removed', 'ignored']) && [changes.added, changes.removed, changes.ignored].every((v) => codes(v, 320)));
  const input = [...new Set([...solve.includedCodes, ...solve.mandatoryCodes])].sort();
  const selected = selection.elements.map((v) => v.code);
  must(equal(changes.added, selected.filter((code) => !input.includes(code)))
    && equal([...changes.removed, ...changes.ignored].sort(), input.filter((code) => !selected.includes(code)))
    && !changes.removed.some((code) => changes.ignored.includes(code))
    && !solve.excludedCodes.some((code) => selected.includes(code)));
  must(keys(optional, ['trim', 'catalogueProductionDate', 'modelName', 'fuelTypeCode', 'physicalProductionDate', 'modelYear', 'plant', 'verifiedFitted']));
  for (const name of ['trim', 'catalogueProductionDate', 'modelName', 'fuelTypeCode']) {
    evidenceValue(optional[name], name === 'catalogueProductionDate' ? date : name === 'trim' || name === 'fuelTypeCode'
      ? (v) => typeof v === 'string' && CODE.test(v) : (v) => text(v), null, name, false, 'absent-evidence');
  }
  for (const name of ['physicalProductionDate', 'modelYear', 'plant', 'verifiedFitted']) {
    must(optional[name]?.state === 'unknown');
    evidenceValue(optional[name], () => false, null, null, false, 'unsupported-physical-evidence');
  }
  return { solver, selection, optional };
}

/** Structural validity is separate from source qualification, registration and admission. */
export function validateBmwCatalogueV2Envelope(rawJson, trusted) {
  const invalid = () => ({ status: 'invalid', code: 'invalid-v2-envelope', admission: false, envelope: null, lookupIdentity: null });
  try {
    const value = parseClosedJson(rawJson);
    must(plain(trusted) && keys(value, ['schemaVersion', 'provider', 'providerVersion', 'sourceContractVersion', 'snapshotVersion',
      'sourceKind', 'status', 'observedDate', 'retrievedDate', 'requestedIdentity', 'resolvedIdentity', 'lookupIdentity',
      'resolvedLookupIdentity', 'identityProvenance', 'sourceBinding', 'facts', 'equipment', 'completeness', 'failure'])
      && value.sourceKind === 'dated-snapshot' && ['ok', 'partial'].includes(value.status) && value.failure === null);
    const options = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'].map((key) => [key, value[key]]));
    const { solver, selection, optional } = validateBinding(value.sourceBinding, trusted);
    must(date(value.observedDate) && date(value.retrievedDate) && value.observedDate === solver.observedAt.slice(0, 10)
      && value.retrievedDate === solver.retrievedAt.slice(0, 10) && provenance(value.identityProvenance, value.observedDate, false));
    const key = trusted.configurationKey(value.sourceBinding.canonicalIdentity);
    must(key && key.signaturePolicyVersion === value.sourceBinding.producerPins.policyVersion);
    const lookup = bmwCatalogueV2LookupIdentity({ configurationId: key.configurationId, bindingDigest: inputDigest(value.sourceBinding) }, options);
    must(lookup && equal(value.lookupIdentity, lookup) && equal(value.resolvedLookupIdentity, lookup));
    const identity = { snapshotVersion: lookup.snapshotVersion, bindingDigest: lookup.bindingDigest, configurationId: lookup.configurationId };
    must(equal(value.requestedIdentity, identity) && equal(value.resolvedIdentity, identity));
    const definitions = { seats: ['SEATS', 'COUNT'], luggageNormal: ['NORMAL', 'LITRES'], luggageExpanded: ['EXPANDED', 'LITRES'],
      acceleration: ['0–100 KM/H', 'SECONDS'], bodyLength: ['BODY LENGTH', 'MILLIMETRES'] };
    must(keys(value.facts, Object.keys(definitions)));
    for (const [name, [definition, unit]] of Object.entries(definitions)) {
      const fact = value.facts[name];
      must(keys(fact, ['state', 'value', 'definition', 'unit', 'reason', 'completeness', 'provenance'])
        && fact.definition === definition && fact.unit === unit && provenance(fact.provenance, value.observedDate));
      if (fact.state === 'unknown') must(fact.value === null && fact.completeness === 'unknown'
        && fact.provenance.kind === 'unknown' && fact.reason === 'no-resolved-evidence');
      else must(fact.state === 'known' && typeof fact.value === 'number' && Number.isFinite(fact.value) && fact.value >= 0
        && (unit !== 'COUNT' || Number.isSafeInteger(fact.value)) && ['complete', 'partial'].includes(fact.completeness)
        && fact.reason === null && fact.provenance.kind !== 'unknown'
        && value.sourceBinding.evidence.some((item) => item.locators.some((locator) => locator.name === name)));
    }
    const equipment = value.equipment;
    must(keys(equipment, ['definitions', 'available', 'selected', 'verifiedFitted']) && Array.isArray(equipment.definitions)
      && equipment.definitions.length <= 256);
    let lastCode = '';
    for (const entry of equipment.definitions) {
      must(keys(entry, ['code', 'category', 'label']) && typeof entry.code === 'string' && CODE.test(entry.code) && entry.code > lastCode
        && ['fabric', 'paint', 'other', 'unknown'].includes(entry.category)); lastCode = entry.code;
      const label = entry.label;
      must(keys(label, ['state', 'value', 'completeness', 'provenance']) && provenance(label.provenance, value.observedDate)
        && (label.state === 'unknown' ? label.value === null && label.completeness === 'unknown' && label.provenance.kind === 'unknown'
          : label.state === 'known' && text(label.value) && ['complete', 'partial'].includes(label.completeness) && label.provenance.kind !== 'unknown'));
    }
    const available = equipment.available;
    must(keys(available, ['state', 'codes', 'complete', 'completeness', 'provenance']) && codes(available.codes)
      && provenance(available.provenance, value.observedDate)
      && (available.state === 'unknown' ? available.codes.length === 0 && available.complete === false && available.completeness === 'unknown'
        && available.provenance.kind === 'unknown' : available.state === 'known' && ['complete', 'partial'].includes(available.completeness)
        && available.complete === (available.completeness === 'complete') && available.provenance.kind !== 'unknown'));
    const selected = equipment.selected;
    const quantitiesComplete = selection.accessories.every((item) => item.quantity.state === 'known');
    must(keys(selected, ['state', 'options', 'accessories', 'factoryComplete', 'accessoryCodesComplete', 'accessoryQuantitiesComplete', 'provenance'])
      && selected.state === 'known' && selected.factoryComplete === true && selected.accessoryCodesComplete === true
      && selected.accessoryQuantitiesComplete === quantitiesComplete && equal(selected.options, selection.factoryOptionCodes)
      && equal(selected.accessories, selection.accessories) && provenance(selected.provenance, value.observedDate, false));
    const fitted = equipment.verifiedFitted;
    must(keys(fitted, ['state', 'codes', 'reason', 'provenance']) && fitted.state === 'unknown' && Array.isArray(fitted.codes)
      && fitted.codes.length === 0 && fitted.reason === 'provider-does-not-verify-fitting' && fitted.provenance.kind === 'unknown'
      && provenance(fitted.provenance, value.observedDate));
    const completeness = value.completeness;
    const measurementStates = Object.values(value.facts).map((fact) => fact.completeness);
    const measurements = measurementStates.every((state) => state === 'complete') ? 'complete'
      : measurementStates.every((state) => state === 'unknown') ? 'unknown' : 'partial';
    const definitionState = equipment.definitions.length === 0 ? 'unknown'
      : equipment.definitions.every((entry) => entry.label.completeness === 'complete') ? 'complete' : 'partial';
    must(equal(completeness, { factorySelection: 'complete', accessoryCodes: 'complete', accessoryQuantities: quantitiesComplete ? 'complete' : 'unknown',
      measurements, definitions: definitionState, availability: available.completeness, verifiedFitted: 'unknown' }));
    const complete = quantitiesComplete && Object.values(optional).every((fact) => fact.state === 'known')
      && Object.values(completeness).every((state) => state === 'complete');
    must(value.status === (complete ? 'ok' : 'partial'));
    return { status: 'valid', admission: false, envelope: structuredClone(value), lookupIdentity: structuredClone(lookup) };
  } catch { return invalid(); }
}
