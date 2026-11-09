import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, result, OCCUPYING_STATES } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { RenewalCaseService } from '../gcsp/cases/index.js';
import { createCaseRoutes } from '../gcsp/cases/http.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { preference, essential, stock, fact } from './helpers/employee-recommendation.js';
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
  t.after(() => repository.close());
  return { repository, store, policy, identity, clock, presenter, context, greg, brief, service, configuration, c };
}
const read = (f) => f.service.readOptions(f.greg, { caseId: f.c.caseId });
async function car(f, id, facts = {}, extra = {}) {
  const candidate = stock(id, facts);
  const inserted = await f.repository.transaction(f.context, command(`car:${id}`), (tx) => tx.insert('stock', {
    runId: f.context.runId, orderUuid: candidate.orderUuid, orderNumber: String(id).padStart(7, '0'), configurationId: candidate.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: candidate.snapshot,
    release: { availability: candidate.availability },
    visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: null }, ...extra }));
  assert.equal(inserted.status, 'ok', JSON.stringify(inserted)); return candidate;
}
async function decline(f, id = 'decline') {
  return f.repository.transaction(f.context, command(id), (tx) => tx.insert('decisions', { runId: f.context.runId,
    decisionId: id, employeeId: f.context.employeeId, offerId: 'old-offer', decision: 'decline', versions: { brief: 1 } }));
}
async function patch(f, table, key, id, change) {
  const changed = await f.repository.transaction(f.context, command(id), async (tx) => {
    const ref = { table, key: { runId: f.context.runId, ...key } };
    const row = await tx.get(ref); assert.equal(row.status, 'ok', JSON.stringify(row));
    return tx.compareAndSwap(ref, row.value.version, change(row.value));
  });
  assert.equal(changed.status, 'ok', JSON.stringify(changed));
  return changed.value;
}
const manual = (f, id, change) => patch(f, 'employees', { employeeId: f.context.employeeId }, id, (employee) => {
  const contract = structuredClone(employee.contract); change(contract.manualContext);
  return { contract };
});
async function progress(f) {
  const changed = await f.service.update(f.greg, { commandId: 'progress', caseId: f.c.caseId, expectedVersion: f.c.version,
    status: 'in-progress', reason: 'Review current alternative.', nextAction: 'Check the exact car.', dueAt: '2026-11-06T12:00:00.000Z' });
  assert.equal(changed.status, 'ok', JSON.stringify(changed)); return changed.value.case;
}
const propose = (f, c, candidate, service = f.service) => service.update(f.greg, { commandId: 'propose', caseId: c.caseId,
  expectedVersion: c.version, status: 'remedy-proposed', reason: 'Suitable released car reviewed.', nextAction: 'Discuss with Paula.',
  dueAt: '2026-11-06T12:00:00.000Z', remedy: { type: 'alternative-car', orderUuid: candidate.orderUuid } });
async function occupy(f, candidate, table, state) {
  const inserted = await f.repository.transaction(f.context, command(`occupy:${table}:${state}`), async (tx) => {
    const fields = { runId: f.context.runId, orderUuid: candidate.orderUuid, employeeId: f.context.employeeId,
      entitlementSlotId: f.context.entitlementSlotId, renewalId: f.c.renewalId, type: 'buddy-offer',
      expiresAt: '2026-11-06T12:00:00.000Z', policyVersion: f.context.policyVersion, holdId: 'occupied' };
    const hold = await tx.insert('holds', { ...fields, state: table === 'holds' ? state : 'released' });
    return table === 'holds' || hold.status !== 'ok' ? hold : tx.insert('claims', { ...fields, claimId: 'occupied', state });
  });
  assert.equal(inserted.status, 'ok', JSON.stringify(inserted));
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
test('FUCQ-258: a plug-in car with unconfirmed charging is marked, not offered, and the read keeps feasible cars', async (t) => {
  const f = await setup(t); const c = await progress(f);
  const suitable = await car(f, 884); const plugIn = await car(f, 885, { fuel: fact('phev') });
  const before = structuredClone(f.store.state);
  const options = await read(f); assert.equal(options.status, 'ok', JSON.stringify(options));
  const cars = options.value.options.alternativeCars;
  assert.deepEqual(cars.items.map((entry) => entry.orderUuid), [suitable.orderUuid]);
  assert.deepEqual(cars.needsConfirmation.map((entry) => [entry.type, entry.orderUuid, entry.unknowns]), [['alternative-car', plugIn.orderUuid, ['charging-unconfirmed']]]);
  assert.equal((await propose(f, c, plugIn)).status, 'unavailable');
  assert.deepEqual(f.store.state, before);
  await patch(f, 'stock', { orderUuid: suitable.orderUuid }, 'sold', () => ({ state: 'allocated', allocated: true }));
  const only = (await read(f)).value.options.alternativeCars;
  assert.equal(only.available, false); assert.match(only.reason, /need confirmation first/);
  assert.deepEqual(only.needsConfirmation.map((entry) => entry.orderUuid), [plugIn.orderUuid]);
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
    { currentBriefVersion: 1, before: 'estate', applicable: true, confirmed: false });
  const changed = await f.brief.changeAfterDecline(f.context, { commandId: 'one-change', decisionId: body.decisionId,
    expectedBriefVersion: body.expectedBriefVersion, change: { path: body.path, value: 'suv' } });
  assert.equal(changed.status, 'ok', JSON.stringify(changed));
  assert.equal((await read(f)).value.options.preferenceRelaxations.available, false);
  assert.deepEqual((await f.service.readOwn(f.context, { caseId: f.c.caseId })).value.case.relaxation,
    { currentBriefVersion: 2, before: 'suv', applicable: false, confirmed: true });
  const snapshot = structuredClone(f.store.state);
  const projected = (await f.service.readOwn(f.context, { caseId: f.c.caseId })).value.case;
  assert.equal(projected.status, 'remedy-proposed');
  assert.equal(projected.remedy.confirmationState, 'employee-confirmation-required');
  assert.deepEqual(f.store.state, snapshot);
  const { JSDOM } = await import('jsdom');
  const { renderCaseContent } = await import('../../blocks/gcsp/cases/case-content.js');
  const dom = new JSDOM('<!doctype html><html><body></body></html>'); const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const rendered = renderCaseContent(projected, { onReviewRelaxation() { assert.fail('Confirmed change cannot be repeated.'); } });
    assert.match(rendered.textContent, /You confirmed this preference change/);
    assert.doesNotMatch(rendered.textContent, /no longer matches/);
    assert.equal(rendered.querySelector('button'), null);
  } finally { globalThis.document = previous; dom.window.close(); }

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

test('canonical released stock projects and proposes through the command transaction without claiming it', async (t) => {
  const f = await setup(t); const candidate = await car(f, 900, {}, { visibility: {
    companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: [f.context.employeeId],
  } });
  const projected = await read(f); assert.equal(projected.status, 'ok', JSON.stringify(projected));
  const option = projected.value.options.alternativeCars.items[0];
  assert.equal(option.orderUuid, candidate.orderUuid);
  assert.equal(option.configurationId, candidate.configurationId);
  assert.deepEqual(option.snapshot, candidate.snapshot);
  const c = await progress(f); const before = structuredClone(f.store.state.tables);
  let inTransaction = false; const trace = []; const globalDuringTransaction = [];
  const guarded = { ...f.repository,
    read(context, reference) {
      if (inTransaction) { globalDuringTransaction.push(['read', reference.table]); assert.fail('Global read inside case command'); }
      return f.repository.read(context, reference);
    },
    query(context, table, filter) {
      if (inTransaction) { globalDuringTransaction.push(['query', table]); assert.fail('Global query inside case command'); }
      return f.repository.query(context, table, filter);
    },
    transaction(context, input, work) {
      return f.repository.transaction(context, input, async (tx) => {
        inTransaction = true;
        try { return await work({ ...tx,
          get(reference) { trace.push(['get', reference.table, reference.key]); return tx.get(reference); },
          list(table, filter) { trace.push(['list', table, filter]); return tx.list(table, filter); },
        }); } finally { inTransaction = false; }
      });
    },
  };
  const changed = await propose(f, c, candidate, new RenewalCaseService({ ...f.configuration, repository: guarded }));
  assert.equal(changed.status, 'ok', JSON.stringify(changed));
  assert.deepEqual(changed.value.case.remedy, { type: 'alternative-car', orderUuid: candidate.orderUuid, carName: candidate.snapshot.display.name });
  assert.deepEqual(globalDuringTransaction, []);
  assert.equal(trace.filter(([kind, table]) => kind === 'get' && table === 'employees').length, 2);
  assert.ok(trace.some(([kind, table]) => kind === 'list' && table === 'stock'));
  assert.ok(trace.filter(([kind]) => kind === 'get').every(([, , key]) => key.runId === f.context.runId));
  for (const table of Object.keys(before).filter((name) => !['renewal_cases', 'notification_outbox', 'event_receipts'].includes(name))) {
    assert.deepEqual(f.store.state.tables[table], before[table], `${table} must remain unchanged`);
  }
  assert.equal(f.store.state.tables.notification_outbox.length, before.notification_outbox.length + 1);
  assert.equal(f.store.state.tables.stock.find((row) => row.orderUuid === candidate.orderUuid).state, 'released');
  assert.equal(f.store.state.tables.holds.length, 0); assert.equal(f.store.state.tables.claims.length, 0);
});

test('recorded alternative car keeps a server-derived name; client names are refused and later updates retain it', async (t) => {
  const f = await setup(t); const candidate = await car(f, 901, {}, { visibility: {
    companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: [f.context.employeeId] } });
  const c = await progress(f);
  const forged = await f.service.update(f.greg, { commandId: 'forged', caseId: c.caseId, expectedVersion: c.version, status: 'remedy-proposed',
    reason: 'Forged name.', nextAction: 'Check.', dueAt: '2026-11-06T12:00:00.000Z',
    remedy: { type: 'alternative-car', orderUuid: candidate.orderUuid, carName: 'Forged name' } });
  assert.equal(forged.status, 'invalid');
  const proposed = await propose(f, c, candidate); assert.equal(proposed.status, 'ok', JSON.stringify(proposed));
  const expected = { type: 'alternative-car', orderUuid: candidate.orderUuid, carName: candidate.snapshot.display.name };
  assert.deepEqual(proposed.value.case.remedy, expected);
  assert.deepEqual(proposed.value.case.history.at(-1).remedy, expected);
  const replay = await propose(f, c, candidate); assert.equal(replay.status, 'ok'); assert.equal(replay.value.case.version, proposed.value.case.version);
  const next = await f.service.update(f.greg, { commandId: 'retain', caseId: c.caseId, expectedVersion: proposed.value.case.version, status: 'in-progress',
    reason: 'Back to review.', nextAction: 'Check again.', dueAt: '2026-11-06T12:00:00.000Z' });
  assert.equal(next.status, 'ok', JSON.stringify(next)); assert.deepEqual(next.value.case.remedy, expected);
  const again = await f.service.update(f.greg, { commandId: 'repropose', caseId: c.caseId, expectedVersion: next.value.case.version, status: 'remedy-proposed',
    reason: 'Propose again.', nextAction: 'Discuss.', dueAt: '2026-11-06T12:00:00.000Z' });
  assert.equal(again.status, 'ok', JSON.stringify(again)); assert.deepEqual(again.value.case.remedy, expected);
});

test('options exclude noncanonical lifecycle, unavailable flags and each employee visibility exclusion', async (t) => {
  const f = await setup(t); const accepted = await car(f, 910);
  const excluded = [{ state: 'available' }, { state: 'held' }, { state: 'allocated' }, { available: false },
    { available: null }, { held: true }, { allocated: true },
    { visibility: { companyIds: ['other-company'], schemeIds: [f.context.schemeId], employeeIds: null } },
    { visibility: { companyIds: [f.context.companyId], schemeIds: ['other-scheme'], employeeIds: null } },
    { visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: ['other-employee'] } },
    { visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: [] } }];
  for (const [i, extra] of excluded.entries()) await car(f, 911 + i, {}, extra);
  const missing = stock(929);
  assert.equal((await f.repository.transaction(f.context, command('missing-available'), (tx) => tx.insert('stock', {
    runId: f.context.runId, orderUuid: missing.orderUuid, orderNumber: '0000929', configurationId: missing.configurationId,
    state: 'released', held: false, allocated: false, facts: missing.snapshot, release: { availability: missing.availability },
    visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: null },
  }))).status, 'ok');
  const options = await read(f); assert.equal(options.status, 'ok', JSON.stringify(options));
  assert.deepEqual(options.value.options.alternativeCars.items.map((entry) => entry.orderUuid), [accepted.orderUuid]);
});

test('every canonical occupying hold and claim state prevents an alternative proposal', async (t) => {
  for (const table of ['holds', 'claims']) for (const state of OCCUPYING_STATES) await t.test(`${table}: ${state}`, async (s) => {
    const f = await setup(s); const candidate = await car(f, 930); const c = await progress(f);
    assert.equal((await read(f)).value.options.alternativeCars.available, true);
    await occupy(f, candidate, table, state);
    const before = structuredClone(f.store.state);
    assert.equal((await read(f)).value.options.alternativeCars.available, false);
    assert.equal((await propose(f, c, candidate)).status, 'invalid');
    assert.deepEqual(f.store.state, before);
  });
});

test('proposal revalidates stock, visibility and suitability changed after options were read', async (t) => {
  const changes = {
    held: () => ({ held: true }), allocated: () => ({ allocated: true }), availability: () => ({ available: false }),
    lifecycle: () => ({ state: 'held' }),
    visibility: (row) => ({ visibility: { ...row.visibility, employeeIds: ['other-employee'] } }),
    essentials: (row) => ({ facts: { ...row.facts, facts: { ...row.facts.facts, seats: fact(2, 'count') } } }),
    expired: (row) => ({ release: { ...row.release, availability: { ...row.release.availability,
      availableFrom: '2026-11-05T11:00:00.000Z', availableUntil: '2026-11-05T11:59:59.000Z' } } }),
    future: (row) => ({ release: { ...row.release, availability: { ...row.release.availability, availableFrom: '2026-11-06T12:00:00.000Z' } } }),
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async (s) => {
    const f = await setup(s); const candidate = await car(f, 940); const c = await progress(f);
    assert.equal((await read(f)).value.options.alternativeCars.available, true);
    await patch(f, 'stock', { orderUuid: candidate.orderUuid }, `change:${name}`, change);
    const before = structuredClone(f.store.state);
    assert.equal((await propose(f, c, candidate)).status, 'invalid', name);
    assert.deepEqual(f.store.state, before);
    assert.equal((await read(f)).value.options.alternativeCars.available, false);
  });
});

test('missing or unknown canonical facts, provenance, timing and visibility remain unavailable', async (t) => {
  const changes = {
    'missing facts': () => ({ facts: {} }),
    'legacy nested candidate': () => ({ facts: { recommendationCandidate: stock(950) } }),
    'wrong stock identity': (row) => ({ facts: { ...row.facts, sourceKeys: { stockId: stock(951).orderUuid } } }),
    'missing snapshot version': (row) => { const facts = structuredClone(row.facts); delete facts.snapshotVersion; return { facts }; },
    'missing source': (row) => { const facts = structuredClone(row.facts); delete facts.sourceNamespace; return { facts }; },
    'unknown essential': (row) => ({ facts: { ...row.facts, facts: { ...row.facts.facts, seats: fact(null, 'count') } } }),
    'missing availability': () => ({ release: {} }),
    'missing availability version': (row) => { const release = structuredClone(row.release); delete release.availability.version; return { release }; },
    'unknown availability': (row) => ({ release: { availability: { ...row.release.availability, state: 'unknown' } } }),
    'missing timing': (row) => { const release = structuredClone(row.release); delete release.availability.availableUntil; return { release }; },
    'unconfirmed visibility': () => ({ visibility: {} }),
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async (s) => {
    const f = await setup(s); const candidate = await car(f, 950); const c = await progress(f);
    await patch(f, 'stock', { orderUuid: candidate.orderUuid }, `unknown:${name}`, change);
    const before = structuredClone(f.store.state);
    assert.equal((await read(f)).status, 'unavailable', name);
    assert.equal((await propose(f, c, candidate)).status, 'unavailable', name);
    assert.deepEqual(f.store.state, before);
  });
});

test('persisted contract driver eligibility overrides contradictory cloned employee facts', async (t) => {
  for (const eligible of [true, false]) await t.test(`bound eligible ${eligible}`, async (s) => {
    const f = await setup(s); const candidate = await car(f, 960); const c = await progress(f);
    await manual(f, 'contradictory-facts', (records) => {
      records.drivers[0].eligible = fact(eligible);
      records.employeeFacts.driverEligible = fact(!eligible);
    });
    const options = await read(f); assert.equal(options.status, 'ok', JSON.stringify(options));
    assert.equal(options.value.options.alternativeCars.available, eligible);
    assert.equal((await propose(f, c, candidate)).status, eligible ? 'ok' : 'invalid');
  });
});

test('current contract binds its nominated driver rather than the first employee driver', async (t) => {
  const f = await setup(t); const candidate = await car(f, 961); const c = await progress(f);
  await manual(f, 'nominated-driver', (records) => {
    records.drivers[0].eligible = fact(false);
    records.contracts[0].driverId = records.drivers[1].driverId;
    records.employeeFacts.driverEligible = fact(false);
  });
  assert.equal((await read(f)).value.options.alternativeCars.available, true);
  assert.equal((await propose(f, c, candidate)).status, 'ok');
});

test('missing, ambiguous, mismatched or unknown persisted driver and contract evidence is unavailable', async (t) => {
  const changes = {
    'missing drivers': (records) => { delete records.drivers; },
    'absent bound driver': (records) => { records.drivers.shift(); },
    'missing driver binding': (records) => { delete records.contracts[0].driverId; },
    'duplicate bound driver': (records) => { records.drivers.push(structuredClone(records.drivers[0])); },
    'foreign bound driver': (records) => { records.drivers[0].employeeId = 'other-employee'; },
    'missing eligible': (records) => { delete records.drivers[0].eligible; },
    'unknown eligible': (records) => { records.drivers[0].eligible = fact(null); },
    'missing eligible provenance': (records) => { delete records.drivers[0].eligible.provenance; },
    'missing contract': (records) => { records.contracts = []; },
    'duplicate current contract': (records) => { records.contracts.push({ ...records.contracts[0], contractId: 'second-current' }); },
    'wrong current contract': (records) => { records.contracts[0].contractId = 'other-contract'; },
    'wrong contract employee': (records) => { records.contracts[0].employeeId = 'other-employee'; },
    'wrong contract scheme': (records) => { records.contracts[0].schemeId = 'other-scheme'; },
    'wrong contract slot': (records) => { records.contracts[0].slotId = 'other-slot'; },
    'unknown required-by': (records) => { records.employeeFacts.requiredBy = fact(null); },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async (s) => {
    const f = await setup(s); const candidate = await car(f, 970); const c = await progress(f);
    await manual(f, `driver:${name}`, change);
    const before = structuredClone(f.store.state);
    assert.equal((await read(f)).status, 'unavailable', name);
    assert.equal((await propose(f, c, candidate)).status, 'unavailable', name);
    assert.deepEqual(f.store.state, before);
  });
});

test('proposal revalidates current driver eligibility after a suitable options projection', async (t) => {
  const f = await setup(t); const candidate = await car(f, 980); const c = await progress(f);
  assert.equal((await read(f)).value.options.alternativeCars.available, true);
  await manual(f, 'driver-became-ineligible', (records) => {
    records.drivers[0].eligible = fact(false); records.employeeFacts.driverEligible = fact(true);
  });
  const before = structuredClone(f.store.state);
  assert.equal((await propose(f, c, candidate)).status, 'invalid');
  assert.equal((await read(f)).value.options.alternativeCars.available, false);
  assert.deepEqual(f.store.state, before);
});
