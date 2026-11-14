// Offline generator for src/test/resources/learning-parity/cases.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/learning-parity.mjs
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolicyService } from '../../../../../server/gcsp/policy/index.js';
import { createLearnedDemandForecastProvider } from '../../../../../server/gcsp/predict/forecast/provider.js';
import { featureVector, FEATURE_SETS, choiceProbabilities, createModelArtifact, writeModelArtifact, readModelArtifact,
  evaluationSummary } from '../../../../../server/gcsp/predict/model/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../..');
const seed = JSON.parse(await readFile(join(root, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
const ARTIFACTS = join(root, 'docs/gcsp/models/artifacts');
const ID = 'sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d';
const outPath = join(here, '../resources/learning-parity/cases.json');
const clone = (v) => JSON.parse(JSON.stringify(v));
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
const scratch = await mkdtemp(join(tmpdir(), 'learning-parity-'));

// The Node narrowing rule lives unexported in plan-forecast.js; load its own source text as the baseline.
const planSource = await readFile(join(root, 'server/gcsp/predict/forecast/plan-forecast.js'), 'utf8');
const compareSource = planSource.match(/const compare = [^\n]*\n/)[0];
const likeliestSource = planSource.match(/function likeliest[\s\S]*?\n}\n/)[0];
const likeliest = new Function(`${compareSource}${likeliestSource}return likeliest;`)();

// A deterministic generator, so regenerating changes nothing.
let state = 20261114;
const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ---- policy variants ----
const reference = (artifactId = ID, featureVersion = 'vehicle-preference-v1', schemaVersion = 1) => ({ artifactId, featureVersion, schemaVersion });
const referenceRow = (value, patch = {}) => ({ key: 'choice.model.reference', value, unit: 'test-fixture', status: 'assumed',
  basis: 'Test activation of a synthetic-trained artifact.', source: 'services/gcsp-api/src/test/parity/learning-parity.mjs',
  sourceDate: '2026-11-09', policyVersion: seed.policyVersion, effectiveFrom: seed.effectiveFrom, ...patch });
function serviceFor(spec) {
  const source = clone(seed);
  if (spec.referenceRow) source.assumptions.push(clone(spec.referenceRow));
  const row = source.assumptions.find((a) => a.key === 'forecast.learned.v1');
  if (spec.removeSettings) source.assumptions = source.assumptions.filter((a) => a !== row);
  else if (spec.settingsValue !== undefined) row.value = clone(spec.settingsValue);
  return new PolicyService({ provider: { async loadVersions() { return [source]; } } });
}

// ---- artifacts: retained, derived (edited and re-signed), tampered (edited, not re-signed) and truncated ----
const retained = JSON.parse(await readFile(join(ARTIFACTS, `${ID.slice(7)}.json`), 'utf8'));
const artifactSpecs = {
  'only-v1': { mode: 'derived', edits: [{ pointer: '/featureVersion', value: 'vehicle-only-v1' }, { pointer: '/featureNames', value: [...FEATURE_SETS['vehicle-only-v1']] },
    { pointer: '/coefficients', value: retained.payload.coefficients.slice(0, 9) }] },
  'held-g7': { mode: 'derived', edits: [{ pointer: '/trainingSettings/split/heldOutCohorts', value: ['G7', 'G8-10'] }] },
  'tampered-coefficient': { mode: 'tampered', edits: [{ pointer: '/coefficients/1', value: -0.4 }] },
  'tampered-invalid-payload': { mode: 'tampered', edits: [{ pointer: '/limitations', value: [] }] },
  truncated: { mode: 'truncated' },
};
const setPointer = (target, pointer, value) => {
  const parts = pointer.split('/').slice(1); let at = target;
  for (const part of parts.slice(0, -1)) at = at[part];
  at[parts.at(-1)] = value;
};
const dirs = { retained: ARTIFACTS };
for (const [name, spec] of Object.entries(artifactSpecs)) {
  const dir = join(scratch, name); await mkdir(dir); dirs[name] = dir;
  const payload = clone(retained.payload);
  for (const edit of spec.edits ?? []) setPointer(payload, `/${edit.pointer.slice(1)}`, edit.value);
  if (spec.mode === 'derived') { const artifact = createModelArtifact(payload); spec.artifactId = artifact.artifactId; await writeModelArtifact(dir, artifact); }
  else if (spec.mode === 'tampered') { spec.artifactId = ID; await writeFile(join(dir, `${ID.slice(7)}.json`), `${JSON.stringify({ artifactId: ID, payload })}\n`); }
  else { spec.artifactId = ID; await writeFile(join(dir, `${ID.slice(7)}.json`), JSON.stringify(retained).slice(0, 1500)); }
}
const idOf = (artifact) => (artifact === 'retained' ? ID : artifactSpecs[artifact].artifactId);

// ---- PredictionInput builders ----
const brief = (preferences = {}, essentials = {}) => ({ preferences, essentials });
const pref = (value, importance, extra = {}) => ({ value, importance, valueState: 'confirmed', importanceState: 'confirmed', ...extra });
const essential = (value) => ({ state: 'confirmed', operator: 'gte', value });
const choice = (derivativeId, vehicleClass, attributes) => ({ derivativeId, configurationId: `cfg-${derivativeId}`, vehicleClass, termsVersion: 'terms-1',
  attributes: { body: vehicleClass === 'unknown' ? null : vehicleClass, fuel: null, seats: 5, boot: 480, monthlyPoints: 650, allowance: 700, ...attributes } });
const entitlement = (id, cohortKey, period, b, choices, extra = {}) => ({ entitlementId: id, employeeId: `emp-${id}`, cohortKey, renewalAt: '2027-01-15T00:00:00.000Z',
  period, brief: b, permittedChoices: choices, ...extra });
const input = (entitlements, patch = {}) => ({ contractVersion: '1.0.0', runId: 'learning-parity-run', asOf: '2026-11-10T09:00:00.000Z', policyVersion: seed.policyVersion,
  horizon: { start: '2026-11-10T09:00:00.000Z', end: '2027-03-10T09:00:00.000Z' }, cohort: { version: 'cohort-v1', entitlements }, terms: { version: 'terms-digest-1' }, ...patch });
const COHORTS = ['G1-6', 'G7', 'G11-14'];
const randomChoice = (n) => {
  const cls = pick(['saloon', 'estate']);
  const points = pick([null, between(300, 900), between(300, 900) + 0.25]);
  return choice(`d${n}-${between(100, 999)}`, cls, { body: pick([cls, cls, null]), fuel: pick(['ev', 'petrol', 'hybrid', null]),
    seats: pick([null, 2, 4, 5, 7]), boot: pick([null, between(250, 650), between(250, 650) + 0.5]), monthlyPoints: points, allowance: pick([0, 600, 800, 750.5, null]) });
};
const randomBrief = () => {
  const prefs = {}; const ess = {};
  if (rnd() < 0.7) prefs.body = pick([pref(['estate'], between(0, 100)), pref('saloon', between(0, 100)), pref(['saloon', 'estate'], 100),
    { ...pref('estate', 60), valueState: 'proposed' }, { ...pref('estate', 60), importanceState: 'inferred' }]);
  if (rnd() < 0.7) prefs.fuel = pick([pref(['ev'], between(0, 100)), pref('petrol', between(0, 100)), pref(['ev', 'hybrid'], 25), { ...pref('ev', 40), valueState: 'proposed' }]);
  if (rnd() < 0.5) ess.seats = pick([essential(5), essential(7), { state: 'proposed', operator: 'gte', value: 6 }]);
  if (rnd() < 0.5) ess.boot = pick([essential(400), essential(0), { state: 'proposed', operator: 'gte', value: 500 }]);
  return brief(prefs, ess);
};
const randomInput = (n) => {
  const count = between(1, 6); const entitlements = [];
  for (let i = 0; i < count; i += 1) {
    const choices = []; const size = between(1, 6);
    for (let j = 0; j < size; j += 1) { const c = randomChoice(`${n}${i}${j}`); if (!choices.some((x) => x.derivativeId === c.derivativeId)) choices.push(c); }
    entitlements.push(entitlement(`ent-${n}-${i}`, pick(COHORTS), pick(['2026-12', '2027-01', '2027-02']), randomBrief(), choices));
  }
  return input(entitlements);
};

const cases = [];
const providerFor = (artifact, spec) => createLearnedDemandForecastProvider({ policy: serviceFor(spec), artifactDirectory: dirs[artifact] });
async function forecastCase(name, { artifact = 'retained', spec, inputValue, policyRead = null }) {
  const full = { referenceRow: referenceRow(reference(idOf(artifact))), ...spec };
  const body = await providerFor(artifact, full).forecast({}, inputValue, policyRead ?? undefined);
  const expected = JSON.parse(JSON.stringify(body));
  const entry = { kind: 'forecast', name, artifact, spec: full, policyRead, input: inputValue, expected };
  if (body.status === 'ok') {
    const { choiceMassThreshold, waitExclusionThreshold } = body.settings;
    entry.narrowing = body.employees.map((e) => ({ entitlementId: e.entitlementId, waits: e.waitProbability > waitExclusionThreshold,
      kept: likeliest(e.choices, choiceMassThreshold) }));
  }
  cases.push(entry);
  return body;
}

// 1. active model, hand-built inputs
const base = input([entitlement('e1', 'G1-6', '2026-12', brief(), [choice('a', 'saloon'), choice('b', 'estate')])]);
await forecastCase('active/one-employee-no-brief', { inputValue: base });
await forecastCase('active/multi-cohort-multi-period', { inputValue: input([
  entitlement('e1', 'G1-6', '2026-12', brief({ body: pref(['estate'], 80) }), [choice('a', 'saloon', { fuel: 'ev' }), choice('b', 'estate', { fuel: 'petrol' }), choice('c', 'estate', { fuel: 'ev' })]),
  entitlement('e2', 'G7', '2027-01', brief({ fuel: pref('ev', 100) }), [choice('a', 'saloon', { fuel: 'ev' }), choice('d', 'saloon', { fuel: 'hybrid' })]),
  entitlement('e3', 'G11-14', '2027-01', brief({}, { seats: essential(5), boot: essential(450) }), [choice('b', 'estate', { seats: 7, boot: 640 }), choice('e', 'saloon', { seats: 4, boot: 350 })]),
  entitlement('e0', 'G1-6', '2026-12', brief({ body: pref('saloon', 0), fuel: pref(['ev', 'hybrid'], 50) }), [choice('a', 'saloon'), choice('f', 'estate', { fuel: 'hybrid' })])]) });
await forecastCase('active/unconfirmed-preferences', { inputValue: input([entitlement('e1', 'G7', '2026-12',
  brief({ body: pref('estate', 90, { valueState: 'proposed' }), fuel: pref('ev', 90, { importanceState: 'proposed' }) }), [choice('a', 'saloon', { fuel: 'ev' }), choice('b', 'estate')])]) });
await forecastCase('active/confirmed-list-and-scalar', { inputValue: input([entitlement('e1', 'G7', '2026-12',
  brief({ body: pref(['estate', 'saloon'], 100), fuel: pref('ev', 30) }), [choice('a', 'saloon', { fuel: 'ev' }), choice('b', 'estate', { fuel: 'petrol' })])]) });
await forecastCase('active/missing-seats-boot-points', { inputValue: input([entitlement('e1', 'G11-14', '2026-12', brief({}, { seats: essential(5), boot: essential(300) }),
  [choice('a', 'saloon', { seats: null, boot: null, monthlyPoints: null, allowance: null }), choice('b', 'estate', { seats: 0, boot: 0, monthlyPoints: 0 })])]) });
await forecastCase('active/zero-allowance', { inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief(),
  [choice('a', 'saloon', { allowance: 0 }), choice('b', 'estate', { allowance: 0, monthlyPoints: null })])]) });
await forecastCase('active/no-choices', { inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief(), []), entitlement('e2', 'G7', '2026-12', brief(), [choice('a', 'saloon')])]) });
await forecastCase('active/required-by-and-unsorted', { inputValue: input([
  entitlement('z9', 'G7', '2027-02', brief(), [choice('m', 'estate'), choice('c', 'saloon'), choice('b', 'saloon')], { requiredBy: '2027-02-10T00:00:00+01:00' }),
  entitlement('a1', 'G1-6', '2027-02', brief(), [choice('x', 'estate')])]) });
await forecastCase('active/tie-identical-choices', { inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief(),
  [choice('t3', 'saloon'), choice('t1', 'saloon'), choice('t2', 'saloon'), choice('t4', 'saloon')])]) });
for (let n = 0; n < 14; n += 1) await forecastCase(`active/random-${n}`, { inputValue: randomInput(n) });

// 2. settings
const six = input([entitlement('e1', 'G1-6', '2026-12', brief({ body: pref('estate', 70) }), [choice('a', 'saloon'), choice('b', 'estate'), choice('c', 'estate', { seats: 7 })]),
  entitlement('e2', 'G7', '2026-12', brief(), [choice('a', 'saloon'), choice('b', 'estate')])]);
const settingsBase = { choiceMassThreshold: 0.8, waitExclusionThreshold: 0.5, intervalZ: 1.96 };
for (const [name, patch] of [['mass-0.5', { choiceMassThreshold: 0.5 }], ['mass-1', { choiceMassThreshold: 1 }], ['wait-0', { waitExclusionThreshold: 0 }],
  ['wait-0.01', { waitExclusionThreshold: 0.01 }], ['wait-1', { waitExclusionThreshold: 1 }], ['z-1', { intervalZ: 1 }], ['z-10', { intervalZ: 10 }], ['z-0.001', { intervalZ: 0.001 }]]) {
  await forecastCase(`settings/valid-${name}`, { inputValue: six, spec: { settingsValue: { ...settingsBase, ...patch } } });
}
for (const [name, value] of [['mass-0', { ...settingsBase, choiceMassThreshold: 0 }], ['mass-above-1', { ...settingsBase, choiceMassThreshold: 1.1 }],
  ['wait-negative', { ...settingsBase, waitExclusionThreshold: -0.1 }], ['z-zero', { ...settingsBase, intervalZ: 0 }], ['z-above-10', { ...settingsBase, intervalZ: 10.5 }],
  ['string-mass', { ...settingsBase, choiceMassThreshold: '0.8' }], ['missing-z', { choiceMassThreshold: 0.8, waitExclusionThreshold: 0.5 }], ['null', null], ['array', []]]) {
  await forecastCase(`settings/invalid-${name}`, { inputValue: six, spec: { settingsValue: value } });
}
await forecastCase('settings/row-removed', { inputValue: six, spec: { removeSettings: true } });

// 3. activation and artifact fallbacks
const fallbacks = [
  ['no-reference-row', { referenceRow: null }],
  ['reference-bad-schema', { referenceRow: referenceRow(reference(ID, 'vehicle-preference-v1', 2)) }],
  ['reference-unknown-feature-version', { referenceRow: referenceRow(reference(ID, 'vehicle-x-v9')) }],
  ['reference-missing-file', { referenceRow: referenceRow(reference(`sha256:${'ab'.repeat(32)}`)) }],
  ['reference-malformed-id', { referenceRow: referenceRow(reference('sha256:XYZ')) }],
  ['reference-feature-version-differs', { referenceRow: referenceRow(reference(ID, 'vehicle-only-v1')) }],
  ['reference-value-not-object', { referenceRow: referenceRow('sha256:abc') }],
  ['reference-extra-fields', { referenceRow: referenceRow({ ...reference(), note: 'extra' }) }],
  ['reference-empty-unit', { referenceRow: referenceRow(reference(), { unit: '' }) }],
  ['reference-bad-status', { referenceRow: referenceRow(reference(), { status: 'guessed' }) }],
  ['reference-bad-source-date', { referenceRow: referenceRow(reference(), { sourceDate: '2026-02-30' }) }],
  ['reference-verified', { referenceRow: referenceRow(reference(), { status: 'verified' }) }],
  ['reference-effective-later', { referenceRow: referenceRow(reference(), { effectiveFrom: '2026-12-01T00:00:00.000Z' }) }],
];
for (const [name, spec] of fallbacks) await forecastCase(`fallback/${name}`, { inputValue: six, spec });
const refFor = (artifact) => referenceRow(reference(idOf(artifact), artifact === 'only-v1' ? 'vehicle-only-v1' : 'vehicle-preference-v1'));
for (const artifact of Object.keys(artifactSpecs)) {
  await forecastCase(`artifact/${artifact}`, { artifact, inputValue: six, spec: { referenceRow: refFor(artifact) } });
}
await forecastCase('artifact/only-v1-with-preference-reference', { artifact: 'only-v1', inputValue: six });
await forecastCase('artifact/held-g7-covered-cohort', { artifact: 'held-g7', inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief(), [choice('a', 'saloon')])]) });
await forecastCase('artifact/only-v1-random', { artifact: 'only-v1', inputValue: randomInput(90), spec: { referenceRow: refFor('only-v1') } });
await forecastCase('artifact/only-v1-preferences', { artifact: 'only-v1', spec: { referenceRow: refFor('only-v1') }, inputValue: input([entitlement('e1', 'G7', '2026-12', brief({ body: pref('estate', 90) }, { seats: essential(5) }),
  [choice('a', 'saloon', { fuel: 'ev' }), choice('b', 'estate', { seats: 7 })])]) });

// 4. coverage
await forecastCase('coverage/cohort-held-out', { inputValue: input([entitlement('e1', 'G8-10', '2026-12', brief(), [choice('a', 'saloon')])]) });
await forecastCase('coverage/cohort-unknown-and-class-unknown', { inputValue: input([entitlement('e1', 'G99', '2026-12', brief(), [choice('a', 'unknown'), choice('b', 'saloon')]),
  entitlement('e2', 'G1-6', '2026-12', brief(), [choice('c', 'coupe'), choice('d', 'wait')]), entitlement('e3', 'G0', '2026-12', brief(), [choice('e', 'coupe')])]) });
await forecastCase('coverage/vehicle-class-only', { inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief(), [choice('a', 'suv'), choice('b', 'saloon')])]) });

// 5. policy read and invalid input
await forecastCase('read/explicit-equal', { inputValue: six, policyRead: { runId: 'other-run', asOf: '2026-11-11T00:00:00.000Z', policyVersion: seed.policyVersion } });
await forecastCase('read/pinned-unknown-version', { inputValue: six, policyRead: { runId: 'learning-parity-run', asOf: '2026-11-10T09:00:00.000Z', policyVersion: 'not-a-version' } });
await forecastCase('read/before-policy-effective', { inputValue: six, policyRead: { runId: 'learning-parity-run', asOf: '2026-01-01T00:00:00.000Z', policyVersion: null } });
await forecastCase('read/input-policy-version-unknown', { inputValue: { ...six, policyVersion: 'gcsp-policy-v0' } });
const bad = [
  ['not-object', null], ['wrong-contract', { ...six, contractVersion: '2.0.0' }], ['missing-run', { ...six, runId: '' }], ['bad-as-of', { ...six, asOf: '2026-02-30T00:00:00Z' }],
  ['bad-horizon', { ...six, horizon: { start: '2026-11-10T09:00:00Z' } }], ['no-cohort-version', { ...six, cohort: { entitlements: [] } }], ['no-terms', { ...six, terms: {} }],
  ['duplicate-entitlement', input([entitlement('e1', 'G1-6', '2026-12', brief(), []), { ...entitlement('e1', 'G7', '2026-12', brief(), []), employeeId: 'other' }])],
  ['duplicate-employee', input([entitlement('e1', 'G1-6', '2026-12', brief(), []), { ...entitlement('e2', 'G7', '2026-12', brief(), []), employeeId: 'emp-e1' }])],
  ['bad-period', input([entitlement('e1', 'G1-6', '2026-1', brief(), [])])],
  ['negative-seats', input([entitlement('e1', 'G1-6', '2026-12', brief(), [choice('a', 'saloon', { seats: -1 })])])],
  ['missing-attribute-key', input([entitlement('e1', 'G1-6', '2026-12', brief(), [{ ...choice('a', 'saloon'), attributes: { body: 'saloon', fuel: null, seats: 5, boot: 480, monthlyPoints: 650 } }])])],
  ['duplicate-derivative', input([entitlement('e1', 'G1-6', '2026-12', brief(), [choice('a', 'saloon'), choice('a', 'estate')])])],
  ['brief-array-preferences', input([entitlement('e1', 'G1-6', '2026-12', { preferences: [], essentials: {} }, [])])],
  ['bad-required-by', input([entitlement('e1', 'G1-6', '2026-12', brief(), [], { requiredBy: 'tomorrow' })])],
  ['empty-class', input([entitlement('e1', 'G1-6', '2026-12', brief(), [choice('a', '')])])],
  ['forbidden-key', { ...six, constructor: 1 }],
];
for (const [name, value] of bad) await forecastCase(`invalid/${name}`, { inputValue: value });
// A valid input whose brief the feature step refuses answers unavailable, never a partial forecast.
await forecastCase('unavailable/importance-above-100', { inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief({ body: pref('estate', 150) }), [choice('a', 'estate')])]) });
await forecastCase('unavailable/essential-operator', { inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief({}, { seats: { state: 'confirmed', operator: 'lte', value: 5 } }), [choice('a', 'estate')])]) });
await forecastCase('unavailable/preference-value-number', { inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief({ body: pref(5, 50) }), [choice('a', 'estate')])]) });
await forecastCase('unavailable/unconfirmed-importance-text', { inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief({ body: { valueState: 'proposed', importance: 'abc' } }), [choice('a', 'estate')])]) });
await forecastCase('active/unconfirmed-importance-numeric-text', { inputValue: input([entitlement('e1', 'G1-6', '2026-12', brief({ body: { valueState: 'proposed', importance: '50' } }), [choice('a', 'estate')])]) });

// ---- featureVector cases ----
const aAll = { body: 'estate', fuel: 'ev', seats: 5, boot: 520, monthlyPoints: 640, allowance: 800 };
const featureInputs = [
  ['plain', { attributes: aAll }, brief()],
  ['wait', { isWait: true }, brief()],
  ['wait-with-attributes', { attributes: aAll, isWait: true }, brief({ body: pref('estate', 50) })],
  ['pref-list', { attributes: aAll }, brief({ body: pref(['estate', 'saloon'], 80), fuel: pref(['ev'], 40) })],
  ['pref-scalar', { attributes: aAll }, brief({ body: pref('estate', 100), fuel: pref('petrol', 100) })],
  ['pref-importance-zero', { attributes: aAll }, brief({ body: pref('estate', 0) })],
  ['pref-unconfirmed', { attributes: aAll }, brief({ body: { ...pref('estate', 80), valueState: 'proposed' }, fuel: { ...pref('ev', 80), importanceState: 'proposed' } })],
  ['pref-empty-list', { attributes: aAll }, brief({ body: pref([], 50) })],
  ['pref-non-string', { attributes: aAll }, brief({ body: pref([1], 50) })],
  ['pref-importance-negative', { attributes: aAll }, brief({ body: pref('estate', -5) })],
  ['pref-importance-101', { attributes: aAll }, brief({ body: pref('estate', 101) })],
  ['pref-importance-text', { attributes: aAll }, brief({ body: pref('estate', '50') })],
  ['pref-fuel-missing-attribute', { attributes: { ...aAll, fuel: null } }, brief({ fuel: pref('ev', 70) })],
  ['essentials-confirmed', { attributes: aAll }, brief({}, { seats: essential(7), boot: essential(400) })],
  ['essentials-proposed', { attributes: aAll }, brief({}, { seats: { state: 'proposed', operator: 'gte', value: 7 } })],
  ['essentials-missing-attribute', { attributes: { ...aAll, seats: null, boot: undefined } }, brief({}, { seats: essential(5), boot: essential(400) })],
  ['essentials-bad-operator', { attributes: aAll }, brief({}, { seats: { state: 'confirmed', operator: 'gt', value: 5 } })],
  ['essentials-bad-value', { attributes: aAll }, brief({}, { boot: { state: 'confirmed', operator: 'gte', value: -1 } })],
  ['attr-missing-all', { attributes: { body: null, fuel: null } }, brief()],
  ['attr-zeroes', { attributes: { body: 'saloon', fuel: 'petrol', seats: 0, boot: 0, monthlyPoints: 0, allowance: 0 } }, brief()],
  ['attr-allowance-zero-points', { attributes: { ...aAll, allowance: 0 } }, brief()],
  ['attr-negative', { attributes: { ...aAll, boot: -3 } }, brief()],
  ['attr-text-number', { attributes: { ...aAll, seats: '5' } }, brief()],
  ['attr-fractional', { attributes: { ...aAll, seats: 4.5, boot: 333.333, monthlyPoints: 0.1, allowance: 0.3 } }, brief({ body: pref('estate', 33.3) }, { boot: essential(100.5) })],
  ['no-brief', { attributes: aAll }, undefined],
  ['null-brief', { attributes: aAll }, null],
  ['empty-attributes', {}, brief()],
];
for (const featureVersion of ['vehicle-only-v1', 'vehicle-preference-v1']) {
  for (const [name, alternative, b] of featureInputs) {
    let expected;
    try { expected = { vector: featureVector(alternative, b, featureVersion) }; } catch (error) { expected = { error: { code: error.code, field: error.field } }; }
    cases.push({ kind: 'featureVector', name: `${featureVersion}/${name}`, featureVersion, alternative: JSON.parse(JSON.stringify(alternative)),
      brief: b === undefined ? undefined : b, expected: JSON.parse(JSON.stringify(expected)) });
  }
}
cases.push({ kind: 'featureVector', name: 'unknown-feature-version', featureVersion: 'nope', alternative: { attributes: aAll }, brief: brief(), expected: { error: { code: 'invalid-input', field: 'featureVersion' } } });

// ---- choiceProbabilities cases ----
for (let n = 0; n < 8; n += 1) {
  const dimension = n % 2 ? 9 : 15; const features = []; const count = between(1, 7);
  for (let i = 0; i < count; i += 1) features.push(Array.from({ length: dimension }, () => pick([0, 1, rnd(), rnd() * 2 - 1, rnd() * 10])));
  const coefficients = retained.payload.coefficients.slice(0, dimension);
  cases.push({ kind: 'probabilities', name: `random-${n}`, alternatives: features, coefficients, expected: choiceProbabilities(features.map((f) => ({ features: f })), coefficients) });
}
const extreme = [[800, 0], [0, 0], [-800, 1]].map((f) => ({ features: f }));
cases.push({ kind: 'probabilities', name: 'extreme-utilities', alternatives: extreme.map((e) => e.features), coefficients: [1, 1], expected: choiceProbabilities(extreme, [1, 1]) });

// ---- narrowing (likeliest) cases ----
const dist = (...p) => p.map((probability, i) => ({ derivativeId: String.fromCharCode(97 + i), probability }));
const narrowing = [['ordered', dist(0.5, 0.3, 0.2), 0.8], ['tie-two-way', dist(0.25, 0.25, 0.25, 0.25), 0.5], ['tie-three-of-four', dist(0.25, 0.25, 0.25, 0.25), 0.75],
  ['threshold-one', dist(0.5, 0.3, 0.2), 1], ['single', dist(0.4), 0.8], ['empty', [], 0.8], ['all-zero', dist(0, 0), 0.8], ['exact-boundary', dist(0.8, 0.2), 0.8],
  ['boundary-two-of-three', dist(0.4, 0.4, 0.2), 0.8], ['reverse-ids-tie', [{ derivativeId: 'z', probability: 0.3 }, { derivativeId: 'y', probability: 0.3 }, { derivativeId: 'x', probability: 0.4 }], 0.6],
  ['tiny-tail', dist(0.7, 0.2999999999995, 5e-13), 1]];
for (let n = 0; n < 14; n += 1) { const raw = Array.from({ length: between(1, 6) }, () => rnd()); const total = raw.reduce((a, b) => a + b, 0) / pick([1, 1.25, 2]); narrowing.push([`random-${n}`, dist(...raw.map((r) => r / total)), pick([0.5, 0.8, 0.9, 0.95, 1])]); }
for (const [name, choices, threshold] of narrowing) cases.push({ kind: 'likeliest', name, choices, threshold, expected: likeliest(choices, threshold) });
for (const [probability, threshold] of [[0.5, 0.5], [0.5000000001, 0.5], [0.4999999999, 0.5], [0, 0], [1, 1], [0.0001, 0]]) {
  cases.push({ kind: 'waitExclusion', name: `${probability}-vs-${threshold}`, probability, threshold, expected: probability > threshold });
}

// ---- the retained artifact ----
const verified = await readModelArtifact(join(ARTIFACTS, `${ID.slice(7)}.json`), ID);
const meta = { artifactId: ID, fileSha256: createHash('sha256').update(await readFile(join(ARTIFACTS, `${ID.slice(7)}.json`))).digest('hex'),
  evaluationSummary: JSON.parse(JSON.stringify(evaluationSummary(verified))), derived: Object.fromEntries(Object.entries(artifactSpecs).map(([k, v]) => [k, { mode: v.mode, artifactId: v.artifactId, edits: v.edits ?? [] }])) };
const counts = {}; for (const c of cases) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
const statuses = {}; for (const c of cases) if (c.kind === 'forecast') { const k = c.expected.status === 'fallback' ? `fallback:${c.expected.reason}` : c.expected.status; statuses[k] = (statuses[k] ?? 0) + 1; }
const file = { generator: { source: ['services/gcsp-api/src/test/parity/learning-parity.mjs', 'server/gcsp/predict/model/artifact.js', 'server/gcsp/predict/model/features.js',
  'server/gcsp/predict/model/optimizer.js', 'server/gcsp/predict/model/policy.js', 'server/gcsp/predict/forecast/provider.js', 'server/gcsp/predict/forecast/input.js',
  'server/gcsp/predict/forecast/plan-forecast.js'], gitShortSha: sha, settingsBase }, counts, statuses, retained: meta, cases };
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(file)}\n`);
await rm(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ counts, statuses, bytes: JSON.stringify(file).length }));
