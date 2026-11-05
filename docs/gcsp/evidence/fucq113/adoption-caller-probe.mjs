import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = process.env.FUCQ113_ADOPTION_SOURCE;
assert.ok(root, 'Supply the supervisor-owned exact-source composition.');
const moduleAt = (path) => import(pathToFileURL(resolve(root, path)).href);
const { createGcspRuntime } = await moduleAt('server/gcsp/runtime.js');
const { getReviewedDefinitionSet } = await moduleAt('server/gcsp/policy/reviewed-definitions.js');
const { loadLearningPolicy, createLearningDataset, validateLearningDataset, LearningInputError } =
  await moduleAt('server/gcsp/predict/records/index.js');
const id = 'fucq113-learning-v1';
const digest = 'a49f54884322f5993faf510aa8f5cea6e4a9c02e9fae2d2ddfefd350a69d7782';
const fileDigest = 'c083ed58abcde595ac0cbf077b319b9102795506efb736c980d5f0cdba840143';
const now = '2026-11-05T09:00:00.000Z';
const good = (out) => { assert.equal(out?.status, 'ok'); return out.value; };
const withoutPin = ({ policyVersion, effectiveFrom, ...row }) => row;
async function setup(t) {
  const runtime = good(await createGcspRuntime({ mode: 'memory', environmentId: 'learning-adoption-caller',
    policyAsOf: now, commandId: 'learning-bootstrap', sessionNow: () => now }));
  t.after(() => runtime.close());
  const presenter = good(await runtime.identity.createPresenterSession('learning-presenter'));
  const acting = good(await runtime.identity.switchPrincipal(presenter.context, 'demo-greg', 'learning-greg'));
  const clock = good(await runtime.clock.now(acting.context));
  const read = { runId: acting.context.runId, asOf: clock.now, policyVersion: acting.context.policyVersion };
  const original = good(await runtime.policy.getPolicySnapshot(read));
  const cookie = [acting.setCookie].flat().map((value) => value.split(';')[0]).join('; ');
  const input = { commandId: 'adopt-learning-caller', expectedActiveVersion: read.policyVersion,
    policyVersion: 'fucq113-learning-caller-v2', effectiveFrom: clock.now, definitionSetId: id };
  return { ...runtime, context: acting.context, read, original, cookie, input };
}

// These are caller integration checks over a real writable memory runtime, not live DB/corpus proof.
test('registered adoption supplies exact learning keys to the pinned deterministic caller', async (t) => {
  const f = await setup(t);
  const bytes = await readFile(resolve(root, 'server/gcsp/predict/records/policy-definitions.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fileDigest);
  const bundle = getReviewedDefinitionSet(id);
  assert.equal(bundle.digest, digest); assert.equal(bundle.revision, 'learning-definitions.v1');
  assert.deepEqual(bundle, JSON.parse(bytes));
  await assert.rejects(loadLearningPolicy({ policyService: f.policy, policyRead: f.read }),
    (error) => error instanceof LearningInputError && error.field === 'learning.cohortSize');
  const adopted = good(await f.policy.adoptReviewedAssumptions(f.context, f.input));
  assert.equal(adopted.accepted, true); assert.equal(adopted.activationRequired, false);
  assert.equal(adopted.adoption.digest, digest);
  const ordinary = good(await f.identity.resolveSession({ authorized: true, cookie: f.cookie }));
  assert.equal(ordinary.policyVersion, f.input.policyVersion);
  const clock = good(await f.clock.now(ordinary));
  const read = { runId: ordinary.runId, asOf: clock.now, policyVersion: ordinary.policyVersion };
  const snapshot = await loadLearningPolicy({ policyService: f.policy, policyRead: read });
  assert.equal(snapshot.policyVersion, f.input.policyVersion);
  for (const row of bundle.definitions)
    assert.deepEqual(snapshot.assumptions[row.key], { ...row, policyVersion: f.input.policyVersion, effectiveFrom: f.input.effectiveFrom });
  const first = createLearningDataset('registered-learning-caller', snapshot);
  assert.deepEqual(first, createLearningDataset('registered-learning-caller', snapshot));
  assert.equal(validateLearningDataset(first).status, 'ok');
  assert.equal(first.manifest.counts.records, snapshot.assumptions['learning.cohortSize'].value * snapshot.assumptions['learning.cycles'].value);
  assert.equal(first.manifest.policyVersion, f.input.policyVersion);
  assert.equal(first.manifest.snapshot.comparison.configurationSource.kind, 'reviewed-fixtures');
  assert.deepEqual(first.manifest.counts.provenance, { observed: 0, synthetic: first.records.length });
  assert.ok(first.records.every((row) => row.outcomes.satisfaction.state === 'unknown'));
});

test('retained original pin stays immutable and cannot borrow adopted learning values', async (t) => {
  const f = await setup(t); good(await f.policy.adoptReviewedAssumptions(f.context, f.input));
  const retained = good(await f.policy.getPolicySnapshot(f.read));
  assert.deepEqual(retained, f.original);
  await assert.rejects(loadLearningPolicy({ policyService: f.policy, policyRead: f.read }),
    (error) => error instanceof LearningInputError && error.field === 'learning.cohortSize');
  const adopted = good(await f.policy.getPolicySnapshot({ ...f.read, policyVersion: f.input.policyVersion }));
  const keys = new Set(getReviewedDefinitionSet(id).definitions.map((row) => row.key));
  assert.deepEqual(adopted.assumptions.filter((row) => !keys.has(row.key)).map(withoutPin),
    retained.assumptions.map(withoutPin));
  assert.equal(retained.assumptions.some((row) => keys.has(row.key)), false);
});
