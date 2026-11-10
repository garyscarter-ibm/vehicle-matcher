// Data layer for Greg's order plan panel (FUCQ-121): HTTP adapter, view model and fixtures. No DOM, no port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planOutcome, createOrderPlanHttpAdapter, PLAN_MESSAGES } from '../../blocks/gcsp/greg/plan/http-adapter.js';
import { createGregHttpAdapter } from '../../blocks/gcsp/greg/http-adapter.js';
import { toPlanView, toChanges, staleView, trivialMinimum, requestedLimitText, PlanViewError } from '../../blocks/gcsp/greg/plan/plan-view.js';
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
  assert.deepEqual([noOrder.action, noOrder.canSubmit], ['No new order recommended', false]);
  const bad = toPlanView(value('infeasible'));
  assert.deepEqual([bad.kind, bad.preview, bad.action, bad.canSubmit, bad.lines, bad.alternatives, bad.coverage, bad.spend], ['infeasible', true, 'No plan meets these limits', false, [], [], null, null]);
  assert.deepEqual(bad.conflicts.map((c) => [c.label, c.detail]), [['Budget', 'Spend £62,000 is over the £50,000 budget.'], ['i5 Touring minimum', 'Minimum 1.']]);
  const sent = view('submitted');
  assert.deepEqual([sent.kind, sent.submission.status, sent.submission.after, sent.submission.submittedAtLabel], ['ready', 'submitted', null, '5 Nov 2026, 09:00 GMT']);
  assert.deepEqual(sent.submission.requests.map((r) => [r.derivativeId, r.name, r.quantity, r.state, r.stateLabel]),
    [['g21-touring-320i', '3 Series Touring 320i', 2, 'requested', 'Requested'], ['g61-i5-40', 'i5 Touring eDrive40 M Sport Pro with Technology Plus and Comfort Packs', 1, 'requested', 'Requested']]);
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
  assert.deepEqual(all.changed.map((c) => c.label), ['Production requests and supply', 'Limits and rules', 'Clock', 'Demand forecast', 'Employee group', 'Vehicle catalogue', 'Odd key', 'The plan itself']);
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

test('unmatched supply from several lots with the same source label shows as one row', () => {
  const v = value('ready'); const sources = v.plan.unallocatedStockRisk.bySource;
  v.plan.unallocatedStockRisk.bySource = [{ sourceId: 'stock:a', quantity: 1 }, { sourceId: 'stock:b', quantity: 1 }, ...sources];
  const rows = toPlanView(v).unallocatedRisk.sources;
  assert.deepEqual(rows.filter((s) => s.label === 'Vehicle already in stock').map((s) => s.quantity), [2]);
  assert.equal(rows.length, sources.length + 1);
});

test('a 401 with no status (lapsed access key) reads access-required; a status keeps its refusal', async () => {
  const respond = (status, body) => async () => ({ status, json: async () => { if (body === undefined) throw new SyntaxError('bad'); return body; } });
  for (const body of [{ error: 'Unauthorized' }, undefined, null]) assert.deepEqual(planOutcome(401, body), { status: 'access-required' });
  for (const body of [{ error: 'Unauthorized' }, undefined]) {
    const adapter = createOrderPlanHttpAdapter({ fetchImpl: respond(401, body) });
    assert.deepEqual(await adapter.readPlan(), { status: 'access-required' }); assert.deepEqual(await adapter.previewPlan({ changes: [] }), { status: 'access-required' });
  }
  assert.deepEqual(planOutcome(403, { error: 'Forbidden' }), { status: 'refused', message: PLAN_MESSAGES.refused });
  assert.deepEqual(planOutcome(401, { status: 'missing-session' }), { status: 'refused', message: PLAN_MESSAGES.refused });
});

// ---------- FUCQ-123: learned alternative ----------
test('toPlanView maps an available learned result into rows, evaluation and model facts, in the presentation names', () => {
  const l = view('learned').learned;
  assert.deepEqual([l.status, l.label, l.comparable, l.changedCount], ['available', 'Learned model', true, 5]);
  const byName = Object.fromEntries(l.rows.map((r) => [r.name, r]));
  assert.deepEqual([byName['3 Series Saloon 320i'].baseline, byName['3 Series Saloon 320i'].learned, byName['3 Series Saloon 320i'].difference, byName['3 Series Saloon 320i'].changed], ['0', '1', '+1', true]);
  assert.deepEqual([byName['3 Series Touring 320i'].difference, byName['3 Series Touring 320i'].changed], ['-1', true]);
  const i5 = l.rows.find((r) => r.name.startsWith('i5 Touring eDrive40 M Sport Pro')); assert.deepEqual([i5.difference, i5.changed], ['No change', false]);
  assert.deepEqual([byName['Vehicles ordered'].difference, byName['Employees covered'].difference, byName['Unmet needs'].difference], ['No change', '+1', '-1']);
  assert.deepEqual([byName.Spend.baseline, byName.Spend.learned, byName.Spend.difference], ['£146,000', '£143,000', '-£3,000']);
  assert.deepEqual(l.rows.slice(0, 2).map((r) => r.changed), [true, true], 'changed derivatives come first');
  assert.deepEqual([l.evaluation.learned.logLoss, l.evaluation.expressed.brier, l.evaluation.fit.logLoss, l.evaluation.count, l.evaluation.thin, l.evaluation.thinClasses],
    ['0.912', '0.601', '1.086', 640, true, ['estate']]);
  assert.match(l.model.artifact, /^[0-9a-f]{12}$/); assert.deepEqual([l.model.policy, l.model.data], ['gcsp-policy-v1', 'synthetic']);
  assert.equal(l.limitations.length, 2);
});

test('toPlanView maps fallback and unavailable results with their limitation verbatim and coverage', () => {
  const none = view('ready').learned; const raw = value('ready').learned;
  assert.deepEqual([none.status, none.reason, none.limitation, none.coverage], ['fallback', 'no-active-model', raw.limitation, null]);
  const out = view('learned-coverage').learned; assert.deepEqual([out.reason, out.coverage], ['outside-coverage', { cohorts: ['G8-10'], vehicleClasses: ['unknown'] }]);
  assert.equal(out.limitation, value('learned-coverage').learned.limitation);
  const v = value('ready'); v.learned = { status: 'unavailable', label: 'Learned model', reason: 'x', limitation: 'Gone.' };
  assert.deepEqual([toPlanView(v).learned.status, toPlanView(v).learned.limitation], ['unavailable', 'Gone.']);
  v.learned = { status: 'mystery' }; assert.equal(toPlanView(v).learned.status, 'unavailable'); assert.match(toPlanView(v).learned.limitation, /only the baseline plan is shown/);
  v.learned = { status: 'fallback', reason: 'r', limitation: '' }; assert.match(toPlanView(v).learned.limitation, /only the baseline plan is shown/);
});

test('an absent learned field maps to null and leaves every other view field unchanged', () => {
  const v = value('ready'); const before = toPlanView(v); delete v.learned;
  const after = toPlanView(v); assert.equal(after.learned, null);
  assert.deepEqual({ ...before, learned: null }, after);
  const a = value('learned'); const withLearned = toPlanView(a); a.learned = learnedFallbackFor(); assert.deepEqual({ ...withLearned, learned: null }, { ...toPlanView(a), learned: null });
});
function learnedFallbackFor() { return value('ready').learned; }

test('an uncomparable learned result has no rows, and a result without metrics has no evaluation', () => {
  const v = value('learned'); v.learned.differences = { comparable: false, derivatives: [] }; v.learned.forecast.evaluation = {};
  const l = toPlanView(v).learned; assert.deepEqual([l.comparable, l.rows, l.evaluation], [false, [], null]);
});

test('the learned fixtures reach the adapter by name and the learned preview carries an available result', async () => {
  for (const name of ['learned', 'learned-coverage']) assert.ok(FIXTURE_NAMES.includes(name));
  assert.equal((await planFixtureAdapter('learned').previewPlan()).value.learned.status, 'available');
  assert.equal((await planFixtureAdapter('ready').previewPlan()).value.learned.status, 'fallback');
  for (const name of ['learned', 'learned-coverage']) assert.equal(JSON.stringify(value(name)).includes('—'), false);
});

test('after a request the headline counts the requested vehicles, not the plan under the active limits (FUCQ-290)', () => {
  const same = view('submitted');
  assert.equal(same.action, '3 vehicles requested from Production'); assert.equal(same.recommendation, null, 'the plan orders what was requested');
  const none = view('requested-no-order');
  assert.deepEqual([none.action, none.recommendation, none.orderQuantity, none.canSubmit, none.submission.status], ['2 vehicles requested from Production', null, 0, false, 'submitted']);
  const one = value('requested-no-order'); one.replan.requests[0].quantity = 1;
  assert.equal(toPlanView(one).action, '1 vehicle requested from Production');
  const differs = value('submitted'); differs.replan.requests = differs.replan.requests.slice(0, 1);
  const other = toPlanView(differs);
  assert.equal(other.action, '2 vehicles requested from Production');
  assert.equal(other.recommendation, 'Under the current limits the plan recommends 3 vehicles: 2 × 3 Series Touring 320i, 1 × i5 Touring eDrive40 M Sport Pro with Technology Plus and Comfort Packs.');
  // A Production response replans: the plan's own headline returns, and a preview never shows the request.
  assert.match(view('replanned').action, /^Order /);
  const previewing = value('preview'); previewing.replan = value('submitted').replan;
  assert.equal(toPlanView(previewing).submission, null); assert.match(toPlanView(previewing).action, /^Order /);
});

const setBound = (v, key, id, patch) => { v.plan.policyProvenance.find((p) => p.key === key).value.find((b) => (b.derivativeId ?? b.modelId) === id).min = patch; return v; };

test('binding constraints leave out a minimum of 0 and keep every real limit', () => {
  assert.deepEqual(view('ready').binding.map((c) => c.id), ['derivative:g61-i5-40:max', 'model:g61-i5:max']);
  assert.deepEqual(view('requested-no-order').binding, []);
  const real = setBound(value('ready'), 'orderPlan.derivativeBounds', 'g21-touring-320i', 2);
  real.plan.bindingConstraints = [{ id: 'derivative:g21-touring-320i:min', detail: 'Quantity meets minimum 2.' },
    { id: 'model:g20-saloon:min', detail: 'Quantity meets minimum 0.' }, { id: 'budget', detail: 'Order spend meets the budget.' },
    { id: 'derivative:g20-saloon-330e:max', detail: 'Quantity meets maximum 0.' }];
  assert.deepEqual(toPlanView(real).binding.map((c) => c.id), ['derivative:g21-touring-320i:min', 'budget', 'derivative:g20-saloon-330e:max']);
});

test('a minimum is trivial from the plan\'s own bounds, whatever the solver text says (FUCQ-314)', () => {
  const plan = setBound(setBound(value('ready'), 'orderPlan.derivativeBounds', 'g21-touring-320i', 2), 'orderPlan.modelBounds', 'g61-i5', 1).plan;
  const min = (id, detail = 'Quantity meets minimum 0.') => trivialMinimum({ id, detail }, plan);
  assert.equal(min('derivative:g20-saloon-320i:min', 'Minimum reached.'), true, 'min 0 is hidden even when the text differs');
  assert.equal(min('model:g20-saloon:min'), true);
  assert.equal(min('derivative:g21-touring-320i:min'), false, 'a real minimum of 2 is kept, even with the old text');
  assert.equal(min('model:g61-i5:min'), false);
  assert.equal(min('derivative:unknown:min'), false, 'no matching bound: kept');
  assert.equal(trivialMinimum({ id: 'derivative:g20-saloon-320i:min' }, { policyProvenance: [] }), false);
  assert.equal(min('derivative:g20-saloon-320i:max'), false); assert.equal(min('budget'), false); assert.equal(min('lead-time:g20-saloon-320i'), false);
});

test('requestedLimitText names each requested limit that differs from the plan in force and skips what it cannot read (FUCQ-314)', () => {
  const { limits } = view('ready'); const bounds = (key, edit) => ({ key, value: clone(value('ready').plan.policyProvenance.find((p) => p.key === key).value).map(edit) });
  const derivative = bounds('orderPlan.derivativeBounds', (b) => (b.derivativeId === 'g20-saloon-320i' ? { ...b, min: 2 } : b));
  const model = bounds('orderPlan.modelBounds', (b) => (b.modelId === 'g20-saloon' ? { ...b, max: 5 } : b));
  assert.deepEqual(requestedLimitText([derivative, model, { key: 'orderPlan.budgetMinor', value: 12000000 }], limits),
    ['3 Series Saloon 320i minimum 2', '3 Series Saloon maximum 5', 'Order budget £120,000']);
  assert.deepEqual(requestedLimitText([bounds('orderPlan.derivativeBounds', (b) => b)], limits), [], 'nothing differs');
  assert.deepEqual(requestedLimitText([{ key: 'orderPlan.derivativeBounds', value: [{ derivativeId: 'gone', min: 2, max: 3 }, { derivativeId: 'g20-saloon-320i', min: 'x', max: null }, null] },
    { key: 'orderPlan.budgetMinor', value: 'x' }, { key: 'other.key', value: 1 }, null], limits), []);
  assert.deepEqual(requestedLimitText(undefined, limits), []); assert.deepEqual(requestedLimitText([derivative], undefined), []);
});

test('a submission carries the requested changes; older snapshots give none (FUCQ-314)', () => {
  const v = view('submitted'); assert.equal(v.submission.status, 'submitted');
  assert.deepEqual(v.submission.changes, value('submitted').replan.changes);
  assert.deepEqual(requestedLimitText(v.submission.changes, v.limits), ['3 Series Touring 320i minimum 2']);
  const old = value('submitted'); delete old.replan.changes; assert.deepEqual(toPlanView(old).submission.changes, []);
  assert.deepEqual(view('replanned').submission.changes, value('replanned').replan.changes);
});
