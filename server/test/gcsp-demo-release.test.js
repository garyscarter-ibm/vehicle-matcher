// Actual launcher composition (memory, loopback HTTPS) with the demo stock provider; no browser or native DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { result } from '../gcsp/repository/index.js';
import { PolicyService, createPolicyService } from '../gcsp/policy/index.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';

const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const cookie = (value) => [value].flat().map((entry) => entry.split(';')[0]).join('; ');

const demoStock = (deps) => createDemoStockProvider(deps);
const read = { runId: 'demo-release-run', asOf: '2026-11-05T09:00:00.000Z' };
// Window car counts come from the seed through the real PolicyService, not literals.
async function seedWindows() {
  const entry = good(await createPolicyService().getAssumption('supply.release.windows', read));
  return entry.value.windows.map((row) => row.cars.length);
}
async function alternativePolicy(edit) {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  edit(seed, (key) => seed.assumptions.find((entry) => entry.key === key));
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}

async function launch(t, stockProvider, policy) {
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory', stockProvider,
    ...(policy ? { policy } : {}),
    environmentId: 'demo-release', policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'demo-release-bootstrap',
    sessionNow: () => '2026-11-06T00:00:00.000Z' } }));
  t.after(() => app.close());
  const presenter = good(await app.services.identity.createPresenterSession('demo-release-presenter'));
  let session = cookie(presenter.setCookie);
  const call = async (path, body) => {
    const response = await https.fetch(`${app.origin}/api/gcsp/presenter/controls${path}`, { method: body ? 'POST' : 'GET',
      headers: { Origin: app.origin, Cookie: session, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, json: await response.json() };
  };
  const stock = async () => good(await app.services.repository.query(presenter.context, 'stock'));
  const reopen = async (name) => { const next = good(await app.services.identity.createPresenterSession(name)); session = cookie(next.setCookie); };
  return { app, call, stock, reopen, context: presenter.context };
}
const released = (reply) => reply.json.value?.tick?.outcomes?.find((row) => row.handlerId === 'stock-release');

test('Next release through the composed launcher reports the real count and is idempotent by command ID', async (t) => {
  const f = await launch(t, demoStock);
  const before = (await f.call('')).json.value;
  assert.equal(before.controls.nextRelease.status, 'available');
  assert.equal((await f.stock()).filter((row) => row.state === 'released').length, 0);
  const body = { commandId: 'release-1', expectedClockVersion: before.clockVersion, mode: 'next-release' };
  const first = await f.call('/tick', body);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const outcome = released(first);
  assert.equal(outcome.outcome.status, 'ok'); assert.equal(outcome.outcome.value.kind, 'stock-released');
  assert.equal(outcome.outcome.value.source.mode, 'synthetic');
  const count = outcome.outcome.value.orderUuids.length;
  const [firstCount, laterCount] = await seedWindows();
  assert.equal(count, firstCount);
  const rows = (await f.stock()).filter((row) => row.state === 'released');
  assert.equal(rows.length, count);
  assert.deepEqual(rows.map((row) => row.orderUuid).sort(), [...outcome.outcome.value.orderUuids].sort());
  // Same command ID replays the same outcome without duplicating stock.
  const replay = await f.call('/tick', body);
  assert.equal(replay.status, 200); assert.deepEqual(replay.json, first.json);
  assert.equal((await f.stock()).filter((row) => row.state === 'released').length, count);
  // The only release cue has passed, so the backend refuses another Next release rather than claiming one.
  const after = (await f.call('')).json.value;
  assert.equal(after.controls.nextRelease.status, 'unavailable');
  assert.equal(after.lastTick.outcomes.find((row) => row.handlerId === 'stock-release').outcome.value.orderUuids.length, count);
  const again = await f.call('/tick', { commandId: 'release-2', expectedClockVersion: after.clockVersion, mode: 'next-release' });
  assert.notEqual(again.status, 200); assert.equal(again.json.status, 'unavailable');
  // A later tick with a new command ID releases the next tranche once the clock reaches its window.
  const later = await f.call('/tick', { commandId: 'release-3', expectedClockVersion: after.clockVersion, mode: 'to',
    to: '2026-11-05T12:00:00.000Z' });
  assert.equal(later.status, 200, JSON.stringify(later.json));
  assert.equal(released(later).outcome.value.orderUuids.length, laterCount);
  assert.equal((await f.stock()).filter((row) => row.state === 'released').length, count + laterCount);
});

test('a reset run gets its own stock plan from the same launcher provider', async (t) => {
  const f = await launch(t, demoStock);
  const first = (await f.call('')).json.value;
  assert.equal((await f.call('/tick', { commandId: 'a', expectedClockVersion: first.clockVersion, mode: 'next-release' })).status, 200);
  const current = (await f.call('')).json.value;
  const reset = good(await f.app.services.clock.reset(f.context, { commandId: 'demo-reset', expectedRunId: current.runId,
    expectedRunVersion: current.runVersion, scenarioVersion: current.versions.scenario, fixtureVersion: current.versions.fixture }));
  assert.notEqual(reset.runId, first.runId);
  await f.reopen('demo-release-presenter-2');
  const next = (await f.call('')).json.value;
  assert.equal(next.controls.nextRelease.status, 'available');
  const reply = await f.call('/tick', { commandId: 'b', expectedClockVersion: next.clockVersion, mode: 'next-release' });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  assert.equal(released(reply).outcome.value.orderUuids.length, (await seedWindows())[0]);
});

test('an unavailable provider is reported as such and releases no stock', async (t) => {
  const f = await launch(t, { async pull() { return result('unavailable', { reason: 'Stock source is unavailable.', retryable: true }); } });
  const before = (await f.call('')).json.value;
  const reply = await f.call('/tick', { commandId: 'release-down', expectedClockVersion: before.clockVersion, mode: 'next-release' });
  assert.ok(reply.status !== 200 || released(reply)?.outcome?.status !== 'ok', JSON.stringify(reply.json));
  assert.equal((await f.stock()).filter((entry) => entry.state === 'released').length, 0);
});

test('moving the policy cue and window cars moves Next release with no provider change', async (t) => {
  const cue = '2026-11-05T09:45:00.000Z';
  const policy = await alternativePolicy((seed, entry) => {
    entry('clock.scenario.v1').value.namedTimes.release = cue;
    entry('supply.release.windows').value.windows[0].cars = ['saloon', 'i5'];
  });
  const f = await launch(t, demoStock, policy);
  const before = (await f.call('')).json.value;
  assert.equal(before.controls.nextRelease.at, cue);
  const reply = await f.call('/tick', { commandId: 'moved-cue', expectedClockVersion: before.clockVersion, mode: 'next-release' });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  assert.equal(released(reply).outcome.value.orderUuids.length, 2);
  assert.equal(reply.json.value.advance.now ?? reply.json.value.advance.clockInstant, cue);
  assert.equal((await f.stock()).filter((row) => row.state === 'released').length, 2);
});

test('a policy without supply.release.windows makes Next release unavailable and releases no stock', async (t) => {
  const policy = await alternativePolicy((seed) => { seed.assumptions = seed.assumptions.filter((entry) => entry.key !== 'supply.release.windows'); });
  const f = await launch(t, demoStock, policy);
  const before = (await f.call('')).json.value;
  const reply = await f.call('/tick', { commandId: 'no-windows', expectedClockVersion: before.clockVersion, mode: 'next-release' });
  assert.ok(reply.status !== 200 || released(reply)?.outcome?.status !== 'ok', JSON.stringify(reply.json));
  assert.equal((await f.stock()).filter((row) => row.state === 'released').length, 0);
});
