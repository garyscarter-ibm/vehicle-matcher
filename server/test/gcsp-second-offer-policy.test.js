import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPolicyService } from '../gcsp/policy/index.js';
import { FOLLOWUP_QUESTIONS_KEY, followupChange, readFollowupQuestion } from '../gcsp/offers/followup-policy.js';

const RUN_ID = 'followup-policy-test';
const AS_OF = '2026-11-06T12:00:00.000Z';
const canonical = createPolicyService();
const active = await canonical.getActiveVersion({ runId: RUN_ID, asOf: AS_OF });
assert.equal(active.status, 'ok');
const read = { runId: RUN_ID, asOf: AS_OF, policyVersion: active.policyVersion };
const bundle = JSON.parse(await readFile(new URL('../gcsp/offers/followup-policy-definitions.json', import.meta.url), 'utf8'));
const bundleQuestionSet = bundle.definitions.find((row) => row.key === FOLLOWUP_QUESTIONS_KEY)?.value;
const typedReasons = { schemaVersion: 1, reasons: [
  { code: 'body-style', label: 'Body style', attribute: 'body' },
  { code: 'size', label: 'Size', attribute: 'sizeClass' },
  { code: 'fuel', label: 'Fuel', attribute: 'fuel' },
  { code: 'equipment', label: 'Equipment', attribute: 'equipment' },
] };
const TEST_POLICY_METADATA = { status: 'assumed', basis: 'Scoped follow-up policy test input.',
  source: 'server/test/gcsp-second-offer-policy.test.js', sourceDate: '2026-11-06' };

function response(key, value, policyVersion = read.policyVersion) {
  return { status: 'ok', policyVersion, value: { key, value: structuredClone(value), ...TEST_POLICY_METADATA } };
}

function testPolicy({ overrides = {}, missing = null, mixedVersion = null, throws = null } = {}) {
  const calls = [];
  return {
    calls,
    async getAssumption(key, pinnedRead) {
      calls.push({ key, read: structuredClone(pinnedRead) });
      if (throws === key) throw new Error('provider secret must not escape');
      if (missing === key) return { status: 'invalid', policyVersion: pinnedRead.policyVersion, code: 'unknown-assumption' };
      if (Object.hasOwn(overrides, key)) return response(key, overrides[key], mixedVersion === key ? 'other-policy-version' : pinnedRead.policyVersion);
      return canonical.getAssumption(key, pinnedRead);
    },
  };
}

async function fixture() {
  const policy = testPolicy({ overrides: {
    [FOLLOWUP_QUESTIONS_KEY]: bundleQuestionSet,
    'offer.declineReasons.v1': typedReasons,
  } });
  const [registry, minimum, maximum] = await Promise.all([
    canonical.getAssumption('employee.recommendation.v1', read),
    canonical.getAssumption('brief.slider.minimum', read),
    canonical.getAssumption('brief.slider.maximum', read),
  ]);
  assert.equal(registry.status, 'ok'); assert.equal(minimum.status, 'ok'); assert.equal(maximum.status, 'ok');
  const config = registry.value.value;
  const preferences = {};
  for (const key of ['body', 'size', 'fuel']) {
    const definition = config.preferences[key];
    assert.ok(definition, `registered preference ${key} is available`);
    preferences[key] = { value: definition.type === 'slider' ? 50 : definition.values[0], importance: 50,
      valueState: 'confirmed', importanceState: 'confirmed', source: 'employee' };
  }
  const equipment = config.essentials.equipment;
  assert.deepEqual({ type: equipment?.type, operator: equipment?.operator, unit: equipment?.unit },
    { type: 'list', operator: 'includes', unit: 'equipment-key' });
  const brief = { schemaVersion: 1, briefVersion: 4, preferences, essentials: { equipment: {
    operator: equipment.operator, unit: equipment.unit, value: ['current-feature'], state: 'confirmed', source: 'employee',
  } } };
  return { policy, config, brief, minimum: minimum.value.value, maximum: maximum.value.value };
}

const questionFor = async (f, reasonCode) => {
  const outcome = await readFollowupQuestion({ policy: f.policy, read, reasonCode, brief: f.brief });
  assert.equal(outcome.status, 'ok', JSON.stringify(outcome));
  return outcome.value;
};

test('reads all five canonical assumptions through PolicyService at the same pinned version', async () => {
  const f = await fixture();
  const before = structuredClone(f.brief);
  const question = await questionFor(f, 'body-style');
  assert.equal(question.policyVersion, read.policyVersion);
  assert.equal(question.provenance.key, FOLLOWUP_QUESTIONS_KEY);
  assert.deepEqual(new Set(f.policy.calls.map((call) => call.key)), new Set([
    FOLLOWUP_QUESTIONS_KEY, 'employee.recommendation.v1', 'brief.slider.minimum', 'brief.slider.maximum',
    'offer.declineReasons.v1',
  ]));
  assert.ok(f.policy.calls.every((call) => call.read.policyVersion === read.policyVersion));
  assert.deepEqual(f.brief, before);
  assert.equal(typeof question.questionVersion, 'string');
});

test('projects one question for every canonical typed reason and binds the current value and brief version', async () => {
  const f = await fixture();
  for (const reason of typedReasons.reasons) {
    const question = await questionFor(f, reason.code);
    assert.equal(question.reasonCode, reason.code);
    assert.equal(question.path, bundleQuestionSet.questions.find((row) => row.reasonCode === reason.code).path);
    assert.deepEqual(question.currentValue, question.path === 'essentials.equipment'
      ? f.brief.essentials.equipment.value : f.brief.preferences[question.path.split('.')[1]].value);
    assert.ok(question.questionVersion);
    if (reason.code === 'size') {
      assert.equal(question.control.kind, 'slider');
      assert.deepEqual([question.control.minimum, question.control.maximum], [0, 100]);
    }
    if (reason.code === 'equipment') assert.equal(question.control.kind, 'equipment');
  }
  assert.deepEqual([f.minimum, f.maximum], [0, 100]);
});

test('missing, malformed and mixed-version canonical policy reads fail closed', async () => {
  const f = await fixture();
  const missing = await readFollowupQuestion({ policy: testPolicy({ missing: 'offer.declineReasons.v1' }), read,
    reasonCode: 'body-style', brief: f.brief });
  assert.equal(missing.status, 'unavailable'); assert.equal(missing.code, 'followup-policy-unavailable');

  const malformed = await readFollowupQuestion({ policy: testPolicy({ overrides: {
    [FOLLOWUP_QUESTIONS_KEY]: { schemaVersion: 1, questions: [...bundleQuestionSet.questions.slice(1)] },
    'offer.declineReasons.v1': typedReasons,
  } }), read, reasonCode: 'body-style', brief: f.brief });
  assert.equal(malformed.status, 'unavailable'); assert.equal(malformed.code, 'followup-policy-unavailable');

  const mixed = await readFollowupQuestion({ policy: testPolicy({ overrides: {
    [FOLLOWUP_QUESTIONS_KEY]: bundleQuestionSet, 'offer.declineReasons.v1': typedReasons,
  }, mixedVersion: 'brief.slider.maximum' }), read, reasonCode: 'body-style', brief: f.brief });
  assert.equal(mixed.status, 'unavailable'); assert.equal(mixed.code, 'followup-policy-unavailable');
});

test('unregistered reasons are invalid and absent or unconfirmed targets are unavailable', async () => {
  const f = await fixture();
  const unknown = await readFollowupQuestion({ policy: f.policy, read, reasonCode: 'other', brief: f.brief });
  assert.equal(unknown.status, 'invalid'); assert.equal(unknown.code, 'invalid-followup-reason');

  const missing = structuredClone(f.brief); delete missing.preferences.body;
  const unavailable = await readFollowupQuestion({ policy: f.policy, read, reasonCode: 'body-style', brief: missing });
  assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.code, 'followup-target-unavailable');

  const unconfirmed = structuredClone(f.brief); unconfirmed.essentials.equipment.state = 'needs-confirmation';
  const equipment = await readFollowupQuestion({ policy: f.policy, read, reasonCode: 'equipment', brief: unconfirmed });
  assert.equal(equipment.status, 'unavailable'); assert.equal(equipment.code, 'followup-target-unavailable');
});

test('option and slider changes accept only projected values and leave input brief unchanged', async () => {
  const f = await fixture();
  const before = structuredClone(f.brief);
  const body = await questionFor(f, 'body-style');
  const nextBody = body.control.options.find((option) => option.value !== body.currentValue)?.value;
  assert.ok(nextBody);
  const changedBody = followupChange(body, nextBody, f.brief);
  assert.equal(changedBody.status, 'ok');
  assert.deepEqual(changedBody.value, { path: body.path, value: nextBody });
  assert.equal(followupChange(body, 'unregistered', f.brief).status, 'invalid');
  assert.equal(followupChange({ ...body, path: 'orders.id' }, nextBody, f.brief).status, 'invalid');

  const size = await questionFor(f, 'size');
  assert.equal(followupChange(size, 70, f.brief).status, 'ok');
  assert.equal(followupChange(size, 70.5, f.brief).status, 'invalid');
  assert.equal(followupChange(size, 101, f.brief).status, 'invalid');
  assert.deepEqual(f.brief, before);
});

test('equipment changes preserve the registered essential shape and compare sets for no-op answers', async () => {
  const f = await fixture();
  const question = await questionFor(f, 'equipment');
  const changed = followupChange(question, [], f.brief);
  assert.equal(changed.status, 'ok');
  assert.deepEqual(changed.value, { path: question.path, value: {
    operator: f.brief.essentials.equipment.operator, unit: f.brief.essentials.equipment.unit,
    state: 'confirmed', source: 'employee', value: [],
  } });
  assert.equal(followupChange(question, ['current-feature'], f.brief).status, 'invalid');
  assert.equal(followupChange(question, ['current-feature'], f.brief).reasons[0].reason, 'Choose a different equipment set.');
  const reorderedBrief = structuredClone(f.brief);
  reorderedBrief.essentials.equipment.value = ['second-feature', 'current-feature'];
  const reorderedQuestion = await readFollowupQuestion({ policy: f.policy, read, reasonCode: 'equipment', brief: reorderedBrief });
  assert.equal(reorderedQuestion.status, 'ok');
  assert.equal(followupChange(reorderedQuestion.value, ['current-feature', 'second-feature'], reorderedBrief).status, 'invalid');
  assert.equal(followupChange(question, ['bad item '], f.brief).status, 'invalid');
  assert.equal(followupChange(question, ['x'.repeat(question.control.maximumItemLength + 1)], f.brief).status, 'invalid');
  assert.equal(followupChange(question, Array(question.control.maximumItems + 1).fill('feature'), f.brief).status, 'invalid');
  assert.equal(followupChange(question, ['same', 'same'], f.brief).status, 'invalid');
});

test('provider exceptions are sanitized to a typed unavailable result', async () => {
  const f = await fixture();
  const outcome = await readFollowupQuestion({ policy: testPolicy({ throws: 'employee.recommendation.v1' }), read,
    reasonCode: 'body-style', brief: f.brief });
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.code, 'followup-policy-unavailable');
  assert.doesNotMatch(JSON.stringify(outcome), /provider secret/);
});
