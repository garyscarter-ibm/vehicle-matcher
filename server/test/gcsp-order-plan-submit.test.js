import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import * as planning from '../gcsp/predict/plan/index.js';
import { good } from './helpers/greg-publish-run.js';
import { fixture, TOURING, DERIVATIVES, cap, submitOf } from './helpers/order-plan-fixture.js';

const FIXTURE = new URL('./fixtures/gcsp-order-plan-operations.json', import.meta.url);

const quantity = (plan, id) => plan.quantities.find((q) => q.derivativeId === id).quantity;
const snapshots = async (f, kind) => good(await f.repository.query(f.context, 'plan_snapshots')).filter((r) => r.provenance.kind === kind);

test('a preview writes nothing, says it is a preview and shows the effect of tighter bounds', async (t) => {
  const f = await fixture(t);
  const before = await f.state();
  const changes = [{ key: DERIVATIVES, value: cap(await f.active(DERIVATIVES), TOURING, { max: 0 }) }];
  const preview = good(await f.ops.previewPlan(f.context, { changes }));
  assert.deepEqual([preview.mode, preview.preview, preview.writes], ['preview', true, 'none']);
  assert.match(preview.message, /^Preview only\. Nothing is saved, published or ordered\.$/);
  assert.equal(preview.activePolicyVersion, 'gcsp-policy-v1'); assert.match(preview.draftPolicyVersion, /^preview-/);
  assert.deepEqual([quantity(preview.activePlan, TOURING), quantity(preview.plan, TOURING)], [1, 0]);
  assert.equal(preview.plan.versions.policy, preview.draftPolicyVersion); assert.notEqual(preview.plan.planId, preview.activePlan.planId);
  assert.deepEqual(await f.state(), before); assert.equal(f.fake.requestCount, 0);
  // FUCQ-121: names and editor keys for the panel come from the catalogue and the policy, on reads and previews alike.
  const names = (p) => p.derivatives.map((d) => `${d.derivativeId}|${d.model} ${d.derivative}`);
  assert.deepEqual(preview.presentation, good(await f.ops.readPlan(f.context)).presentation);
  assert.deepEqual([preview.presentation.forecastBasis, preview.presentation.currency, preview.presentation.editableKeys],
    ['expressed-saved-demand', 'GBP', await f.active('orderPlan.gregEditableKeys')]);
  assert.ok(names(preview.presentation).includes(`${TOURING}|3 Series Touring 320i`));
  assert.deepEqual(preview.presentation.models.find((m) => m.modelId === 'g21-touring'), { modelId: 'g21-touring', model: '3 Series Touring' });
  // The live plan is untouched by the preview.
  assert.equal(quantity(good(await f.ops.readPlan(f.context)).plan, TOURING), 1);
  assert.deepEqual(await f.state(), before);
});

test('keys outside the policy-marked editable list are refused, and bad values are invalid', async (t) => {
  const f = await fixture(t); const before = await f.state();
  const marked = await f.active('orderPlan.gregEditableKeys');
  assert.deepEqual(marked, ['orderPlan.modelBounds', 'orderPlan.derivativeBounds', 'orderPlan.budgetMinor']);
  for (const key of ['orderPlan.catalog.v1', 'eligibility.rule.matchField', 'orderPlan.objectiveWeights', 'orderPlan.horizonDays', 'not.a.policy.key']) {
    for (const call of ['previewPlan', 'saveConstraintDraft', 'publishConstraints']) {
      const input = { changes: [{ key, value: 1 }], ...(call === 'previewPlan' ? {} : { commandId: 'c1' }),
        ...(call === 'publishConstraints' ? { expectedActiveVersion: 'gcsp-policy-v1' } : {}) };
      const out = await f.ops[call](f.context, input);
      assert.deepEqual([out.status, out.code, out.keys], ['invalid', 'policy-key-not-editable', [key]], `${call} ${key}`);
    }
  }
  const mixed = await f.ops.previewPlan(f.context, { changes: [{ key: 'orderPlan.budgetMinor', value: 1 }, { key: 'orderPlan.catalog.v1', value: {} }] });
  assert.deepEqual([mixed.status, mixed.keys], ['invalid', ['orderPlan.catalog.v1']]);
  const bounds = await f.active(DERIVATIVES);
  for (const value of [bounds.slice(1), cap(bounds, TOURING, { min: 3, max: 2 }), cap(bounds, TOURING, { max: -1 }), cap(bounds, TOURING, { max: 1.5 }),
    [...bounds.slice(1), { derivativeId: 'unknown', min: 0, max: 1 }]]) {
    assert.equal((await f.ops.previewPlan(f.context, { changes: [{ key: DERIVATIVES, value }] })).code, 'invalid-change-value');
  }
  assert.equal((await f.ops.previewPlan(f.context, { changes: [{ key: 'orderPlan.budgetMinor', value: -5 }] })).status, 'invalid');
  assert.equal((await f.ops.previewPlan(f.context, { changes: [] })).status, 'invalid');
  assert.equal((await f.ops.previewPlan(f.context, { changes: [{ key: DERIVATIVES, value: bounds }, { key: DERIVATIVES, value: bounds }] })).status, 'invalid');
  assert.deepEqual(await f.state(), before);
});

test('Greg keeps edited bounds as a draft, then publishes them as a new dated version', async (t) => {
  const f = await fixture(t);
  const changes = [{ key: DERIVATIVES, value: cap(await f.active(DERIVATIVES), TOURING, { max: 0 }) }];
  assert.equal(good(await f.ops.readConstraintDraft(f.context)).draft, null);
  const saved = good(await f.ops.saveConstraintDraft(f.context, { commandId: 'draft-1', changes }));
  assert.match(saved.draftId, /^constraint-draft-/);
  const draft = good(await f.ops.readConstraintDraft(f.context)).draft;
  assert.deepEqual([draft.draftId, draft.changes, draft.basePolicyVersion], [saved.draftId, changes, 'gcsp-policy-v1']);
  assert.deepEqual(await f.ops.saveConstraintDraft(f.context, { commandId: 'draft-1', changes }), await f.ops.saveConstraintDraft(f.context, { commandId: 'draft-1', changes }));
  assert.equal((await snapshots(f, 'constraint-draft')).length, 1);
  assert.equal((await f.ops.saveConstraintDraft(f.context, { commandId: 'draft-1', changes: [{ key: 'orderPlan.budgetMinor', value: 1 }] })).status, 'conflict');
  const row = (await snapshots(f, 'constraint-draft'))[0];
  assert.deepEqual([row.provenance.savedBy, row.provenance.basePolicyVersion, row.provenance.commandId], [f.context.principalId, 'gcsp-policy-v1', 'draft-1']);
  assert.equal(good(await f.ops.readPlan(f.context)).plan.versions.policy, 'gcsp-policy-v1'); // a draft is not policy

  const published = good(await f.ops.publishConstraints(f.context, { commandId: 'publish-1', expectedActiveVersion: 'gcsp-policy-v1', changes }));
  assert.equal(published.publisher, f.context.principalId); assert.equal(published.effectiveFrom, await f.now());
  assert.match(published.policyVersion, /^greg-constraints-/); assert.equal(published.activation.status, 'active');
  assert.equal(published.activation.policyVersion, published.policyVersion);
  const greg = await f.fresh(); const current = good(await f.ops.readPlan(greg));
  assert.equal(current.plan.versions.policy, published.policyVersion); assert.equal(quantity(current.plan, TOURING), 0);
  const row2 = good(await f.policy.getAssumption(DERIVATIVES, { runId: greg.runId, asOf: await f.now(), policyVersion: published.policyVersion }));
  assert.deepEqual(row2.value.find((b) => b.derivativeId === TOURING), { derivativeId: TOURING, min: 0, max: 0 });
  assert.equal(row2.status, 'assumed'); assert.match(row2.basis, /Greg/);
  // A stale expected version and a replayed command are handled by the policy publisher.
  assert.equal((await f.ops.publishConstraints(greg, { commandId: 'publish-2', expectedActiveVersion: 'gcsp-policy-v1', changes })).status, 'stale-version');
  assert.equal(good(await f.ops.publishConstraints(greg, { commandId: 'publish-1', expectedActiveVersion: 'gcsp-policy-v1', changes })).policyVersion, published.policyVersion);
});

const configFor = async (f, derivativeId) => good(await planning.createPolicyOrderPlanCatalog({ policy: f.policy })
  .readCatalog(f.context, { runId: f.context.runId, asOf: await f.now(), policyVersion: f.context.policyVersion })).derivatives.find((d) => d.derivativeId === derivativeId);

test('submission creates one request per derivative through the port, carrying the plan id and every version', async (t) => {
  const f = await fixture(t);
  const { plan } = good(await f.ops.readPlan(f.context));
  const out = good(await f.ops.submitPlan(f.context, submitOf(plan, 'submit-1')));
  assert.equal(f.fake.requestCount, 1);
  const [row] = f.fake.rows.future_order_requests; const touring = await configFor(f, TOURING);
  assert.deepEqual([out.planId, out.requests.length, out.requests[0].request.requestId, row.quantity, row.state], [plan.planId, 1, row.requestId, 1, 'requested']);
  assert.deepEqual([row.model, row.derivative], [touring.production.model, touring.production.derivative]);
  assert.deepEqual([row.plan.planId, row.plan.submissionId], [plan.planId, out.submissionId]);
  const v = row.plan.versions;
  for (const key of ['plan', 'forecast', 'policy', 'model', 'cohort', 'stock', 'supply']) assert.ok(typeof v[key] === 'string' && v[key], key);
  assert.deepEqual([v.plan, v.model, v.basePolicy], [plan.planId, 'expressed-saved-demand', 'gcsp-policy-v1']);
  for (const key of ['forecast', 'policy', 'cohort', 'stock', 'supply', 'catalog', 'clock']) assert.equal(v[key], plan.versions[key], key);
  const [saved] = await snapshots(f, 'submission');
  assert.deepEqual([saved.planId, saved.provenance.submittedBy, saved.provenance.commandId], [out.submissionId, f.context.principalId, 'submit-1']);
  assert.equal(saved.output.lines[0].commandId, `submit-1:${TOURING}`);
  // A replay finds the saved submission, skips the staleness check and creates nothing new.
  await f.advance();
  assert.deepEqual(good(await f.ops.submitPlan(f.context, submitOf(plan, 'submit-1'))), out);
  assert.equal(f.fake.requestCount, 1); assert.equal((await snapshots(f, 'submission')).length, 1);
  assert.deepEqual(saved.output.changes, []); assert.deepEqual(good(await f.ops.readPlan(f.context)).replan.changes, []); // no changes were requested
  const changed = await f.ops.submitPlan(f.context, { ...submitOf(plan, 'submit-1'), planId: 'order-plan-other' });
  assert.deepEqual([changed.status, changed.code], ['conflict', 'idempotency-input-changed']); assert.equal(f.fake.requestCount, 1);
});

test('a plan submitted under draft limits carries the draft policy version, and other plans are refused', async (t) => {
  const f = await fixture(t);
  const changes = [{ key: DERIVATIVES, value: cap(await f.active(DERIVATIVES), TOURING, { min: 2 }) }];
  const preview = good(await f.ops.previewPlan(f.context, { changes }));
  assert.equal(quantity(preview.plan, TOURING), 2);
  assert.equal((await f.ops.submitPlan(f.context, submitOf(preview.plan, 'no-changes'))).code, 'replan-needed'); // the draft is part of the plan
  const out = good(await f.ops.submitPlan(f.context, submitOf(preview.plan, 'with-changes', { changes })));
  const row = f.fake.rows.future_order_requests[0];
  assert.deepEqual([row.quantity, row.plan.versions.policy, row.plan.versions.basePolicy, out.requests[0].quantity], [2, preview.draftPolicyVersion, 'gcsp-policy-v1', 2]);
  const refusals = [['plan-not-feasible', [{ key: 'orderPlan.budgetMinor', value: 5000000 },
    { key: 'orderPlan.modelBounds', value: (await f.active('orderPlan.modelBounds')).map((b) => (b.modelId === 'g61-i5' ? { ...b, min: 1 } : b)) }]],
  ['plan-has-no-order', [{ key: 'orderPlan.budgetMinor', value: 0 }]]];
  for (const [code, edits] of refusals) {
    const p = good(await f.ops.previewPlan(f.context, { changes: edits })).plan;
    const out2 = await f.ops.submitPlan(f.context, submitOf(p, `refuse-${code}`, { changes: edits }));
    assert.deepEqual([out2.status, out2.code], ['invalid', code]);
  }
  assert.equal(f.fake.requestCount, 1); assert.equal((await snapshots(f, 'submission')).length, 1);
  const bare = planning.createOrderPlanOperations({ repository: f.repository, policy: f.policy, identity: f.identity, clock: f.clock, supply: f.fake });
  const { plan } = good(await bare.readPlan(f.context));
  const none = await bare.submitPlan(f.context, submitOf(plan, 'no-port'));
  assert.deepEqual([none.status, none.code], ['unavailable', 'supply-requests-not-configured']);
});

test('stale inputs give a replan-needed outcome that lists the changed inputs and submits nothing', async (t) => {
  const f = await fixture(t);
  const { plan: old } = good(await f.ops.readPlan(f.context));
  good(await f.ops.submitPlan(f.context, submitOf(old, 'first')));
  // Supply moved (a request now exists); the plan id folds in every version, so it moves too.
  const supplyStale = await f.ops.submitPlan(f.context, submitOf(old, 'second'));
  assert.deepEqual([supplyStale.status, supplyStale.code, supplyStale.changedInputs], ['conflict', 'replan-needed', ['supply', 'plan']]);
  assert.match(supplyStale.reason, /Replan before submitting/);
  assert.notEqual(supplyStale.current.planId, old.planId); assert.equal(supplyStale.current.versions.stock, old.versions.stock);
  assert.notEqual(supplyStale.current.versions.supply, old.versions.supply);
  // A released unit appeared in stock.
  const { plan } = good(await f.ops.readPlan(f.context));
  f.fake.rows.stock.push({ runId: f.context.runId, orderUuid: 'manual-unit-1', configurationId: (await configFor(f, TOURING)).configurationIds[0],
    state: 'released', available: true, visibility: { companyIds: [f.employee.companyId], schemeIds: [f.employee.schemeId], employeeIds: null },
    release: { releasedAt: await f.now() } });
  const stockStale = await f.ops.submitPlan(f.context, submitOf(plan, 'third'));
  assert.deepEqual([stockStale.code, stockStale.changedInputs], ['replan-needed', ['stock', 'plan']]);
  assert.equal(f.fake.requestCount, 1); assert.equal((await snapshots(f, 'submission')).length, 1);
});

test('a policy change after the preview is a stale input too', async (t) => {
  const f = await fixture(t);
  const { plan } = good(await f.ops.readPlan(f.context));
  const published = good(await f.ops.publishConstraints(f.context, { commandId: 'budget', expectedActiveVersion: 'gcsp-policy-v1',
    changes: [{ key: 'orderPlan.budgetMinor', value: 19000000 }] }));
  const greg = await f.fresh();
  const stale = await f.ops.submitPlan(greg, submitOf(plan, 'after-policy'));
  assert.equal(stale.code, 'replan-needed'); assert.ok(stale.changedInputs.includes('policy'), JSON.stringify(stale.changedInputs));
  assert.equal(stale.current.versions.policy, published.policyVersion); assert.equal(f.fake.requestCount, 0);
  const fresh = good(await f.ops.readPlan(greg)).plan;
  assert.equal(good(await f.ops.submitPlan(greg, submitOf(fresh, 'after-replan'))).requests.length, 1);
});

test('replan after a partial confirmation, a delay and a release: a request is never supply, only a release is stock', async (t) => {
  const f = await fixture(t);
  const changes = [{ key: DERIVATIVES, value: cap(await f.active(DERIVATIVES), TOURING, { min: 2 }) }];
  const preview = good(await f.ops.previewPlan(f.context, { changes }));
  assert.equal(good(await f.ops.readPlan(f.context)).replan.status, 'no-submission');
  const sent = good(await f.ops.submitPlan(f.context, submitOf(preview.plan, 'sub-1', { changes })));
  const requestId = sent.requests[0].request.requestId;
  const read = async () => good(await f.ops.readPlan(f.context));
  const sources = (plan) => plan.allocations.map((a) => a.sourceId);

  let now = await read(); // requested only
  assert.deepEqual([now.replan.status, now.replan.submittedPlanId, now.replan.responses], ['unchanged-since-submission', preview.plan.planId, []]);
  assert.deepEqual(now.replan.changes, changes); // the requested limits survive a reload (FUCQ-314)
  assert.deepEqual(now.plan.supplyActivity.requests.map((r) => [r.requestId, r.derivativeId, r.quantity, r.state, r.commandId]),
    [[requestId, TOURING, 2, 'requested', `sub-1:${TOURING}`]]);
  assert.deepEqual([now.plan.orderQuantity, sources(now.plan), now.plan.unallocatedStockRisk.totalSupply], [1, [`order:${TOURING}`], 1]);

  await f.advance(); const first = await f.fake.confirm(f.context, requestId, 1); // 1 of 2
  now = await read();
  assert.deepEqual([now.replan.status, now.replan.after.kind, now.replan.after.quantity, now.replan.after.supplyId], ['replanned', 'partly-confirmed', 1, first]);
  assert.ok(Date.parse(now.replan.after.at) > Date.parse(now.replan.submittedAt));
  assert.deepEqual(now.plan.supplyActivity.responses, now.replan.responses);
  assert.deepEqual([now.plan.orderQuantity, sources(now.plan), now.plan.unallocatedStockRisk.totalSupply], [0, [`supply:${first}`], 1]); // only the confirmed unit

  await f.advance(); await f.fake.delay(f.context, requestId, '2027-01-01T00:00:00.000Z', 'Production slot moved');
  now = await read();
  assert.deepEqual([now.replan.status, now.replan.after.kind, now.replan.after.delayUntil, now.replan.after.reason, now.replan.responses.length],
    ['replanned', 'delayed', '2027-01-01T00:00:00.000Z', 'Production slot moved', 2]);
  assert.deepEqual([now.plan.orderQuantity, now.plan.unallocatedStockRisk.totalSupply], [0, 1]); // a delay adds no supply

  await f.advance(); const second = await f.fake.confirm(f.context, requestId, 1);
  now = await read();
  assert.deepEqual([now.replan.after.kind, now.replan.after.supplyId, now.plan.unallocatedStockRisk.totalSupply], ['confirmed', second, 2]);
  const stockBefore = now.plan.versions.stock; assert.ok(now.plan.allocations.every((a) => a.source !== 'stock'));

  await f.advance(); const [unit] = await f.fake.release(f.context, first, 1);
  now = await read();
  assert.deepEqual([now.replan.after.kind, now.replan.after.supplyId, now.replan.after.quantity], ['released', first, 1]);
  assert.notEqual(now.plan.versions.stock, stockBefore); assert.deepEqual(sources(now.plan), [`stock:${unit}`]);
  assert.equal(now.plan.unallocatedStockRisk.totalSupply, 2); // the released unit is stock; the other confirmed unit is still inbound
  assert.deepEqual(now.plan.supplyActivity.responses.map((r) => r.kind), ['partly-confirmed', 'delayed', 'confirmed', 'released']);
});

test('other roles and forged contexts are refused on every method, and a new run sees none of the old run', async (t) => {
  const f = await fixture(t);
  const changes = [{ key: 'orderPlan.budgetMinor', value: 19000000 }];
  const { plan } = good(await f.ops.readPlan(f.context));
  good(await f.ops.saveConstraintDraft(f.context, { commandId: 'draft', changes }));
  good(await f.ops.submitPlan(f.context, submitOf(plan, 'sub')));
  const calls = (ctx) => ({ readPlan: () => f.ops.readPlan(ctx), previewPlan: () => f.ops.previewPlan(ctx, { changes }),
    saveConstraintDraft: () => f.ops.saveConstraintDraft(ctx, { commandId: 'x', changes }), readConstraintDraft: () => f.ops.readConstraintDraft(ctx),
    publishConstraints: () => f.ops.publishConstraints(ctx, { commandId: 'x', expectedActiveVersion: 'gcsp-policy-v1', changes }),
    submitPlan: () => f.ops.submitPlan(ctx, submitOf(plan, 'x')) });
  const before = await f.state();
  for (const [who, ctx] of [['employee', f.employee], ['presenter', f.presenter.value.context], ['forged run', { ...f.context, runId: 'other-run' }]]) {
    for (const [name, call] of Object.entries(calls(ctx))) assert.equal((await call()).status, 'forbidden', `${who} ${name}`);
  }
  assert.deepEqual(await f.state(), before); assert.equal(f.fake.requestCount, 1);
  // The caller never chooses the run, person, quantity or request.
  for (const extra of [{ runId: 'other-run' }, { principalId: 'demo-paula' }, { employeeId: 'x' }, { quantity: 9 }, { requestId: 'request-x' }]) {
    assert.equal((await f.ops.previewPlan(f.context, { changes, ...extra })).status, 'invalid');
    assert.equal((await f.ops.saveConstraintDraft(f.context, { commandId: 'y', changes, ...extra })).status, 'invalid');
    assert.equal((await f.ops.submitPlan(f.context, { ...submitOf(plan, 'z'), ...extra })).status, 'invalid');
  }
  assert.equal((await f.ops.readPlan(f.context, { runId: 'other-run' })).status, 'invalid');
  assert.ok((await f.repository.query(f.context, 'plan_snapshots')).value.every((r) => r.runId === f.context.runId));
  // After a reset the old run is stale and the new run starts with no draft and no submission.
  const run = good(await f.clock.readState(f.presenter.value.context));
  good(await f.clock.reset(f.presenter.value.context, { commandId: 'reset-1', expectedRunId: run.runId, expectedRunVersion: run.runVersion,
    scenarioVersion: run.versions.scenario, fixtureVersion: run.versions.fixture }));
  const next = good(await f.identity.createPresenterSession('presenter-2')).context;
  const greg = good(await f.identity.switchPrincipal(next, 'demo-greg', 'greg-next')).context;
  assert.notEqual(greg.runId, f.context.runId);
  assert.equal(good(await f.ops.readConstraintDraft(greg)).draft, null);
  assert.deepEqual(good(await f.repository.query(greg, 'plan_snapshots')), []);
  for (const name of ['readPlan', 'readConstraintDraft']) assert.notEqual((await calls(f.context)[name]()).status, 'ok', name);
});

// Fixture shapes for the plan panel: the recorded values must keep the keys the live responses have.
const sameShape = (live, saved, path = '$') => {
  if (saved === null || live === null) return;
  if (Array.isArray(saved) || Array.isArray(live)) {
    assert.ok(Array.isArray(saved) && Array.isArray(live), `${path} is an array`);
    if (saved.length && live.length) sameShape(live[0], saved[0], `${path}[]`);
    return;
  }
  assert.equal(typeof live, typeof saved, path);
  if (typeof saved === 'object') {
    assert.deepEqual(Object.keys(live).sort(), Object.keys(saved).sort(), path);
    for (const key of Object.keys(saved)) sameShape(live[key], saved[key], `${path}.${key}`);
  }
};

test('preview, stale and replanned responses match the shapes recorded for the plan panel', async (t) => {
  const f = await fixture(t);
  const changes = [{ key: DERIVATIVES, value: cap(await f.active(DERIVATIVES), TOURING, { min: 2 }) }];
  const preview = await f.ops.previewPlan(f.context, { changes });
  const { plan } = good(await f.ops.readPlan(f.context));
  const stale = await f.ops.submitPlan(f.context, { ...submitOf(plan, 'stale'), versions: { ...plan.versions, stock: 'changed-since-preview' } });
  const sent = good(await f.ops.submitPlan(f.context, submitOf(good(preview).plan, 'sub', { changes })));
  await f.advance(); await f.fake.confirm(f.context, sent.requests[0].request.requestId, 1);
  const replanned = await f.ops.readPlan(f.context);
  assert.deepEqual([preview.status, stale.code, replanned.value.replan.status], ['ok', 'replan-needed', 'replanned']);
  // An infeasible preview (a model minimum the budget cannot pay for) has its own plan shape, with conflicts and no quantities.
  const infeasible = await f.ops.previewPlan(f.context, { changes: [{ key: 'orderPlan.budgetMinor', value: 5000000 },
    { key: 'orderPlan.modelBounds', value: (await f.active('orderPlan.modelBounds')).map((b) => (b.modelId === 'g61-i5' ? { ...b, min: 1 } : b)) }] });
  assert.deepEqual([infeasible.status, infeasible.value.plan.status], ['ok', 'infeasible']);
  const live = { note: 'Recorded by server/test/gcsp-order-plan-submit.test.js (GCSP_UPDATE_FIXTURES=1 rewrites it). Compare keys, not values.', preview, stale, replanned, infeasible };
  if (process.env.GCSP_UPDATE_FIXTURES === '1') await writeFile(FIXTURE, `${JSON.stringify(live, null, 2)}\n`);
  const saved = JSON.parse(await readFile(FIXTURE, 'utf8'));
  for (const name of ['preview', 'stale', 'replanned', 'infeasible']) sameShape(live[name], saved[name], name);
});
