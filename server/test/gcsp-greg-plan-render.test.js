// FUCQ-121: Greg's order plan panel states, editing, preview, submit, stale handling, element and dashboard mounting (jsdom, no port).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let panel; let fixtures; let adapterMod; let gallery; let element; let dash;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { for (let i = 0; i < 4; i += 1) await tick(); };
before(async () => {
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException', 'MutationObserver']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key] ?? globalThis[key], configurable: true, writable: true });
  }
  panel = await import('../../blocks/gcsp/greg/plan/panel.js');
  fixtures = await import('../../blocks/gcsp/greg/plan/fixtures.js');
  adapterMod = await import('../../blocks/gcsp/greg/plan/http-adapter.js');
  gallery = await import('../../blocks/gcsp/greg/plan/gallery.js');
  element = await import('../../blocks/gcsp/greg/plan/element.js');
  dash = await import('../../blocks/gcsp/greg/gcsp-greg.js');
});
beforeEach(() => document.body.replaceChildren());

const host = () => { const node = document.createElement('div'); node.className = 'gcsp'; document.body.append(node); return node; };
const buttons = (root) => [...root.querySelectorAll('button')];
const action = (root, text) => buttons(root).find((b) => b.textContent === text);
const requestButton = (root) => buttons(root).find((b) => b.textContent.startsWith('Request '));
const state = (root) => root.querySelector('.gcsp-plan').dataset.state;
const edit = (input, value) => { input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
const group = (root, title) => [...root.querySelectorAll('.gcsp-plan-group')].find((g) => g.querySelector('h4')?.textContent === title);
const limit = (root, title, i = 0) => {
  const row = group(root, title).querySelectorAll('.gcsp-plan-limit')[i];
  const [min, max] = row.querySelectorAll('input[type="number"]');
  return { row, min, max, slider: row.querySelector('input[type="range"]') };
};
const text = (root) => root.textContent.replace(/\s+/g, ' ');

// Wraps a fixture adapter so tests can read the calls and override single methods.
function spy(name, overrides = {}) {
  const inner = fixtures.planFixtureAdapter(name); const calls = { read: 0, preview: [], submit: [] };
  const adapter = {
    readPlan: (o) => { calls.read += 1; return inner.readPlan(o); },
    previewPlan: (o) => { calls.preview.push(structuredClone(o.changes)); return inner.previewPlan(o); },
    submitPlan: (o) => { calls.submit.push({ commandId: o.commandId, planId: o.planId, versions: o.versions, changes: o.changes }); return inner.submitPlan(o); },
    ...overrides,
  };
  return { adapter, calls };
}
async function mount(name, options = {}, overrides = {}) {
  const { adapter, calls } = spy(name, overrides); const root = host();
  const teardown = panel.mountGregOrderPlan(root, { adapter, commandId: () => 'cmd-1', ...options });
  await settle(); return { root, teardown, calls };
}
const valueOf = (name) => fixtures.FIXTURE_VALUES[name]();
const staticAdapter = (make) => ({ readPlan: async () => adapterMod.planOutcome(200, { status: 'ok', value: make() }), previewPlan: async () => ({ status: 'unavailable', message: 'x' }), submitPlan: async () => ({ status: 'unavailable', message: 'x' }) });

test('ready leads with the action, the versions and the proposed order with long names intact', async () => {
  const { root } = await mount('ready');
  assert.equal(state(root), 'ready');
  const h = root.querySelector('.gcsp-plan-top h2');
  assert.match(h.textContent, /^Order 3 vehicles: 2 × 3 Series Touring 320i, 1 × i5 Touring eDrive40 M Sport Pro with Technology Plus and Comfort Packs$/);
  assert.equal(root.querySelector('.gcsp-plan-top .vm-kicker').textContent, 'Next order');
  assert.equal(root.querySelector('.gcsp-plan-top').firstElementChild.contains(h), true);
  const facts = text(root.querySelector('.gcsp-plan-facts'));
  assert.match(facts, /Forecast source\s*Expressed demand \(deterministic baseline\)/); assert.match(facts, /Policy version\s*gcsp-policy-v1/); assert.match(facts, /Plan for\s*5 Nov 2026/);
  const order = [...root.querySelectorAll('table')].find((t) => t.caption.textContent === 'Proposed order');
  const rows = [...order.tBodies[0].rows].map((r) => [...r.cells].map((c) => c.textContent));
  assert.deepEqual(rows[0], ['3 Series Touring', '320i', '2']); assert.ok(rows[1][1].startsWith('eDrive40 M Sport Pro with Technology Plus')); assert.equal(rows.at(-1)[2], '0');
  assert.ok([...root.querySelectorAll('table')].some((t) => t.caption.textContent === 'Order totals by model'));
  const tiles = [...root.querySelectorAll('.gcsp-tile')].map((t) => t.textContent);
  assert.equal(tiles.length, 3); assert.match(tiles[0], /Acceptable coverage before renewal3 of 4/); assert.match(tiles[1], /Unallocated-stock risk1 vehicle/); assert.match(tiles[2], /Spend£/);
  assert.match(text(root), /Unmet needs/); assert.match(text(root), /Renewal on 15 Feb 2027/);
  assert.ok(root.querySelectorAll('.gcsp-plan-need li').length >= 2);
  const binding = [...root.querySelectorAll('table')].find((t) => t.caption.textContent === 'Binding constraints');
  assert.ok(binding.tBodies[0].rows.length >= 1);
  const alternatives = [...root.querySelectorAll('table')].find((t) => t.caption.textContent === 'Alternative plans');
  assert.ok(alternatives.tBodies[0].rows.length >= 1); assert.match(alternatives.textContent, /No new orders/);
  assert.equal(root.querySelector('.gcsp-plan-message').getAttribute('role'), 'status');
});

test('the alternative identical to the recommendation is marked', async () => {
  const value = valueOf('ready'); value.plan.alternatives[1].identicalToRecommendation = true;
  const root = host(); panel.mountGregOrderPlan(root, { adapter: staticAdapter(() => value) }); await settle();
  assert.match(text(root), /Next best plan.*Same as the recommendation/); assert.match(text(root), /No new orders.*Different/);
});

test('loading is busy with a status line, then clears', async () => {
  const { root } = await mount('loading');
  assert.equal(state(root), 'loading'); assert.equal(root.querySelector('.gcsp-plan').getAttribute('aria-busy'), 'true');
  assert.match(root.querySelector('[role="status"]').textContent, /Loading the order plan/); assert.equal(root.querySelector('table'), null);
  const ok = await mount('ready'); assert.equal(ok.root.querySelector('.gcsp-plan').getAttribute('aria-busy'), 'false');
});

test('no demand still shows versions and limits, with nothing to request', async () => {
  const { root } = await mount('no-demand');
  assert.equal(state(root), 'no-demand'); assert.match(root.querySelector('h2').textContent, /No saved demand to plan for yet/);
  assert.match(text(root), /Forecast source/); assert.ok(root.querySelectorAll('input[type="number"]').length > 0);
  assert.equal(root.querySelector('.gcsp-tile'), null); assert.equal(action(root, 'Request from Production').disabled, true);
});

test('editing a derivative bound and previewing sends the changed limits, then shows the preview', async () => {
  const { root, calls } = await mount('preview');
  const row = limit(root, 'Derivative limits', 0); assert.equal(row.max.value, '3');
  edit(row.max, '1'); action(root, 'Preview with these limits').click(); await settle();
  assert.deepEqual(calls.preview, [[{ key: 'orderPlan.derivativeBounds', value: [
    { derivativeId: 'g20-saloon-320i', min: 0, max: 1 }, { derivativeId: 'g20-saloon-330e', min: 0, max: 2 },
    { derivativeId: 'g21-touring-320i', min: 0, max: 3 }, { derivativeId: 'g61-i5-40', min: 0, max: 2 }] }]]);
  assert.equal(state(root), 'preview'); assert.equal(root.querySelector('.gcsp-plan-top .vm-kicker').textContent, 'Preview');
  const banner = root.querySelector('.gcsp-plan-banner.is-preview'); assert.match(banner.textContent, /Preview only\. Nothing is saved, published or ordered\./);
  const diff = [...root.querySelectorAll('table')].find((t) => t.caption.textContent === 'Differences from the current plan');
  assert.match(diff.textContent, /Derivative.*Current.*Preview.*Change/); assert.match(diff.textContent, /3 Series Touring 320i2 *1-1/);
  assert.ok([...root.querySelectorAll('table')].some((t) => t.caption.textContent === 'Outcome before and after'));
  assert.equal(document.activeElement, root.querySelector('.gcsp-plan-top h2'));
  assert.ok(requestButton(root), 'the preview can still be requested');
  action(root, 'Back to current plan').click();
  assert.equal(state(root), 'ready'); assert.equal(root.querySelector('.gcsp-plan-banner.is-preview'), null);
});

test('a slider follows each derivative maximum both ways', async () => {
  const { root } = await mount('ready');
  const row = limit(root, 'Derivative limits', 1); assert.ok(row.slider); assert.equal(row.slider.value, '2');
  row.slider.value = '5'; row.slider.dispatchEvent(new window.Event('input', { bubbles: true })); assert.equal(row.max.value, '5');
  edit(row.max, '7'); assert.equal(row.slider.value, '7');
  assert.equal(limit(root, 'Model limits', 0).slider, null);
  edit(row.max, '99'); assert.equal(row.slider.disabled, true);
});

test('invalid limits are stopped on the client with a linked summary and nothing is sent', async () => {
  const { root, calls } = await mount('preview');
  const row = limit(root, 'Derivative limits', 0);
  edit(row.min, '5'); edit(row.max, '2'); action(root, 'Preview with these limits').click(); await settle();
  assert.equal(calls.preview.length, 0);
  const summary = root.querySelector('.gcsp-error-summary'); assert.equal(summary.hidden, false); assert.match(summary.textContent, /minimum is higher than the maximum/);
  assert.equal(row.max.getAttribute('aria-invalid'), 'true'); summary.querySelector('a').click(); assert.equal(document.activeElement, row.max);
  edit(row.min, '1.5'); edit(row.max, '3'); action(root, 'Preview with these limits').click(); await settle();
  assert.match(root.querySelector('.gcsp-error-summary').textContent, /enter a whole number/); assert.equal(calls.preview.length, 0);
  edit(row.min, ''); action(root, 'Preview with these limits').click(); await settle(); assert.equal(calls.preview.length, 0);
  action(root, 'Reset limits').click();
  assert.equal(limit(root, 'Derivative limits', 0).min.value, '0'); assert.equal(limit(root, 'Derivative limits', 0).max.value, '3');
});

test('no changes asks for a change, and the budget is edited in pounds', async () => {
  const { root, calls } = await mount('preview');
  action(root, 'Preview with these limits').click(); await settle();
  assert.equal(calls.preview.length, 0); assert.match(root.querySelector('.gcsp-plan-message').textContent, /Change at least one limit/);
  const budget = root.querySelector('input[id$="budget"]'); assert.equal(budget.value, '200000'); assert.match(budget.labels[0].textContent, /pounds/);
  edit(budget, '150000'); action(root, 'Preview with these limits').click(); await settle();
  assert.deepEqual(calls.preview[0], [{ key: 'orderPlan.budgetMinor', value: 15000000 }]);
});

test('an infeasible preview lists the conflicts and cannot be requested', async () => {
  const { root } = await mount('infeasible');
  edit(limit(root, 'Model limits', 0).max, '2'); action(root, 'Preview with these limits').click(); await settle();
  assert.equal(state(root), 'infeasible'); assert.match(root.querySelector('h2').textContent, /No plan meets these limits/);
  const alert = root.querySelector('[role="alert"]'); assert.match(alert.textContent, /Budget.*Spend £62,000 is over the £50,000 budget/); assert.match(alert.textContent, /minimum/);
  assert.equal(action(root, 'Request from Production').disabled, true);
  assert.equal(root.querySelector('table'), null);
});

test('submit is its own button, sends the plan, versions and changes, and reuses its command id on retry', async () => {
  let attempt = 0; const ids = []; let made = 0; let submitted = 0;
  const { root, calls } = await mount('ready', { commandId: () => `cmd-${++made}`, onSubmitted: () => { submitted += 1; } }, {
    submitPlan: async (o) => { ids.push(o.commandId); attempt += 1; return attempt === 1 ? { status: 'unavailable', message: 'Production did not answer.' } : adapterMod.planOutcome(200, { status: 'ok', value: valueOf('submission') }); },
  });
  const request = requestButton(root); assert.equal(request.textContent, 'Request 3 vehicles from Production'); assert.equal(request.disabled, false);
  assert.equal(request.closest('.gcsp-plan-editor'), null); assert.equal(request.classList.contains('vm-btn-primary'), true);
  assert.match(root.querySelector('.gcsp-plan-consequence').textContent, /Nothing is ordered until Production confirms/);
  assert.equal(request.getAttribute('aria-describedby'), root.querySelector('.gcsp-plan-consequence').id);
  request.click(); await settle();
  assert.equal(submitted, 0); assert.match(root.querySelector('.gcsp-plan-message').textContent, /Production did not answer\. Your request is kept/);
  requestButton(root).click(); await settle();
  assert.deepEqual(ids, ['cmd-1', 'cmd-1']); assert.equal(made, 1); assert.equal(submitted, 1);
  assert.equal(root.querySelector('.gcsp-plan-message').textContent, '', 'the notice and headline carry the message, not the status line');
  assert.equal(calls.read, 2, 'the plan reloads after a submission');
});

test('submitting from a preview sends the previewed changes', async () => {
  const { root, calls } = await mount('preview');
  edit(limit(root, 'Derivative limits', 2).max, '1'); action(root, 'Preview with these limits').click(); await settle();
  requestButton(root).click(); await settle();
  assert.equal(calls.submit[0].planId, 'order-plan-preview001'); assert.equal(calls.submit[0].changes[0].key, 'orderPlan.derivativeBounds');
  assert.equal(calls.submit[0].versions.policy, 'preview-fixture0001');
});

test('after a request, Change limits says the requested limit is with Production and still shows the plan in force (FUCQ-314)', async () => {
  let sent = null; let reads = 0;
  const { root } = await mount('preview', {}, {
    readPlan: async () => { reads += 1; const v = valueOf(sent ? 'submitted' : 'ready'); if (sent) v.replan.changes = sent; return adapterMod.planOutcome(200, { status: 'ok', value: v }); },
    previewPlan: async (o) => { const v = valueOf('preview'); v.changes = o.changes; return adapterMod.planOutcome(200, { status: 'ok', value: v }); },
    submitPlan: async (o) => { sent = structuredClone(o.changes); return adapterMod.planOutcome(200, { status: 'ok', value: valueOf('submission') }); },
  });
  edit(limit(root, 'Derivative limits', 2).min, '2'); action(root, 'Preview with these limits').click(); await settle();
  requestButton(root).click(); await settle();
  assert.equal(reads, 2); assert.equal(sent[0].value[2].min, 2); assert.equal(state(root), 'submitted');
  const body = root.querySelector('.gcsp-plan-editor-body');
  assert.equal(text(body.firstElementChild), 'The limits below are the plan in force. Your request for 3 Series Touring 320i minimum 2 is with Production.');
  assert.equal(limit(root, 'Derivative limits', 2).min.value, '0', 'the editor keeps the plan in force');
  action(root, 'Reset limits').click(); assert.match(text(root.querySelector('.gcsp-plan-editor-body').firstElementChild), /is with Production\.$/);
  assert.equal(limit(root, 'Derivative limits', 2).min.value, '0');
});

test('Change limits adds no requested-limit note before a request, without readable changes, or after Production responds', async () => {
  const noteIn = (root) => /is with Production/.test(text(root.querySelector('.gcsp-plan-editor')));
  assert.equal(noteIn((await mount('ready')).root), false);
  const bare = host(); const old = valueOf('submitted'); delete old.replan.changes;
  panel.mountGregOrderPlan(bare, { adapter: staticAdapter(() => old) }); await settle();
  assert.equal(state(bare), 'submitted'); assert.equal(noteIn(bare), false);
  const same = host(); const none = valueOf('submitted'); none.replan.changes = [{ key: 'orderPlan.derivativeBounds', value: 'unreadable' }, { key: 'orderPlan.budgetMinor', value: 'x' }];
  panel.mountGregOrderPlan(same, { adapter: staticAdapter(() => none) }); await settle(); assert.equal(noteIn(same), false);
  const replanned = await mount('replanned'); assert.equal(noteIn(replanned.root), false);
  assert.equal(noteIn((await mount('submitted')).root), true);
});

test('a stale plan shows what changed and replans on request', async () => {
  const { root, calls } = await mount('stale');
  requestButton(root).click(); await settle();
  assert.equal(state(root), 'stale');
  const alert = root.querySelector('[role="alert"]'); assert.match(alert.textContent, /Replan needed/); assert.match(alert.textContent, /Stock/); assert.match(alert.textContent, /The plan itself/);
  assert.equal(document.activeElement, alert.querySelector('h3')); assert.equal(requestButton(root).disabled, true);
  action(root, 'Replan with the latest inputs').click(); await settle();
  assert.equal(calls.read, 2); assert.equal(state(root), 'ready'); assert.equal(root.querySelector('[role="alert"]'), null);
});

test('replanning a stale preview runs the same preview again', async () => {
  const { root, calls } = await mount('stale');
  edit(limit(root, 'Derivative limits', 0).max, '1'); action(root, 'Preview with these limits').click(); await settle();
  requestButton(root).click(); await settle(); assert.equal(state(root), 'stale');
  action(root, 'Replan with the latest inputs').click(); await settle();
  assert.equal(calls.preview.length, 2); assert.deepEqual(calls.preview[0], calls.preview[1]); assert.equal(state(root), 'preview');
});

test('submitted and replanned plans say so, and a submitted plan is not requested again', async () => {
  const submitted = await mount('submitted');
  assert.equal(state(submitted.root), 'submitted'); assert.match(text(submitted.root.querySelector('.gcsp-plan-banner')), /^Requested at 5 Nov 2026, 09:00 GMT\. Production has not confirmed anything yet\.\s*See this request in Order requests$/);
  assert.equal(requestButton(submitted.root).disabled, true); assert.equal(submitted.root.querySelector('.gcsp-plan-consequence'), null);
  assert.equal(submitted.root.querySelector('.gcsp-plan-top table, .gcsp-plan-content table[data-requests]'), null);
  const replanned = await mount('replanned');
  assert.equal(state(replanned.root), 'replanned');
  assert.match(text(replanned.root.querySelector('.gcsp-plan-banner')), /Replanned after Production partly confirmed 1 vehicle at .*2026/);
});

test('refused shows no figures or editor and unavailable offers Retry', async () => {
  const refused = await mount('refused');
  assert.equal(state(refused.root), 'refused'); assert.equal(refused.root.querySelector('[role="alert"]').textContent.includes('Only the scheme ordering lead'), true);
  assert.equal(refused.root.querySelector('table, input, .gcsp-tile'), null); assert.equal(buttons(refused.root).length, 0);
  const down = await mount('unavailable');
  assert.equal(state(down.root), 'unavailable'); assert.ok(down.root.querySelector('[role="alert"]')); assert.equal(down.root.querySelector('table, input'), null);
  action(down.root, 'Retry').click(); await settle(); assert.equal(down.calls.read, 2);
});

test('server invalid reasons show in the summary and a failed refresh keeps the plan', async () => {
  const { root } = await mount('ready', {}, { previewPlan: async () => ({ status: 'invalid', code: 'x', reasons: [{ field: 'changes', reason: 'Greg cannot edit that limit.' }], message: 'Greg cannot edit that limit.' }) });
  edit(limit(root, 'Derivative limits', 0).max, '1'); action(root, 'Preview with these limits').click(); await settle();
  assert.match(root.querySelector('.gcsp-error-summary').textContent, /Greg cannot edit that limit\./);
  let reads = 0;
  const kept = await mount('ready', {}, { readPlan: async () => { reads += 1; return reads === 1 ? adapterMod.planOutcome(200, { status: 'ok', value: valueOf('ready') }) : { status: 'unavailable', message: 'Offline.' }; } });
  kept.teardown.refresh(); await settle();
  assert.ok(kept.root.querySelector('table')); assert.match(kept.root.querySelector('.gcsp-plan-message').textContent, /Offline\./);
});

test('answers that arrive after teardown or a newer request are ignored, and buttons lock while busy', async () => {
  let release; const first = new Promise((resolve) => { release = resolve; });
  const root = host(); let reads = 0;
  const adapter = { ...fixtures.planFixtureAdapter('ready'), readPlan: async () => { reads += 1; if (reads === 1) { await first; return adapterMod.planOutcome(200, { status: 'ok', value: valueOf('submitted') }); } return adapterMod.planOutcome(200, { status: 'ok', value: valueOf('ready') }); } };
  const teardown = panel.mountGregOrderPlan(root, { adapter }); teardown.refresh(); await settle();
  release(); await settle(); assert.equal(state(root), 'ready', 'the older answer was dropped');
  const slow = host(); let free; const gate = new Promise((resolve) => { free = resolve; });
  const t2 = panel.mountGregOrderPlan(slow, { adapter: { ...fixtures.planFixtureAdapter('ready'), previewPlan: async () => { await gate; return adapterMod.planOutcome(200, { status: 'ok', value: valueOf('preview') }); } } }); await settle();
  edit(limit(slow, 'Derivative limits', 0).max, '1'); action(slow, 'Preview with these limits').click();
  assert.equal(action(slow, 'Preview with these limits').disabled, true); assert.equal(requestButton(slow).disabled, true); assert.equal(slow.querySelector('input[type="number"]').disabled, true);
  t2(); free(); await settle(); assert.equal(slow.children.length, 0);
});

test('every state has no em dashes, inline handlers or scripts, and sends no figures from the client', async () => {
  for (const name of fixtures.FIXTURE_NAMES) {
    const { root } = await mount(name);
    if (['preview', 'infeasible', 'stale'].includes(name)) {
      if (name === 'stale') requestButton(root).click(); else { edit(limit(root, 'Model limits', 0).max, '1'); action(root, 'Preview with these limits').click(); }
      await settle();
    }
    const html = root.innerHTML;
    assert.ok(!html.includes('—'), `${name} has an em dash`); assert.ok(!/\son[a-z]+\s*=/i.test(html), `${name} has an inline handler`); assert.ok(!/<script/i.test(html));
  }
});

test('driveToState reaches the driven states for the gallery and harness', async () => {
  for (const name of ['preview', 'infeasible', 'stale']) {
    const root = host(); panel.mountGregOrderPlan(root, { adapter: fixtures.planFixtureAdapter(name) }); gallery.driveToState(root, name); await tick(150);
    assert.equal(state(root), name);
  }
  const example = gallery.gregOrderPlanExample(); document.body.append(example); await tick(200);
  assert.deepEqual([...example.querySelectorAll('.gcsp-plan')].map((p) => p.dataset.state), ['ready', 'preview', 'ready', 'ready', 'infeasible', 'stale']);
  assert.equal(example.querySelectorAll('a[href*="plan="]').length, 12);
});

test('the custom element mounts from a fixture, takes an adapter, emits submit and tears down', async () => {
  assert.equal(element.defineGcspGregOrderPlan(window.customElements), element.defineGcspGregOrderPlan(window.customElements));
  const node = document.createElement('gcsp-greg-order-plan'); node.setAttribute('fixture', 'ready'); document.body.append(node); await settle();
  assert.ok(node.classList.contains('gcsp')); assert.equal(node.querySelector('.gcsp-plan').dataset.state, 'ready');
  const seen = []; document.body.addEventListener('gcsp:order-plan-submitted', (e) => seen.push(e.detail.submissionId));
  node.querySelector('button.vm-btn-primary').click(); await settle(); assert.deepEqual(seen, ['submission-fixture0001']);
  const bad = document.createElement('gcsp-greg-order-plan'); bad.setAttribute('fixture', 'nope'); document.body.append(bad); await settle();
  assert.equal(bad.querySelector('.gcsp-plan').dataset.state, 'unavailable');
  const direct = document.createElement('gcsp-greg-order-plan'); direct.adapter = fixtures.planFixtureAdapter('no-demand'); document.body.append(direct); await settle();
  assert.equal(direct.querySelector('.gcsp-plan').dataset.state, 'no-demand'); direct.remove(); assert.equal(direct.children.length, 0);
});

test('the dashboard mounts the plan into its prediction region, refreshes it on publication and tears it down', async () => {
  const { adapter, calls } = spy('ready'); const root = host(); let submitted = 0;
  const demand = (await import('../../blocks/gcsp/greg/fixtures.js')).fixtureAdapter('populated');
  const teardown = dash.mountGregDashboard(root, { loadDemand: demand.loadDemand, orderPlanAdapter: adapter, onOrderPlanSubmitted: () => { submitted += 1; } }); await settle();
  const region = teardown.regions.prediction;
  assert.equal(region.getAttribute('aria-label'), 'Next order plan'); assert.equal(region.hasAttribute('aria-labelledby'), false);
  assert.ok(region.querySelector('.gcsp-plan')); assert.equal(region.querySelector('.gcsp-note')?.textContent.includes('not built'), false);
  assert.deepEqual(Object.keys(teardown.regions), ['publish', 'prediction', 'orderTracking', 'routeComparison', 'caseQueue']);
  assert.equal(typeof teardown.orderPlan.refresh, 'function'); assert.equal(calls.read, 1);
  root.dispatchEvent(new window.CustomEvent('gcsp:policy-published', { bubbles: true })); await settle(); assert.equal(calls.read, 2);
  requestButton(region).click(); await settle(); assert.equal(submitted, 1);
  teardown(); assert.equal(root.children.length, 0);
  const bare = host(); const plain = dash.mountGregDashboard(bare, { loadDemand: demand.loadDemand }); await settle();
  assert.equal(plain.orderPlan, null); assert.match(plain.regions.prediction.textContent, /not built in this demo yet/); plain();
});

test('the Greg HTTP adapter exposes the order plan adapter the dashboard element passes through', async () => {
  const { createGregHttpAdapter } = await import('../../blocks/gcsp/greg/http-adapter.js');
  const adapter = createGregHttpAdapter({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(Object.keys(adapter.orderPlan).sort(), ['previewPlan', 'readPlan', 'submitPlan']);
  dash.defineGcspGregDashboard(window.customElements); const node = document.createElement('gcsp-greg-dashboard');
  node.adapter = { orderPlan: fixtures.planFixtureAdapter('ready'), loadDemand: (await import('../../blocks/gcsp/greg/fixtures.js')).fixtureAdapter('populated').loadDemand };
  document.body.append(node); await settle();
  assert.ok(node.regions.prediction.querySelector('.gcsp-plan')); node.remove();
});

test('a lapsed access key shows the compact restart notice with Reload and no Retry, on first load and over a loaded plan', async () => {
  const first = await mount('ready', {}, { readPlan: async () => ({ status: 'access-required' }) });
  assert.equal(state(first.root), 'restarted'); const alert = first.root.querySelector('[role="alert"]');
  assert.match(alert.textContent, /Reload the page to continue/); assert.deepEqual([...first.root.querySelectorAll('button')].map((b) => b.textContent), ['Reload']);
  assert.doesNotMatch(first.root.textContent, /unavailable|Retry/); first.teardown();
  let reads = 0; const later = await mount('ready', {}, { readPlan: async () => (++reads === 1 ? adapterMod.planOutcome(200, { status: 'ok', value: valueOf('ready') }) : { status: 'access-required' }) });
  assert.equal(state(later.root), 'ready'); await later.teardown.refresh(); await settle();
  assert.equal(state(later.root), 'restarted'); assert.equal(later.root.querySelector('table, input'), null);
  assert.deepEqual([...later.root.querySelectorAll('button')].map((b) => b.textContent), ['Reload']); later.teardown();
});

// ---------- FUCQ-123: the synthetic-trained model beside the recommended plan ----------
const learnedSection = (root) => [...root.querySelectorAll('section')].find((sec) => sec.querySelector('h3')?.textContent === 'Synthetic-trained model');
const learnedWith = (name, change) => { const v = valueOf(name); change(v); return v; };
const tableOf = (node, caption) => [...node.querySelectorAll('table')].find((t) => t.caption.textContent === caption);
const cells = (row) => [...row.cells].map((c) => c.textContent);

test('an available learned plan shows beside the recommended plan with differences in text and emphasis', async () => {
  const { root } = await mount('learned');
  const sec = learnedSection(root); assert.ok(sec, 'learned section');
  const h = sec.querySelector('h3'); assert.equal(h.textContent, 'Synthetic-trained model'); assert.equal(h.tabIndex, -1);
  assert.equal(sec.getAttribute('aria-labelledby'), h.id);
  assert.ok(root.querySelector('.gcsp-plan-content').lastElementChild === sec, 'after the baseline sections, before the limits editor');
  assert.match(text(sec), /For comparison only\. Only the recommended plan can be requested from Production\./);
  const table = tableOf(sec, 'Plan comparison'); assert.ok(table);
  assert.deepEqual([...table.tHead.rows[0].cells].map((c) => c.textContent), ['Vehicle or measure', 'Recommended plan', 'Synthetic-trained model', 'Difference']);
  assert.equal(table.closest('[role="region"]').tabIndex, 0);
  assert.ok(table.closest('.gcsp-table-wrap').classList.contains('is-stack'));
  assert.equal(table.tBodies[0].rows[0].cells[3].dataset.label, 'Difference');
  const rows = Object.fromEntries([...table.tBodies[0].rows].map((r) => [r.cells[0].textContent, r]));
  assert.deepEqual(cells(rows['3 Series Saloon 320i']), ['3 Series Saloon 320i', '0', '1', '+1']);
  assert.deepEqual(cells(rows['3 Series Touring 320i']), ['3 Series Touring 320i', '2', '1', '-1']);
  assert.ok(rows['3 Series Saloon 320i'].querySelector('strong'), 'a changed row is emphasised');
  assert.equal(rows['3 Series Saloon 320i'].cells[3].querySelector('strong').textContent, '+1');
  const long = [...table.tBodies[0].rows].find((r) => r.cells[0].textContent.startsWith('i5 Touring eDrive40 M Sport Pro with Technology Plus'));
  assert.deepEqual([...long.cells].slice(1).map((c) => c.textContent), ['1', '1', 'No change']); assert.equal(long.querySelector('strong'), null);
  assert.deepEqual(cells(rows['Vehicles ordered']).slice(1), ['3', '3', 'No change']);
  assert.deepEqual(cells(rows['Employees covered']).slice(1), ['3', '4', '+1']);
  assert.deepEqual(cells(rows['Unmet needs']).slice(1), ['1', '0', '-1']);
  assert.match(cells(rows.Spend).slice(1).join('|'), /^£146,000\|£143,000\|-£3,000$/);
  assert.equal([...table.tBodies[0].rows][0].querySelector('strong') !== null, true, 'changed rows come first');
});

test('the learned section gives the evaluation, model facts and limitations, and offers no button', async () => {
  const { root } = await mount('learned');
  const sec = learnedSection(root); const t = text(sec);
  assert.match(t, /Evaluation\s*Synthetic-trained; offline evaluation/);
  const tiles = [...sec.querySelectorAll('.gcsp-tile')].map((x) => x.textContent);
  assert.equal(tiles.length, 3);
  assert.match(tiles[0], /Held-out log loss0\.912Expressed demand 1\.204, Deterministic fit 1\.086\. Lower is better/);
  assert.match(tiles[1], /Held-out Brier score0\.478Expressed demand 0\.601, Deterministic fit 0\.553/);
  assert.match(tiles[2], /Held-out choices640/);
  assert.match(t, /Thin support in: estate\. Treat these scores with care\./);
  assert.match(t, /Model\s*[0-9a-f]{12}(?![0-9a-f])/); assert.match(t, /Activation policy\s*gcsp-policy-v1/); assert.match(t, /Training data\s*Synthetic/);
  assert.ok(!t.includes('sha256'), 'only the short artifact id shows');
  assert.equal(sec.querySelectorAll('.gcsp-plan-list li').length, 2); assert.match(t, /Trained on synthetic data; this does not describe validated BMW employee behaviour\./);
  assert.equal(sec.querySelector('button'), null); assert.equal(sec.querySelector('a[href], input'), null);
});

test('the Request button still sends the baseline plan only, whatever the learned plan shows', async () => {
  const { root, calls } = await mount('learned');
  const request = requestButton(root); assert.equal(request.textContent, 'Request 3 vehicles from Production'); assert.equal(learnedSection(root).contains(request), false);
  request.click(); await settle();
  assert.equal(calls.submit.length, 1); assert.equal(calls.submit[0].planId, 'order-plan-ready0001'); assert.notEqual(calls.submit[0].planId, 'order-plan-learned001');
  assert.deepEqual(calls.submit[0].versions, valueOf('learned').plan.versions); assert.deepEqual(calls.submit[0].changes, []);
});

test('no active model shows the baseline alone with the limitation verbatim and no figures', async () => {
  const { root } = await mount('ready');
  const sec = learnedSection(root); assert.ok(sec);
  assert.equal(sec.querySelector('p.gcsp-note').textContent, valueOf('ready').learned.limitation);
  assert.equal(sec.querySelector('table'), null); assert.equal(sec.querySelector('.gcsp-tile'), null); assert.equal(sec.querySelector('button'), null);
  assert.equal(sec.querySelectorAll('p').length, 1, 'the limitation is the only text');
  assert.ok(requestButton(root), 'the baseline can still be requested');
});

test('a cohort or class outside coverage shows the limitation and both coverage lists', async () => {
  const { root } = await mount('learned-coverage');
  const sec = learnedSection(root); const v = valueOf('learned-coverage');
  assert.equal(sec.querySelector('p.gcsp-note').textContent, v.learned.limitation);
  assert.match(text(sec), /Outside training coverage:/);
  assert.deepEqual([...sec.querySelectorAll('li')].map((li) => li.textContent), ['Employee cohorts: G8-10', 'Vehicle classes: unknown']);
  assert.equal(sec.querySelector('table'), null); assert.equal(sec.querySelector('.gcsp-tile'), null);
});

test('an unavailable learned result shows its limitation and an older response shows no section', async () => {
  const unavailable = learnedWith('ready', (v) => { v.learned = { status: 'unavailable', label: 'Synthetic-trained model', recommended: false, submittable: false, reason: 'learned-plan-unavailable', limitation: 'The learned forecast is unavailable right now, so only the baseline plan is shown.' }; });
  const a = host(); panel.mountGregOrderPlan(a, { adapter: staticAdapter(() => unavailable) }); await settle();
  assert.equal(learnedSection(a).querySelector('p').textContent, unavailable.learned.limitation); assert.equal(learnedSection(a).querySelector('table'), null);
  const older = learnedWith('ready', (v) => { delete v.learned; });
  const b = host(); panel.mountGregOrderPlan(b, { adapter: staticAdapter(() => older) }); await settle();
  assert.ok(!learnedSection(b)); assert.equal(state(b), 'ready');
  assert.ok(![...b.querySelectorAll('h3')].some((x) => /Synthetic/.test(x.textContent)));
});

test('plans that cannot be compared show one plain note instead of numbers', async () => {
  const value = learnedWith('learned', (v) => { v.learned.differences = { comparable: false, coverage: { baseline: null, learned: null, delta: null }, derivatives: [] }; });
  const root = host(); panel.mountGregOrderPlan(root, { adapter: staticAdapter(() => value) }); await settle();
  const sec = learnedSection(root); assert.equal(sec.querySelector('table'), null);
  assert.match(text(sec), /The plans cannot be compared because one of them has no plan inside the limits\./);
});

test('a learned plan that matches the baseline says so, with no emphasised row', async () => {
  const value = learnedWith('learned', (v) => { const d = v.learned.differences; for (const r of d.derivatives) { r.learned = r.baseline; r.delta = 0; r.changed = false; }
    for (const k of ['coverage', 'orderQuantity', 'spendMinor', 'unmetNeeds']) { d[k].learned = d[k].baseline; d[k].delta = 0; } });
  const root = host(); panel.mountGregOrderPlan(root, { adapter: staticAdapter(() => value) }); await settle();
  const sec = learnedSection(root); assert.equal(sec.querySelector('table strong'), null); assert.match(text(sec), /The synthetic-trained model gives the same plan\./);
});

test('a preview shows the learned section from the preview response, and its Request still sends the previewed baseline', async () => {
  const { root, calls } = await mount('learned');
  edit(limit(root, 'Derivative limits', 2).max, '1'); action(root, 'Preview with these limits').click(); await settle();
  assert.equal(state(root), 'preview'); const sec = learnedSection(root); assert.ok(sec); assert.ok(sec.querySelector('table'));
  requestButton(root).click(); await settle();
  assert.equal(calls.submit[0].planId, 'order-plan-preview001');
  const fallback = await mount('preview'); edit(limit(fallback.root, 'Derivative limits', 2).max, '1'); action(fallback.root, 'Preview with these limits').click(); await settle();
  assert.equal(learnedSection(fallback.root).querySelector('table'), null); assert.match(text(learnedSection(fallback.root)), /No learned model is active/);
});

test('learned states have no em dashes, inline handlers or scripts', async () => {
  for (const name of ['learned', 'learned-coverage']) {
    const { root } = await mount(name); const html = root.innerHTML;
    assert.ok(!html.includes('—') && !html.includes('–'), `${name} has a dash`); assert.ok(!/\son[a-z]+\s*=/i.test(html)); assert.ok(!/<script|style=/i.test(html));
  }
});

// FUCQ-310: one plain notice for cars the server left out of the plan, from the server's count and names.
const notice = (root) => [...root.querySelectorAll('.gcsp-plan-banner')].find((b) => b.querySelector('h3')?.textContent === 'Cars left out of this plan');
const withUnbound = (name, unboundStock) => { const value = valueOf(name); value.plan.unboundStock = unboundStock; return value; };

test('cars left out of the plan get one notice naming them, with the server count', async () => {
  const value = withUnbound('ready', { count: 2, models: ['X1 xDrive23i', '3 Series Touring'] });
  const root = host(); panel.mountGregOrderPlan(root, { adapter: staticAdapter(() => value) }); await settle();
  assert.equal(state(root), 'ready'); assert.equal(root.querySelectorAll('.gcsp-plan-banner').length, 1);
  assert.equal(notice(root).querySelector('p').textContent, "2 new cars aren't in the ordering list yet, so this plan leaves them out: X1 xDrive23i, 3 Series Touring.");
  assert.ok(!root.innerHTML.includes('—'));
  const one = host(); panel.mountGregOrderPlan(one, { adapter: staticAdapter(() => withUnbound('ready', { count: 1, models: [] })) }); await settle();
  assert.equal(notice(one).querySelector('p').textContent, "1 new car isn't in the ordering list yet, so this plan leaves it out.");
});

test('no left-out cars, or an unreadable count, shows no notice', async () => {
  for (const unboundStock of [{ count: 0, models: [] }, undefined, { count: 'many', models: ['X1'] }, null]) {
    const root = host(); panel.mountGregOrderPlan(root, { adapter: staticAdapter(() => withUnbound('ready', unboundStock)) }); await settle();
    assert.equal(state(root), 'ready'); assert.equal(notice(root), undefined);
  }
});

test('a preview shows the notice from the previewed plan', async () => {
  const preview = valueOf('preview'); preview.plan.unboundStock = { count: 3, models: ['G42 Coupe'] };
  const { root } = await mount('ready', {}, { previewPlan: async () => adapterMod.planOutcome(200, { status: 'ok', value: preview }) });
  edit(limit(root, 'Derivative limits', 2).max, '1'); action(root, 'Preview with these limits').click(); await settle();
  assert.equal(state(root), 'preview'); assert.match(notice(root).textContent, /3 new cars aren't in the ordering list yet, so this plan leaves them out: G42 Coupe\./);
});

// FUCQ-290: after a request the headline counts it, one notice remains, limits are a disclosure and focus follows each action.
const top = (root) => root.querySelector('.gcsp-plan-top');
const headline = (root) => root.querySelector('.gcsp-plan-top h2');
// Reads the ready plan until a request is sent, then the submitted plan, as the live server does.
const requestingAdapter = (after = 'submitted') => { let sent = false; return { readPlan: async () => adapterMod.planOutcome(200, { status: 'ok', value: valueOf(sent ? after : 'ready') }),
  previewPlan: async () => ({ status: 'unavailable', message: 'x' }), submitPlan: async () => { sent = true; return adapterMod.planOutcome(200, { status: 'ok', value: valueOf('submission') }); } }; };

test('after a request the headline says how many vehicles were requested, with one notice and a link to the request', async () => {
  const root = host(); const target = document.createElement('section'); target.id = 'gcsp-order-requests'; document.body.append(target);
  panel.mountGregOrderPlan(root, { adapter: requestingAdapter(), commandId: () => 'cmd-1' }); await settle();
  assert.equal(document.activeElement, document.body, 'the first load does not take focus');
  assert.match(headline(root).textContent, /^Order 3 vehicles/);
  requestButton(root).click(); await settle();
  assert.equal(state(root), 'submitted'); assert.equal(headline(root).textContent, '3 vehicles requested from Production');
  assert.equal(root.querySelector('.gcsp-plan-top .vm-kicker').textContent, 'Next order'); assert.equal(document.activeElement, headline(root));
  const link = top(root).querySelector('a'); assert.equal(link.textContent, 'See this request in Order requests'); assert.equal(link.getAttribute('href'), '#gcsp-order-requests');
  link.click(); assert.equal(document.activeElement, target, 'the link takes focus to the Order requests section');
  const all = text(root);
  assert.equal((all.match(/not confirmed/g) ?? []).length, 1, 'one message about Production');
  assert.doesNotMatch(all, /Already requested|Track it under|Order tracking|Requested\. Production/);
  assert.equal(root.querySelector('.gcsp-plan-message').textContent, ''); assert.equal(root.querySelector('.gcsp-plan-consequence'), null);
  assert.equal(requestButton(root).disabled, true); assert.equal(requestButton(root).hasAttribute('aria-describedby'), false);
});

test('a request the active limits would not order still leads with what was requested, not "No new order recommended"', async () => {
  const root = host(); panel.mountGregOrderPlan(root, { adapter: staticAdapter(() => valueOf('requested-no-order')) }); await settle();
  assert.equal(headline(root).textContent, '2 vehicles requested from Production'); assert.doesNotMatch(text(root), /No new order recommended/);
  assert.equal(top(root).querySelector('.vm-lede'), null, 'a plan that orders nothing adds no second line');
  assert.equal(requestButton(root).disabled, true);
  const other = valueOf('submitted'); other.replan.requests = other.replan.requests.slice(0, 1);
  const two = host(); panel.mountGregOrderPlan(two, { adapter: staticAdapter(() => other) }); await settle();
  assert.equal(headline(two).textContent, '2 vehicles requested from Production');
  assert.match(top(two).querySelector('.vm-lede').textContent, /^Under the current limits the plan recommends 3 vehicles: 2 × 3 Series Touring 320i/);
});

test('a Production response keeps the Replanned notice as the message', async () => {
  const root = host(); panel.mountGregOrderPlan(root, { adapter: staticAdapter(() => valueOf('replanned')) }); await settle();
  assert.match(headline(root).textContent, /^Order 2 vehicles/); assert.equal(root.querySelector('.gcsp-plan-banner h3').textContent, 'Replanned after a Production response');
  assert.doesNotMatch(text(root), /requested from Production/);
});

test('Change limits is a closed disclosure under the headline and notices, above the tables, and keeps its draft and open state', async () => {
  const { root, teardown } = await mount('submitted');
  const bar = root.querySelector('.gcsp-plan-editor details'); assert.ok(bar); assert.equal(bar.open, false);
  assert.equal(bar.querySelector('summary').textContent, 'Change limits'); assert.equal(bar.querySelector('summary').id.endsWith('-limits'), true);
  assert.equal(bar.querySelector('h3'), null, 'no second Change limits heading');
  const before = (a, b) => Boolean(a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(before(top(root), bar) && before(bar, root.querySelector('.gcsp-plan-submit')) && before(bar, root.querySelector('.gcsp-plan-content')));
  assert.equal(top(root).contains(bar), false); assert.ok(before(top(root).querySelector('.gcsp-plan-banner'), bar), 'below the notice');
  bar.open = true; const row = limit(root, 'Derivative limits', 0); edit(row.min, '2');
  bar.open = false; bar.open = true; assert.equal(limit(root, 'Derivative limits', 0).min.value, '2', 'closing and opening loses nothing');
  teardown.refresh(); await settle(); assert.equal(root.querySelector('.gcsp-plan-editor details').open, true, 'a refresh leaves it as it was');
  bar.open = false; edit(limit(root, 'Derivative limits', 0).max, '1'); edit(limit(root, 'Derivative limits', 0).min, '5');
  action(root, 'Preview with these limits').click(); await settle();
  assert.equal(root.querySelector('.gcsp-plan-editor details').open, true, 'a limit error opens it');
});

test('only limits that hold the plan back are listed, and none leaves the table out', async () => {
  const { root } = await mount('ready');
  const table = [...root.querySelectorAll('table')].find((t) => t.caption.textContent === 'Binding constraints');
  assert.deepEqual([...table.tBodies[0].rows].map((r) => r.cells[0].textContent), ['i5 Touring eDrive40 M Sport Pro with Technology Plus and Comfort Packs maximum', 'i5 Touring maximum']);
  assert.doesNotMatch(table.textContent, /minimum 0/);
  const none = host(); panel.mountGregOrderPlan(none, { adapter: staticAdapter(() => valueOf('requested-no-order')) }); await settle();
  assert.equal([...none.querySelectorAll('table')].some((t) => t.caption.textContent === 'Binding constraints'), false);
  assert.doesNotMatch(text(none), /minimum 0/);
});

test('focus follows each action: preview, back, request and a refresh asked for after a Production response', async () => {
  const { root } = await mount('preview');
  edit(limit(root, 'Derivative limits', 0).max, '1'); action(root, 'Preview with these limits').click(); await settle();
  assert.equal(document.activeElement, headline(root)); assert.equal(headline(root).tabIndex, -1);
  action(root, 'Back to current plan').click(); assert.equal(document.activeElement, headline(root)); assert.match(headline(root).textContent, /^Order 3 vehicles/);
  const flow = host(); let phase = 'submitted';
  const adapter = { ...staticAdapter(() => valueOf(phase)), readPlan: async () => adapterMod.planOutcome(200, { status: 'ok', value: valueOf(phase) }) };
  const outside = document.createElement('input'); document.body.append(outside);
  const teardown = panel.mountGregOrderPlan(flow, { adapter }); await settle();
  outside.focus(); phase = 'replanned'; teardown.refresh(); await settle();
  assert.equal(document.activeElement, outside, 'a background refresh does not take focus');
  phase = 'submitted'; teardown.refresh(); await settle(); phase = 'replanned'; teardown.refresh({ focus: true }); await settle();
  const notice = flow.querySelector('.gcsp-plan-banner h3'); assert.equal(notice.textContent, 'Replanned after a Production response');
  assert.equal(document.activeElement, notice); assert.equal(notice.tabIndex, -1);
  phase = 'ready'; teardown.refresh({ focus: true }); await settle(); assert.equal(document.activeElement, headline(flow), 'with no notice it falls back to the headline');
});

test('range sliders have a visible focus ring on the track and the thumb in the shared native-control stylesheet', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../blocks/vehicle-matcher/question-controls.css', import.meta.url), 'utf8');
  for (const selector of ['.vm .vm-slider-single:focus-visible {', '.vm-slider-single:focus-visible::-webkit-slider-thumb {', '.vm-slider-single:focus-visible::-moz-range-thumb {']) assert.ok(css.includes(selector), selector);
  assert.match(css, /focus-visible \{ outline: 2px solid var\(--vm-ink-strong\)/);
});
