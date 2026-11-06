import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { loadComparisonPolicy, generateComparisonInputs } from '../gcsp/comparison/generator.js';
import { openComparisonRun } from '../gcsp/comparison/harness.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/gcsp-comparison-current-outcomes.json', import.meta.url), 'utf8'));
const proposal = JSON.parse(await readFile(new URL('../../docs/gcsp/fucq134-outcome-policy-proposal.json', import.meta.url), 'utf8'));
async function mechanics(seed = fixture.seed) {
  const provider = new FilePolicyProvider();
  const [canonical] = await provider.loadVersions({ runId: 'comparison-fixture-preparation', asOf: '2026-11-05T09:00:00.000Z' });
  const input = structuredClone(canonical);
  input.policyVersion += fixture.policyVariantSuffix;
  for (const collection of ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions']) {
    for (const row of input[collection]) row.policyVersion = input.policyVersion;
  }
  // This is an explicitly selected test policy variant, never a runtime fallback registry.
  for (const proposed of proposal.assumptions) {
    assert.equal(proposed.status, 'assumed');
    assert.equal(input.assumptions.some((row) => row.key === proposed.key), false);
    input.assumptions.push({ key: proposed.key, value: structuredClone(proposed.proposedValue), unit: proposed.unit,
      status: proposed.status, basis: proposed.basis, source: proposed.source, sourceDate: proposed.sourceDate,
      policyVersion: input.policyVersion, effectiveFrom: input.effectiveFrom });
  }
  const policy = new PolicyService({ provider: { async loadVersions() { return structuredClone([input]); } } });
  const origin = input.assumptions.find((row) => row.key === 'comparison.startsAt').value;
  const snapshot = await loadComparisonPolicy({ policyService: policy, policyRead: {
    runId: 'comparison-fixture-preparation', asOf: origin, policyVersion: input.policyVersion } });
  return { policy, inputs: generateComparisonInputs(seed, snapshot, { overlay: fixture.overlay }),
    route: 'current', codeRevision: globalThis.comparisonCodeRevision ?? 'fucq134-unadmitted-direct-run' };
}
const requireOk = (result) => { assert.equal(result.status, 'ok', JSON.stringify(result)); return result.value; };
async function claimFirst(run) {
  const employee = run.inputs.employees[0];
  const context = run.employeeContext(employee.employeeId);
  const browsed = requireOk(await run.claims.browseStock(context));
  assert.equal(browsed.ranked, false);
  assert.equal(browsed.cars.length, run.inputs.stock.length);
  const result = requireOk(await run.claims.claim(context, { commandId: 'mechanics-claim', ...browsed.cars[0].claimInput }));
  return { context, result };
}
async function action(run, context, commandId) {
  const current = requireOk(await run.claims.readClaim(context));
  return { commandId, holdId: current.hold.holdId, expectedHoldVersion: current.hold.version,
    expectedDraftVersion: current.quote.draftVersion };
}

test('isolation', async (t) => {
  const sentinel = await openComparisonRun(await mechanics('fucq134-live-sentinel'));
  t.after(() => sentinel.close());
  const before = await sentinel.snapshot();
  const run = await openComparisonRun(await mechanics());
  t.after(() => run.close());
  assert.notEqual(run.repository, sentinel.repository);
  assert.notEqual(run.metadata.runId, sentinel.metadata.runId);
  requireOk(await run.release(run.inputs.releaseSchedule[0].releaseId));
  await claimFirst(run);
  assert.deepEqual(await sentinel.snapshot(), before);
  const after = await run.snapshot();
  assert.equal(after.holds.length, 1);
  assert.equal(after.notification_outbox.length, fixture.expected.outboxJobs);
  assert.equal(before.notification_outbox.length, 0);
  assert.equal(run.transport.constructor.name, 'CapturedTransport');
  await assert.rejects(openComparisonRun({ ...await mechanics(), repository: sentinel.repository }), /invalid-input: options/);
});

test('real-claim-review-allocate', async (t) => {
  const run = await openComparisonRun(await mechanics());
  t.after(() => run.close());
  requireOk(await run.release(run.inputs.releaseSchedule[0].releaseId));
  const { context, result } = await claimFirst(run);
  assert.equal(result.state, fixture.expected.afterClaim);
  const read = { runId: context.runId, asOf: result.now, policyVersion: context.policyVersion };
  const duration = requireOk(await run.policy.getAssumption('hold.cart.durationSeconds', read));
  assert.equal(Date.parse(result.hold.expiresAt) - Date.parse(result.now), duration.value * 1000);
  const reviewed = requireOk(await run.claims.beginReview(context, await action(run, context, 'mechanics-review')));
  assert.equal(reviewed.hold.phase, fixture.expected.reviewPhase);
  const reviewDuration = requireOk(await run.policy.getAssumption('hold.cart.orderReview.durationSeconds', read));
  assert.equal(Date.parse(reviewed.hold.expiresAt) - Date.parse(reviewed.hold.reviewStartedAt), reviewDuration.value * 1000);
  const allocated = requireOk(await run.claims.allocate(context, await action(run, context, 'mechanics-allocate')));
  assert.equal(allocated.state, fixture.expected.afterAllocation);
  const persisted = await run.snapshot();
  assert.equal(persisted.holds[0].state, 'allocated');
  assert.equal(persisted.claims[0].state, 'allocated');
  assert.equal(persisted.stock.find((car) => car.orderUuid === allocated.hold.orderUuid).state, 'allocated');
  assert.equal(persisted.entitlement_slots.find((slot) => slot.employeeId === context.employeeId).state, 'allocated');
  assert.equal(persisted.notification_outbox.length, 0);
  assert.equal(allocated.quote.facts.identityKind, 'exact-stock');
  assert.equal(allocated.quote.facts.sourceKeys.stockId, allocated.hold.orderUuid);
  assert.equal(allocated.quote.facts.facts.seats.provenance.assurance, 'synthetic-scenario');
  assert.equal(Object.hasOwn(allocated.quote.facts, 'vin'), false);
});

test('untaken-expiry', async (t) => {
  const run = await openComparisonRun(await mechanics());
  t.after(() => run.close());
  requireOk(await run.release(run.inputs.releaseSchedule[0].releaseId));
  const { context, result } = await claimFirst(run);
  requireOk(await run.advanceTo(result.hold.expiresAt));
  const tick = requireOk(await run.tick('mechanics-exact-expiry'));
  assert.equal(tick.state, 'completed');
  assert.ok(tick.handlerOrder.includes('manual-claim-expiry'));
  const expired = requireOk(await run.claims.readClaim(context));
  assert.equal(expired.state, fixture.expected.afterUntakenDeadline);
  const persisted = await run.snapshot();
  assert.equal(persisted.claims[0].state, 'expired');
  assert.equal(persisted.stock.find((car) => car.orderUuid === expired.hold.orderUuid).state, fixture.expected.returnedStock);
  assert.equal(persisted.stock.find((car) => car.orderUuid === expired.hold.orderUuid).available, true);
  assert.equal(requireOk(await run.claims.browseStock(context)).cars.length, run.inputs.stock.length);
  assert.equal(persisted.notification_outbox.length, 0);
});
