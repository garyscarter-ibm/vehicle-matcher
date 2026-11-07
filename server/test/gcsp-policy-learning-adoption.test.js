import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getReviewedDefinitionSet, validateReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
import { reviewedRuntime, now, good, response, adoptionCommand } from './helpers/gcsp-reviewed-runtime.js';

const id = 'fucq113-learning-v1';
const digest = 'a49f54884322f5993faf510aa8f5cea6e4a9c02e9fae2d2ddfefd350a69d7782';
const bundle = getReviewedDefinitionSet(id);
const keys = ['learning.cohortSize', 'learning.cycles', 'learning.cycleSpacingDays', 'learning.maximumGeneratedRecords',
  'learning.maximumChoiceEntries', 'learning.noChoiceRate', 'learning.response.v1'];
const withoutPin = ({ policyVersion, effectiveFrom, ...row }) => row;
const command = () => adoptionCommand({ commandId: 'adopt-learning', policyVersion: 'learning-policy-v2', definitionSetId: id });

test('registry retains all reviewed bundles and the exact immutable approved learning artifact', async () => {
  const bytes = await readFile(new URL('../gcsp/predict/records/policy-definitions.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'c083ed58abcde595ac0cbf077b319b9102795506efb736c980d5f0cdba840143');
  assert.deepEqual(bundle, JSON.parse(bytes)); assert.equal(bundle.revision, 'learning-definitions.v1');
  assert.equal(bundle.digest, digest); assert.equal(validateReviewedDefinitionSet(bundle), true);
  assert.deepEqual(bundle.definitions.map((row) => row.key), keys);
  for (const other of ['presenter-controls-v1', 'greg-publish-editor-v1']) assert.equal(validateReviewedDefinitionSet(getReviewedDefinitionSet(other)), true);
  assert.throws(() => { bundle.definitions[6].value.declineRate = 1; }, TypeError);
  assert.throws(() => { bundle.definitions.push({}); }, TypeError);
  const invalid = structuredClone(bundle); invalid.definitions[0].value += 1;
  assert.equal(validateReviewedDefinitionSet(invalid), false);
});

test('intentional learning adoption adds canonical missing keys through the same provider and ordinary context', async (t) => {
  const f = await reviewedRuntime(t, { missingStep: false });
  const runId = f.greg.context.runId; const retained = structuredClone(f.store.runs.get(runId)[0]);
  assert.ok(retained.seed.assumptions.every((row) => !keys.includes(row.key)));
  const input = command(); const accepted = good(await f.policy.adoptReviewedAssumptions(f.greg.context, input));
  assert.equal(accepted.accepted, true); assert.equal(accepted.activationRequired, false);
  assert.deepEqual(accepted.adoption, { definitionSetId: id, revision: bundle.revision, digest, addedKeys: keys });
  assert.deepEqual(f.store.runs.get(runId)[0], retained);
  const ordinary = response(await f.http.request('/api/gcsp/context', { session: f.session }));
  assert.equal(ordinary.policyVersion, input.policyVersion);
  const run = await f.run(); assert.equal(run.policyVersion, input.policyVersion); assert.equal(run.versions.policy, input.policyVersion);
  const read = { runId, asOf: now }; const snapshot = good(await f.readPolicy.getPolicySnapshot(read));
  assert.deepEqual(snapshot.assumptions.filter((row) => !keys.includes(row.key)).map(withoutPin), retained.seed.assumptions.map(withoutPin));
  for (const definition of bundle.definitions) {
    assert.deepEqual(good(await f.readPolicy.getAssumption(definition.key, read)), {
      ...definition, policyVersion: input.policyVersion, effectiveFrom: input.effectiveFrom });
  }
  for (const [table, rows] of Object.entries(retained.seed).filter(([, value]) => Array.isArray(value))) {
    if (table !== 'assumptions') assert.deepEqual(snapshot[table].map(withoutPin), rows.map(withoutPin));
  }
  good(await f.policy.adoptReviewedAssumptions(f.greg.context, input));
  assert.equal(f.store.runs.get(runId).length, 2);
});

test('learning adoption preserves an existing tuned key and provenance while adding only missing definitions', async (t) => {
  const existing = { ...structuredClone(bundle.definitions[0]), value: 7, source: 'synthetic:prior-learning-tuning',
    basis: 'Explicit existing cohort tuning to retain.' };
  const f = await reviewedRuntime(t, { missingStep: false, transform(seed) {
    seed.assumptions.push({ ...existing, policyVersion: seed.policyVersion, effectiveFrom: seed.effectiveFrom });
  } });
  const retained = structuredClone(f.store.runs.get(f.greg.context.runId)[0]);
  const accepted = good(await f.policy.adoptReviewedAssumptions(f.greg.context, command()));
  assert.deepEqual(accepted.adoption.addedKeys, keys.slice(1));
  const read = { runId: f.greg.context.runId, asOf: now };
  assert.deepEqual(withoutPin(good(await f.readPolicy.getAssumption(existing.key, read))), existing);
  assert.deepEqual(f.store.runs.get(f.greg.context.runId)[0], retained);
  assert.equal(response(await f.http.request('/api/gcsp/context', { session: f.session })).policyVersion, command().policyVersion);
});
