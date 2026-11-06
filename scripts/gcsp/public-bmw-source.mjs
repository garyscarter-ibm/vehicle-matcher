import { inputDigest } from '../../server/gcsp/repository/core.js';
import { normaliseCodes, requireValue } from './configuration-key.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => inputDigest(a) === inputDigest(b);
const sourceVersion = 'f58-20261105.v1';
const seed = ['FKSFU', 'P0300', 'S0337', 'S043L'];
const expected = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
const pageUrl = 'https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ';
const treeUrl = 'https://prod.ucp.bmw.cloud/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2026-11-01/order-dates/2026-11-01?gfs-policy=none&cluster=default&model-ranges=G61E&future-models=true&closest-fallback=true';
const solverUrl = 'https://prod.ucp.bmw.cloud/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/models/T5MJ?add-rules-for-mandatory-element-classes=fabric%2Cpaint%2Crim&application=connext&included-elements=FKSFU%2CP0300%2CS0337%2CS043L&mandatory-elements=S0337';
const settingsPattern = /^\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/;

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

function headerFor(settings, profileName) {
  let visited = 0; const profiles = []; const values = [];
  const visit = (value, fn, name = '', depth = 0) => {
    if (!object(value) && !Array.isArray(value)) return;
    requireValue(++visited <= 30000 && depth <= 24, 'settings-traversal-limit', 'The qualified settings traversal limit changed.');
    fn(value, name);
    for (const [key, entry] of Object.entries(value)) if (entry && typeof entry === 'object') visit(entry, fn, key, depth + 1);
  };
  visit(settings, (value, name) => { if (profileName.test(name)) profiles.push(value); });
  for (const profile of profiles) visit(profile, (value) => {
    for (const [name, entry] of Object.entries(value)) if (name.toLowerCase() === 'x-api-key' && typeof entry === 'string') values.push(entry);
    if (typeof value.name === 'string' && value.name.toLowerCase() === 'x-api-key' && typeof value.value === 'string') values.push(value.value);
  });
  const unique = [...new Set(values)];
  requireValue(unique.length === 1 && unique[0].length > 0 && unique[0].length <= 4096,
    'settings-header-shape', 'The qualified public application header shape changed.');
  return { 'x-api-key': unique[0] };
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
