import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, confirm, saved, release, offer, fact } from './helpers/greg-demand-run.js';
import { preference, stock, providerValue, provider, time, context as recommendationContext } from './helpers/employee-recommendation.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../gcsp/policy/index.js';
import { createGregPublishService, versionLabel } from '../gcsp/greg/publish/index.js';
import { createGregPublishRoutes } from '../gcsp/greg/publish/http.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { scorePreferences } from '../scenarios/employee/index.js';

const initial = 'gcsp-policy-v1';
const now = '2026-11-05T09:00:00.000Z';
const edit = (id, value) => ({ expectedActiveVersion: initial, changes: [{ id, value }] });
const command = (id, value, overrides = {}) => ({ ...edit(id, value), commandId: 'publish-1', policyVersion: 'greg-policy-v2', effectiveFrom: now, ...overrides });
async function fixture(t, options) {
  const store = createMemoryPolicyStore();
  let policyProvider;
  const f = await setup({ ...options, policyProvider(source) {
    const calibration = source.assumptions.find((row) => row.key === 'employee.recommendation.v1').value;
    options?.seed?.(source);
    if (!options?.legacy) calibration.preferenceWeights = Object.fromEntries(Object.keys(calibration.preferences).map((key) => [key, 1]));
    policyProvider = new MemoryPolicyProvider({ store, seedProvider: { async loadVersions() { return [source]; } } });
    return policyProvider;
  } });
  t.after(() => f.repository.close());
  f.policy = new PolicyService({ provider: policyProvider, identity: f.identity, clock: f.clock });
  f.source = good(await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: now }));
  f.publish = createGregPublishService(f);
  f.policyStore = store;
  f.price = f.source.pricePlans.find((row) => row.schemeId === f.employee.schemeId && row.matchValue === 'G21 Touring|320i');
  return f;
}

const queryAll = async (f) => Object.fromEntries(await Promise.all(['briefs', 'employees', 'stock', 'holds', 'offers', 'quotes', 'decisions', 'runs']
  .map(async (table) => [table, (await f.repository.query(f.context, table)).value])));
const good = (out) => { assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value; };

test('trusted policy snapshot is a cloned immutable validated snapshot; projection exposes only editable rows', async (t) => {
  const f = await fixture(t);
  const snapshot = good(await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: now }));
  assert.ok(Object.isFrozen(snapshot.assumptions[0]));
  assert.throws(() => { snapshot.policyVersion = 'tampered'; }, TypeError);
  const view = good(await f.publish.readPolicy(f.context));
  assert.equal(view.activeVersion, initial);
  assert.equal(view.fields.length, f.source.pricePlans.length + 6);
  assert.deepEqual(view.fields.filter((row) => row.kind === 'weight').map((row) => row.id), ['weight:body', 'weight:fuel', 'weight:sportiness', 'weight:comfort', 'weight:economy', 'weight:size']);
  assert.ok(view.fields.every((row) => row.source && row.basis && row.status && row.unit));
  assert.equal(Object.hasOwn(view, 'assumptions'), false);
});

test('projection labels every seed row from the policy source, with no raw keys or fallbacks', async (t) => {
  const f = await fixture(t); const view = good(await f.publish.readPolicy(f.context));
  const labels = f.source.assumptions.find((row) => row.key === 'policy.displayLabels.v1').value;
  const prices = view.fields.filter((row) => row.kind === 'price');
  for (const row of f.source.pricePlans) {
    const model = row.matchValue.split('|')[0]; assert.ok(labels.models[model], `template for ${model}`);
    assert.equal(prices.find((p) => p.key === row.key).label, labels.models[model].replace('{engine}', row.matchValue.split('|').slice(1).join('|')).trim());
  }
  assert.equal(prices.find((p) => p.key === f.price.key).label, '3 Series Touring 320i');
  assert.equal(prices.find((p) => p.matchValue === 'F70 Sports Hatch|120').label, '1 Series Sports Hatch 120');
  for (const scheme of new Set(prices.map((p) => p.schemeId))) {
    const set = prices.filter((p) => p.schemeId === scheme).map((p) => p.label); assert.equal(new Set(set).size, set.length, scheme);
  }
  assert.ok(prices.every((p) => !p.label.includes('|') && !p.label.includes('eligibilityModelKey') && p.unitLabel === 'points a month' && p.schemeLabel !== p.schemeId));
  assert.equal(view.fields.find((p) => p.id === 'weight:body').label, 'Body style weight');
  assert.equal(view.fields.find((p) => p.id === 'weight:economy').label, 'Running costs weight');
  assert.equal(view.fields.find((p) => p.id === 'weight:size').unitLabel, 'weight');
  assert.equal(view.activeVersionLabel, 'Demo policy 1');
  assert.equal(versionLabel('gcsp-policy-v1+offer-journey-v1', view.versionNames), 'Demo policy 1 with offer journey');
  assert.equal(versionLabel('greg-abc', view.versionNames), "Greg's change"); assert.equal(versionLabel('preview-abc', view.versionNames), 'Unnamed update');
});

test('a changed label entry in an alternative seed changes the projected label, and missing labels fall back plainly', async (t) => {
  const f = await fixture(t, { seed(source) {
    const entry = source.assumptions.find((row) => row.key === 'policy.displayLabels.v1');
    entry.value.models['G21 Touring'] = 'Touring estate {engine}'; entry.value.weights.body = 'Shape'; delete entry.value.models['G05 X5'];
  } });
  const view = good(await f.publish.readPolicy(f.context));
  assert.equal(view.fields.find((p) => p.key === f.price.key).label, 'Touring estate 320i');
  assert.equal(view.fields.find((p) => p.id === 'weight:body').label, 'Shape weight');
  assert.equal(view.fields.find((p) => p.matchValue?.startsWith('G05 X5|')).label.includes('|'), false);
});

test('held-offer summary has singular, plural and zero wording', async (t) => {
  const f = await fixture(t);
  assert.equal(good(await f.publish.readPolicy(f.context)).heldOffers.message, 'No held offers are affected.');
  await confirm(f); await offer(f, 1, 'active');
  assert.equal(good(await f.publish.readPolicy(f.context)).heldOffers.message, '1 held offer keeps its earlier terms.');
});

test('preview uses real demand/points evaluation and writes no repository or policy records', async (t) => {
  const f = await fixture(t); await confirm(f); await release(f);
  const before = await queryAll(f); const policies = structuredClone([...f.policyStore.runs]);
  const view = good(await f.publish.preview(f.context, edit(`price:${f.price.key}`, 2000)));
  assert.equal(view.preview, true); assert.equal(view.state, 'preview-ready');
  assert.notEqual(view.activeVersion, view.draftVersion);
  assert.notEqual(view.active.demand.projectionVersion, view.draft.demand.projectionVersion);
  assert.equal(view.active.demand.demand.unmet.total.count.label, 'fewer than 1');
  assert.equal(view.draft.demand.demand.unmet.total.count.value, 1);
  assert.equal(view.active.fit.employeesWithEligibleStock.value, 1);
  assert.equal(view.draft.fit.employeesWithEligibleStock.label, 'fewer than 1');
  assert.deepEqual(await queryAll(f), before);
  assert.deepEqual([...f.policyStore.runs], policies);
});

test('weight preview changes real aggregate fit without relaxing essentials', async (t) => {
  const f = await fixture(t);
  const brief = saved(); brief.preferences = { body: preference('estate'), fuel: preference('diesel') };
  await confirm(f, brief); await release(f);
  const view = good(await f.publish.preview(f.context, edit('weight:body', 0)));
  assert.ok(view.active.fit.meanBestScore.value > view.draft.fit.meanBestScore.value);
  assert.deepEqual(view.active.demand.demand.unmet.total.count, view.draft.demand.demand.unmet.total.count);
  assert.deepEqual(view.active.demand.demand.unmet.byGate, view.draft.demand.demand.unmet.byGate);
});

test('publish appends an immutable version and keeps pinned offers, holds and quotes unchanged', async (t) => {
  const f = await fixture(t); await confirm(f); await offer(f, 1, 'active');
  const before = await queryAll(f);
  const input = command(`price:${f.price.key}`, 1200);
  const out = good(await f.publish.publish(f.context, input));
  assert.equal(out.policyVersion, 'greg-policy-v2'); assert.equal(out.publisher, f.context.principalId);
  assert.equal(out.effectiveFrom, now); assert.equal(out.activationRequired, false);
  assert.equal(out.activation.status, 'active');
  assert.equal(out.heldOffers.count, 1); assert.equal(out.heldOffers.message, '1 held offer keeps its earlier terms.');
  const after = await queryAll(f);
  const { runs: beforeRuns, ...beforeRows } = before; const { runs: afterRuns, ...afterRows } = after;
  assert.deepEqual(afterRows, beforeRows);
  assert.equal(afterRuns[0].policyVersion, out.policyVersion);
  assert.equal(afterRuns[0].versions.policy, out.policyVersion);
  const next = good(await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: now }));
  const changed = next.pricePlans.find((row) => row.key === f.price.key);
  assert.equal(changed.monthlyPoints, 1200); assert.equal(changed.value, 1200); assert.equal(changed.status, 'assumed');
  const old = good(await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: now, policyVersion: initial }));
  assert.equal(old.pricePlans.find((row) => row.key === f.price.key).monthlyPoints, f.price.monthlyPoints);
  assert.deepEqual(good(await f.publish.publish(f.context, input)), out);
  assert.equal((await f.publish.publish(f.context, { ...input, changes: [{ id: `price:${f.price.key}`, value: 1250 }] })).status, 'conflict');
  const stale = await f.publish.publish(f.context, command('weight:body', 2, { commandId: 'second', policyVersion: 'v3' }));
  assert.equal(stale.status, 'stale-version', JSON.stringify(stale));
});

test('bounded edits reject gates, unknown shape, duplicates, invalid integers, no-op and stale preview', async (t) => {
  const f = await fixture(t);
  const cases = [edit('eligibility:any', 0), edit('weight:unknown', 1), edit('weight:body', -1), edit('weight:body', 0.5),
    edit('weight:body', Number.MAX_SAFE_INTEGER + 1), edit('weight:body', NaN), edit('weight:body', 1),
    { ...edit('weight:body', 2), unknown: true }, { expectedActiveVersion: initial, changes: [] },
    { expectedActiveVersion: initial, changes: [{ id: 'weight:body', value: 2 }, { id: 'weight:body', value: 3 }] },
    { expectedActiveVersion: initial, changes: [{ id: 'weight:body', value: 2, path: 'essentials' }] }];
  for (const input of cases) assert.equal((await f.publish.preview(f.context, input)).status, 'invalid', JSON.stringify(input));
  assert.equal((await f.publish.preview(f.context, { ...edit('weight:body', 2), expectedActiveVersion: 'other' })).status, 'stale-version');
  assert.equal((await f.publish.publish(f.context, command('weight:body', 2, { effectiveFrom: '2026-11-06T00:00:00.000Z' }))).status, 'invalid');
  assert.equal((await f.publish.publish(f.context, command('weight:body', 2, { effectiveFrom: '2026-11-04T23:00:00.000Z' }))).status, 'invalid');
});

test('real identity refuses non-Greg and forged policy pin contexts', async (t) => {
  const f = await fixture(t);
  for (const action of ['readPolicy', 'preview', 'publish']) {
    assert.equal((await f.publish[action](f.employee, command('weight:body', 2))).status, 'forbidden');
    assert.notEqual((await f.publish[action]({ ...f.context, policyVersion: 'forged' }, command('weight:body', 2))).status, 'ok');
  }
});

test('held count excludes elapsed offers/holds and nonoccupying holds', async (t) => {
  const f = await fixture(t); await confirm(f); await offer(f, 1, 'active'); await offer(f, 2, 'expired');
  assert.equal(good(await f.publish.readPolicy(f.context)).heldOffers.count, 1);
  await f.write(async (tx) => {
    const hold = await tx.get({ table: 'holds', key: { runId: f.context.runId, holdId: 'hold-1' } });
    return tx.compareAndSwap({ table: 'holds', key: { runId: f.context.runId, holdId: 'hold-1' } }, hold.value.version, { expiresAt: now });
  });
  assert.equal(good(await f.publish.readPolicy(f.context)).heldOffers.count, 0);
});

test('privacy bands suppress tiny fit cohorts, including zero', async (t) => {
  const f = await fixture(t, { canonical: true }); await confirm(f); await release(f);
  const view = good(await f.publish.preview(f.context, edit('weight:body', 2)));
  assert.deepEqual(view.active.fit.meanBestScore, { status: 'suppressed', fewerThan: 5, unit: 'score/100' });
  assert.equal(Object.hasOwn(view.active.fit.scoredBriefs, 'value'), false);
});

test('route definitions enforce Greg role, strict queries and body delegation without registration', async (t) => {
  const f = await fixture(t); const routes = createGregPublishRoutes(f.publish);
  assert.deepEqual(routes.map((row) => row.role), ['greg', 'greg', 'greg']);
  assert.equal((await routes[0].handle({ context: f.context, searchParams: new URLSearchParams('runId=other') })).status, 'invalid');
  assert.equal((await routes[0].handle({ context: f.context, searchParams: new URLSearchParams(), body: { extra: true } })).status, 'invalid');
  assert.equal((await routes[1].handle({ context: f.context, searchParams: new URLSearchParams(), body: edit('weight:body', 2) })).status, 'ok');
});

test('real employee scorer weights reorder contradictory preferences; neutral legacy and zero weights remain valid', async (t) => {
  const f = await fixture(t);
  const candidateA = stock(1, { body: fact('estate'), fuel: fact('petrol') });
  const candidateB = stock(2, { body: fact('suv'), fuel: fact('diesel') });
  const request = { schemaVersion: 1, briefVersion: 1, essentials: {}, preferences: { body: preference('estate'), fuel: preference('diesel', 50) } };
  const evaluate = (policy) => createEmployeeRecommendationService({ provider: provider(providerValue([candidateA, candidateB])), policy, time }).recommend(recommendationContext, request);
  const active = good(await evaluate(f.policy)); assert.equal(active.recommendations[0].orderUuid, candidateA.orderUuid);
  const draft = structuredClone(f.source); draft.assumptions.find((row) => row.key === 'employee.recommendation.v1').value.preferenceWeights.body = 0;
  const changed = good(await evaluate(new PolicyService({ provider: { async loadVersions() { return [draft]; } } })));
  assert.equal(changed.recommendations[0].orderUuid, candidateB.orderUuid);
  assert.equal(changed.decisions[0].components.find((row) => row.field === 'body').effectiveImportance, 0);
  assert.equal(changed.decisions[0].components.find((row) => row.field === 'fuel').policyWeight, 1);
  const config = draft.assumptions.find((row) => row.key === 'employee.recommendation.v1').value;
  const zero = scorePreferences(candidateA.snapshot, { preferences: { body: preference('estate') } }, providerValue().employeeFacts, config, { minimum: 0, maximum: 100 });
  assert.equal(zero.score, null); assert.equal(zero.components[0].importance, 100);
  const legacy = structuredClone(config); delete legacy.preferenceWeights;
  const original = scorePreferences(candidateA.snapshot, request, providerValue().employeeFacts, legacy, { minimum: 0, maximum: 100 });
  assert.equal(Object.hasOwn(original.components[0], 'policyWeight'), false);
  assert.equal(Object.hasOwn(original.components[0], 'effectiveImportance'), false);
  const malformed = structuredClone(config); delete malformed.preferenceWeights.fuel;
  assert.throws(() => scorePreferences(candidateA.snapshot, request, providerValue().employeeFacts, malformed, { minimum: 0, maximum: 100 }), TypeError);
});

test('legacy policy adopts neutral weights in a new version through real projection, preview and publication', async (t) => {
  const f = await fixture(t, { legacy: true });
  const brief = saved(); brief.preferences = { body: preference('estate'), fuel: preference('diesel') };
  await confirm(f, brief); await release(f);
  const view = good(await f.publish.readPolicy(f.context));
  assert.equal(view.weightsAdoptionRequired, true);
  assert.ok(view.fields.filter((row) => row.kind === 'weight').every((row) => row.value === 1 && row.adoptionRequired));
  const preview = good(await f.publish.preview(f.context, edit('weight:body', 0)));
  assert.ok(preview.active.fit.meanBestScore.value > preview.draft.fit.meanBestScore.value);
  const before = await queryAll(f);
  good(await f.publish.publish(f.context, command('weight:body', 0)));
  const old = good(await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: now, policyVersion: initial }));
  assert.equal(Object.hasOwn(old.assumptions.find((row) => row.key === 'employee.recommendation.v1').value, 'preferenceWeights'), false);
  const current = good(await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: now }));
  const nextCalibration = current.assumptions.find((row) => row.key === 'employee.recommendation.v1').value;
  assert.deepEqual(nextCalibration.preferenceWeights, { body: 0, fuel: 1, sportiness: 1, comfort: 1, economy: 1, size: 1 });
  const { preferenceWeights, ...retained } = nextCalibration;
  assert.deepEqual(retained, old.assumptions.find((row) => row.key === 'employee.recommendation.v1').value);
  const after = await queryAll(f);
  const { runs: beforeRuns, ...beforeRows } = before; const { runs: afterRuns, ...afterRows } = after;
  assert.deepEqual(afterRows, beforeRows);
  assert.equal(afterRuns[0].policyVersion, 'greg-policy-v2');
  assert.equal(afterRuns[0].versions.policy, 'greg-policy-v2');
  assert.equal(good(await f.publish.readPolicy(f.context)).weightsAdoptionRequired, false);
});

test('legacy migration cannot add other fields, alter protected calibration or omit registered weights', async (t) => {
  const f = await fixture(t, { legacy: true });
  const previous = f.source.assumptions.find((row) => row.key === 'employee.recommendation.v1').value;
  const neutral = Object.fromEntries(Object.keys(previous.preferences).map((key) => [key, 1]));
  const values = [
    { ...previous, preferenceWeights: { body: 1 } },
    { ...previous, preferenceWeights: { ...neutral, fuel: 0.5 } },
    { ...previous, preferenceWeights: neutral, extra: true },
    { ...previous, preferenceWeights: neutral, driverEligibilityRequired: !previous.driverEligibilityRequired },
  ];
  for (const value of values) {
    const response = await f.policy.publishPolicyVersion(f.context, { commandId: 'invalid-migration', expectedActiveVersion: initial,
      policyVersion: 'invalid-v2', effectiveFrom: now, changes: [{ table: 'assumptions', key: 'employee.recommendation.v1',
        patch: { value, source: 'test', sourceDate: '2026-11-05', status: 'assumed', basis: 'Explicit invalid migration regression.' } }] });
    assert.equal(response.status, 'invalid', JSON.stringify(response));
  }
  assert.equal(f.policyStore.runs.get(f.context.runId).length, 1);
});

test('protected pending offers retain terms in held-offer count', async (t) => {
  const f = await fixture(t); await confirm(f); await offer(f, 1, 'active');
  for (const state of ['decision-pending', 'selection-pending', 'release-pending']) {
    await f.write(async (tx) => {
      const found = await tx.get({ table: 'offers', key: { runId: f.context.runId, offerId: 'offer-1' } });
      return tx.compareAndSwap({ table: 'offers', key: { runId: f.context.runId, offerId: 'offer-1' } }, found.value.version, { state, expiresAt: now });
    });
    await f.write(async (tx) => {
      const hold = await tx.get({ table: 'holds', key: { runId: f.context.runId, holdId: 'hold-1' } });
      return tx.compareAndSwap({ table: 'holds', key: { runId: f.context.runId, holdId: 'hold-1' } }, hold.value.version,
        { state: state === 'release-pending' ? 'release-pending' : 'selection-pending', expiresAt: now });
    });
    assert.equal(good(await f.publish.readPolicy(f.context)).heldOffers.count, 1, state);
  }
});

test('publication replay preserves original effective instant after demo time advances', async (t) => {
  const f = await fixture(t, { legacy: true });
  const input = command('weight:body', 2);
  const first = good(await f.publish.publish(f.context, input));
  const instant = good(await f.clock.now(f.context));
  good(await f.clock.advance(f.presenter.value.context, { commandId: 'advance-after-publication', expectedClockVersion: instant.clockVersion,
    bySeconds: 86400 }));
  const replay = good(await f.publish.publish(f.context, input));
  assert.equal(replay.effectiveFrom, first.effectiveFrom);
  assert.equal(replay.publishedAt, first.publishedAt);
  assert.equal(f.policyStore.runs.get(f.context.runId).length, 2);
});

test('retained scheduled successor prevents an immediate publish without claiming preview as its baseline', async (t) => {
  const f = await fixture(t);
  good(await f.policy.publishPolicyVersion(f.context, { commandId: 'schedule-existing', expectedActiveVersion: initial,
    policyVersion: 'scheduled-policy', effectiveFrom: '2026-11-05T10:00:00.000Z', changes: [{ table: 'pricePlans', key: f.price.key,
      patch: { value: 1200, monthlyPoints: 1200, basis: 'Explicit scheduled input.', source: 'test', sourceDate: '2026-11-05', status: 'assumed' } }] }));
  assert.equal(good(await f.publish.preview(f.context, edit('weight:body', 2))).activeVersion, initial);
  const out = await f.publish.publish(f.context, command('weight:body', 2));
  assert.equal(out.status, 'invalid'); assert.equal(out.reasons[0].field, 'effectiveFrom');
  assert.equal(f.policyStore.runs.get(f.context.runId).length, 2);
});
