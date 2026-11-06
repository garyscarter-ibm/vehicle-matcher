import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../gcsp/policy/index.js';
import { getReviewedDefinitionSet, validateReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
import { startHttpServer, cookieOf } from './helpers/employee-recommendation-http.js';
import { good, response, reviewedRuntime, adoptionCommand } from './helpers/gcsp-reviewed-runtime.js';

const start = '2026-11-06T09:00:00.000Z';
const definitions = [
  { id: 'offer-decline-reasons-v1', path: 'offer-decline-reasons-v1.json',
    sha: '1f1b632be83ddef1a5656288b4e40c0378736cda5c21fcf03de68544dfbe688f',
    digest: '2d7be8d50ff899dd4c72ed3490bcfc888e092196ef19b44d5d0519de76f00b4d', count: 1 },
  { id: 'offer-followup-questions-v1', path: 'offer-followup-questions-v1.json',
    sha: '2b634e30a65f8fce6a3cfef67e10b04e9dff72ecb4fe296c51330e98efe86d5d',
    digest: 'bb05e490f85e9f6fd9aa1c424c849740ad2884cc62e9d9a2b98ee8f739f8b7ed', count: 1 },
  { id: 'fucq115-choice-model-v1', path: 'fucq115-choice-model-v1.json',
    sha: '89565ec7fa05db042e623c6c88c132542505f7757848e61784f38d49b8391987',
    digest: 'dec7093d94d6ce4494c98a92b6aa2e0dc4207c1ee506d1eb449e51c36e9cd54d', count: 7 },
];
const withoutPin = ({ policyVersion, effectiveFrom, ...row }) => row;

// The canonical proof uses MemoryPolicyProvider's unmodified seed, never a snapshot overlay.
async function canonicalRuntime(t) {
  const store = createMemoryPolicyStore();
  const readPolicy = new PolicyService({ provider: new MemoryPolicyProvider({ store }) });
  const f = good(await createGcspRuntime({ mode: 'memory', policy: readPolicy,
    environmentId: 'consumer-registration', commandId: 'bootstrap', policyAsOf: start, sessionNow: () => start }));
  let http;
  t.after(async () => { try { await http?.close(); } finally { try { await f.close(); } finally { await readPolicy.close(); } } });
  const session = await f.createLocalSession(); good(session);
  const presenter = good(await f.identity.resolveSession({ authorized: true, cookie: cookieOf(session), purpose: 'presenter-control' }));
  http = await startHttpServer(f.dependencies);
  const initialClock = good(await f.clock.now(presenter));
  assert.ok(Date.parse(initialClock.now) < Date.parse(start));
  good(await f.clock.advance(presenter, { commandId: 'prepare-dated-consumer-trial',
    expectedClockVersion: initialClock.clockVersion, to: start }));
  const switched = await http.request('/api/gcsp/session/switch', { session,
    body: { principalId: 'demo-greg', commandId: 'consumer-greg' } }); response(switched);
  const gregSession = { value: { setCookie: switched.headers.get('set-cookie') } };
  const greg = good(await f.identity.resolveSession({ authorized: true, cookie: cookieOf(gregSession) }));
  const ordinary = () => http.request('/api/gcsp/context', { session }).then(response);
  const advance = async () => {
    const clock = good(await f.clock.now(presenter));
    good(await f.clock.advance(presenter, { commandId: `step:${clock.clockVersion}`,
      expectedClockVersion: clock.clockVersion, bySeconds: 1 }));
  };
  const read = async () => ({ runId: session.value.context.runId, asOf: good(await f.clock.now(presenter)).now });
  const adopt = async (id, policyVersion, expectedActiveVersion) => {
    const pin = await read();
    const input = { commandId: `adopt:${id}`, expectedActiveVersion, policyVersion,
      effectiveFrom: pin.asOf, definitionSetId: id };
    return { input, accepted: good(await f.policy.adoptReviewedAssumptions(greg, input)) };
  };
  return { ...f, store, readPolicy, session, greg, ordinary, advance, read, adopt };
}

test('consumer registry loads exact reviewed bytes, validates and deeply freezes all six bundles', async () => {
  for (const item of definitions) {
    const bytes = await readFile(new URL(`../gcsp/policy/reviewed/${item.path}`, import.meta.url));
    const bundle = getReviewedDefinitionSet(item.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha);
    assert.deepEqual(bundle, JSON.parse(bytes)); assert.equal(bundle.digest, item.digest);
    assert.equal(bundle.definitions.length, item.count); assert.equal(validateReviewedDefinitionSet(bundle), true);
    assert.throws(() => { bundle.definitions[0].value = null; }, TypeError);
    assert.throws(() => { bundle.definitions.push({}); }, TypeError);
  }
  assert.notEqual(getReviewedDefinitionSet('offer-decline-reasons-v1').definitions[0].key,
    getReviewedDefinitionSet('offer-followup-questions-v1').definitions[0].key);
  for (const id of ['presenter-controls-v1', 'greg-publish-editor-v1', 'fucq113-learning-v1'])
    assert.equal(validateReviewedDefinitionSet(getReviewedDefinitionSet(id)), true);
});

for (const item of definitions) {
  test(`${item.id}: canonical same-provider adoption, ordinary activation and original retry preserve history and prices`, async (t) => {
    const f = await canonicalRuntime(t); const pin = await f.read();
    const before = good(await f.readPolicy.getPolicySnapshot(pin));
    const initialRecord = structuredClone(f.store.runs.get(pin.runId)[0]);
    const bundle = getReviewedDefinitionSet(item.id); const keys = bundle.definitions.map((row) => row.key);
    assert.equal(before.assumptions.some((row) => keys.includes(row.key)), false);
    const { input, accepted } = await f.adopt(item.id, 'consumer-v2', before.policyVersion);
    assert.equal(accepted.activationRequired, false);
    assert.deepEqual(accepted.adoption, { definitionSetId: item.id, revision: bundle.revision,
      digest: bundle.digest, addedKeys: keys });
    assert.equal((await f.ordinary()).policyVersion, input.policyVersion);
    const after = good(await f.readPolicy.getPolicySnapshot(await f.read()));
    assert.deepEqual(after.assumptions.filter((row) => !keys.includes(row.key)).map(withoutPin), before.assumptions.map(withoutPin));
    for (const row of bundle.definitions)
      assert.deepEqual(withoutPin(good(await f.readPolicy.getAssumption(row.key, await f.read()))), row);
    for (const [table, rows] of Object.entries(before).filter(([, value]) => Array.isArray(value)))
      if (table !== 'assumptions') assert.deepEqual(after[table].map(withoutPin), rows.map(withoutPin));
    assert.deepEqual(f.store.runs.get(pin.runId)[0], initialRecord);
    assert.equal(good(await f.policy.adoptReviewedAssumptions(f.greg, input)).accepted, true);
    assert.equal(f.store.runs.get(pin.runId).length, 2);
    const historical = good(await f.readPolicy.getPolicySnapshot({ ...pin, policyVersion: before.policyVersion }));
    assert.deepEqual(historical, before);
  });

  test(`${item.id}: an existing tuned key retains its value and provenance`, async (t) => {
    const bundle = getReviewedDefinitionSet(item.id);
    const existing = structuredClone(bundle.definitions[0]);
    existing.value = typeof existing.value === 'number' ? 0.02 : { ...existing.value, schemaVersion: existing.value.schemaVersion };
    if (item.id === 'offer-decline-reasons-v1') existing.value.reasons[0].label = 'Previously tuned body label';
    if (item.id === 'offer-followup-questions-v1') existing.value.questions[0].prompt = 'Previously tuned body question';
    existing.basis = 'Explicit prior isolated tuning must survive missing-only adoption.';
    existing.source = 'synthetic:prior-consumer-tuning';
    const f = await reviewedRuntime(t, { missingStep: false, transform(seed) {
      seed.assumptions.push({ ...existing, policyVersion: seed.policyVersion, effectiveFrom: seed.effectiveFrom });
    } });
    const input = adoptionCommand({ definitionSetId: item.id, policyVersion: 'tuned-consumer-v2' });
    const out = await f.policy.adoptReviewedAssumptions(f.greg.context, input);
    if (bundle.definitions.length === 1) assert.equal(out.status, 'invalid');
    else assert.deepEqual(good(out).adoption.addedKeys, bundle.definitions.slice(1).map((row) => row.key));
    const pin = { runId: f.greg.context.runId, asOf: input.effectiveFrom };
    assert.deepEqual(withoutPin(good(await f.readPolicy.getAssumption(existing.key, pin))), existing);
  });
}

test('isolated 80x4 setup uses dated canonical publication and coherent readback without generating records', async (t) => {
  const f = await canonicalRuntime(t); const initialPin = await f.read();
  const original = good(await f.readPolicy.getPolicySnapshot(initialPin));
  await f.adopt('fucq113-learning-v1', 'fucq115-learning-v2', original.policyVersion);
  await f.advance(); await f.adopt('fucq115-choice-model-v1', 'fucq115-choice-model-v3', 'fucq115-learning-v2');
  await f.advance();
  const input = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq103/fucq115-dated-policy-command.json', import.meta.url)));
  assert.equal((await f.read()).asOf, input.effectiveFrom);
  const before = good(await f.readPolicy.getPolicySnapshot(await f.read()));
  const history = structuredClone(f.store.runs.get(initialPin.runId));
  assert.equal(good(await f.policy.publishPolicyVersion(f.greg, input)).accepted, true);
  assert.equal((await f.ordinary()).policyVersion, input.policyVersion);
  const pin = { ...await f.read(), policyVersion: input.policyVersion };
  const snapshot = good(await f.readPolicy.getPolicySnapshot(pin));
  for (const change of input.changes) {
    const row = good(await f.readPolicy.getAssumption(change.key, pin));
    for (const [key, value] of Object.entries(change.patch)) assert.deepEqual(row[key], value);
    assert.equal(row.policyVersion, pin.policyVersion); assert.equal(row.effectiveFrom, input.effectiveFrom);
  }
  const changed = new Set(input.changes.map((row) => row.key));
  assert.deepEqual(snapshot.assumptions.filter((row) => !changed.has(row.key)).map(withoutPin),
    before.assumptions.filter((row) => !changed.has(row.key)).map(withoutPin));
  assert.deepEqual(snapshot.pricePlans.map(withoutPin), original.pricePlans.map(withoutPin));
  assert.deepEqual(f.store.runs.get(initialPin.runId).slice(0, history.length), history);
  assert.deepEqual(good(await f.readPolicy.getPolicySnapshot({ ...initialPin, policyVersion: original.policyVersion })), original);
  good(await f.policy.publishPolicyVersion(f.greg, input));
  assert.equal(f.store.runs.get(initialPin.runId).length, 4);
  assert.equal(good(await f.readPolicy.getAssumption('choice.model.reference', pin)).value.artifactId, 'unavailable');
  assert.deepEqual(good(await f.readPolicy.getAssumption('choice.training.split.v1', pin)).value.heldOutCohorts, ['G8-10']);
  assert.ok(Date.parse(good(await f.readPolicy.getAssumption('comparison.startsAt', pin)).value) >= Date.parse(pin.asOf));
});
