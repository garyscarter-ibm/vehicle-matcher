import test from 'node:test';
import assert from 'node:assert/strict';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { getReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
import { adoptOfferJourneyPolicy } from '../gcsp/policy/offer-journey-adoption.js';

const KEYS = ['offer.declineReasons.v1', 'offer.followupQuestions.v1'];
const good = (outcome) => { assert.equal(outcome?.status, 'ok', outcome?.code ?? outcome?.reason); return outcome.value; };
const open = async (t, extra) => {
  const runtime = good(await createGcspRuntime({ mode: 'memory', environmentId: 'offer-journey-adoption',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'offer-journey-bootstrap', ...extra }));
  t.after(() => runtime.close());
  const employee = good(await runtime.createLocalSession()).context;
  const now = good(await runtime.clock.now(employee)).now;
  const reads = await Promise.all(KEYS.map((key) => runtime.policy.getAssumption(key,
    { runId: employee.runId, asOf: now, policyVersion: employee.policyVersion })));
  return { runtime, employee, reads };
};

test('the combined offer journey set is the two reviewed offer sets, row for row', () => {
  const combined = getReviewedDefinitionSet('offer-journey-v1');
  assert.deepEqual(combined.definitions, [...getReviewedDefinitionSet('offer-decline-reasons-v1').definitions,
    ...getReviewedDefinitionSet('offer-followup-questions-v1').definitions]);
});

test('demo startup adopts decline reasons and follow-up questions through PolicyService', async (t) => {
  const { runtime, employee, reads } = await open(t, { adoptOfferJourney: true });
  assert.equal(employee.policyVersion, 'gcsp-policy-v1+offer-journey-v1');
  reads.forEach((read, i) => { assert.equal(read.status, 'ok');
    assert.deepEqual(read.value.value, getReviewedDefinitionSet('offer-journey-v1').definitions[i].value); });
  // A second call finds the keys already active and publishes nothing.
  const again = good(await adoptOfferJourneyPolicy({ policy: runtime.policy, identity: runtime.identity, clock: runtime.clock }));
  assert.equal(again.adopted, false); assert.equal(again.policyVersion, employee.policyVersion);
});

test('runtimes that do not opt in keep the seed policy unchanged', async (t) => {
  const { employee, reads } = await open(t, {});
  assert.equal(employee.policyVersion, 'gcsp-policy-v1');
  assert.ok(reads.every((read) => read.status !== 'ok'));
});
