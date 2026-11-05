import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
let mount; let workspace; let http; let dom;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'customElements']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
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
function setup(overrides = {}) {
  const host = document.createElement('div'); document.body.append(host); let ids = 0; const calls = [];
  const adapter = { readControls: async () => ok(state()), readContext: async () => ok({ principalId: 'employee-test', name: 'Employee test', roles: ['employee'] }),
    readScenarios: async () => ok(catalogue), tick: async (payload) => { calls.push(payload); return ok({}); },
    reset: async (payload) => { calls.push(payload); return ok({ runId: 'run-new' }); }, switchPrincipal: async () => ok({}), ...overrides };
  const navigation = []; const control = mount(host, { adapter, commandId: () => `command-${++ids}`, navigate: (url) => navigation.push(url) });
  const click = (label) => { const node = [...host.querySelectorAll('button')].find((row) => row.textContent === label || row.textContent.startsWith(label + ' (')); assert.ok(node, label); node.click(); return node; };
  return { host, adapter, control, click, calls, navigation };
}
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
  const rows = [...f.host.querySelectorAll('ol li')].map((row) => row.textContent); assert.match(rows[0], /first/); assert.match(rows[1], /second.*Pending/);
  assert.match(f.host.textContent, /Missing stages: manual-expiry/); assert.match(f.host.textContent, /Release unavailable/); assert.doesNotMatch(f.host.textContent, /0 cars/);
  f.control.destroy();
});
test('only an actual successful release handler supplied count is shown', async () => {
  const f = setup({ readControls: async () => ok({ ...state(), lastTick: { state: 'completed', handlerOrder: [], outcomes: [{ stage: 'release-pull', outcome: ok({ released: 3 }) }] } }) });
  await settle(); assert.match(f.host.textContent, /3 cars released/); f.control.destroy();
});
test('reset current/chosen availability is explained and explicit confirmation captures canonical versions', async () => {
  const f = setup(); await settle(); const select = f.host.querySelector('select');
  select.value = 'business'; select.dispatchEvent(new window.Event('change')); assert.match(f.host.textContent, /actual-release-service/);
  assert.equal(f.click('Reset scenario').disabled, true); assert.equal(f.calls.length, 0);
  select.value = 'mechanics'; select.dispatchEvent(new window.Event('change')); f.click('Reset scenario'); assert.equal(f.calls.length, 0);
  f.click('Cancel reset'); assert.equal(f.calls.length, 0); f.click('Reset scenario'); f.click('Confirm reset'); await settle();
  assert.deepEqual(f.calls[0], { commandId: 'command-1', expectedRunId: 'run-a', expectedRunVersion: 1,
    scenarioId: 'mechanics', scenarioVersion: 'v1', fixtureVersion: 'f1', policyVersion: 'policy-test' });
  assert.match(f.host.textContent, /Reset done. New run: run-new/); f.control.destroy();
});
test('cookie issuance conflict confirms actual principal before navigation; unknown context offers fresh deliberate issuance', async () => {
  const calls = []; const f = setup({ switchPrincipal: async (payload) => { calls.push(payload); return { status: 'conflict', reason: 'Cookie cannot replay' }; } });
  await settle(); const principal = f.host.querySelectorAll('select')[1]; principal.value = 'greg-test';
  f.click('Switch principal'); await settle(); assert.equal(f.navigation.length, 0); assert.match(f.host.textContent, /Switch uncertain or refused/);
  f.click('Retry original action'); await settle(); assert.strictEqual(calls[0], calls[1]);
  f.adapter.readContext = async () => ok({ principalId: 'greg-test', name: 'Greg test', roles: ['greg'] });
  f.click('Issue selected principal again'); await settle(); assert.notEqual(calls[0].commandId, calls[2].commandId);
  assert.match(f.navigation[0], /gcsp-presenter.html$/); assert.doesNotMatch(f.navigation[0], /\?/); f.control.destroy();
});
test('destroy aborts and ignores late readback', async () => {
  let finish; const f = setup({ readControls: () => new Promise((resolve) => { finish = resolve; }) });
  f.control.destroy(); finish(ok(state())); await settle(); assert.equal(f.host.children.length, 0);
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
test('HTTP transport sends credentialled exact JSON and keeps typed refusal distinct from lost response', async () => {
  const calls = []; const payload = { commandId: 'same', mode: 'step', expectedClockVersion: '1' };
  const adapter = http({ fetchImpl: async (...args) => { calls.push(args); return { ok: false, json: async () => ({ status: 'forbidden', reason: 'Denied' }) }; } });
  assert.equal((await adapter.tick(payload)).status, 'forbidden'); assert.equal(calls[0][1].credentials, 'include'); assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  const lost = http({ fetchImpl: async () => { throw new Error('offline'); } }); assert.equal((await lost.tick(payload)).lostResponse, true);
});


test('reset readback failure preserves new run and failed session-renewal instruction', async () => {
  let reads = 0; let contexts = 0;
  const f = setup({ readControls: async () => ++reads === 1 ? ok(state()) : { status: 'unavailable', reason: 'Read failed' },
    readContext: async () => { contexts++; return contexts === 1 ? ok({ principalId: 'employee-test', roles: ['employee'] }) : { status: 'stale-run' }; },
    reset: async () => ok({ runId: 'run-new', now: '2026-11-05T09:00:00.000Z', presenterSession: { status: 'unavailable', action: 'Use trusted bootstrap.' } }) });
  await settle(); f.click('Reset scenario'); f.click('Confirm reset'); await settle();
  assert.match(f.host.textContent, /Reset done. New run: run-new/); assert.match(f.host.textContent, /Use trusted bootstrap/);
  assert.match(f.host.textContent, /Read failed/); assert.match(f.host.textContent, /Context unavailable/); assert.equal(contexts, 2); f.control.destroy();
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
  await settle(); f.click('Tick'); await settle(); assert.match(f.host.textContent, /latest-server-tick/); assert.doesNotMatch(f.host.textContent, /older-action/); f.control.destroy();
});


test('invalid target presents backend field explanations without unrelated diagnostic fields', async () => {
  const f = setup({ tick: async () => ({ status: 'invalid', code: 'invalid-clock-command', reasons: [
    { field: 'to', reason: 'Choose a configured named time or a future UTC ISO instant.', diagnostic: 'unrelated-internal-marker' },
    { field: 'to', reason: 'The target must be later than the current DemoClock.' },
  ] }) });
  await settle(); const input = f.host.querySelector('input'); input.value = 'yesterday'; input.dispatchEvent(new window.Event('input'));
  f.click('Tick to target'); await settle();
  assert.match(f.host.textContent, /invalid-clock-command/);
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
  assert.match(f.host.textContent, /known-pending-tick/); assert.match(f.host.textContent, /awaiting-confirmation/);
  assert.match(f.host.textContent, /Missing stages: release-pull/);
  const originalRetry = [...f.host.querySelectorAll('button')].find((row) => row.textContent === 'Retry original action');
  assert.equal(originalRetry.hidden, true);
  const nextTick = [...f.host.querySelectorAll('button')].find((row) => row.textContent.startsWith('Tick ('));
  assert.equal(nextTick.disabled, false); nextTick.click(); await settle();
  assert.equal(ticks.length, 2); assert.notEqual(ticks[0].commandId, ticks[1].commandId);
  assert.match(f.host.textContent, /awaiting-confirmation/);
  assert.equal(f.click('Reset scenario').disabled, false); f.click('Confirm reset'); await settle();
  assert.equal(resets.length, 1); assert.notEqual(resets[0].commandId, ticks[1].commandId);
  assert.match(f.host.textContent, /Reset done. New run: run-after-pending/); f.control.destroy();
});
