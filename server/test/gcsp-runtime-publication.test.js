import test from 'node:test';
import assert from 'node:assert/strict';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { PolicyService, FilePolicyProvider, MemoryPolicyProvider, PostgresPolicyProvider } from '../gcsp/policy/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { startHttpServer, cookieOf } from './helpers/employee-recommendation-http.js';
import { stock, fact } from './helpers/employee-recommendation.js';
import { saved } from './helpers/greg-demand-run.js';
import { good, response, now, adoptionCommand } from './helpers/gcsp-reviewed-runtime.js';

const options = { mode: 'memory', environmentId: 'runtime-publish', policyAsOf: now,
  commandId: 'bootstrap', sessionNow: () => now };
async function open(t, overrides = {}) {
  const f = good(await createGcspRuntime({ ...options, ...overrides }));
  const session = await f.createLocalSession(); good(session);
  const http = await startHttpServer(f.dependencies);
  t.after(async () => { await http.close(); await f.close(); });
  const out = await http.request('/api/gcsp/session/switch', { session, body: { principalId: 'demo-greg', commandId: 'greg-http' } }); response(out);
  const greg = { value: { setCookie: out.headers.get('set-cookie') } };
  return { ...f, session, http, gregSession: greg };
}
const rows = async (f) => Object.fromEntries(await Promise.all(['briefs', 'stock', 'holds', 'offers', 'quotes', 'employees']
  .map(async (table) => [table, good(await f.repository.query(f.session.value.context, table))])));

test('delivered memory runtime dependencies drive ordinary Greg publish and employee terms while protecting pinned history', async (t) => {
  const f = await open(t); const context = f.session.value.context;
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
  await release(1);
  const brief = saved();
  response(await f.http.request('/api/gcsp/brief/draft', { session: f.session,
    body: { commandId: 'runtime-draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief } }));
  response(await f.http.request('/api/gcsp/brief/confirm', { session: f.session,
    body: { commandId: 'runtime-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } } }));
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
