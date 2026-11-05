import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, result } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { RenewalCaseService } from '../gcsp/cases/index.js';
import { createCaseRoutes } from '../gcsp/cases/http.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { preference, essential, stock, providerValue, fact } from './helpers/employee-recommendation.js';
const command = (id) => ({ commandId: id, inputDigest: inputDigest(id) });
async function setup(t, extension = false, confirmBrief = true) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store }); await repository.open();
  let policy = createPolicyService();
  if (extension) {
    const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
    seed.assumptions.find((a) => a.key === 'renewalCase.extension.permitted').value = true;
    policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  }
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'options-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok');
  const { identity, clock } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const context = (await identity.switchPrincipal(presenter, 'demo-paula', 'paula')).value.context;
  const greg = (await identity.switchPrincipal(presenter, 'demo-greg', 'greg')).value.context;
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context })).status, 'ok');
  const brief = new BriefService({ repository, policy, clock, identity });
  const configuration = { repository, policy, clock, identity };
  const service = new RenewalCaseService(configuration);
  const c = (await service.requestHelp(context, { commandId: 'help', reason: 'Please review my renewal.' })).value.case;
  const draft = { schemaVersion: 1, preferences: { body: preference('estate'), comfort: preference(75, 0) },
    essentials: { seats: essential(5), charging: { value: null, operator: 'equals', unit: null, state: 'needs-confirmation', source: 'employee' } } };
  if (confirmBrief) {
  assert.equal((await brief.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: draft })).status, 'ok');
  assert.equal((await brief.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } })).status, 'ok');
  }
  assert.equal((await clock.advance(presenter, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 })).status, 'ok');
  await repository.transaction(context, command('facts'), async (tx) => {
    const ref = { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } };
    const row = (await tx.get(ref)).value;
    return tx.compareAndSwap(ref, row.version, { contract: { ...row.contract,
      manualContext: { ...row.contract.manualContext, employeeFacts: providerValue().employeeFacts } } });
  });
  t.after(() => repository.close());
  return { repository, store, policy, identity, clock, presenter, context, greg, brief, service, configuration, c };
}
const read = (f) => f.service.readOptions(f.greg, { caseId: f.c.caseId });
async function car(f, id, facts = {}, extra = {}) {
  const candidate = stock(id, facts);
  const inserted = await f.repository.transaction(f.context, command(`car:${id}`), (tx) => tx.insert('stock', {
    runId: f.context.runId, orderUuid: candidate.orderUuid, orderNumber: `OPTION-${id}`, configurationId: candidate.configurationId,
    state: 'available', available: true, facts: { recommendationCandidate: candidate }, ...extra }));
  assert.equal(inserted.status, 'ok', JSON.stringify(inserted)); return candidate;
}
async function decline(f, id = 'decline') {
  return f.repository.transaction(f.context, command(id), (tx) => tx.insert('decisions', { runId: f.context.runId,
    decisionId: id, employeeId: f.context.employeeId, offerId: 'old-offer', decision: 'decline', versions: { brief: 1 } }));
}
test('options require trusted Greg/presenter and current run; route allows only caseId', async (t) => {
  const f = await setup(t);
  assert.equal((await f.service.readOptions(f.context, { caseId: f.c.caseId })).status, 'forbidden');
  assert.equal((await f.service.readOptions({ ...f.greg, runId: 'foreign' }, { caseId: f.c.caseId })).status, 'forbidden');
  assert.equal((await f.service.readOptions(f.presenter, { caseId: f.c.caseId })).status, 'ok');
  assert.equal((await f.service.readOptions(f.greg, {})).status, 'invalid');
  const route = createCaseRoutes(f.service).find((r) => r.path.endsWith('/cases/options'));
  assert.equal(route.method, 'GET');
  assert.equal((await route.handle({ context: f.greg, searchParams: new URLSearchParams({ caseId: f.c.caseId, employeeId: 'foreign' }) })).code, 'unsupported-query');
  assert.equal((await route.handle({ context: f.greg, searchParams: new URLSearchParams({ caseId: f.c.caseId }) })).status, 'ok');
});
test('read options is side-effect free, evaluates exact cars and excludes unsuitable, unavailable and held cars', async (t) => {
  const f = await setup(t);
  const suitable = await car(f, 880);
  await car(f, 881, { seats: fact(2, 'count') });
  await car(f, 882, {}, { state: 'allocated', allocated: true });
  const held = await car(f, 883);
  assert.equal((await f.repository.transaction(f.context, command('hold'), async (tx) => {
    await tx.insert('quotes', { runId: f.context.runId, quoteId: 'held-quote', employeeId: f.context.employeeId, orderUuid: held.orderUuid });
    return tx.insert('holds', {
    runId: f.context.runId, holdId: 'hold', orderUuid: held.orderUuid, employeeId: f.context.employeeId,
    entitlementSlotId: f.context.entitlementSlotId, renewalId: f.c.renewalId, type: 'buddy-offer', state: 'active', quoteId: 'held-quote',
    expiresAt: '2026-11-06T12:00:00.000Z', policyVersion: f.context.policyVersion }); })).status, 'ok');
  const before = structuredClone(f.store.state);
  const options = await read(f); assert.equal(options.status, 'ok', JSON.stringify(options));
  assert.deepEqual(options.value.options.alternativeCars.items.map((c) => c.orderUuid), [suitable.orderUuid]);
  assert.equal(options.value.asOf, '2026-11-05T12:00:00.000Z');
  assert.equal(options.value.policyVersion, f.context.policyVersion);
  assert.equal(options.value.options.manualDecision.requiresDecision, true);
  assert.equal(options.value.automaticRecoveryPriority, false);
  assert.deepEqual(f.store.state, before);
});
test('extension follows canonical policy and known actual contract end; later release remains explicitly unknown', async (t) => {
  const f = await setup(t); const first = (await read(f)).value.options;
  assert.equal(first.contractExtension.available, false);
  assert.equal(first.laterRelease.available, false); assert.match(first.laterRelease.reason, /No reviewed/);
  const g = await setup(t, true); assert.equal((await read(g)).value.options.contractExtension.available, true);
  await g.repository.transaction(g.context, command('unknown-contract'), async (tx) => {
    const ref = { table: 'employees', key: { runId: g.context.runId, employeeId: g.context.employeeId } };
    return tx.compareAndSwap(ref, (await tx.get(ref)).value.version, { contract: {} });
  });
  assert.equal((await read(g)).value.options.contractExtension.available, false);
});
test('only persisted reviewed future release appears and reading never writes a case update', async (t) => {
  const f = await setup(t);
  let c = (await f.service.update(f.greg, { commandId: 'progress', caseId: f.c.caseId, expectedVersion: 1,
    status: 'in-progress', reason: 'Review plan.', nextAction: 'Review release.', dueAt: '2026-11-06T12:00:00.000Z' })).value.case;
  const remedy = { type: 'later-release', releaseAt: '2026-11-25T09:00:00.000Z', source: 'Reviewed synthetic release plan November 2026' };
  c = (await f.service.update(f.greg, { commandId: 'release', caseId: c.caseId, expectedVersion: c.version,
    status: 'remedy-proposed', reason: 'Review plan.', nextAction: 'Review release.', dueAt: '2026-11-06T12:00:00.000Z', remedy })).value.case;
  const before = structuredClone(f.store.state);
  assert.deepEqual((await read(f)).value.options.laterRelease.items, [remedy]);
  assert.deepEqual(f.store.state, before);
});
test('editable one-preference choices use actual unused decline and policy registry; employee confirms through BriefService', async (t) => {
  const f = await setup(t);
  assert.equal((await read(f)).value.options.preferenceRelaxations.available, false);
  assert.equal((await decline(f)).status, 'ok');
  const choices = (await read(f)).value.options.preferenceRelaxations.items;
  assert.equal(choices.length, 2);
  assert.deepEqual(choices.map((c) => c.path), ['preferences.body.value', 'preferences.comfort.value']);
  const body = choices[0]; assert.equal(body.before, 'estate'); assert.equal(body.expectedBriefVersion, 1);
  assert.ok(body.values.includes('suv')); assert.ok(!body.values.includes('estate'));
  assert.equal(choices[1].minimum, 0); assert.equal(choices[1].maximum, 100);
  const progress = await f.service.update(f.greg, { commandId: 'relax-progress', caseId: f.c.caseId, expectedVersion: 1,
    status: 'in-progress', reason: 'Review preference.', nextAction: 'Ask Paula.', dueAt: '2026-11-06T12:00:00.000Z' });
  assert.equal(progress.status, 'ok');
  const proposed = await f.service.update(f.greg, { commandId: 'relax-propose', caseId: f.c.caseId, expectedVersion: progress.value.case.version,
    status: 'remedy-proposed', reason: 'Review preference.', nextAction: 'Ask Paula.', dueAt: '2026-11-06T12:00:00.000Z',
    remedy: { type: body.type, decisionId: body.decisionId, expectedBriefVersion: body.expectedBriefVersion, path: body.path, value: 'suv' } });
  assert.equal(proposed.status, 'ok');
  assert.deepEqual((await f.service.readOwn(f.context, { caseId: f.c.caseId })).value.case.relaxation,
    { currentBriefVersion: 1, before: 'estate', applicable: true });
  const changed = await f.brief.changeAfterDecline(f.context, { commandId: 'one-change', decisionId: body.decisionId,
    expectedBriefVersion: body.expectedBriefVersion, change: { path: body.path, value: 'suv' } });
  assert.equal(changed.status, 'ok', JSON.stringify(changed));
  assert.equal((await read(f)).value.options.preferenceRelaxations.available, false);
  assert.deepEqual((await f.service.readOwn(f.context, { caseId: f.c.caseId })).value.case.relaxation,
    { currentBriefVersion: 2, before: 'suv', applicable: false });
});
test('repository and recommendation source failures stay unavailable instead of an empty feasible list', async (t) => {
  const f = await setup(t);
  const service = new RenewalCaseService({ ...f.configuration, repository: { ...f.repository,
    query(context, table, filter) { return table === 'stock' ? result('unavailable', { reason: 'Stock source failed.' }) : f.repository.query(context, table, filter); } } });
  assert.equal((await service.readOptions(f.greg, { caseId: f.c.caseId })).status, 'unavailable');
  await car(f, 889, {}, { facts: {} });
  assert.equal((await read(f)).status, 'unavailable');
});

test('a help requester without a confirmed brief still has manual options when stock exists', async (t) => {
  const f = await setup(t, false, false); await car(f, 890);
  const before = structuredClone(f.store.state);
  const readout = await read(f); assert.equal(readout.status, 'ok', JSON.stringify(readout));
  assert.equal(readout.value.options.alternativeCars.available, false);
  assert.match(readout.value.options.alternativeCars.reason, /confirmed brief is required/);
  assert.equal(readout.value.options.manualDecision.available, true);
  assert.deepEqual(f.store.state, before);
});

test('queue and options use canonical employee names and server-owned status transitions', async (t) => {
  const f = await setup(t);
  const employee = (await f.repository.query(f.context, 'employees', { employeeId: f.context.employeeId })).value[0];
  const options = await read(f);
  assert.equal(options.value.case.employeeName, employee.name);
  assert.deepEqual(options.value.nextStatuses, ['in-progress', 'closed']);
  assert.equal((await f.service.list(f.greg)).value.cases[0].employeeName, employee.name);
  let c = f.c;
  for (const [i, status] of ['in-progress', 'resolved'].entries()) {
    const changed = await f.service.update(f.greg, { commandId: `name-status-${i}`, caseId: c.caseId, expectedVersion: c.version,
      status, reason: 'Scheme team review.', nextAction: 'Confirm decision.', dueAt: '2026-11-06T12:00:00.000Z',
      ...(status === 'resolved' ? { remedy: { type: 'manual-decision', decision: 'Arrange a renewal review call.' } } : {}) });
    assert.equal(changed.status, 'ok', JSON.stringify(changed)); c = changed.value.case;
  }
  assert.deepEqual((await read(f)).value.nextStatuses, ['closed']);
  const failed = new RenewalCaseService({ ...f.configuration, repository: { ...f.repository,
    query(context, table, filter) { return table === 'employees' ? result('unavailable', { reason: 'Employee source failed.' }) : f.repository.query(context, table, filter); } } });
  assert.equal((await failed.list(f.greg)).status, 'unavailable');
});
