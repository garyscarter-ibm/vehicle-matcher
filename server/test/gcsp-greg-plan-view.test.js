// Data layer for Greg's order plan panel (FUCQ-121): HTTP adapter, view model and fixtures. No DOM, no port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planOutcome, createOrderPlanHttpAdapter, PLAN_MESSAGES } from '../../blocks/gcsp/greg/plan/http-adapter.js';
import { createGregHttpAdapter } from '../../blocks/gcsp/greg/http-adapter.js';
import { toPlanView, toChanges, staleView, PlanViewError } from '../../blocks/gcsp/greg/plan/plan-view.js';
import { gateText } from '../../blocks/gcsp/greg/plan/plan-copy.js';
import { FIXTURE_NAMES, FIXTURE_VALUES, planFixtureAdapter } from '../../blocks/gcsp/greg/plan/fixtures.js';

const RECORDED = JSON.parse(await readFile(new URL('./fixtures/gcsp-order-plan-operations.json', import.meta.url), 'utf8'));
const clone = (v) => structuredClone(v);
const ok = (value) => ({ status: 'ok', value });
const value = (name) => FIXTURE_VALUES[name]();
const view = (name) => toPlanView(value(name));

test('planOutcome maps every HTTP outcome the order-plan routes produce to a view state', () => {
  const read = planOutcome(200, ok(value('ready')));
  assert.deepEqual([read.status, read.value.plan.planId], ['ready', 'order-plan-ready0001']);
  assert.equal(planOutcome(200, ok(value('submission'))).status, 'ready');
  // A 200 that is not a plan or a submission is unavailable, never ready.
  for (const body of [null, ok(null), ok({}), ok({ plan: {} }), { status: 'unavailable' }]) assert.equal(planOutcome(200, body).status, 'unavailable');
  for (const code of [401, 403]) assert.deepEqual(planOutcome(code, { status: 'forbidden' }), { status: 'refused', message: PLAN_MESSAGES.refused });
  assert.deepEqual(planOutcome(409, { status: 'stale-run' }), { status: 'refused', message: PLAN_MESSAGES.reset });
  const stale = planOutcome(409, value('stale-body'));
  assert.deepEqual([stale.status, stale.changedInputs, stale.current.planId, stale.message], ['replan-needed', ['stock', 'plan'], 'order-plan-fresh0001', PLAN_MESSAGES.replan]);
  const invalid = planOutcome(400, { status: 'invalid', code: 'policy-key-not-editable', reasons: [{ field: 'changes', reason: 'Greg cannot edit: x.' }, { reason: '' }] });
  assert.deepEqual(invalid, { status: 'invalid', code: 'policy-key-not-editable', reasons: [{ field: 'changes', reason: 'Greg cannot edit: x.' }], message: 'Greg cannot edit: x.' });
  assert.equal(planOutcome(400, { status: 'invalid', code: 'plan-not-feasible' }).message, PLAN_MESSAGES.invalid);
  assert.equal(planOutcome(409, { status: 'conflict', code: 'idempotency-input-changed', reason: 'This command ID was used with different input.' }).status, 'invalid');
  for (const [code, body] of [[503, { status: 'unavailable' }], [500, null], [404, { status: 'not-found' }]]) assert.deepEqual(planOutcome(code, body), { status: 'unavailable', message: PLAN_MESSAGES.unavailable });
  assert.match(planOutcome(503, { status: 'unavailable', code: 'submission-incomplete', reason: 'Some requests were not accepted. Retry with the same command ID.' }).message, /Retry with the same command ID/);
});

test('the HTTP adapter sends the documented requests and maps network failures', async () => {
  const seen = [];
  const reply = (status, body) => async (url, init) => { seen.push({ url, init }); return { status, json: async () => body }; };
  const adapter = createOrderPlanHttpAdapter({ base: 'https://api.test', fetchImpl: reply(200, ok(value('preview'))) });
  assert.equal((await adapter.readPlan()).status, 'ready');
  const changes = [{ key: 'orderPlan.budgetMinor', value: 1 }];
  assert.equal((await adapter.previewPlan({ changes })).status, 'ready');
  const versions = { policy: 'p' };
  assert.equal((await createOrderPlanHttpAdapter({ fetchImpl: reply(200, ok(value('submission'))) }).submitPlan({ commandId: 'c1', planId: 'plan-1', versions, changes })).status, 'ready');
  assert.equal(seen[0].url, 'https://api.test/api/gcsp/greg/order-plan'); assert.equal(seen[0].init.method, 'GET'); assert.equal(seen[0].init.body, undefined);
  assert.equal(seen[1].url, 'https://api.test/api/gcsp/greg/order-plan/preview'); assert.deepEqual(JSON.parse(seen[1].init.body), { changes });
  assert.equal(seen[2].url, '/api/gcsp/greg/order-plan/submit'); assert.deepEqual(JSON.parse(seen[2].init.body), { commandId: 'c1', planId: 'plan-1', versions, changes });
  assert.ok(seen.every((s) => s.init.credentials === 'include'));
  // No edits means no `changes` field: the server refuses an empty list.
  const bare = createOrderPlanHttpAdapter({ fetchImpl: reply(200, ok(value('submission'))) });
  await bare.submitPlan({ commandId: 'c2', planId: 'plan-1', versions, changes: [] });
  assert.deepEqual(Object.keys(JSON.parse(seen[3].init.body)), ['commandId', 'planId', 'versions']);

  const down = createOrderPlanHttpAdapter({ fetchImpl: async () => { throw new TypeError('network'); } });
  assert.deepEqual(await down.readPlan(), { status: 'unavailable', message: PLAN_MESSAGES.unavailable });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createOrderPlanHttpAdapter({ fetchImpl: async () => { throw new Error('aborted'); } }).previewPlan({ changes, signal: controller.signal }));
  assert.equal((await createOrderPlanHttpAdapter({ fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }) }).readPlan()).status, 'unavailable');
  assert.deepEqual(Object.keys(createGregHttpAdapter({ fetchImpl: reply(200, {}) }).orderPlan).sort(), ['previewPlan', 'readPlan', 'submitPlan']);
});

test('toPlanView leads with the action, then the quantities, coverage, risk, reasons, constraints and an alternative', () => {
  const v = view('ready');
  assert.deepEqual([v.kind, v.preview, v.submission, v.canSubmit], ['ready', false, null, true]);
  assert.equal(v.action, 'Order 3 vehicles: 2 × 3 Series Touring 320i, 1 × i5 Touring eDrive40 M Sport Pro with Technology Plus and Comfort Packs');
  assert.equal(v.lines.length, 4); assert.deepEqual(v.lines.filter((l) => l.zero).map((l) => l.derivativeId), ['g20-saloon-320i', 'g20-saloon-330e']);
  assert.deepEqual(v.lines.find((l) => l.derivativeId === 'g21-touring-320i'), { derivativeId: 'g21-touring-320i', modelId: 'g21-touring', model: '3 Series Touring', derivative: '320i',
    name: '3 Series Touring 320i', quantity: 2, zero: false });
  assert.deepEqual(v.models.map((m) => [m.model, m.quantity]), [['3 Series Saloon', 0], ['3 Series Touring', 2], ['i5 Touring', 1]]);
  assert.deepEqual([v.spend, v.orderQuantity], ['£146,000', 3]);
  assert.deepEqual([v.coverage.label, v.coverage.percent, v.coverage.fraction], ['3 of 4 renewals covered before renewal', 75, 0.75]);
  assert.equal(v.unallocatedRisk.label, '1 of 4 vehicles in supply not matched to a renewal');
  assert.equal(v.unallocatedRisk.sources[0].label, 'New order: i5 Touring eDrive40 M Sport Pro with Technology Plus and Comfort Packs');
  assert.equal(v.unmetNeeds[0].label, 'Renewal on 15 Feb 2027');
  assert.deepEqual(v.unmetNeeds[0].reasons, ['No more suitable vehicles can be ordered inside the limits', 'Suitable supply arrives after the renewal date']);
  assert.deepEqual(v.unmetNeeds[0].blockedBy, ['i5 Touring eDrive40 M Sport Pro with Technology Plus and Comfort Packs maximum',
    'i5 Touring eDrive40 M Sport Pro with Technology Plus and Comfort Packs cannot arrive before the renewal']);
  assert.equal(v.binding[1].label, 'i5 Touring maximum');
  assert.deepEqual(v.alternatives.map((a) => [a.label, a.sameAsRecommended]), [['No new orders', false], ['Next best plan', false]]);
  assert.equal(v.alternatives[0].summary, 'No new vehicles. Covers 1 of 4 renewals. Spend £0. 0 vehicles unmatched.');
  assert.equal(v.alternatives[1].summary, 'Order 2 vehicles: 3 Series Touring 320i. Covers 2 of 4 renewals. Spend £84,000. 1 vehicle unmatched.');
  assert.deepEqual(v.versions.forecast, { basis: 'expressed-saved-demand', label: 'Expressed demand', qualifier: 'deterministic baseline',
    note: 'Built from what employees have saved and confirmed they need. It is not a prediction.' });
  assert.deepEqual([v.versions.policy, v.versions.asOfLabel, v.versions.planIdShort], ['gcsp-policy-v1', '5 Nov 2026, 09:00 GMT', 'ready000']);
  assert.deepEqual(v.submit, { planId: 'order-plan-ready0001', versions: value('ready').plan.versions, changes: [] });
});

test('toPlanView states: no demand, no order needed, infeasible, submitted and replanned', () => {
  const none = view('no-demand');
  assert.deepEqual([none.kind, none.action, none.canSubmit, none.coverage.label], ['no-demand', 'No saved demand to plan for yet', false, 'No renewals to cover yet']);
  assert.ok(none.note && none.alternatives[0].sameAsRecommended);
  const noOrder = toPlanView(Object.assign(value('ready'), { plan: Object.assign(value('ready').plan, { orderQuantity: 0, quantities: value('ready').plan.quantities.map((q) => ({ ...q, quantity: 0 })) }) }));
  assert.deepEqual([noOrder.action, noOrder.canSubmit], ['No new order needed', false]);
  const bad = toPlanView(value('infeasible'));
  assert.deepEqual([bad.kind, bad.preview, bad.action, bad.canSubmit, bad.lines, bad.alternatives, bad.coverage, bad.spend], ['infeasible', true, 'No plan meets these limits', false, [], [], null, null]);
  assert.deepEqual(bad.conflicts.map((c) => [c.label, c.detail]), [['Budget', 'Spend £62,000 is over the £50,000 budget.'], ['i5 Touring minimum', 'Minimum 1.']]);
  const sent = view('submitted');
  assert.deepEqual([sent.kind, sent.submission.status, sent.submission.after, sent.submission.submittedAtLabel], ['ready', 'submitted', null, '5 Nov 2026, 09:00 GMT']);
  assert.deepEqual(sent.submission.requests, [{ name: '3 Series Touring 320i', quantity: 2, state: 'requested', stateLabel: 'Requested' }]);
  const again = view('replanned');
  assert.deepEqual([again.submission.status, again.submission.after, again.submission.afterAtLabel], ['replanned', 'Production partly confirmed 1 vehicle', '5 Nov 2026, 09:01 GMT']);
  assert.throws(() => toPlanView({}), PlanViewError); assert.throws(() => toPlanView({ plan: { planId: 3 } }), PlanViewError);
  // Other Production responses read plainly too.
  const label = (after) => toPlanView({ ...value('replanned'), replan: { ...value('replanned').replan, after } }).submission.after;
  assert.equal(label({ kind: 'delayed', delayUntil: '2027-01-01T00:00:00.000Z', reason: 'Production slot moved' }), 'Production delayed the order to 1 Jan 2027 (Production slot moved)');
  assert.equal(label({ kind: 'released', quantity: 2 }), 'Production released 2 vehicles to stock');
  assert.equal(label({ kind: 'confirmed', quantity: 1 }), 'Production confirmed 1 vehicle');
});

test('a preview says it is a preview and differs from the current plan per derivative and in total', () => {
  const v = view('preview');
  assert.deepEqual([v.kind, v.preview, v.previewMessage, v.action], ['preview', true, 'Preview only. Nothing is saved, published or ordered.',
    'Order 2 vehicles: 1 × 3 Series Touring 320i, 1 × i5 Touring eDrive40 M Sport Pro with Technology Plus and Comfort Packs']);
  const d = v.differences;
  assert.equal(d.changed, true);
  const touring = d.lines.find((l) => l.derivativeId === 'g21-touring-320i');
  assert.deepEqual([touring.current, touring.preview, touring.change, touring.changeLabel], [2, 1, -1, '-1']);
  assert.equal(d.lines.find((l) => l.derivativeId === 'g20-saloon-320i').changeLabel, 'No change');
  assert.deepEqual(d.coverage, { before: '3 of 4', after: '2 of 4', changed: true });
  assert.deepEqual(d.spend, { before: '£146,000', after: '£104,000', changed: true });
  assert.deepEqual(d.orderQuantity, { before: 3, after: 2, changed: true });
  assert.deepEqual(v.submit.changes, value('preview').changes);
  const same = value('preview'); same.plan = clone(same.activePlan);
  assert.deepEqual([toPlanView(same).differences.changed, toPlanView(same).differences.summary], [false, 'This preview gives the same plan as now.']);
  const bad = view('infeasible').differences;
  assert.ok(bad.lines.every((l) => l.preview === null && l.changeLabel === 'No plan')); assert.match(bad.summary, /No plan meets these limits/);
});

test('limits come from the plan provenance for the editable keys, and toChanges turns edits back into route changes', () => {
  const v = view('ready');
  assert.deepEqual(v.limits.map((g) => [g.key, g.kind]), [['orderPlan.modelBounds', 'bounds'], ['orderPlan.derivativeBounds', 'bounds'], ['orderPlan.budgetMinor', 'budget']]);
  assert.deepEqual(v.limits[0].rows[1], { id: 'g21-touring', label: '3 Series Touring', min: 0, max: 3 });
  assert.equal(v.limits[1].rows[2].label, '3 Series Touring 320i');
  assert.deepEqual([v.limits[2].minor, v.limits[2].pounds], [20000000, 200000]);
  // The unedited limits round-trip to exactly what the server stores, and nothing is sent against a baseline.
  const all = toChanges(v.limits);
  const stored = (key) => value('ready').plan.policyProvenance.find((p) => p.key === key).value;
  assert.deepEqual(all, [{ key: 'orderPlan.modelBounds', value: stored('orderPlan.modelBounds') }, { key: 'orderPlan.derivativeBounds', value: stored('orderPlan.derivativeBounds') },
    { key: 'orderPlan.budgetMinor', value: stored('orderPlan.budgetMinor') }]);
  assert.deepEqual(toChanges(v.limits, v.limits), []);
  // Edited text inputs: only the changed groups go, the budget in pounds becomes minor units.
  const draft = clone(v.limits);
  draft[1].rows[2].max = '1'; draft[2].pounds = '150000.50';
  const changes = toChanges(draft, v.limits);
  assert.deepEqual(changes.map((c) => c.key), ['orderPlan.derivativeBounds', 'orderPlan.budgetMinor']);
  assert.deepEqual(changes[0].value.find((b) => b.derivativeId === 'g21-touring-320i'), { derivativeId: 'g21-touring-320i', min: 0, max: 1 });
  assert.equal(changes[1].value, 15000050);
  // An empty field is sent as null so the server explains it; the group is never silently dropped.
  draft[2].pounds = ''; assert.equal(toChanges(draft, v.limits).at(-1).value, null);
  // Only editable keys get an editor.
  const narrow = value('ready'); narrow.presentation.editableKeys = ['orderPlan.budgetMinor'];
  assert.deepEqual(toPlanView(narrow).limits.map((g) => g.key), ['orderPlan.budgetMinor']);
});

test('staleView labels the changed inputs in plain words', () => {
  const s = staleView(planOutcome(409, value('stale-body')));
  assert.deepEqual(s.changed, [{ key: 'stock', label: 'Stock' }, { key: 'plan', label: 'The plan itself' }]);
  assert.deepEqual([s.title, s.summary], ['Replan needed', 'Changed since this plan: stock, the plan itself.']);
  assert.equal(s.current.planId, 'order-plan-fresh0001');
  const all = staleView({ changedInputs: ['plan', 'supply', 'policy', 'clock', 'forecast', 'cohort', 'catalog', 'odd-key'] });
  assert.deepEqual(all.changed.map((c) => c.label), ['Production requests and supply', 'Limits and rules', 'Demo clock', 'Demand forecast', 'Employee group', 'Vehicle catalogue', 'Odd key', 'The plan itself']);
  assert.match(staleView(undefined).summary, /Something changed/);
});

test('unknown gate codes and forecast bases still show something readable', () => {
  assert.equal(gateText('brand-new-gate'), 'Other reason (brand-new-gate)');
  assert.equal(gateText('essential-unmet'), 'Essential not met');
  assert.equal(gateText('derivative-representation-not-fully-eligible:g61-i5-40', (id) => `Name of ${id}`), 'Not every version of Name of g61-i5-40 is eligible');
  const v = value('ready'); v.plan.unmetNeeds[0].gates = ['brand-new-gate']; v.plan.unmetNeeds[0].constraintIds = ['mystery-constraint'];
  v.presentation.forecastBasis = 'learned-model-v2';
  const out = toPlanView(v);
  assert.deepEqual(out.unmetNeeds[0].reasons, ['Other reason (brand-new-gate)']); assert.deepEqual(out.unmetNeeds[0].blockedBy, ['Mystery constraint']);
  assert.deepEqual([out.versions.forecast.label, out.versions.forecast.qualifier], ['learned-model-v2', null]);
  // Without a catalogue the ids still show.
  delete v.presentation; assert.equal(toPlanView(v).lines[2].name, 'g21-touring-320i');
});

test('fixtures: every name gives the adapter interface, fresh objects, and the state it is named for', async () => {
  assert.equal(planFixtureAdapter('nope'), null);
  for (const name of FIXTURE_NAMES) { const a = planFixtureAdapter(name); assert.deepEqual(Object.keys(a).sort(), ['previewPlan', 'readPlan', 'submitPlan'], name); }
  const outcome = async (name, call, input) => planFixtureAdapter(name)[call](input);
  assert.equal((await outcome('ready', 'readPlan')).status, 'ready');
  assert.notEqual((await outcome('ready', 'readPlan')).value, (await outcome('ready', 'readPlan')).value);
  assert.equal(toPlanView((await outcome('no-demand', 'readPlan')).value).kind, 'no-demand');
  assert.equal(toPlanView((await outcome('preview', 'previewPlan', { changes: [] })).value).kind, 'preview');
  assert.equal(toPlanView((await outcome('infeasible', 'previewPlan', { changes: [] })).value).kind, 'infeasible');
  assert.equal((await outcome('stale', 'submitPlan', {})).status, 'replan-needed');
  assert.equal((await outcome('submitted', 'submitPlan', {})).value.submissionId.startsWith('submission-'), true);
  assert.equal(toPlanView((await outcome('submitted', 'readPlan')).value).submission.status, 'submitted');
  assert.equal(toPlanView((await outcome('replanned', 'readPlan')).value).submission.status, 'replanned');
  for (const name of ['unavailable', 'refused']) for (const call of ['readPlan', 'previewPlan', 'submitPlan']) assert.equal((await outcome(name, call, {})).status, name);
  const controller = new AbortController();
  const pending = planFixtureAdapter('loading').readPlan({ signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});

// Same walk the live-shape test uses: equal key sets at every level, comparing the first row of each list.
function shapeIssues(live, saved, path = '$') {
  if (saved === null || live === null) return [];
  if (Array.isArray(saved) || Array.isArray(live)) {
    if (!Array.isArray(saved) || !Array.isArray(live)) return [`${path}: array mismatch`];
    return saved.length && live.length ? shapeIssues(live[0], saved[0], `${path}[]`) : [];
  }
  if (typeof live !== typeof saved) return [`${path}: ${typeof live} vs ${typeof saved}`];
  if (typeof saved !== 'object') return [];
  const a = Object.keys(live).sort(); const e = Object.keys(saved).sort();
  if (a.join() !== e.join()) return [`${path}: keys ${a} differ from ${e}`];
  return a.flatMap((key) => shapeIssues(live[key], saved[key], `${path}.${key}`));
}

test('fixture values have the keys of the shapes recorded from the live server', () => {
  const issues = (live, saved, path) => shapeIssues(live, saved, path);
  assert.ok(issues({ a: 1, b: 2 }, { a: 1 }).length, 'comparator catches an extra key');
  const recorded = RECORDED.replanned.value;
  for (const name of ['ready', 'no-demand', 'submitted']) assert.deepEqual(Object.keys(value(name)).sort(), Object.keys(recorded).sort(), name);
  for (const name of ['ready', 'no-demand', 'submitted', 'replanned']) {
    assert.deepEqual(issues(value(name).plan, recorded.plan, name), [], name);
    assert.deepEqual(issues(value(name).presentation, recorded.presentation, `${name}.presentation`), [], name);
  }
  assert.deepEqual(issues(value('replanned'), recorded, 'replanned'), []);
  // The recorded preview's baseline is infeasible (its own alternative shape); the feasible shape is the replanned one.
  const strip = (v) => ({ ...v, plan: { ...v.plan, alternatives: [] }, activePlan: { ...v.activePlan, alternatives: [] } });
  assert.deepEqual(issues(strip(value('preview')), strip(RECORDED.preview.value), 'preview'), []);
  assert.deepEqual(issues(value('preview').plan.alternatives, recorded.plan.alternatives, 'preview alternatives'), []);
  assert.deepEqual(issues(value('infeasible'), RECORDED.infeasible.value, 'infeasible'), []);
  assert.deepEqual(issues(value('stale-body'), RECORDED.stale, 'stale'), []);
  assert.deepEqual(Object.keys(value('submission')).sort(), ['message', 'planId', 'requests', 'submissionId']);
});

test('no em dashes in any copy the view model produces', () => {
  const texts = [];
  for (const name of Object.keys(FIXTURE_VALUES).filter((n) => !['submission', 'stale-body'].includes(n))) texts.push(JSON.stringify(view(name)));
  texts.push(JSON.stringify(staleView(planOutcome(409, value('stale-body')))), JSON.stringify(PLAN_MESSAGES));
  for (const text of texts) assert.ok(!text.includes('—'), text.slice(0, 80));
});

test('the view reads the values recorded from the live server, including an infeasible baseline', () => {
  const preview = toPlanView(RECORDED.preview.value);
  assert.deepEqual([preview.kind, preview.alternatives[0].label, preview.alternatives[0].status], ['preview', 'No new orders', 'infeasible']);
  assert.match(preview.alternatives[0].summary, /^Not possible inside these limits: .* minimum\.$/);
  assert.equal(preview.versions.forecast.label, 'Expressed demand');
  assert.deepEqual(preview.limits.map((g) => g.key), RECORDED.preview.value.presentation.editableKeys);
  assert.equal(toPlanView(RECORDED.replanned.value).submission.status, 'replanned');
  const bad = toPlanView(RECORDED.infeasible.value);
  assert.deepEqual([bad.kind, bad.action], ['infeasible', 'No plan meets these limits']); assert.ok(bad.conflicts.length && bad.conflicts.every((c) => c.label && c.detail));
  assert.ok(!bad.conflicts.some((c) => /minor units/.test(c.detail)));
});
