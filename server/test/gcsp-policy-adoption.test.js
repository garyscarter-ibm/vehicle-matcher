import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PolicyService } from '../gcsp/policy/index.js';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { getReviewedDefinitionSet, validateReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
import { result } from '../gcsp/repository/index.js';
import { reviewedRuntime, now, good, response, adoptionCommand } from './helpers/gcsp-reviewed-runtime.js';

const bundle = getReviewedDefinitionSet('presenter-controls-v1');
const withoutPin = ({ policyVersion, ...row }) => row;
const acceptedMetadata = ({ activationRequired, activation, ...value }) => value;

test('reviewed registry is immutable, digest checked and matches the exact canonical presenter definition', async () => {
  assert.equal(validateReviewedDefinitionSet(bundle), true); assert.equal(getReviewedDefinitionSet('unknown'), null);
  assert.throws(() => { bundle.definitions[0].value = 1; }, TypeError);
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const { policyVersion, effectiveFrom, ...definition } = seed.assumptions.find((row) => row.key === 'clock.presenter.stepSeconds');
  assert.deepEqual(bundle.definitions, [definition]);
  for (const change of [
    (value) => { value.definitions[0].value = Infinity; }, (value) => { value.definitions[0].unit = ''; },
    (value) => { value.definitions[0].sourceDate = '2026-02-30'; }, (value) => { value.definitions.push(value.definitions[0]); },
    (value) => { value.definitions[0].unexpected = true; }, (value) => { value.definitions[0].value = 3; },
  ]) { const bad = structuredClone(bundle); change(bad); assert.equal(validateReviewedDefinitionSet(bad), false); }
});

test('stored policy without step can reopen core clock; intentional adoption enables same-cookie presenter HTTP controls', async (t) => {
  const f = await reviewedRuntime(t);
  const context = f.session.value.context; const runId = context.runId;
  const retained = structuredClone(f.store.runs.get(runId)[0]);
  assert.equal(retained.seed.assumptions.some((row) => row.key === 'clock.presenter.stepSeconds'), false);
  good(await f.clock.now(context));
  const reopened = good(await createGcspRuntime({ ...f.options, repository: f.repository, commandId: 'reopen' }));
  good(await reopened.clock.now(context));
  t.after(() => reopened.close());
  const before = await f.http.request('/api/gcsp/presenter/controls', { session: f.session });
  assert.equal(before.status, 503); assert.equal(before.json.code, 'presenter-step-unavailable');
  const input = adoptionCommand();
  const [first, duplicate] = await Promise.all([f.policy.adoptReviewedAssumptions(f.greg.context, input),
    f.policy.adoptReviewedAssumptions(f.greg.context, input)]);
  assert.deepEqual(duplicate, first);
  const adopted = good(first);
  assert.equal(adopted.accepted, true); assert.equal(adopted.activationRequired, false);
  assert.deepEqual(adopted.adoption, { definitionSetId: bundle.definitionSetId, revision: bundle.revision,
    digest: bundle.digest, addedKeys: ['clock.presenter.stepSeconds'] });
  assert.deepEqual(f.store.runs.get(runId)[0], retained);
  const successor = good(await f.policy.getPolicySnapshot({ runId, asOf: now }));
  assert.deepEqual(successor.assumptions.filter((row) => row.key !== 'clock.presenter.stepSeconds').map(withoutPin), retained.seed.assumptions.map(withoutPin));
  const added = successor.assumptions.find((row) => row.key === 'clock.presenter.stepSeconds');
  assert.deepEqual(added, { ...bundle.definitions[0], policyVersion: input.policyVersion, effectiveFrom: input.effectiveFrom });
  assert.equal((await f.run()).policyVersion, input.policyVersion); assert.equal((await f.run()).versions.policy, input.policyVersion);
  const next = response(await f.http.request('/api/gcsp/context', { session: f.session }));
  assert.equal(next.policyVersion, input.policyVersion);
  const controls = response(await f.http.request('/api/gcsp/presenter/controls', { session: f.session }));
  assert.deepEqual(controls.controls.step, added);
  const tick = response(await f.http.request('/api/gcsp/presenter/controls/tick', { session: f.session,
    body: { commandId: 'adopted-step', expectedClockVersion: '1', mode: 'step' } }));
  assert.equal(tick.advance.now, '2026-11-05T09:01:00.000Z');
  const replay = good(await f.policy.adoptReviewedAssumptions(f.greg.context, input));
  assert.deepEqual(acceptedMetadata(replay), acceptedMetadata(adopted)); assert.equal(f.store.runs.get(runId).length, 2);
  assert.equal((await f.policy.adoptReviewedAssumptions(f.greg.context, { ...input, policyVersion: 'changed' })).status, 'conflict');
});

test('adoption rejects arbitrary input, stale versions, no-op and untrusted roles without changing policy', async (t) => {
  const f = await reviewedRuntime(t); const input = adoptionCommand();
  const retained = structuredClone([...f.store.runs]);
  for (const patch of [{ definitionSetId: 'unknown' }, { addedKeys: ['anything'] }, { definitions: bundle.definitions },
    { effectiveFrom: 'bad' }, { expectedActiveVersion: null }, { value: Infinity }]) {
    assert.equal((await f.policy.adoptReviewedAssumptions(f.greg.context, { ...input, ...patch })).status, 'invalid');
  }
  assert.equal((await f.policy.adoptReviewedAssumptions(f.greg.context, { ...input, expectedActiveVersion: 'other' })).status, 'stale-version');
  assert.equal((await f.policy.adoptReviewedAssumptions(f.session.value.context, input)).status, 'forbidden');
  assert.equal((await f.policy.adoptReviewedAssumptions({ ...f.greg.context }, input)).status, 'forbidden');
  assert.deepEqual([...f.store.runs], retained);
  good(await f.policy.adoptReviewedAssumptions(f.greg.context, input));
  good(await f.clock.advance(f.presenter, { commandId: 'next', expectedClockVersion: '1', bySeconds: 1 }));
  const before = structuredClone([...f.store.runs]);
  const noOp = await f.policy.adoptReviewedAssumptions(f.greg.context, adoptionCommand({ commandId: 'no-op',
    expectedActiveVersion: input.policyVersion, policyVersion: 'no-op-v3', effectiveFrom: '2026-11-05T09:00:01.000Z' }));
  assert.equal(noOp.status, 'invalid'); assert.deepEqual([...f.store.runs], before);
  const arbitrary = await f.policy.publishPolicyVersion(f.greg.context, { commandId: 'arbitrary', expectedActiveVersion: input.policyVersion,
    policyVersion: 'arbitrary-v3', effectiveFrom: '2026-11-05T09:00:01.000Z',
    changes: [{ table: 'assumptions', key: 'not-reviewed', patch: { value: 1, unit: 'count', basis: 'Explicit unsupported new key.', source: 'synthetic:test', sourceDate: '2026-11-05', status: 'assumed' } }] });
  assert.equal(arbitrary.status, 'invalid'); assert.deepEqual([...f.store.runs], before);
});

test('existing key values and provenance are preserved; shared-source publication binding leaves read view unauthorized', async (t) => {
  const f = await reviewedRuntime(t, { missingStep: false, transform(seed) {
    const row = seed.assumptions.find((entry) => entry.key === 'clock.presenter.stepSeconds');
    row.value = 43; row.basis = 'Explicit prior tuning to preserve.'; row.source = 'synthetic:prior-tuning';
  } });
  const before = structuredClone([...f.store.runs]);
  assert.equal((await f.policy.adoptReviewedAssumptions(f.greg.context, adoptionCommand())).status, 'invalid');
  assert.deepEqual([...f.store.runs], before);
  const read = { runId: f.greg.context.runId, asOf: now };
  assert.equal(good(await f.readPolicy.getAssumption('clock.presenter.stepSeconds', read)).value, 43);
  assert.equal((await f.readPolicy.adoptReviewedAssumptions(f.greg.context, adoptionCommand())).status, 'unavailable');
  assert.equal((await f.readPolicy.publishPolicyVersion(f.greg.context, {})).status, 'unavailable');
});

test('schema failure is atomic and accepted publication survives activation failure for original-command retry', async (t) => {
  const f = await reviewedRuntime(t); const before = structuredClone([...f.store.runs]);
  const failing = new PolicyService({ provider: { loadVersions: (...args) => f.policyProvider.loadVersions(...args),
    publish: (read, build) => f.policyProvider.publish(read, (records) => {
      records[0].seed.pricePlans[0].monthlyPoints = -1;
      return build(records);
    }) } }).withPublicationPorts({ identity: f.identity, clock: f.clock, repository: f.repository });
  assert.equal((await failing.adoptReviewedAssumptions(f.greg.context, adoptionCommand())).status, 'invalid');
  assert.deepEqual([...f.store.runs], before);
  const unavailableRepository = { read: (...args) => f.repository.read(...args), transaction: async () => result('unavailable', {}) };
  const pending = f.readPolicy.withPublicationPorts({ identity: f.identity, clock: f.clock, repository: unavailableRepository });
  const accepted = good(await pending.adoptReviewedAssumptions(f.greg.context, adoptionCommand()));
  assert.equal(accepted.accepted, true); assert.equal(accepted.activationRequired, true); assert.equal(accepted.activation.status, 'pending');
  assert.equal((await f.run()).policyVersion, 'gcsp-policy-v1');
  const reconciled = good(await f.policy.adoptReviewedAssumptions(f.greg.context, adoptionCommand()));
  assert.deepEqual(acceptedMetadata(reconciled), acceptedMetadata(accepted)); assert.equal(reconciled.activationRequired, false);
  assert.equal(f.store.runs.get(f.greg.context.runId).length, 2);
});
