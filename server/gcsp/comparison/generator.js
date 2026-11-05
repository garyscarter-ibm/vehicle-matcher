import { createHash } from 'node:crypto';

export const COMPARISON_GENERATOR_VERSION = 'comparison-inputs.sha256.v1';
export const COMPARISON_KEYS = Object.freeze([
  'comparison.cohortSize', 'comparison.seeds', 'comparison.startsAt', 'comparison.horizonDays',
  'comparison.gradeDistribution', 'comparison.pointsAllowanceMultiplier', 'comparison.renewalDays',
  'comparison.needs.v1', 'comparison.importanceDistribution', 'comparison.briefNoise.v1',
  'comparison.accessGroups', 'comparison.buddyUptake', 'comparison.carsPerEmployee',
  'comparison.modelLineMix', 'comparison.releaseCadence', 'comparison.configurationSet.v1',
  'comparison.maximumGeneratedRows',
]);
const SIGNATURE_KEYS = ['stock.configuration.modelCodeField', 'stock.configuration.codeSeparator',
  'stock.configuration.includePaintAndUpholstery', 'stock.configuration.encoding'];
const EXTRA_KEYS = [...SIGNATURE_KEYS, 'hold.buddy.durationSeconds', 'employee.recommendation.v1',
  'brief.slider.minimum', 'brief.slider.maximum'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const contextKey = ({ companyId, schemeId, gradeId }) => JSON.stringify([companyId, schemeId, gradeId]);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export class ComparisonInputError extends Error {
  constructor(code, key) {
    super(`Comparison input ${code}: ${key}.`);
    this.name = 'ComparisonInputError';
    this.code = code;
    this.key = key;
  }
}
const requireInput = (condition, key, code = 'invalid-policy') => {
  if (!condition) throw new ComparisonInputError(code, key);
};
const only = (value, fields) => object(value) && Object.keys(value).every((key) => fields.includes(key));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const probability = (value) => finite(value) && value >= 0 && value <= 1;
const validInstant = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const range = (value) => only(value, ['min', 'max']) && integer(value.min)
  && integer(value.max) && value.min <= value.max;
function jsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return true;
  if ((!object(value) && !Array.isArray(value)) || seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every((child) => jsonValue(child, seen));
  seen.delete(value);
  return valid;
}
const weighted = (rows, key, validate) => {
  requireInput(Array.isArray(rows) && rows.length > 0 && rows.every((row) => object(row)
    && finite(row.weight) && row.weight > 0 && validate(row))
    && finite(rows.reduce((total, row) => total + row.weight, 0)), key);
};

function validateValues(values) {
  const value = (key) => values[`comparison.${key}`];
  const registry = values['employee.recommendation.v1'];
  const minimum = values['brief.slider.minimum'];
  const maximum = values['brief.slider.maximum'];
  requireInput(object(registry?.preferences) && object(registry?.essentials), 'employee.recommendation.v1');
  requireInput(minimum === 0 && maximum === 100, 'brief.slider', 'unsupported-policy');
  const slider = (item) => Number.isInteger(item) && item >= minimum && item <= maximum;
  requireInput(integer(value('maximumGeneratedRows')) && value('maximumGeneratedRows') > 0, 'comparison.maximumGeneratedRows');
  requireInput(integer(value('cohortSize')) && value('cohortSize') > 0
    && value('cohortSize') <= value('maximumGeneratedRows'), 'comparison.cohortSize');
  requireInput(Array.isArray(value('seeds')) && value('seeds').length > 0
    && value('seeds').every((seed) => text(seed) || Number.isSafeInteger(seed))
    && new Set(value('seeds').map((seed) => JSON.stringify(seed))).size === value('seeds').length, 'comparison.seeds');
  requireInput(validInstant(value('startsAt')), 'comparison.startsAt');
  requireInput(integer(value('horizonDays')) && value('horizonDays') > 0
    && Date.parse(value('startsAt')) + value('horizonDays') * 86400000 <= 8640000000000000, 'comparison.horizonDays');
  requireInput(range(value('renewalDays')) && value('renewalDays').max <= value('horizonDays'), 'comparison.renewalDays');
  weighted(value('gradeDistribution'), 'comparison.gradeDistribution', (row) => only(row,
    ['companyId', 'schemeId', 'gradeId', 'weight']) && ['companyId', 'schemeId', 'gradeId'].every((key) => text(row[key])));
  requireInput(new Set(value('gradeDistribution').map(contextKey)).size === value('gradeDistribution').length,
    'comparison.gradeDistribution');
  requireInput(finite(value('pointsAllowanceMultiplier')) && value('pointsAllowanceMultiplier') >= 0,
    'comparison.pointsAllowanceMultiplier');
  const needs = value('needs.v1');
  requireInput(only(needs, ['essentials', 'preferences']) && object(needs.preferences)
    && Object.keys(needs.preferences).length > 0, 'comparison.needs.v1');
  weighted(needs.essentials, 'comparison.needs.v1', (row) => only(row, ['weight', 'value']) && object(row.value)
    && Object.entries(row.value).every(([key, requirement]) => {
      const definition = Object.hasOwn(registry.essentials, key) ? registry.essentials[key] : null;
      return definition && only(requirement, ['operator', 'value', 'unit']) && requirement.operator === definition.operator
        && requirement.unit === definition.unit && (definition.type === 'number' ? finite(requirement.value)
          && requirement.value >= 0 && (key !== 'seats' || Number.isInteger(requirement.value))
          : definition.type === 'boolean' ? typeof requirement.value === 'boolean'
            : definition.type === 'list' ? Array.isArray(requirement.value) && requirement.value.length > 0 && requirement.value.every(text)
              : definition.type === 'enum' ? definition.values.includes(requirement.value) : text(requirement.value));
    }));
  for (const [key, rows] of Object.entries(needs.preferences)) {
    const definition = Object.hasOwn(registry.preferences, key) ? registry.preferences[key] : null;
    requireInput(definition, 'comparison.needs.v1');
    weighted(rows, 'comparison.needs.v1', (row) => only(row, ['weight', 'value'])
      && (definition.type === 'slider' ? slider(row.value) : definition.values.includes(row.value)));
  }
  weighted(value('importanceDistribution'), 'comparison.importanceDistribution', (row) => only(row, ['weight', 'value'])
    && slider(row.value));
  const noise = value('briefNoise.v1');
  requireInput(only(noise, ['accuratePreferenceProbability', 'preserveEssentials'])
    && probability(noise.accuratePreferenceProbability) && noise.preserveEssentials === true, 'comparison.briefNoise.v1');
  weighted(value('accessGroups'), 'comparison.accessGroups', (row) => only(row,
    ['id', 'weight', 'accessSeconds', 'responseSeconds']) && text(row.id) && range(row.accessSeconds) && range(row.responseSeconds));
  requireInput(new Set(value('accessGroups').map((row) => row.id)).size === value('accessGroups').length, 'comparison.accessGroups');
  requireInput(probability(value('buddyUptake')), 'comparison.buddyUptake');
  requireInput(finite(value('carsPerEmployee')) && value('carsPerEmployee') >= 0
    && Number.isSafeInteger(Math.round(value('cohortSize') * value('carsPerEmployee')))
    && value('cohortSize') + Math.round(value('cohortSize') * value('carsPerEmployee')) <= value('maximumGeneratedRows'), 'comparison.carsPerEmployee');
  weighted(value('modelLineMix'), 'comparison.modelLineMix', (row) => only(row, ['modelLine', 'weight']) && text(row.modelLine));
  requireInput(new Set(value('modelLineMix').map((row) => row.modelLine)).size === value('modelLineMix').length, 'comparison.modelLineMix');
  const cadence = value('releaseCadence');
  requireInput(only(cadence, ['firstReleaseDay', 'intervalDays', 'batchSize']) && integer(cadence.firstReleaseDay)
    && integer(cadence.intervalDays) && cadence.intervalDays > 0 && integer(cadence.batchSize) && cadence.batchSize > 0,
  'comparison.releaseCadence');
  const stockCount = Math.round(value('cohortSize') * value('carsPerEmployee'));
  requireInput(cadence.firstReleaseDay <= value('horizonDays') && (!stockCount
    || cadence.firstReleaseDay + Math.floor((stockCount - 1) / cadence.batchSize) * cadence.intervalDays <= value('horizonDays')),
  'comparison.releaseCadence');
  requireInput(SIGNATURE_KEYS.every((key) => Object.hasOwn(values, key))
    && values[SIGNATURE_KEYS[0]] === 'vgModelCode' && values[SIGNATURE_KEYS[1]] === ','
    && values[SIGNATURE_KEYS[2]] === true && values[SIGNATURE_KEYS[3]] === 'base64-padded', 'stock.configuration', 'unsupported-policy');
  requireInput(integer(values['hold.buddy.durationSeconds']) && values['hold.buddy.durationSeconds'] > 0, 'hold.buddy.durationSeconds');
}

function validateConfiguration(row, values) {
  const key = 'comparison.configurationSet.v1';
  const identity = row?.canonicalIdentity;
  requireInput(object(row) && text(row.modelLine) && text(row.snapshotVersion) && object(row.configuration)
    && object(row.sourceContext) && Array.isArray(row.sourceContext.sourceRefs) && row.sourceContext.sourceRefs.every(text)
    && row.sourceContext.sourceRefs.length > 0 && object(identity) && object(identity.provenance)
    && ['synthetic', 'observed'].includes(identity.provenance.kind) && text(identity.provenance.source)
    && /^[A-Z0-9]{2,16}$/.test(identity[values[SIGNATURE_KEYS[0]]]) && Array.isArray(identity.factoryOptionCodes)
    && identity.factoryOptionCodes.length > 0 && identity.factoryOptionCodes.every((code) => typeof code === 'string' && /^[A-Z0-9]{2,16}$/.test(code))
    && new Set(identity.factoryOptionCodes).size === identity.factoryOptionCodes.length, key);
  const signature = `${identity[values[SIGNATURE_KEYS[0]]]}:${[...identity.factoryOptionCodes].sort().join(values[SIGNATURE_KEYS[1]])}`;
  requireInput(row.configurationId === Buffer.from(signature).toString('base64'), key, 'configuration-signature');
}

function validatePolicy(policy, values) {
  requireInput(object(policy) && text(policy.policyVersion) && object(policy.assumptions)
    && Array.isArray(policy.allowances) && Array.isArray(policy.configurations) && object(policy.configurationSource), 'policy');
  validateValues(values);
  for (const key of [...COMPARISON_KEYS, ...EXTRA_KEYS]) {
    const row = policy.assumptions[key];
    requireInput(object(row) && row.key === key && row.policyVersion === policy.policyVersion
      && text(row.unit) && ['assumed', 'verified'].includes(row.status) && text(row.basis)
      && text(row.source) && text(row.sourceDate), key, 'incoherent-policy');
  }
  for (const grade of values['comparison.gradeDistribution']) {
    const allowance = policy.allowances.find((row) => contextKey(row) === contextKey(grade));
    requireInput(allowance && allowance.policyVersion === policy.policyVersion && finite(allowance.monthlyPoints)
      && allowance.monthlyPoints >= 0 && allowance.unit === 'points/month', 'comparison.gradeDistribution', 'allowance-unavailable');
    requireInput(finite(allowance.monthlyPoints * values['comparison.pointsAllowanceMultiplier']), 'comparison.pointsAllowanceMultiplier');
  }
  const set = values['comparison.configurationSet.v1'];
  requireInput(object(set) && ['reviewed-fixtures', 'corpus'].includes(set.kind) && text(set.datasetId) && text(set.version)
    && text(set.basis) && text(set.reviewedOn) && Array.isArray(set.configurations) && set.configurations.length > 0
    && policy.configurations.length === set.configurations.length && policy.configurationSource.kind === set.kind
    && policy.configurationSource.datasetId === set.datasetId && policy.configurationSource.version === set.version
    && (set.kind !== 'corpus' || /^[a-f0-9]{64}$/.test(set.manifestDigest)), 'comparison.configurationSet.v1');
  requireInput(new Set(policy.configurations.map((row) => row.configurationId)).size === policy.configurations.length,
    'comparison.configurationSet.v1');
  for (const row of policy.configurations) {
    validateConfiguration(row, values);
    requireInput(set.configurations.some((reference) => reference.configurationId === row.configurationId
      && reference.snapshotVersion === row.snapshotVersion && reference.modelLine === row.modelLine),
    'comparison.configurationSet.v1', 'configuration-unavailable');
  }
  requireInput(values['comparison.modelLineMix'].every((mix) => policy.configurations.some((row) => row.modelLine === mix.modelLine)),
    'comparison.modelLineMix', 'configuration-unavailable');
}

// Resolve I/O once; the generator below receives only this immutable, explicitly pinned snapshot.
export async function loadComparisonPolicy({ policyService, policyRead, corpus } = {}) {
  requireInput(typeof policyService?.getActiveVersion === 'function' && typeof policyService?.getAssumption === 'function'
    && typeof policyService?.getAllowance === 'function' && object(policyRead), 'PolicyService', 'policy-unavailable');
  const readPort = async (method, key, ...args) => {
    try { return await policyService[method](...args); } catch {
      throw new ComparisonInputError('policy-unavailable', key);
    }
  };
  const active = await readPort('getActiveVersion', 'policyVersion', policyRead);
  requireInput(active?.status === 'ok' && text(active.policyVersion) && active.value?.policyVersion === active.policyVersion
    && (policyRead.policyVersion === undefined || policyRead.policyVersion === active.policyVersion), 'policyVersion', 'policy-unavailable');
  const read = { ...structuredClone(policyRead), policyVersion: active.policyVersion };
  const assumptions = {};
  for (const key of [...COMPARISON_KEYS, ...EXTRA_KEYS]) {
    const result = await readPort('getAssumption', key, key, read);
    requireInput(result?.status === 'ok' && result.policyVersion === active.policyVersion
      && result.value?.policyVersion === active.policyVersion, key, 'policy-unavailable');
    assumptions[key] = structuredClone(result.value);
  }
  const values = Object.fromEntries(Object.entries(assumptions).map(([key, row]) => [key, row.value]));
  validateValues(values);
  const allowances = [];
  for (const grade of values['comparison.gradeDistribution']) {
    const result = await readPort('getAllowance', 'comparison.gradeDistribution', grade, read);
    requireInput(result?.status === 'ok' && result.policyVersion === active.policyVersion
      && result.value?.policyVersion === active.policyVersion, 'comparison.gradeDistribution', 'allowance-unavailable');
    allowances.push(structuredClone(result.value));
  }
  const set = values['comparison.configurationSet.v1'];
  requireInput(object(set) && ['reviewed-fixtures', 'corpus'].includes(set.kind) && Array.isArray(set.configurations)
    && set.configurations.every((reference) => object(reference) && text(reference.configurationId)
      && text(reference.snapshotVersion) && text(reference.modelLine)), 'comparison.configurationSet.v1');
  const configurations = [];
  for (const reference of set.configurations) {
    if (set.kind === 'reviewed-fixtures') configurations.push(structuredClone(reference));
    else {
      requireInput(set.kind === 'corpus' && typeof corpus?.getConfiguration === 'function', 'comparison.configurationSet.v1', 'configuration-unavailable');
      let found;
      try { found = await corpus.getConfiguration(reference.configurationId); } catch {
        throw new ComparisonInputError('configuration-unavailable', 'comparison.configurationSet.v1');
      }
      requireInput(['ok', 'complete', 'partial'].includes(found?.status) && found.record?.configurationId === reference.configurationId
        && found.record?.snapshotVersion === reference.snapshotVersion && found.active?.datasetId === set.datasetId
        && found.active?.version === set.version && found.active?.manifestDigest === set.manifestDigest,
      'comparison.configurationSet.v1', 'configuration-unavailable');
      const { configurationId, snapshotVersion, canonicalIdentity, configuration, sourceContext } = found.record;
      configurations.push(structuredClone({ modelLine: reference.modelLine, configurationId, snapshotVersion,
        canonicalIdentity, configuration, sourceContext }));
    }
  }
  const policy = { policyVersion: active.policyVersion, assumptions, allowances, configurations,
    configurationSource: { kind: set.kind, datasetId: set.datasetId, version: set.version,
      ...(set.kind === 'corpus' ? { manifestDigest: set.manifestDigest } : {}), basis: set.basis, reviewedOn: set.reviewedOn,
      configurationCount: configurations.length, modelLines: [...new Set(configurations.map((row) => row.modelLine))].sort() } };
  validatePolicy(policy, values);
  return freeze(policy);
}

const draw = (seed, ...path) => parseInt(digest([COMPARISON_GENERATOR_VERSION, seed, ...path]).slice(0, 8), 16) / 0x100000000;
function choose(rows, seed, ...path) {
  const target = draw(seed, ...path) * rows.reduce((total, row) => total + row.weight, 0);
  let total = 0;
  for (const row of rows) { total += row.weight; if (target < total) return row; }
  return rows.at(-1);
}
const between = (bounds, seed, ...path) => bounds.min + Math.floor(draw(seed, ...path) * (bounds.max - bounds.min + 1));
const instant = (startsAt, days) => new Date(Date.parse(startsAt) + days * 86400000).toISOString();
function orderUuid(seed, index) {
  const bytes = Buffer.from(digest([COMPARISON_GENERATOR_VERSION, seed, 'order', index]).slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function altered(rows, current, seed, ...path) {
  const alternatives = rows.filter((row) => JSON.stringify(row.value) !== JSON.stringify(current));
  return alternatives.length ? choose(alternatives, seed, ...path).value : current;
}

export function generateComparisonInputs(seed, policy, { overlay = {} } = {}) {
  requireInput(text(seed) || Number.isSafeInteger(seed), 'seed', 'invalid-seed');
  requireInput(object(policy?.assumptions) && jsonValue(policy), 'policy', 'policy-unavailable');
  requireInput(object(overlay) && jsonValue(overlay) && Object.keys(overlay).every((key) => COMPARISON_KEYS.includes(key)
    && !['comparison.gradeDistribution', 'comparison.configurationSet.v1'].includes(key)
    || key === 'hold.buddy.durationSeconds'), 'overlay', 'invalid-overlay');
  let overrides;
  try { overrides = structuredClone(overlay); JSON.stringify(overrides); } catch {
    throw new ComparisonInputError('invalid-overlay', 'overlay');
  }
  const values = Object.fromEntries(Object.entries(policy.assumptions).map(([key, row]) => [key, structuredClone(row.value)]));
  Object.assign(values, overrides);
  validatePolicy(policy, values);
  const get = (key) => values[`comparison.${key}`];
  const employees = Array.from({ length: get('cohortSize') }, (_, index) => {
    const grade = choose(get('gradeDistribution'), seed, 'employee', index, 'grade');
    const allowance = policy.allowances.find((row) => contextKey(row) === contextKey(grade));
    const essentials = structuredClone(choose(get('needs.v1').essentials, seed, 'employee', index, 'essentials').value);
    const preferences = {};
    const statedPreferences = {};
    for (const [key, choices] of Object.entries(get('needs.v1').preferences).sort(([a], [b]) => a.localeCompare(b))) {
      const value = choose(choices, seed, 'employee', index, key, 'value').value;
      const importance = choose(get('importanceDistribution'), seed, 'employee', index, key, 'importance').value;
      preferences[key] = { value, importance };
      const accurate = draw(seed, 'employee', index, key, 'accuracy') < get('briefNoise.v1').accuratePreferenceProbability;
      statedPreferences[key] = { value: accurate ? value : altered(choices, value, seed, 'employee', index, key, 'noise-value'),
        importance: accurate ? importance : altered(get('importanceDistribution'), importance, seed, 'employee', index, key, 'noise-importance'),
        valueState: 'confirmed', importanceState: 'confirmed', source: 'synthetic-stated-brief' };
    }
    const group = choose(get('accessGroups'), seed, 'employee', index, 'access-group');
    const buddyParticipation = draw(seed, 'employee', index, 'buddy') < get('buddyUptake');
    const employeeId = `fictional-employee-${digest([seed, index]).slice(0, 24)}`;
    const renewalAt = instant(get('startsAt'), between(get('renewalDays'), seed, 'employee', index, 'renewal'));
    return { employeeId, fictional: true, companyId: grade.companyId, schemeId: grade.schemeId, gradeId: grade.gradeId,
      pointsAllowance: allowance.monthlyPoints * get('pointsAllowanceMultiplier'), pointsUnit: allowance.unit,
      renewalAt,
      underlyingNeeds: { essentials, preferences },
      statedBrief: { schemaVersion: 1, briefVersion: 1, requiredBy: renewalAt,
        essentials: Object.fromEntries(Object.entries(essentials).map(([key, requirement]) => [key,
          { ...structuredClone(requirement), state: 'confirmed', source: 'synthetic-stated-brief' }])), preferences: statedPreferences },
      accessGroup: group.id, accessSeconds: between(group.accessSeconds, seed, 'employee', index, 'access'),
      responseSeconds: between(group.responseSeconds, seed, 'employee', index, 'response'), buddyParticipation };
  });
  const count = Math.round(get('cohortSize') * get('carsPerEmployee'));
  const stock = Array.from({ length: count }, (_, index) => {
    const modelLine = choose(get('modelLineMix'), seed, 'stock', index, 'model').modelLine;
    const configurations = policy.configurations.filter((row) => row.modelLine === modelLine);
    const selected = configurations[Math.floor(draw(seed, 'stock', index, 'configuration') * configurations.length)];
    return { orderUuid: orderUuid(seed, index), configurationId: selected.configurationId, modelLine, eligibilityModelKey: modelLine,
      snapshotVersion: selected.snapshotVersion, configuration: structuredClone(selected.configuration),
      identityKind: 'synthetic', sourceKind: policy.configurationSource.kind };
  });
  requireInput(new Set(stock.map((car) => car.orderUuid)).size === stock.length, 'orderUuid', 'identity-collision');
  const releaseSchedule = [];
  const cadence = get('releaseCadence');
  for (let index = 0; index < stock.length; index += cadence.batchSize) {
    const releaseIndex = releaseSchedule.length;
    releaseSchedule.push({ releaseId: `fictional-release-${digest([seed, releaseIndex]).slice(0, 24)}`,
      at: instant(get('startsAt'), cadence.firstReleaseDay + releaseIndex * cadence.intervalDays),
      orderUuids: stock.slice(index, index + cadence.batchSize).map((car) => car.orderUuid) });
  }
  const assumptions = Object.values(policy.assumptions).map((row) => ({ ...structuredClone(row), value: values[row.key],
    ...(Object.hasOwn(overrides, row.key) ? { overlay: true, baselineValue: structuredClone(row.value) } : {}) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const manifest = { seed, seeds: structuredClone(get('seeds')), policyVersion: policy.policyVersion,
    generatorVersion: COMPARISON_GENERATOR_VERSION, overlay: overrides, overlayHash: digest(overrides),
    policyHash: digest({ assumptions: policy.assumptions, allowances: policy.allowances }),
    configurationHash: digest(policy.configurations), configurationSource: structuredClone(policy.configurationSource),
    startsAt: get('startsAt'), horizonDays: get('horizonDays'), assumptions, allowances: structuredClone(policy.allowances),
    counts: { employees: employees.length, stock: stock.length, releases: releaseSchedule.length },
    limitations: ['Fictional cohort and assumed behaviour; not BMW employee data.',
      'Calculated fit is not observed satisfaction. No route or outcome is generated.'] };
  manifest.inputHash = digest({ employees, stock, releaseSchedule });
  return freeze({ employees, stock, releaseSchedule, manifest });
}
