import test from 'node:test';
import assert from 'node:assert/strict';
import { publishFixture, good, allRows } from './helpers/greg-publish-run.js';
import { confirm, saved, release } from './helpers/greg-demand-run.js';
import { providerValue, preference } from './helpers/employee-recommendation.js';
import { startHttpServer } from './helpers/employee-recommendation-http.js';
import { ok } from '../gcsp/repository/index.js';

async function httpFixture(t) {
  const writeSpy = { calls: 0 };
  const f = await publishFixture(t, { canonical: true, wrapRepository(repository) {
    return { ...repository, transaction(...args) { writeSpy.calls++; return repository.transaction(...args); } };
  } });
  const provider = { async resolve(context) {
    const rows = good(await f.repository.query(context, 'stock')).filter((row) => row.state === 'released' && row.available === true);
    return ok({ ...providerValue(), runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
      stockVersion: rows.map((row) => `${row.orderUuid}:${row.version}`).join('|') || 'empty',
      stock: rows.map((row) => ({ orderUuid: row.orderUuid, configurationId: row.configurationId,
        snapshot: row.facts, availability: row.release.availability })) });
  } };
  const http = await startHttpServer({ gcspRepository: f.repository, gcspPolicy: f.policy,
    gcspClock: f.clock, gcspIdentity: f.identity, gcspGreg: f.service,
    gcspRecommendations: { provider, policy: f.policy } });
  t.after(() => http.close());
  const acting = async (principalId, commandId) => {
    const out = await http.request('/api/gcsp/session/switch', { session: f.presenter, body: { principalId, commandId } });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return { value: { setCookie: out.headers.get('set-cookie'), context: out.json.value } };
  };
  return { ...f, ...http, acting, writeSpy };
}
const response = (out) => { assert.equal(out.status, 200, JSON.stringify(out.json)); return good(out.json); };

test('ordinary HTTP legacy preview/publish activates run and next employee evaluation, preserving an actual pinned quote', async (t) => {
  const f = await httpFixture(t);
  const brief = saved(); brief.preferences = { body: preference('estate'), fuel: preference('diesel') };
  await confirm(f, brief); await release(f);
  const paula = await f.acting('demo-paula', 'http-paula');
  const greg = await f.acting('demo-greg', 'http-greg');
  response(await f.request('/api/gcsp/context', { session: paula }));
  const request = { ...brief, briefVersion: 1 };
  const beforeEmployee = response(await f.request('/api/gcsp/recommendations', { session: paula, body: request }));
  assert.equal(beforeEmployee.versions.policy, 'gcsp-policy-v1');
  const previous = beforeEmployee.recommendations[0]; assert.ok(previous);
  assert.equal(previous.terms.points.value, 1100);
  await f.write(async (tx) => {
    await tx.insert('quotes', { runId: f.context.runId, quoteId: 'pinned-http', orderUuid: previous.orderUuid,
      employeeId: f.employee.employeeId, briefVersion: 1, policyVersion: previous.versions.policy, terms: previous.terms });
    await tx.insert('holds', { runId: f.context.runId, holdId: 'pinned-http', orderUuid: previous.orderUuid,
      employeeId: f.employee.employeeId, entitlementSlotId: f.employee.entitlementSlotId, type: 'buddy-offer', state: 'active',
      quoteId: 'pinned-http', policyVersion: previous.versions.policy });
    await tx.insert('offers', { runId: f.context.runId, offerId: 'pinned-http', holdId: 'pinned-http', orderUuid: previous.orderUuid,
      employeeId: f.employee.employeeId, state: 'active', quoteId: 'pinned-http', briefVersion: 1, policyVersion: previous.versions.policy });
    const ref = { table: 'stock', key: { runId: f.context.runId, orderUuid: previous.orderUuid } };
    return tx.compareAndSwap(ref, good(await tx.get(ref)).version, { state: 'held', held: true, available: false });
  });
  await release(f, 2);
  const projection = response(await f.request('/api/gcsp/greg/policy', { session: greg }));
  assert.equal(projection.weightsAdoptionRequired, true); assert.equal(projection.heldOffers.count, 1);
  const input = { ...f.command(), changes: [...f.command().changes, { id: 'weight:body', value: 0 }] };
  const snapshot = await allRows(f); const policies = structuredClone([...f.policyStore.runs]);
  f.writeSpy.calls = 0;
  {
    const preview = response(await f.request('/api/gcsp/greg/policy/preview', { session: greg,
      body: { expectedActiveVersion: input.expectedActiveVersion, changes: input.changes } }));
    assert.equal(preview.state, 'preview-ready'); assert.equal(preview.preview, true);
    assert.equal(preview.active.fit.meanBestScore.status, 'suppressed');
    const expensive = response(await f.request('/api/gcsp/greg/policy/preview', { session: greg,
      body: { expectedActiveVersion: input.expectedActiveVersion, changes: [{ id: `price:${f.price.key}`, value: 2000 }] } }));
    assert.notDeepEqual(expensive.active.demand.demand.unmet.byGate, expensive.draft.demand.demand.unmet.byGate);
    assert.equal(f.writeSpy.calls, 0); assert.deepEqual(await allRows(f), snapshot); assert.deepEqual([...f.policyStore.runs], policies);
  }
  const published = response(await f.request('/api/gcsp/greg/policy/publish', { session: greg, body: input }));
  assert.equal(published.accepted, true); assert.equal(published.activationRequired, false);
  assert.equal(published.activation.status, 'active'); assert.equal(published.activation.publishedVersionActive, true);
  assert.equal((await f.run()).policyVersion, 'greg-policy-v2'); assert.equal((await f.run()).versions.policy, 'greg-policy-v2');
  const reloaded = response(await f.request('/api/gcsp/context', { session: paula }));
  assert.equal(reloaded.policyVersion, 'greg-policy-v2');
  const next = response(await f.request('/api/gcsp/recommendations', { session: paula, body: request }));
  assert.equal(next.versions.policy, 'greg-policy-v2'); assert.equal(next.recommendations[0].terms.points.value, 1200);
  assert.notEqual(next.recommendations[0].score, previous.score);
  assert.equal(next.recommendations[0].components.find((row) => row.field === 'body').policyWeight, 0);
  const after = await allRows(f); const { runs: beforeRuns, ...beforeRows } = snapshot; const { runs: afterRuns, ...afterRows } = after;
  assert.deepEqual(afterRows, beforeRows); assert.deepEqual(after.quotes[0].terms, previous.terms);
  const retained = good(await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: projection.asOf, policyVersion: 'gcsp-policy-v1' }));
  assert.equal(Object.hasOwn(retained.assumptions.find((row) => row.key === 'employee.recommendation.v1').value, 'preferenceWeights'), false);
  const replay = response(await f.request('/api/gcsp/greg/policy/publish', { session: greg, body: input }));
  assert.equal(replay.policyVersion, published.policyVersion); assert.equal(f.policyStore.runs.get(f.context.runId).length, 2);
  const controls = response(await f.request('/api/gcsp/presenter/controls', { session: f.presenter }));
  assert.ok(controls.controls.step.value > 0); assert.ok(controls.principals.every((row) => Object.keys(row).length === 3));
});

test('registered policy routes retain gate, origin, roles and strict trusted-context boundary', async (t) => {
  const f = await httpFixture(t); const greg = await f.acting('demo-greg', 'http-guard-greg');
  assert.equal((await f.request('/api/gcsp/greg/policy')).status, 401);
  assert.equal((await f.request('/api/gcsp/greg/policy', { session: f.presenter })).status, 403);
  const employee = await f.acting('demo-paula', 'http-guard-paula');
  assert.equal((await f.request('/api/gcsp/greg/policy', { session: employee })).status, 403);
  assert.equal((await f.request('/api/gcsp/greg/policy', { session: greg, origin: 'https://hostile.test' })).status, 403);
  assert.equal((await f.request('/api/gcsp/greg/policy?policyVersion=forged', { session: greg })).status, 400);
  for (const patch of [{ context: { roles: ['greg'] } }, { policyVersion: 'forged' }, { unknown: true }]) {
    assert.equal((await f.request('/api/gcsp/greg/policy/preview', { session: greg,
      body: { expectedActiveVersion: 'gcsp-policy-v1', changes: [{ id: 'weight:body', value: 0 }], ...patch } })).status, 400);
  }
  const before = await allRows(f);
  process.env.DEMO_ACCESS_KEY = 'policy-http-test-key';
  assert.equal((await f.request('/api/gcsp/greg/policy', { session: greg })).status, 401);
  response(await f.request('/api/gcsp/greg/policy', { session: greg, headers: { 'X-Access-Key': 'policy-http-test-key' } }));
  delete process.env.DEMO_ACCESS_KEY;
  assert.deepEqual(await allRows(f), before);
});
