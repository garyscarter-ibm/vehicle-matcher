import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEmployeeRecommendationService, createStoredSubjectRecommendationEvaluator } from '../gcsp/recommendation/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { context, instant, brief, stock, fact, essential, providerValue, provider, time, policy } from './helpers/employee-recommendation.js';

const { roles, ...baseSubject } = context;
const subject = () => structuredClone(baseSubject);
const ports = (extra = {}) => ({ provider: provider(), policy: policy(), time, ...extra });
const evaluate = (extra = {}, request = brief(), owner = subject()) => createStoredSubjectRecommendationEvaluator(ports(extra)).evaluate(owner, request);
const decision = (outcome) => outcome.value.decisions[0];
const preview = () => { const { briefVersion, ...content } = brief(); return { brief: content, baseBriefVersion: briefVersion, baseDraftVersion: 0 }; };

test('stored subject and authenticated consumer use exactly the same candidate calculation', async () => {
  const injected = ports(); const request = brief();
  const internal = await createStoredSubjectRecommendationEvaluator(injected).evaluate(subject(), request);
  const employee = await createEmployeeRecommendationService(injected).recommend(context, request);
  assert.equal(internal.status, 'ok'); assert.equal(decision(internal).gateStatus, 'eligible');
  assert.deepEqual(internal, employee);
});

test('public service retains employee guards and does not expose the internal evaluator', async () => {
  const service = createEmployeeRecommendationService(ports());
  assert.deepEqual(Object.keys(service).sort(), ['previewUnsaved', 'recommend']);
  for (const invalid of [undefined, null, subject(), { ...context, roles: [] }, { ...context, roles: ['greg'] }]) {
    assert.equal((await service.recommend(invalid, brief())).status, 'forbidden');
    assert.equal((await service.previewUnsaved(invalid, preview())).status, 'forbidden');
  }
  assert.equal((await service.recommend({ roles: ['employee'] }, brief())).status, 'invalid');
  assert.equal((await service.previewUnsaved(context, { ...preview(), subject: subject() })).status, 'invalid');
  assert.equal((await createEmployeeRecommendationService().recommend(undefined, brief())).status, 'unavailable');
});

test('internal subject is an exact data shape and refuses session, role and authority overrides before ports run', async () => {
  let calls = 0;
  const evaluator = createStoredSubjectRecommendationEvaluator(ports({ time: { now() { calls += 1; throw Error('must not read'); } } }));
  for (const owner of [null, [], {}, ...Object.keys(baseSubject).map((key) => {
    const copy = subject(); delete copy[key]; return copy;
  }), ...['roles', 'session', 'token', 'principalId', 'entitlementSlotId', 'provider', 'confirmed', 'clock'].map((key) => ({ ...subject(), [key]: 'override' }))]) {
    assert.equal((await evaluator.evaluate(owner, brief())).status, 'invalid');
  }
  assert.equal(calls, 0);
});

test('provider and time receive one frozen subject snapshot and caller mutation cannot change the evaluation', async () => {
  const owner = subject(); const request = brief(); const original = structuredClone(owner); let observed;
  const outcome = await evaluate({
    time: { async now(bound) {
      observed = bound; assert.equal(Object.isFrozen(bound), true); assert.deepEqual(bound, original);
      owner.employeeId = 'changed'; owner.gradeId = 'unknown'; request.essentials.seats.value = 99;
      return { status: 'ok', value: { now: instant, runId: original.runId, clockVersion: 'clock-v1' } };
    } },
    provider: { async resolve(bound) { assert.equal(bound, observed); assert.deepEqual(bound, original); return { status: 'ok', value: providerValue() }; } },
  }, request, owner);
  assert.equal(outcome.status, 'ok'); assert.equal(decision(outcome).gateStatus, 'eligible');
  assert.equal(decision(outcome).brief.essentials.seats.value, 5);
});

for (const field of ['runId', 'environmentId', 'employeeId']) {
  test(`provider ${field} mismatch refuses the stored subject`, async () => {
    assert.equal((await evaluate({ provider: provider({ ...providerValue(), [field]: 'another' }) })).status, 'stale-run');
  });
}

test('clock run mismatch and stale/unavailable clock never become candidate success', async () => {
  for (const supplied of [
    { status: 'ok', value: { now: instant, runId: 'retired-run', clockVersion: 'clock-v1' } },
    { status: 'stale-run' }, { status: 'unavailable' },
  ]) assert.equal((await evaluate({ time: { async now() { return supplied; } } })).status, supplied.status === 'unavailable' ? 'unavailable' : 'stale-run');
});

test('current company, grade and policy facts remain authoritative without creating a session', async () => {
  for (const key of ['companyId', 'schemeId', 'gradeId']) assert.equal((await evaluate({}, brief(), { ...subject(), [key]: 'unknown' })).status, 'invalid');
  assert.equal((await evaluate({}, brief(), { ...subject(), policyVersion: 'unknown' })).status, 'unavailable');
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const allowance = seed.allowances.find((row) => row.companyId === context.companyId && row.schemeId === context.schemeId && row.gradeId === context.gradeId);
  allowance.monthlyPoints = 1; allowance.value = 1;
  const changed = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const outcome = await evaluate({ policy: changed }); assert.equal(outcome.status, 'ok');
  assert.equal(decision(outcome).gateStatus, 'ineligible'); assert.equal(decision(outcome).blockers.some((row) => row.code === 'allowance-exceeded'), true);
});

test('wrong resolved policy version cannot masquerade as the pinned stored-subject version', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const supplied = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const wrong = Object.fromEntries(['getAllowance', 'getAssumption', 'getEligibility', 'getPointsCost'].map((method) => [method, async (...args) => {
    const outcome = await supplied[method](...args); return { ...outcome, policyVersion: 'another-policy' };
  }]));
  assert.equal((await evaluate({ policy: wrong })).status, 'unavailable');
});

test('the shared essentials and charging gates remain effective for stored subjects', async () => {
  const small = await evaluate({}, { ...brief(), essentials: { seats: essential(9) } });
  assert.equal(decision(small).gateStatus, 'ineligible');
  const supplied = providerValue([stock(1, { fuel: fact('ev') })]); supplied.employeeFacts.charging = fact('none');
  assert.equal(decision(await evaluate({ provider: provider(supplied) })).gateStatus, 'ineligible');
  const unknown = await evaluate({ provider: provider(providerValue([stock(1, { seats: fact(null, 'count') })])) });
  assert.equal(decision(unknown).gateStatus, 'needs-confirmation'); assert.equal(unknown.value.recommendations.length, 0);
});

test('unknown/unavailable sources retain explicit failures', async () => {
  const supplied = providerValue(); delete supplied.employeeFacts.driverEligible;
  assert.equal(decision(await evaluate({ provider: provider(supplied) })).gateStatus, 'needs-confirmation');
  for (const injected of [{ provider: undefined }, { policy: undefined }, { time: undefined },
    { provider: { resolve() { throw Error('provider error'); } } }, { provider: provider({ ...providerValue(), stock: null }) }]) {
    assert.equal((await evaluate(injected)).status, 'unavailable');
  }
  assert.equal((await evaluate({ provider: provider({}) })).status, 'stale-run');
});

test('stored evaluator cannot escalate drafts into a preview or confer state-write authority', async () => {
  const request = brief(); request.essentials.seats.state = 'draft';
  const supplied = providerValue(); const before = structuredClone(supplied); let writes = 0;
  const evaluator = createStoredSubjectRecommendationEvaluator(ports({ provider: { async resolve() { return { status: 'ok', value: supplied }; }, write() { writes += 1; } } }));
  assert.deepEqual(Object.keys(evaluator), ['evaluate']);
  const outcome = await evaluator.evaluate(subject(), request); assert.equal(outcome.status, 'ok');
  assert.equal(decision(outcome).gateStatus, 'needs-confirmation'); assert.equal(decision(outcome).brief.essentials.seats.state, 'draft');
  assert.equal(outcome.value.preview, undefined); assert.equal(decision(outcome).preview, undefined);
  assert.equal((await evaluator.evaluate(subject(), { ...brief(), preview: { approved: true } })).status, 'invalid');
  assert.equal((await evaluator.evaluate(subject(), { ...brief(), briefVersion: 0 })).status, 'invalid');
  assert.equal(writes, 0); assert.deepEqual(supplied, before);
});
