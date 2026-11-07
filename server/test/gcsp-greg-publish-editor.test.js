import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getReviewedDefinitionSet, validateReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
import { createGregPublishService } from '../gcsp/greg/publish/index.js';
import { publishFixture, good, now, allRows } from './helpers/greg-publish-run.js';
import { confirm, offer } from './helpers/greg-demand-run.js';
const key = 'greg.publish.editor.v1';
const bundle = getReviewedDefinitionSet('greg-publish-editor-v1');
const adoption = (version = 'editor-policy-v2') => ({ commandId: 'editor-adoption', expectedActiveVersion: 'gcsp-policy-v1',
  policyVersion: version, effectiveFrom: now, definitionSetId: bundle.definitionSetId });
async function fixture(t) {
  const f = await publishFixture(t);
  f.policy = f.policy.withPublicationPorts({ identity: f.identity, clock: f.clock, repository: f.repository });
  f.publish = createGregPublishService(f); return f;
}

test('reviewed editor bundle is immutable, digest checked, explicitly assumed and absent from unchanged seed', async () => {
  assert.equal(validateReviewedDefinitionSet(bundle), true); assert.equal(bundle.definitions[0].key, key);
  assert.equal(bundle.definitions[0].status, 'assumed'); assert.match(bundle.definitions[0].basis, /Presentation only, not policy bounds/);
  assert.throws(() => { bundle.definitions[0].value.weight.maximum = 99; }, TypeError);
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  assert.equal(seed.assumptions.some((row) => row.key === key), false);
  const invalid = structuredClone(bundle); invalid.definitions[0].value.price.maximum = 1;
  assert.equal(validateReviewedDefinitionSet(invalid), false);
});

test('missing key keeps exact editing; intentional reviewed adoption projects ranges and preserves pinned rows and old snapshots', async (t) => {
  const f = await fixture(t); await confirm(f); await offer(f, 1, 'active');
  assert.ok(good(await f.publish.readPolicy(f.context)).fields.every((row) => !row.presentationRange));
  const before = await allRows(f); const retained = structuredClone(f.policyStore.runs.get(f.context.runId)[0]);
  const accepted = good(await f.policy.adoptReviewedAssumptions(f.context, adoption()));
  assert.equal(accepted.activationRequired, false); assert.deepEqual(accepted.adoption.addedKeys, [key]);
  const view = good(await f.publish.readPolicy(f.context));
  for (const row of view.fields) {
    const expected = bundle.definitions[0].value[row.kind];
    assert.equal(row.presentationRange.maximum, expected.maximum); assert.equal(row.presentationRange.assumptionKey, key);
    assert.equal(row.presentationRange.source, bundle.definitions[0].source); assert.equal(row.presentationRange.status, 'assumed');
  }
  assert.deepEqual(f.policyStore.runs.get(f.context.runId)[0], retained);
  const { runs: oldRun, ...oldRows } = before; const { runs: newRun, ...newRows } = await allRows(f);
  assert.deepEqual(newRows, oldRows); assert.notDeepEqual(newRun, oldRun);
});

test('one canonical range change updates every projected control while legal exact values remain unbounded by presentation', async (t) => {
  const f = await fixture(t); good(await f.policy.adoptReviewedAssumptions(f.context, adoption()));
  good(await f.clock.advance(f.presenter.value.context, { commandId: 'editor-tick', expectedClockVersion: '1', bySeconds: 1 }));
  const seed = good(await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: '2026-11-05T09:00:01.000Z' }));
  const row = seed.assumptions.find((entry) => entry.key === key);
  good(await f.policy.publishPolicyVersion(f.context, { commandId: 'editor-tuning', expectedActiveVersion: 'editor-policy-v2',
    policyVersion: 'editor-policy-v3', effectiveFrom: '2026-11-05T09:00:01.000Z', changes: [{ table: 'assumptions', key,
      patch: { value: { ...row.value, price: { ...row.value.price, maximum: 4500 }, weight: { ...row.value.weight, maximum: 12 } },
        source: 'synthetic:editor-test', sourceDate: '2026-11-05', basis: 'Explicit canonical presentation-range variation.', status: 'assumed' } }] }));
  const view = good(await f.publish.readPolicy(f.context));
  assert.ok(view.fields.every((field) => field.presentationRange.maximum === (field.kind === 'price' ? 4500 : 12)));
  good(await f.clock.advance(f.presenter.value.context, { commandId: 'editor-tick-again', expectedClockVersion: '2', bySeconds: 1 }));
  const input = { expectedActiveVersion: view.activeVersion, changes: [{ id: 'weight:body', value: Number.MAX_SAFE_INTEGER }] };
  const preview = good(await f.publish.preview(f.context, input)); assert.equal(preview.differences[0].after, Number.MAX_SAFE_INTEGER);
  const published = good(await f.publish.publish(f.context, { ...input, commandId: 'outside-presentation', policyVersion: 'editor-policy-v4', effectiveFrom: preview.asOf }));
  assert.equal(published.accepted, true);
  assert.equal(good(await f.publish.readPolicy(f.context)).fields.find((field) => field.id === 'weight:body').value, Number.MAX_SAFE_INTEGER);
  assert.equal((await f.publish.preview(f.context, { expectedActiveVersion: 'editor-policy-v4', changes: [{ id: 'weight:body', value: 1.5 }] })).status, 'invalid');
});
