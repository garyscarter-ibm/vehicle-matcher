import test from 'node:test';
import assert from 'node:assert/strict';
import { publishFixture, good, now, sessionCookie, allRows } from './helpers/greg-publish-run.js';
import { activateRunPolicy } from '../gcsp/policy/activation.js';
import { createGregPublishService } from '../gcsp/greg/publish/index.js';
import { DemoIdentityAdapter } from '../gcsp/identity/index.js';
import { result } from '../gcsp/repository/index.js';

const activate = (f, repository = f.repository) => activateRunPolicy({ repository, policy: f.policy }, f.context);
const wrapped = (f, transaction) => ({ read: (...args) => f.repository.read(...args), query: (...args) => f.repository.query(...args), transaction });

test('scheduled policy uses persisted DemoClock and adopts both references only at ordinary resolution', async (t) => {
  const f = await publishFixture(t); await f.schedule();
  let writes = 0;
  const spy = wrapped(f, (...args) => { writes++; return f.repository.transaction(...args); });
  good(await activate(f, spy)); assert.equal(writes, 0);
  good(await f.clock.advance(f.presenter.value.context, { commandId: 'reach-effective', expectedClockVersion: '1', bySeconds: 60 }));
  for (let i = 0; i < 3; i++) good(await f.identity.requireRole(f.context, 'greg'));
  assert.equal((await f.run()).policyVersion, 'gcsp-policy-v1');
  const before = await allRows(f);
  const session = good(await f.identity.resolveSession({ authorized: true, cookie: sessionCookie(f.acting) }));
  assert.equal(session.policyVersion, 'scheduled-v2');
  const after = await allRows(f);
  assert.equal(after.runs[0].policyVersion, 'scheduled-v2'); assert.equal(after.runs[0].versions.policy, 'scheduled-v2');
  const { runs: ignoredBefore, ...otherBefore } = before; const { runs: ignoredAfter, ...otherAfter } = after;
  assert.deepEqual(otherAfter, otherBefore);
  good(await activate(f, spy)); good(await activate(f, spy)); assert.equal(writes, 0);
});

test('CAS fencing retries a clock race and preserves unrelated version references', async (t) => {
  const f = await publishFixture(t); await f.schedule();
  await f.schedule('2026-11-05T09:02:00.000Z', 'scheduled-v3');
  good(await f.clock.advance(f.presenter.value.context, { commandId: 'reach-effective', expectedClockVersion: '1', bySeconds: 60 }));
  await f.write(async (tx) => {
    const run = good(await tx.get(f.runRef));
    return tx.compareAndSwap(f.runRef, run.version, { versions: { ...run.versions, integrationMarker: 'retained' } });
  });
  let attempts = 0;
  const repository = wrapped(f, async (...args) => {
    attempts++;
    if (attempts === 1) good(await f.clock.advance(f.presenter.value.context, {
      commandId: 'race-next-version', expectedClockVersion: '2', bySeconds: 60 }));
    return f.repository.transaction(...args);
  });
  good(await activate(f, repository)); assert.equal(attempts, 2);
  const run = await f.run(); assert.equal(run.policyVersion, 'scheduled-v3');
  assert.equal(run.versions.policy, 'scheduled-v3'); assert.equal(run.versions.integrationMarker, 'retained');
  assert.equal(run.clockInstant, '2026-11-05T09:02:00.000Z');
});

test('lost activation response reconciles without another run write', async (t) => {
  const f = await publishFixture(t); await f.schedule();
  good(await f.clock.advance(f.presenter.value.context, { commandId: 'reach-effective', expectedClockVersion: '1', bySeconds: 60 }));
  let writes = 0;
  const repository = wrapped(f, async (...args) => { writes++; await f.repository.transaction(...args); throw Error('lost response'); });
  assert.equal((await activate(f, repository)).status, 'unavailable');
  const committed = await f.run();
  good(await activate(f, repository)); assert.equal(writes, 1); assert.deepEqual(await f.run(), committed);
});

test('accepted publication survives failed activation and original command replay reconciles', async (t) => {
  const f = await publishFixture(t);
  let fail = true;
  const repository = wrapped(f, (...args) => fail ? Promise.resolve(result('unavailable', { retryable: true })) : f.repository.transaction(...args));
  const service = createGregPublishService({ ...f, repository });
  const input = f.command(); const accepted = good(await service.publish(f.context, input));
  assert.equal(accepted.accepted, true); assert.equal(accepted.activationRequired, true);
  assert.equal(accepted.activation.status, 'pending'); assert.equal(accepted.activation.retryable, true);
  assert.equal((await f.run()).policyVersion, 'gcsp-policy-v1');
  assert.equal((await f.policy.getActiveVersion({ runId: f.context.runId, asOf: now })).policyVersion, 'greg-policy-v2');
  fail = false;
  const replay = good(await service.publish(f.context, input));
  assert.equal(replay.accepted, true); assert.equal(replay.policyVersion, accepted.policyVersion);
  assert.equal(replay.activation.status, 'active'); assert.equal(replay.activationRequired, false);
  assert.equal(f.policyStore.runs.get(f.context.runId).length, 2);
  assert.equal((await f.run()).versions.policy, replay.policyVersion);
});

test('session expiry remains wall-clock based while policy activation uses a different demo date', async (t) => {
  const f = await publishFixture(t);
  let wall = '2026-12-05T00:00:00.000Z';
  const identity = new DemoIdentityAdapter({ repository: f.repository, policy: f.policy,
    currentRun: () => ({ runId: f.context.runId, environmentId: f.context.environmentId }), sessionNow: () => wall });
  const session = await identity.createPresenterSession('different-wall-clock'); good(session);
  const resolved = good(await identity.resolveSession({ authorized: true, cookie: sessionCookie(session) }));
  assert.equal(resolved.policyVersion, 'gcsp-policy-v1'); assert.equal((await f.run()).clockInstant, now);
  const sessions = good(await f.repository.query(f.context, 'identity_sessions'));
  const latestExpiry = sessions.map((row) => row.expiresAt).sort().at(-1);
  assert.ok(Date.parse(latestExpiry) > Date.parse(wall));
  wall = latestExpiry;
  assert.equal((await identity.resolveSession({ authorized: true, cookie: sessionCookie(session) })).status, 'expired-session');
  assert.equal((await identity.requireRole(resolved, 'presenter')).status, 'expired-session');
});

test('missing/invalid domain clock cannot activate; pure guards never invoke a write', async (t) => {
  const f = await publishFixture(t);
  let writes = 0;
  const repository = wrapped(f, (...args) => { writes++; return f.repository.transaction(...args); });
  const identity = new DemoIdentityAdapter({ repository, policy: f.policy,
    currentRun: () => ({ runId: f.context.runId, environmentId: f.context.environmentId }), sessionNow: () => now });
  const session = await identity.createPresenterSession('write-spy'); const context = good(session).context;
  writes = 0;
  for (let i = 0; i < 3; i++) { good(await identity.requireRole(context, 'presenter')); good(await identity.readPresenterPrincipals(context)); }
  assert.equal(writes, 0);
  good(await f.write(async (tx) => { const run = good(await tx.get(f.runRef)); return tx.compareAndSwap(f.runRef, run.version, { clockInstant: null }); }));
  assert.equal((await activate(f, repository)).status, 'unavailable'); assert.equal(writes, 0);
  assert.equal((await identity.resolveSession({ authorized: true, cookie: sessionCookie(session) })).status, 'unavailable');
});

test('repeated CAS conflicts stay pending and an earlier run cannot be activated', async (t) => {
  const f = await publishFixture(t); await f.schedule();
  good(await f.clock.advance(f.presenter.value.context, { commandId: 'reach-effective', expectedClockVersion: '1', bySeconds: 60 }));
  let attempts = 0;
  const repository = wrapped(f, async () => { attempts++; return result('stale-version', {}); });
  const before = await f.run(); const conflict = await activate(f, repository);
  assert.equal(conflict.status, 'conflict'); assert.equal(conflict.retryable, true); assert.equal(attempts, 3);
  assert.deepEqual(await f.run(), before);
  await f.write((tx) => tx.compareAndSwap(f.runRef, before.version, { current: false, status: 'historical' }));
  assert.equal((await activate(f, repository)).status, 'stale-run'); assert.equal(attempts, 3);
});
