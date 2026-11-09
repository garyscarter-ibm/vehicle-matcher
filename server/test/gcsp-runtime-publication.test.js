import test from 'node:test';
import assert from 'node:assert/strict';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { PolicyService, FilePolicyProvider, MemoryPolicyProvider, PostgresPolicyProvider } from '../gcsp/policy/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { startHttpServer, cookieOf } from './helpers/employee-recommendation-http.js';
import { stock, fact, preference } from './helpers/employee-recommendation.js';
import { projectRecommendationFacts } from '../gcsp/manual-context/recommendation-facts.js';
import { saved } from './helpers/greg-demand-run.js';
import { good, response, now, adoptionCommand } from './helpers/gcsp-reviewed-runtime.js';
import { readFile } from 'node:fs/promises';
import { getReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';

const options = { mode: 'memory', environmentId: 'runtime-publish', policyAsOf: now,
  commandId: 'bootstrap', sessionNow: () => now };
// Greg's demand read fails closed without the reviewed decline registry; seed it so a publish at `now` stays valid.
const reviewedReasons = getReviewedDefinitionSet('offer-decline-reasons-v1').definitions.find((d) => d.key === 'offer.declineReasons.v1');
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
seed.assumptions.push({ ...seed.assumptions[0], key: reviewedReasons.key, value: reviewedReasons.value, unit: reviewedReasons.unit, status: reviewedReasons.status, basis: reviewedReasons.basis });
const reasonsPolicy = () => new PolicyService({ provider: new MemoryPolicyProvider({ seedProvider: { async loadVersions() { return [structuredClone(seed)]; } } }) });
async function open(t, overrides = {}) {
  const f = good(await createGcspRuntime({ ...options, ...overrides }));
  const session = await f.createLocalSession(); good(session);
  const http = await startHttpServer(f.dependencies);
  t.after(async () => { await http.close(); await f.close(); });
  const out = await http.request('/api/gcsp/session/switch', { session, body: { principalId: 'demo-greg', commandId: 'greg-http' } }); response(out);
  const greg = { value: { setCookie: out.headers.get('set-cookie') } };
  return { ...f, session, http, gregSession: greg };
}
const rows = async (f) => Object.fromEntries(await Promise.all(['briefs', 'stock', 'holds', 'offers', 'quotes', 'employees', 'entitlement_slots', 'decisions']
  .map(async (table) => [table, good(await f.repository.query(f.session.value.context, table))])));

async function canonicalSubject(f) {
  const context = f.session.value.context;
  const snapshot = await rows(f);
  const employee = snapshot.employees.find((row) => row.employeeId === context.employeeId);
  const slot = snapshot.entitlement_slots.find((row) => row.entitlementSlotId === context.entitlementSlotId);
  const brief = snapshot.briefs.find((row) => row.employeeId === context.employeeId && row.briefVersion === 1);
  const manual = employee.contract.manualContext;
  assert.equal(Object.hasOwn(manual.employeeFacts, 'driverEligible'), false);
  const contracts = manual.contracts.filter((row) => row.contractId === slot.contractId);
  assert.equal(contracts.length, 1); assert.equal(contracts[0].slotId, slot.entitlementSlotId);
  const drivers = manual.drivers.filter((row) => row.driverId === contracts[0].driverId);
  assert.equal(drivers.length, 1); assert.equal(drivers[0].employeeId, employee.employeeId);
  assert.equal(drivers[0].eligible.provenance.assurance, 'synthetic-scenario');
  const projected = good(projectRecommendationFacts({ context, employee, brief, slots: snapshot.entitlement_slots, now }));
  assert.deepEqual(projected.employeeFacts.driverEligible, drivers[0].eligible);
  assert.deepEqual(projected.employeeFacts.driverEligible, good(await f.provider.resolve(context)).employeeFacts.driverEligible);
  return { employee, slot, brief };
}

test('default Paula HTTP preparation preserves canonical driver parity and single-subject privacy suppression', async (t) => {
  const f = await open(t, { policy: reasonsPolicy() }); const context = f.session.value.context;
  response(await f.http.request('/api/gcsp/manual/account', { session: f.session }));
  const brief = saved();
  response(await f.http.request('/api/gcsp/brief/draft', { session: f.session,
    body: { commandId: 'default-draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief } }));
  response(await f.http.request('/api/gcsp/brief/confirm', { session: f.session,
    body: { commandId: 'default-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } } }));
  const candidate = stock(1, { modelLine: fact('G21 Touring') });
  good(await f.repository.transaction(context, { commandId: 'default-stock', inputDigest: inputDigest(candidate) }, (tx) => tx.insert('stock', {
    runId: context.runId, orderUuid: candidate.orderUuid, configurationId: candidate.configurationId, state: 'released', available: true,
    facts: candidate.snapshot, release: { availability: { ...candidate.availability, availableFrom: now } },
    visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } })));
  await canonicalSubject(f);
  const before = await rows(f);
  assert.equal(before.briefs.filter((row) => row.status === 'confirmed').length, 1);
  const employee = response(await f.http.request('/api/gcsp/recommendations', { session: f.session, body: { ...brief, briefVersion: 1 } }));
  assert.equal(employee.decisions[0].gateStatus, 'eligible');
  const demand = response(await f.http.request('/api/gcsp/greg/demand', { session: f.gregSession }));
  assert.deepEqual(demand.demand.unmet.byGate, []);
  const policy = response(await f.http.request('/api/gcsp/greg/policy', { session: f.gregSession }));
  const preview = response(await f.http.request('/api/gcsp/greg/policy/preview', { session: f.gregSession,
    body: { expectedActiveVersion: policy.activeVersion, changes: [{ id: 'weight:body', value: 0 }] } }));
  assert.equal(preview.active.fit.meanBestScore.status, 'suppressed');
  assert.equal(preview.draft.fit.meanBestScore.status, 'suppressed');
  assert.equal(preview.active.fit.meanBestScore.fewerThan, 5);
  await canonicalSubject(f); assert.deepEqual(await rows(f), before);
});

test('delivered memory runtime dependencies drive ordinary Greg publish and employee terms while protecting pinned history', async (t) => {
  const f = await open(t, { policy: reasonsPolicy() }); const context = f.session.value.context;
  assert.equal(f.dependencies.gcspRepository, f.repository); assert.equal(f.dependencies.gcspPolicy, f.policy);
  assert.equal(f.dependencies.gcspGreg, f.greg);
  assert.equal(f.dependencies.gcspGregPublish, f.gregPublish);
  let writes = 0;
  const write = async (work) => good(await f.repository.transaction(context,
    { commandId: `runtime-fixture:${++writes}`, inputDigest: inputDigest(writes) }, work));
  const release = async (id) => {
    const candidate = stock(id, { modelLine: fact('G21 Touring') });
    await write((tx) => tx.insert('stock', { runId: context.runId, orderUuid: candidate.orderUuid,
      configurationId: candidate.configurationId, state: 'released', available: true, facts: candidate.snapshot,
      release: { availability: { ...candidate.availability, availableFrom: now } },
      visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } }));
  };
  response(await f.http.request('/api/gcsp/manual/account', { session: f.session }));
  await release(1);
  const brief = saved(); brief.preferences.fuel = preference('diesel');
  response(await f.http.request('/api/gcsp/brief/draft', { session: f.session,
    body: { commandId: 'runtime-draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief } }));
  response(await f.http.request('/api/gcsp/brief/confirm', { session: f.session,
    body: { commandId: 'runtime-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } } }));
  // Additional stored subjects are synthetic cohort inputs, not authenticated default employees.
  const { employee, slot: canonicalSlot, brief: confirmed } = await canonicalSubject(f);
  const strip = ({ version, createdAt, updatedAt, ...row }) => row;
  await write(async (tx) => {
    for (let index = 2; index <= 5; index++) {
      const employeeId = `runtime-synthetic-${index}`; const entitlementSlotId = `slot:${employeeId}`;
      const rewrite = (value) => typeof value === 'string' ? value === context.entitlementSlotId ? entitlementSlotId
        : value.replaceAll(context.employeeId, employeeId).replaceAll(employee.name, `Synthetic subject ${index}`)
        : Array.isArray(value) ? value.map(rewrite) : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)])) : value;
      good(await tx.insert('employees', { ...rewrite(strip(employee)), employeeId, principalId: employeeId,
        entitlementSlotId, name: `Synthetic subject ${index}` }));
      good(await tx.insert('entitlement_slots', { ...rewrite(strip(canonicalSlot)), employeeId, entitlementSlotId }));
      good(await tx.insert('briefs', { ...rewrite(strip(confirmed)), employeeId, entitlementSlotId, confirmedBy: employeeId }));
    }
    return ok({ syntheticSubjects: 5 });
  });
  const request = { ...brief, briefVersion: 1 };
  const first = response(await f.http.request('/api/gcsp/recommendations', { session: f.session, body: request }));
  const pinned = first.recommendations[0]; assert.ok(pinned, JSON.stringify(first)); assert.equal(pinned.terms.points.value, 1100);
  await write(async (tx) => {
    await tx.insert('quotes', { runId: context.runId, quoteId: 'runtime-pinned', orderUuid: pinned.orderUuid,
      employeeId: context.employeeId, briefVersion: 1, policyVersion: pinned.versions.policy, terms: pinned.terms });
    await tx.insert('holds', { runId: context.runId, holdId: 'runtime-pinned', orderUuid: pinned.orderUuid,
      employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, type: 'buddy-offer', state: 'active',
      quoteId: 'runtime-pinned', policyVersion: pinned.versions.policy });
    await tx.insert('offers', { runId: context.runId, offerId: 'runtime-pinned', holdId: 'runtime-pinned', orderUuid: pinned.orderUuid,
      employeeId: context.employeeId, state: 'active', quoteId: 'runtime-pinned', briefVersion: 1, policyVersion: pinned.versions.policy });
    const ref = { table: 'stock', key: { runId: context.runId, orderUuid: pinned.orderUuid } };
    return tx.compareAndSwap(ref, good(await tx.get(ref)).version, { state: 'held', held: true, available: false });
  });
  await release(2);
  response(await f.http.request('/api/gcsp/greg/demand', { session: f.gregSession }));
  const projection = response(await f.http.request('/api/gcsp/greg/policy', { session: f.gregSession }));
  const price = projection.fields.find((row) => row.kind === 'price' && row.schemeId === context.schemeId && row.matchValue === 'G21 Touring|320i');
  assert.ok(price, JSON.stringify(projection.fields[0]));
  const input = { expectedActiveVersion: projection.activeVersion, changes: [{ id: price.id, value: 1200 }] };
  const before = await rows(f);
  for (const subject of before.employees.filter((row) => before.briefs.some((brief) => brief.employeeId === row.employeeId))) {
    assert.equal(Object.hasOwn(subject.contract.manualContext.employeeFacts, 'driverEligible'), false);
    const slot = before.entitlement_slots.find((row) => row.employeeId === subject.employeeId);
    assert.ok(subject.contract.manualContext.contracts.some((row) => row.contractId === slot.contractId && row.slotId === slot.entitlementSlotId));
  }
  const weighted = response(await f.http.request('/api/gcsp/greg/policy/preview', { session: f.gregSession,
    body: { expectedActiveVersion: projection.activeVersion, changes: [{ id: 'weight:body', value: 0 }] } }));
  assert.equal(weighted.active.fit.meanBestScore.status, 'available');
  assert.equal(weighted.draft.fit.meanBestScore.status, 'available');
  assert.ok(weighted.active.fit.meanBestScore.value > weighted.draft.fit.meanBestScore.value);
  assert.deepEqual(weighted.active.demand.demand.unmet.byGate, weighted.draft.demand.demand.unmet.byGate);
  assert.deepEqual(await rows(f), before);
  response(await f.http.request('/api/gcsp/greg/policy/preview', { session: f.gregSession, body: input }));
  assert.deepEqual(await rows(f), before);
  const published = response(await f.http.request('/api/gcsp/greg/policy/publish', { session: f.gregSession, body: {
    ...input, commandId: 'runtime-publish', policyVersion: 'runtime-policy-v2', effectiveFrom: projection.asOf } }));
  assert.equal(published.accepted, true); assert.equal(published.activationRequired, false); assert.equal(published.heldOffers.count, 1);
  const refreshed = response(await f.http.request('/api/gcsp/context', { session: f.session }));
  assert.equal(refreshed.policyVersion, published.policyVersion);
  const next = response(await f.http.request('/api/gcsp/recommendations', { session: f.session, body: request }));
  assert.equal(next.versions.policy, published.policyVersion); assert.equal(next.recommendations[0].terms.points.value, 1200);
  assert.deepEqual(await rows(f), before); assert.deepEqual(before.quotes[0].terms, pinned.terms);
  assert.equal(good(await f.policy.getActiveVersion({ runId: context.runId, asOf: now })).policyVersion, published.policyVersion);
  const controls = response(await f.http.request('/api/gcsp/presenter/controls', { session: f.session }));
  assert.equal(controls.versions.policy, published.policyVersion);
});

test('combined runtime serves authenticated scenarios, canonical presenter step and real mechanics reset using original policy identity', async (t) => {
  const readPolicy = new PolicyService({ provider: new MemoryPolicyProvider() });
  const f = await open(t, { policy: readPolicy }); t.after(() => readPolicy.close());
  assert.notEqual(f.policy, readPolicy);
  assert.equal(f.dependencies.gcspScenarios, f.scenarios);
  assert.equal(f.dependencies.gcspOfferAccess, f.offerAccess);
  const oldEmployee = f.session.value.context;
  const catalogue = response(await f.http.request('/api/gcsp/presenter/scenarios', { session: f.session }));
  assert.deepEqual(catalogue.scenarios.filter((row) => row.kind === 'journey' && row.availability.available).map((row) => row.scenarioId), ['main-successful-journey', 'no-suitable-match', 'decline-then-change', 'offer-expires', 'data-unavailable', 'uncertain-handoff', 'uncertain-handoff-rejected', 'decline-then-change-waiting']);
  const controls = response(await f.http.request('/api/gcsp/presenter/controls', { session: f.session }));
  assert.equal(controls.controls.step.value, 60);
  const configured = good(await readPolicy.getAssumption('clock.presenter.stepSeconds', {
    runId: oldEmployee.runId, asOf: controls.now, policyVersion: controls.versions.policy }));
  assert.deepEqual(controls.controls.step, configured);
  const tick = response(await f.http.request('/api/gcsp/presenter/controls/tick', { session: f.session,
    body: { commandId: 'combined-step', expectedClockVersion: controls.clockVersion, mode: 'step' } }));
  assert.equal(Date.parse(tick.advance.now) - Date.parse(controls.now), configured.value * 1000);
  const handlers = ['manual-claim-expiry', 'buddy-expiry', 'lifecycle-appointments', 'lifecycle-approvals', 'lifecycle-documents',
    'lifecycle-return-appointments', 'renewal-risk-cases', 'selection-order-reconciliation', 'buddy-allocation', 'captured-outbox'];
  assert.deepEqual(tick.tick.handlerOrder.map((row) => row.handlerId), handlers);
  const state = response(await f.http.request('/api/gcsp/presenter/scenarios/current', { session: f.session }));
  const scenario = catalogue.scenarios.find((row) => row.kind === 'mechanics'); assert.ok(scenario);
  const reset = response(await f.http.request('/api/gcsp/presenter/scenarios/reset', { session: f.session, body: {
    commandId: 'combined-reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion,
    fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion } }));
  assert.notEqual(reset.runId, state.runId);
  assert.equal((await f.identity.requireRole(oldEmployee, 'employee')).status, 'stale-run');
  const stale = await f.http.request('/api/gcsp/context', { session: f.session });
  assert.equal(stale.status, 409); assert.equal(stale.json.status, 'stale-run');
  const presenter = good(await f.identity.createPresenterSession('combined-fresh-presenter'));
  const freshSession = { value: { setCookie: presenter.setCookie } };
  const fresh = response(await f.http.request('/api/gcsp/presenter/controls', { session: freshSession }));
  const after = response(await f.http.request('/api/gcsp/presenter/controls/tick', { session: freshSession,
    body: { commandId: 'combined-after-reset', expectedClockVersion: fresh.clockVersion, mode: 'step' } }));
  assert.deepEqual(after.tick.handlerOrder.map((row) => row.handlerId), handlers);
  assert.equal(fresh.controls.step.value, configured.value);
});

test('explicit file policy stays read-only under a memory runtime and caller policy is not closed', async (t) => {
  let closes = 0;
  const provider = new FilePolicyProvider();
  provider.close = async () => { closes++; return ok({ closed: true }); };
  const readPolicy = new PolicyService({ provider }); const f = await open(t, { policy: readPolicy });
  const context = good(await f.identity.resolveSession({ authorized: true, cookie: cookieOf(f.gregSession) }));
  assert.equal((await f.policy.adoptReviewedAssumptions(context, adoptionCommand())).code, 'unsupported-operation');
  const projection = response(await f.http.request('/api/gcsp/greg/policy', { session: f.gregSession }));
  const price = projection.fields.find((row) => row.kind === 'price');
  const refused = await f.http.request('/api/gcsp/greg/policy/publish', { session: f.gregSession, body: {
    commandId: 'file-refused', expectedActiveVersion: projection.activeVersion, policyVersion: 'file-policy-v2', effectiveFrom: now,
    changes: [{ id: price.id, value: price.value + 1 }] } });
  assert.equal(refused.status, 400); assert.equal(refused.json.code, 'unsupported-operation');
  await f.close(); await f.close(); assert.equal(closes, 0);
});

test('runtime closes default policy exactly once and retains the existing injected-repository lifecycle', async () => {
  const original = MemoryPolicyProvider.prototype.close; let policyCloses = 0; let repositoryCloses = 0;
  MemoryPolicyProvider.prototype.close = async function close() { policyCloses++; return original.call(this); };
  try {
    const repository = createMemoryRepository({ store: createMemoryStore() });
    const wrapped = { ...repository, async close() { repositoryCloses++; return repository.close(); } };
    const runtime = good(await createGcspRuntime({ ...options, repository: wrapped }));
    await runtime.close(); await runtime.close(); assert.equal(policyCloses, 1); assert.equal(repositoryCloses, 1);
    const failure = await createGcspRuntime({ ...options, repository: { open: async () => result('unavailable', {}), close: async () => { repositoryCloses++; } } });
    assert.equal(failure.status, 'unavailable'); assert.equal(policyCloses, 2); assert.equal(repositoryCloses, 2);
  } finally { MemoryPolicyProvider.prototype.close = original; }
});

test('explicit postgres policy failure never falls back to memory or file', async () => {
  const original = PostgresPolicyProvider.prototype.close; let closes = 0;
  PostgresPolicyProvider.prototype.close = async function close() { closes++; return original.call(this); };
  try {
    const result = await createGcspRuntime({ ...options, mode: 'postgres', repository: createMemoryRepository({ store: createMemoryStore() }),
      repositoryOptions: { connectionString: '' } });
    assert.equal(result.status, 'unavailable'); assert.equal(closes, 1);
  } finally { PostgresPolicyProvider.prototype.close = original; }
});
