import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom; let section; let consoleMod;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://matrix.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  section = await import('../../blocks/gcsp/presenter-controls/suitability-section.js');
  consoleMod = await import('../../blocks/gcsp/presenter-controls/console.js');
});
beforeEach(() => { document.body.replaceChildren(); window.sessionStorage.clear(); window.localStorage.clear(); });
after(() => dom.window.close());
const ok = (value) => ({ status: 'ok', value });
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 1)); };
const cell = (employeeId, extra = {}) => ({ employeeId, state: 'evaluated', score: 82, gateStatus: 'eligible', blockers: [], unknowns: [],
  reasons: [{ code: 'policy-include' }, { code: 'allowance-sufficient' }], outdated: false,
  recorded: { evaluatedAt: '2026-11-05T12:00:00.000Z', briefVersion: 1, policyVersion: 'p1', allocationRule: 'renewalDueThenFitThenSeededLottery' },
  outcome: { state: 'not-assigned' }, ...extra });
const view = (extra = {}) => ({ runId: 'run-a', asOf: '2026-11-05T12:00:00.000Z', release: 'all',
  policy: { minimumFit: null, version: 'p1', allocationRule: 'renewalDueThenFitThenSeededLottery' },
  paging: { cars: { page: 1, pages: 2, total: 10, size: 8 }, buddies: { page: 1, pages: 2, total: 6, size: 4 } },
  buddies: [{ id: 'paula', name: 'Paula Mason', briefVersion: 1 }, { id: 'alex', name: 'Alex Grant', briefVersion: 1 }],
  people: [{ id: 'sam', name: 'Sam Cooper' }],
  cars: [{ id: 'car-a', name: 'BMW 320i Touring', orderNumber: '0000001', colour: 'White', availability: { state: 'reserved', employeeId: 'sam', employeeName: 'Sam Cooper', route: 'buddy' },
    cells: [cell('paula', { outcome: { state: 'assigned', employeeId: 'sam' } }), cell('alex', { score: null, gateStatus: 'ineligible', blockers: [{ code: 'essential-unmet', field: 'seats', requirement: { operator: 'gte', value: 5 } }] })] },
  { id: 'car-b', name: 'BMW 320i Touring', orderNumber: '0000002', colour: 'Black', availability: { state: 'available' }, cells: [cell('paula', { score: 0 }), { employeeId: 'alex', state: 'not-evaluated' }] }], ...extra });
function mount(read = async () => ok(view())) {
  const host = document.createElement('div'); document.body.append(host); const calls = [];
  const adapter = { readSuitability: (input) => { calls.push(input); return read(input); } };
  const api = section.mountSuitabilitySection(host, { adapter });
  const open = async () => { api.root.querySelector('details').open = true; api.root.querySelector('details').dispatchEvent(new window.Event('toggle')); await api.refresh(); };
  return { host, api, calls, open };
}
const cells = (root) => [...root.querySelectorAll('.gcsp-suitability-cell')];
const buttonNamed = (root, label) => [...root.querySelectorAll('button')].find((n) => n.textContent === label);

test('collapsed by default, lazy until opened, native table/caption and honest passing score', async () => {
  const f = mount(); await f.api.update({ runId: 'run-a' });
  assert.equal(f.calls.length, 0); assert.equal(f.api.root.querySelector('details').open, false);
  await f.open();
  assert.equal(f.calls.length, 1); assert.match(f.api.root.textContent, /No minimum fit score is set/);
  assert.match(f.api.root.textContent, /Earlier renewal date, then better fit/);
  assert.match(f.api.root.textContent, /Fit is out of 100, not the chance of an offer/);
  assert.equal(f.api.root.querySelectorAll('table').length, 1);
  assert.equal(f.api.root.querySelector('caption').textContent, 'Released cars × engaged Buddies');
  assert.equal(f.api.root.querySelectorAll('th[scope="row"]').length, 2);
  assert.match(cells(f.api.root)[0].getAttribute('aria-label'), /order 0000001.*Paula Mason.*82\/100.*Matched to Sam Cooper/);
  assert.match(cells(f.api.root)[2].textContent, /0\/100/); assert.match(cells(f.api.root)[3].textContent, /Not evaluated/);
  assert.doesNotMatch(cells(f.api.root)[1].textContent, /0\/100/); f.api.destroy();
});

test('cell buttons select one pair, expose requirements and separate recorded allocation from the car now', async () => {
  const f = mount(); await f.open(); const buttons = cells(f.api.root);
  buttons[0].focus(); buttons[0].click();
  assert.equal(document.activeElement, buttons[0]); assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  const details = document.getElementById(buttons[0].getAttribute('aria-controls'));
  assert.match(details.textContent, /This car was matched to Sam Cooper/);
  assert.match(details.textContent, /Reserved for Sam Cooper through Buddy/);
  assert.match(details.textContent, /Brief 1 · Policy p1/);
  buttons[1].click(); assert.equal(buttons[0].getAttribute('aria-pressed'), 'false'); assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
  assert.match(details.textContent, /Does not meet the employee’s seats requirement/); assert.match(details.textContent, /Seats at least 5/);
  buttons[3].click(); assert.match(details.textContent, /No recorded evaluation/); assert.match(details.textContent, /No fit score is available/);
  assert.doesNotMatch(details.textContent, /Recorded checks and preferences/); f.api.destroy();
});

test('unscored passes, unknown gates and older results are distinct', async () => {
  const data = view(); data.cars[0].cells[0] = cell('paula', { score: null, outdated: true });
  data.cars[0].cells[1] = cell('alex', { score: null, gateStatus: 'needs-confirmation', unknowns: [{ code: 'charging-unconfirmed' }] });
  const f = mount(async () => ok(data)); await f.open();
  assert.match(cells(f.api.root)[0].textContent, /Passed · unscored.*Earlier result/);
  cells(f.api.root)[0].click(); const details = f.api.root.querySelector('.gcsp-suitability-details');
  assert.match(details.textContent, /Earlier result/); assert.match(details.textContent, /did not produce a numeric fit score/);
  assert.match(cells(f.api.root)[1].textContent, /Needs confirmation/); cells(f.api.root)[1].click();
  assert.match(details.textContent, /Information gaps/); assert.match(details.textContent, /Charging access is unknown/); f.api.destroy();
});

test('release selector and both page controls issue scoped reads and preserve keyboard focus', async () => {
  const f = mount(async (input) => {
    const result = view(); result.paging.cars.page = input.page; result.paging.buddies.page = input.buddyPage;
    return ok(result);
  }); await f.open();
  buttonNamed(f.api.root, 'Next cars').click(); await settle();
  assert.equal(f.calls.at(-1).page, 2); assert.equal(document.activeElement.textContent, 'Previous cars');
  buttonNamed(f.api.root, 'Next buddies').click(); await settle(); assert.equal(f.calls.at(-1).buddyPage, 2);
  const filter = f.api.root.querySelector('select'); filter.value = 'latest'; filter.dispatchEvent(new window.Event('change')); await settle();
  assert.equal(f.calls.at(-1).release, 'latest'); assert.equal(f.calls.at(-1).page, 1); assert.equal(f.calls.at(-1).buddyPage, 1);
  f.api.destroy();
});

test('refresh coalesces reads; release invalidation drops old replies; destroy aborts owned work', async () => {
  const pending = []; const f = mount(() => new Promise((resolve) => pending.push(resolve)));
  const opening = f.open(); const duplicate = f.api.refresh(); assert.equal(f.calls.length, 1);
  f.api.setLoading(); assert.equal(f.calls[0].signal.aborted, true);
  const next = f.api.refresh(); assert.equal(f.calls.length, 2);
  pending[1](ok(view())); await next;
  pending[0](ok(view({ cars: [], buddies: [] }))); await opening; await duplicate;
  assert.equal(cells(f.api.root).length, 4);
  const dying = f.api.refresh(); f.api.destroy(); assert.equal(f.calls[2].signal.aborted, true);
  pending[2](ok(view())); await dying; assert.equal(f.host.children.length, 0);
});

test('new run clears selection/pages and closes the disclosure; replies for another run cannot paint', async () => {
  const f = mount(); await f.api.update({ runId: 'run-a' }); await f.open(); cells(f.api.root)[0].click();
  await f.api.update({ runId: 'run-b' }); assert.equal(f.api.root.querySelector('details').open, false);
  assert.equal(f.api.root.querySelector('table'), null);
  await f.open(); assert.match(f.api.root.textContent, /Car suitability unavailable/);
  assert.equal(f.api.root.querySelector('table'), null); f.api.destroy();
});

test('an advanced clock readback invalidates a request already in flight', async () => {
  const pending = []; const f = mount(() => new Promise((resolve) => pending.push(resolve)));
  await f.api.update({ runId: 'run-a', clockVersion: '1' });
  const old = f.open();
  const current = f.api.update({ runId: 'run-a', clockVersion: '2' });
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].signal.aborted, true);
  pending[1](ok(view())); await current;
  pending[0](ok(view({ cars: [] }))); await old;
  assert.equal(cells(f.api.root).length, 4); f.api.destroy();
});

test('failures retry and empty states stay useful', async () => {
  let failing = true;
  const f = mount(async () => failing ? { status: 'unavailable' } : ok(view({ cars: [], buddies: [] })));
  await f.open(); assert.match(f.api.root.textContent, /Car suitability unavailable/);
  failing = false; buttonNamed(f.api.root, 'Retry suitability').click(); await settle();
  assert.match(f.api.root.textContent, /No cars released yet/); assert.equal(f.api.root.querySelector('table'), null); f.api.destroy();
  const g = mount(async () => ok(view({ buddies: [] }))); await g.open(); assert.match(g.api.root.textContent, /No engaged Buddies/); g.api.destroy();
});

test('console positions the collapsed disclosure between Allocation and What happened, and refreshes after release', async () => {
  const host = document.createElement('div'); document.body.append(host); let reads = 0; let clockVersion = '1';
  const state = () => ({ runId: 'run-a', clockVersion, now: '2026-11-05T09:00:00.000Z', controls: { nextRelease: { status: 'available' } } });
  const adapter = { readControls: async () => ok(state()), readSuitability: async () => { reads += 1; return ok(view()); } };
  const api = consoleMod.mountPresenterConsole(host, { adapter, onRelease: async (ctx) => { clockVersion = '2'; await ctx.refresh(); } });
  await api.ready;
  const stage = host.querySelector('.gcsp-console-stage'); const release = stage.querySelector('.gcsp-console-release');
  const suitability = stage.querySelector('.gcsp-suitability');
  assert.equal(release.nextElementSibling, suitability); assert.match(suitability.nextElementSibling.textContent, /What happened/);
  assert.equal(reads, 0); suitability.querySelector('details').open = true;
  suitability.querySelector('details').dispatchEvent(new window.Event('toggle')); await settle(); assert.equal(reads, 1);
  api.basic.release.click(); await settle(); assert.equal(reads, 2); assert.equal(cells(suitability).length, 4);
  api.destroy();
});
