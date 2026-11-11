import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PolicyService } from '../gcsp/policy/index.js';
import { createEmployeeRecommendationService, createStoredSubjectRecommendationEvaluator } from '../gcsp/recommendation/index.js';
import { projectCurrentCarBaseline } from '../gcsp/recommendation/current-car.js';
import { context, instant, fact, brief, stock, providerValue, provider, time, policy, preference, essential,
  currentCar, rating, sameAgain } from './helpers/employee-recommendation.js';

const KEY = 'employee.currentCarFeedback.v1';
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const withSeed = (edit) => { const copy = structuredClone(seed); edit(copy); return new PolicyService({ provider: { loadVersions: async () => [copy] } }); };
const feedbackValue = (s) => s.assumptions.find((row) => row.key === KEY).value;

// 1 same model line/body/fuel as the current car, 2 different line, 3 unknown line, 4 faster SUV, 5 similar but 4 seats.
const cars = () => [
  stock(1, { modelLine: fact('G21 Touring') }),
  stock(2, { modelLine: fact('G20 Saloon'), eligibilityModelKey: fact('G20 Saloon|320i'), body: fact('saloon') }),
  stock(3, {}),
  stock(4, { modelLine: fact('U11 X1'), eligibilityModelKey: fact('U11 X1|20i'), body: fact('suv'), zeroTo62: fact(5, 's') }),
  stock(5, { modelLine: fact('G21 Touring'), seats: fact(4, 'count') }),
];
const setup = ({ cars: list = cars(), baseline, policyService = policy(), facts } = {}) => {
  const value = providerValue(list);
  if (baseline !== null) value.currentCar = baseline ?? currentCar(facts);
  return createEmployeeRecommendationService({ policy: policyService, provider: provider(value), time });
};
const base = () => ({ ...brief(), preferences: { sportiness: preference(80) } });
const run = (service, patch = {}, request = base()) => service.recommend(context, { ...request, ...patch });
const byCar = (result) => Object.fromEntries(result.value.decisions.map((d) => [Number(d.orderUuid.slice(-1)), d]));
const kept = (result) => result.value.recommendations.map((d) => Number(d.orderUuid.slice(-1)));
const codes = (rows) => rows.map((row) => row.code);

test('old briefs without the typed fields produce the pre-change output and never read the feedback entry', async () => {
  const reads = []; const real = policy();
  const spy = new Proxy(real, { get: (target, name) => name === 'getAssumption' ? (key, read) => { reads.push(key); return target.getAssumption(key, read); } : target[name].bind(target) });
  const withEntry = await run(setup({ policyService: spy }));
  const without = await run(setup({ policyService: withSeed((s) => { s.assumptions = s.assumptions.filter((row) => row.key !== KEY); }) }));
  assert.equal(withEntry.status, 'ok'); assert.deepEqual(withEntry, without);
  assert.ok(!reads.includes(KEY));
  assert.deepEqual(Object.keys(withEntry.value.versions).sort(), ['brief', 'clock', 'facts', 'policy', 'stock']);
  for (const d of withEntry.value.decisions) {
    assert.equal(Object.hasOwn(d, 'feedback'), false); assert.equal(Object.hasOwn(d.versions, 'feedback'), false);
    assert.ok(!d.evidence.assumptions.some((row) => row.key === KEY));
  }
});

test('typed fields are validated in exactly the stored shapes and the baseline is never taken from the request', async () => {
  const service = setup();
  for (const patch of [{ currentCarRating: { ...rating(5), extra: 1 } }, { currentCarRating: rating(6) }, { currentCarRating: { ...rating(5), source: 'greg' } },
    { sameAgain: { ...sameAgain(true), on: 'yes' } }, { sameAgain: { on: true } }, { currentCar: currentCar() }, { baseline: currentCar() }]) {
    assert.equal((await run(service, patch)).status, 'invalid', JSON.stringify(Object.keys(patch)));
  }
  const accepted = await run(service, { currentCarRating: rating(null), sameAgain: sameAgain(false) });
  assert.equal(accepted.status, 'ok');
  const missingBaseline = await run(setup({ baseline: null }), { currentCarRating: rating(5) });
  assert.equal(byCar(missingBaseline)[1].feedback.reasonCode, 'feedback-baseline-unavailable');
});

test('rating 1 to 5 and unset: positive keeps similar or proven improvement, negative omits similar, neutral changes nothing', async () => {
  const service = setup(); const plain = await run(service);
  assert.deepEqual(kept(plain), [4, 1, 2]);
  for (const value of [3, null]) {
    const result = await run(service, { currentCarRating: rating(value) });
    assert.deepEqual(result.value.decisions.map((d) => [d.gateStatus, d.score]), plain.value.decisions.map((d) => [d.gateStatus, d.score]));
    assert.ok(result.value.decisions.every((d) => d.feedback.rating.class === 'neutral' && d.feedback.effect === 'none'));
  }
  for (const value of [4, 5]) {
    const result = await run(service, { currentCarRating: rating(value) }); const cars = byCar(result);
    assert.equal(cars[1].feedback.similarity, 'similar'); assert.ok(codes(cars[1].reasons).includes('feedback-similar'));
    assert.equal(result.value.state, 'recommendations'); assert.equal(result.value.eligibleCount, result.value.decisions.filter((d) => d.gateStatus === 'eligible').length);
    for (const entry of result.value.recommendations) {
      assert.ok(entry.feedback.similarity === 'similar' || entry.feedback.improvement === 'proven', 'every positive recommendation is proven');
      assert.ok(codes(entry.reasons).some((code) => ['feedback-similar', 'feedback-improvement'].includes(code)));
    }
  }
  for (const value of [1, 2]) {
    const result = await run(service, { currentCarRating: rating(value) }); const cars = byCar(result);
    assert.equal(cars[1].gateStatus, 'ineligible'); assert.ok(codes(cars[1].blockers).includes('feedback-similar-omitted'));
    assert.deepEqual(cars[1].unknowns, []);
    assert.equal(cars[3].gateStatus, 'eligible'); assert.equal(cars[3].feedback.similarity, 'unknown');
    assert.ok(!kept(result).includes(1)); assert.ok(kept(result).includes(2));
  }
});

test('similarity is identical, different or unknown from confirmed facts only', async () => {
  const unconfirmed = await run(setup({ cars: [stock(1, { modelLine: fact('G21 Touring', null, 'model-reference') })] }), { currentCarRating: rating(5) });
  assert.equal(byCar(unconfirmed)[1].feedback.similarity, 'unknown');
  const noBodyBaseline = await run(setup({ cars: [stock(1, { modelLine: fact('G21 Touring') })], facts: { modelLine: 'G21 Touring', fuel: 'petrol' } }), { currentCarRating: rating(1) });
  assert.equal(byCar(noBodyBaseline)[1].feedback.similarity, 'unknown'); assert.equal(byCar(noBodyBaseline)[1].gateStatus, 'eligible');
  const differentFuel = await run(setup({ cars: [stock(1, { modelLine: fact('G21 Touring'), fuel: fact('diesel') })] }), { currentCarRating: rating(1) });
  assert.equal(byCar(differentFuel)[1].feedback.similarity, 'different'); assert.equal(byCar(differentFuel)[1].gateStatus, 'eligible');
});

test('improvement needs a measurable expressed gain; faster, pricier or newer alone never counts', async () => {
  const fast = [stock(4, { modelLine: fact('U11 X1'), eligibilityModelKey: fact('U11 X1|20i'), body: fact('suv'), zeroTo62: fact(4, 's') })];
  const body = { ...brief(), preferences: { body: preference('estate') } };
  const notExpressed = await run(setup({ cars: fast }), { currentCarRating: rating(5) }, body);
  assert.equal(byCar(notExpressed)[4].feedback.improvement, 'not-proven'); assert.equal(notExpressed.value.state, 'no-viable-stock');
  assert.ok(codes(byCar(notExpressed)[4].blockers).includes('feedback-not-similar-or-better'));
  const expressed = await run(setup({ cars: fast }), { currentCarRating: rating(5) });
  assert.equal(byCar(expressed)[4].feedback.improvement, 'proven');
  const improvement = byCar(expressed)[4].reasons.find((r) => r.code === 'feedback-improvement');
  assert.deepEqual(improvement.keys, ['sportiness']);
  const slower = [stock(4, { modelLine: fact('U11 X1'), eligibilityModelKey: fact('U11 X1|20i'), body: fact('suv'), zeroTo62: fact(11, 's') })];
  assert.equal(byCar(await run(setup({ cars: slower }), { currentCarRating: rating(5) }))[4].feedback.improvement, 'not-proven');
  const noSpeed = setup({ cars: fast, facts: { modelLine: 'G21 Touring', body: 'estate', fuel: 'petrol' } });
  assert.equal(byCar(await run(noSpeed, { currentCarRating: rating(5) }))[4].feedback.improvement, 'unknown');
  const worseElsewhere = { ...brief(), preferences: { sportiness: preference(80), size: preference(60) } };
  const mixed = await run(setup({ cars: [stock(4, { modelLine: fact('U11 X1'), body: fact('suv'), zeroTo62: fact(4, 's'), sizeClass: fact(1, 'ordinal-1-5') })], facts: { modelLine: 'G21 Touring', body: 'estate', fuel: 'petrol', zeroTo62: 7.6, sizeClass: 3 } }),
    { currentCarRating: rating(5) }, worseElsewhere);
  assert.notEqual(byCar(mixed)[4].feedback.improvement, 'proven');
});

test('multiple Body and Fuel choices are alternatives inside the category and importance ignores choice count', async () => {
  const mix = [stock(1, { modelLine: fact('G21 Touring') }), stock(2, { body: fact('suv') }), stock(3, { body: fact('saloon') })];
  const one = await run(setup({ cars: mix }), {}, { ...brief(), preferences: { body: preference(['estate']) } });
  const two = await run(setup({ cars: mix }), {}, { ...brief(), preferences: { body: preference(['estate', 'suv']) } });
  const all = await run(setup({ cars: mix }), {}, { ...brief(), preferences: { body: preference(['hatchback', 'saloon', 'estate', 'suv']) } });
  const score = (result, id) => byCar(result)[id].score;
  assert.equal(score(one, 1), score(two, 1)); assert.equal(score(two, 1), score(two, 2)); assert.equal(score(two, 1), score(all, 1));
  assert.ok(score(two, 3) < score(two, 2));
  const withRating = await run(setup({ cars: mix }), { currentCarRating: rating(5) }, { ...brief(), preferences: { body: preference(['estate', 'suv']) } });
  // Both alternatives fit equally, so the SUV is no improvement over the estate and only the similar car stays.
  assert.equal(byCar(withRating)[2].feedback.improvement, 'not-proven'); assert.deepEqual(kept(withRating), [1]);
});

test('Same again keeps continuity matches by order, omits mismatches and unknowns, and ignores category preferences', async () => {
  const service = setup(); const plain = await run(service);
  const result = await run(service, { sameAgain: sameAgain(true) }); const cars = byCar(result);
  assert.deepEqual(kept(result), [1, 3]);
  assert.deepEqual(result.value.decisions.filter((d) => d.gateStatus === 'eligible').map((d) => d.score), [null, null]);
  for (const id of [2, 4]) { assert.equal(cars[id].gateStatus, 'ineligible'); assert.ok(codes(cars[id].blockers).includes('same-again-different')); assert.deepEqual(cars[id].unknowns, []); }
  assert.ok(codes(cars[1].reasons).includes('same-again-match')); assert.equal(cars[1].feedback.continuity, 'same');
  assert.deepEqual(kept(plain), [4, 1, 2]); // category ranking differs when off
  const unknown = await run(setup({ cars: [stock(1, { eligibilityModelKey: fact(null) })] }), { sameAgain: sameAgain(true) });
  assert.equal(unknown.value.state, 'no-viable-stock'); assert.equal(unknown.value.eligibleCount, 0);
  const off = await run(service, { sameAgain: sameAgain(false) });
  assert.deepEqual(off.value.decisions.map((d) => [d.gateStatus, d.score]), plain.value.decisions.map((d) => [d.gateStatus, d.score]));
  assert.deepEqual(kept(off), kept(plain));
});

test('negative rating with Same again: Same again wins by the recorded precedence, not by omission', async () => {
  const result = await run(setup(), { currentCarRating: rating(1), sameAgain: sameAgain(true) }); const cars = byCar(result);
  assert.equal(cars[1].gateStatus, 'eligible'); assert.equal(cars[1].feedback.rating.class, 'negative');
  assert.equal(cars[1].feedback.effect, 'kept'); assert.equal(cars[1].feedback.reasonCode, 'same-again-match');
  assert.ok(!codes(cars[1].blockers).includes('feedback-similar-omitted'));
  assert.deepEqual(kept(result), [1, 3]);
  const released = await run(setup(), { currentCarRating: rating(1), sameAgain: sameAgain(false) });
  assert.equal(byCar(released)[1].gateStatus, 'ineligible'); assert.ok(codes(byCar(released)[1].blockers).includes('feedback-similar-omitted'));
});

test('gates always come first: a loved or Same-again car failing any gate is never recommended', async () => {
  const failing = [
    stock(1, { modelLine: fact('G21 Touring'), seats: fact(4, 'count') }), stock(2, { modelLine: fact('G21 Touring'), boot: fact(300, 'L') }),
    stock(3, { modelLine: fact('G21 Touring'), eligibilityModelKey: fact('G21 Touring|M340i') }),
    stock(4, { modelLine: fact('G21 Touring'), fuel: fact('ev') }), stock(5, { modelLine: fact('G21 Touring'), eligibilityModelKey: fact('G21 Touring|320i') }),
  ];
  const request = { ...base(), essentials: { seats: essential(5), boot: essential(400, 'gte', 'L') } };
  const source = providerValue(failing); source.currentCar = currentCar(); source.employeeFacts.charging = fact('none');
  const service = createEmployeeRecommendationService({ policy: policy(), provider: provider(source), time });
  for (const patch of [{ currentCarRating: rating(5) }, { sameAgain: sameAgain(true) }, { currentCarRating: rating(5), sameAgain: sameAgain(true) }]) {
    const result = await run(service, patch, request);
    assert.deepEqual(kept(result), [5]);
    for (const id of [1, 2, 3, 4]) { assert.notEqual(byCar(result)[id].gateStatus, 'eligible'); assert.equal(byCar(result)[id].feedback.effect, 'none'); }
  }
  const points = await run(createEmployeeRecommendationService({ policy: withSeed((s) => { s.allowances.forEach((row) => { row.monthlyPoints = 0; row.value = 0; }); }), provider: provider(Object.assign(providerValue([stock(1, { modelLine: fact('G21 Touring') })]), { currentCar: currentCar() })), time }),
    { sameAgain: sameAgain(true) });
  assert.equal(points.value.state, 'no-viable-stock');
  assert.ok(codes(byCar(points)[1].blockers).includes('allowance-exceeded')); assert.ok(!codes(byCar(points)[1].blockers).includes('same-again-different'));
});

test('a contract mismatch or missing baseline is neutral with a recorded reason', async () => {
  const plain = await run(setup());
  const wrong = await run(setup(), { currentCarRating: rating(1, 'current:other'), sameAgain: sameAgain(true, 'current:other') });
  assert.deepEqual(kept(wrong), kept(plain)); const open = wrong.value.decisions.filter((d) => d.gateStatus === 'eligible');
  assert.ok(open.length > 0 && open.every((d) => d.feedback.reasonCode === 'feedback-contract-mismatch' && d.feedback.effect === 'none'));
  const none = await run(setup({ baseline: null }), { currentCarRating: rating(1), sameAgain: sameAgain(true) });
  assert.deepEqual(kept(none), kept(plain));
  assert.ok(none.value.decisions.filter((d) => d.gateStatus === 'eligible').every((d) => d.feedback.reasonCode === 'feedback-baseline-unavailable' && d.feedback.baseline === null));
  const garbage = await run(setup({ baseline: { contractId: 'current:employee-test' } }), { currentCarRating: rating(1) });
  assert.ok(garbage.value.decisions.filter((d) => d.gateStatus === 'eligible').every((d) => d.feedback.reasonCode === 'feedback-baseline-unavailable'));
});

test('a missing, invalid or legacy-version feedback entry applies no effect and records why', async () => {
  const plain = await run(setup());
  const missing = withSeed((s) => { s.assumptions = s.assumptions.filter((row) => row.key !== KEY); });
  const broken = withSeed((s) => { feedbackValue(s).precedence = ['rating', 'gates']; });
  for (const policyService of [missing, broken]) {
    const result = await run(setup({ policyService }), { currentCarRating: rating(1), sameAgain: sameAgain(true) });
    assert.equal(result.status, 'ok'); assert.deepEqual(kept(result), kept(plain));
    assert.ok(result.value.decisions.every((d) => d.feedback.applied === false && d.feedback.reason === 'feedback-policy-unavailable'));
    assert.equal(Object.hasOwn(result.value.versions, 'feedback'), false);
  }
  const legacy = new PolicyService({ provider: { loadVersions: async () => [seed, (() => { const next = structuredClone(seed); next.policyVersion = 'gcsp-policy-v0';
    next.effectiveFrom = instant;
    for (const t of ['allowances', 'pricePlans', 'eligibilityRules', 'schemeRuleLinks', 'assumptions']) next[t].forEach((r) => { r.policyVersion = 'gcsp-policy-v0'; });
    next.assumptions = next.assumptions.filter((row) => row.key !== KEY); return next; })()] } });
  const pinned = await setup({ policyService: legacy }).recommend({ ...context, policyVersion: 'gcsp-policy-v0' }, { ...base(), currentCarRating: rating(1) });
  assert.equal(pinned.status, 'ok'); assert.equal(pinned.value.versions.policy, 'gcsp-policy-v0');
  assert.deepEqual(kept(pinned), kept(plain));
  assert.ok(pinned.value.decisions.every((d) => d.feedback.applied === false && d.feedback.reason === 'feedback-policy-unavailable'));
});

test('one canonical policy change alters the real evaluator: thresholds and dimensions', async () => {
  const request = { currentCarRating: rating(4) };
  const defaults = await run(setup(), request);
  assert.equal(byCar(defaults)[1].feedback.rating.class, 'positive');
  const shifted = setup({ policyService: withSeed((s) => { Object.assign(feedbackValue(s).rating, { positive: [5], neutral: [3, 4] }); }) });
  const moved = await run(shifted, request);
  assert.equal(byCar(moved)[1].feedback.rating.class, 'neutral'); assert.deepEqual(kept(moved), kept(await run(setup())));
  const stricter = setup({ policyService: withSeed((s) => { feedbackValue(s).similarity.dimensions = ['modelLine', 'body', 'fuel', 'sizeClass']; }) });
  const strict = await run(stricter, { currentCarRating: rating(1) });
  assert.equal(byCar(strict)[1].feedback.similarity, 'unknown'); assert.equal(byCar(strict)[1].gateStatus, 'eligible');
  const lenient = setup({ policyService: withSeed((s) => { feedbackValue(s).sameAgain.dimensions = ['body']; }) });
  const bodyOnly = await run(lenient, { sameAgain: sameAgain(true) });
  assert.ok(kept(bodyOnly).includes(1) && kept(bodyOnly).includes(3) && !kept(bodyOnly).includes(4));
  const identity = byCar(defaults)[1].versions.feedback; assert.match(identity, /^employee\.currentCarFeedback\.v1@gcsp-policy-v1\+manual-records-v1$/);
  assert.equal(defaults.value.versions.feedback, identity);
});

test('the preview path and the stored-subject path apply the same feedback as the saved evaluation', async () => {
  const service = setup(); const { briefVersion, ...content } = base();
  const typed = { currentCarRating: rating(1), sameAgain: sameAgain(true) };
  const saved = await run(service, typed);
  const preview = await service.previewUnsaved(context, { brief: { ...content, ...typed }, baseBriefVersion: briefVersion, baseDraftVersion: 0 });
  assert.equal(preview.status, 'ok');
  assert.deepEqual(new Set(kept(preview)), new Set(kept(saved)));
  assert.deepEqual(Object.fromEntries(Object.entries(byCar(preview)).map(([id, d]) => [id, d.feedback])), Object.fromEntries(Object.entries(byCar(saved)).map(([id, d]) => [id, d.feedback])));
  const { roles, ...subject } = context;
  const value = providerValue(cars()); value.currentCar = currentCar();
  const stored = await createStoredSubjectRecommendationEvaluator({ policy: policy(), provider: provider(value), time }).evaluate(subject, { ...base(), ...typed });
  assert.deepEqual(stored, saved);
  const noTyped = await service.previewUnsaved(context, { brief: content, baseBriefVersion: briefVersion, baseDraftVersion: 0 });
  assert.ok(noTyped.value.decisions.every((d) => !Object.hasOwn(d, 'feedback')));
});

test('feedback evaluation reads only: no search, reserve, allocate or order surface is touched', async () => {
  const calls = [];
  const spy = (name) => new Proxy({}, { get: (_, prop) => (...args) => { calls.push(`${name}.${String(prop)}`); return undefined; } });
  const service = createEmployeeRecommendationService({ policy: policy(), provider: { async resolve() { calls.push('provider.resolve'); const v = providerValue(cars()); v.currentCar = currentCar(); return { status: 'ok', value: v }; }, search: spy('search') }, time });
  await run(service, { currentCarRating: rating(5), sameAgain: sameAgain(true) });
  assert.deepEqual(calls, ['provider.resolve']);
});

test('the baseline projection is a pure, strict view of the current contract', () => {
  const source = { mode: 'synthetic', sourceRef: 'fixture:manual-records-v1', schemaVersion: '1', sourceVersion: 'manual-records-v1', effectiveFrom: instant, observedAt: instant };
  const contract = { contractId: 'current:employee-test', employeeId: context.employeeId, schemeId: context.schemeId, slotId: 'slot-1', status: 'current', model: 'BMW 3 Series Touring 320i',
    vehicle: { configuration: '320i M Sport Touring', body: 'estate', fuel: 'petrol', seats: 5, boot: 500, mpg: 42.8, zeroTo62: 7.6, points: 1100, modelLine: 'G21 Touring', eligibilityModelKey: 'G21 Touring|320i' }, source };
  const input = (patch = {}) => ({ manualContext: { source, contracts: [contract], ...patch.manualContext }, contractId: 'current:employee-test', context: { ...context, entitlementSlotId: 'slot-1' }, now: instant, ...patch.args });
  const projected = projectCurrentCarBaseline(input());
  assert.equal(projected.contractId, 'current:employee-test'); assert.deepEqual(projected.source, { mode: 'synthetic', sourceVersion: 'manual-records-v1', observedAt: instant });
  assert.equal(projected.facts.modelLine.value, 'G21 Touring'); assert.equal(projected.facts.zeroTo62.unit, 's');
  assert.equal(projected.facts.body.provenance.assurance, 'synthetic-scenario');
  const sparse = projectCurrentCarBaseline(input({ manualContext: { contracts: [{ ...contract, vehicle: { body: 'estate' } }] } }));
  assert.deepEqual(Object.keys(sparse.facts), ['body']);
  for (const patch of [{ manualContext: { contracts: [contract, contract] } }, { manualContext: { contracts: [{ ...contract, status: 'returned' }] } },
    { manualContext: { contracts: [{ ...contract, employeeId: 'other' }] } }, { args: { contractId: 'current:other' } }, { args: { now: 'bad' } },
    { manualContext: { contracts: [{ ...contract, source: { ...source, observedAt: '2030-01-01T00:00:00.000Z' } }] } }]) {
    assert.equal(projectCurrentCarBaseline(input(patch)), null);
  }
});

test('generated-stock facts: without zeroTo62 an expressed Sportiness leaves improvement unknown; Body alone can prove it', async () => {
  // Generated stock carries body, fuel and sizeClass but no zeroTo62 or mpg; the baseline has no sizeClass or tags.
  const generated = stock(6, { modelLine: fact('F70 Sports Hatch'), eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatchback'),
    zeroTo62: fact(null, 's'), mpg: fact(null, 'mpg-imperial') });
  const sporty = { ...brief(), preferences: { body: preference(['hatchback', 'estate', 'suv']), fuel: preference('petrol', 50), sportiness: preference(100, 50) } };
  const unknown = byCar(await run(setup({ cars: [generated] }), { currentCarRating: rating(5) }, sporty))[6];
  assert.equal(unknown.feedback.improvement, 'unknown'); assert.equal(unknown.feedback.effect, 'omitted');
  const hatch = { ...brief(), preferences: { body: preference('hatchback'), fuel: preference('petrol', 50) } };
  const proven = byCar(await run(setup({ cars: [generated] }), { currentCarRating: rating(5) }, hatch))[6];
  assert.equal(proven.gateStatus, 'eligible'); assert.equal(proven.feedback.improvement, 'proven');
  assert.deepEqual(proven.reasons.find((r) => r.code === 'feedback-improvement').keys, ['body']);
});
