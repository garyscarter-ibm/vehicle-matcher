import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { createGcspHandler } from '../gcsp/identity/http.js';
import { createGregDemandService } from '../gcsp/greg/index.js';
import { createGregRoutes } from '../gcsp/greg/http.js';
import { preference, essential, stock, fact, providerValue } from './helpers/employee-recommendation.js';

const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
async function setup({ threshold = 1, missingThreshold = false, canonical = false } = {}) {
  const source = structuredClone(seed);
  if (!canonical) source.assumptions = source.assumptions.filter((a) => a.key !== 'greg.demand.smallCountThreshold');
  if (!canonical && !missingThreshold) source.assumptions.push({ ...source.assumptions[0], key: 'greg.demand.smallCountThreshold', value: threshold,
    unit: 'count', status: 'assumed', basis: 'Explicit alternative fixture privacy threshold.' });
  const policy = new PolicyService({ provider: { async loadVersions() { return [source]; } } });
  const repository = createMemoryRepository({ store: createMemoryStore() });
  assert.equal((await repository.open()).status, 'ok');
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'greg-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'greg');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context; const employee = paula.value.context;
  const service = createGregDemandService({ repository, policy, clock, identity });
  const brief = new BriefService({ repository, policy, clock, identity });
  let sequence = 0;
  const write = async (work) => {
    const commandId = `fixture-${++sequence}`;
    const value = await repository.transaction(context, { commandId, inputDigest: inputDigest(commandId) }, work);
    assert.equal(value.status, 'ok', JSON.stringify(value)); return value;
  };
  await write(async (tx) => {
    const row = await tx.get({ table: 'employees', key: { runId: context.runId, employeeId: employee.employeeId } });
    return tx.compareAndSwap({ table: 'employees', key: { runId: context.runId, employeeId: employee.employeeId } }, row.value.version,
      { contract: { manualContext: { employeeFacts: providerValue().employeeFacts }, tripHistory: ['PRIVATE-TRIP'], usageHistory: ['PRIVATE-USAGE'] } });
  });
  return { repository, policy, clock, identity, presenter, acting, context, employee, service, brief, write };
}
const saved = (seats = 5) => ({ schemaVersion: 1, preferences: { body: preference('estate'), fuel: preference('petrol') },
  essentials: { seats: essential(seats), modelLine: essential('G21 Touring', 'equals', null) } });
async function confirm(f, value = saved(), version = 0) {
  const draft = await f.brief.saveDraft(f.employee, { commandId: `draft-${version}`, expectedBriefVersion: version,
    expectedDraftVersion: version, brief: value });
  assert.equal(draft.status, 'ok', JSON.stringify(draft));
  const result = await f.brief.confirm(f.employee, { commandId: `confirm-${version}`, expectedBriefVersion: version,
    expectedDraftVersion: version + 1, consent: { search: true, hold: true } });
  assert.equal(result.status, 'ok', JSON.stringify(result)); return result;
}
async function release(f, id = 1, facts = {}) {
  const candidate = stock(id, { modelLine: fact('G21 Touring'), ...facts });
  const now = (await f.clock.now(f.context)).value.now;
  return f.write((tx) => tx.insert('stock', { runId: f.context.runId, orderUuid: candidate.orderUuid,
    configurationId: candidate.configurationId, state: 'released', available: true, facts: candidate.snapshot,
    release: { availability: { ...candidate.availability, availableFrom: now } },
    visibility: { companyIds: [f.employee.companyId], schemeIds: [f.employee.schemeId], employeeIds: null } }));
}
const read = async (f) => { const out = await f.service.readDemand(f.context); assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value; };
const exact = (aggregate) => aggregate.count.value;
const bucket = (items, key) => items.find((item) => item.key === key);

test('saved current brief, not draft/history/current-car/retail sample, drives model/body/fuel/essentials', async () => {
  const f = await setup(); await confirm(f);
  const changed = saved(7); changed.preferences.body.value = 'suv';
  await confirm(f, changed, 1);
  const out = await read(f);
  assert.equal(exact(out.demand.activeBriefs), 1);
  assert.equal(exact(bucket(out.demand.byModelLine, 'G21 Touring')), 1);
  assert.equal(exact(bucket(out.demand.byBody, 'suv')), 1);
  assert.equal(exact(bucket(out.demand.byFuel, 'petrol')), 1);
  assert.equal(out.demand.byBody.some((x) => x.key === 'estate'), false);
  assert.deepEqual(bucket(out.demand.byModelLine, 'G21 Touring').versions.brief, [2]);
  assert.deepEqual(bucket(out.demand.byModelLine, 'G21 Touring').versions.policy, [f.context.policyVersion]);
  assert.equal(out.demand.essentials.find((x) => x.field === 'seats').value, 7);
  assert.equal(out.basis, 'expressed-saved-demand'); assert.equal(Object.hasOwn(out, 'satisfaction'), false);
});

test('unspecified model and indifferent/unconfirmed preferences remain explicit instead of inferred demand', async () => {
  const f = await setup(); const value = saved(); delete value.essentials.modelLine;
  value.preferences.body.importance = 0; await confirm(f, value);
  const out = await read(f);
  assert.equal(exact(bucket(out.demand.byModelLine, 'unspecified')), 1);
  assert.equal(exact(bucket(out.demand.byBody, 'unspecified')), 1);
});

test('unmet demand distinguishes no released stock, shared essential gate, and sufficient actual release', async () => {
  const f = await setup(); await confirm(f, saved(7));
  let out = await read(f);
  assert.equal(exact(out.demand.unmet.total), 1);
  assert.equal(exact(bucket(out.demand.unmet.byGate, 'no-released-stock')), 1);
  await release(f);
  out = await read(f);
  assert.equal(exact(bucket(out.demand.unmet.byGate, 'essential-unmet:seats')), 1);
  await release(f, 2, { seats: fact(7, 'count') });
  out = await read(f);
  assert.equal(out.demand.unmet.total.count.kind, 'band');
  assert.deepEqual(out.demand.unmet.byGate, []);
  assert.equal(exact(bucket(out.stock.byModelLine, 'G21 Touring').released), 2);
});

test('unknown employee authority stays needs-confirmation and stock visibility cannot widen eligibility', async () => {
  const f = await setup(); await confirm(f); await release(f);
  await f.write(async (tx) => { const row = await tx.get({ table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } });
    return tx.compareAndSwap({ table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } }, row.value.version, { contract: {} }); });
  let out = await read(f);
  assert.equal(exact(bucket(out.demand.unmet.byGate, 'driver-unconfirmed')), 1);
  const row = (await f.repository.query(f.context, 'stock')).value.find((x) => x.state === 'released');
  await f.write((tx) => tx.compareAndSwap({ table: 'stock', key: { runId: f.context.runId, orderUuid: row.orderUuid } }, row.version,
    { visibility: { companyIds: ['other-company'], schemeIds: [f.employee.schemeId], employeeIds: null } }));
  out = await read(f); assert.equal(exact(bucket(out.demand.unmet.byGate, 'stock-not-visible')), 1);
});

async function offer(f, id, state, decision, reason) {
  await release(f, id);
  const orderUuid = stock(id).orderUuid;
  return f.write(async (tx) => {
    await tx.insert('quotes', { runId: f.context.runId, quoteId: `quote-${id}`, orderUuid, employeeId: f.employee.employeeId,
      briefVersion: 1, policyVersion: f.context.policyVersion });
    const holdState = state === 'expired' ? 'expired' : state === 'selected' ? 'allocated' : state === 'active' ? 'active' : 'released';
    await tx.insert('holds', { runId: f.context.runId, holdId: `hold-${id}`, orderUuid, employeeId: f.employee.employeeId,
      entitlementSlotId: f.employee.entitlementSlotId, type: 'buddy-offer', state: holdState,
      quoteId: `quote-${id}`, policyVersion: f.context.policyVersion });
    await tx.insert('offers', { runId: f.context.runId, offerId: `offer-${id}`, holdId: `hold-${id}`, employeeId: f.employee.employeeId,
      orderUuid, state, quoteId: `quote-${id}`, briefVersion: 1, policyVersion: f.context.policyVersion });
    if (decision) await tx.insert('decisions', { runId: f.context.runId, decisionId: `decision-${id}`, commandId: `decision-${id}`,
      offerId: `offer-${id}`, employeeId: f.employee.employeeId, decision, reason: reason ?? null,
      versions: { brief: 1, policy: f.context.policyVersion } });
    if (['active', 'selected'].includes(state)) {
      const found = await tx.get({ table: 'stock', key: { runId: f.context.runId, orderUuid } });
      await tx.compareAndSwap({ table: 'stock', key: { runId: f.context.runId, orderUuid } }, found.value.version,
        { state: state === 'selected' ? 'allocated' : 'held', available: false, held: state === 'active', allocated: state === 'selected' });
    }
    return ok({ done: true });
  });
}

test('real offer/decision/hold/allocation records drive outcomes with typed declines and versions', async () => {
  const f = await setup(); await confirm(f);
  await offer(f, 1, 'accepted', 'accept'); await offer(f, 2, 'declined', 'decline', { type: 'body', text: 'PRIVATE-DECLINE' });
  await offer(f, 3, 'expired'); await offer(f, 4, 'selected', 'select'); await offer(f, 5, 'active');
  const out = await read(f);
  assert.equal(exact(out.offers.made), 5); assert.equal(exact(out.offers.accepted), 1);
  assert.equal(exact(out.offers.declined), 1); assert.equal(exact(out.offers.expired), 1); assert.equal(exact(out.offers.selected), 1);
  assert.equal(exact(bucket(out.offers.declinedByReason, 'body')), 1);
  assert.equal(exact(out.holds.active), 1); assert.equal(exact(out.holds.total), 5);
  const counts = bucket(out.stock.byModelLine, 'G21 Touring');
  assert.equal(exact(counts.held), 1); assert.equal(exact(counts.allocated), 1); assert.equal(exact(counts.released), 3);
  for (const aggregate of [out.offers.made, out.offers.accepted, out.offers.declined, out.offers.expired, out.offers.selected]) {
    assert.deepEqual(aggregate.versions.brief, [1]); assert.deepEqual(aggregate.versions.policy, [f.context.policyVersion]);
  }
});

test('all counts below canonical threshold are bands without a raw count or personal fields', async () => {
  const f = await setup({ threshold: 5 }); await confirm(f); await offer(f, 1, 'declined', 'decline', { type: 'body', text: 'PRIVATE-DECLINE' });
  const out = await read(f); const text = JSON.stringify(out);
  assert.deepEqual(out.demand.activeBriefs.count, { kind: 'band', fewerThan: 5, label: 'fewer than 5' });
  for (const forbidden of ['employeeId', 'principalId', 'orderUuid', 'offerId', 'holdId', 'Paula', 'PRIVATE-', 'tripHistory', 'usageHistory', 'annualMileage', 'driverEligible', 'score']) assert.equal(text.includes(forbidden), false, forbidden);
  const visit = (value) => { if (!value || typeof value !== 'object') return; if (value.count) {
    assert.equal(value.count.kind, 'band'); assert.equal(Object.hasOwn(value.count, 'value'), false);
  } Object.values(value).forEach(visit); }; visit(out);
});

test('threshold policy alternatives change every projection consistently; absent or invalid threshold fails closed', async () => {
  for (const threshold of [0, -1, 1.5, '5']) {
    const f = await setup({ threshold }); assert.equal((await f.service.readDemand(f.context)).status, 'unavailable');
  }
  const missing = await setup({ missingThreshold: true }); assert.equal((await missing.service.readDemand(missing.context)).status, 'unavailable');
  const exactFixture = await setup({ threshold: 1 }); await confirm(exactFixture);
  assert.equal((await read(exactFixture)).demand.activeBriefs.count.kind, 'exact');
});

test('Greg service refuses employees, presenters and forged server context; old run after reset is stale', async () => {
  const f = await setup(); await confirm(f);
  assert.equal((await f.service.readDemand(f.employee)).status, 'forbidden');
  assert.equal((await f.service.readDemand(f.presenter.value.context)).status, 'forbidden');
  assert.equal((await f.service.readDemand({ ...f.context, principalId: f.employee.principalId })).status, 'forbidden');
  const current = await f.repository.currentRun(f.context.environmentId);
  const reset = await f.clock.reset(f.presenter.value.context, { commandId: 'reset', expectedRunId: f.context.runId,
    expectedRunVersion: current.value.version, scenarioVersion: current.value.scenarioVersion, fixtureVersion: current.value.fixtureVersion });
  assert.equal(reset.status, 'ok', JSON.stringify(reset));
  assert.equal((await f.service.readDemand(f.context)).status, 'stale-run');
  const presenter = await f.identity.createPresenterSession('new-presenter');
  const acting = await f.identity.switchPrincipal(presenter.value.context, 'demo-greg', 'new-greg');
  const out = await f.service.readDemand(acting.value.context); assert.equal(out.status, 'ok');
  assert.notEqual(out.value.runId, f.context.runId); assert.deepEqual(out.value.demand.byBody, []);
});

test('registered HTTP route enforces role and rejects browser run selectors under server identity', async () => {
  const f = await setup(); let captured;
  const handler = createGcspHandler({ identity: f.identity, routes: createGregRoutes(f.service) });
  const request = async (cookie, search = '') => {
    await handler({ req: { method: 'GET', headers: { cookie } }, res: { setHeader() {} }, pathname: '/api/gcsp/greg/demand',
      searchParams: new URLSearchParams(search), sendJson(_res, status, value) { captured = { status, value }; }, corsHeaders: {} }); return captured;
  };
  assert.equal((await request(f.acting.value.setCookie)).status, 200);
  const paula = await f.identity.switchPrincipal(f.presenter.value.context, 'demo-paula', 'http-paula');
  assert.equal((await request(paula.value.setCookie)).status, 403);
  assert.equal((await request(f.acting.value.setCookie, 'runId=other')).status, 400);
  assert.equal((await request(f.acting.value.setCookie, 'limit=1')).status, 400);
});

test('successive brief/release/decline/selection inputs change actual projection identity and figures', async () => {
  const f = await setup(); const empty = await read(f); await confirm(f);
  const brief = await read(f); await release(f, 1); const released = await read(f);
  await offer(f, 2, 'declined', 'decline', { type: 'fuel' }); const declined = await read(f);
  await offer(f, 3, 'selected', 'select'); const selected = await read(f);
  assert.equal(new Set([empty, brief, released, declined, selected].map((v) => v.projectionVersion)).size, 5);
  assert.equal(exact(brief.demand.activeBriefs), 1); assert.equal(exact(bucket(released.stock.byModelLine, 'G21 Touring').released), 1);
  assert.equal(exact(declined.offers.declined), 1); assert.equal(exact(selected.offers.selected), 1);
});


test('canonical optional model-line essential persists through BriefService and gates an actual wrong model', async () => {
  const f = await setup({ canonical: true });
  const threshold = await f.policy.getAssumption('greg.demand.smallCountThreshold', { runId: f.context.runId,
    policyVersion: f.context.policyVersion, asOf: (await f.clock.now(f.context)).value.now });
  assert.equal(threshold.status, 'ok'); assert.equal(threshold.value.value, 5); assert.equal(threshold.value.status, 'assumed');
  const invalid = saved(); invalid.essentials.modelLine.value = 3;
  assert.equal((await f.brief.saveDraft(f.employee, { commandId: 'invalid-model', expectedBriefVersion: 0,
    expectedDraftVersion: 0, brief: invalid })).status, 'invalid');
  await confirm(f); await release(f, 1, { modelLine: fact('G20 Saloon') });
  let out = await read(f);
  assert.equal(bucket(out.demand.byModelLine, 'G21 Touring').count.label, 'fewer than 5');
  assert.equal(bucket(out.demand.unmet.byGate, 'essential-unmet:modelLine').count.label, 'fewer than 5');
  await release(f, 2); out = await read(f); assert.deepEqual(out.demand.unmet.byGate, []);
});

test('same declined exact car remains blocked until a relevant confirmed brief change, including pause/resume', async () => {
  const f = await setup(); await confirm(f); await offer(f, 1, 'declined', 'decline', { type: 'body' });
  let out = await read(f); assert.equal(exact(bucket(out.demand.unmet.byGate, 'declined-unchanged')), 1);
  assert.equal((await f.brief.pause(f.employee, { commandId: 'pause', expectedBriefVersion: 1 })).status, 'ok');
  out = await read(f); assert.equal(exact(bucket(out.demand.unmet.byGate, 'declined-unchanged')), 1);
  assert.equal((await f.brief.resume(f.employee, { commandId: 'resume', expectedBriefVersion: 2 })).status, 'ok');
  out = await read(f); assert.equal(exact(bucket(out.demand.unmet.byGate, 'declined-unchanged')), 1);
  // A separate confirmed draft changes expressed intent, rather than inferring a preference from the reason.
  const revised = saved(); revised.preferences.body.value = 'suv';
  const draft = await f.brief.saveDraft(f.employee, { commandId: 'revised', expectedBriefVersion: 3, expectedDraftVersion: 1, brief: revised });
  assert.equal(draft.status, 'ok');
  assert.equal((await f.brief.confirm(f.employee, { commandId: 'reconfirm', expectedBriefVersion: 3,
    expectedDraftVersion: 2, consent: { search: true, hold: true } })).status, 'ok');
  out = await read(f); assert.deepEqual(out.demand.unmet.byGate, []);
});

test('a concurrent repository revision causes refresh conflict instead of a mixed projection', async () => {
  const f = await setup(); await confirm(f);
  let reads = 0;
  const repository = { ...f.repository, async query(context, table, filter) {
    const result = await f.repository.query(context, table, filter);
    if (table === 'briefs' && ++reads === 2) result.value = [];
    return result;
  } };
  const service = createGregDemandService({ repository, policy: f.policy, clock: f.clock, identity: f.identity });
  assert.equal((await service.readDemand(f.context)).status, 'conflict');
});


test('unmet evaluation reads all repository candidates beyond a retail-sized display limit', async () => {
  const f = await setup(); await confirm(f);
  for (let id = 1; id <= 4; id += 1) await release(f, id, { seats: fact(id === 4 ? 5 : 2, 'count') });
  const out = await read(f); assert.deepEqual(out.demand.unmet.byGate, []);
  assert.equal(exact(bucket(out.stock.byModelLine, 'G21 Touring').released), 4);
});

test('unregistered decline types and free text are replaced with a counted unclassified reason', async () => {
  const f = await setup(); await confirm(f);
  await offer(f, 1, 'declined', 'decline', { type: 'PRIVATE-NAME', text: 'PRIVATE-HISTORY' });
  const out = await read(f);
  assert.equal(exact(bucket(out.offers.declinedByReason, 'unclassified')), 1);
  assert.equal(JSON.stringify(out).includes('PRIVATE-'), false);
});


test('buildServer exposes a no-store trusted Greg GET, origin/session/gate refusal and stale-run protection', async () => {
  const f = await setup(); await confirm(f);
  const oldKey = process.env.DEMO_ACCESS_KEY;
  process.env.DEMO_ACCESS_KEY = 'greg-demand-fixture-key';
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspGreg: f.service,
    gcspAllowedOrigins: ['https://greg.test'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const cookie = (session) => [session.value.setCookie].flat().map((c) => c.split(';')[0]).join('; ');
  const request = async ({ session = f.acting, origin = 'https://greg.test', query = '', gate = true } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/greg/demand${query}`, {
      headers: { Origin: origin, ...(session ? { Cookie: cookie(session) } : {}), ...(gate ? { 'X-Access-Key': 'greg-demand-fixture-key' } : {}) } });
    return { status: response.status, body: await response.json(), cache: response.headers.get('Cache-Control') };
  };
  try {
    const response = await request(); assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.cache, 'no-store'); assert.equal(response.body.value.runId, f.context.runId);
    assert.equal((await request({ gate: false })).status, 401);
    assert.equal((await request({ session: null })).status, 401);
    assert.equal((await request({ origin: 'https://hostile.test' })).status, 403);
    const paula = await f.identity.switchPrincipal(f.presenter.value.context, 'demo-paula', 'http-employee');
    assert.equal((await request({ session: paula })).status, 403);
    assert.equal((await request({ query: '?runId=another-run' })).status, 400);
    const state = (await f.clock.readState(f.presenter.value.context)).value;
    assert.equal((await f.clock.reset(f.presenter.value.context, { commandId: 'http-reset', expectedRunId: state.runId,
      expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
    assert.equal((await request()).body.status, 'stale-run');
  } finally {
    server.closeAllConnections(); await new Promise((done) => server.close(done));
    if (oldKey === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = oldKey;
  }
});

test('equipment set order and duplicate keys cannot reopen an unchanged declined car', async () => {
  const f = await setup(); const value = saved(); value.essentials.equipment = essential(['towbar', 'heatedSeats'], 'includes', 'equipment-key');
  await confirm(f, value); await offer(f, 1, 'declined', 'decline', { type: 'equipment' });
  const revised = saved(); revised.essentials.equipment = essential(['heatedSeats', 'towbar', 'towbar'], 'includes', 'equipment-key');
  await confirm(f, revised, 1);
  const out = await read(f); assert.equal(exact(bucket(out.demand.unmet.byGate, 'declined-unchanged')), 1);
  assert.deepEqual(out.demand.essentials.find((e) => e.field === 'equipment').value, ['heatedSeats', 'towbar']);
});
