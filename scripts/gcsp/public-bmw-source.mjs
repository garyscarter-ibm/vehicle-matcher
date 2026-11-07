import { createHash } from 'node:crypto';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { CollectionError, normaliseCodes, requireValue } from './configuration-key.mjs';
import { assertCollectionHttpObservation } from './collection-session.mjs';
import { BMW_ENRICHMENT_OBSERVATION_SOURCE_VERSION, bmwEnrichmentObservationRequestUrls,
  validateBmwEnrichmentObservationRegistration } from './bmw-public-registration.mjs';
import { createSettingsShapeRefusal } from './settings-shape-report.mjs';
import { qualifyBmwSourceFields } from './bmw-source-qualification.mjs';
import { BMW_BATCH_SOURCE_VERSION, BMW_MODEL_BATCH_SOURCE_VERSION, isBmwBatchPlan, bmwBatchPlanRequestUrls, BMW_CONTEXT_SOURCE_VERSION, BMW_OPTIONS_SOURCE_VERSION, BMW_MODEL_OPTIONS_SOURCE_VERSION, BMW_INVENTORY_SOURCE_VERSION,
  validateBmwInventoryRequestRegistration, bmwInventoryRequestUrls, validateBmwBatchPlan, validateBmwModelRegistration,
  validateBmwContextRequestRegistration, validateBmwOptionsRequestRegistration, validateBmwModelOptionsRequestRegistration, bmwModelOptionsRequestUrls, bmwBatchRequestRegistration, bmwPublicRequestUrls } from './bmw-public-registration.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => inputDigest(a) === inputDigest(b);
const sourceVersion = 'f58-20261105.v1';
const seed = ['FKSFU', 'P0300', 'S0337', 'S043L'];
const expected = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
const pageUrl = 'https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ';
const treeUrl = 'https://prod.ucp.bmw.cloud/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2026-11-01/order-dates/2026-11-01?gfs-policy=none&cluster=default&model-ranges=G61E&future-models=true&closest-fallback=true';
const solverUrl = 'https://prod.ucp.bmw.cloud/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/models/T5MJ?add-rules-for-mandatory-element-classes=fabric%2Cpaint%2Crim&application=connext&included-elements=FKSFU%2CP0300%2CS0337%2CS043L&mandatory-elements=S0337';
const settingsPattern = /^\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/;
const diagnosticVersion = 'f59-diagnostic-20261106.v1';
const optionsUrl = 'https://prod.ucp.bmw.cloud/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/applications/connext/models/T5MJ/options/languages/en?trim=S0337';
const diagnosticContext = { market: 'GB', locale: 'en-GB', modelCode: 'T5MJ', agModelCode: '72HH', catalogueRangeKey: 'G61E',
  rawModelRange: 'G61', steeringLiteral: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05', trim: 'S0337' };
const calendarDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function validatePublicBmwEnrichmentObservationPlan(input) {
  const p = input; const l = p?.limits;
  requireValue(object(p) && same(Object.keys(p).sort(), ['limits', 'planId', 'qualificationDate', 'registration', 'schemaVersion', 'source'])
    && p.schemaVersion === 'bmw-enrichment-observation-plan.v1' && typeof p.planId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(p.planId) && calendarDate(p.qualificationDate)
    && same(p.source, { id: 'bmw-uk-public', version: BMW_ENRICHMENT_OBSERVATION_SOURCE_VERSION, kind: 'public-bmw-uk' })
    && object(l) && l.maxAttempts === 1 && l.retryDelayMs === 0 && l.concurrency === 1 && l.imageRequests === 0
    && l.sourceAttempts === 4 && l.sourceBytes === 4194304 && l.responseBytes === 1048576
    && l.operationTimeoutMs === 10000 && l.deadlineMs === 90000 && l.checkpointBytes === 4194304
    && l.cacheEntries === 8 && l.cacheRetentionMs === 86400000
    && same(l.requestBudgets, { page: 1, settings: 1, technical: 1, 'image-manifest': 1 }),
  'source-enrichment-plan', 'Use the exact four-GET observation ceiling with no binary/image or retry allowance.');
  validateBmwEnrichmentObservationRegistration(p.registration);
  return structuredClone(p);
}

function enrichmentContext(value, r) {
  const expected = { modelCode: r.model.modelCode, agModelCode: r.model.agModelCode,
    market: r.model.market, locale: r.model.locale, orderDate: r.model.orderDate, effectDate: r.model.effectDate };
  for (const entry of [value, value.context].filter(object)) {
    requireValue(Object.entries(expected).every(([name, known]) => !Object.hasOwn(entry, name) || entry[name] === known),
      'source-context-mismatch', 'A returned identity/date cannot substitute the registered request context.');
  }
  if (Object.hasOwn(value, 'preConfigurationOptions')) requireValue(Array.isArray(value.preConfigurationOptions)
    && value.preConfigurationOptions.every((code) => r.factoryOptionCodes.includes(code)),
  'source-context-mismatch', 'Returned preconfiguration codes must be within the exact accepted selection.');
}

function technicalObservation(value, r) {
  requireValue(object(value) && object(value.values) && Object.keys(value.values).length <= 512,
    'source-technical-shape', 'Inspect a bounded OTD object with a directly keyed values map.');
  enrichmentContext(value, r);
  const scalar = (v) => typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' && /^[0-9:.,+% −-]{1,64}$/.test(v);
  const rows = Object.entries(value.values).map(([code, entry]) => {
    requireValue(/^[A-Z0-9_]{1,96}$/.test(code) && object(entry), 'source-technical-shape', 'Technical value keys and entries changed.');
    const row = { code, pointer: '/values/' + code, fields: Object.keys(entry).filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)).sort() };
    for (const field of ['targetValue', 'textValue', 'minValue', 'maxValue']) if (scalar(entry[field])) row[field] = entry[field];
    if (typeof entry.referenceName === 'string' && /^[A-Z0-9_]{1,96}$/.test(entry.referenceName)) row.referenceName = entry.referenceName;
    for (const field of ['unit', 'unitCode', 'status']) if (scalar(entry[field])
      || typeof entry[field] === 'string' && /^[A-Z][A-Z0-9_ /.-]{0,31}$/.test(entry[field])) row[field] = entry[field];
    return row;
  });
  return { status: 'schema-review-required', admission: false, meaningsQualified: false, unitsQualified: false,
    businessKey: typeof value.businessKey === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.businessKey) ? value.businessKey : null,
    sourceStatus: scalar(value.status) ? value.status : null, values: rows,
    preConfigurationOptions: Array.isArray(value.preConfigurationOptions) ? [...value.preConfigurationOptions] : null };
}

function imageManifestObservation(value, r) {
  requireValue(object(value), 'source-image-manifest-shape', 'Inspect one JSON image manifest without downloading its URLs.');
  enrichmentContext(value, r); const views = []; const dimensions = []; const structure = []; let visited = 0;
  const visit = (entry, pointer, depth = 0) => {
    requireValue(++visited <= 4096 && depth <= 20, 'source-image-manifest-shape', 'The manifest exceeds its bounded inspection shape.');
    if (!object(entry) && !Array.isArray(entry)) return;
    if (object(entry) && Number.isSafeInteger(entry.width) && Number.isSafeInteger(entry.height)) {
      dimensions.push({ pointer, value: { width: entry.width, height: entry.height } });
    }
    if (object(entry) && object(entry.distinctionParameters) && typeof entry.distinctionParameters.POV === 'string'
      && /^[A-Z0-9]{1,32}$/.test(entry.distinctionParameters.POV)) {
      views.push({ pointer, viewpoint: entry.distinctionParameters.POV, imageUrlPresent: typeof entry.viewImage === 'string',
        fidelity: { model: 'unknown', paint: 'unknown', wheels: 'unknown', interior: 'unknown', equipment: 'unknown', exactVehicle: 'unknown' } });
    }
    const keys = Object.keys(entry);
    structure.push({ pointer, type: Array.isArray(entry) ? 'array' : 'object', keys: keys.filter((key) => /^[A-Za-z0-9_-]{1,64}$/.test(key)) });
    for (const [key, child] of Object.entries(entry)) if (child && typeof child === 'object') {
      requireValue(/^[A-Za-z0-9_-]{1,64}$/.test(key), 'source-image-manifest-shape', 'Unrecognised manifest field path.');
      visit(child, pointer + '/' + key, depth + 1);
    }
  };
  visit(value, '');
  requireValue(views.length <= 256 && dimensions.length <= 64 && structure.length <= 1024,
    'source-image-manifest-shape', 'Inspect only the bounded manifest structure and view metadata.');
  return { status: 'schema-review-required', admission: false, assetsDownloaded: 0, urlsRetained: false, views, dimensions, structure };
}

/** Observation descriptors share the existing persisted executor; no technical/image authority is granted here. */
export function publicBmwEnrichmentObservationOperations(input) {
  const plan = validatePublicBmwEnrichmentObservationPlan(input); const r = plan.registration;
  const urls = bmwEnrichmentObservationRequestUrls(r); let technicalHeader; let imageHeader;
  const observe = (metadata) => {
    assertCollectionHttpObservation(metadata);
    requireValue(metadata.sourceVersion === plan.source.version && metadata.observedAt.slice(0, 10) === plan.qualificationDate,
      'source-observation-date', 'Retain the executor-owned observation on the pinned qualification day.');
    return metadata;
  };
  const artifact = (value, metadata, role, project) => {
    const secrets = [...Object.values(technicalHeader || {}), ...Object.values(imageHeader || {})];
    requireValue(secrets.every((secret) => !JSON.stringify(value).includes(secret)),
      'source-sensitive-projection', 'Bootstrap credentials cannot enter retained source observations.');
    const document = { schemaVersion: 'bmw-enrichment-source-observation.v1', observation: observe(metadata),
      requestScope: { role: 'request-input-only', registration: structuredClone(r), operation: role }, report: project(value, r) };
    const bytes = JSON.stringify(document) + '\n';
    return { document, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const descriptor = (capability, url, project, extra = {}) => ({ sourceId: plan.source.id, sourceVersion: plan.source.version,
    kind: 'read-only-http', capability, strictJson: true, requestRegistration: r,
    prepare: async () => ({ method: 'GET', url, headers: {} }), project, ...extra });
  return {
    page: descriptor('bmw-page', urls.page, (html, _request, metadata) => {
      const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)]
        .map((match) => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
      requireValue(paths.length === 1 && settingsPattern.test(paths[0]), 'settings-discovery-shape', 'Require one current settings path.');
      return { settingsPath: paths[0], observation: observe(metadata) };
    }),
    settings: descriptor('bmw-settings', null, (value, _request, metadata) => {
      observe(metadata); const app = value?.APP || value?.app; const backend = app?.backend || app?.BACKEND;
      const normalized = { APP: { backend } };
      technicalHeader = headerFor(normalized, 'settingsOtd', true); imageHeader = headerFor(normalized, 'settingsCosy', true);
      let visited = 0; let cosyHost = false;
      const scan = (entry, depth = 0) => {
        requireValue(++visited <= 4096 && depth <= 20, 'settings-header-shape', 'Bound the exact COSY profile inspection.');
        if (typeof entry === 'string') { try { if (new URL(entry).origin === 'https://prod.cosy.bmw.cloud') cosyHost = true; } catch {} }
        else if (entry && typeof entry === 'object') Object.values(entry).forEach((child) => scan(child, depth + 1));
      };
      scan(backend.settingsCosy); requireValue(cosyHost, 'settings-header-shape', 'The exact COSY profile must name the registered source host.');
      return { technicalProfileQualified: true, imageManifestProfileQualified: true };
    }, { cache: false, prepare: async ({ path }) => {
      requireValue(typeof path === 'string' && settingsPattern.test(path), 'settings-discovery-shape', 'Use the one discovered settings path.');
      return { method: 'GET', url: 'https://configure.bmw.co.uk' + path, headers: {} };
    } }),
    technical: descriptor('bmw-otd', urls.technical, (value, _request, metadata) => artifact(value, metadata, 'technical', technicalObservation),
      { prepare: async () => { requireValue(technicalHeader, 'source-bootstrap-required', 'Require the memory-only OTD profile.');
        return { method: 'GET', url: urls.technical, headers: technicalHeader }; } }),
    'image-manifest': descriptor('bmw-image-manifest', urls['image-manifest'], (value, _request, metadata) => artifact(value, metadata, 'image-manifest', imageManifestObservation),
      { prepare: async () => { requireValue(imageHeader, 'source-bootstrap-required', 'Require the memory-only COSY profile.');
        return { method: 'GET', url: urls['image-manifest'], headers: imageHeader }; } }),
  };
}

export function validatePublicBmwContextPlan(plan) {
  const l = plan?.limits;
  requireValue(object(plan) && Object.keys(plan).every((key) => ['schemaVersion', 'planId', 'qualificationDate', 'source', 'modelRegistration', 'limits'].includes(key))
    && plan.schemaVersion === 'bmw-source-context-plan.v1' && typeof plan.planId === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(plan.planId)
    && calendarDate(plan.qualificationDate) && same(plan.source, { id: 'bmw-uk-public', version: BMW_CONTEXT_SOURCE_VERSION, kind: 'public-bmw-uk' })
    && object(l) && l.maxAttempts === 1 && l.retryDelayMs === 0 && l.concurrency === 1 && l.imageRequests === 0
    && l.sourceAttempts === 3 && bounded(l.sourceBytes, 1, 4194304) && bounded(l.responseBytes, 1, 1048576)
    && bounded(l.operationTimeoutMs, 1, 10000) && bounded(l.deadlineMs, 1, 120000) && bounded(l.checkpointBytes, 1024, 4194304)
    && bounded(l.cacheEntries, 1, 16) && bounded(l.cacheRetentionMs, 1, 86400000)
    && same(l.requestBudgets, { page: 1, settings: 1, discover: 1 }),
  'source-context-plan', 'Allocate only three exact context GETs; options and solver traffic require later source facts and plans.');
  validateBmwContextRequestRegistration({ model: plan.modelRegistration });
  return structuredClone(plan);
}

export function validatePublicBmwContextObservation(input, retained, mode) {
  const plan = validatePublicBmwContextPlan(input); const document = retained?.document;
  const bytes = JSON.stringify(document) + '\n'; const metadata = document?.observation;
  requireValue(object(retained) && same(Object.keys(retained).sort(), ['bytes', 'document', 'sha256'])
    && retained.bytes === Buffer.byteLength(bytes) && retained.sha256 === createHash('sha256').update(bytes).digest('hex')
    && object(document) && same(Object.keys(document).sort(), ['observation', 'report', 'schemaVersion'])
    && document.schemaVersion === 'bmw-source-context-observation.v1' && metadata?.schemaVersion === 'collection-http-observation.v1'
    && metadata.operation === 'discover' && metadata.capability === 'bmw-model-tree' && metadata.sourceId === plan.source.id
    && metadata.sourceVersion === plan.source.version && metadata.transportKind === (mode === 'live' ? 'live' : 'fixture')
    && metadata.observedAt?.slice(0, 10) === plan.qualificationDate,
  'source-context-binding', 'Retain exact context projection bytes, source identity and dated observation provenance.');
  const tree = {}; const r = plan.modelRegistration;
  requireValue(Array.isArray(document.report?.nodes) && document.report.nodes.length === r.aliases.length,
    'source-context-binding', 'Retain every registered full alias.');
  for (let i = 0; i < r.aliases.length; i++) tree[r.aliases[i]] = { modelRanges: { [r.catalogueRangeKey]: { models: { [r.modelCode]: document.report.nodes[i].facts } } } };
  let expectedReport;
  try { expectedReport = strictModelReport(tree, r); } catch { requireValue(false, 'source-context-binding', 'The retained direct model facts changed.'); }
  requireValue(same(expectedReport, document.report), 'source-context-binding', 'The retained alias facts, pointers and missing fields changed.');
  return structuredClone(retained);
}

/** Context inspection uses the common executor; this source version has no construction capability. */
export function publicBmwContextOperations(input) {
  const plan = validatePublicBmwContextPlan(input); const requestRegistration = { model: plan.modelRegistration };
  const urls = bmwPublicRequestUrls(plan.modelRegistration); let treeHeader;
  const observe = (metadata) => {
    assertCollectionHttpObservation(metadata);
    requireValue(metadata.sourceVersion === plan.source.version && metadata.observedAt.slice(0, 10) === plan.qualificationDate,
      'source-observation-date', 'Use the pinned qualification day and exact executor-owned context source.');
    return metadata;
  };
  const descriptor = (capability, url, project, extra = {}) => ({ sourceId: plan.source.id, sourceVersion: plan.source.version,
    kind: 'read-only-http', capability, strictJson: true, requestRegistration, prepare: async () => ({ method: 'GET', url, headers: {} }), project, ...extra });
  return {
    page: descriptor('bmw-page', urls.page, (html, _request, metadata) => {
      const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)]
        .map((match) => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
      requireValue(paths.length === 1 && settingsPattern.test(paths[0]), 'settings-discovery-shape', 'The registered model page must identify one settings path.');
      return { settingsPath: paths[0], observation: observe(metadata) };
    }),
    settings: descriptor('bmw-settings', null, (value, _request, metadata) => {
      observe(metadata); treeHeader = headerFor(value, 'settingsVehicleTree', true); return { treeProfileQualified: true };
    }, { cache: false, prepare: async ({ path }) => {
      requireValue(typeof path === 'string' && settingsPattern.test(path), 'settings-discovery-shape', 'Use the one discovered settings path.');
      return { method: 'GET', url: 'https://configure.bmw.co.uk' + path, headers: {} };
    } }),
    discover: descriptor('bmw-model-tree', urls.discover, (value, _request, metadata) => {
      const report = strictModelReport(value, plan.modelRegistration); const r = plan.modelRegistration;
      const appearances = Object.entries(value).filter(([, group]) => object(group?.modelRanges?.[r.catalogueRangeKey]?.models?.[r.modelCode])).map(([alias]) => alias).sort();
      requireValue(same(appearances, [...r.aliases].sort()), 'source-model-alias-conflict', 'Fresh direct aliases must equal the registered complete alias set.');
      const document = { schemaVersion: 'bmw-source-context-observation.v1', observation: observe(metadata), report };
      const bytes = JSON.stringify(document, (key, entry) => {
        requireValue(Object.values(treeHeader).every((secret) => !key.includes(secret) && (typeof entry !== 'string' || !entry.includes(secret))),
          'source-sensitive-projection', 'No bootstrap header may enter retained context facts.'); return entry;
      }) + '\n';
      return { document, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
    }, { prepare: async () => {
      requireValue(treeHeader, 'source-bootstrap-required', 'The memory-only public tree header is unavailable.');
      return { method: 'GET', url: urls.discover, headers: treeHeader };
    } }),
  };
}

/** Inventory is a separate request-only scope; it never relaxes full model qualification. */
export function validatePublicBmwInventoryPlan(plan) {
  const l = plan?.limits;
  requireValue(object(plan) && same(Object.keys(plan).sort(), ['inventoryRegistration', 'limits', 'planId', 'qualificationDate', 'schemaVersion', 'source'])
    && plan.schemaVersion === 'bmw-source-range-inventory-plan.v1' && typeof plan.planId === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(plan.planId)
    && calendarDate(plan.qualificationDate) && same(plan.source, { id: 'bmw-uk-public', version: BMW_INVENTORY_SOURCE_VERSION, kind: 'public-bmw-uk' })
    && object(l) && l.maxAttempts === 1 && l.retryDelayMs === 0 && l.concurrency === 1 && l.imageRequests === 0
    && l.sourceAttempts === 3 && bounded(l.sourceBytes, 1, 4194304) && bounded(l.responseBytes, 1, 1048576)
    && bounded(l.operationTimeoutMs, 1, 10000) && bounded(l.deadlineMs, 1, 90000) && bounded(l.checkpointBytes, 1024, 4194304)
    && bounded(l.cacheEntries, 1, 16) && bounded(l.cacheRetentionMs, 1, 86400000)
    && same(l.requestBudgets, { page: 1, settings: 1, discover: 1 }),
  'source-inventory-plan', 'Allocate only three exact inventory GETs with explicit request scope and no presumed vehicle facts.');
  validateBmwInventoryRequestRegistration(plan.inventoryRegistration);
  return structuredClone(plan);
}

const inventoryRequiredFields = ['modelCode', 'agModelCode', 'modelRange', 'steering', 'orderDate', 'effectDate'];
const inventoryLabels = ['modelName', 'modelNameRaw', 'derivative'];
const inventoryToken = (value) => typeof value === 'string' && /^[A-Z0-9]{1,16}$/.test(value);
const inventoryCode = (value) => typeof value === 'string' && /^[A-Z0-9]{4,12}$/.test(value);
const inventoryType = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const inventoryPointer = (alias, range) => `/${alias}/modelRanges/${range}`;
function inventoryModelNode(modelKey, record, pointer) {
  const facts = {}; const missingFields = []; const invalidFields = [];
  for (const field of [...inventoryRequiredFields, ...inventoryLabels]) {
    if (!Object.hasOwn(record, field)) { if (inventoryRequiredFields.includes(field)) missingFields.push(field); continue; }
    const value = record[field];
    const valid = ['modelCode', 'agModelCode'].includes(field) ? inventoryCode(value)
      : ['orderDate', 'effectDate'].includes(field) ? calendarDate(value)
        : field === 'steering' ? typeof value === 'string' && /^[A-Z]{2}$/.test(value)
          : field === 'modelRange' ? inventoryToken(value)
            : safeLabel(value) && !/[A-HJ-NPR-Z0-9]{17}/.test(value);
    if (valid) facts[field] = value; else invalidFields.push({ field, type: inventoryType(value) });
  }
  return { pointer, modelKey, facts, fieldPointers: Object.fromEntries(Object.keys(facts).map(field => [field, `${pointer}/${field}`])),
    missingFields, invalidFields, issues: Object.hasOwn(facts, 'modelCode') && facts.modelCode !== modelKey ? ['model-key-mismatch'] : [] };
}
function inventoryAliases(nodes) {
  return [...new Set(nodes.map(node => node.modelKey))].sort().map(modelKey => {
    const rows = nodes.filter(node => node.modelKey === modelKey);
    const signature = node => ({ facts: node.facts, missingFields: node.missingFields, invalidFields: node.invalidFields, issues: node.issues });
    return { modelKey, aliases: rows.map(node => node.pointer.split('/')[1]), pointers: rows.map(node => node.pointer),
      consistent: rows.every(node => same(signature(rows[0]), signature(node))) };
  });
}

function inventoryLimit(condition, code, path, kind, count, limit, type) {
  if (condition) return;
  const error = new CollectionError(code, 'The finite inventory projection limit was exceeded.');
  error.inventoryDiagnostic = { schemaVersion: 'bmw-inventory-limit.v1', path, kind, count, limit, type };
  throw error;
}

/** Direct bounded full records and line pointers only; unknown response fields are never copied. */
export function projectBmwRangeInventory(value, input) {
  const r = validateBmwInventoryRequestRegistration(input);
  requireValue(object(value) && bounded(Object.keys(value).length, 1, 100), 'source-inventory-tree', 'Use a bounded object of source alias groups.');
  const observedAliases = Object.keys(value).filter(alias => object(value[alias]?.modelRanges)
    && Object.hasOwn(value[alias].modelRanges, r.catalogueRangeKey)).sort();
  requireValue(bounded(observedAliases.length, 1, 8) && observedAliases.every(inventoryToken),
    'source-inventory-alias-limit', 'Inspect every direct range alias within the finite inventory limit.');
  const modelNodes = []; const lineRows = [];
  // Traverse only the relationship contract. Unrelated properties and element payloads stay in memory.
  const add = (entry, pointer, retainValue = false) => {
    inventoryLimit(lineRows.length < 768, 'source-inventory-line-limit', pointer, 'rows', lineRows.length + 1, 768, inventoryType(entry));
    const row = { pointer, type: inventoryType(entry) };
    if (retainValue && inventoryToken(entry)) row.value = entry;
    lineRows.push(row);
  };
  const fields = (record, path, names) => {
    if (!object(record)) return;
    for (const key of names) if (Object.hasOwn(record, key)) add(record[key], `${path}/${key}`, true);
  };
  const lines = (container, path) => {
    requireValue(object(container), 'source-inventory-line-shape', 'A present lines field must be a bounded object.');
    inventoryLimit(Object.keys(container).length <= 128, 'source-inventory-line-limit', path, 'entries', Object.keys(container).length, 128, 'object');
    for (const key of Object.keys(container).sort()) {
      requireValue(inventoryToken(key), 'source-inventory-line-key', 'Only a literal bounded trim key can form a retained pointer.');
      const line = container[key]; const pointer = `${path}/${key}`;
      add(line, pointer); fields(line, pointer, ['option', 'modelCode', 'agModelCode']);
      if (!object(line)) continue;
      if (Object.hasOwn(line, 'defaultModel')) {
        add(line.defaultModel, `${pointer}/defaultModel`);
        fields(line.defaultModel, `${pointer}/defaultModel`, ['modelCode', 'agModelCode']);
      }
      if (!Object.hasOwn(line, 'includedTransmissionVariants')) continue;
      const variants = line.includedTransmissionVariants; const variantsPath = `${pointer}/includedTransmissionVariants`;
      add(variants, variantsPath);
      if (!object(variants) && !Array.isArray(variants)) continue;
      inventoryLimit(Object.keys(variants).length <= 128, 'source-inventory-line-limit', variantsPath, 'entries', Object.keys(variants).length, 128, inventoryType(variants));
      for (const index of Object.keys(variants).sort()) {
        requireValue(/^[A-Za-z0-9_.+-]{1,16}$/.test(index), 'source-inventory-line-key', 'Only a bounded variant key can form a retained pointer.');
        const variant = variants[index]; const variantPath = `${variantsPath}/${index}`;
        add(variant, variantPath); fields(variant, variantPath, ['modelCode', 'agModelCode']);
        if (!object(variant) || !Object.hasOwn(variant, 'configuration')) continue;
        const configuration = variant.configuration; const configurationPath = `${variantPath}/configuration`;
        add(configuration, configurationPath); fields(configuration, configurationPath, ['modelCode', 'agModelCode']);
        if (!object(configuration) || !Object.hasOwn(configuration, 'elements')) continue;
        const elements = configuration.elements; const elementsPath = `${configurationPath}/elements`;
        add(elements, elementsPath);
        if (object(elements) && Object.hasOwn(elements, key)) add(elements[key], `${elementsPath}/${key}`);
      }
    }
  };
  for (const alias of observedAliases) {
    const range = value[alias].modelRanges[r.catalogueRangeKey]; const models = range?.models;
    requireValue(object(range) && object(models) && bounded(Object.keys(models).length, 1, 128),
      'source-inventory-model-limit', 'Full direct model records are required; compact defaults cannot replace them.');
    const prefix = inventoryPointer(alias, r.catalogueRangeKey);
    for (const modelKey of Object.keys(models).sort()) {
      requireValue(inventoryCode(modelKey) && object(models[modelKey]) && modelNodes.length < 512,
        'source-inventory-model-limit', 'Stop rather than dropping malformed or excess full models.');
      modelNodes.push(inventoryModelNode(modelKey, models[modelKey], `${prefix}/models/${modelKey}`));
    }
    if (!Object.hasOwn(range, 'lines')) lineRows.push({ pointer: `${prefix}/lines`, type: 'missing' });
    else lines(range.lines, `${prefix}/lines`);
  }
  const report = { schemaVersion: 'bmw-source-range-inventory-report.v1', requestScope: { role: 'request-input-only', ...r },
    observedAliases, modelNodes, modelAliases: inventoryAliases(modelNodes), seedPresent: modelNodes.some(node => node.modelKey === r.pageModelCode),
    lineRows, additionalConfigurations: 0 };
  const outputBytes = Buffer.byteLength(JSON.stringify(report));
  inventoryLimit(outputBytes <= 112 * 1024, 'source-inventory-output-limit', '/', 'bytes', outputBytes, 112 * 1024, 'object');
  return report;
}

export function validatePublicBmwInventoryObservation(input, retained, mode) {
  const plan = validatePublicBmwInventoryPlan(input); const r = plan.inventoryRegistration;
  const document = retained?.document; const report = document?.report; const metadata = document?.observation;
  const bytes = JSON.stringify(document) + '\n'; const urls = bmwInventoryRequestUrls(r);
  requireValue(object(retained) && same(Object.keys(retained).sort(), ['bytes', 'document', 'sha256'])
    && retained.bytes === Buffer.byteLength(bytes) && retained.bytes <= 128 * 1024 && retained.sha256 === createHash('sha256').update(bytes).digest('hex')
    && object(document) && same(Object.keys(document).sort(), ['observation', 'report', 'schemaVersion'])
    && document.schemaVersion === 'bmw-source-range-inventory-observation.v1'
    && metadata?.schemaVersion === 'collection-http-observation.v1' && metadata.operation === 'discover' && metadata.capability === 'bmw-model-tree'
    && metadata.sourceId === plan.source.id && metadata.sourceVersion === plan.source.version
    && metadata.transportKind === (mode === 'live' ? 'live' : 'fixture') && metadata.observedAt?.slice(0, 10) === plan.qualificationDate
    && same(metadata.request, { method: 'GET', url: urls.discover }) && bounded(metadata.responseBytes, 1, plan.limits.responseBytes)
    && typeof metadata.responseSha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.responseSha256)
    && report?.schemaVersion === 'bmw-source-range-inventory-report.v1' && same(report.requestScope, { role: 'request-input-only', ...r })
    && Array.isArray(report.modelNodes) && bounded(report.modelNodes.length, 1, 512)
    && Array.isArray(report.observedAliases) && bounded(report.observedAliases.length, 1, 8)
    && report.observedAliases.every(inventoryToken) && same([...new Set(report.observedAliases)].sort(), report.observedAliases)
    && Array.isArray(report.lineRows) && report.lineRows.length <= 768 && report.additionalConfigurations === 0,
  'source-inventory-binding', 'Retain sealed bounded inventory bytes, exact request provenance and observation-only scope.');
  const placeholders = { string: '!', number: 0, boolean: false, object: {}, array: [], null: null };
  for (const node of report.modelNodes) {
    const alias = node?.pointer?.split('/')[1]; const record = { ...node?.facts };
    requireValue(inventoryCode(node?.modelKey) && report.observedAliases.includes(alias) && Array.isArray(node.invalidFields),
      'source-inventory-binding', 'Preserve every bounded direct model pointer and field status.');
    for (const invalid of node.invalidFields) {
      requireValue(Object.hasOwn(placeholders, invalid.type), 'source-inventory-binding', 'Preserve safe invalid-field types only.');
      record[invalid.field] = placeholders[invalid.type];
    }
    requireValue(node.pointer === `${inventoryPointer(alias, r.catalogueRangeKey)}/models/${node.modelKey}`
      && same(inventoryModelNode(node.modelKey, record, node.pointer), node), 'source-inventory-binding', 'Retained direct model facts or field status changed.');
  }
  requireValue(new Set(report.modelNodes.map(node => node.pointer)).size === report.modelNodes.length
    && same([...new Set(report.modelNodes.map(node => node.pointer.split('/')[1]))].sort(), report.observedAliases)
    && same(report.modelAliases, inventoryAliases(report.modelNodes))
    && report.seedPresent === report.modelNodes.some(node => node.modelKey === r.pageModelCode)
    && new Set(report.lineRows.map(row => row.pointer)).size === report.lineRows.length
    && report.lineRows.every(row => object(row) && Object.keys(row).every(key => ['pointer', 'type', 'value'].includes(key))
      && typeof row.pointer === 'string' && row.pointer.length <= 1024 && report.observedAliases.some(alias => row.pointer.startsWith(`${inventoryPointer(alias, r.catalogueRangeKey)}/lines`))
      && ['object', 'array', 'string', 'number', 'boolean', 'null', 'missing'].includes(row.type)
      && report.observedAliases.some(alias => {
        const prefix = `${inventoryPointer(alias, r.catalogueRangeKey)}/lines`;
        if (row.pointer === prefix) return row.type === 'missing';
        if (!row.pointer.startsWith(prefix + '/')) return false;
        const parts = row.pointer.slice(prefix.length + 1).split('/'); const trim = parts.shift();
        if (!inventoryToken(trim)) return false;
        const tail = parts.join('/');
        const field = '(?:modelCode|agModelCode)'; const variant = '[A-Za-z0-9_.+\\-]{1,16}';
        return tail === '' || tail === 'option' || new RegExp(`^${field}$|^defaultModel(?:/${field})?$|^includedTransmissionVariants(?:/${variant}(?:/${field}|/configuration(?:/${field}|/elements(?:/${trim})?)?)?)?$`).test(tail);
      }) && (row.value === undefined || (inventoryToken(row.value) && /\/(?:option|modelCode|agModelCode)$/.test(row.pointer)))),
  'source-inventory-binding', 'Preserve the complete observed aliases, conflicts and bounded direct line pointers.');
  return structuredClone(retained);
}

/** Exactly page/settings/tree using the common executor; only the closure holds bootstrap values. */
export function publicBmwInventoryOperations(input) {
  const plan = validatePublicBmwInventoryPlan(input); const requestRegistration = plan.inventoryRegistration;
  const urls = bmwInventoryRequestUrls(requestRegistration); let treeHeader;
  const descriptor = (capability, url, project, extra = {}) => ({ sourceId: plan.source.id, sourceVersion: plan.source.version,
    kind: 'read-only-http', capability, strictJson: true, requestRegistration, prepare: async () => ({ method: 'GET', url, headers: {} }),
    project: (value, request, metadata) => {
      assertCollectionHttpObservation(metadata);
      requireValue(metadata.sourceVersion === plan.source.version && metadata.observedAt.slice(0, 10) === plan.qualificationDate,
        'source-observation-date', 'Use the pinned actual observation day and executor-owned inventory source.');
      let result;
      try { result = project(value, request, metadata); }
      catch (error) {
        if (error.inventoryDiagnostic && treeHeader && Object.values(treeHeader).some(secret => error.inventoryDiagnostic.path.includes(secret)))
          error.inventoryDiagnostic.path = '/';
        throw error;
      }
      JSON.stringify(result, (key, entry) => {
        requireValue(!treeHeader || Object.values(treeHeader).every(secret => !key.includes(secret) && (typeof entry !== 'string' || !entry.includes(secret))),
          'source-sensitive-projection', 'No bootstrap value may enter retained inventory facts.'); return entry;
      });
      return result;
    }, ...extra });
  return {
    page: descriptor('bmw-page', urls.page, (html) => {
      const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)]
        .map(match => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
      requireValue(paths.length === 1 && settingsPattern.test(paths[0]), 'settings-discovery-shape', 'The literal seed page must identify one settings path.');
      return { settingsPath: paths[0] };
    }),
    settings: descriptor('bmw-settings', null, value => { treeHeader = headerFor(value, 'settingsVehicleTree', true); return { treeProfileQualified: true }; },
      { cache: false, prepare: async ({ path }) => {
        requireValue(typeof path === 'string' && settingsPattern.test(path), 'settings-discovery-shape', 'Use the single freshly discovered settings path.');
        return { method: 'GET', url: 'https://configure.bmw.co.uk' + path, headers: {} };
      } }),
    discover: descriptor('bmw-model-tree', urls.discover, (value, _request, metadata) => {
      const retained = sealedObservation({ schemaVersion: 'bmw-source-range-inventory-observation.v1', observation: metadata,
        report: projectBmwRangeInventory(value, requestRegistration) });
      validatePublicBmwInventoryObservation(plan, retained, metadata.transportKind === 'live' ? 'live' : 'source-fixture'); return retained;
    }, { prepare: async () => {
      requireValue(treeHeader, 'source-bootstrap-required', 'The fresh memory-only tree header is unavailable.');
      return { method: 'GET', url: urls.discover, headers: treeHeader };
    } }),
  };
}

export function validatePublicBmwOptionsPlan(plan) {
  const l = plan?.limits; const modelOptions = plan?.source?.version === BMW_MODEL_OPTIONS_SOURCE_VERSION;
  requireValue(object(plan) && Object.keys(plan).every((key) => ['schemaVersion', 'planId', 'qualificationDate', 'source', 'modelRegistration', 'limits', ...(modelOptions ? ['lineRegistration'] : [])].includes(key))
    && plan.schemaVersion === (modelOptions ? 'bmw-source-model-options-plan.v1' : 'bmw-source-options-plan.v1') && typeof plan.planId === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(plan.planId)
    && calendarDate(plan.qualificationDate) && same(plan.source, { id: 'bmw-uk-public', version: modelOptions ? BMW_MODEL_OPTIONS_SOURCE_VERSION : BMW_OPTIONS_SOURCE_VERSION, kind: 'public-bmw-uk' })
    && object(l) && l.maxAttempts === 1 && l.retryDelayMs === 0 && l.concurrency === 1 && l.imageRequests === 0
    && l.sourceAttempts === 4 && bounded(l.sourceBytes, 1, 4194304) && bounded(l.responseBytes, 1, 1048576)
    && bounded(l.operationTimeoutMs, 1, 10000) && bounded(l.deadlineMs, 1, 90000) && bounded(l.checkpointBytes, 1024, 4194304)
    && bounded(l.cacheEntries, 1, 16) && bounded(l.cacheRetentionMs, 1, 86400000)
    && same(l.requestBudgets, { page: 1, settings: 1, discover: 1, options: 1 }),
  'source-options-plan', 'Allocate four exact options-inspection GETs with an explicit trim and no candidate or solver budget.');
  if (modelOptions) validateBmwModelOptionsRequestRegistration({ model: plan.modelRegistration, line: plan.lineRegistration });
  else validateBmwOptionsRequestRegistration({ model: plan.modelRegistration });
  return structuredClone(plan);
}

function strictTrimRelationships(value, r) {
  return r.aliases.map((alias) => {
    const pointer = `/${alias}/modelRanges/${r.catalogueRangeKey}/lines/${r.optionsTrim}`;
    const line = value?.[alias]?.modelRanges?.[r.catalogueRangeKey]?.lines?.[r.optionsTrim];
    requireValue(object(line) && line.option === r.optionsTrim && object(line.defaultModel)
      && line.defaultModel.modelCode === r.modelCode && line.defaultModel.agModelCode === r.agModelCode
      && Array.isArray(line.includedTransmissionVariants) && bounded(line.includedTransmissionVariants.length, 1, 256),
    'source-trim-relationship', 'The fresh line option and compact default model/AG must agree with the full registered model.');
    const matches = line.includedTransmissionVariants.map((row, index) => ({ configuration: row?.configuration, index }))
      .filter(({ configuration }) => configuration?.modelCode === r.modelCode);
    requireValue(matches.length === 1 && object(matches[0].configuration.elements)
      && Object.keys(matches[0].configuration.elements).length <= 320 && Object.hasOwn(matches[0].configuration.elements, r.optionsTrim),
    'source-trim-relationship', 'One fresh included variant must name the registered model and contain the explicit line option.');
    const includedPointer = `${pointer}/includedTransmissionVariants/${matches[0].index}/configuration`;
    return { pointer, option: { pointer: `${pointer}/option`, value: line.option },
      defaultModel: { pointer: `${pointer}/defaultModel`, modelCode: line.defaultModel.modelCode, agModelCode: line.defaultModel.agModelCode },
      included: { pointer: includedPointer, modelCode: matches[0].configuration.modelCode,
        elementPointer: `${includedPointer}/elements/${r.optionsTrim}`, elementCode: r.optionsTrim } };
  });
}

export function modelOptionsRelationships(value, r, binding) {
  return r.aliases.map(alias => {
    const pointer = `/${alias}/modelRanges/${r.catalogueRangeKey}/lines/${binding.lineKey}`;
    const line = value?.[alias]?.modelRanges?.[r.catalogueRangeKey]?.lines?.[binding.lineKey];
    const query = binding.optionsQuery; const trimmed = query.kind === 'trim';
    requireValue(object(line) && object(line.defaultModel)
      && line.defaultModel.modelCode === binding.defaultModel.modelCode && line.defaultModel.agModelCode === binding.defaultModel.agModelCode
      && (trimmed ? line.option === query.code : !Object.hasOwn(line, 'option'))
      && Array.isArray(line.includedTransmissionVariants) && bounded(line.includedTransmissionVariants.length, 1, 256),
    'source-line-relationship', 'The fresh exact line, observed compact default and explicit query must match their registration.');
    const matches = line.includedTransmissionVariants.map((row, index) => ({ configuration: row?.configuration, index }))
      .filter(({ configuration }) => configuration?.modelCode === r.modelCode);
    requireValue(matches.length === 1 && matches[0].index === binding.includedIndex && object(matches[0].configuration.elements)
      && Object.keys(matches[0].configuration.elements).length <= 320 && (!trimmed || Object.hasOwn(matches[0].configuration.elements, query.code)),
    'source-line-relationship', 'One exact included variant must name the full requested model and any explicit line option.');
    const includedPointer = `${pointer}/includedTransmissionVariants/${binding.includedIndex}/configuration`;
    return { pointer, optionsQuery: structuredClone(query), option: trimmed ? { pointer: `${pointer}/option`, value: line.option } : { present: false },
      defaultModel: { pointer: `${pointer}/defaultModel`, modelCode: line.defaultModel.modelCode, agModelCode: line.defaultModel.agModelCode },
      included: { pointer: includedPointer, modelCode: matches[0].configuration.modelCode,
        ...(trimmed ? { elementPointer: `${includedPointer}/elements/${query.code}`, elementCode: query.code } : {}) } };
  });
}

/** Version-specific complete tree report retains source line semantics beside full model facts. */
export function bmwModelLineReport(value, r, binding) {
  const report = strictModelReport(value, r);
  const appearances = Object.entries(value).filter(([, group]) => object(group?.modelRanges?.[r.catalogueRangeKey]?.models?.[r.modelCode])).map(([alias]) => alias).sort();
  requireValue(same(appearances, [...r.aliases].sort()), 'source-model-alias-conflict', 'Fresh direct aliases must equal the complete registered alias set.');
  return { ...report, lineRelationships: modelOptionsRelationships(value, r, binding) };
}

export function validateBmwModelLineReport(report, r, binding) {
  requireValue(Array.isArray(report?.nodes) && report.nodes.length === r.aliases.length
    && Array.isArray(report.lineRelationships) && report.lineRelationships.length === r.aliases.length,
    'source-line-relationship', 'Retain every registered full-model and line relationship.');
  const tree = Object.fromEntries(r.aliases.map((alias, i) => {
    const row = report.lineRelationships[i]; const query = binding.optionsQuery;
    const variants = Array.from({ length: binding.includedIndex + 1 }, () => ({}));
    variants[binding.includedIndex] = { configuration: { modelCode: row.included.modelCode,
      elements: query.kind === 'trim' ? { [row.included.elementCode]: {} } : {} } };
    return [alias, { modelRanges: { [r.catalogueRangeKey]: { models: { [r.modelCode]: report.nodes[i].facts },
      lines: { [binding.lineKey]: { ...(Object.hasOwn(row.option, 'value') ? { option: row.option.value } : {}),
        defaultModel: { modelCode: row.defaultModel.modelCode, agModelCode: row.defaultModel.agModelCode }, includedTransmissionVariants: variants } } } } }];
  }));
  requireValue(same(bmwModelLineReport(tree, r, binding), report), 'source-line-relationship', 'Retained full model, exact line/default/included or query semantics changed.');
  return report;
}

export function bmwModelLineLocators(report) {
  return report.lineRelationships.flatMap((row, i) => [
    { name: `line-${i}`, sourcePointer: row.pointer, retainedPointer: `/report/lineRelationships/${i}` },
    { name: `line-default-${i}`, sourcePointer: row.defaultModel.pointer, retainedPointer: `/report/lineRelationships/${i}/defaultModel` },
    { name: `line-included-${i}`, sourcePointer: row.included.pointer, retainedPointer: `/report/lineRelationships/${i}/included` },
  ]);
}

function optionsRequestRegistration(plan) {
  return { model: plan.modelRegistration, ...(plan.lineRegistration ? { line: plan.lineRegistration } : {}) };
}
function optionsRequestUrls(plan) {
  return plan.lineRegistration ? bmwModelOptionsRequestUrls(optionsRequestRegistration(plan)) : bmwPublicRequestUrls(plan.modelRegistration);
}

function sealedObservation(document) {
  const bytes = JSON.stringify(document) + '\n';
  return { document, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
}

function typedOptionsReport(value, trim) {
  const report = optionsShapeReport(value); const definitions = report.candidates[0]?.definitions;
  requireValue(report.status === 'schema-review-required' && report.candidates.length === 1 && report.candidates[0].pointer === ''
    && definitions.every((row) => row.issues.length === 0) && (trim === undefined || definitions.some((row) => row.code === trim && row.option === trim)),
  'source-options-shape', 'Observe one directly keyed typed definition map containing the explicit source line option.');
  return { status: 'typed-definitions-observed', candidates: [{ pointer: '', definitions }], admission: false };
}

/** Revalidate safe retained values as well as their byte hashes; an outer checkpoint hash alone is insufficient. */
export function validatePublicBmwOptionsObservations(input, retained, mode) {
  const plan = validatePublicBmwOptionsPlan(input); const r = plan.modelRegistration; const urls = optionsRequestUrls(plan);
  const checkArtifact = (artifact, operation, capability, schemaVersion, fields, code) => {
    const document = artifact?.document; const metadata = document?.observation;
    requireValue(object(artifact) && same(Object.keys(artifact).sort(), ['bytes', 'document', 'sha256'])
      && same(sealedObservation(document), artifact) && object(document) && same(Object.keys(document).sort(), fields.sort())
      && document.schemaVersion === schemaVersion && object(metadata)
      && same(Object.keys(metadata).sort(), ['capability', 'observedAt', 'operation', 'request', 'responseBytes', 'responseSha256', 'schemaVersion', 'sourceId', 'sourceVersion', 'transportKind'])
      && metadata.schemaVersion === 'collection-http-observation.v1' && metadata.operation === operation && metadata.capability === capability
      && metadata.sourceId === plan.source.id && metadata.sourceVersion === plan.source.version
      && metadata.transportKind === (mode === 'live' ? 'live' : 'fixture') && metadata.observedAt?.slice(0, 10) === plan.qualificationDate
      && same(metadata.request, { method: 'GET', url: urls[operation] }) && bounded(metadata.responseBytes, 1, plan.limits.responseBytes)
      && typeof metadata.responseSha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.responseSha256),
    code, 'Retain exact safe projection bytes and matching dated executor source/request provenance.');
    return document;
  };
  requireValue(object(retained) && Array.isArray(retained.trimRelationships), 'source-trim-binding', 'Retain the source line relationship beside its full context.');
  if (retained.contextObservation === null) {
    requireValue(retained.trimRelationships.length === 0 && retained.optionsObservation === null,
      'source-trim-binding', 'Options and trim relationships require their fresh full context.');
    return;
  }
  const context = checkArtifact(retained.contextObservation, 'discover', 'bmw-model-tree', 'bmw-source-options-context-observation.v1',
    ['schemaVersion', 'observation', 'report', 'trimRelationships'], 'source-context-binding');
  const tree = {};
  requireValue(Array.isArray(context.report?.nodes) && context.report.nodes.length === r.aliases.length,
    'source-context-binding', 'Retain every complete registered full-model alias.');
  for (let i = 0; i < r.aliases.length; i++) tree[r.aliases[i]] = { modelRanges: { [r.catalogueRangeKey]: { models: { [r.modelCode]: context.report.nodes[i].facts }, lines: {} } } };
  let expectedReport;
  try { expectedReport = strictModelReport(tree, r); } catch { requireValue(false, 'source-context-binding', 'The retained direct model facts changed.'); }
  requireValue(same(expectedReport, context.report), 'source-context-binding', 'The retained direct full-model aliases, facts or pointers changed.');
  requireValue(same(retained.trimRelationships, context.trimRelationships) && context.trimRelationships.length === r.aliases.length,
    'source-trim-binding', 'The retained line relationships must equal the same-response context projection.');
  try {
    if (plan.lineRegistration) {
      const binding = plan.lineRegistration; const query = binding.optionsQuery;
      context.trimRelationships.forEach((row, i) => {
        const variants = Array.from({ length: binding.includedIndex + 1 }, () => ({}));
        variants[binding.includedIndex] = { configuration: { modelCode: row.included.modelCode,
          elements: query.kind === 'trim' ? { [row.included.elementCode]: {} } : {} } };
        tree[r.aliases[i]].modelRanges[r.catalogueRangeKey].lines[binding.lineKey] = {
          ...(Object.hasOwn(row.option, 'value') ? { option: row.option.value } : {}),
          defaultModel: { modelCode: row.defaultModel.modelCode, agModelCode: row.defaultModel.agModelCode }, includedTransmissionVariants: variants };
      });
      requireValue(same(modelOptionsRelationships(tree, r, binding), context.trimRelationships), 'source-trim-binding', 'The retained registered line/default/included relationship changed.');
    } else {
    context.trimRelationships.forEach((row, i) => {
      const index = Number(new RegExp(`^/${r.aliases[i]}/modelRanges/${r.catalogueRangeKey}/lines/${r.optionsTrim}/includedTransmissionVariants/([0-9]+)/configuration$`).exec(row.included.pointer)?.[1]);
      requireValue(bounded(index, 0, 255), 'source-trim-binding', 'Retain the exact bounded included-variant pointer.');
      const variants = Array.from({ length: index + 1 }, () => ({}));
      variants[index] = { configuration: { modelCode: row.included.modelCode, elements: { [row.included.elementCode]: {} } } };
      tree[r.aliases[i]].modelRanges[r.catalogueRangeKey].lines[r.optionsTrim] = { option: row.option.value,
        defaultModel: { modelCode: row.defaultModel.modelCode, agModelCode: row.defaultModel.agModelCode }, includedTransmissionVariants: variants };
    });
    requireValue(same(strictTrimRelationships(tree, r), context.trimRelationships), 'source-trim-binding', 'The retained source line relationship changed.');
    }
  } catch { requireValue(false, 'source-trim-binding', 'The retained source line relationship changed.'); }
  if (retained.optionsObservation !== null) {
    const options = checkArtifact(retained.optionsObservation, 'options', 'bmw-options', 'bmw-source-options-observation.v1',
      ['schemaVersion', 'observation', 'report'], 'source-options-binding');
    try {
      const rows = options.report?.candidates?.[0]?.definitions;
      requireValue(Array.isArray(rows) && bounded(rows.length, 1, 512) && new Set(rows.map((row) => row.code)).size === rows.length,
        'source-options-binding', 'Retain distinct directly keyed typed source definitions.');
      const definitions = Object.fromEntries(rows.map((row) => [row.code, { option: row.option, optionType: row.optionType,
        ...(Object.hasOwn(row, 'longDescription') ? { phrases: { longDescription: row.longDescription } } : {}) }]));
      requireValue(same(typedOptionsReport(definitions, plan.lineRegistration ? plan.lineRegistration.optionsQuery.code : r.optionsTrim), options.report), 'source-options-binding', 'The retained typed definitions changed.');
    } catch { requireValue(false, 'source-options-binding', 'The retained typed source definitions changed.'); }
  }
}

/** Four GETs through the existing executor. Headers live only in this operation closure. */
export function publicBmwOptionsOperations(input) {
  const plan = validatePublicBmwOptionsPlan(input); const r = plan.modelRegistration; const requestRegistration = optionsRequestRegistration(plan);
  const urls = optionsRequestUrls(plan); let treeHeader; let localisationHeader; let treeQualified = false;
  const descriptor = (capability, url, project, extra = {}) => ({ sourceId: plan.source.id, sourceVersion: plan.source.version,
    kind: 'read-only-http', capability, strictJson: true, requestRegistration, prepare: async () => ({ method: 'GET', url, headers: {} }),
    project: (value, request, metadata) => {
      assertCollectionHttpObservation(metadata);
      requireValue(metadata.sourceVersion === plan.source.version && metadata.observedAt.slice(0, 10) === plan.qualificationDate,
        'source-observation-date', 'Use the pinned qualification day and executor-owned options source.');
      const result = project(value, request, metadata);
      const secrets = [treeHeader, localisationHeader].flatMap((header) => header ? Object.values(header) : []);
      JSON.stringify(result, (key, entry) => {
        requireValue(secrets.every((secret) => !key.includes(secret) && (typeof entry !== 'string' || !entry.includes(secret))),
          'source-sensitive-projection', 'No bootstrap header may enter retained options inspection facts.'); return entry;
      });
      return result;
    }, ...extra });
  return {
    page: descriptor('bmw-page', urls.page, (html) => {
      const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)]
        .map((match) => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
      requireValue(paths.length === 1 && settingsPattern.test(paths[0]), 'settings-discovery-shape', 'The registered model page must identify one settings path.');
      return { settingsPath: paths[0] };
    }),
    settings: descriptor('bmw-settings', null, (value) => {
      treeHeader = headerFor(value, 'settingsVehicleTree', true); localisationHeader = headerFor(value, 'settingsLocalisation', true);
      return { treeProfileQualified: true, localisationProfileQualified: true };
    }, { cache: false, prepare: async ({ path }) => {
      requireValue(typeof path === 'string' && settingsPattern.test(path), 'settings-discovery-shape', 'Use the one discovered settings path.');
      return { method: 'GET', url: 'https://configure.bmw.co.uk' + path, headers: {} };
    } }),
    discover: descriptor('bmw-model-tree', urls.discover, (value, _request, metadata) => {
      const report = strictModelReport(value, r);
      const appearances = Object.entries(value).filter(([, group]) => object(group?.modelRanges?.[r.catalogueRangeKey]?.models?.[r.modelCode])).map(([alias]) => alias).sort();
      requireValue(same(appearances, [...r.aliases].sort()), 'source-model-alias-conflict', 'Fresh direct aliases must equal the complete registered alias set.');
      const trimRelationships = plan.lineRegistration ? modelOptionsRelationships(value, r, plan.lineRegistration) : strictTrimRelationships(value, r); treeQualified = true;
      return sealedObservation({ schemaVersion: 'bmw-source-options-context-observation.v1', observation: metadata, report, trimRelationships });
    }, { prepare: async () => {
      requireValue(treeHeader, 'source-bootstrap-required', 'The memory-only public tree header is unavailable.');
      return { method: 'GET', url: urls.discover, headers: treeHeader };
    } }),
    options: descriptor('bmw-options', urls.options, (value, _request, metadata) => sealedObservation({
      schemaVersion: 'bmw-source-options-observation.v1', observation: metadata, report: typedOptionsReport(value, plan.lineRegistration ? plan.lineRegistration.optionsQuery.code : r.optionsTrim) }),
    { prepare: async () => {
      requireValue(treeQualified && localisationHeader, 'source-tree-required', 'Corroborate the full model and explicit same-response line relationship before options.');
      return { method: 'GET', url: urls.options, headers: localisationHeader };
    } }),
  };
}

export function validatePublicBmwDiagnosticPlan(plan) {
  const l = plan?.limits;
  requireValue(object(plan) && plan.schemaVersion === 'bmw-source-diagnostic-plan.v1'
    && Object.keys(plan).every((key) => ['schemaVersion', 'planId', 'qualificationDate', 'source', 'context', 'limits'].includes(key))
    && typeof plan.planId === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(plan.planId) && calendarDate(plan.qualificationDate)
    && object(plan.source) && same(plan.source, { id: 'bmw-uk-public', version: diagnosticVersion, kind: 'public-bmw-uk' })
    && object(plan.context) && same(plan.context, diagnosticContext) && object(l)
    && object(l.requestBudgets) && same(l.requestBudgets, { page: 1, settings: 1, discover: 1, options: 1 }) && l.maxAttempts === 1
    && bounded(l.sourceAttempts, 1, 4) && bounded(l.sourceBytes, 1, 2097152) && bounded(l.responseBytes, 1, 1048576)
    && bounded(l.operationTimeoutMs, 1, 10000) && bounded(l.deadlineMs, 1, 45000) && l.retryDelayMs === 0 && l.concurrency === 1
    && bounded(l.cacheEntries, 1, 16) && bounded(l.cacheRetentionMs, 1, 86400000)
    && bounded(l.checkpointBytes, 1024, 1048576) && l.imageRequests === 0,
  'diagnostic-plan-refused', 'Use the separate finite observation-only diagnostic plan and exact source context.');
  return structuredClone(plan);
}

export function validatePublicBmwPlan(plan) {
  if (isBmwBatchPlan(plan)) return validateBmwBatchPlan(plan);
  const l = plan.limits;
  requireValue(plan.source.version === sourceVersion && same(plan.models, ['T5MJ']) && plan.candidateCount === 1
    && plan.target === 1 && same(plan.context, { catalogueDate: '2026-11-01', market: 'GB', locale: 'en-GB', orderDate: '2026-11-01', effectDate: '2027-01-05' })
    && object(plan.knownSelection) && Array.isArray(plan.knownSelection.factoryCodes)
    && plan.knownSelection.factoryCodes.length === 47 && normaliseCodes(plan.knownSelection.factoryCodes).length === 47
    && plan.knownSelection.factoryCodes.every((code) => /^[A-Z0-9]{4,12}$/.test(code) && !code.startsWith('SE'))
    && seed.every((code) => plan.knownSelection.factoryCodes.includes(code)) && same(plan.knownSelection.accessoryCodes, ['SE000001'])
    && l.maxAttempts === 1 && l.sourceAttempts <= 4 && l.sourceBytes <= 2097152 && l.responseBytes <= 1048576
    && l.operationTimeoutMs <= 10000 && l.deadlineMs <= 45000 && l.checkpointBytes <= 1048576
    && l.cacheEntries <= 16 && l.cacheRetentionMs <= 86400000
    && ['page', 'settings', 'discover', 'solve'].every((name) => l.requestBudgets[name] === 1),
  'public-source-plan-refused', 'Only the finite qualified known-seed source observation is executable.');
}

function headerFor(settings, profileName, strict = false) {
  let visited = 0; const profiles = []; const values = []; let invalidCandidate = false; let nestedRole = false;
  const visit = (value, fn, name = '', depth = 0) => {
    if (!object(value) && !Array.isArray(value)) return;
    requireValue(++visited <= 30000 && depth <= 24, 'settings-traversal-limit', 'The qualified settings traversal limit changed.');
    fn(value, name);
    for (const [key, entry] of Object.entries(value)) if (entry && typeof entry === 'object') visit(entry, fn, key, depth + 1);
  };
  visit(settings, (value, name) => { if (!strict && profileName.test(name)) profiles.push(value); });
  if (strict) {
    const app = object(settings) && Object.hasOwn(settings, 'APP') ? settings.APP : undefined;
    const backend = object(app) && Object.hasOwn(app, 'backend') ? app.backend : undefined;
    if (object(backend) && Object.hasOwn(backend, profileName) && object(backend[profileName])) profiles.push(backend[profileName]);
  }
  const candidate = (entry) => { if (typeof entry === 'string') values.push(entry); else if (strict) invalidCandidate = true; };
  for (const profile of profiles) visit(profile, (value) => {
    for (const [name, entry] of Object.entries(value)) {
      if (strict && name === profileName) nestedRole = true;
      if (name.toLowerCase() === 'x-api-key') candidate(entry);
    }
    if (typeof value.name === 'string' && value.name.toLowerCase() === 'x-api-key') candidate(value.value);
  });
  const unique = [...new Set(values)];
  requireValue((!strict || profiles.length === 1 && values.length === 1 && !invalidCandidate && !nestedRole)
    && unique.length === 1 && unique[0].length > 0 && unique[0].length <= 4096,
    'settings-header-shape', 'The qualified public application header shape changed.');
  return { 'x-api-key': unique[0] };
}

const optionalModelFields = ['taxDate', 'prodDate', 'modelName', 'modelNameRaw', 'derivative', 'bodyStyle', 'agBodyStyle',
  'fuelTypeCode', 'hybridCode', 'engineSeries', 'driveType', 'transmission', 'trim'];
const safeLabel = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f<>]/u.test(value);
export function strictModelReport(value, registration) {
  requireValue(object(value) && Object.keys(value).length <= 100, 'source-tree-shape', 'Use a bounded full model tree.');
  const r = registration ? validateBmwModelRegistration(registration) : null;
  const expectedFacts = r ? { modelCode: r.modelCode, agModelCode: r.agModelCode, modelRange: r.rawModelRange,
    steering: r.steering, orderDate: r.orderDate, effectDate: r.effectDate } : expected;
  const nodes = (r?.aliases || ['5', 'I']).map((group) => {
    const path = [group, 'modelRanges', r?.catalogueRangeKey || 'G61E', 'models', r?.modelCode || 'T5MJ']; let record = value;
    for (const key of path) record = object(record) && Object.hasOwn(record, key) ? record[key] : undefined;
    requireValue(object(record), 'source-full-model-missing', 'Both direct full model records are required.');
    requireValue(Object.entries(expectedFacts).every(([key, field]) => Object.hasOwn(record, key) && record[key] === field),
      'source-model-substitution', 'The exact model, range and date literals must agree.');
    const pointer = '/' + path.join('/'); const facts = { ...expectedFacts };
    for (const key of optionalModelFields) if (Object.hasOwn(record, key)) {
      const field = record[key];
      const valid = key === 'taxDate' ? calendarDate(field)
        : key === 'prodDate' ? typeof field === 'string' && /^\d{8}$/.test(field) && calendarDate(`${field.slice(0, 4)}-${field.slice(4, 6)}-${field.slice(6)}`)
        : ['modelName', 'modelNameRaw', 'derivative'].includes(key) ? safeLabel(field)
          : typeof field === 'string' && (['fuelTypeCode', 'transmission'].includes(key) ? /^[A-Z0-9]{1,16}$/ : /^[A-Z0-9]{2,16}$/).test(field);
      requireValue(valid, 'source-model-field-value', 'A present direct optional model field failed its bounded type.');
      facts[key] = field;
    }
    return { pointer, parentPointer: '/' + path.slice(0, -1).join('/'), facts,
      fieldPointers: Object.fromEntries(Object.keys(facts).map((key) => [key, `${pointer}/${key}`])) };
  });
  requireValue(nodes.every((node) => same(nodes[0].facts, node.facts)), 'source-model-alias-conflict', 'All registered full aliases must agree including optional-field presence.');
  return { nodes, missingFields: optionalModelFields.filter((key) => !Object.hasOwn(nodes[0].facts, key)),
    aliasAppearances: nodes.length, distinctSelectedModels: 1, additionalConfigurations: 0 };
}

// These are inspection keys, not a declaration of an API root or semantic compatibility.
// Unknown names and arbitrary scalar values are counted, never copied or traversed.
const structuralKeys = new Set(['data', 'result', 'options', 'definitions', 'vehicle', 'model', 'models',
  'option', 'optionType', 'phrases', 'longDescription', 'modelCode', 'effectDate', 'orderDate', 'language']);
const optionCode = (key) => /^[A-Z0-9]{2,16}$/.test(key);
function optionsShapeReport(value) {
  const structure = []; const candidates = []; let visited = 0; let unknownFields = 0;
  const visit = (entry, pointer, depth) => {
    requireValue(++visited <= 4096 && depth <= 16, 'source-options-shape-limit', 'The safe structural report exceeded its finite traversal.');
    structure.push({ pointer, type: entry === null ? 'null' : Array.isArray(entry) ? 'array' : typeof entry });
    if (!object(entry) && !Array.isArray(entry)) return;
    const entries = Object.entries(entry);
    if (object(entry) && entries.length && entries.every(([key, definition]) => optionCode(key) && object(definition))) {
      requireValue(entries.length <= 512 && candidates.length < 8, 'source-options-shape-limit', 'The candidate definition report exceeded its finite bounds.');
      const definitions = entries.map(([code, definition]) => {
        const row = { code, pointer: `${pointer}/${code}`, issues: [] };
        if (typeof definition.option === 'string' && optionCode(definition.option)) row.option = definition.option;
        else row.issues.push('option-value-type');
        if (row.option !== undefined && row.option !== code) row.issues.push('option-key-mismatch');
        if (typeof definition.optionType === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(definition.optionType)) row.optionType = definition.optionType;
        else row.issues.push('option-type-value');
        if (object(definition.phrases) && Object.hasOwn(definition.phrases, 'longDescription')) {
          if (safeLabel(definition.phrases.longDescription)) row.longDescription = definition.phrases.longDescription;
          else row.issues.push('long-description-unsafe');
        }
        return row;
      });
      candidates.push({ pointer, definitions });
    }
    for (const [key, child] of entries) {
      if (Array.isArray(entry) || structuralKeys.has(key) || optionCode(key)) visit(child, `${pointer}/${key}`, depth + 1);
      else unknownFields += 1;
    }
  };
  visit(value, '', 0);
  return { status: candidates.length > 1 ? 'ambiguous' : candidates.length === 1 ? 'schema-review-required' : 'unresolved',
    candidates, structure, unknownFields, admission: false };
}

/** Fixed retained-field binding. Hashes identify supplied safe bytes; the owning diagnostic establishes source provenance. */
export function qualifyPublicBmwDiagnosticFields(input, retained) {
  const check = (value) => requireValue(value, 'source-qualification-binding', 'Use matching bounded retained diagnostic artifacts and the reviewed field bindings.');
  try {
    const plan = validatePublicBmwDiagnosticPlan(input);
    const artifacts = ['tree', 'options'].map((id) => {
      const item = retained?.[id]; check(object(item) && object(item.document));
      const bytes = JSON.stringify(item.document) + '\n';
      check(Buffer.byteLength(bytes) <= 131072 && item.bytes === Buffer.byteLength(bytes)
        && item.sha256 === createHash('sha256').update(bytes).digest('hex'));
      const document = item.document; const m = document.observation;
      check(document.schemaVersion === 'bmw-source-diagnostic-observation.v1'
        && same(Object.keys(document).sort(), ['observation', 'report', 'requestScope', 'schemaVersion'])
        && object(m) && same(Object.keys(m).sort(), ['capability', 'observedAt', 'operation', 'request', 'responseBytes', 'responseSha256', 'schemaVersion', 'sourceId', 'sourceVersion', 'transportKind'])
        && m.schemaVersion === 'collection-http-observation.v1' && m.sourceId === plan.source.id
        && m.sourceVersion === plan.source.version && ['live', 'fixture'].includes(m.transportKind)
        && m.operation === (id === 'tree' ? 'discover' : 'options') && m.capability === (id === 'tree' ? 'bmw-model-tree' : 'bmw-options')
        && same(m.request, { method: 'GET', url: id === 'tree' ? treeUrl : optionsUrl })
        && typeof m.observedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.observedAt)
        && new Date(m.observedAt).toISOString() === m.observedAt && m.observedAt.slice(0, 10) === plan.qualificationDate
        && bounded(m.responseBytes, 1, plan.limits.responseBytes) && typeof m.responseSha256 === 'string' && /^[a-f0-9]{64}$/.test(m.responseSha256));
      check(same(document.requestScope, id === 'tree'
        ? { role: 'request-input-only', market: 'GB', treeRequestEffectDate: '2026-11-01', orderDate: '2026-11-01', catalogueRangeKey: 'G61E' }
        : { role: 'request-input-only', market: 'GB', modelCode: 'T5MJ', effectDate: '2027-01-05', orderDate: '2026-11-01', language: 'en', trim: 'S0337' }));
      return { id, bytes, sha256: item.sha256, json: document,
        observedDatePointer: '/observation/observedAt', observedDateFormat: 'iso-timestamp',
        requestRoots: ['/requestScope', '/observation/request'] };
    });
    const [tree, options] = artifacts;
    const elapsed = Date.parse(options.json.observation.observedAt) - Date.parse(tree.json.observation.observedAt);
    check(tree.json.observation.transportKind === options.json.observation.transportKind && elapsed >= 0 && elapsed <= plan.limits.deadlineMs);
    const report = tree.json.report; check(object(report) && Array.isArray(report.nodes) && report.nodes.length === 2);
    // This local validation view contains only the two retained fact records, never raw response bytes.
    const validationTree = Object.fromEntries(['5', 'I'].map((group, index) => [group,
      { modelRanges: { G61E: { models: { T5MJ: report.nodes[index].facts } } } }]));
    check(same(report, strictModelReport(validationTree)));
    const shape = options.json.report;
    check(object(shape) && shape.status === 'schema-review-required' && shape.admission === false
      && same(Object.keys(shape).sort(), ['admission', 'candidates', 'status', 'structure', 'unknownFields'])
      && Array.isArray(shape.candidates) && shape.candidates.length === 1 && object(shape.candidates[0]) && shape.candidates[0].pointer === ''
      && same(Object.keys(shape.candidates[0]).sort(), ['definitions', 'pointer'])
      && Array.isArray(shape.structure) && shape.structure.length <= 4096
      && Number.isSafeInteger(shape.unknownFields) && shape.unknownFields >= 0);
    const definitions = shape.candidates[0].definitions;
    check(Array.isArray(definitions) && definitions.length > 0 && definitions.length <= 512);
    const codes = new Set();
    for (const row of definitions) {
      check(object(row) && Object.keys(row).every((key) => ['code', 'pointer', 'issues', 'option', 'optionType', 'longDescription'].includes(key))
        && typeof row.code === 'string' && optionCode(row.code) && !codes.has(row.code) && row.option === row.code && row.pointer === '/' + row.code
        && Array.isArray(row.issues) && row.issues.length === 0
        && typeof row.optionType === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(row.optionType)
        && (!Object.hasOwn(row, 'longDescription') || safeLabel(row.longDescription)));
      codes.add(row.code);
    }
    const context = Object.fromEntries(['modelCode', 'agModelCode', 'orderDate', 'effectDate'].map((key) => [key, expected[key]]));
    const contextPointers = Object.fromEntries(Object.keys(context).map((key) => [key, '/report/nodes/0/facts/' + key]));
    tree.context = contextPointers; tree.responseRoots = ['/report/nodes/0/facts', '/report/nodes/1/facts'];
    options.context = contextPointers; options.contextArtifactId = 'tree'; options.responseRoots = ['/report/candidates/0/definitions'];
    const sourceFields = { modelCode: 'modelCode', agModelCode: 'agModelCode', rawModelRange: 'modelRange', steeringLiteral: 'steering',
      orderDate: 'orderDate', effectDate: 'effectDate', taxDate: 'taxDate', productionDate: 'prodDate', modelName: 'modelName',
      derivative: 'derivative', bodyStyle: 'bodyStyle', engineSeries: 'engineSeries', fuelTypeCode: 'fuelTypeCode',
      hybridCode: 'hybridCode', driveType: 'driveType', transmission: 'transmission', trim: 'trim' };
    const claims = [];
    report.nodes.forEach((node, index) => {
      for (const [field, sourceKey] of Object.entries(sourceFields)) {
        const key = field === 'modelName' && !Object.hasOwn(node.facts, sourceKey) ? 'modelNameRaw' : sourceKey;
        if (Object.hasOwn(node.facts, key)) claims.push({ field, artifactId: 'tree',
          pointer: `/report/nodes/${index}/facts/${key}`, sourcePointer: node.fieldPointers[key] });
      }
    });
    for (const [field, code] of [['paint', 'P0300'], ['upholstery', 'FKSFU']]) {
      const index = definitions.findIndex((row) => row.code === code);
      if (index !== -1) claims.push({ field, code, artifactId: 'options',
        pointer: `/report/candidates/0/definitions/${index}`, sourcePointer: '/' + code });
    }
    const result = qualifyBmwSourceFields({ target: { observedDate: plan.qualificationDate, context }, artifacts, claims,
      requiredFields: [...Object.keys(sourceFields), 'paint', 'upholstery', 'accessoryQuantity', 'physicalProductionDate', 'modelYear', 'plant', 'verifiedFitted'] });
    return { ...result, accepted: [], sourceBindings: Object.fromEntries(artifacts.map((artifact) => [artifact.id, {
      artifactSha256: artifact.sha256, responseSha256: artifact.json.observation.responseSha256,
      responseBytes: artifact.json.observation.responseBytes, observedAt: artifact.json.observation.observedAt,
      transportKind: artifact.json.observation.transportKind, request: artifact.json.observation.request,
      ...(artifact.id === 'options' ? { definitionRoot: '', definitionCount: definitions.length,
        contextArtifactId: 'tree', contextBasis: 'strict-model-response-associated-with-exact-options-request', requestScopeRole: 'request-input-only' }
        : { rawModelPointers: report.nodes.map((node) => node.pointer) }) }])) };
  } catch {
    check(false);
  }
}

/** Fixed observation-only operations. The existing session owns all transport and retention budgets. */
export function publicBmwQualificationOperations(input) {
  const plan = validatePublicBmwDiagnosticPlan(input); let treeHeader; let localisationHeader; let treeQualified = false;
  const observe = (metadata, operation) => {
    requireValue(metadata?.schemaVersion === 'collection-http-observation.v1' && metadata.operation === operation
      && metadata.sourceId === plan.source.id && metadata.sourceVersion === diagnosticVersion
      && ['fixture', 'live'].includes(metadata.transportKind), 'source-observation-metadata', 'Use executor-owned diagnostic observation metadata.');
    requireValue(metadata.observedAt.slice(0, 10) === plan.qualificationDate,
      'source-observation-date', 'The actual source observation date differs from the pinned qualification date.');
    return metadata;
  };
  const artifact = (report, metadata, operation, scope) => {
    const document = { schemaVersion: 'bmw-source-diagnostic-observation.v1', observation: observe(metadata, operation),
      requestScope: { role: 'request-input-only', ...scope }, report };
    const secrets = [treeHeader, localisationHeader].flatMap((header) => header ? Object.values(header) : []);
    // The report builders bound this document. Check decoded keys/values before JSON escaping.
    const bytes = JSON.stringify(document, (key, value) => {
      requireValue(secrets.every((secret) => !key.includes(secret) && (typeof value !== 'string' || !value.includes(secret))),
        'source-sensitive-projection', 'No bootstrap profile value may enter any retained diagnostic projection.');
      return value;
    }) + '\n';
    return { document, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const descriptor = (capability, url, project, extra = {}) => ({ sourceId: plan.source.id, sourceVersion: diagnosticVersion,
    kind: 'read-only-http', capability, prepare: async () => ({ method: 'GET', url, headers: {} }), project, ...extra });
  return {
    page: descriptor('bmw-page', pageUrl, (html, _request, metadata) => {
      const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)]
        .map((match) => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
      requireValue(paths.length === 1 && settingsPattern.test(paths[0]), 'settings-discovery-shape', 'The public page must identify one qualified settings file.');
      return { settingsPath: paths[0], observation: observe(metadata, 'page') };
    }),
    settings: descriptor('bmw-settings', null, (value, _request, metadata) => {
      assertCollectionHttpObservation(metadata); observe(metadata, 'settings');
      let failedRole = 'tree';
      try {
        treeHeader = headerFor(value, 'settingsVehicleTree', true);
        failedRole = 'localisation';
        localisationHeader = headerFor(value, 'settingsLocalisation', true);
      } catch (error) {
        if (['settings-header-shape', 'settings-traversal-limit'].includes(error.code)) {
          error.settingsShapeRefusal = createSettingsShapeRefusal({ settings: value, failedRole, reason: error.code, metadata, plan });
        }
        throw error;
      }
      return { publicProfilesQualified: true, observation: observe(metadata, 'settings') };
    }, { cache: false, prepare: async ({ path }) => {
      requireValue(typeof path === 'string' && settingsPattern.test(path), 'settings-discovery-shape', 'Use the path discovered from the pinned page.');
      return { method: 'GET', url: 'https://configure.bmw.co.uk' + path, headers: {} };
    } }),
    discover: descriptor('bmw-model-tree', treeUrl, (value, _request, metadata) => {
      const report = strictModelReport(value);
      const result = artifact(report, metadata, 'discover',
        { market: 'GB', treeRequestEffectDate: '2026-11-01', orderDate: '2026-11-01', catalogueRangeKey: 'G61E' });
      treeQualified = true; return result;
    },
    { prepare: async () => {
      requireValue(treeHeader, 'source-bootstrap-required', 'The memory-only tree header is unavailable.');
      return { method: 'GET', url: treeUrl, headers: treeHeader };
    } }),
    options: descriptor('bmw-options', optionsUrl, (value, _request, metadata) => artifact(optionsShapeReport(value), metadata, 'options',
      { market: 'GB', modelCode: 'T5MJ', effectDate: '2027-01-05', orderDate: '2026-11-01', language: 'en', trim: 'S0337' }),
    { prepare: async () => {
      requireValue(localisationHeader, 'source-bootstrap-required', 'The memory-only localisation header is unavailable.');
      requireValue(treeQualified, 'source-tree-required', 'The strict full model context must be observed before options.');
      return { method: 'GET', url: optionsUrl, headers: localisationHeader };
    } }),
  };
}

/** Source projections only. All traffic, deadlines, budgets, caching and persistence belong to the common session. */
export function publicBmwOperations(plan) {
  if (isBmwBatchPlan(plan)) return publicBmwBatchOperations(plan);
  let treeHeader; let solverHeader;
  const descriptor = (capability, url, project, extra = {}) => ({ sourceId: plan.source.id, sourceVersion,
    kind: 'read-only-http', capability, prepare: async () => ({ method: 'GET', url, headers: {} }), project, ...extra });
  return {
    page: descriptor('bmw-page', pageUrl, (html) => {
      const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)]
        .map((match) => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
      requireValue(paths.length === 1 && settingsPattern.test(paths[0]), 'settings-discovery-shape', 'The public page must identify one qualified settings file.');
      return { settingsPath: paths[0] };
    }),
    settings: descriptor('bmw-settings', null, (value) => {
      treeHeader = headerFor(value, /^settingsVehicleTree$/);
      solverHeader = headerFor(value, /^settings(RuleSolver|Rules|Constructibility)$/);
      return { publicProfilesQualified: true };
    }, { cache: false, prepare: async ({ path }) => {
      requireValue(typeof path === 'string' && settingsPattern.test(path), 'settings-discovery-shape', 'Use the settings path discovered from the pinned page.');
      return { method: 'GET', url: 'https://configure.bmw.co.uk' + path, headers: {} };
    } }),
    discover: descriptor('bmw-model-tree', treeUrl, (value) => {
      requireValue(object(value) && Object.keys(value).length <= 100, 'source-tree-shape', 'The qualified model tree changed.');
      const rows = [];
      for (const [group, entry] of Object.entries(value)) {
        const record = entry?.modelRanges?.G61E?.models?.T5MJ;
        if (record !== undefined) {
          requireValue(object(record) && Object.entries(expected).every(([key, field]) => record[key] === field),
            'source-model-substitution', 'The full selected model mapping or dates changed.');
          rows.push({ group, ...expected });
        }
      }
      requireValue(rows.length > 0, 'source-full-model-missing', 'A compact defaultModel reference cannot qualify a full model mapping.');
      return { ...expected, groups: rows.map((row) => row.group).sort(), catalogueRangeKey: 'G61E', treeRequestEffectDate: '2026-11-01' };
    }, { prepare: async () => {
      requireValue(treeHeader, 'source-bootstrap-required', 'The memory-only public settings header must be bootstrapped within the remaining budget.');
      return { method: 'GET', url: treeUrl, headers: treeHeader };
    } }),
    solve: descriptor('bmw-solver', solverUrl, (value) => {
      const configuration = value?.configuration; const elements = configuration?.elements;
      requireValue(value?.constructible === true && configuration?.modelCode === expected.modelCode && object(elements),
        'source-solver-shape', 'Only the qualified constructible model response is retained.');
      const selected = Object.keys(elements).sort();
      const factory = normaliseCodes(plan.knownSelection.factoryCodes); const accessories = plan.knownSelection.accessoryCodes;
      requireValue(same(selected, [...factory, ...accessories].sort()) && selected.every((code) => object(elements[code])
        && elements[code].code === code && elements[code].type === (accessories.includes(code) ? 'accessory' : 'option')),
      'source-selection-changed', 'The complete known selection and source factory/accessory classification must agree exactly.');
      return { constructible: true, selectedOptions: factory, selectedAccessories: accessories.map((code) => ({ code, type: 'accessory', quantity: null })),
        selectedElements: selected.map((code) => ({ code, type: elements[code].type })) };
    }, { prepare: async () => {
      requireValue(solverHeader, 'source-bootstrap-required', 'The memory-only public settings header is unavailable.');
      return { method: 'GET', url: solverUrl, headers: solverHeader };
    } }),
  };
}

/** Same source/session seams, with explicit data-pinned context and finite request membership. */
function publicBmwBatchOperations(plan) {
  const requestRegistration = bmwBatchRequestRegistration(plan); const r = requestRegistration.model;
  const urls = bmwBatchPlanRequestUrls(plan); let treeHeader; let localisationHeader; let solverHeader; let treeQualified = false; let definitionsQualified = false;
  const descriptor = (capability, url, project, extra = {}) => ({ sourceId: plan.source.id, sourceVersion: plan.source.version,
    kind: 'read-only-http', capability, strictJson: true, requestRegistration, prepare: async () => ({ method: 'GET', url, headers: {} }),
    project: (value, request, metadata) => {
      const result = project(value, request, metadata);
      const secrets = [treeHeader, localisationHeader, solverHeader].flatMap((header) => header ? Object.values(header) : []);
      JSON.stringify(result, (key, entry) => {
        requireValue(secrets.every((secret) => !key.includes(secret) && (typeof entry !== 'string' || !entry.includes(secret))),
          'source-sensitive-projection', 'No bootstrap profile value may enter any retained source projection.');
        return entry;
      });
      return result;
    }, ...extra });
  const requested = (request) => {
    requireValue(requestRegistration.candidates.some((row) => same(row, request)), 'source-candidate-registration', 'Only the exact allocated candidate requests may execute.');
    return request;
  };
  return {
    page: descriptor('bmw-page', urls.page, (html) => {
      const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)]
        .map((match) => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
      requireValue(paths.length === 1 && settingsPattern.test(paths[0]), 'settings-discovery-shape', 'The pinned page must identify one settings file.');
      return { settingsPath: paths[0] };
    }),
    settings: descriptor('bmw-settings', null, (value) => {
      treeHeader = headerFor(value, 'settingsVehicleTree', true); localisationHeader = headerFor(value, 'settingsLocalisation', true);
      const names = Object.keys(value?.APP?.backend || {}).filter((name) => /^settings(RuleSolver|Rules|Constructibility)$/.test(name));
      requireValue(names.length === 1, 'settings-header-shape', 'Exactly one direct rule solver profile is required.');
      solverHeader = headerFor(value, names[0], true); return { publicProfilesQualified: true };
    }, { cache: false, prepare: async ({ path }) => {
      requireValue(typeof path === 'string' && settingsPattern.test(path), 'settings-discovery-shape', 'Use the settings file discovered from the pinned page.');
      return { method: 'GET', url: 'https://configure.bmw.co.uk' + path, headers: {} };
    } }),
    discover: descriptor('bmw-model-tree', urls.discover, (value) => {
      const report = plan.source.version === BMW_MODEL_BATCH_SOURCE_VERSION ? bmwModelLineReport(value, r, plan.lineRegistration) : strictModelReport(value, r); treeQualified = true; return report;
    }, { prepare: async () => {
      requireValue(treeHeader, 'source-bootstrap-required', 'The memory-only public tree header is unavailable.');
      return { method: 'GET', url: urls.discover, headers: treeHeader };
    } }),
    options: descriptor('bmw-options', urls.options, (value) => {
      const report = optionsShapeReport(value); const definitions = report.candidates[0]?.definitions;
      requireValue(report.status === 'schema-review-required' && report.candidates.length === 1 && report.candidates[0].pointer === ''
        && definitions.every((row) => row.issues.length === 0), 'source-options-shape', 'Use one directly keyed typed source definition map.');
      for (const request of requestRegistration.candidates) {
        requireValue(request.includedElements.every((code) => definitions.some((row) => row.code === code && row.option === code))
          && ['paint', 'fabric', 'rim'].every((type) => request.includedElements.filter((code) => definitions.some((row) => row.code === code && row.optionType === type)).length === 1),
        'source-candidate-definition', 'Every candidate input and exactly one paint, fabric and rim must occur in the fresh source definitions.');
      }
      definitionsQualified = true; return report;
    }, { prepare: async () => {
      requireValue(treeQualified && localisationHeader, 'source-tree-required', 'Observe the full registered model before its options.');
      return { method: 'GET', url: urls.options, headers: localisationHeader };
    } }),
    solve: descriptor('bmw-solver', null, (value) => {
      requireValue(object(value) && typeof value.constructible === 'boolean', 'source-solver-shape', 'The source must declare constructibility.');
      requireValue(value.constructible, 'source-not-constructible', 'The actual source refused this candidate.');
      const elements = value.configuration?.elements;
      requireValue(value.configuration?.modelCode === r.modelCode && object(elements) && Object.keys(elements).length > 0
        && Object.keys(elements).length <= 320, 'source-solver-shape', 'Retain the complete constructible response for the registered model.');
      requireValue(Object.entries(elements).every(([code, row]) => /^[A-Z0-9]{4,12}$/.test(code) && object(row) && row.code === code
        && row.type === (code.startsWith('SE') ? 'accessory' : 'option')), 'source-selection-classification', 'Factory and accessory source types must remain separate.');
      const factory = Object.keys(elements).filter((code) => elements[code].type === 'option').sort();
      requireValue(factory.length > 0 && factory.length <= 256, 'source-solver-shape', 'Retain a nonempty bounded factory selection.');
      return { constructible: true, selectedOptions: factory };
    }, { prepare: async (request) => {
      requested(request); requireValue(treeQualified && definitionsQualified && solverHeader, 'source-definitions-required', 'Qualify fresh full model and definitions before solving.');
      return { method: 'GET', url: bmwBatchPlanRequestUrls(plan, request).solve, headers: solverHeader };
    } }),
  };
}

export function publicBmwObservation({ plan, model, selection, key, mode, observedAt }) {
  return { ...key({ vgModelCode: model.modelCode, agModelCode: model.agModelCode, factoryOptionCodes: selection.selectedOptions }),
    source: structuredClone(plan.source), constructible: true, selectionComplete: true,
    provenance: { kind: mode === 'live' ? 'public-source-observation' : 'synthetic-http-fixture', observedAt,
      providerStatus: 'unsupported-public-website', sourceVersion },
    sourceContext: { market: 'GB', locale: 'en-GB', catalogueDate: plan.context.catalogueDate, orderDate: model.orderDate,
      effectDate: model.effectDate, treeRequestEffectDate: model.treeRequestEffectDate, catalogueRangeKey: model.catalogueRangeKey,
      modelRangeField: model.modelRange, steeringLiteral: model.steering, fullRecordGroups: model.groups },
    originalRequest: { modelCode: model.modelCode, elements: seed.slice(), mandatoryElements: ['S0337'],
      effectDate: model.effectDate, orderDate: model.orderDate },
    resolvedSelection: structuredClone(selection), modelYear: { state: 'unknown' },
    canonicalAdapterContext: { status: 'unqualified', missing: ['productionDate', 'taxDate', 'trim', 'paint-and-upholstery-classification', 'accessory-quantity'] } };
}
