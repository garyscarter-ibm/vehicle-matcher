import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { allocationFixture } from './helpers/gcsp-allocation.js';
import { ok, inputDigest } from '../gcsp/repository/index.js';
import { createPresenterSuitabilityRoutes } from '../gcsp/presenter-suitability/http.js';
import { buildServer } from '../index.js';

const good = (r) => { assert.equal(r.status, 'ok', JSON.stringify(r)); return r.value; };
const jar = (setCookie) => [].concat(setCookie).map((v) => v.split(';')[0]).join('; ');
const at = '2026-11-05T12:00:00.000Z';
async function fixture(t, options) {
  const f = await allocationFixture(options); t.after(() => f.repository.close());
  const routes = createPresenterSuitabilityRoutes(f);
  f.read = (query = '') => routes[0].handle({ context: f.context, searchParams: new URLSearchParams(query), body: {} });
  f.release = async (eventId = 'release-1', ids, releasedAt = at) => {
    const stock = good(await f.repository.query(f.context, 'stock'));
    await f.write((tx) => tx.recordReceipt({ consumerId: 'stock-release', eventId, eventType: 'stock-released',
      inputDigest: inputDigest(eventId), state: 'completed', outcome: ok({ kind: 'stock-released', windowId: eventId,
        releasedAt, trancheId: eventId, orderUuids: ids ?? stock.map((r) => r.orderUuid) }) }));
  };
  return f;
}

test('matrix uses actual packed allocation decisions, not highest fit as a promise of an offer', async (t) => {
  const f = await fixture(t, { cars: 1 }); await f.release();
  const allocated = good(await f.service.allocate(f.context, f.event));
  const state = f.store.state;
  const view = good(await f.read());
  assert.equal(f.store.state, state, 'read never opens a transaction');
  assert.equal(view.cars.length, 1); assert.equal(view.buddies.length, 3);
  assert.equal(view.policy.minimumFit, null); assert.equal(view.policy.allocationRule, 'renewalDueThenFitThenSeededLottery');
  const winner = allocated.assignments[0]; assert.equal(winner.employeeId, f.employees[0].employeeId);
  const winning = view.cars[0].cells.find((c) => c.employeeId === winner.employeeId);
  const better = view.cars[0].cells.find((c) => c.score > winning.score);
  assert.ok(better, 'an earlier renewal beats the stronger fit');
  for (const cell of view.cars[0].cells) {
    assert.equal(cell.state, 'evaluated'); assert.equal(cell.gateStatus, 'eligible'); assert.equal(cell.outdated, false);
    assert.deepEqual(cell.outcome, { state: 'assigned', employeeId: winner.employeeId });
    assert.equal(cell.recorded.evaluatedAt, at);
  }
  assert.equal(view.cars[0].availability.state, 'available', 'recorded allocation and current occupancy stay separate');
  assert.doesNotMatch(JSON.stringify(view), /quoteInputs|"lottery":|employeeFacts|tokenHash|licence|contracts|quoteId|operationId/i);
});

test('missing cells are not evaluated; latest confirmed brief controls engaged membership', async (t) => {
  const f = await fixture(t); await f.release();
  const first = good(await f.read()); assert.ok(first.cars.every((car) => car.cells.every((cell) => cell.state === 'not-evaluated')));
  await f.write(async (tx) => {
    const briefs = good(await tx.list('briefs'));
    const old = briefs.find((b) => b.employeeId === f.employees[0].employeeId);
    const { version, createdAt, updatedAt, ...rest } = old;
    return tx.insert('briefs', { ...rest, briefVersion: 2, buddy: { ...rest.buddy, paused: true } });
  });
  const current = good(await f.read());
  assert.equal(current.buddies.length, 2); assert.ok(!current.buddies.some((b) => b.id === f.employees[0].employeeId));
});

test('all/latest releases, distinct exact cars, both page axes and bounded selectors', async (t) => {
  const f = await fixture(t, { cars: 10 });
  const rows = good(await f.repository.query(f.context, 'stock'));
  await f.release('first', rows.slice(0, 9).map((r) => r.orderUuid));
  await f.release('second', [rows[9].orderUuid, rows[0].orderUuid], '2026-11-05T12:01:00.000Z');
  await f.write(async (tx) => {
    const employee = good(await tx.list('employees'))[0]; const brief = good(await tx.list('briefs'))[0];
    for (let i = 0; i < 3; i += 1) {
      const employeeId = `extra-${i}`;
      good(await tx.insert('employees', { runId: f.context.runId, employeeId, name: `Extra ${i}`, principalId: `extra-principal-${i}` }));
      const { version, createdAt, updatedAt, ...rest } = brief;
      good(await tx.insert('briefs', { ...rest, employeeId }));
    }
    return ok({});
  });
  const first = good(await f.read());
  assert.equal(first.cars.length, 8); assert.equal(first.paging.cars.total, 10); assert.equal(first.buddies.length, 4);
  assert.equal(first.paging.buddies.total, 6);
  const next = good(await f.read('page=2&buddyPage=2'));
  assert.equal(next.cars.length, 2); assert.equal(next.buddies.length, 2);
  assert.equal(new Set([...first.cars, ...next.cars].map((r) => r.id)).size, 10);
  const latest = good(await f.read('release=latest'));
  assert.equal(latest.paging.cars.total, 2); assert.deepEqual(latest.cars.map((r) => r.id), [rows[9].orderUuid, rows[0].orderUuid]);
  const last = good(await f.read('page=999&buddyPage=999')); assert.equal(last.paging.cars.page, 2); assert.equal(last.paging.buddies.page, 2);
  for (const query of ['page=0', 'page=-1', 'page=1.1', 'page=01', 'page=10000000', 'page=Infinity', 'buddyPage=x', 'release=other', 'page=1&page=2', 'runId=other', 'employeeId=x']) {
    assert.equal((await f.read(query)).status, 'invalid', query);
  }
});

test('legacy decisions preserve zero and null, redact nested facts, and show stale versions', async (t) => {
  const f = await fixture(t); await f.release();
  const cars = good(await f.repository.query(f.context, 'stock')); const employees = f.employees;
  const briefs = good(await f.repository.query(f.context, 'briefs'));
  await f.write((tx) => tx.recordReceipt({ consumerId: 'buddy-allocation', eventId: 'legacy', eventType: 'stock-released',
    inputDigest: inputDigest('legacy'), state: 'completed', outcome: ok({ evaluatedAt: at, policyVersion: f.context.policyVersion,
      assignments: [], assumptions: [{ key: 'allocation.tieBreak.rule', value: 'fitThenRenewalDueThenSeededLottery' }],
      evaluations: employees.map((employee, i) => ({ employeeId: employee.employeeId, versions: { brief: i ? 0 : 1, policy: f.context.policyVersion },
        decisions: cars.map((car) => ({ orderUuid: car.orderUuid, score: i ? null : 0, gateStatus: i === 2 ? 'ineligible' : 'eligible',
          blockers: i === 2 ? [{ code: 'essential-unmet', field: 'seats', requirement: { value: 5, operator: 'gte' }, private: 'hidden' }] : [],
          reasons: [{ code: 'driver-eligible', fact: { private: 'hidden' } }], unknowns: [] })) })),
      inputVersions: { briefs: briefs.map((b) => ({ employeeId: b.employeeId, permission: b.buddy.permissionVersion,
        employee: f.store.state.tables.employees.find((e) => e.employeeId === b.employeeId).version })) } }) }));
  const view = good(await f.read()); const cells = view.cars[0].cells;
  const zero = cells.find((c) => c.employeeId === employees[0].employeeId);
  assert.equal(zero.score, 0); assert.equal(zero.outdated, false);
  assert.equal(cells.find((c) => c.employeeId === employees[1].employeeId).score, null);
  assert.equal(cells.find((c) => c.employeeId === employees[1].employeeId).outdated, true);
  assert.ok(cells.some((c) => c.gateStatus === 'ineligible' && c.blockers[0].requirement.value === 5));
  assert.doesNotMatch(JSON.stringify(view), /hidden|private|"fact"/);
});

test('a new brief does not silently reuse a previous score as current', async (t) => {
  const f = await fixture(t); await f.release(); good(await f.service.allocate(f.context, f.event));
  await f.write(async (tx) => {
    const old = good(await tx.list('briefs'))[0]; const { version, createdAt, updatedAt, ...rest } = old;
    return tx.insert('briefs', { ...rest, briefVersion: 2 });
  });
  const view = good(await f.read());
  const buddy = view.buddies.find((b) => b.briefVersion === 2);
  assert.ok(view.cars.every((car) => car.cells.find((c) => c.employeeId === buddy.id).outdated));
});

test('current occupancy is independent of historical evaluation and ignores released or expired holds', async (t) => {
  const f = await fixture(t); await f.release();
  const ids = good(await f.repository.query(f.context, 'stock')).map((row) => row.orderUuid);
  let holds = [{ orderUuid: ids[0], employeeId: f.employees[0].employeeId, type: 'cart', state: 'active' },
    { orderUuid: ids[1], employeeId: f.employees[1].employeeId, type: 'buddy-offer', state: 'expired' }];
  const repository = { ...f.repository, query: async (context, table, filter) => table === 'holds' ? ok(holds) : f.repository.query(context, table, filter) };
  const read = () => createPresenterSuitabilityRoutes({ ...f, repository })[0].handle({ context: f.context, body: {}, searchParams: new URLSearchParams() });
  const current = good(await read());
  assert.equal(current.cars[0].availability.state, 'reserved'); assert.equal(current.cars[0].availability.route, 'manual');
  assert.equal(current.cars[1].availability.state, 'available');
  assert.ok(current.cars[0].cells.every((cell) => cell.state === 'not-evaluated'));
  holds = [{ ...holds[0], state: 'allocated' }, { ...holds[1], state: 'released' }];
  assert.equal(good(await read()).cars[0].availability.state, 'allocated');
  assert.equal(good(await read()).cars[1].availability.state, 'available');
});

test('policy order comes from PolicyService, and a changed policy marks stored scores as earlier results', async (t) => {
  const rule = 'fitThenRenewalDueThenSeededLottery';
  const f = await fixture(t, { rule }); await f.release(); good(await f.service.allocate(f.context, f.event));
  const current = good(await f.read()); assert.equal(current.policy.allocationRule, rule);
  const context = { ...f.context, policyVersion: 'new-policy' };
  const changed = good(await createPresenterSuitabilityRoutes(f)[0].handle({ context, body: {}, searchParams: new URLSearchParams() }));
  assert.ok(changed.cars.every((car) => car.cells.every((cell) => cell.outdated)));
  assert.equal(changed.policy.allocationRule, null, 'an unavailable new policy order is not guessed');
});

test('missing referenced evaluation fails visibly; failed reads and a moving clock cannot fabricate absence', async (t) => {
  const f = await fixture(t); await f.release(); good(await f.service.allocate(f.context, f.event));
  const repository = { ...f.repository, read: async (context, ref) => ref.key.consumerId === 'buddy-allocation-evaluation'
    ? { status: 'not-found' } : f.repository.read(context, ref) };
  const read = (deps) => createPresenterSuitabilityRoutes(deps)[0].handle({ context: f.context, body: {}, searchParams: new URLSearchParams() });
  assert.equal((await read({ ...f, repository })).status, 'not-found');
  let version = 0;
  assert.equal((await read({ ...f, clock: { now: async () => ok({ now: at, clockVersion: ++version }) } })).status, 'unavailable');
});

test('presenter-control session only, no selector impersonation, and retired runs cannot be read', async (t) => {
  const f = await fixture(t); await f.release();
  const server = buildServer({ gcspRepository: f.repository, gcspPolicy: f.policy, gcspIdentity: f.identity,
    gcspClock: { ...f.clock, reconcileStartup: async () => ok({}) }, gcspStockRelease: { register: async () => ok({}) },
    gcspAllowedOrigins: ['https://matrix.test'] });
  good(await server.gcspStartup); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  const call = async (cookie, query = '') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/presenter/suitability${query}`,
      { headers: { Origin: 'https://matrix.test', ...(cookie ? { cookie } : {}) } });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call(jar(f.presenter.value.setCookie))).status, 200);
  assert.equal((await call(null)).status, 403);
  for (const principal of ['demo-paula', 'demo-greg']) {
    const employee = good(await f.identity.switchPrincipal(f.context, principal, `matrix-${principal}`));
    const refused = await call(jar(employee.setCookie)); assert.equal(refused.status, 403); assert.ok(!refused.body.value);
  }
  assert.equal((await call(jar(f.presenter.value.setCookie), '?employeeId=other')).status, 400);
  await f.retire(); const stale = await call(jar(f.presenter.value.setCookie)); assert.equal(stale.status, 409); assert.equal(stale.body.status, 'stale-run');
});
