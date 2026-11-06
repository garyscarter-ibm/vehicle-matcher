import { createHash } from 'node:crypto';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { normaliseCodes, requireValue } from './configuration-key.mjs';
import { assertCollectionHttpObservation } from './collection-session.mjs';
import { createSettingsShapeRefusal } from './settings-shape-report.mjs';
import { qualifyBmwSourceFields } from './bmw-source-qualification.mjs';

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
function strictModelReport(value) {
  requireValue(object(value) && Object.keys(value).length <= 100, 'source-tree-shape', 'Use a bounded full model tree.');
  const nodes = ['5', 'I'].map((group) => {
    const path = [group, 'modelRanges', 'G61E', 'models', 'T5MJ']; let record = value;
    for (const key of path) record = object(record) && Object.hasOwn(record, key) ? record[key] : undefined;
    requireValue(object(record), 'source-full-model-missing', 'Both direct full model records are required.');
    requireValue(Object.entries(expected).every(([key, field]) => Object.hasOwn(record, key) && record[key] === field),
      'source-model-substitution', 'The exact model, range and date literals must agree.');
    const pointer = '/' + path.join('/'); const facts = { ...expected };
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
  requireValue(same(nodes[0].facts, nodes[1].facts), 'source-model-alias-conflict', 'Both full aliases must agree including optional-field presence.');
  return { nodes, missingFields: optionalModelFields.filter((key) => !Object.hasOwn(nodes[0].facts, key)),
    aliasAppearances: 2, distinctSelectedModels: 1, additionalConfigurations: 0 };
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
