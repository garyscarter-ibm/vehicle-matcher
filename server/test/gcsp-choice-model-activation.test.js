import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { getReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
import { readActiveChoiceModel, readModelArtifact, contentDigest, adoptChoiceTrainingPolicy, loadChoiceTrainingPolicy } from '../gcsp/predict/model/index.js';

const ARTIFACTS = fileURLToPath(new URL('../../docs/gcsp/models/artifacts/', import.meta.url));
const ARTIFACT_ID = 'sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d';
const START = '2026-11-05T09:00:00.000Z';
const ACTIVE_FROM = '2026-11-12T09:00:00.000Z';
const REFERENCE = 'choice.model.reference';
const good = (out) => { assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value; };
const withoutPin = ({ policyVersion, effectiveFrom, ...row }) => row;

// Seed-v1 stays unchanged in a memory store; each reviewed set is adopted as Greg, one second apart.
async function adoptedRuntime(t) {
  const store = createMemoryPolicyStore();
  const policy = new PolicyService({ provider: new MemoryPolicyProvider({ store }) });
  const repository = createMemoryRepository({ store: createMemoryStore() });
  assert.equal((await repository.open()).status, 'ok');
  const runtime = good(await createDemoRuntime({ repository, policy, environmentId: 'choice-activation', environmentKind: 'synthetic',
    policyAsOf: START, commandId: 'bootstrap', sessionNow: () => START }));
  const { clock, identity } = runtime;
  t.after(async () => { await repository.close(); await policy.close(); });
  const publisher = policy.withPublicationPorts({ identity, clock, repository });
  const presenter = good(await identity.createPresenterSession('presenter')).context;
  const greg = good(await identity.switchPrincipal(presenter, 'demo-greg', 'greg')).context;
  const now = async () => good(await clock.now(presenter));
  const adopt = async (definitionSetId, expectedActiveVersion) => {
    const time = await now();
    return good(await publisher.adoptReviewedAssumptions(greg, { commandId: `adopt:${definitionSetId}`, expectedActiveVersion,
      policyVersion: `${expectedActiveVersion}+${definitionSetId}`, effectiveFrom: time.now, definitionSetId }));
  };
  const step = async () => { const time = await now();
    good(await clock.advance(presenter, { commandId: `step:${time.clockVersion}`, expectedClockVersion: time.clockVersion, bySeconds: 1 })); };
  return { store, policy, publisher, greg, presenter, runId: greg.runId, adopt, step, now };
}

test('seed-v1 and every committed default carry no active learned model', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  assert.equal(seed.assumptions.some((row) => row.key === REFERENCE), false);
  const bundled = getReviewedDefinitionSet('fucq115-choice-model-v1').definitions.find((row) => row.key === REFERENCE);
  assert.equal(bundled.value.artifactId, 'unavailable');
  for (const file of ['../gcsp/runtime.js', '../gcsp/host.js'])
    assert.equal((await readFile(new URL(file, import.meta.url), 'utf8')).includes('fucq115-choice-model-v1'), false, file);
});

test('canonical default (seed-v1 plus startup adoptions) leaves the baseline driving: no learned model is active', async (t) => {
  const readPolicy = new PolicyService({ provider: new MemoryPolicyProvider({ store: createMemoryPolicyStore() }) });
  const runtime = good(await createGcspRuntime({ mode: 'memory', policy: readPolicy, environmentId: 'choice-canonical',
    commandId: 'bootstrap', policyAsOf: START, sessionNow: () => START, adoptOfferJourney: true }));
  t.after(async () => { await runtime.close(); await readPolicy.close(); });
  const session = good(await runtime.createLocalSession());
  const read = { runId: session.context.runId, asOf: good(await runtime.clock.now(session.context)).now };
  const active = good(await readPolicy.getActiveVersion(read));
  assert.match(active.policyVersion, /offer-journey-v1/, 'startup adoption ran');
  assert.notEqual((await readPolicy.getAssumption(REFERENCE, read)).status, 'ok');
  const out = await readActiveChoiceModel({ policyService: readPolicy, policyRead: read, artifactDirectory: ARTIFACTS });
  assert.equal(out.status, 'unavailable'); assert.equal(out.code, 'choice-policy-unavailable');
});

test('a trained artifact is activated only by a dated successor that changes choice.model.reference alone', async (t) => {
  const f = await adoptedRuntime(t);
  const base = good(await f.policy.getActiveVersion({ runId: f.runId, asOf: START }));
  await f.adopt('fucq113-learning-v1', base.policyVersion); await f.step();
  const adopted = await f.adopt('fucq115-choice-model-v1', `${base.policyVersion}+fucq113-learning-v1`); await f.step();
  const earlier = adopted.policyVersion; const asOf = (await f.now()).now;
  const readEarlier = { runId: f.runId, asOf, policyVersion: earlier };
  const retained = structuredClone(f.store.runs.get(f.runId));
  assert.deepEqual(good(await f.policy.getAssumption(REFERENCE, readEarlier)).value, { artifactId: 'unavailable', featureVersion: 'unavailable', schemaVersion: 1 });
  assert.equal((await readActiveChoiceModel({ policyService: f.policy, policyRead: readEarlier, artifactDirectory: ARTIFACTS })).status, 'unavailable');
  const before = good(await f.policy.getPolicySnapshot(readEarlier));

  const artifact = await readModelArtifact(`${ARTIFACTS}${ARTIFACT_ID.slice(7)}.json`, ARTIFACT_ID);
  assert.equal(`sha256:${contentDigest(artifact.payload)}`, ARTIFACT_ID);
  const value = { artifactId: artifact.artifactId, featureVersion: artifact.payload.featureVersion, schemaVersion: 1 };
  const published = good(await f.publisher.publishPolicyVersion(f.greg, { commandId: 'activate-choice-model', expectedActiveVersion: earlier,
    policyVersion: `${earlier}+model`, effectiveFrom: ACTIVE_FROM, changes: [{ table: 'assumptions', key: REFERENCE, patch: { value, status: 'assumed',
      sourceDate: '2026-11-09', source: 'server/test/gcsp-choice-model-activation.test.js',
      basis: 'Dated test activation of a content-addressed synthetic-trained artifact; the baseline stays the plan driver.' } }] }));
  assert.equal(published.effectiveFrom, ACTIVE_FROM);

  const after = good(await f.policy.getPolicySnapshot({ runId: f.runId, asOf: ACTIVE_FROM, policyVersion: published.policyVersion }));
  const others = (rows) => rows.filter((row) => row.key !== REFERENCE).map(withoutPin);
  assert.deepEqual(others(after.assumptions), others(before.assumptions));
  for (const table of Object.keys(before).filter((key) => Array.isArray(before[key]) && key !== 'assumptions'))
    assert.deepEqual(after[table].map(withoutPin), before[table].map(withoutPin), table);
  assert.deepEqual(good(await f.policy.getAssumption(REFERENCE, { runId: f.runId, asOf: ACTIVE_FROM })).value, value);

  // The earlier version stays readable, and reads dated before effectiveFrom still resolve it.
  assert.equal(good(await f.policy.getAssumption(REFERENCE, readEarlier)).value.artifactId, 'unavailable');
  const dated = good(await f.policy.getAssumption(REFERENCE, { runId: f.runId, asOf: '2026-11-12T08:59:59.000Z' }));
  assert.equal(dated.policyVersion, earlier); assert.equal(dated.value.artifactId, 'unavailable');
  assert.deepEqual(f.store.runs.get(f.runId).slice(0, retained.length), retained);
  assert.equal(f.store.runs.get(f.runId).length, retained.length + 1);

  const active = good(await readActiveChoiceModel({ policyService: f.policy, policyRead: { runId: f.runId, asOf: ACTIVE_FROM }, artifactDirectory: ARTIFACTS }));
  assert.equal(active.artifact.artifactId, ARTIFACT_ID); assert.equal(active.activation.policyVersion, published.policyVersion);
  const stillEarly = await readActiveChoiceModel({ policyService: f.policy, policyRead: { runId: f.runId, asOf: '2026-11-12T08:59:59.000Z' }, artifactDirectory: ARTIFACTS });
  assert.equal(stillEarly.status, 'unavailable');
});

test('trainer policy adoption reads training keys through PolicyService and narrows evaluation cycles by a dated successor', async () => {
  const full = await adoptChoiceTrainingPolicy({ availableCycleIndices: [0, 1, 2, 3] });
  const narrow = await adoptChoiceTrainingPolicy({ availableCycleIndices: [0, 1, 2] });
  try {
    const wide = good(await loadChoiceTrainingPolicy(full)); const short = good(await loadChoiceTrainingPolicy(narrow));
    assert.deepEqual(wide.split.evaluationCycleIndices, [2, 3]); assert.deepEqual(short.split.evaluationCycleIndices, [2]);
    assert.deepEqual({ ...short.split, evaluationCycleIndices: [2, 3] }, wide.split);
    assert.equal(short.regularization, wide.regularization);
    assert.match(short.policyVersion, /\+evaluation-cycles$/);
    assert.equal(good(await narrow.policyService.getAssumption(REFERENCE, narrow.policyRead)).value.artifactId, 'unavailable');
  } finally { await full.close(); await narrow.close(); }
});

test('offline sensitivity is one dated successor changing only the two learning keys; the earlier version stays readable', async () => {
  const input = JSON.parse(await readFile(new URL('../../docs/gcsp/models/fucq115-sensitivity-60x4.json', import.meta.url), 'utf8'));
  assert.deepEqual(input.changes.map((row) => row.key), ['learning.cohortSize', 'learning.cycles']); assert.equal(input.status, 'assumed');
  const run = await adoptChoiceTrainingPolicy({ sensitivity: input });
  try {
    const [, choice, sensitivity] = run.adoptions; const asOf = run.policyRead.asOf;
    assert.equal(run.policyRead.policyVersion, sensitivity.policyVersion); assert.match(sensitivity.policyVersion, /\+sensitivity$/);
    assert.ok(Date.parse(sensitivity.effectiveFrom) > Date.parse(choice.effectiveFrom));
    const after = good(await run.policyService.getPolicySnapshot(run.policyRead));
    const before = good(await run.policyService.getPolicySnapshot({ runId: run.policyRead.runId, asOf: choice.effectiveFrom, policyVersion: choice.policyVersion }));
    const changed = new Set(input.changes.map((row) => row.key));
    const rest = (rows) => rows.filter((row) => !changed.has(row.key)).map(withoutPin);
    assert.deepEqual(rest(after.assumptions), rest(before.assumptions));
    for (const table of Object.keys(before).filter((key) => Array.isArray(before[key]) && key !== 'assumptions'))
      assert.deepEqual(after[table].map(withoutPin), before[table].map(withoutPin), table);
    const value = async (key, read) => good(await run.policyService.getAssumption(key, read)).value;
    assert.deepEqual([await value('learning.cohortSize', run.policyRead), await value('learning.cycles', run.policyRead)], [60, 4]);
    const row = good(await run.policyService.getAssumption('learning.cycles', run.policyRead));
    assert.equal(row.effectiveFrom, sensitivity.effectiveFrom); assert.equal(row.basis, input.basis);
    const earlier = { runId: run.policyRead.runId, asOf, policyVersion: choice.policyVersion };
    assert.deepEqual([await value('learning.cohortSize', earlier), await value('learning.cycles', earlier)], [12, 3]);
    const dated = { runId: run.policyRead.runId, asOf: choice.effectiveFrom };
    assert.deepEqual([await value('learning.cohortSize', dated), await value('learning.cycles', dated)], [12, 3]);
    assert.equal(await value('greg.demand.smallCountThreshold', run.policyRead), 5);
    assert.equal((await value(REFERENCE, run.policyRead)).artifactId, 'unavailable');
  } finally { await run.close(); }
});
