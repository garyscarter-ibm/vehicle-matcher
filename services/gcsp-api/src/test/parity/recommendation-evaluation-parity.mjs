// Offline generator for src/test/resources/recommendation-parity/evaluation-cases.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/recommendation-evaluation-parity.mjs
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';
import { createEmployeeRecommendationService, createStoredSubjectRecommendationEvaluator } from '../../../../../server/gcsp/recommendation/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../..');
const outPath = join(here, '../resources/recommendation-parity/evaluation-cases.json');
const variantsPath = join(here, '../resources/recommendation-parity/evaluation-variants.json');
const seed = JSON.parse(await readFile(join(root, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
const variants = JSON.parse(await readFile(variantsPath, 'utf8'));
process.env.TZ = 'UTC';
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// ---- seed variants: declarative ops, interpreted identically by the Java test ---------------------------
const TABLES = ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions'];
const matching = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
const setPath = (target, path, value, remove) => {
  const parts = path.split('.');
  const last = parts.pop();
  const holder = parts.reduce((node, part) => node[part], target);
  if (remove) delete holder[last]; else holder[last] = value;
};
function applyOps(base, ops) {
  const value = clone(base);
  for (const op of ops) {
    if (op.op === 'revise') {
      value.policyVersion = op.policyVersion; value.effectiveFrom = op.effectiveFrom;
      for (const table of TABLES) for (const row of value[table]) row.policyVersion = op.policyVersion;
    } else if (op.op === 'set') setPath(value, op.path, op.value, false);
    else if (op.op === 'assumption') {
      const row = value.assumptions.find((entry) => entry.key === op.key);
      if (op.path === '') row.value = op.value; else setPath(row.value, op.path, op.value, op.delete === true);
    } else if (op.op === 'dropAssumption') value.assumptions = value.assumptions.filter((row) => row.key !== op.key);
    else if (op.op === 'rows') for (const row of value[op.table].filter((entry) => matching(entry, op.where))) Object.assign(row, op.set);
    else if (op.op === 'dropRows') value[op.table] = value[op.table].filter((row) => !matching(row, op.where));
    else if (op.op === 'addRow') {
      const row = clone(value[op.table].find((entry) => matching(entry, op.from)));
      Object.assign(row, op.set);
      for (const key of op.delete ?? []) delete row[key];
      value[op.table].push(row);
    } else throw new Error(`unknown op ${op.op}`);
  }
  return value;
}
const fileContents = (ops) => {
  if (ops.length === 1 && ops[0].raw !== undefined) return ops[0].raw;
  if (ops.length === 1 && ops[0].missing) return null;
  return JSON.stringify(applyOps(seed, ops));
};

const scratch = await mkdtemp(join(tmpdir(), 'gcsp-evaluation-parity-'));
const policies = new Map();
async function policyFor(name) {
  if (policies.has(name)) return policies.get(name);
  const paths = [];
  for (const [index, ops] of variants[name].entries()) {
    const path = join(scratch, `${name.replaceAll('/', '_')}-${index}.json`);
    const contents = fileContents(ops);
    if (contents !== null) await writeFile(path, contents);
    paths.push(path);
  }
  const created = createPolicyService({ filePath: paths[0], retainedFilePaths: paths.slice(1) });
  policies.set(name, created);
  return created;
}
const WRAPS = { 'skew-all': ['getAllowance', 'getAssumption', 'getEligibility', 'getPointsCost'], 'skew-eligibility': ['getEligibility'],
  'skew-points': ['getPointsCost'], 'skew-assumption': ['getAssumption'], 'skew-allowance': ['getAllowance'] };
const wrapped = (service, mode) => Object.fromEntries(['getAllowance', 'getAssumption', 'getEligibility', 'getPointsCost'].map((method) => [method,
  WRAPS[mode].includes(method) ? async (...args) => ({ ...(await service[method](...args)), policyVersion: 'another-policy' }) : (...args) => service[method](...args)]));

// ---- fixtures (mirror server/test/helpers/employee-recommendation.js) ----------------------------------
const NOW = '2026-11-05T12:00:00.000Z';
const baseContext = { runId: 'run-employee', environmentId: 'demo', employeeId: 'employee-test', roles: ['employee'],
  companyId: 'demo-bmw-fs-uk', schemeId: 'choices-fs-uk', gradeId: 'G7', policyVersion: 'gcsp-policy-v1' };
const prov = (assurance = 'synthetic-scenario', extra = {}) => ({ sourceRef: 'fixture:employee', observedAt: NOW, version: 'facts-v1', assurance, ...extra });
const fact = (value, unit = null, assurance = 'synthetic-scenario') => ({ status: value === null ? 'unknown' : 'known', value, unit,
  provenance: prov(value === null ? 'unknown' : assurance) });
const pref = (value, importance = 100, extra = {}) => ({ value, importance, valueState: 'confirmed', importanceState: 'confirmed', source: 'employee', ...extra });
const essential = (value, operator = 'gte', unit = 'count', extra = {}) => ({ value, operator, unit, state: 'confirmed', source: 'employee', ...extra });
const brief = (patch = {}) => ({ schemaVersion: 1, briefVersion: 1, preferences: { body: pref('estate') }, essentials: { seats: essential(5) }, ...patch });
const uuid = (id) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
const stock = (id = 1, facts = {}, configurationId = 'RzIxOlMx', availability = {}) => ({ orderUuid: uuid(id), configurationId,
  availability: { state: 'available', availableFrom: NOW, availableUntil: '2027-01-01T00:00:00.000Z', version: 'availability-v1', ...availability },
  snapshot: { sourceNamespace: 'fixture:employee', identityKind: 'exact-stock', sourceKeys: { stockId: uuid(id) },
    snapshotVersion: 'snapshot-v1', observedAt: NOW, display: { name: `Synthetic exact car ${id}` }, facts: {
      eligibilityModelKey: fact('G21 Touring|320i'), body: fact('estate'), fuel: fact('petrol'), seats: fact(5, 'count'), boot: fact(500, 'L'),
      zeroTo62: fact(7, 's'), mpg: fact(45, 'mpg-imperial'), sizeClass: fact(3, 'ordinal-1-5'), tags: fact(['cruiser']), ...facts } } });
const providerValue = (cars = [stock()], patch = {}) => ({ runId: baseContext.runId, environmentId: baseContext.environmentId, employeeId: baseContext.employeeId,
  factsVersion: 'employee-facts-v1', stockVersion: 'stock-v1', employeeFacts: { driverEligible: fact(true), essentials: {}, charging: fact('home'),
    annualMileage: fact(12000, 'mi/year'), requiredBy: fact('2026-12-01T00:00:00.000Z') }, stock: cars, ...patch });
const baselineFacts = { modelLine: 'G21 Touring', eligibilityModelKey: 'G21 Touring|320i', configurationId: 'RzIxOlMx', body: 'estate', fuel: 'petrol', zeroTo62: 7.6, mpg: 42.8 };
const currentCar = (facts = baselineFacts, contractId = 'current:employee-test') => ({ contractId,
  source: { mode: 'synthetic', sourceVersion: 'manual-records-v1', observedAt: NOW },
  facts: Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => [key, fact(value, key === 'zeroTo62' ? 's' : key === 'mpg' ? 'mpg-imperial' : null)])) });
const rating = (value, contractId = 'current:employee-test') => ({ value, contractId, source: 'employee', ratedAt: NOW });
const sameAgain = (on, contractId = 'current:employee-test') => ({ on, contractId, source: 'employee', setAt: NOW });
const okClock = (patch = {}) => ({ kind: 'ok', now: NOW, runId: baseContext.runId, clockVersion: 'clock-v1', ...patch });
const withFacts = (patch) => (value) => { Object.assign(value.employeeFacts, patch); return value; };

// ---- Node execution -------------------------------------------------------------------------------------
const mkProvider = (spec) => {
  if (spec === undefined) return undefined;
  if (spec.kind === 'throw') return { resolve() { throw new Error('offline'); } };
  if (spec.kind === 'undefined') return { async resolve() { return undefined; } };
  if (spec.kind === 'raw') return { async resolve() { return clone(spec.outcome); } };
  return { async resolve() { return { status: 'ok', value: clone(spec.value) }; } };
};
const mkClock = (spec) => {
  if (spec === undefined) return undefined;
  if (spec.kind === 'throw') return { now() { throw new Error('clock'); } };
  if (spec.kind === 'undefined') return { async now() { return undefined; } };
  if (spec.kind === 'raw') return { async now() { return clone(spec.outcome); } };
  return { async now() { return { status: 'ok', value: { now: spec.now, runId: spec.runId, clockVersion: spec.clockVersion } }; } };
};
async function runNode(c) {
  let policy = c.missing?.includes('policy') ? undefined : await policyFor(c.variant);
  if (policy && c.wrap) policy = wrapped(policy, c.wrap);
  const ports = { provider: c.missing?.includes('provider') ? undefined : mkProvider(c.source),
    policy, time: c.missing?.includes('clock') ? undefined : mkClock(c.clock) };
  if (c.op === 'stored') return createStoredSubjectRecommendationEvaluator(ports).evaluate(clone(c.subject), clone(c.brief));
  const service = createEmployeeRecommendationService(ports);
  const context = c.context === undefined ? undefined : clone(c.context);
  return c.op === 'preview' ? service.previewUnsaved(context, clone(c.input)) : service.recommend(context, clone(c.request));
}

// ---- cases ----------------------------------------------------------------------------------------------
const cases = [];
const names = new Set();
const add = (name, spec) => {
  if (names.has(name)) throw new Error(`duplicate ${name}`);
  names.add(name);
  cases.push({ name, variant: 'seed', op: 'recommend', context: clone(baseContext), clock: okClock(), ...spec });
};
const rec = (name, spec = {}) => add(name, { request: brief(), source: { kind: 'value', value: providerValue() }, ...spec });
const pv = (cars, patch) => ({ kind: 'value', value: providerValue(cars, patch) });
const ctx = (patch) => ({ ...baseContext, ...patch });
const previewInput = (patch = {}, base = brief()) => { const { briefVersion, ...content } = base; return { brief: { ...content, ...patch }, baseBriefVersion: briefVersion, baseDraftVersion: 0 }; };
const prev = (name, spec = {}) => add(name, { op: 'preview', input: previewInput(), source: { kind: 'value', value: providerValue() }, ...spec });

// Eligibility: policy, points and allowance.
rec('eligible default');
for (const [label, key] of [['excluded model', 'G21 Touring|M340i'], ['unknown model key', 'unknown'], ['no price entry', 'F70 Sports Hatch|M135x'],
  ['cheap model', 'U11 X1|20i'], ['dear model', 'G60 Saloon|520i'], ['M Power model', 'M Power|M2'], ['saloon model', 'G20 Saloon|320i']]) {
  rec(`eligibility ${label}`, { source: pv([stock(1, { eligibilityModelKey: fact(key) })]) });
}
rec('eligibility missing model fact', { source: pv([stock(1, { eligibilityModelKey: fact(null) })]) });
for (const grade of ['G1-6', 'G7', 'G8-10', 'G11-14']) {
  for (const key of ['G21 Touring|320i', 'G21 Touring|M340i', 'G60 Saloon|520i']) {
    rec(`grade ${grade} ${key}`, { context: ctx({ gradeId: grade }), source: pv([stock(1, { eligibilityModelKey: fact(key) })]) });
  }
}
rec('rr scheme grade PG1', { context: ctx({ companyId: 'demo-bmw-rr-production', schemeId: 'choices-rr-production', gradeId: 'PG1' }) });
for (const variant of ['allowance-1100', 'allowance-1099', 'allowance-0']) rec(`points vs allowance ${variant}`, { variant });
rec('points exactly equal allowance', { variant: 'allowance-1100' });
rec('points one above allowance', { variant: 'allowance-1099' });
rec('ambiguous price', { variant: 'price-ambiguous' });
rec('exclude overlap rule', { variant: 'exclude-overlap' });
for (const variant of ['bad-field', 'bad-precedence']) rec(`eligibility rule ${variant}`, { variant });
// Driver eligibility.
for (const [label, driver] of [['eligible', fact(true)], ['ineligible', fact(false)], ['unknown', fact(null)], ['wrong assurance', fact(true, null, 'derived')],
  ['model reference', fact(true, null, 'model-reference')], ['non boolean', fact('yes')], ['listing', fact(true, null, 'confirmed-listing')]]) {
  rec(`driver ${label}`, { source: { kind: 'value', value: withFacts({ driverEligible: driver })(providerValue()) } });
  rec(`driver ${label} not required`, { variant: 'driver-optional', source: { kind: 'value', value: withFacts({ driverEligible: driver })(providerValue()) } });
}
rec('driver missing', { source: { kind: 'value', value: (() => { const v = providerValue(); delete v.employeeFacts.driverEligible; return v; })() } });
rec('driver not-boolean policy', { variant: 'driver-not-boolean' });
// Timing and availability.
for (const state of ['available', 'held', 'allocated', 'unavailable', 'unknown']) rec(`availability ${state}`, { source: pv([stock(1, {}, 'RzIxOlMx', { state })]) });
rec('availability unsupported state', { source: pv([stock(1, {}, 'RzIxOlMx', { state: 'bogus' })]) });
rec('availability narrow policy held', { variant: 'availability-narrow', source: pv([stock(1, {}, 'RzIxOlMx', { state: 'held' })]) });
rec('availability invalid interval', { source: pv([stock(1, {}, 'RzIxOlMx', { availableFrom: '2026-12-01T00:00:00.000Z', availableUntil: '2026-11-20T00:00:00.000Z' })]) });
rec('availability equal interval', { source: pv([stock(1, {}, 'RzIxOlMx', { availableFrom: NOW, availableUntil: NOW })]) });
rec('availability expired', { source: pv([stock(1, {}, 'RzIxOlMx', { availableFrom: '2026-10-01T00:00:00.000Z', availableUntil: '2026-11-01T00:00:00.000Z' })]) });
rec('availability until equals now', { source: pv([stock(1, {}, 'RzIxOlMx', { availableFrom: '2026-10-01T00:00:00.000Z', availableUntil: NOW })]) });
rec('availability not yet', { source: pv([stock(1, {}, 'RzIxOlMx', { availableFrom: '2026-11-20T00:00:00.000Z', availableUntil: '2027-01-01T00:00:00.000Z' })]) });
for (const [label, patch] of [['bad from', { availableFrom: 'yesterday' }], ['bad until', { availableUntil: 'never' }], ['missing from', { availableFrom: undefined }],
  ['null until', { availableUntil: null }], ['offset from', { availableFrom: '2026-11-05T11:00:00+01:00' }],
  ['date only until', { availableUntil: '2027-01-01' }], ['feb 30 from', { availableFrom: '2026-02-30T00:00:00Z' }],
  ['short fraction', { availableFrom: '2026-11-05T12:00:00.5Z' }], ['hour 24', { availableUntil: '2027-01-01T24:00:00Z' }]]) {
  rec(`availability ${label}`, { source: pv([stock(1, {}, 'RzIxOlMx', patch)]) });
}
for (const [label, value] of [['met', '2026-12-01T00:00:00.000Z'], ['exceeded', '2026-11-05T11:59:59.999Z'], ['equals now', NOW], ['offset', '2026-12-01T00:00:00+01:00'],
  ['bad format', '2026-12-01 00:00:00'], ['null', null]]) {
  rec(`required by ${label}`, { source: { kind: 'value', value: withFacts({ requiredBy: fact(value) })(providerValue()) } });
}
rec('required by missing', { source: { kind: 'value', value: (() => { const v = providerValue(); delete v.employeeFacts.requiredBy; return v; })() } });
rec('required by derived assurance', { source: { kind: 'value', value: withFacts({ requiredBy: fact('2026-12-01T00:00:00.000Z', null, 'derived') })(providerValue()) } });
rec('required by earlier in brief', { request: brief({ requiredBy: '2026-11-20T00:00:00.000Z' }), source: pv([stock(1, {}, 'RzIxOlMx', { availableFrom: '2026-11-25T00:00:00.000Z' })]) });
rec('required by brief later than fact', { request: brief({ requiredBy: '2027-06-01T00:00:00.000Z' }) });
rec('required by brief before now', { request: brief({ requiredBy: '2026-11-01T00:00:00.000Z' }) });
rec('required by brief invalid', { request: brief({ requiredBy: '2026-13-01T00:00:00Z' }) });
rec('required by late availability', { source: pv([stock(1, {}, 'RzIxOlMx', { availableFrom: '2026-12-02T00:00:00.000Z' })]), request: brief({ requiredBy: '2026-12-20T00:00:00.000Z' }) });
rec('clock after availability', { clock: okClock({ now: '2027-01-01T00:00:00.000Z', clockVersion: 'clock-v2' }) });
rec('clock offset instant', { clock: okClock({ now: '2026-11-05T13:00:00+01:00' }) });
rec('clock short fraction', { clock: okClock({ now: '2026-11-05T12:00:00.5Z' }) });
rec('clock no fraction', { clock: okClock({ now: '2026-11-05T12:00:00Z' }) });
// Charging.
for (const [label, charging] of [['home', fact('home')], ['work', fact('work')], ['either', fact('either')], ['none', fact('none')], ['unknown', fact(null)],
  ['derived', fact('home', null, 'derived')], ['not-ready', fact('not-ready')]]) {
  for (const fuel of ['ev', 'phev', 'petrol']) {
    rec(`charging ${label} ${fuel}`, { source: { kind: 'value', value: withFacts({ charging })(providerValue([stock(1, { fuel: fact(fuel) })])) } });
  }
}
rec('charging missing fact', { source: { kind: 'value', value: (() => { const v = providerValue([stock(1, { fuel: fact('ev') })]); delete v.employeeFacts.charging; return v; })() } });
rec('charging not required policy', { variant: 'charging-optional', source: { kind: 'value', value: withFacts({ charging: fact('none') })(providerValue([stock(1, { fuel: fact('ev') })])) } });
rec('charging policy not boolean', { variant: 'charging-not-boolean' });
rec('fuel unknown fact required', { source: pv([stock(1, { fuel: fact(null) })]) });
rec('fuel unsupported', { source: pv([stock(1, { fuel: fact('unsupported') })]) });
// Essentials and facts.
for (const [label, facts] of [['wrong assurance', { seats: fact(5, 'count', 'derived') }], ['model reference', { seats: fact(5, 'count', 'model-reference') }],
  ['unknown seats', { seats: fact(null, 'count') }], ['small seats', { seats: fact(4, 'count') }], ['missing seats', { seats: undefined }]]) {
  rec(`facts ${label}`, { source: pv([stock(1, facts)]) });
}
rec('essential inferred', { request: brief({ essentials: { seats: { ...essential(5), state: 'inferred' } } }) });
rec('essential draft', { request: brief({ essentials: { seats: { ...essential(5), state: 'draft' } } }) });
rec('essential equipment includes', { request: brief({ essentials: { equipment: essential(['towbar'], 'includes', 'equipment-key') } }),
  source: pv([stock(1, { equipment: fact({ towbar: true }) }), stock(2, { equipment: fact({ towbar: false }) }), stock(3, { equipment: fact({}) }), stock(4)]) });
rec('essential zero seats', { request: brief({ essentials: { seats: essential(0) } }) });
const untouched = { value: null, operator: 'gte', unit: 'L', state: 'needs-confirmation', source: 'policy:brief.editor.v1' };
rec('essential untouched neutral', { request: brief({ essentials: { boot: untouched } }) });
rec('essential untouched explicit', { request: brief({ essentials: { boot: { ...untouched, source: 'employee' } } }) });
rec('essential need beyond boot', { request: brief({ essentials: { boot: essential(900, 'gte', 'L') } }) });
rec('provider essentials untouched', { request: brief({ essentials: { boot: untouched } }), source: { kind: 'value', value: withFacts({ essentials: { boot: untouched } })(providerValue()) } });
rec('provider essentials carrying seats', { request: brief({ essentials: {} }), source: { kind: 'value', value: withFacts({ essentials: { seats: essential(5) } })(providerValue([stock(1, { seats: fact(4, 'count') })])) } });
rec('provider essentials missing', { source: { kind: 'value', value: (() => { const v = providerValue(); delete v.employeeFacts.essentials; return v; })() } });
rec('provider essentials invalid', { source: { kind: 'value', value: withFacts({ essentials: { seats: { value: 5 } } })(providerValue()) } });
rec('provider essentials unknown key', { source: { kind: 'value', value: withFacts({ essentials: { nonsense: essential(5) } })(providerValue()) } });
rec('preference unconfirmed', { request: brief({ preferences: { body: { ...pref('saloon'), valueState: 'inferred' } } }) });
rec('preference indifferent', { request: brief({ preferences: { body: pref('estate', 0) } }) });
rec('preferences empty', { request: brief({ preferences: {}, essentials: {} }) });
rec('preference unselected editor', { request: brief({ preferences: { body: { ...pref('estate'), source: 'policy:brief.editor.v1', valueState: 'draft', importanceState: 'draft' } } }) });
for (const [dimension, desired, good, poor] of [['comfort', 100, { tags: fact(['cruiser']) }, { tags: fact(['drivers-car']) }], ['fuel', 'petrol', { fuel: fact('petrol') }, { fuel: fact('diesel') }],
  ['economy', 100, { mpg: fact(60, 'mpg-imperial') }, { mpg: fact(25, 'mpg-imperial') }], ['size', 100, { sizeClass: fact(1, 'ordinal-1-5') }, { sizeClass: fact(5, 'ordinal-1-5') }],
  ['sportiness', 100, { zeroTo62: fact(4, 's') }, { zeroTo62: fact(10, 's') }], ['body', ['estate', 'suv'], { body: fact('suv') }, { body: fact('saloon') }]]) {
  rec(`preference curve ${dimension}`, { request: brief({ preferences: { [dimension]: pref(desired) } }), source: pv([stock(1, poor), stock(2, good)]) });
}
// Ranking, ties, display limit and states.
const many = (n, mut = () => ({})) => Array.from({ length: n }, (_, i) => stock(i + 1, mut(i)));
rec('cap four cars', { source: pv(many(4)) });
rec('cap five cars', { source: pv(many(5)) });
for (const variant of ['display-1', 'display-2', 'display-10', 'display-0', 'display-fraction']) rec(`display ${variant}`, { variant, source: pv(many(4)) });
rec('no stock', { source: pv([]) });
rec('no viable stock', { source: pv([stock(1, { seats: fact(4, 'count') }), stock(2, { seats: fact(null, 'count') })]) });
rec('mixed viable', { source: pv([stock(1, { seats: fact(4, 'count') }), stock(2), stock(3, { eligibilityModelKey: fact('G21 Touring|M340i') }), stock(4)]) });
const mpgCars = () => [stock(5, { seats: fact(2, 'count') }), stock(3, { mpg: fact(25, 'mpg-imperial') }), stock(4, { mpg: fact(45, 'mpg-imperial') }), stock(2, { mpg: fact(60, 'mpg-imperial') }), stock(1, { mpg: fact(45, 'mpg-imperial') })];
const economy = { schemaVersion: 1, preferences: { economy: pref(100) }, essentials: { seats: essential(5) } };
rec('preview gallery order', { op: 'preview', input: { brief: economy, baseBriefVersion: 1, baseDraftVersion: 0 }, source: pv(mpgCars()) });
rec('stored keeps provider order', { request: { ...economy, briefVersion: 1 }, source: pv(mpgCars()) });
for (const variant of ['seed', 'ranking-0', 'ranking-4', 'ranking-5', 'ranking-100', 'ranking-4.999', 'no-ranking', 'bad-ranking-rule', 'bad-ranking-tolerance']) {
  rec(`ranking points ${variant}`, { variant, source: pv([stock(1, {}, 'points-test-low'), stock(2, {}, 'points-test-high'), stock(3, {}, 'points-test-mid')]) });
}
// points-test is its own seed variant (three configuration-keyed prices); the ranking variants above reuse the seed prices.
for (const variant of ['points-test']) {
  rec('ranking equal fit different points', { variant, source: pv([stock(1, {}, 'points-test-low'), stock(2, {}, 'points-test-high'), stock(3, {}, 'points-test-mid')]) });
  prev('ranking equal fit preview', { variant, source: pv([stock(1, {}, 'points-test-low'), stock(2, {}, 'points-test-high'), stock(3, {}, 'points-test-mid')]) });
}
const tiered = [stock(1, { body: fact('estate') }, 'RzIxOlMx'), stock(2, { body: fact('saloon'), eligibilityModelKey: fact('G20 Saloon|320i') }),
  stock(3, { body: fact('suv'), eligibilityModelKey: fact('U11 X1|20i') }), stock(4, { body: fact('estate'), eligibilityModelKey: fact('U11 X1|18d') }),
  stock(5, { body: fact('suv'), eligibilityModelKey: fact('G60 Saloon|520i') })];
for (const [label, preferences] of [['body one', { body: pref(['estate']) }], ['body two', { body: pref(['estate', 'suv']) }],
  ['body and economy', { body: pref('estate', 60), economy: pref(80, 40) }], ['all', { body: pref('estate'), economy: pref(70), sportiness: pref(60, 30), size: pref(50, 50), fuel: pref('petrol', 20), comfort: pref(30, 70) }]]) {
  for (const variant of ['seed', 'ranking-0', 'ranking-100', 'no-ranking']) rec(`tiers ${label} ${variant}`, { variant, request: brief({ preferences }), source: pv(tiered) });
}
rec('duplicate order uuid', { source: pv([stock(1), stock(1)]) });
rec('bad order uuid', { source: pv([{ ...stock(1), orderUuid: 'model-group' }]) });
rec('upper case uuid', { source: pv([{ ...stock(1), orderUuid: uuid(1).toUpperCase(), snapshot: { ...stock(1).snapshot, sourceKeys: { stockId: uuid(1).toUpperCase() } } }]) });
rec('vin bearing stock', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, vin: 'WBA12345678901234' } }]) });
rec('stock identity advert', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, identityKind: 'advert', sourceKeys: { advertId: 'a-1', stockId: uuid(1) } } }]) });
rec('stock identity mismatch', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, sourceKeys: { stockId: uuid(2) } } }]) });
rec('stock blank configuration', { source: pv([{ ...stock(1), configurationId: '  ' }]) });
rec('stock missing availability', { source: pv([{ ...stock(1), availability: undefined }]) });
rec('stock availability no version', { source: pv([{ ...stock(1), availability: { state: 'available' } }]) });
rec('stock null row', { source: pv([null]) });
rec('stock not array', { source: pv(null) });
rec('snapshot bad fact unit', { source: pv([stock(1, { seats: fact(5, 'people') })]) });
rec('snapshot negative boot', { source: pv([stock(1, { boot: fact(-5, 'L') })]) });
rec('snapshot fraction seats', { source: pv([stock(1, { seats: fact(4.5, 'count') })]) });
rec('snapshot size class range', { source: pv([stock(1, { sizeClass: fact(6, 'ordinal-1-5') })]) });
rec('snapshot isofix non boolean', { source: pv([stock(1, { frontIsofix: fact('yes') })]) });
rec('snapshot unknown with value', { source: pv([stock(1, { seats: { status: 'unknown', value: 5, unit: 'count', provenance: prov('unknown') } })]) });
rec('snapshot unknown known assurance', { source: pv([stock(1, { seats: { status: 'unknown', value: null, unit: 'count', provenance: prov('derived') } })]) });
rec('snapshot bad assurance', { source: pv([stock(1, { body: { ...fact('estate'), provenance: prov('guessed') } })]) });
rec('snapshot provenance date offset', { source: pv([stock(1, { body: { ...fact('estate'), provenance: prov('synthetic-scenario', { observedAt: '2026-11-05T12:00:00+01:00' }) } })]) });
rec('snapshot provenance short fraction', { source: pv([stock(1, { body: { ...fact('estate'), provenance: prov('synthetic-scenario', { observedAt: '2026-11-05T12:00:00.5Z' }) } })]) });
rec('snapshot provenance no fraction', { source: pv([stock(1, { body: { ...fact('estate'), provenance: prov('synthetic-scenario', { observedAt: '2026-11-05T12:00:00Z' }) } })]) });
rec('snapshot extra display key', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, display: { name: 'x', trim: 'y' } } }]) });
rec('snapshot full display', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, display: { name: 'Full', manufacturer: 'BMW', model: '3', derivative: '320i', photo: 'p.jpg', images: ['a', 'b'], link: 'l', colour: 'red' } } }]) });
rec('snapshot unicode name', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, display: { name: 'Zoë – 3 Series £' } } }]) });
rec('snapshot numeric stock key', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, sourceKeys: { stockId: uuid(1), modelGroupId: 12 } } }]) });
rec('snapshot bad source key', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, sourceKeys: { stockId: uuid(1), modelGroupId: 1.5 } } }]) });
rec('snapshot wrong contract', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, contractVersion: 'v2' } }]) });
rec('snapshot given candidate key', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, contractVersion: 'vehicle-snapshot-v1', candidateKey: `fixture%3Aemployee:exact-stock:${uuid(1)}` } }]) });
rec('snapshot wrong candidate key', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, candidateKey: 'nope' } }]) });
rec('snapshot encoded namespace', { source: pv([{ ...stock(1), snapshot: { ...stock(1).snapshot, sourceNamespace: 'fixture é/ä 日本 😀' } }]) });
rec('snapshot object fact value', { source: pv([stock(1, { equipment: fact({ b: 1, a: { z: 1, y: [1, 2] } }) })]) });
rec('snapshot integer keys fact', { source: pv([stock(1, { equipment: fact({ b: true, 2: true, 1: false }) })]) });
rec('provider missing facts version', { source: { kind: 'value', value: providerValue([stock()], { factsVersion: '' }) } });
rec('provider missing employee facts', { source: { kind: 'value', value: (() => { const v = providerValue(); delete v.employeeFacts; return v; })() } });
rec('provider employee facts array', { source: { kind: 'value', value: providerValue([stock()], { employeeFacts: [] }) } });
rec('provider null value', { source: { kind: 'raw', outcome: { status: 'ok', value: null } } });
rec('provider value missing', { source: { kind: 'raw', outcome: { status: 'ok' } } });
// Refusals, context and ports.
for (const patch of [{ runId: 'old' }, { environmentId: 'other' }, { employeeId: 'other' }]) rec(`provider mismatch ${Object.keys(patch)[0]}`, { source: pv([stock()], patch) });
rec('provider unavailable', { source: { kind: 'raw', outcome: { status: 'unavailable' } } });
rec('provider stale run', { source: { kind: 'raw', outcome: { status: 'stale-run', reason: 'Old run' } } });
rec('provider forbidden', { source: { kind: 'raw', outcome: { status: 'forbidden', reason: 'No' } } });
rec('provider throws', { source: { kind: 'throw' } });
rec('provider returns undefined', { source: { kind: 'undefined' } });
rec('provider not configured', { missing: ['provider'] });
rec('policy not configured', { missing: ['policy'] });
rec('clock not configured', { missing: ['clock'] });
rec('clock stale', { clock: { kind: 'raw', outcome: { status: 'stale-run', reason: 'Old run' } } });
rec('clock unavailable', { clock: { kind: 'raw', outcome: { status: 'unavailable' } } });
rec('clock throws', { clock: { kind: 'throw' } });
rec('clock undefined', { clock: { kind: 'undefined' } });
rec('clock run mismatch', { clock: okClock({ runId: 'retired' }) });
rec('clock invalid instant', { clock: okClock({ now: 'noon' }) });
rec('clock no version', { clock: okClock({ clockVersion: ' ' }) });
for (const patch of [{ schemeId: 'unknown' }, { gradeId: 'unknown' }, { companyId: 'unknown' }, { companyId: 'demo-bmw-rr-production' }]) rec(`context ${Object.keys(patch)[0]} ${patch[Object.keys(patch)[0]]}`, { context: ctx(patch) });
for (const roles of [['greg'], [], ['employee', 'greg']]) rec(`roles ${roles.join('+') || 'none'}`, { context: ctx({ roles }) });
rec('context undefined', { context: undefined });
rec('context null', { context: null });
for (const key of ['runId', 'environmentId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'policyVersion']) {
  rec(`context missing ${key}`, { context: Object.fromEntries(Object.entries(baseContext).filter(([name]) => name !== key)) });
  rec(`context blank ${key}`, { context: ctx({ [key]: '   ' }) });
}
rec('context policy version unknown', { context: ctx({ policyVersion: 'unknown' }) });
rec('context run mismatch policy read', { context: ctx({ runId: 'other-run' }), clock: okClock({ runId: 'other-run' }), source: pv([stock()], { runId: 'other-run' }) });
for (const key of ['employeeId', 'gradeId', 'policyVersion', 'quotes', 'availability', 'profile', 'scenarioId', 'retailBudgetEnabled', 'inferred', 'steering', 'limit', 'currentCar', 'baseline']) {
  rec(`request whitelist ${key}`, { request: { ...brief(), [key]: 'hostile' } });
}
for (const [label, patch] of [['schema 2', { schemaVersion: 2 }], ['version 0', { briefVersion: 0 }], ['version fraction', { briefVersion: 1.5 }], ['version string', { briefVersion: '1' }],
  ['unknown preference', { preferences: { unknown: pref(50) } }], ['slider 101', { preferences: { sportiness: pref(101) } }], ['slider fraction', { preferences: { sportiness: pref(50.5) } }],
  ['bad operator', { essentials: { seats: { ...essential(5), operator: 'drop' } } }], ['constructor key', { preferences: JSON.parse('{"constructor":{"value":50,"importance":100,"valueState":"confirmed","importanceState":"confirmed","source":"employee"}}') }],
  ['bad choice', { preferences: { body: pref('spaceship') } }], ['unordered choices', { preferences: { body: pref(['suv', 'estate']) } }], ['preferences array', { preferences: [] }],
  ['confirmedAt bad', { preferences: { body: { ...pref('estate'), confirmedAt: 'now' } } }], ['confirmedAt ok', { preferences: { body: { ...pref('estate'), confirmedAt: NOW } } }]]) {
  rec(`brief invalid ${label}`, { request: brief(patch) });
}
rec('request null', { request: null });
rec('request array', { request: [] });
rec('request without version', { request: { schemaVersion: 1, preferences: {}, essentials: {} } });
// Policy variants that break configuration.
for (const variant of ['no-calibration', 'slider-conflict', 'slider-minimum', 'retail-budget-on', 'no-preferences', 'malformed', 'missing-file', 'assurances-build-only', 'terms-tiny', 'terms-fraction', 'terms-huge', 'terms-zero']) {
  rec(`policy variant ${variant}`, { variant });
}
for (const mode of ['skew-all', 'skew-eligibility', 'skew-points', 'skew-assumption', 'skew-allowance']) rec(`policy wrap ${mode}`, { wrap: mode });
// Policy activation: a pinned context against a successor policy, read before and after it takes effect.
for (const [label, now] of [['before', '2026-11-05T12:00:00.000Z'], ['at', '2026-11-06T00:00:00.000Z'], ['after', '2026-11-07T12:00:00.000Z']]) {
  for (const pin of ['gcsp-policy-v1', 'gcsp-policy-v2']) {
    rec(`activation ${label} pinned ${pin}`, { variant: 'successor', context: ctx({ policyVersion: pin }), clock: okClock({ now }), source: pv(many(4)) });
    prev(`activation ${label} pinned ${pin} preview`, { variant: 'successor', context: ctx({ policyVersion: pin }), clock: okClock({ now }), source: pv(many(4)) });
  }
}
rec('activation unknown pin', { variant: 'successor', context: ctx({ policyVersion: 'gcsp-policy-v9' }) });
rec('activation successor grades', { variant: 'successor', context: ctx({ policyVersion: 'gcsp-policy-v2', gradeId: 'G8-10' }), clock: okClock({ now: '2026-11-07T12:00:00.000Z' }) });
rec('activation retained and invalid', { variant: 'malformed', context: ctx({ policyVersion: 'gcsp-policy-v2' }) });
// Stored subject.
const subjectOf = (patch = {}) => { const { roles, ...rest } = baseContext; return { ...rest, ...patch }; };
const stored = (name, spec = {}) => add(name, { op: 'stored', subject: subjectOf(), brief: brief(), source: { kind: 'value', value: providerValue() }, context: undefined, ...spec });
stored('stored default');
stored('stored with feedback', { brief: { ...brief(), currentCarRating: rating(5) }, source: { kind: 'value', value: { ...providerValue(), currentCar: currentCar() } } });
for (const key of ['runId', 'environmentId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'policyVersion']) {
  stored(`stored missing ${key}`, { subject: Object.fromEntries(Object.entries(subjectOf()).filter(([name]) => name !== key)) });
  stored(`stored blank ${key}`, { subject: subjectOf({ [key]: ' ' }) });
}
for (const key of ['roles', 'session', 'token', 'principalId', 'entitlementSlotId', 'provider', 'confirmed', 'clock']) stored(`stored extra ${key}`, { subject: { ...subjectOf(), [key]: 'override' } });
stored('stored subject null', { subject: null });
stored('stored subject array', { subject: [] });
stored('stored subject empty', { subject: {} });
stored('stored policy mismatch', { wrap: 'skew-all' });
stored('stored policy unknown pin', { subject: subjectOf({ policyVersion: 'unknown' }) });
stored('stored pinned v1 after successor', { variant: 'successor', clock: okClock({ now: '2026-11-07T12:00:00.000Z' }) });
stored('stored pinned v2', { variant: 'successor', subject: subjectOf({ policyVersion: 'gcsp-policy-v2' }), clock: okClock({ now: '2026-11-07T12:00:00.000Z' }) });
for (const field of ['runId', 'environmentId', 'employeeId']) stored(`stored provider ${field}`, { source: pv([stock()], { [field]: 'another' }) });
stored('stored provider empty object', { source: { kind: 'value', value: {} } });
stored('stored clock stale', { clock: { kind: 'raw', outcome: { status: 'stale-run' } } });
stored('stored clock mismatch', { clock: okClock({ runId: 'retired-run' }) });
stored('stored clock unavailable', { clock: { kind: 'raw', outcome: { status: 'unavailable' } } });
stored('stored provider throws', { source: { kind: 'throw' } });
stored('stored provider missing', { missing: ['provider'] });
stored('stored policy missing', { missing: ['policy'] });
stored('stored clock missing', { missing: ['clock'] });
stored('stored brief preview field', { brief: { ...brief(), preview: { approved: true } } });
stored('stored brief version zero', { brief: brief({ briefVersion: 0 }) });
stored('stored brief draft essential', { brief: brief({ essentials: { seats: { ...essential(5), state: 'draft' } } }) });
stored('stored brief undefined', { brief: undefined });
stored('stored small seats', { brief: brief({ essentials: { seats: essential(9) } }) });
stored('stored stale charging', { source: { kind: 'value', value: withFacts({ charging: fact('none') })(providerValue([stock(1, { fuel: fact('ev') })])) } });
stored('stored no stock', { source: pv([]) });
stored('stored allowance lowered', { variant: 'allowance-1099' });
// Frozen current-car context.
const FB_CARS = () => [stock(1, { modelLine: fact('G21 Touring') }),
  stock(2, { modelLine: fact('G20 Saloon'), eligibilityModelKey: fact('G20 Saloon|320i'), body: fact('saloon') }), stock(3, {}),
  stock(4, { modelLine: fact('U11 X1'), eligibilityModelKey: fact('U11 X1|20i'), body: fact('suv'), zeroTo62: fact(5, 's') }),
  stock(5, { modelLine: fact('G21 Touring'), seats: fact(4, 'count') })];
const fbBrief = (extra = {}, patch = {}) => ({ ...brief(), preferences: { sportiness: pref(80) }, ...patch, ...extra });
const fbSource = (value = providerValue(FB_CARS()), baseline = currentCar()) => ({ kind: 'value', value: baseline === null ? value : { ...value, currentCar: baseline } });
const feedbackVariants = ['seed', 'no-feedback-policy', 'bad-feedback-policy', 'feedback-thresholds', 'feedback-lenient-same', 'feedback-improvement-two'];
rec('feedback plain without typed', { request: fbBrief(), source: fbSource() });
for (const variant of feedbackVariants) {
  for (const value of [1, 2, 3, 4, 5, null]) rec(`feedback rating ${value} ${variant}`, { variant, request: fbBrief({ currentCarRating: rating(value) }), source: fbSource() });
  for (const on of [true, false]) rec(`feedback same again ${on} ${variant}`, { variant, request: fbBrief({ sameAgain: sameAgain(on) }), source: fbSource() });
  rec(`feedback both ${variant}`, { variant, request: fbBrief({ currentCarRating: rating(1), sameAgain: sameAgain(true) }), source: fbSource() });
  rec(`feedback both released ${variant}`, { variant, request: fbBrief({ currentCarRating: rating(1), sameAgain: sameAgain(false) }), source: fbSource() });
}
rec('feedback no baseline rating 5', { request: fbBrief({ currentCarRating: rating(5) }), source: fbSource(providerValue(FB_CARS()), null) });
rec('feedback no baseline rating 1', { request: fbBrief({ currentCarRating: rating(1) }), source: fbSource(providerValue(FB_CARS()), null) });
rec('feedback no baseline same again', { request: fbBrief({ sameAgain: sameAgain(true) }), source: fbSource(providerValue(FB_CARS()), null) });
rec('feedback no baseline same again off', { request: fbBrief({ sameAgain: sameAgain(false) }), source: fbSource(providerValue(FB_CARS()), null) });
rec('feedback garbage baseline', { request: fbBrief({ currentCarRating: rating(1) }), source: fbSource(providerValue(FB_CARS()), { contractId: 'current:employee-test' }) });
rec('feedback contract mismatch', { request: fbBrief({ currentCarRating: rating(1, 'current:other'), sameAgain: sameAgain(true, 'current:other') }), source: fbSource() });
rec('feedback half mismatch', { request: fbBrief({ currentCarRating: rating(1), sameAgain: sameAgain(true, 'current:other') }), source: fbSource() });
rec('feedback mismatch rating only', { request: fbBrief({ currentCarRating: rating(5, 'current:other') }), source: fbSource() });
for (const [label, patch] of [['extra field', { currentCarRating: { ...rating(5), extra: 1 } }], ['rating 6', { currentCarRating: rating(6) }], ['rating 0', { currentCarRating: rating(0) }],
  ['rating fraction', { currentCarRating: rating(2.5) }], ['bad source', { currentCarRating: { ...rating(5), source: 'greg' } }], ['same again string', { sameAgain: { ...sameAgain(true), on: 'yes' } }],
  ['same again short', { sameAgain: { on: true } }], ['rating null object', { currentCarRating: null }], ['bad ratedAt', { currentCarRating: { ...rating(5), ratedAt: 'now' } }],
  ['long contract', { currentCarRating: rating(5, 'x'.repeat(129)) }], ['blank contract', { sameAgain: sameAgain(true, '  ') }]]) {
  rec(`feedback invalid ${label}`, { request: fbBrief(patch), source: fbSource() });
}
rec('feedback baseline without body', { request: fbBrief({ currentCarRating: rating(1) }), source: fbSource(providerValue([stock(1, { modelLine: fact('G21 Touring') })]), currentCar({ modelLine: 'G21 Touring', fuel: 'petrol' })) });
rec('feedback unconfirmed similarity', { request: fbBrief({ currentCarRating: rating(5) }), source: fbSource(providerValue([stock(1, { modelLine: { ...fact('G21 Touring', null, 'model-reference') } })])) });
rec('feedback different fuel', { request: fbBrief({ currentCarRating: rating(1) }), source: fbSource(providerValue([stock(1, { modelLine: fact('G21 Touring'), fuel: fact('diesel') })])) });
rec('feedback improvement fast', { request: fbBrief({ currentCarRating: rating(5) }), source: fbSource(providerValue([stock(4, { modelLine: fact('U11 X1'), eligibilityModelKey: fact('U11 X1|20i'), body: fact('suv'), zeroTo62: fact(4, 's') })])) });
rec('feedback improvement slower', { request: fbBrief({ currentCarRating: rating(5) }), source: fbSource(providerValue([stock(4, { modelLine: fact('U11 X1'), eligibilityModelKey: fact('U11 X1|20i'), body: fact('suv'), zeroTo62: fact(11, 's') })])) });
rec('feedback improvement not expressed', { request: brief({ preferences: { body: pref('estate') }, currentCarRating: rating(5) }), source: fbSource(providerValue([stock(4, { modelLine: fact('U11 X1'), eligibilityModelKey: fact('U11 X1|20i'), body: fact('suv'), zeroTo62: fact(4, 's') })])) });
rec('feedback improvement no speed baseline', { request: fbBrief({ currentCarRating: rating(5) }), source: fbSource(providerValue([stock(4, { modelLine: fact('U11 X1'), eligibilityModelKey: fact('U11 X1|20i'), body: fact('suv'), zeroTo62: fact(4, 's') })]), currentCar({ modelLine: 'G21 Touring', body: 'estate', fuel: 'petrol' })) });
rec('feedback improvement mixed', { request: fbBrief({ currentCarRating: rating(5) }, { preferences: { sportiness: pref(80), size: pref(60) } }), source: fbSource(providerValue([stock(4, { modelLine: fact('U11 X1'), body: fact('suv'), zeroTo62: fact(4, 's'), sizeClass: fact(1, 'ordinal-1-5') })]), currentCar({ modelLine: 'G21 Touring', body: 'estate', fuel: 'petrol', zeroTo62: 7.6, sizeClass: 3 })) });
rec('feedback generated stock hatch proven', { request: brief({ preferences: { body: pref('hatchback'), fuel: pref('petrol', 50) }, currentCarRating: rating(5) }),
  source: fbSource(providerValue([stock(6, { modelLine: fact('F70 Sports Hatch'), eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatchback'), zeroTo62: fact(null, 's'), mpg: fact(null, 'mpg-imperial') })])) });
rec('feedback generated stock sporty unknown', { request: brief({ preferences: { body: pref(['hatchback', 'estate', 'suv']), fuel: pref('petrol', 50), sportiness: pref(100, 50) }, currentCarRating: rating(5) }),
  source: fbSource(providerValue([stock(6, { modelLine: fact('F70 Sports Hatch'), eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatchback'), zeroTo62: fact(null, 's'), mpg: fact(null, 'mpg-imperial') })])) });
const mix = [stock(1, { modelLine: fact('G21 Touring') }), stock(2, { body: fact('suv') }), stock(3, { body: fact('saloon') })];
for (const choice of [['estate'], ['estate', 'suv'], ['hatchback', 'saloon', 'estate', 'suv']]) rec(`feedback body choices ${choice.length}`, { request: brief({ preferences: { body: pref(choice) }, currentCarRating: rating(5) }), source: fbSource(providerValue(mix)) });
const failing = [stock(1, { modelLine: fact('G21 Touring'), seats: fact(4, 'count') }), stock(2, { modelLine: fact('G21 Touring'), boot: fact(300, 'L') }),
  stock(3, { modelLine: fact('G21 Touring'), eligibilityModelKey: fact('G21 Touring|M340i') }), stock(4, { modelLine: fact('G21 Touring'), fuel: fact('ev') }),
  stock(5, { modelLine: fact('G21 Touring'), eligibilityModelKey: fact('G21 Touring|320i') })];
for (const [label, patch] of [['rating', { currentCarRating: rating(5) }], ['same again', { sameAgain: sameAgain(true) }], ['both', { currentCarRating: rating(5), sameAgain: sameAgain(true) }]]) {
  rec(`feedback gates first ${label}`, { request: { ...fbBrief(patch), essentials: { seats: essential(5), boot: essential(400, 'gte', 'L') } },
    source: fbSource(withFacts({ charging: fact('none') })(providerValue(failing))) });
}
rec('feedback gates first points', { variant: 'allowance-0', request: fbBrief({ sameAgain: sameAgain(true) }), source: fbSource(providerValue([stock(1, { modelLine: fact('G21 Touring') })])) });
rec('feedback same again unknown model', { request: fbBrief({ sameAgain: sameAgain(true) }), source: fbSource(providerValue([stock(1, { eligibilityModelKey: fact(null) })])) });
rec('feedback same again bad configuration', { request: fbBrief({ sameAgain: sameAgain(true) }), source: fbSource(providerValue([stock(1, {}, 'not-base64')])) });
rec('feedback same again non canonical configuration', { request: fbBrief({ sameAgain: sameAgain(true) }), source: fbSource(providerValue([stock(1, {}, 'RzIxOlMx'), stock(2, {}, 'RzIxOlMy')]), currentCar({ ...baselineFacts, configurationId: 'RzIxOlMy' })) });
rec('feedback baseline bad configuration id', { request: fbBrief({ sameAgain: sameAgain(true) }), source: fbSource(providerValue(FB_CARS()), currentCar({ ...baselineFacts, configurationId: 'garbage' })) });
rec('feedback old brief never reads policy', { variant: 'no-feedback-policy', request: fbBrief(), source: fbSource() });
const NODE_FEEDBACK_PREVIEW = { currentCarRating: rating(1), sameAgain: sameAgain(true) };
prev('feedback preview both', { input: previewInput({ ...NODE_FEEDBACK_PREVIEW, preferences: { sportiness: pref(80) } }), source: fbSource() });
prev('feedback preview rating', { input: previewInput({ currentCarRating: rating(4), preferences: { sportiness: pref(80) } }), source: fbSource() });
prev('feedback preview typed none', { input: previewInput({ preferences: { sportiness: pref(80) } }), source: fbSource() });
rec('feedback stored versus preview base', { request: fbBrief(NODE_FEEDBACK_PREVIEW), source: fbSource() });
stored('feedback stored subject', { brief: fbBrief(NODE_FEEDBACK_PREVIEW), source: fbSource() });
// Preview.
prev('preview default');
prev('preview draft promoted', { input: previewInput({ preferences: { body: { ...pref('estate'), valueState: 'draft', importanceState: 'draft' } }, essentials: { seats: { ...essential(5), state: 'draft' } } }) });
prev('preview draft non employee', { input: previewInput({ preferences: { body: { ...pref('estate'), source: 'policy:brief.editor.v1', valueState: 'draft', importanceState: 'draft' } } }) });
for (const [label, charging] of [['confirmed', { value: 'home', operator: 'equals', unit: null, state: 'confirmed', source: 'employee' }],
  ['draft employee', { value: 'work', operator: 'equals', unit: null, state: 'draft', source: 'employee' }], ['draft policy', { value: 'home', operator: 'equals', unit: null, state: 'draft', source: 'policy:brief.editor.v1' }],
  ['none', { value: 'not-ready', operator: 'equals', unit: null, state: 'confirmed', source: 'employee' }], ['null value', { value: null, operator: 'equals', unit: null, state: 'confirmed', source: 'employee' }],
  ['untouched', { value: null, operator: 'equals', unit: null, state: 'needs-confirmation', source: 'policy:brief.editor.v1' }], ['inferred', { value: 'home', operator: 'equals', unit: null, state: 'inferred', source: 'employee' }]]) {
  for (const fuel of ['ev', 'petrol']) {
    prev(`preview charging ${label} ${fuel}`, { input: previewInput({ essentials: { seats: essential(5), charging } }), source: pv([stock(1, { fuel: fact(fuel) })]) });
  }
}
prev('preview charging invalid value', { input: previewInput({ essentials: { seats: essential(5), charging: { value: 'solar', operator: 'equals', unit: null, state: 'confirmed', source: 'employee' } } }) });
prev('preview no lifecycle policy', { variant: 'no-lifecycle', input: previewInput({ essentials: { seats: essential(5), charging: { value: 'home', operator: 'equals', unit: null, state: 'confirmed', source: 'employee' } } }) });
prev('preview lifecycle bad', { variant: 'lifecycle-bad' });
prev('preview lifecycle other charging', { variant: 'lifecycle-charging-other', input: previewInput({ essentials: { seats: essential(5), charging: { value: 'solar', operator: 'equals', unit: null, state: 'confirmed', source: 'employee' } } }) });
prev('preview base version zero', { input: { ...previewInput(), baseBriefVersion: 0 } });
prev('preview draft version', { input: { ...previewInput(), baseDraftVersion: 7 }, source: pv([stock(1, { fuel: fact('ev') })]) });
for (const [label, input] of [['extra key', { ...previewInput(), subject: {} }], ['negative base', { ...previewInput(), baseBriefVersion: -1 }], ['fraction base', { ...previewInput(), baseDraftVersion: 0.5 }],
  ['string base', { ...previewInput(), baseBriefVersion: '1' }], ['no brief', { baseBriefVersion: 1, baseDraftVersion: 0 }], ['brief schema 2', previewInput({ schemaVersion: 2 })],
  ['brief extra key', previewInput({ briefVersion: 1 })], ['brief array', { ...previewInput(), brief: [] }], ['bad rating', previewInput({ currentCarRating: rating(9) })],
  ['bad same again', previewInput({ sameAgain: { on: 1 } })], ['with feedback key', previewInput({ currentCarFeedback: { anything: true } })], ['null input', null], ['array input', []],
  ['essentials null', previewInput({ essentials: null })], ['essentials string', previewInput({ essentials: 'abc' })], ['essentials missing', (() => { const i = previewInput(); delete i.brief.essentials; return i; })()],
  ['essentials number', previewInput({ essentials: 5 })], ['preferences invalid', previewInput({ preferences: { body: pref('spaceship') } })], ['requiredBy', previewInput({ requiredBy: '2026-11-20T00:00:00.000Z' })]]) {
  prev(`preview invalid ${label}`, { input });
}
prev('preview invalid with brief keys', { input: { brief: { schemaVersion: 1, preferences: {}, essentials: {} }, baseBriefVersion: 1, baseDraftVersion: 0, extra: true } });
prev('preview forbidden', { context: ctx({ roles: ['greg'] }) });
prev('preview not configured', { missing: ['provider'] });
prev('preview stale clock', { clock: { kind: 'raw', outcome: { status: 'stale-run' } } });
prev('preview unavailable provider', { source: { kind: 'throw' } });
prev('preview context blank', { context: ctx({ gradeId: '' }) });
prev('preview unknown scheme', { context: ctx({ schemeId: 'nope' }) });
prev('preview no stock', { source: pv([]) });
prev('preview mixed', { source: pv(mpgCars()), input: { brief: economy, baseBriefVersion: 1, baseDraftVersion: 0 } });

// ---- randomised stock pools -----------------------------------------------------------------------------
let state = 0x1f2e3d4c;
const rnd = () => { state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (list) => list[int(0, list.length - 1)];
const chance = (p) => rnd() < p;
const priceKeys = seed.pricePlans.filter((row) => row.schemeId === 'choices-fs-uk').map((row) => row.matchValue);
const configs = ['RzIxOlMx', 'RzIwOlMyLFMz', 'VTExOkEx', 'RjcwOlMx'];
const fuels = ['petrol', 'diesel', 'phev', 'ev', 'petrol', 'petrol'];
const bodies = ['hatchback', 'saloon', 'estate', 'suv', 'coupe', 'convertible', 'mpv'];
const randomFact = (value, unit, assurances = ['synthetic-scenario']) => chance(0.07) ? fact(null, unit) : fact(value, unit, chance(0.06) ? 'derived' : pick(assurances));
const randomCar = (id) => {
  const key = chance(0.04) ? 'unknown' : pick(priceKeys);
  const facts = { eligibilityModelKey: chance(0.04) ? fact(null) : fact(key), modelLine: fact(key.split('|')[0]), body: randomFact(pick(bodies), null), fuel: randomFact(pick(fuels), null),
    seats: randomFact(int(2, 7), 'count'), boot: randomFact(int(200, 700), 'L'), zeroTo62: randomFact(Math.round((4 + rnd() * 8) * 10) / 10, 's'),
    mpg: randomFact(Math.round((20 + rnd() * 60) * 10) / 10, 'mpg-imperial'), sizeClass: randomFact(int(1, 5), 'ordinal-1-5'),
    tags: randomFact(['cruiser', 'drivers-car', 'urban', 'family'].filter(() => chance(0.5)), null) };
  if (chance(0.1)) facts.equipment = fact({ towbar: chance(0.5), heatedSeats: chance(0.5) });
  const availability = {};
  const roll = rnd();
  if (roll < 0.12) availability.state = pick(['held', 'unknown', 'allocated', 'unavailable']);
  if (chance(0.08)) availability.availableFrom = `2026-11-${String(int(1, 28)).padStart(2, '0')}T00:00:00.000Z`;
  if (chance(0.08)) availability.availableUntil = `2026-11-${String(int(3, 28)).padStart(2, '0')}T00:00:00.000Z`;
  return stock(id, facts, pick(configs), availability);
};
const randomBrief = () => {
  const preferences = {};
  if (chance(0.7)) preferences.body = pref(chance(0.3) ? bodies.filter((_, i) => i % 3 === 0 && chance(0.7)).concat('estate').filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => bodies.indexOf(a) - bodies.indexOf(b)) : pick(bodies), pick([0, 50, 100]));
  if (chance(0.5)) preferences.fuel = pref(pick(['petrol', 'diesel', 'phev', 'ev']), pick([0, 25, 100]));
  for (const key of ['sportiness', 'comfort', 'economy', 'size']) if (chance(0.45)) preferences[key] = chance(0.1) ? { ...pref(int(0, 100), int(1, 100)), valueState: 'inferred' } : pref(int(0, 100), pick([0, 10, 50, 75, 100]));
  const essentials = {};
  if (chance(0.7)) essentials.seats = essential(int(2, 7));
  if (chance(0.4)) essentials.boot = essential(int(200, 700), 'gte', 'L');
  if (chance(0.15)) essentials.equipment = essential(['towbar'], 'includes', 'equipment-key');
  if (chance(0.1)) essentials.body = essential(pick(bodies), 'equals', null);
  return brief({ preferences, essentials, ...(chance(0.1) ? { requiredBy: `2026-11-${String(int(6, 28)).padStart(2, '0')}T00:00:00.000Z` } : {}) });
};
const randomVariants = ['seed', 'seed', 'seed', 'ranking-0', 'ranking-4', 'ranking-100', 'no-ranking', 'display-1', 'display-2', 'driver-optional', 'allowance-1100', 'allowance-0', 'successor'];
for (let n = 0; n < 100; n += 1) {
  const cars = Array.from({ length: int(1, 8) }, (_, i) => randomCar(i + 1));
  const employee = { driverEligible: chance(0.1) ? fact(chance(0.5) ? false : null) : fact(true), essentials: {}, charging: fact(pick(['home', 'home', 'work', 'either', 'none', null]), null, chance(0.1) ? 'derived' : 'synthetic-scenario'),
    annualMileage: fact(12000, 'mi/year'), requiredBy: chance(0.1) ? fact(null) : fact(`2026-11-${String(int(8, 28)).padStart(2, '0')}T00:00:00.000Z`) };
  const feedback = chance(0.3);
  const value = { ...providerValue(cars), employeeFacts: employee, ...(feedback ? { currentCar: currentCar({ ...baselineFacts, body: pick(bodies), fuel: pick(fuels), modelLine: pick(['G21 Touring', 'G20 Saloon', 'U11 X1']) }) } : {}) };
  const request = randomBrief();
  if (feedback) { if (chance(0.7)) request.currentCarRating = rating(int(1, 5)); if (chance(0.4)) request.sameAgain = sameAgain(chance(0.7)); }
  const variant = pick(randomVariants);
  const context = ctx({ gradeId: pick(['G1-6', 'G7', 'G7', 'G8-10', 'G11-14']), ...(variant === 'successor' ? { policyVersion: pick(['gcsp-policy-v1', 'gcsp-policy-v2']) } : {}) });
  const clock = okClock(variant === 'successor' ? { now: pick(['2026-11-05T12:00:00.000Z', '2026-11-07T12:00:00.000Z']) } : {});
  if (chance(0.15)) {
    const { briefVersion, ...content } = request;
    add(`random preview ${n}`, { variant, context, clock, op: 'preview', input: { brief: content, baseBriefVersion: briefVersion, baseDraftVersion: int(0, 3) }, source: { kind: 'value', value } });
  } else add(`random recommend ${n}`, { variant, context, clock, request, source: { kind: 'value', value } });
}

// ---- run Node, then pack ---------------------------------------------------------------------------------
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const counts = new Map();
for (const entry of cases) {
  const result = await runNode(entry);
  entry.expected = JSON.parse(JSON.stringify(result));
  for (const decision of entry.expected.value?.decisions ?? []) {
    decision.evidence.assumptions = decision.evidence.assumptions.map((row) => ({ $sha256: createHash('sha256').update(canonical(row)).digest('hex') }));
  }
}
const statuses = {};
for (const entry of cases) statuses[entry.expected.status] = (statuses[entry.expected.status] ?? 0) + 1;

// Large repeated subtrees (snapshots, facts, evidence) move into one shared pool, expanded by the Java test.
const MIN = 220;
const keyOf = (value) => JSON.stringify(value);
function count(value) {
  if (!value || typeof value !== 'object') return;
  const key = keyOf(value);
  if (key.length >= MIN) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const inner of Object.values(value)) count(inner);
}
const body = (entry) => ({ source: entry.source, request: entry.request, input: entry.input, subject: entry.subject, brief: entry.brief, expected: entry.expected });
counts.clear();
for (const entry of cases) count(body(entry));
const pool = []; const ids = new Map();
function pack(value, top = false) {
  if (!value || typeof value !== 'object') return value;
  const key = keyOf(value);
  if (!top && (counts.get(key) ?? 0) >= 2) {
    if (!ids.has(key)) { ids.set(key, -1); const inner = Array.isArray(value) ? value.map((v) => pack(v)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pack(v)])); ids.set(key, pool.length); pool.push(inner); }
    return { $pool: ids.get(key) };
  }
  return Array.isArray(value) ? value.map((v) => pack(v)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pack(v)]));
}
const packed = cases.map((entry) => {
  const { source, request, input, subject, brief: storedBrief, expected, ...rest } = entry;
  return { ...rest, ...(source === undefined ? {} : { source: pack(source) }), ...(request === undefined ? {} : { request: pack(request) }),
    ...(input === undefined ? {} : { input: pack(input) }), ...(subject === undefined ? {} : { subject: pack(subject) }),
    ...(storedBrief === undefined ? {} : { brief: pack(storedBrief) }), expected: pack(expected) };
});
const text = JSON.stringify({ pool, cases: packed });
await writeFile(outPath, `${text}\n`);
await rm(scratch, { recursive: true, force: true });
console.log(`wrote ${cases.length} cases, ${pool.length} pooled values, ${(text.length / 1048576).toFixed(2)} MiB to ${outPath}`);
console.log(`statuses ${JSON.stringify(statuses)}`);
