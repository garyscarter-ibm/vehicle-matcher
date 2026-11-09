import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
let mount; let presenterBar; let workspace; let http; let dom;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'customElements']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
  ({ presenterBar } = await import('../../blocks/gcsp/kit/presenter-bar.js'));
  ({ mountPresenterControls: mount } = await import('../../blocks/gcsp/presenter-controls/controls.js'));
  ({ mountPresenterWorkspace: workspace } = await import('../../blocks/gcsp/presenter-controls/workspace.js'));
  ({ createPresenterHttpAdapter: http } = await import('../../blocks/gcsp/presenter-controls/http-adapter.js'));
});
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());
const ok = (value) => ({ status: 'ok', value });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)); };
const state = () => ({ runId: 'run-a', runVersion: 1, now: '2026-11-05T09:00:00.000Z', clockVersion: '1',
  currentScenario: { scenarioId: 'mechanics', name: 'Clock mechanics' }, lastTick: null,
  principals: [{ principalId: 'employee-test', name: 'Employee test', roles: ['employee'] }, { principalId: 'greg-test', name: 'Greg test', roles: ['greg'] }],
  controls: { step: { value: 37, unit: 'seconds' }, namedTimes: { release: '2026-11-05T10:00:00.000Z' }, nextRelease: { status: 'available', at: '2026-11-05T10:00:00.000Z' } } });
const catalogue = { policyVersion: 'policy-test', scenarios: [
  { scenarioId: 'mechanics', name: 'Clock mechanics', scenarioVersion: 'v1', fixtureVersion: 'f1', availability: { available: true } },
  { scenarioId: 'business', name: 'Business journey', scenarioVersion: 'v2', fixtureVersion: 'f2', availability: { available: false, missingCapabilities: ['actual-release-service'] } },
] };
function setup(overrides = {}, options = {}) {
  const host = document.createElement('div'); document.body.append(host); let ids = 0; const calls = [];
  const adapter = { readControls: async () => ok(state()), readContext: async () => ok({ principalId: 'employee-test', name: 'Employee test', roles: ['employee'] }),
    readScenarios: async () => ok(catalogue), tick: async (payload) => { calls.push(payload); return ok({}); },
    reset: async (payload) => { calls.push(payload); return ok({ runId: 'run-new' }); }, switchPrincipal: async () => ok({}), ...overrides };
  const navigation = []; const control = mount(host, { adapter, commandId: () => `command-${++ids}`, navigate: (url) => navigation.push(url), ...options });
  const click = (label) => { const node = [...host.querySelectorAll('button')].find((row) => row.textContent === label || row.textContent.startsWith(label + ' (')); assert.ok(node, label); node.click(); return node; };
  return { host, adapter, control, click, calls, navigation };
}
const group = (f, label) => f.host.querySelector(`[role="radiogroup"][aria-label="${label}"]`);
const choice = (f, label, value) => group(f, label).querySelector(`[data-value="${value}"]`);
const selected = (f, label) => group(f, label).querySelector('[aria-checked="true"]')?.dataset.value;
test('presenterBar projects safe supplied facts without replacing disclosure or consumer actions', () => {
  const bar = presenterBar({ label: 'Demo controls', readback: [{ label: 'Run', value: 'run-a' }] });
  document.body.append(bar.root); const action = document.createElement('button'); bar.panel.append(action);
  bar.root.open = true; action.focus();
  bar.setReadback([{ label: 'Run', value: '<run-b>' }, { label: 'Clock', value: null }]);
  assert.equal(bar.summary.textContent, 'Demo controls'); assert.equal(bar.root.open, true);
  assert.equal(document.activeElement, action); assert.equal(bar.panel.lastChild, action);
  assert.match(bar.readback.textContent, /<run-b>.*Not supplied/); assert.equal(bar.readback.querySelector('run-b'), null);
});
test('both controlled pickers retain mounted radio identity, deliberate value and focus across readbacks', async () => {
  const f = setup(); await settle(); f.control.root.open = true;
  assert.equal(f.host.querySelector('select'), null);
  const scenario = choice(f, 'Scenario', 'business'); const principal = choice(f, 'Acting principal', 'greg-test');
  scenario.click(); principal.click(); scenario.focus();
  await f.control.refresh();
  assert.equal(choice(f, 'Scenario', 'business'), scenario); assert.equal(choice(f, 'Acting principal', 'greg-test'), principal);
  assert.equal(document.activeElement, scenario); assert.equal(selected(f, 'Scenario'), 'business');
  assert.equal(selected(f, 'Acting principal'), 'greg-test'); assert.equal(scenario.disabled, false);
  assert.ok(group(f, 'Scenario').getAttribute('aria-describedby')); f.control.destroy();
});
test('shared radio keyboard arrows wrap and Home/End select with one tab stop in each picker', async () => {
  const f = setup(); await settle(); f.control.root.open = true;
  for (const label of ['Scenario', 'Acting principal']) {
    const radios = [...group(f, label).querySelectorAll('[role="radio"]')];
    const key = (name) => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true }));
    radios[0].focus(); key('End'); assert.equal(document.activeElement, radios.at(-1));
    assert.equal(radios.at(-1).getAttribute('aria-checked'), 'true');
    key('ArrowRight'); assert.equal(document.activeElement, radios[0]);
    key('ArrowLeft'); assert.equal(document.activeElement, radios.at(-1));
    key('Home'); assert.equal(document.activeElement, radios[0]);
    assert.deepEqual(radios.map((radio) => radio.tabIndex), [0, -1]);
  }
  f.control.destroy();
});
test('busy and uncertain updates disable mounted radio buttons without rewriting their selection', async () => {
  let finish;
  const f = setup({ tick: () => new Promise((resolve) => { finish = resolve; }) }); await settle();
  const scenario = choice(f, 'Scenario', 'business'); scenario.click(); f.click('Tick');
  assert.equal(scenario.disabled, true); assert.equal(selected(f, 'Scenario'), 'business');
  finish({ status: 'unavailable', lostResponse: true, retryable: true }); await settle();
  assert.equal(choice(f, 'Scenario', 'business'), scenario); assert.equal(scenario.disabled, true);
  choice(f, 'Scenario', 'mechanics').click(); assert.equal(selected(f, 'Scenario'), 'business');
  f.control.destroy();
});
test('separate CONTROL authorization hides employee/Greg controls and errors entirely', async () => {
  for (const status of ['forbidden', 'missing-session', 'unavailable']) {
    const f = setup({ readControls: async () => ({ status, reason: 'private failure' }) }); await settle();
    assert.equal(f.control.root.hidden, true); assert.doesNotMatch(f.host.textContent, /private failure/); f.control.destroy();
  }
});
test('authorized while acting employee: stable labelled controls, server step, collapse and Escape', async () => {
  const f = setup(); await settle(); assert.equal(f.control.root.hidden, false); assert.match(f.host.textContent, /37 seconds/);
  assert.match(f.host.textContent, /Employee test \(employee\)/); assert.match(f.host.textContent, /run-a/);
  assert.equal(f.control.root.open, false); f.control.root.open = true;
  const input = f.host.querySelector('input'); assert.ok(document.querySelector(`label[for="${input.id}"]`));
  input.focus(); input.value = 'release'; input.dispatchEvent(new window.Event('input')); assert.equal(document.activeElement, input);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(f.control.root.open, false);
  assert.equal(document.activeElement.tagName, 'SUMMARY'); f.control.destroy();
});
test('double click is guarded and response-loss retry preserves exact original body despite readback/input changes', async () => {
  let complete; const calls = []; const f = setup({ tick: (payload) => { calls.push(payload); return new Promise((resolve) => { complete = resolve; }); } }); await settle();
  f.click('Tick'); f.click('Tick'); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { commandId: 'command-1', expectedClockVersion: '1', mode: 'step' });
  complete({ status: 'unavailable', lostResponse: true, retryable: true }); await settle();
  f.adapter.readControls = async () => ok({ ...state(), clockVersion: '9' });
  f.click('Refresh readback'); await settle(); f.click('Retry original action'); assert.equal(calls.length, 2); assert.strictEqual(calls[0], calls[1]);
  complete(ok({})); await settle(); f.control.destroy();
});
test('tick preserves committed time and ordered pending/refused outcomes, never invents release counts', async () => {
  const now = '2026-11-05T10:00:00.000Z';
  const tick = { tickId: 'tick-test', state: 'pending', handlerOrder: [{ handlerId: 'first', stage: 'release-pull' }, { handlerId: 'second', stage: 'outbox-dispatch' }],
    outcomes: [{ handlerId: 'first', stage: 'release-pull', outcome: { status: 'forbidden', reason: 'Release refused' } }], missingStages: ['manual-expiry'] };
  let reads = 0;
  const f = setup({ tick: async () => ({ status: 'unavailable', reason: 'Tick interrupted', advance: { now }, tick }),
    readControls: async () => ++reads === 1 ? ok(state()) : { status: 'unavailable', reason: 'Readback failed' } }); await settle(); f.click('Next release'); await settle();
  assert.match(f.host.textContent, /10:00:00/); assert.match(f.host.textContent, /Release refused/);
  const rows = [...f.host.querySelectorAll('ol li')].map((row) => row.textContent); assert.match(rows[0], /^Another step: Refused\. Release refused/); assert.match(rows[1], /^Another step: Waiting for a result/);
  assert.match(f.host.textContent, /Tick still running\. 2 steps: 1 refused, 1 waiting for a result\./); assert.doesNotMatch(f.host.textContent, /tick-test/);
  assert.match(f.host.textContent, /Not run this tick: Manual claim expiry\./); assert.match(f.host.textContent, /Release unavailable/); assert.doesNotMatch(f.host.textContent, /0 cars/);
  f.control.destroy();
});
// Contract-shaped unit inputs from FUCQ-92 15a79957; no producer/runtime source is imported.
const releasedOrders = ['53ad1ee8-e846-4fa9-a4bd-58147ac3edb0', 'ccfe5227-fcc0-4b6f-8619-9bef72aaf223'];
const releaseTick = () => ({ runId: 'run-a', tickId: 'release-tick', eventId: 'release-tick', state: 'completed',
  handlerOrder: [{ handlerId: 'stock-release', stage: 'release-pull' }], missingStages: [],
  outcomes: [{ handlerId: 'stock-release', stage: 'release-pull', outcome: ok({ kind: 'stock-released', runId: 'run-a', tickId: 'release-tick',
    orderUuids: [...releasedOrders], visibleOrderUuids: [...releasedOrders, 'f06a7f64-c1d0-4e1d-9366-43f661c2a36b'] }) }] });
test('release count uses committed newly released IDs, not visible stock or an unrelated integer', async () => {
  const lastTick = releaseTick(); lastTick.outcomes[0].outcome.value.released = 999;
  const f = setup({ readControls: async () => ok({ ...state(), lastTick }) });
  await settle(); assert.match(f.host.textContent, /2 cars released/); assert.doesNotMatch(f.host.textContent, /999 cars released|3 cars released/);
  f.control.destroy();
});
test('valid no-release and empty committed tranche results report zero', async () => {
  for (const kind of ['no-release', 'stock-released']) {
    const lastTick = releaseTick(); Object.assign(lastTick.outcomes[0].outcome.value, { kind, orderUuids: [] });
    const f = setup({ readControls: async () => ok({ ...state(), lastTick }) });
    await settle(); assert.match(f.host.textContent, /0 cars released/); f.control.destroy();
  }
});
test('original tick result replay retains its count without accumulating across readbacks', async () => {
  const lastTick = releaseTick(); const before = structuredClone(lastTick);
  const f = setup({ readControls: async () => ok({ ...state(), lastTick }) });
  await settle();
  for (let i = 0; i < 2; i++) { await f.control.refresh(); assert.match(f.host.textContent, /2 cars released/); }
  assert.deepEqual(lastTick, before); assert.doesNotMatch(f.host.textContent, /4 cars released|6 cars released/); f.control.destroy();
});
test('a committed release remains visible while a later handler is pending or refused', async () => {
  for (const status of ['pending', 'forbidden']) {
    const lastTick = releaseTick(); lastTick.state = status === 'pending' ? 'pending' : 'interrupted';
    lastTick.handlerOrder.push({ handlerId: 'reconcile', stage: 'pending-reconciliation' });
    lastTick.outcomes.push({ handlerId: 'reconcile', stage: 'pending-reconciliation', outcome: { status } });
    const f = setup({ readControls: async () => ok({ ...state(), lastTick }) });
    await settle(); assert.match(f.host.textContent, /2 cars released/); assert.match(f.host.textContent, status === 'pending' ? /Reconciliation|Another step: Waiting for a result/ : /Another step: Refused/); f.control.destroy();
  }
});
const invalidReleaseResults = {
  'missing IDs': (t) => { delete t.outcomes[0].outcome.value.orderUuids; },
  'non-array IDs': (t) => { t.outcomes[0].outcome.value.orderUuids = 'not-an-array'; },
  'duplicate IDs': (t) => { t.outcomes[0].outcome.value.orderUuids = [releasedOrders[0], releasedOrders[0]]; },
  'malformed ID': (t) => { t.outcomes[0].outcome.value.orderUuids = ['not-an-exact-order']; },
  'nonstring ID': (t) => { t.outcomes[0].outcome.value.orderUuids = [null]; },
  'unknown kind': (t) => { t.outcomes[0].outcome.value.kind = 'queued-supply'; },
  'no-release with IDs': (t) => { t.outcomes[0].outcome.value.kind = 'no-release'; },
  'missing value': (t) => { delete t.outcomes[0].outcome.value; },
  'pending release': (t) => { t.outcomes[0].outcome.status = 'pending'; },
  'refused release': (t) => { t.outcomes[0].outcome.status = 'forbidden'; },
  'unavailable release': (t) => { t.outcomes[0].outcome.status = 'unavailable'; },
  'foreign result run': (t) => { t.outcomes[0].outcome.value.runId = 'run-other'; },
  'foreign outer run': (t) => { t.runId = 'run-other'; },
  'foreign result tick': (t) => { t.outcomes[0].outcome.value.tickId = 'old-tick'; },
  'missing result tick': (t) => { delete t.outcomes[0].outcome.value.tickId; },
  'mismatched event': (t) => { t.eventId = 'different-event'; },
  'missing tick identity': (t) => { delete t.tickId; delete t.eventId; },
  'unregistered release': (t) => { t.handlerOrder = []; },
  'wrong registered handler': (t) => { t.handlerOrder[0].handlerId = 'synthetic-release'; },
  'wrong result handler': (t) => { t.outcomes[0].handlerId = 'synthetic-release'; },
  'wrong result stage': (t) => { t.outcomes[0].stage = 'outbox-dispatch'; },
  'duplicate registration': (t) => { t.handlerOrder.push({ ...t.handlerOrder[0] }); },
  'duplicate result': (t) => { t.outcomes.push(structuredClone(t.outcomes[0])); },
  'missing outcome': (t) => { t.outcomes = []; },
  'malformed outcomes': (t) => { t.outcomes = {}; },
  'malformed registration': (t) => { t.handlerOrder = {}; },
  'missing stage contradiction': (t) => { t.missingStages = ['release-pull']; },
  'missing stage readback': (t) => { delete t.missingStages; },
};
for (const [name, mutate] of Object.entries(invalidReleaseResults)) test(`release count fails closed for ${name}`, async () => {
  const lastTick = releaseTick(); mutate(lastTick);
  const f = setup({ readControls: async () => ok({ ...state(), lastTick }) });
  await settle(); assert.match(f.host.textContent, /Release unavailable/); assert.doesNotMatch(f.host.textContent, /\d+ cars released/); f.control.destroy();
});
test('reset current/chosen availability is explained and explicit confirmation captures canonical versions', async () => {
  const f = setup(); await settle(); const unavailable = choice(f, 'Scenario', 'business'); assert.equal(unavailable.disabled, false); unavailable.click(); assert.match(f.host.textContent, /Selected: Business journey\. Not available yet: actual-release-service/);
  assert.equal(f.click('Reset scenario').disabled, true); assert.equal(f.calls.length, 0);
  choice(f, 'Scenario', 'mechanics').click(); assert.match(f.host.textContent, /Selected: Clock mechanics\. Ready to reset\./);
  f.click('Reset scenario'); assert.equal(f.calls.length, 0);
  f.click('Cancel reset'); assert.equal(f.calls.length, 0); f.click('Reset scenario'); f.click('Confirm reset'); await settle();
  assert.deepEqual(f.calls[0], { commandId: 'command-1', expectedRunId: 'run-a', expectedRunVersion: 1,
    scenarioId: 'mechanics', scenarioVersion: 'v1', fixtureVersion: 'f1', policyVersion: 'policy-test' });
  assert.match(f.host.textContent, /Reset done. New run: run-new/); f.control.destroy();
});
test('delayed catalogue selects the actual current scenario after unavailable first option, then preserves deliberate choice', async () => {
  let completeCatalogue;
  const f = setup({ readScenarios: () => new Promise((resolve) => { completeCatalogue = resolve; }) });
  await settle();
  assert.equal(group(f, 'Scenario').children.length, 0); assert.equal(selected(f, 'Scenario'), undefined);
  completeCatalogue(ok({ ...catalogue, scenarios: [catalogue.scenarios[1], catalogue.scenarios[0]] }));
  await settle(); assert.equal(selected(f, 'Scenario'), state().currentScenario.scenarioId);
  choice(f, 'Scenario', 'business').click();
  f.adapter.readScenarios = async () => ok(catalogue);
  await f.control.refresh();
  assert.equal(selected(f, 'Scenario'), 'business'); assert.match(f.host.textContent, /actual-release-service/);
  f.control.destroy();
});
test('FUCQ-261: no presenter control cookie means no controls read, and the strip stays hidden', async () => {
  let reads = 0;
  const f = setup({ readControls: async () => { reads++; return ok(state()); },
    readContext: async () => ({ ...ok({ principalId: 'demo-paula', roles: ['employee'] }), presenterControl: false }) });
  await settle();
  assert.equal(reads, 0); assert.equal(f.control.root.hidden, true); f.control.destroy();
  let shown = 0;
  const g = setup({ readControls: async () => { shown++; return ok(state()); },
    readContext: async () => ({ ...ok({ principalId: 'demo-paula', roles: ['employee'] }), presenterControl: true }) });
  await settle();
  assert.equal(shown, 1); assert.equal(g.control.root.hidden, false); g.control.destroy();
});
test('acknowledged reset navigates to fresh actual-context workspace without another stale-page read', async () => {
  let reads = 0; let contexts = 0;
  const f = setup({ readControls: async () => { reads++; return ok(state()); },
    readContext: async () => { contexts++; return ok({ principalId: 'employee-test', roles: ['employee'] }); },
    reset: async () => ok({ runId: 'fresh-run', presenterSession: { status: 'ok' } }) });
  await settle(); f.click('Reset scenario'); f.click('Confirm reset'); await settle();
  assert.equal(f.navigation.length, 1); assert.match(f.navigation[0], /gcsp-presenter.html$/);
  assert.doesNotMatch(f.navigation[0], /\?/); assert.equal(reads, 1); assert.equal(contexts, 1);
  assert.match(f.host.textContent, /Reset done. New run: fresh-run/); f.control.destroy();
});
test('unknown reset delivery preserves original retry and navigates only after acknowledged replay', async () => {
  const calls = [];
  const f = setup({ reset: async (payload) => { calls.push(payload); return calls.length === 1
    ? { status: 'unavailable', lostResponse: true, retryable: true }
    : ok({ runId: 'replayed-run' }); } });
  await settle(); f.click('Reset scenario'); f.click('Confirm reset'); await settle();
  assert.equal(f.navigation.length, 0); assert.match(f.host.textContent, /Retry the original action/);
  f.click('Retry original action'); await settle();
  assert.equal(calls.length, 2); assert.strictEqual(calls[0], calls[1]);
  assert.equal(f.navigation.length, 1); assert.match(f.navigation[0], /gcsp-presenter.html$/);
  assert.match(f.host.textContent, /Reset done. New run: replayed-run/); f.control.destroy();
});
test('definitive stale-run reset retry navigates only to a freshly agreed different current run without claiming reset success', async () => {
  let currentRun = 'run-a'; const calls = [];
  const f = setup({ readControls: async () => ok({ ...state(), runId: currentRun }),
    readContext: async () => ok({ principalId: 'presenter-test', roles: ['presenter'], runId: currentRun }),
    reset: async (payload) => { calls.push(payload); currentRun = 'run-current'; return calls.length === 1
      ? { status: 'unavailable', lostResponse: true, retryable: true } : { status: 'stale-run' }; } });
  await settle(); f.click('Reset scenario'); f.click('Confirm reset'); await settle();
  assert.equal(f.navigation.length, 0); assert.match(f.host.textContent, /Retry the original action/);
  f.click('Retry original action'); await settle();
  assert.strictEqual(calls[0], calls[1]); assert.equal(calls[0].expectedRunId, 'run-a');
  assert.equal(f.navigation.length, 1); assert.match(f.navigation[0], /gcsp-presenter.html$/);
  assert.match(f.host.textContent, /Action not completed/); assert.doesNotMatch(f.host.textContent, /Reset done|stale-run/);
  f.control.destroy();
});
test('stale-run reset retry cannot navigate from matching old reads, mismatched runs or failed fresh controls/context', async () => {
  for (const failure of ['same-run', 'mismatch', 'controls-failed', 'context-failed']) {
    let calls = 0;
    const f = setup({
      readControls: async () => calls === 2 && failure === 'controls-failed' ? { status: 'unavailable' }
        : ok({ ...state(), runId: calls && failure !== 'same-run' ? 'run-current' : 'run-a' }),
      readContext: async () => calls === 2 && failure === 'context-failed' ? { status: 'unavailable' }
        : ok({ principalId: 'presenter-test', roles: ['presenter'], runId: calls
          ? failure === 'same-run' ? 'run-a' : failure === 'mismatch' ? 'run-other' : 'run-current' : 'run-a' }),
      reset: async () => ++calls === 1 ? { status: 'unavailable', lostResponse: true, retryable: true } : { status: 'stale-run' },
    });
    await settle(); f.click('Reset scenario'); f.click('Confirm reset'); await settle();
    assert.equal(f.navigation.length, 0, failure); f.click('Retry original action'); await settle();
    assert.equal(calls, 2); assert.equal(f.navigation.length, 0, failure);
    assert.doesNotMatch(f.host.textContent, /Reset done/); f.control.destroy();
  }
});
test('cookie issuance conflict confirms actual principal before navigation; unknown context offers fresh deliberate issuance', async () => {
  const calls = []; const f = setup({ switchPrincipal: async (payload) => { calls.push(payload); return { status: 'conflict', reason: 'Cookie cannot replay' }; } });
  await settle(); choice(f, 'Acting principal', 'greg-test').click();
  f.click('Switch principal'); await settle(); assert.equal(f.navigation.length, 0); assert.match(f.host.textContent, /Switch uncertain or refused/);
  f.click('Retry original action'); await settle(); assert.strictEqual(calls[0], calls[1]);
  f.adapter.readContext = async () => ok({ principalId: 'greg-test', name: 'Greg test', roles: ['greg'] });
  f.click('Issue selected principal again'); await settle(); assert.notEqual(calls[0].commandId, calls[2].commandId);
  assert.match(f.navigation[0], /gcsp-presenter.html$/); assert.doesNotMatch(f.navigation[0], /\?/); f.control.destroy();
});
test('destroy aborts and ignores late readback', async () => {
  let finish; const f = setup({ readControls: () => new Promise((resolve) => { finish = resolve; }) });
  await settle(); f.control.destroy(); finish(ok(state())); await settle(); assert.equal(f.host.children.length, 0); // readback starts after the context gate
});
test('workspace chooses only actual context role and real adapter, never a query principal or fixture', async () => {
  for (const role of ['employee', 'greg']) {
    const host = document.createElement('div'); document.body.append(host); const calls = [];
    const acting = { readContext: async () => ok({ roles: [role], principalId: 'server-choice' }) };
    const account = {}; const greg = {};
    const done = workspace(host, { adapter: acting, accountAdapter: account, gregAdapter: greg,
      mountEmployee: (_root, options) => { calls.push(['employee', options.adapter]); return () => {}; },
      mountGreg: () => { calls.push(['greg']); return () => {}; } });
    await done.ready; assert.equal(calls[0][0], role); if (role === 'employee') assert.equal(calls[0][1], account); done();
  }
});
test('employee workspace passes the order-progress and help adapters to the manual journey', async () => {
  const host = document.createElement('div'); document.body.append(host); let options;
  const orderAdapter = { listOrders: async () => ok([]) }; const helpAdapter = { createCase: async () => ok({}) };
  const done = workspace(host, { adapter: { readContext: async () => ok({ roles: ['employee'], principalId: 'e' }) }, orderAdapter, helpAdapter,
    mountEmployee: (_root, opts) => { options = opts; return () => {}; } });
  await done.ready; assert.equal(options.orderAdapter, orderAdapter); assert.equal(options.helpAdapter, helpAdapter); done();
  const host2 = document.createElement('div'); document.body.append(host2); let defaults;
  const done2 = workspace(host2, { adapter: { readContext: async () => ok({ roles: ['employee'], principalId: 'e' }) },
    mountEmployee: (_root, opts) => { defaults = opts; return () => {}; } });
  await done2.ready; assert.equal(typeof defaults.orderAdapter?.listOrders, 'function'); assert.equal(typeof defaults.helpAdapter, 'object'); done2();
});
test('employee workspace subscribes the journey clock to presenter actions once and releases it on unsubscribe and destroy', async () => {
  const host = document.createElement('div'); document.body.append(host); const child = document.createElement('button');
  let options; let fired = 0; let live;
  const done = workspace(host, { adapter: { readContext: async () => ok({ roles: ['employee'], principalId: 'e' }) },
    mountEmployee: (_root, opts) => { options = opts; live = opts.subscribeClock(() => { fired++; }); return () => live(); } });
  await done.ready; host.append(child); assert.equal(typeof options.subscribeClock, 'function');
  const tick = () => child.dispatchEvent(new window.CustomEvent('gcsp:presenter-action', { bubbles: true, detail: { kind: 'tick', principalId: 'x' } }));
  tick(); assert.equal(fired, 1);
  live(); live(); tick(); assert.equal(fired, 1);
  const args = []; const extra = options.subscribeClock((...rest) => args.push(rest)); tick(); assert.deepEqual(args, [[]]);
  extra(); extra(); tick(); assert.equal(args.length, 1);
  live = options.subscribeClock(() => { fired++; }); tick(); assert.equal(fired, 2);
  done(); tick(); assert.equal(fired, 2);
});
function gregFixture(extra = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const counts = { dashboard: 0, tracking: 0, destroyed: 0 }; let region; let controlsHost;
  const mountGreg = () => {
    region = document.createElement('section'); region.setAttribute('aria-labelledby', 'old'); region.append(document.createElement('h2'));
    controlsHost = document.createElement('div'); host.append(region, controlsHost);
    const teardown = () => { counts.destroyed++; }; teardown.refresh = () => { counts.dashboard++; };
    teardown.regions = { orderTracking: region }; return teardown;
  };
  const ordersAdapter = { loadTracking: async () => { counts.tracking++; return { status: 'unavailable', reason: 'none' }; } };
  const done = workspace(host, { adapter: { readContext: async () => ok({ roles: ['greg'], principalId: 'g' }) }, gregAdapter: {},
    mountGreg, ordersAdapter, ...extra });
  return { host, counts, done, region: () => region, controlsHost: () => controlsHost };
}
test('Greg workspace mounts one order panel with production controls in the order tracking region and removes it on destroy', async () => {
  const f = gregFixture(); await f.done.ready; await settle();
  const region = f.region(); assert.equal(region.querySelectorAll('.gcsp-orders-tracking').length, 1);
  assert.equal(f.host.querySelectorAll('.gcsp-orders').length, 1); assert.equal(region.querySelector('h2').textContent, 'Order requests');
  assert.equal(region.getAttribute('aria-labelledby'), region.querySelector('h2').id); assert.equal(region.querySelector('details.gcsp-orders-production').hidden, false);
  assert.equal(f.counts.tracking, 1); f.done(); assert.equal(f.counts.destroyed, 1); assert.equal(f.host.querySelectorAll('.gcsp-orders').length, 0);
});
test('presenter-action event from inside the workspace refreshes dashboard and orders, and stops after destroy', async () => {
  const f = gregFixture(); await f.done.ready; await settle();
  f.controlsHost().dispatchEvent(new window.CustomEvent('gcsp:presenter-action', { bubbles: true, detail: { kind: 'tick' } })); await settle();
  assert.equal(f.counts.dashboard, 1); assert.equal(f.counts.tracking, 2);
  f.done(); f.host.dispatchEvent(new window.CustomEvent('gcsp:presenter-action')); await settle();
  assert.equal(f.counts.dashboard, 1); assert.equal(f.counts.tracking, 2);
});
test('order changes refresh the dashboard demand figures', async () => {
  let changed; const f = gregFixture({ mountOrders: (_root, options) => { changed = options.onChanged; assert.equal(options.productionControls, true); return () => {}; } });
  await f.done.ready; changed(); assert.equal(f.counts.dashboard, 1); f.done();
});
test('the order plan and order tracking refresh each other, and the plan arrives through the Greg adapter', async () => {
  let ctx; let changed; const counts = { plan: 0, orders: 0 };
  const f = gregFixture({ gregAdapter: { orderPlan: { marker: 1 } },
    mountGreg: (_host, options) => { ctx = options; const t = () => {}; t.refresh = () => {}; t.orderPlan = { refresh: () => { counts.plan++; } }; t.regions = { orderTracking: document.createElement('section') }; return t; },
    mountOrders: (_root, options) => { changed = options.onChanged; const t = () => {}; t.refresh = () => { counts.orders++; }; return t; } });
  await f.done.ready; assert.deepEqual(ctx.orderPlan, { marker: 1 });
  ctx.onOrderPlanSubmitted(); assert.deepEqual(counts, { plan: 0, orders: 1 });
  changed(); assert.equal(counts.plan, 1);
  f.host.dispatchEvent(new window.CustomEvent('gcsp:presenter-action', { bubbles: true, detail: { kind: 'tick' } })); assert.deepEqual(counts, { plan: 2, orders: 2 });
  f.done();
});
test('a successful clock action announces gcsp:presenter-action; reset and failures do not', async () => {
  const seen = []; let fail = false;
  const f = setup({ tick: async () => (fail ? { status: 'forbidden' } : ok({})) }); await settle();
  f.host.addEventListener('gcsp:presenter-action', (event) => seen.push(event.detail.kind));
  f.click('Tick'); await settle(); assert.deepEqual(seen, ['tick']);
  fail = true; f.click('Tick'); await settle(); assert.deepEqual(seen, ['tick']);
  fail = false; f.click('Reset scenario'); f.click('Confirm reset'); await settle(); assert.deepEqual(seen, ['tick']); f.control.destroy();
});
test('HTTP transport sends credentialled exact JSON and keeps typed refusal distinct from lost response', async () => {
  const calls = []; const payload = { commandId: 'same', mode: 'step', expectedClockVersion: '1' };
  const adapter = http({ fetchImpl: async (...args) => { calls.push(args); return { ok: false, json: async () => ({ status: 'forbidden', reason: 'Denied' }) }; } });
  assert.equal((await adapter.tick(payload)).status, 'forbidden'); assert.equal(calls[0][1].credentials, 'include'); assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  const lost = http({ fetchImpl: async () => { throw new Error('offline'); } }); assert.equal((await lost.tick(payload)).lostResponse, true);
});


test('acknowledged reset with session-renewal failure still navigates and preserves committed receipt before navigation', async () => {
  let reads = 0; let contexts = 0;
  const f = setup({ readControls: async () => ++reads === 1 ? ok(state()) : { status: 'unavailable', reason: 'Read failed' },
    readContext: async () => { contexts++; return contexts === 1 ? ok({ principalId: 'employee-test', roles: ['employee'] }) : { status: 'stale-run' }; },
    reset: async () => ok({ runId: 'run-new', now: '2026-11-05T09:00:00.000Z', presenterSession: { status: 'unavailable', action: 'Use trusted bootstrap.' } }) });
  await settle(); f.click('Reset scenario'); f.click('Confirm reset'); await settle();
  assert.match(f.host.textContent, /Reset done. New run: run-new/); assert.match(f.host.textContent, /Use trusted bootstrap/);
  assert.equal(f.navigation.length, 1); assert.match(f.navigation[0], /gcsp-presenter.html$/);
  assert.equal(reads, 1); assert.equal(contexts, 1); f.control.destroy();
});
test('fresh workspace with unrecovered reset session explains trusted backend bootstrap', async () => {
  const host = document.createElement('div'); document.body.append(host);
  host.textContent = 'Previous employee account';
  const done = workspace(host, { adapter: { readContext: async () => ({ status: 'stale-run' }),
    readControls: async () => ({ status: 'stale-run' }) } });
  await done.ready; await settle();
  assert.doesNotMatch(host.textContent, /Previous employee account/);
  assert.match(host.textContent, /Demo restarted/); assert.doesNotMatch(host.textContent, /stale-run/);
  done();
});
test('workspace stale-run context shows the restarted screen with a Reload that calls the injected reload', async () => {
  const host = document.createElement('div'); document.body.append(host); let reloads = 0;
  const done = workspace(host, { reload: () => reloads++, adapter: { readContext: async () => ({ status: 'stale-run' }),
    readControls: async () => ({ status: 'unavailable' }) } });
  await done.ready; await settle();
  const screen = host.querySelector('.vm-status[role="alert"]'); assert.ok(screen);
  assert.match(screen.textContent, /Demo restarted/); assert.match(screen.textContent, /The demo was restarted\. Reload the page to continue\./);
  assert.doesNotMatch(host.textContent, /stale-run|\u2014/);
  const reload = screen.querySelector('button[type="button"]'); assert.equal(reload.textContent, 'Reload'); reload.click(); assert.equal(reloads, 1);
  done();
});
test('workspace context failure other than stale-run explains bootstrap without a raw status', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const done = workspace(host, { adapter: { readContext: async () => ({ status: 'unavailable' }), readControls: async () => ({ status: 'unavailable' }) } });
  await done.ready; await settle();
  assert.match(host.textContent, /Workspace unavailable/); assert.match(host.textContent, /Presenter context could not be read/);
  assert.match(host.textContent, /trusted backend presenter-session bootstrap/); assert.doesNotMatch(host.textContent, /Context unavailable/);
  done();
});

test('custom element registers once, mounts injected adapter, and aborts on disconnect', async () => {
  const { defineGcspPresenterControls } = await import('../../blocks/gcsp/presenter-controls/controls.js');
  assert.equal(defineGcspPresenterControls(), defineGcspPresenterControls()); let signal;
  const element = document.createElement('gcsp-presenter-controls');
  element.adapter = { readControls: async (options) => { signal = options.signal; return { status: 'forbidden' }; } };
  document.body.append(element); await settle(); assert.equal(element.querySelector('details').hidden, true);
  element.remove(); assert.equal(signal.aborted, true); assert.equal(element.children.length, 0);
});

test('named/UTC target is captured exactly and server unavailable release cue disables that action', async () => {
  const f = setup({ readControls: async () => ok({ ...state(), controls: { ...state().controls, nextRelease: { status: 'unavailable', reason: 'Cue passed' } } }) });
  await settle(); assert.equal(f.click('Next release').disabled, true); assert.match(f.host.textContent, /Cue passed/);
  const input = f.host.querySelector('input'); input.value = '2026-11-05T12:34:56.000Z'; input.dispatchEvent(new window.Event('input'));
  f.click('Tick to target'); await settle(); assert.deepEqual(f.calls[0], { commandId: 'command-1', expectedClockVersion: '1', mode: 'to', to: input.value });
  input.value = 'release'; input.dispatchEvent(new window.Event('input')); f.click('Tick to target'); await settle();
  assert.equal(f.calls[1].to, 'release'); assert.notEqual(f.calls[0].commandId, f.calls[1].commandId); f.control.destroy();
});

test('late switch response after teardown cannot navigate or read another context', async () => {
  let complete; let contexts = 0;
  const f = setup({ switchPrincipal: () => new Promise((resolve) => { complete = resolve; }),
    readContext: async () => { contexts++; return ok({ principalId: 'employee-test', roles: ['employee'] }); } });
  await settle(); f.click('Switch principal'); f.control.destroy(); complete(ok({})); await settle();
  assert.equal(contexts, 1); assert.equal(f.navigation.length, 0); assert.equal(f.host.children.length, 0);
});


test('successful readback supersedes an older command tick when another tick is now current', async () => {
  let reads = 0;
  const f = setup({ tick: async () => ok({ tick: { tickId: 'older-action', state: 'completed', handlerOrder: [], outcomes: [] } }),
    readControls: async () => ok({ ...state(), lastTick: ++reads === 1 ? null : { tickId: 'latest-server-tick', state: 'pending', handlerOrder: [], outcomes: [] } }) });
  await settle(); f.click('Tick'); await settle(); assert.match(f.host.textContent, /Tick still running/); assert.doesNotMatch(f.host.textContent, /Tick completed|older-action/); f.control.destroy();
});


test('invalid target presents backend field explanations without unrelated diagnostic fields', async () => {
  const f = setup({ tick: async () => ({ status: 'invalid', code: 'invalid-clock-command', reasons: [
    { field: 'to', reason: 'Choose a configured named time or a future UTC ISO instant.', diagnostic: 'unrelated-internal-marker' },
    { field: 'to', reason: 'The target must be later than the current DemoClock.' },
  ] }) });
  await settle(); const input = f.host.querySelector('input'); input.value = 'yesterday'; input.dispatchEvent(new window.Event('input'));
  f.click('Tick to target'); await settle();
  assert.doesNotMatch(f.host.textContent, /invalid-clock-command/); assert.match(f.host.textContent, /Action not completed/);
  assert.match(f.host.textContent, /to: Choose a configured named time or a future UTC ISO instant/);
  assert.match(f.host.textContent, /The target must be later than the current DemoClock/);
  assert.doesNotMatch(f.host.textContent, /unrelated-internal-marker/); f.control.destroy();
});

test('known pending receipt keeps pending details visible while allowing deliberate next tick and reset', async () => {
  const pending = { tickId: 'known-pending-tick', state: 'pending', handlerOrder: [{ handlerId: 'reconcile', stage: 'pending-reconciliation' }],
    outcomes: [{ handlerId: 'reconcile', stage: 'pending-reconciliation', outcome: { status: 'pending', operationId: 'operation-known',
      operationType: 'claim', lastKnownState: 'awaiting-confirmation' } }], missingStages: ['release-pull'] };
  let currentTick = null; const ticks = []; const resets = [];
  const f = setup({ readControls: async () => ok({ ...state(), lastTick: currentTick }),
    tick: async (payload) => { ticks.push(payload); currentTick = pending; return ok({ tick: pending }); },
    reset: async (payload) => { resets.push(payload); currentTick = null; return ok({ runId: 'run-after-pending' }); } });
  await settle(); f.click('Tick'); await settle();
  assert.doesNotMatch(f.host.textContent, /known-pending-tick|awaiting-confirmation/); assert.match(f.host.textContent, /Another step: Waiting for a result/);
  assert.match(f.host.textContent, /Not run this tick: Stock release\./);
  const originalRetry = [...f.host.querySelectorAll('button')].find((row) => row.textContent === 'Retry original action');
  assert.equal(originalRetry.hidden, true);
  const nextTick = [...f.host.querySelectorAll('button')].find((row) => row.textContent.startsWith('Tick ('));
  assert.equal(nextTick.disabled, false); nextTick.click(); await settle();
  assert.equal(ticks.length, 2); assert.notEqual(ticks[0].commandId, ticks[1].commandId);
  assert.match(f.host.textContent, /Tick still running\. 1 step: 1 waiting for a result\./);
  assert.equal(f.click('Reset scenario').disabled, false); f.click('Confirm reset'); await settle();
  assert.equal(resets.length, 1); assert.notEqual(resets[0].commandId, ticks[1].commandId);
  assert.match(f.host.textContent, /Reset done. New run: run-after-pending/); f.control.destroy();
});

const restartedPanel = (f) => f.host.querySelector('.gcsp-run-restarted');
function assertRestarted(f, reloads) {
  const notice = restartedPanel(f); assert.ok(notice); assert.equal(notice.hidden, false); assert.equal(notice.getAttribute('role'), 'alert');
  assert.match(notice.textContent, /The demo was restarted\. Reload the page to continue\./);
  assert.doesNotMatch(f.host.textContent, /stale-run|\u2014|Action not completed|Readback/);
  const reload = notice.querySelector('button'); assert.equal(reload.tagName, 'BUTTON'); assert.equal(reload.type, 'button');
  assert.equal(reload.disabled, false); assert.equal(reload.textContent, 'Reload');
  const others = [...f.host.querySelectorAll('button, input')].filter((node) => node !== reload);
  assert.ok(others.length > 0); for (const node of others) assert.ok(node.disabled || node.hidden || node.closest('[hidden]'), node.textContent);
  assert.equal(f.host.querySelectorAll('[role="radio"][aria-disabled="false"], [role="radio"]:not([disabled]):not([aria-disabled])').length, 0);
  reload.focus(); assert.equal(document.activeElement, reload);
  reload.click(); assert.equal(reloads(), 1); return reload;
}
test('a stale-run action reply shows the restarted notice, disables controls, never resends and reloads on request', async () => {
  let reloads = 0; const f = setup({ tick: async (payload) => { f.calls.push(payload); return { status: 'stale-run', reason: 'This request belongs to an earlier demonstration run.' }; } },
    { reload: () => reloads++ });
  await settle(); f.click('Tick'); await settle();
  assert.equal(f.calls.length, 1); const reload = assertRestarted(f, () => reloads);
  assert.equal(document.activeElement, reload);
  for (const label of ['Tick', 'Refresh readback']) { const node = [...f.host.querySelectorAll('button')].find((row) => row.textContent.startsWith(label)); node.click(); }
  await f.control.refresh(); await settle(); assert.equal(f.calls.length, 1);
  assert.equal([...f.host.querySelectorAll('button')].filter((row) => !row.disabled && !row.hidden && !row.closest('[hidden]')).length, 1);
  f.control.destroy();
});
test('restarted notice takes focus from the control that was used', async () => {
  let reloads = 0; const f = setup({ tick: async () => ({ status: 'stale-run' }) }, { reload: () => reloads++ });
  await settle(); f.host.querySelector('details, .gcsp-presenter-controls').open = true;
  const tick = [...f.host.querySelectorAll('button')].find((row) => row.textContent.startsWith('Tick'));
  tick.focus(); tick.click(); await settle();
  assert.equal(document.activeElement, restartedPanel(f).querySelector('button'));
  f.control.destroy();
});
test('a stale-run readback after an authorized read gives the same restarted notice', async () => {
  let reads = 0; let reloads = 0;
  const f = setup({ readControls: async () => ++reads === 1 ? ok(state()) : { status: 'stale-run', reason: 'This request belongs to an earlier demonstration run.' } },
    { reload: () => reloads++ });
  await settle(); await f.control.refresh(); await settle();
  assertRestarted(f, () => reloads); assert.equal(f.calls.length, 0); f.control.destroy();
});
test('a stale-run acting context gives the restarted notice', async () => {
  let reads = 0; let reloads = 0;
  const f = setup({ readContext: async () => ++reads === 1 ? ok({ principalId: 'employee-test', roles: ['employee'] }) : { status: 'stale-run' } },
    { reload: () => reloads++ });
  await settle(); await f.control.refresh(); await settle(); assertRestarted(f, () => reloads); f.control.destroy();
});
test('an unknown-session readback after an authorized read shows the notice, keeps the controls visible and disabled', async () => {
  let reads = 0; let reloads = 0;
  const f = setup({ readControls: async () => ++reads === 1 ? ok(state()) : { status: 'unknown-session', reason: 'This session is not recognised.' } },
    { reload: () => reloads++ });
  await settle(); await f.control.refresh(); await settle();
  assert.equal(f.control.root.hidden, false); assertRestarted(f, () => reloads);
  assert.doesNotMatch(f.host.textContent, /unknown-session|not recognised/); f.control.destroy();
});
test('an unknown-session action reply shows the notice, never resends and reloads on request', async () => {
  let reloads = 0; const f = setup({ tick: async (payload) => { f.calls.push(payload); return { status: 'unknown-session', reason: 'This session is not recognised.' }; } },
    { reload: () => reloads++ });
  await settle(); f.click('Tick'); await settle();
  assert.equal(f.calls.length, 1); assertRestarted(f, () => reloads); await f.control.refresh(); await settle();
  assert.equal(f.calls.length, 1); f.control.destroy();
});
test('FUCQ-198: the presenter adapter maps a status-less 401 to access-required and a later readback shows the notice', async () => {
  const lapsed = http({ fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }) });
  assert.deepEqual(await lapsed.readControls(), { status: 'access-required' });
  assert.deepEqual(await lapsed.tick({ commandId: 'c' }), { status: 'access-required' });
  const failed = http({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: 'x' }) }) });
  assert.equal((await failed.readControls()).status, 'unavailable');
  let reads = 0; let reloads = 0;
  const f = setup({ readControls: async () => ++reads === 1 ? ok(state()) : lapsed.readControls() }, { reload: () => reloads++ });
  await settle(); await f.control.refresh(); await settle(); assertRestarted(f, () => reloads); f.control.destroy();
});
test('failure messages lead with plain wording, never a raw status or code', async () => {
  for (const [reply, expected] of [[{ status: 'forbidden', code: 'raw-code' }, /Action not completed: Not permitted/],
    [{ status: 'conflict' }, /Changed elsewhere\. Refresh readback\./], [{ status: 'weird' }, /Action not completed: Not completed/]]) {
    const f = setup({ tick: async () => reply }); await settle(); f.click('Tick'); await settle();
    assert.match(f.host.textContent, expected); assert.doesNotMatch(f.host.textContent, /raw-code|forbidden:|weird/); f.control.destroy();
  }
  const f = setup({ readControls: (() => { let n = 0; return async () => ++n === 1 ? ok(state()) : { status: 'unavailable' }; })() });
  await settle(); await f.control.refresh(); await settle(); assert.match(f.host.textContent, /Readback unavailable: Backend unavailable/); f.control.destroy();
});

test('FUCQ-213: a refused tick shows a short sentence, never raw JSON or internal ids', async () => {
  const replies = [{ status: 'unavailable', reason: { code: 'handler-failed', detail: { tickId: 'tick-1' } }, handlerOutcome: { status: 'conflict', reason: 'idempotency-input-changed', current: {} } },
    { status: 'conflict', reason: 'idempotency-input-changed', current: {} }, { status: 'stale-version', reasons: [{ field: 'clock', reason: { raw: true } }] }];
  for (const reply of replies) {
    const f = setup({ tick: async () => reply }); await settle(); f.click('Tick'); await settle();
    assert.match(f.host.textContent, /Action not completed: (Changed elsewhere|Backend unavailable)/);
    assert.doesNotMatch(f.host.textContent, /[{}"]|idempotency|handler-failed|tick-1|raw/); f.control.destroy();
  }
  const mixed = setup({ tick: async () => ({ status: 'conflict', reason: 'clock-moved', reasons: [{ reason: 'The clock moved on.' }] }) });
  await settle(); mixed.click('Tick'); await settle();
  assert.match(mixed.host.textContent, /Action not completed: The clock moved on\./); mixed.control.destroy();
});

test('FUCQ-203: tick step results sit in a closed disclosure that keeps its open state and focus across readbacks', async () => {
  const handlerOrder = Array.from({ length: 11 }, (_, i) => ({ handlerId: `step-${i}`, stage: 'pending-reconciliation' }));
  const lastTick = { runId: 'run-a', tickId: 'tick-many', eventId: 'tick-many', state: 'completed', handlerOrder, missingStages: [],
    outcomes: handlerOrder.map((row) => ({ ...row, outcome: { status: 'ok', value: { orders: 0 } } })) };
  const f = setup({ readControls: async () => ok({ ...state(), lastTick }) }); await settle();
  const receipts = () => f.host.querySelector('details.gcsp-presenter-receipts');
  assert.ok(receipts(), 'step results are collapsible'); assert.equal(receipts().open, false);
  assert.equal(receipts().querySelectorAll('li').length, 11); assert.match(receipts().querySelector('summary').textContent, /11/);
  assert.equal(f.host.querySelector('.gcsp-presenter-results > ol'), null, 'no uncollapsed list');
  receipts().open = true; receipts().querySelector('summary').focus(); await settle();
  await f.control.refresh(); await settle();
  assert.equal(receipts().open, true, 'open state survives a readback'); assert.equal(document.activeElement, receipts().querySelector('summary'));
  f.control.destroy();
});
test('FUCQ-204: last tick shows a plain summary and labelled steps, never JSON or the tick id', async () => {
  const ids = ['stock-release', 'manual-claim-expiry', 'buddy-expiry', 'buddy-pending-operations', 'lifecycle-appointments', 'lifecycle-approvals',
    'lifecycle-documents', 'lifecycle-return-appointments', 'renewal-risk-cases', 'selection-order-reconciliation', 'captured-outbox', 'brand-new-handler'];
  const handlerOrder = ids.map((handlerId) => ({ handlerId, stage: 'pending-reconciliation' }));
  const lastTick = { runId: 'run-a', tickId: 'presenter-04d33b80aa', eventId: 'presenter-04d33b80aa', state: 'completed', handlerOrder, missingStages: [],
    outcomes: handlerOrder.map((row) => ({ ...row, outcome: { status: 'ok', value: { orders: 0, kind: 'x' } } })) };
  const f = setup({ readControls: async () => ok({ ...state(), lastTick }) }); await settle();
  const text = f.host.querySelector('.gcsp-presenter-results').textContent;
  assert.doesNotMatch(text, /[{}]|"status"|presenter-04d33b80|brand-new-handler|stock-release/);
  assert.match(text, /Tick completed\. 12 steps: 12 done\./);
  const rows = [...f.host.querySelectorAll('ol li')].map((row) => row.textContent);
  assert.equal(rows[0], 'Stock release: Done.'); assert.equal(rows[10], 'Outbox dispatch: Done.'); assert.equal(rows[11], 'Another step: Done.');
  assert.ok(!/\u2014/.test(text)); f.control.destroy();
});
test('FUCQ-204: unknown tick states and unmapped stages stay plain', async () => {
  const lastTick = { runId: 'run-a', tickId: 't', state: 'weird-internal', handlerOrder: [{ handlerId: 'stock-release', stage: 'release-pull' }],
    outcomes: [{ handlerId: 'stock-release', outcome: { status: 'odd-code' } }], missingStages: ['secret-stage', 'other-stage'] };
  const f = setup({ readControls: async () => ok({ ...state(), lastTick }) }); await settle();
  const text = f.host.querySelector('.gcsp-presenter-results').textContent;
  assert.match(text, /Tick result not confirmed\. 1 step: 1 not confirmed\./); assert.match(text, /Stock release: Not confirmed\./);
  assert.match(text, /Not run this tick: 2 other stages\./); assert.doesNotMatch(text, /weird-internal|odd-code|secret-stage/); f.control.destroy();
});

test('FUCQ-204: every step the hosted runtime registers has a label, so none reads Another step', async () => {
  const { stepLine } = await import('../../blocks/gcsp/presenter-controls/tick-copy.js');
  // Ids from the hosted memory runtime's lastTick readback (docs/gcsp/evidence/fucq-204/results.json).
  for (const handlerId of ['stock-release', 'manual-claim-expiry', 'buddy-expiry', 'lifecycle-appointments', 'lifecycle-approvals', 'lifecycle-documents',
    'lifecycle-return-appointments', 'lifecycle-return-outcomes', 'renewal-risk-cases', 'selection-order-reconciliation', 'buddy-allocation', 'captured-outbox']) {
    assert.doesNotMatch(stepLine({ handlerId }, { handlerId, outcome: { status: 'ok' } }), /Another step/, handlerId);
  }
});

test('FUCQ-240: buddy allocation names how many employees were left out for want of a renewal date', async () => {
  const { stepLine } = await import('../../blocks/gcsp/presenter-controls/tick-copy.js');
  const row = (limitations) => ({ handlerId: 'buddy-allocation', outcome: { status: 'ok', value: { allocations: [], ...(limitations ? { limitations } : {}) } } });
  const left = (n) => stepLine({ handlerId: 'buddy-allocation' }, row([{ code: 'renewal-deadline-unknown', employees: n }]));
  assert.equal(left(1), 'Buddy allocation: Done. 1 employee is left out: no renewal date to set their place in the queue.');
  assert.equal(left(3), 'Buddy allocation: Done. 3 employees are left out: no renewal date to set their place in the queue.');
  for (const bad of [0, -1, 1.5, '2', null]) assert.equal(left(bad), 'Buddy allocation: Done.');
  assert.equal(stepLine({ handlerId: 'buddy-allocation' }, row(null)), 'Buddy allocation: Done.');
  assert.equal(stepLine({ handlerId: 'stock-release' }, row([{ code: 'renewal-deadline-unknown', employees: 2 }])), 'Stock release: Done.');
  assert.doesNotMatch(left(2), /\u2014/);
});

// FUCQ-172: synthetic fault control, truthful journey start, wider catalogue rows.
const faultRows = (stock = 'none', ordering = 'none') => [
  { adapter: 'stock', runId: 'run-a', mode: stock, modes: ['none', 'unavailable', 'stale'] },
  { adapter: 'ordering', runId: 'run-a', mode: ordering, modes: ['none', 'timeout-acknowledged', 'timeout-rejected', 'uncertain-acknowledged', 'uncertain-rejected'] }];
test('fault group shows only supplied adapters, preselects the current mode and sends one exact command', async () => {
  const calls = []; let finish;
  const f = setup({ readFaults: async () => ok({ runId: 'run-a', faults: faultRows('stale').slice(0, 1) }),
    setFault: (payload) => { calls.push(payload); return new Promise((resolve) => { finish = resolve; }); } }); await settle();
  assert.ok(group(f, 'Stock feed fault')); assert.equal(group(f, 'Ordering fault'), null);
  assert.equal(selected(f, 'Stock feed fault'), 'stale'); assert.match(f.host.textContent, /Synthetic faults/);
  assert.match(choice(f, 'Stock feed fault', 'unavailable').textContent, /Stock feed unavailable/);
  assert.match(choice(f, 'Stock feed fault', 'none').textContent, /No fault/);
  choice(f, 'Stock feed fault', 'unavailable').click(); f.click('Set stock feed fault'); f.click('Set stock feed fault');
  assert.deepEqual(calls, [{ commandId: 'command-1', adapter: 'stock', mode: 'unavailable' }]);
  finish(ok({ runId: 'run-a', faults: faultRows('unavailable').slice(0, 1) })); await settle(); f.control.destroy();
});
test('fault success projects the returned mode, dispatches gcsp:presenter-action and clears with plain wording', async () => {
  let rows = faultRows(); const seen = [];
  const f = setup({ readFaults: async () => ok({ runId: 'run-a', faults: rows }),
    setFault: async (payload) => { rows = payload.adapter === 'stock' ? faultRows(payload.mode) : faultRows('none', payload.mode); return ok({ runId: 'run-a', faults: rows }); } });
  await settle(); f.host.addEventListener('gcsp:presenter-action', (event) => seen.push(event.detail.kind));
  choice(f, 'Stock feed fault', 'unavailable').click(); f.click('Set stock feed fault'); await settle();
  assert.match(f.host.textContent, /Stock feed fault set: Stock feed unavailable/); assert.equal(selected(f, 'Stock feed fault'), 'unavailable');
  choice(f, 'Ordering fault', 'timeout-rejected').click(); f.click('Set ordering fault'); await settle();
  assert.match(f.host.textContent, /Ordering fault set: Next handoff times out, provider refused/);
  choice(f, 'Stock feed fault', 'none').click(); f.click('Set stock feed fault'); await settle();
  assert.match(f.host.textContent, /Stock feed fault cleared/); assert.equal(selected(f, 'Stock feed fault'), 'none');
  assert.deepEqual(seen, ['setFault', 'setFault', 'setFault']); f.control.destroy();
});
test('a lost fault response is not uncertain: Set stays usable, a fresh commandId is sent and refusals use plain wording', async () => {
  const calls = []; let reply = { status: 'unavailable', lostResponse: true, retryable: true };
  const f = setup({ readFaults: async () => ok({ runId: 'run-a', faults: faultRows() }), setFault: async (payload) => { calls.push(payload); return reply; } }); await settle();
  choice(f, 'Stock feed fault', 'stale').click(); f.click('Set stock feed fault'); await settle();
  assert.match(f.host.textContent, /Fault change not confirmed\. Press Set again\./);
  assert.equal([...f.host.querySelectorAll('button')].some((b) => b.textContent === 'Retry original action' && !b.hidden), false);
  assert.equal(choice(f, 'Stock feed fault', 'stale').disabled, false);
  f.click('Set stock feed fault'); await settle(); assert.equal(calls.length, 2); assert.notEqual(calls[0].commandId, calls[1].commandId);
  assert.equal(calls[1].mode, 'stale');
  reply = { status: 'forbidden', code: 'raw-code' }; f.click('Set stock feed fault'); await settle();
  assert.match(f.host.textContent, /Action not completed: Not permitted/); assert.doesNotMatch(f.host.textContent, /raw-code|forbidden:/);
  f.control.destroy();
});
const refusedTick = { status: 'unavailable', retryable: true, reason: 'A registered clock handler did not complete. Retry this event ID.' };
test('after a retryable refused tick the fault control stays enabled and clearing it keeps the original retry', async () => {
  const ticks = []; const faultCalls = []; let rows = faultRows('unavailable'); let tickReply = refusedTick;
  const f = setup({ tick: async (payload) => { ticks.push(payload); return tickReply; }, readFaults: async () => ok({ runId: 'run-a', faults: rows }),
    setFault: async (payload) => { faultCalls.push(payload); rows = faultRows(payload.mode); return ok({ runId: 'run-a', faults: rows }); } }); await settle();
  f.click('Next release'); await settle();
  const retry = [...f.host.querySelectorAll('button')].find((b) => b.textContent === 'Retry original action'); assert.equal(retry.hidden, false);
  assert.equal(choice(f, 'Stock feed fault', 'none').disabled, false);
  assert.equal([...f.host.querySelectorAll('button')].find((b) => b.textContent === 'Set stock feed fault').disabled, false);
  assert.equal(f.click('Tick').disabled, true);
  choice(f, 'Stock feed fault', 'none').click(); f.click('Set stock feed fault'); await settle();
  assert.deepEqual(faultCalls, [{ commandId: 'command-2', adapter: 'stock', mode: 'none' }]);
  assert.match(f.host.textContent, /Stock feed fault cleared/); assert.equal(retry.hidden, false); assert.equal(selected(f, 'Stock feed fault'), 'none');
  tickReply = ok({}); retry.click(); await settle();
  assert.equal(ticks.length, 2); assert.strictEqual(ticks[0], ticks[1]); assert.equal(ticks[1].commandId, 'command-1');
  assert.equal(retry.hidden, true); f.control.destroy();
});
test('fault group is hidden when the read fails or reports no faults, and unknown modes fall back to the id', async () => {
  for (const readFaults of [async () => ({ status: 'unavailable' }), async () => ok({ runId: 'run-a', faults: [] }), undefined]) {
    const f = setup(readFaults ? { readFaults } : {}); await settle();
    assert.doesNotMatch(f.host.textContent, /Synthetic faults/); assert.equal(group(f, 'Stock feed fault'), null);
    assert.equal([...f.host.querySelectorAll('button')].some((b) => /^Set .* fault$/.test(b.textContent) && !b.closest('[hidden]')), false);
    f.control.destroy();
  }
  const f = setup({ readFaults: async () => ok({ runId: 'run-a', faults: [{ adapter: 'stock', mode: 'none', modes: ['none', 'half-open'] }] }) }); await settle();
  assert.match(choice(f, 'Stock feed fault', 'half-open').textContent, /half open/); f.control.destroy();
});
test('HTTP adapter reads faults with GET and sets them with a credentialled JSON POST', async () => {
  const calls = []; const adapter = http({ fetchImpl: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ status: 'ok', value: { faults: [] } }) }; } });
  const body = { commandId: 'c', adapter: 'stock', mode: 'stale' };
  await adapter.readFaults(); await adapter.setFault(body);
  assert.match(calls[0][0], /\/api\/gcsp\/presenter\/scenarios\/faults$/); assert.equal(calls[0][1].method, 'GET');
  assert.match(calls[1][0], /\/api\/gcsp\/presenter\/scenarios\/faults$/); assert.equal(calls[1][1].method, 'POST');
  assert.equal(calls[1][1].credentials, 'include'); assert.deepEqual(JSON.parse(calls[1][1].body), body);
});
test('reset with a failed journey start state stays on the strip, names the step and reason, and continues on request', async () => {
  const f = setup({ reset: async () => ok({ runId: 'run-new', startState: { status: 'unavailable', step: 'offer-seed', reason: 'Offer service not composed' } }) }); await settle();
  f.click('Reset scenario'); f.click('Confirm reset'); await settle();
  assert.equal(f.navigation.length, 0);
  assert.match(f.host.textContent, /Reset done\. New run: run-new\. The scenario start stopped at offer-seed: Offer service not composed/);
  f.click('Continue to workspace'); assert.equal(f.navigation.length, 1); assert.match(f.navigation[0], /gcsp-presenter\.html$/);
  f.control.destroy();
  const bare = setup({ reset: async () => ok({ runId: 'run-x', startState: { status: 'failed' } }) }); await settle();
  bare.click('Reset scenario'); bare.click('Confirm reset'); await settle();
  assert.match(bare.host.textContent, /stopped at an unreported step: reason not supplied/); bare.control.destroy();
});
test('reset with an ok or absent start state still navigates and offers no continue button', async () => {
  for (const startState of [{ status: 'ok' }, undefined]) {
    const f = setup({ reset: async () => ok({ runId: 'run-new', ...(startState ? { startState } : {}) }) }); await settle();
    f.click('Reset scenario'); f.click('Confirm reset'); await settle();
    assert.equal(f.navigation.length, 1); assert.doesNotMatch(f.host.textContent, /stopped at/);
    assert.equal([...f.host.querySelectorAll('button')].find((b) => b.textContent === 'Continue to workspace').hidden, true); f.control.destroy();
  }
});
test('wider catalogue rows: available decline-then-change-waiting resets, unavailable offer-expires explains and blocks reset', async () => {
  const wide = { policyVersion: 'policy-test', scenarios: [...catalogue.scenarios,
    { scenarioId: 'decline-then-change-waiting', name: 'Decline then change waiting', scenarioVersion: 'v1', fixtureVersion: 'f1', availability: { available: true } },
    { scenarioId: 'offer-expires', name: 'Offer expires', scenarioVersion: 'v1', fixtureVersion: 'f1', availability: { available: false, missingCapabilities: ['offer-expiry-handler'] } }] };
  const f = setup({ readScenarios: async () => ok(wide) }); await settle();
  assert.match(choice(f, 'Scenario', 'decline-then-change-waiting').textContent, /Decline then change waiting.*Available/);
  assert.match(choice(f, 'Scenario', 'offer-expires').textContent, /Not available yet: offer-expiry-handler/);
  choice(f, 'Scenario', 'offer-expires').click(); assert.equal(f.click('Reset scenario').disabled, true); assert.equal(f.calls.length, 0);
  choice(f, 'Scenario', 'decline-then-change-waiting').click(); assert.equal(f.click('Reset scenario').disabled, false);
  f.click('Confirm reset'); await settle(); assert.equal(f.calls[0].scenarioId, 'decline-then-change-waiting'); f.control.destroy();
});
