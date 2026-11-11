import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { toAccountView, toDraftView } from '../../blocks/gcsp/account/account-view.js';
import { createAccountHttpAdapter } from '../../blocks/gcsp/account/http-adapter.js';
import { ACCOUNT_SNAPSHOT, FIXTURE_NAMES, accountFixture } from '../../blocks/gcsp/account/fixtures.js';
import { orderProgressFixtures } from '../../blocks/gcsp/order-progress/fixtures.js';

const instant = '2026-11-05T09:00:00.000Z';
async function setup({ seed = true, principal = 'demo-paula' } = {}) {
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => instant }); await repository.open();
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'account-snapshot', environmentKind: 'synthetic',
    policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, principal, 'account-test');
  const context = acting.value.context;
  const f = { repository, policy, clock, identity, presenter, acting, context };
  if (seed) assert.equal((await seedManualDemoContext(f)).status, 'ok');
  f.service = new ManualContextService({ ...f, ports: createRepositoryManualPorts(f) });
  return f;
}

test('browser snapshot agrees with the real manual service and canonical policy', async () => {
  const f = await setup(); const account = await f.service.readAccount(f.context);
  const stable = (envelope) => {
    const value = structuredClone(envelope); delete value.value.contextVersion;
    for (const slot of value.value.slots) delete slot.runId;
    return value;
  };
  assert.deepEqual(stable(ACCOUNT_SNAPSHOT), stable(account));
  const unsupported = await setup({ principal: 'demo-sam' });
  assert.deepEqual(stable(accountFixture('unsupported-scheme')), stable(await unsupported.service.readAccount(unsupported.context)));
  const policy = await f.policy.getAssumption('manual.context.v1', { runId: f.context.runId, asOf: instant, policyVersion: f.context.policyVersion });
  assert.deepEqual(account.value.choices.contractOptions, policy.value.value.contractOptions);
  assert.deepEqual(toAccountView(account).allowance, account.value.allowance);
});

test('pure account model retains supplied account, drivers, contract facts, history and provenance', () => {
  const input = accountFixture('multi-slot');
  Object.assign(input.value.account, { dateOfBirth: '1990-01-01', company: 'Fictional Company with a Long Name',
    allowanceOverrideEndDate: '2026-12-01' });
  Object.assign(input.value.contracts[0], { vin: 'ZZSYNTHETIC000001', orderNumber: '7654321', configurationId: 'synthetic-current-config',
    terms: { kind: 'points-monthly', value: 1100, allowance: 1300 }, technical: { assurance: 'model-level', fittedEquipment: null } });
  const original = structuredClone(input); const view = toAccountView(input);
  assert.equal(view.state, 'ready-replacement'); assert.equal(view.currentContracts.length, 2);
  assert.equal(view.primaryContract.daysRemaining, 26); assert.equal(view.asOf, instant);
  assert.deepEqual(view.account, input.value.account); assert.deepEqual(view.drivers, input.value.drivers);
  assert.equal(view.additionalDrivers[0].licence.displayNumber, 'WARD9900000CW9XX');
  assert.equal(view.currentContracts[0].vin, 'ZZSYNTHETIC000001'); assert.equal(view.currentContracts[0].orderNumber, '7654321');
  assert.equal(view.currentContracts[0].terms.value, 1100); assert.equal(view.currentContracts[0].technical.assurance, 'model-level');
  assert.equal(view.currentContracts[0].facts.find((row) => row.label === 'Current mileage').value, 5200);
  assert.equal(view.currentContracts[1].action, null); assert.equal(view.slots[1].action, null);
  assert.equal(view.slots[1].ordering.reason, 'outside-trusted-context');
  assert.equal(view.histories[1].count, 2); assert.equal(view.histories[1].orderingSupported, false);
  assert.ok(view.currentContracts[1].model.length > 70);
  assert.deepEqual(view.versions, input.value.versions); assert.deepEqual(input, original);
});

test('new orders, no history and missing facts remain explicit without fabricated dates or imagery', () => {
  const view = toAccountView(accountFixture('no-current-car'));
  assert.equal(view.state, 'ready-new'); assert.equal(view.contractState, 'no-current-car');
  assert.equal(view.historyState, 'no-history'); assert.equal(view.primaryContract, null);
  assert.equal(view.actions[0].oldContractId, null);
  assert.equal(toAccountView(accountFixture('no-history')).historyState, 'no-history');
  const missing = accountFixture('missing-image'); delete missing.value.asOf;
  const model = toAccountView(missing);
  assert.equal(model.primaryContract.media, null); assert.equal(model.primaryContract.daysRemaining, null);
  assert.equal(model.primaryContract.facts.find((row) => row.label === 'Delivered VIN').value, null);
  assert.equal(model.identityFacts.find((row) => row.label === 'Date of birth').missingLabel, 'Not supplied');
});

test('all difficult account states retain typed failures and support ownership', () => {
  for (const state of FIXTURE_NAMES.filter((name) => !['ready', 'multi-slot', 'missing-image', 'no-current-car', 'no-history'].includes(name))) {
    const envelope = accountFixture(state); const view = toAccountView(envelope);
    assert.equal(view.state, state); assert.deepEqual(view.actions, []);
    assert.equal(view.supportOwner, 'scheme-support');
    if (envelope.status !== 'ok') assert.deepEqual(view.failure, envelope);
  }
  assert.equal(accountFixture('unknown'), null);
  for (const status of ['stale-run', 'unknown-session', 'access-required']) {
    assert.equal(toAccountView({ status, view: { supportOwner: 'employee', action: 'reopen-session' } }).state, 'restarted');
    assert.equal(toDraftView({ status }).state, 'restarted');
  }
  assert.equal(toAccountView({ status: 'forbidden' }).state, 'refused');
  assert.equal(toAccountView({ status: 'ok', value: { state: 'unknown-grade', actions: [] } }).state, 'unsupported-scheme');
});

test('draft projection preserves intent and refresh semantics across reload', () => {
  const draft = { status: 'ok', value: { draftStage: 'intent', choices: { mode: 'replacement', oldContractId: 'old',
    slotId: 'slot', schemeId: 'scheme' }, draftVersion: 3, contextVersion: 'context', requiresRefresh: false,
  view: { state: 'draft', action: 'choose-order-options' } } };
  assert.equal(toDraftView(draft).state, 'intent');
  assert.deepEqual(toAccountView(accountFixture(), { draft }).draft.draft.choices, draft.value.choices);
  draft.value.requiresRefresh = true;
  assert.equal(toDraftView(draft).state, 'context-changed');
  assert.equal(toDraftView({ status: 'not-found', resourceType: 'manual-draft' }).state, 'not-found');
});

const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, async json() { return structuredClone(body); } });
test('HTTP transport uses fixed endpoints, cookies and exact intent body; server failures pass through', async () => {
  const calls = []; const account = accountFixture();
  const saved = { status: 'ok', value: { draftStage: 'intent', draftVersion: 1, choices: { mode: 'replacement' } } };
  const adapter = createAccountHttpAdapter({ fetchImpl: async (url, options) => {
    calls.push({ url, options }); return response(options.method === 'POST' ? saved : url.endsWith('/account') ? account : { status: 'not-found' },
      url.endsWith('/draft') && options.method === 'GET' ? 404 : 200);
  } });
  assert.deepEqual(await adapter.readAccount(), account); assert.equal((await adapter.readDraft()).status, 'not-found');
  assert.deepEqual(await adapter.startJourney({ account, action: account.value.actions[0], commandId: 'start' }), saved);
  assert.deepEqual(calls.map((call) => call.url), ['/api/gcsp/manual/account', '/api/gcsp/manual/draft', '/api/gcsp/manual/draft']);
  for (const call of calls) assert.equal(call.options.credentials, 'include');
  const body = JSON.parse(calls[2].options.body);
  assert.deepEqual(body, { commandId: 'start', expectedDraftVersion: 0, expectedContextVersion: account.value.contextVersion,
    choices: { mode: 'replacement', oldContractId: 'current:employee-paula', slotId: 'slot-paula', schemeId: 'choices-fs-uk' } });
  assert.equal(calls[2].options.headers['Content-Type'], 'application/json');
  const failure = { status: 'stale-version', currentVersion: 2, resource: 'manual-draft', view: { action: 'refresh-review' } };
  const failed = createAccountHttpAdapter({ fetchImpl: async () => response(failure, 409) });
  assert.deepEqual(await failed.saveDraft(body), failure);
  assert.deepEqual((await failed.loadAccount()).envelope, failure);
});

test('HTTP journey start refuses missing actions and refuses stale or failed reloads', async () => {
  let writes = 0;
  const adapter = createAccountHttpAdapter({ fetchImpl: async () => { writes += 1; return response({ status: 'ok', value: {} }); } });
  const account = accountFixture(); const action = account.value.actions[0];
  for (const changed of [{ ...action, slotId: 'other' }, { ...action, oldContractId: 'other' }, { ...action, action: 'order' }]) {
    assert.equal((await adapter.startJourney({ account, action: changed, commandId: 'invalid' })).status, 'invalid');
  }
  assert.equal((await adapter.startJourney({ account, action, draft: { status: 'ok', value: { requiresRefresh: true } } })).status, 'stale-version');
  assert.equal((await adapter.startJourney({ account, action, draft: { status: 'unavailable' } })).status, 'unavailable');
  assert.equal(writes, 0);
});

test('FUCQ-198: a 401 without a status becomes access-required; one with a status passes through', async () => {
  const gate = createAccountHttpAdapter({ fetchImpl: async () => response({ error: 'Unauthorized' }, 401) });
  assert.deepEqual(await gate.readAccount(), { status: 'access-required' });
  assert.deepEqual(await gate.readDraft(), { status: 'access-required' });
  assert.deepEqual(await gate.saveDraft({ commandId: 'c' }), { status: 'access-required' });
  const unknown = createAccountHttpAdapter({ fetchImpl: async () => response({ status: 'unknown-session' }, 401) });
  assert.deepEqual(await unknown.readAccount(), { status: 'unknown-session' });
  const broken = createAccountHttpAdapter({ fetchImpl: async () => response({ error: 'x' }, 500) });
  assert.equal((await broken.readAccount()).status, 'unavailable');
});

test('transport and malformed HTTP failures never claim success; cancellation remains cancellation', async () => {
  for (const fetchImpl of [async () => { throw Error('offline'); }, async () => ({ status: 502, async json() { throw Error('html'); } }),
    async () => response({ status: 'ok', value: {} }, 503), async () => response({ status: 'ok', value: {} }), async () => response(null)]) {
    const result = await createAccountHttpAdapter({ fetchImpl }).readAccount(); assert.equal(result.status, 'unavailable');
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createAccountHttpAdapter({ fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError'); } })
    .readAccount({ signal: controller.signal }), { name: 'AbortError' });
});

test('real HTTP account action persists an intent, reloads it and carries supplied context into later options', async () => {
  const f = await setup(); const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspManual: f.service,
    gcspAllowedOrigins: ['https://account.test'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const cookies = [f.acting.value.setCookie].flat().map((value) => value.split(';')[0]).join('; ');
  const adapter = createAccountHttpAdapter({ base: `http://127.0.0.1:${server.address().port}`,
    fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://account.test', cookie: cookies } }) });
  try {
    const account = await adapter.readAccount(); const empty = await adapter.readDraft();
    const saved = await adapter.startJourney({ account, action: account.value.actions[0], draft: empty, commandId: 'actual-start' });
    assert.equal(saved.status, 'ok'); assert.equal(saved.value.draftStage, 'intent');
    const reload = await adapter.readDraft();
    assert.deepEqual(reload.value.choices, saved.value.choices); assert.equal(toDraftView(reload).state, 'intent');
    assert.equal(toAccountView(await adapter.readAccount()).primaryContract.contractEndDate, '2026-12-01');
    const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.context.employeeId } };
    await f.repository.transaction(f.context, { commandId: 'source-change', inputDigest: inputDigest('source-change') }, async (tx) => {
      const employee = await tx.get(ref); const contract = structuredClone(employee.value.contract);
      contract.manualContext.source.sourceVersion = 'account-v2'; return tx.compareAndSwap(ref, employee.value.version, { contract });
    });
    assert.equal(toDraftView(await adapter.readDraft()).state, 'context-changed');
  } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
});

// DOM tests exercise the controller against the same service and HTTP projection as the account seam.
const { JSDOM } = await import('jsdom');
const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://account.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException']) {
  Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true, writable: true });
}
const { mountAccount, defineGcspAccount } = await import('../../blocks/gcsp/account/gcsp-account.js');
const tick = () => new Promise((done) => setTimeout(done, 0));
// Matches the accessible name: slot buttons show the time and carry the full name in aria-label (FUCQ-299).
const findLink = (root, text) => [...root.querySelectorAll('a')].find((node) => node.textContent === text);
const findButton = (root, text) => [...root.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') ?? node.textContent) === text);
const rowsOf = (root) => [...root.querySelectorAll('.gcsp-account-history tbody tr')];
const cellsOf = (tr) => [...tr.children].map((cell) => cell.textContent);
const openRecord = (root, index = 0) => { root.querySelectorAll('.gcsp-account-history tbody .gcsp-table-action')[index].click(); return root.querySelector('.gcsp-side-drawer-panel'); };
// Records open only from the Order history table, below Your preferences.
const openFrom = (root, index = 0) => openRecord(root, index);
// The history table opens records from the history entry, a copy of the current contract.
const mirrorHistory = (input, index = 0) => { const entries = input.value.histories.flatMap((h) => h.entries); const id = input.value.contracts[index].contractId; Object.assign(entries.find((e) => e.contractId === id), structuredClone(input.value.contracts[index])); };
const pointsCosts = (scope) => [...scope.querySelectorAll('dl > div')].filter((d) => d.querySelector('dt').textContent === 'Points cost').map((d) => d.querySelector('dd').textContent);
const pointsCost = (scope) => pointsCosts(scope)[0];
const sectionOf = (drawer, title) => [...drawer.querySelectorAll('.gcsp-record-section')].find((node) => node.querySelector('h3').textContent === title);
const detailsRow = (root, label) => [...root.querySelectorAll('.gcsp-account-row')].find((node) => node.querySelector('h3').textContent.startsWith(label));
// Fixtures carry the policy stand-in scheme names; most render tests cover the unnamed "Scheme N" fallback.
const unnamed = (name) => { const input = accountFixture(name); for (const history of input.value.histories) delete history.label; return input; };
const readOnlyAdapter = (name = 'ready') => ({ readAccount: async () => unnamed(name),
  readDraft: async () => ({ status: 'not-found' }), startJourney: async () => ({ status: 'unavailable' }) });
function domHost() { const node = document.createElement('div'); document.body.append(node); return node; }
async function domMount(adapter = readOnlyAdapter(), options = {}) {
  const root = domHost(); const destroy = mountAccount(root, { adapter, ...options }); await tick();
  return { root, destroy };
}
function serviceAdapter(f, calls = []) {
  return createAccountHttpAdapter({ fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    if (url.endsWith('/activity')) return response({ status: 'unavailable' }, 503);
    const result = url.endsWith('/draft/discard') ? await f.service.discardDraft(f.context, JSON.parse(options.body))
      : options.method === 'POST' ? await f.service.saveDraft(f.context, JSON.parse(options.body))
      : url.endsWith('/account') ? await f.service.readAccount(f.context) : await f.service.readDraft(f.context);
    return response(result, result.status === 'ok' ? 200 : result.status === 'not-found' ? 404 : 409);
  } });
}

test('account composition preserves complete supplied facts, labelled details and dated vehicle hierarchy', async () => {
  const input = unnamed('multi-slot');
  Object.assign(input.value.account, { dateOfBirth: '1990-01-01', allowanceOverride: { value: 1500, unit: 'points/month' },
    allowanceOverrideEndDate: '2026-12-01' });
  Object.assign(input.value.drivers[1], { status: 'Approved', dateOfBirth: '1992-02-02', address: { line1: '2 Fictional Avenue' },
    licence: { displayNumber: 'FAKE-CAR-BIKE', car: { type: 'Full', validFrom: '2010-01-01', validUntil: '2030-01-01' },
      bike: { type: 'Full', validFrom: '2012-01-01', validUntil: '2032-01-01' } } });
  Object.assign(input.value.contracts[0], { vin: 'ZZSYNTHETIC000001', orderNumber: '7654321', orderDate: '2026-05-01',
    requestedCollectionDate: '2026-05-30', expectedReturnMileage: 6500, returnedMileage: 6420, returnedDate: '2026-12-02',
    terms: { kind: 'points-monthly', value: 1100 }, technical: { wltpCo2: { value: 156, unit: 'g/km', basis: 'WLTP combined' },
      price: { kind: 'purchase-money', value: 55295, currency: 'GBP', basis: 'List price' },
      options: [{ code: 'SYN01', description: 'Fictional option' }], fittedEquipment: null } });
  mirrorHistory(input);
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    assert.equal(root.querySelectorAll('main h1').length, 1);
    assert.equal(root.querySelectorAll('.gcsp-feature').length, 2);
    const current = root.querySelector('.gcsp-feature');
    assert.equal(current.querySelector('.gcsp-countdown').textContent, 'Contract ends in 26 days \u00b7 1 December 2026');
    assert.equal(pointsCost(current), '1,100 / 1,300 points per month');
    const otherScheme = root.querySelectorAll('.gcsp-feature')[1];
    assert.equal(pointsCost(otherScheme), '1,100 points per month \u00b7 budget not supplied');
    assert.doesNotMatch(otherScheme.textContent, /1,300/);
    assert.doesNotMatch(current.textContent, /current:employee-paula|slot-paula|choices-fs-uk/);
    assert.match(current.querySelector('.gcsp-details').textContent, /Replacement collection12 Nov to 1 Dec/);
    // The record drawer carries the rest of the supplied contract, collection, order and technical facts.
    const drawer = openFrom(root);
    for (const text of ['7654321', '1 May 2026', '30 May 2026', '1 June 2026', '6,500', '6,420',
      'ZZSYNTHETIC000001', '156 g/km (WLTP combined)', '£55,295 (List price)', 'SYN01', 'Fictional option']) assert.ok(drawer.textContent.includes(text), text);
    root.querySelector('.gcsp-side-drawer .vm-btn').click();
    assert.deepEqual([...root.querySelectorAll('.gcsp-feature .gcsp-actions button')].map((b) => b.textContent),
      ['Choose a replacement']);
    assert.match(otherScheme.textContent, /Replacement is unavailable for this contract and slot\./);
    assert.equal(root.querySelectorAll('.gcsp-feature .vm-btn-primary').length, 1);
    assert.ok(detailsRow(root, 'Employee').textContent.includes('Allowance override: 1,500 points/month (ends 1 December 2026)'));
    const drivers = detailsRow(root, 'Drivers (2)');
    for (const text of ['Approved', '2 February 1992', 'FAKE-CAR-BIKE', 'Car licence type Full', 'Bike licence type Full', 'Car licence valid until 1 January 2030', 'Bike licence valid until 1 January 2032']) {
      assert.ok(drivers.textContent.includes(text), text);
    }
    assert.ok(detailsRow(root, 'Employee').textContent.includes('Date of birth 1 January 1990'));
    assert.ok(drivers.textContent.includes('Address Line1: 2 Fictional Avenue') || drivers.textContent.includes('2 Fictional Avenue'));
    assert.ok(rowsOf(root).some((tr) => cellsOf(tr)[1] === 'Scheme 2'));
    assert.doesNotMatch(root.textContent, /\[object Object\]|undefined|NaN|Invalid Date/);
    assert.equal(root.querySelectorAll('input, select, textarea').length, 0);
    assert.equal(root.querySelector('.gcsp-presenter-controls, .gcsp-presenter-flyout, .gcsp-nav-presenter-btn'), null);
    assert.equal(root.querySelectorAll('.vm-decision, .vm-card-score').length, 0);
    assert.doesNotMatch(root.textContent, /Synthetic example data/);
  } finally { destroy(); root.remove(); }
});

test('FUCQ-277: the allowance shows in the Points cost row and the no-car line, hides unsupplied overrides and internal prose, and the current car drops its specification caveat', async () => {
  const plain = unnamed('multi-slot'); delete plain.value.account.allowanceOverride; delete plain.value.account.allowanceOverrideEndDate;
  plain.value.allowance.basis = 'Synthetic monthly demo allowance; eligibility matrices contain no numeric allowances. Not a verified BMW amount.';
  const first = await domMount({ ...readOnlyAdapter(), readAccount: async () => plain });
  try {
    assert.equal(first.root.querySelector('.gcsp-allowance'), null);
    assert.equal(pointsCost(first.root.querySelector('.gcsp-feature')), '1,100 / 1,300 points per month');
    assert.equal(first.root.querySelector('.gcsp-account-key'), null);
    assert.doesNotMatch(first.root.textContent, /Allowance override|Override end|Allowance basis|Synthetic monthly demo|Not a verified|Exact specification is not supplied/);
    assert.match(first.root.querySelector('.gcsp-account-body').lastElementChild.textContent, /Account as of/);
  } finally { first.destroy(); first.root.remove(); }
  const noCar = await domMount(readOnlyAdapter('no-current-car'));
  try {
    assert.equal(noCar.root.querySelector('.gcsp-feature'), null);
    const line = [...noCar.root.querySelectorAll('.gcsp-account-body > p')].find((node) => /Your allowance/.test(node.textContent));
    assert.equal(line.textContent, 'Your allowance: 1,300 points a month.');
    assert.doesNotMatch(noCar.root.textContent, /Allowance override/);
  } finally { noCar.destroy(); noCar.root.remove(); }
  const overridden = accountFixture('no-current-car');
  Object.assign(overridden.value.account, { allowanceOverride: { value: 1500, unit: 'points/month' }, allowanceOverrideEndDate: '2026-12-01' });
  const withOverride = await domMount({ ...readOnlyAdapter(), readAccount: async () => overridden });
  try {
    const line = [...withOverride.root.querySelectorAll('.gcsp-account-body > p')].find((node) => /Your allowance/.test(node.textContent));
    assert.equal(line.textContent, 'Your allowance: 1,300 points a month. Allowance override: 1,500 points/month, ends 1 December 2026.');
  } finally { withOverride.destroy(); withOverride.root.remove(); }
  const set = unnamed('multi-slot');
  Object.assign(set.value.account, { allowanceOverride: { value: 1500, unit: 'points/month' }, allowanceOverrideEndDate: '2026-12-01' });
  const second = await domMount({ ...readOnlyAdapter(), readAccount: async () => set });
  try {
    assert.match(second.root.querySelector('.gcsp-feature').textContent, /Allowance override: 1,500 points\/month, ends 1 December 2026/);
    assert.match(detailsRow(second.root, 'Employee').textContent, /Allowance override: 1,500 points\/month \(ends 1 December 2026\)/);
    assert.doesNotMatch(second.root.textContent, /Allowance basis|Synthetic monthly demo/);
  } finally { second.destroy(); second.root.remove(); }
});

test('current contracts retain their explicit scheme allowance including zero and unknown', async () => {
  const input = accountFixture('multi-slot');
  input.value.contracts[0].terms = { kind: 'points-monthly', value: 1100, allowance: 0 };
  input.value.contracts[1].terms = { kind: 'points-monthly', value: 900, allowance: 950 };
  const adapter = { ...readOnlyAdapter(), readAccount: async () => input };
  const first = await domMount(adapter);
  try {
    const cost = [...first.root.querySelectorAll('.gcsp-feature')].map(pointsCost);
    assert.equal(cost[0], '1,100 / 0 points per month');
    assert.equal(cost[1], '900 / 950 points per month');
  } finally { first.destroy(); first.root.remove(); }
  input.value.contracts[0].terms.allowance = null;
  const second = await domMount(adapter);
  try {
    assert.equal(pointsCost(second.root.querySelector('.gcsp-feature')), '1,100 points per month \u00b7 budget not supplied');
  } finally { second.destroy(); second.root.remove(); }
});

test('the car shows no image caption or source line; a broken image keeps the placeholder and heading, and the record keeps the source', async () => {
  const input = accountFixture(); input.value.contracts[0].media = { src: '/fictional-missing.jpg',
    caption: 'Front three-quarter view', provenance: { source: 'dated illustration' } };
  mirrorHistory(input);
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    const media = root.querySelector('.gcsp-media');
    assert.ok(media.classList.contains('gcsp-media-whole'));
    assert.equal(media.querySelector('img').alt, 'BMW 3 Series Touring 320i');
    assert.equal(media.querySelector('.vm-media-caption'), null);
    assert.doesNotMatch(root.querySelector('.gcsp-feature').textContent, /Front three-quarter view|Image source|dated illustration/);
    media.querySelector('img').dispatchEvent(new window.Event('error'));
    assert.equal(media.querySelector('img'), null); assert.equal(media.classList.contains('has-photo'), false);
    assert.match(media.textContent, /No image available for your car/);
    assert.equal(root.querySelector('.gcsp-feature h2').textContent, 'BMW 3 Series Touring 320i');
    assert.doesNotMatch(root.textContent, /does not confirm the fitted equipment/);
    const record = openFrom(root);
    assert.match(record.textContent, /does not confirm the fitted equipment/);
    assert.match(record.textContent, /Image source.*dated illustration/);
  } finally { destroy(); root.remove(); }
});

test('distinct entitlement, HR, empty and failure states provide truthful actions and unsupported history stays readable', async () => {
  const expected = { 'absent-hr-account': 'Your HR account is missing', 'not-yet-eligible': 'Replacement is not available yet',
    'no-entitlement': 'No ordering entitlement', 'unsupported-scheme': 'Ordering is not supported for this scheme',
    'source-failure': 'Your account is unavailable', 'no-current-car': 'No current car', 'no-history': 'No order history.' };
  for (const [name, title] of Object.entries(expected)) {
    const { root, destroy } = await domMount(readOnlyAdapter(name));
    try {
      assert.ok(root.textContent.includes(title), name);
      assert.equal(Boolean(findButton(root, 'Refresh account')), name === 'source-failure');
      assert.equal(Boolean(findButton(root, 'Start a new order')), name === 'no-current-car');
      if (!['no-current-car', 'no-history'].includes(name)) assert.equal(findButton(root, 'Choose a replacement'), undefined);
      if (name === 'unsupported-scheme') {
        const [record] = rowsOf(root);
        assert.deepEqual(cellsOf(record).slice(1, 5), ['Scheme 1', '1 June 2026', 'Ends 1 Dec 2026', 'Current car']);
        assert.equal(record.querySelectorAll('button').length, 1);
        const drawer = openRecord(root);
        assert.match(sectionOf(drawer, 'Contract').textContent, /StatusCurrent car/);
        assert.match(drawer.querySelector('.gcsp-side-drawer-foot button').textContent, /Print record/);
      }
      if (name === 'absent-hr-account') {
        let event; root.addEventListener('gcsp:support', (value) => { event = value; });
        findButton(root, 'Contact support').click();
        assert.equal(event.detail.route, 'hr-support'); assert.equal(event.bubbles, true); assert.equal(event.composed, true);
        assert.match(root.textContent, /Support route: hr-support\./);
      }
    } finally { destroy(); root.remove(); }
  }
});

test('a closed renewal window says it is too late to order, not to wait (FUCQ-200)', async () => {
  const f = await setup();
  const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.context.employeeId } };
  // Clock 2026-11-05 plus the 7-day minimum lead is past this window's last date.
  assert.equal((await f.repository.transaction(f.context, { commandId: 'closed-window', inputDigest: inputDigest('closed-window') }, async (tx) => {
    const found = await tx.get(ref); const manual = structuredClone(found.value.contract.manualContext);
    Object.assign(manual.contracts[0], { earliestCollectionDate: '2026-11-01', latestCollectionDate: '2026-11-11' });
    return tx.compareAndSwap(ref, found.value.version, { contract: { manualContext: manual } });
  })).status, 'ok');
  const { root, destroy } = await domMount(serviceAdapter(f));
  try {
    assert.match(root.textContent, /Too late to order before renewal/);
    assert.match(root.textContent, /No collection date fits before your contract ends\./);
    assert.doesNotMatch(root.textContent, /Replacement is not available yet/);
    assert.equal(findButton(root, 'Choose a replacement'), undefined); assert.ok(findButton(root, 'Contact support'));
  } finally { destroy(); root.remove(); }
});

test('guarded replacement reconciles draft, suppresses duplicate writes, emits exact saved context, and survives Back and reload', async () => {
  const f = await setup(); const calls = []; const adapter = serviceAdapter(f, calls);
  const readDraft = adapter.readDraft; let release; let blocked = false;
  adapter.readDraft = async (options) => { if (blocked) await new Promise((done) => { release = done; }); return readDraft(options); };
  const { root, destroy } = await domMount(adapter); const events = [];
  const listen = (event) => events.push(event);
  document.body.addEventListener('gcsp:journey-start', listen);
  try {
    assert.deepEqual(calls.map((call) => call.url), ['/api/gcsp/manual/account', '/api/gcsp/manual/draft', '/api/gcsp/offers/current']);
    blocked = true;
    const choose = findButton(root, 'Choose a replacement'); choose.click(); choose.click();
    assert.equal(root.querySelector('[aria-busy="true"]') != null, true);
    assert.equal(findButton(root, 'Choose a replacement').disabled, true);
    await tick(); blocked = false; release(); await tick(); await tick();
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1); assert.equal(events.length, 1);
    const saved = await f.service.readDraft(f.context);
    assert.deepEqual(events[0].detail, { mode: 'replacement', oldContractId: 'current:employee-paula', slotId: 'slot-paula',
      schemeId: 'choices-fs-uk', draftVersion: saved.value.draftVersion, contextVersion: saved.value.contextVersion });
    assert.equal(events[0].bubbles, true); assert.equal(events[0].composed, true);
    assert.equal(root.querySelector('main h1').textContent, 'Your saved journey');
    assert.equal(document.activeElement, root.querySelector('main h1'));
    assert.match(root.textContent, /Nothing is held or ordered yet/);
    assert.match(root.querySelector('.gcsp-feature').textContent, /BMW 3 Series Touring 320i/);
    findButton(root, 'Back to account').click(); assert.equal(root.querySelector('main h1').textContent, 'Your cars');
    await destroy.refresh(); assert.ok(findButton(root, 'Carry on'));
    findButton(root, 'Carry on').click(); await tick(); await tick();
    assert.equal(events.length, 2); assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    findButton(root, 'Back to account').click();
    findButton(root, 'Choose a replacement').click(); await tick(); await tick();
    assert.equal(events.length, 3); assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal((await f.service.readAccount(f.context)).value.currentContract.contractEndDate, '2026-12-01');
  } finally { destroy(); root.remove(); document.body.removeEventListener('gcsp:journey-start', listen); }
  const reloaded = await domMount(serviceAdapter(f));
  try { assert.ok(findButton(reloaded.root, 'Carry on')); assert.match(reloaded.root.querySelector('.gcsp-summary').textContent, /Current carBMW 3 Series Touring 320i/); }
  finally { reloaded.destroy(); reloaded.root.remove(); }
});

test('failed draft reads and stale writes never emit success and refresh recovers current account data', async () => {
  let available = false; let starts = 0;
  const adapter = { ...readOnlyAdapter(), readDraft: async () => available ? { status: 'not-found' } : { status: 'unavailable' },
    startJourney: async () => { starts += 1; return { status: 'stale-version' }; } };
  const { root, destroy } = await domMount(adapter); let events = 0;
  root.addEventListener('gcsp:journey-start', () => { events += 1; });
  try {
    assert.match(root.textContent, /Saved journey could not be read/);
    assert.equal(findButton(root, 'Choose a replacement').disabled, true);
    available = true; await destroy.refresh(); assert.equal(findButton(root, 'Choose a replacement').disabled, false);
    findButton(root, 'Choose a replacement').click(); await tick(); await tick();
    assert.equal(starts, 1); assert.equal(events, 0); assert.match(root.querySelector('.gcsp-account-message').textContent, /context has changed/);
    assert.match(root.textContent, /Refresh and review/);
    const changed = accountFixture(); changed.value.account.name = 'Changed fictional employee';
    adapter.readAccount = async () => changed; await destroy.refresh();
    assert.match(root.querySelector('.gcsp-account-name').textContent, /Changed fictional employee/);
    assert.equal(root.querySelector('.gcsp-account-message'), null);
  } finally { destroy(); root.remove(); }
});

test('pending reads cannot render or emit after teardown; the record drawer prints its record and tears down with the page', async () => {
  let release;
  const delayed = domHost(); const destroy = mountAccount(delayed, { adapter: { ...readOnlyAdapter(),
    readAccount: () => new Promise((done) => { release = done; }) } });
  destroy(); release(unnamed()); await tick(); assert.equal(delayed.children.length, 0); delayed.remove();
  let printed;
  const active = await domMount(readOnlyAdapter(), { print: (record) => { printed = record; } });
  try {
    const drawer = openRecord(active.root);
    const print = drawer.querySelector('.gcsp-side-drawer-foot button'); assert.match(print.textContent, /Print record/);
    print.focus(); assert.equal(document.activeElement, print); print.click();
    assert.match(printed.textContent, /BMW 3 Series Touring 320i/); assert.ok(printed.querySelector('.gcsp-record-section'));
    assert.equal(printed.querySelectorAll('button').length, 0);
    assert.equal(active.root.querySelectorAll('.gcsp-side-drawer').length, 1);
    openRecord(active.root, 1); assert.equal(active.root.querySelectorAll('.gcsp-side-drawer').length, 1, 'only one drawer is open');
    active.destroy(); assert.equal(document.querySelector('.gcsp-side-drawer'), null);
  } finally { active.destroy(); active.root.remove(); }
});

test('account custom element has a standard registration and adapter lifecycle without URL identity or inline code', async () => {
  const root = document.createElement('gcsp-account'); root.adapter = readOnlyAdapter('no-current-car'); document.body.append(root);
  defineGcspAccount(); assert.equal(defineGcspAccount(), customElements.get('gcsp-account')); await tick();
  assert.ok(findButton(root, 'Start a new order')); assert.match(root.textContent, /No current car/);
  assert.equal(root.querySelectorAll('main').length, 1);
  root.remove(); assert.equal(root.children.length, 0);
  const { readFile } = await import('node:fs/promises');
  for (const path of ['gcsp-account.html', 'blocks/gcsp/account/gcsp-account.js', 'blocks/gcsp/account/register.js', 'blocks/gcsp/account/harness.js']) {
    const source = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bon\w+\s*=\s*["']|\beval\s*\(|new\s+Function\s*\(|set(?:Timeout|Interval)\s*\(\s*["']/);
    assert.doesNotMatch(source, /<script\b[^>]*>\s*[^<\s]/);
    assert.doesNotMatch(source, /—/);
    assert.doesNotMatch(source, /(?:employeeId|employee-id).*searchParams/);
  }
});

test('fresh account review can replace a stale intent using current source and draft CAS versions', async () => {
  const f = await setup(); const calls = []; const adapter = serviceAdapter(f, calls);
  const { root, destroy } = await domMount(adapter); let events = 0;
  root.addEventListener('gcsp:journey-start', () => { events += 1; });
  try {
    findButton(root, 'Choose a replacement').click(); await tick(); await tick();
    const original = await f.service.readDraft(f.context);
    const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.context.employeeId } };
    await f.repository.transaction(f.context, { commandId: 'renderer-source-change', inputDigest: inputDigest('renderer-source-change') }, async (tx) => {
      const employee = await tx.get(ref); const contract = structuredClone(employee.value.contract);
      contract.manualContext.source.sourceVersion = 'renderer-account-v2'; return tx.compareAndSwap(ref, employee.value.version, { contract });
    });
    findButton(root, 'Back to account').click();
    findButton(root, 'Choose a replacement').click(); await tick(); await tick();
    assert.equal(events, 1); assert.match(root.querySelector('.gcsp-account-message').textContent, /context has changed/);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    await destroy.refresh();
    assert.equal(findButton(root, 'Carry on'), undefined);
    findButton(root, 'Choose a replacement').click(); await tick(); await tick();
    const renewed = await f.service.readDraft(f.context);
    assert.equal(events, 2); assert.equal(renewed.value.requiresRefresh, false);
    assert.equal(renewed.value.draftVersion, original.value.draftVersion + 1);
    assert.notEqual(renewed.value.contextVersion, original.value.contextVersion);
    assert.equal(calls.filter((call) => call.method === 'POST').at(-1).body.expectedDraftVersion, original.value.draftVersion);
    assert.deepEqual(renewed.value.choices, original.value.choices);
  } finally { destroy(); root.remove(); }
});

test('new-order action retains the exact permitted scheme and empty slot intent without claiming a saved write', async () => {
  let request; const adapter = { ...readOnlyAdapter('no-current-car'), startJourney: async (input) => {
    request = input; return { status: 'unavailable' };
  } };
  const { root, destroy } = await domMount(adapter); let events = 0;
  root.addEventListener('gcsp:journey-start', () => { events += 1; });
  try {
    findButton(root, 'Start a new order').click(); await tick(); await tick();
    assert.deepEqual(request.action, accountFixture('no-current-car').value.actions[0]);
    assert.equal(request.action.action, 'order'); assert.equal(request.action.oldContractId, null);
    assert.equal(events, 0); assert.match(root.querySelector('.gcsp-account-message').textContent, /could not be saved/);
    assert.equal(root.querySelectorAll('.gcsp-feature').length, 0);
  } finally { destroy(); root.remove(); }
});

test('FUCQ-218: policy scheme names fill the Scheme column, the current car and the printed record; unnamed schemes stay "Scheme N"', async () => {
  const named = accountFixture('multi-slot'); const [first, second] = named.value.histories;
  assert.ok(first.label && second.label);
  const shown = await domMount({ ...readOnlyAdapter(), readAccount: async () => named });
  try {
    assert.deepEqual(rowsOf(shown.root).map((tr) => cellsOf(tr)[1]), [first.label, second.label, second.label]);
    assert.doesNotMatch(shown.root.querySelector('.gcsp-account-history').textContent, /Scheme \d/);
    assert.deepEqual(factPairs(shown.root.querySelector('.gcsp-feature')).find(([label]) => label === 'Scheme'), ['Scheme', first.label]);
    const drawer = openRecord(shown.root);
    assert.equal(drawer.querySelector('.gcsp-side-drawer-context').textContent, `Car record \u00b7 ${first.label}`);
    drawer.querySelector('.gcsp-side-drawer-foot button').click();
    assert.match(shown.root.querySelector('.gcsp-account-print-record').textContent, /BMW 3 Series Touring 320i/);
  } finally { shown.destroy(); shown.root.remove(); }
  const partial = accountFixture('multi-slot'); delete partial.value.histories[1].label;
  const mixed = await domMount({ ...readOnlyAdapter(), readAccount: async () => partial });
  try {
    assert.deepEqual(rowsOf(mixed.root).map((tr) => cellsOf(tr)[1]), [first.label, 'Scheme 2', 'Scheme 2']);
    assert.doesNotMatch(mixed.root.querySelector('.gcsp-account-history').textContent, /PCS UK FS BMW/);
  } finally { mixed.destroy(); mixed.root.remove(); }
  const bare = await domMount({ ...readOnlyAdapter('multi-slot') });
  try {
    assert.deepEqual(rowsOf(bare.root).map((tr) => cellsOf(tr)[1]), ['Scheme 1', 'Scheme 2', 'Scheme 2']);
    assert.doesNotMatch(bare.root.querySelector('.gcsp-feature').textContent, /Scheme/);
  } finally { bare.destroy(); bare.root.remove(); }
});

test('default print exposes only the chosen complete record and cleans its temporary view after printing', async () => {
  const { root, destroy } = await domMount(readOnlyAdapter());
  const original = window.print; let printCalls = 0;
  window.print = () => {
    printCalls += 1;
    const record = root.querySelector('.gcsp-account-print-record');
    assert.ok(record); assert.equal(root.classList.contains('gcsp-account-printing'), true);
    assert.match(record.textContent, /current:employee-paula/);
    assert.doesNotMatch(record.textContent, /historic:employee-paula/);
    assert.ok(record.querySelector('.gcsp-record-section'));
    assert.equal(record.querySelectorAll('button').length, 0);
  };
  try {
    openFrom(root).querySelector('.gcsp-side-drawer-foot button').click();
    assert.equal(printCalls, 1); window.dispatchEvent(new window.Event('afterprint'));
    assert.equal(root.querySelector('.gcsp-account-print-record'), null);
    assert.equal(root.classList.contains('gcsp-account-printing'), false);
  } finally { window.print = original; destroy(); root.remove(); }
});

test('account shows a keyboard-operable link to the employee offer only when one is listed', async () => {
  const withOffer = await domMount({ ...readOnlyAdapter(), readOffers: async () => ({ status: 'ok', value: { offers: [{ offerId: 'offer-1', runId: 'run-1' }] } }) });
  const view = findButton(withOffer.root, 'View your offer'); assert.ok(view); assert.equal(view.tagName, 'BUTTON'); withOffer.destroy();
  const without = await domMount({ ...readOnlyAdapter(), readOffers: async () => ({ status: 'unavailable' }) });
  assert.equal(findButton(without.root, 'View your offer'), undefined); without.destroy();
});

// A fake order adapter over one fixture state; `orders` is what the employee's list returns.
function orderAdapter(name = 'appointment-requested', orders) {
  const states = orderProgressFixtures().states[name]; const uuid = states.stages.value.orderUuid;
  const read = (field) => async () => structuredClone(states[field]);
  return { uuid, calls: [], listOrders: async function list() { return { status: 'ok', value: { orders: orders ?? [{ orderUuid: uuid, source: { receivedAt: instant } }] } }; },
    readStages: read('stages'), readDocuments: read('documents'), readAppointment: read('appointment'), readReturnPlan: read('returnPlan') };
}
const factPairs = (node) => [...node.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]);
const settleOrder = async (root, ready) => { for (let n = 0; n < 40 && !ready(root); n += 1) await new Promise((done) => setTimeout(done, 15)); };
const selection = (orderUuid, display) => async () => ({ status: 'ok', value: { selection: { stock: { orderUuid, orderNumber: '1000001', facts: { display } } } } });

test('account with an order shows one Your new car row with a Track your order link, not the embedded tracker', async () => {
  const orders = orderAdapter('appointment-requested', [structuredClone(orderProgressFixtures().states['appointment-requested'].stages.value)]);
  const keys = [];
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readOrder: selection(orders.uuid, { name: 'Synthetic i5 eDrive40 Touring', photo: '/img/i5.jpg' }) },
    { orderAdapter: orders, onNavigate: (key) => keys.push(key) });
  try {
    await settleOrder(root, (node) => node.querySelector('.gcsp-account-order-status'));
    const row = root.querySelector('.gcsp-account-order-status'); assert.ok(row, 'new car row');
    assert.equal(row.getAttribute('aria-label'), 'Your new car'); assert.equal(root.querySelectorAll('main h1').length, 1);
    assert.equal(row.querySelector('.gcsp-card-name, .gcsp-summary-name').textContent, 'Synthetic i5 eDrive40 Touring');
    assert.equal(row.querySelector('img.vm-card-photo').getAttribute('src'), '/img/i5.jpg');
    assert.match(row.textContent, /Current step: /); assert.match(row.textContent, /Order referenceGCSP-000123Car order number1000001/);
    const link = [...row.querySelectorAll('a')].find((node) => node.textContent === 'Track your order'); assert.ok(link, 'track link');
    assert.equal(link.getAttribute('href'), '/gcsp-order-progress-live.html'); assert.ok(link.classList.contains('vm-btn-primary'));
    link.click(); assert.deepEqual(keys, ['order-progress']);
    assert.equal(root.querySelector('.gcsp-account-order, .gcsp-order-progress, .gcsp-stage-tracker'), null, 'the tracker is not embedded');
    const history = root.querySelector('.gcsp-account-history'); assert.equal(history.querySelector('details'), null, 'order history is one table, not disclosures');
    assert.ok([...history.querySelectorAll('tbody th')].some((cell) => cell.textContent === 'Synthetic i5 eDrive40 Touring'), 'the placed order is a history row');
    assert.equal(row.closest('details'), null);
  } finally { destroy(); }
});

test('account shows no new car row without an order, on a failed list, or for another order car', async () => {
  const none = await domMount(readOnlyAdapter(), { orderAdapter: orderAdapter('appointment-requested', []) });
  await tick(); assert.equal(none.root.querySelector('.gcsp-account-order-status'), null); none.destroy();
  const failed = orderAdapter(); failed.listOrders = async () => ({ status: 'unavailable' });
  const down = await domMount(readOnlyAdapter(), { orderAdapter: failed }); await tick();
  assert.equal(down.root.querySelector('.gcsp-account-order-status'), null); down.destroy();
  const plain = await domMount(readOnlyAdapter()); assert.equal(plain.root.querySelector('.gcsp-account-order-status'), null); plain.destroy();
});

test('FUCQ-193: an accepted offer with its order in progress no longer offers "View your offer"', async () => {
  const offers = (state) => async () => ({ status: 'ok', value: { offers: [{ offerId: 'offer-2', runId: 'run-1', state }, { offerId: 'offer-1', runId: 'run-1', state: 'declined' }] } });
  const orders = orderAdapter();
  const accepted = await domMount({ ...readOnlyAdapter('no-entitlement'), readOffers: offers('accepted'), readOrder: selection(orders.uuid, { name: 'Synthetic 3 Series Saloon 320i' }) }, { orderAdapter: orders });
  try {
    await settleOrder(accepted.root, (node) => node.querySelector('.gcsp-account-order-status'));
    assert.ok(accepted.root.querySelector('.gcsp-account-order-status'), 'the new car row is shown');
    assert.equal(findButton(accepted.root, 'View your offer'), undefined);
    assert.equal(accepted.root.querySelector('[aria-label="Your car offer"]'), null);
  } finally { accepted.destroy(); }
  const pending = await domMount({ ...readOnlyAdapter(), readOffers: offers('pending') });
  assert.ok(findButton(pending.root, 'View your offer'), 'a pending newest offer keeps its link'); pending.destroy();
});

test('FUCQ-278: a held newest offer is the one primary action; saved journey and replacement step back but stay usable', async () => {
  const draft = { status: 'ok', value: { draftStage: 'intent', choices: { mode: 'replacement', oldContractId: 'current:employee-paula',
    slotId: 'slot-paula', schemeId: 'choices-fs-uk' }, draftVersion: 3, contextVersion: 'context', requiresRefresh: false } };
  const adapter = (state) => ({ ...readOnlyAdapter(), readDraft: async () => draft,
    readOffers: async () => ({ status: 'ok', value: { offers: [{ offerId: 'offer-1', runId: 'run-1', ...(state ? { state } : {}) }] } }) });
  const held = await domMount(adapter('pending'));
  try {
    const variant = (text) => findButton(held.root, text).classList.contains('vm-btn-ghost');
    assert.equal(findButton(held.root, 'View your offer').classList.contains('vm-btn-primary'), true);
    assert.deepEqual(['Carry on', 'Choose a replacement'].map(variant), [true, true]);
    assert.ok(['Carry on', 'Choose a replacement'].every((text) => !findButton(held.root, text).disabled));
    assert.equal((held.root.textContent.match(/Decide on your car offer before choosing another car\./g) ?? []).length, 1);
  } finally { held.destroy(); }
  for (const state of ['declined', 'expired', undefined]) {
    const other = await domMount(adapter(state));
    try {
      assert.deepEqual(['Carry on', 'Choose a replacement'].map((text) => findButton(other.root, text).classList.contains('vm-btn-primary')), [true, true], String(state));
      assert.doesNotMatch(other.root.textContent, /Decide on your car offer before/);
    } finally { other.destroy(); }
  }
});

test('FUCQ-193: the HTTP adapter reads the newest listed offer state, and a failed read keeps the link', async () => {
  const listed = { status: 'ok', value: { offers: [{ offerId: 'offer-2', runId: 'run-1', createdAt: null }, { offerId: 'offer-1', runId: 'run-1', createdAt: null }] } };
  const adapterFor = (offer) => { const urls = [];
    return { urls, adapter: createAccountHttpAdapter({ fetchImpl: async (url) => { urls.push(url);
      const body = url === '/api/gcsp/offers/current' ? listed : offer; return { ok: body.status === 'ok', status: 200, json: async () => body }; } }) }; };
  const read = adapterFor({ status: 'ok', value: { offerId: 'offer-2', state: 'accepted' } });
  assert.deepEqual(await read.adapter.readOffers(), { status: 'ok', value: { offers: [{ offerId: 'offer-2', runId: 'run-1', state: 'accepted' }, { offerId: 'offer-1', runId: 'run-1' }] } });
  assert.deepEqual(read.urls, ['/api/gcsp/offers/current', '/api/gcsp/offers/offer-2?runId=run-1']);
  const failed = adapterFor({ status: 'unavailable' });
  assert.deepEqual(await failed.adapter.readOffers(), { status: 'ok', value: { offers: [{ offerId: 'offer-2', runId: 'run-1' }, { offerId: 'offer-1', runId: 'run-1' }] } });
});

test('FUCQ-192: an in-progress order on the slot replaces "No ordering entitlement" with its state and a progress link', async () => {
  const listed = (slot) => { const row = structuredClone(orderProgressFixtures().states['appointment-requested'].stages.value); row.entitlementSlotId = slot; return [row]; };
  const allocated = () => { const envelope = accountFixture('no-entitlement'); for (const slot of envelope.value.slots) slot.state = 'allocated'; return envelope; };
  const mount = (orders) => domMount({ ...readOnlyAdapter(), readAccount: async () => allocated(), readOrder: selection(orders.uuid, { name: 'Synthetic 3 Series Saloon 320i' }) }, { orderAdapter: orders });
  const ordered = orderAdapter('appointment-requested', listed('slot-paula')); const { root, destroy } = await mount(ordered);
  try {
    await settleOrder(root, (node) => node.querySelector('.gcsp-account-order-status'));
    assert.doesNotMatch(root.textContent, /No ordering entitlement/);
    const status = root.querySelector('.gcsp-account-order-status'); assert.ok(status, 'new car row');
    assert.equal(status.querySelector('h2').textContent, 'Your new car');
    assert.match(status.textContent, /Current step: Sent to ordering\./);
    assert.deepEqual(factPairs(status), [['Order reference', 'GCSP-000123'], ['Car order number', '1000001']]);
    const link = [...status.querySelectorAll('a')].find((node) => node.textContent === 'Track your order'); assert.ok(link, 'progress link');
    assert.equal(link.getAttribute('href'), '/gcsp-order-progress-live.html');
    assert.equal(findButton(status, 'Contact support'), undefined);
  } finally { destroy(); }
  const other = await mount(orderAdapter('appointment-requested', listed('slot-other')));
  try {
    await settleOrder(other.root, (node) => node.querySelector('.gcsp-account-order-status'));
    assert.match(other.root.textContent, /No ordering entitlement/);
  } finally { other.destroy(); }
  const none = await domMount(readOnlyAdapter('no-entitlement'), { orderAdapter: orderAdapter('appointment-requested', []) }); await tick();
  assert.match(none.root.textContent, /No ordering entitlement/); none.destroy();
});

test('FUCQ-257: a handed-over order titles its account card as handed over, not in progress', async () => {
  const stages = structuredClone(orderProgressFixtures().states['appointment-completed'].stages);
  Object.assign(stages.value, { entitlementSlotId: 'slot-paula', currentStage: 'handover', outcome: 'handed-over', owner: 'employee', nextStep: 'Your handover is complete.',
    stageList: [...stages.value.stageList, 'handover'], stages: [...stages.value.stages, { stage: 'handover', state: 'approved', at: instant, providerReference: 'SYN-APPT-0001', operationId: null }] });
  const orders = { ...orderAdapter('appointment-completed', [stages.value]), readStages: async () => structuredClone(stages) };
  const allocated = accountFixture('no-entitlement'); for (const slot of allocated.value.slots) slot.state = 'allocated';
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => structuredClone(allocated), readOrder: selection(orders.uuid, { name: 'Synthetic 3 Series Saloon 320i' }) }, { orderAdapter: orders });
  try {
    await settleOrder(root, (node) => node.querySelector('.gcsp-account-order-status'));
    const status = root.querySelector('.gcsp-account-order-status'); assert.ok(status, 'order status');
    assert.equal(status.querySelector('h2').textContent, 'Your car has been handed over');
    assert.match(status.textContent, /Current step: Handover\./); assert.ok([...status.querySelectorAll('a')].some((node) => node.textContent === 'Track your order'));
    assert.doesNotMatch(root.textContent, /Your order is in progress/);
  } finally { destroy(); }
});

test('FUCQ-224: an order on the slot replaces the saved journey card; an order on another slot keeps it', async () => {
  const listed = (slot) => { const row = structuredClone(orderProgressFixtures().states['appointment-requested'].stages.value); row.entitlementSlotId = slot; return [row]; };
  const allocated = () => { const envelope = accountFixture('no-entitlement'); for (const slot of envelope.value.slots) slot.state = 'allocated'; return envelope; };
  const draft = { status: 'ok', value: { draftStage: 'complete', draftVersion: 3, requiresRefresh: false,
    choices: { mode: 'replacement', oldContractId: 'current:employee-paula', slotId: 'slot-paula', schemeId: 'choices-fs-uk' } } };
  const mount = (orders) => domMount({ ...readOnlyAdapter(), readAccount: async () => allocated(), readDraft: async () => draft,
    readOrder: selection(orders.uuid, { name: 'Synthetic 3 Series Saloon 320i' }) }, { orderAdapter: orders });
  const ordered = await mount(orderAdapter('appointment-requested', listed('slot-paula')));
  try {
    await settleOrder(ordered.root, (node) => node.querySelector('.gcsp-account-order-status'));
    assert.ok(ordered.root.querySelector('.gcsp-account-order-status'), 'order status');
    assert.doesNotMatch(ordered.root.textContent, /You started choosing|Nothing is ordered yet|Saved journey could not be read/);
    assert.equal(findButton(ordered.root, 'Carry on'), undefined);
  } finally { ordered.destroy(); }
  const other = await mount(orderAdapter('appointment-requested', listed('slot-other')));
  try {
    await settleOrder(other.root, (node) => node.querySelector('.gcsp-account-order-status'));
    assert.match(other.root.textContent, /You started choosing a replacement/);
  } finally { other.destroy(); }
});

test('FUCQ-237: an order in progress replaces "No current car" for an employee with no current car, and a declined order keeps it', async () => {
  const listed = (name) => { const row = structuredClone(orderProgressFixtures().states[name].stages.value); row.entitlementSlotId = 'slot-paula'; return [row]; };
  const noCarAllocated = () => { const envelope = accountFixture('no-current-car'); Object.assign(envelope.value, { state: 'no-entitlement', actions: [] });
    for (const slot of envelope.value.slots) slot.state = 'allocated'; return envelope; };
  const mount = (name) => { const orders = orderAdapter(name, listed(name));
    return domMount({ ...readOnlyAdapter(), readAccount: async () => noCarAllocated(), readOrder: selection(orders.uuid, { name: 'Synthetic 3 Series Saloon 320i' }) }, { orderAdapter: orders }); };
  const ordered = await mount('appointment-requested');
  try {
    await settleOrder(ordered.root, (node) => node.querySelector('.gcsp-account-order-status'));
    assert.ok(ordered.root.querySelector('.gcsp-account-order-status'), 'order status');
    assert.doesNotMatch(ordered.root.textContent, /No current car/);
  } finally { ordered.destroy(); }
  const declined = await mount('declined');
  try {
    await settleOrder(declined.root, (node) => node.querySelector('.gcsp-account-order-status'));
    assert.equal(declined.root.querySelector('.gcsp-account-order-status h2').textContent, 'Your order was declined');
    assert.equal(findLink(declined.root, 'View order progress').classList.contains('vm-btn-ghost'), true);
    assert.match(declined.root.textContent, /No current car/);
  } finally { declined.destroy(); }
});

test('FUCQ-252: after a confirmed handover or return the current-car card follows the server relationship, not the old contract', async () => {
  const listed = (slot) => { const row = structuredClone(orderProgressFixtures().states['appointment-requested'].stages.value); row.entitlementSlotId = slot; return [row]; };
  const orders = orderAdapter('appointment-requested', listed('slot-paula')); const VIN = 'WBA00000000000252';
  const relationship = (oldStatus, collected) => ({ contractVersion: 'lifecycle.current-car.v1', orderUuid: orders.uuid,
    currentCar: collected ? { kind: 'order', orderUuid: orders.uuid, vin: VIN } : oldStatus === 'held' ? { kind: 'contract', contractId: 'current:employee-paula', slotId: 'slot-paula' } : null,
    oldCar: { contractId: 'current:employee-paula', slotId: 'slot-paula', status: oldStatus, returnedAt: oldStatus === 'returned' ? '2026-11-09T14:30:00.000Z' : null },
    newCar: { orderUuid: orders.uuid, status: collected ? 'collected' : 'on-order', collectedAt: collected ? '2026-11-07T13:00:00.000Z' : null, vin: collected ? VIN : null } });
  const account = (rel) => { const envelope = accountFixture('no-entitlement'); for (const slot of envelope.value.slots) slot.state = 'allocated';
    if (rel) envelope.value.currentCarRelationships = [rel]; return envelope; };
  const mount = (rel) => domMount({ ...readOnlyAdapter(), readAccount: async () => account(rel), readOrder: selection(orders.uuid, { name: 'Synthetic 3 Series Saloon 320i' }) }, { orderAdapter: orders });
  const cards = (root) => [...root.querySelectorAll('.gcsp-account-body > .gcsp-feature')];
  for (const [label, rel] of [['nothing confirmed', null], ['relationship still on the old contract', relationship('held', false)]]) {
    const view = await mount(rel);
    try {
      await settleOrder(view.root, (node) => node.querySelector('.gcsp-account-order-status'));
      assert.deepEqual(cards(view.root).map((card) => card.dataset.contractId), ['current:employee-paula'], label);
    } finally { view.destroy(); }
  }
  for (const oldStatus of ['returned', 'held']) {
    const view = await mount(relationship(oldStatus, true));
    try {
      await settleOrder(view.root, (node) => node.querySelector('.gcsp-account-order-status'));
      const [card, ...rest] = cards(view.root);
      assert.equal(rest.length, 0, `${oldStatus}: one current-car card`); assert.equal(card.dataset.contractId, undefined);
      assert.equal(card.dataset.orderUuid, orders.uuid); assert.equal(card.querySelector('h2').textContent, 'Synthetic 3 Series Saloon 320i');
      assert.equal(card.querySelector('.gcsp-account-context'), null);
      assert.deepEqual(factPairs(card).slice(0, 3), [['Status', 'Current car'], ['Collected', '7 November 2026'], ['Delivered VIN', VIN]]);
      assert.doesNotMatch(view.root.textContent, /No current car|Choose a replacement/);
    } finally { view.destroy(); }
  }
  const returned = await mount(relationship('returned', false));
  try {
    await settleOrder(returned.root, (node) => node.querySelector('.gcsp-account-order-status'));
    assert.equal(cards(returned.root).length, 0, 'the returned car is no longer shown as current');
    assert.match(returned.root.textContent, /No current car/); assert.match(returned.root.textContent, /Your previous car has been returned\./);
  } finally { returned.destroy(); }
});

test('FUCQ-239: Order history lists a placed order and no longer says "No order history"', async () => {
  const listed = (name) => { const row = structuredClone(orderProgressFixtures().states[name].stages.value); row.entitlementSlotId = 'slot-paula'; return [row]; };
  const noCarAllocated = () => { const envelope = accountFixture('no-current-car'); Object.assign(envelope.value, { state: 'no-entitlement', actions: [] });
    for (const slot of envelope.value.slots) slot.state = 'allocated'; return envelope; };
  const mount = (name) => { const orders = orderAdapter(name, listed(name));
    return domMount({ ...readOnlyAdapter(), readAccount: async () => noCarAllocated(), readOrder: selection(orders.uuid, { name: 'Synthetic 3 Series Saloon 320i' }) }, { orderAdapter: orders }); };
  const ordered = await mount('appointment-requested');
  try {
    await settleOrder(ordered.root, (node) => node.querySelector('.gcsp-account-order-status'));
    const histories = ordered.root.querySelector('.gcsp-account-history'); const [entry] = rowsOf(ordered.root);
    assert.doesNotMatch(histories.textContent, /No order history\./); assert.ok(entry, 'placed order row');
    assert.equal(entry.querySelector('th').textContent, 'Synthetic 3 Series Saloon 320i');
    assert.equal(cellsOf(entry)[4], 'Sent to ordering');
    const drawer = openRecord(ordered.root);
    assert.deepEqual(factPairs(drawer).filter(([name]) => ['Status', 'Order reference', 'Car order number'].includes(name)),
      [['Status', 'Sent to ordering'], ['Order reference', 'GCSP-000123'], ['Car order number', '1000001']]);
  } finally { ordered.destroy(); }
  const declined = await mount('declined');
  try {
    await settleOrder(declined.root, (node) => node.querySelector('.gcsp-account-order-status'));
    const histories = declined.root.querySelector('.gcsp-account-history');
    assert.doesNotMatch(histories.textContent, /No order history\./);
    assert.equal(cellsOf(rowsOf(declined.root)[0])[4], 'Declined');
    assert.deepEqual(factPairs(openRecord(declined.root)).filter(([name]) => name === 'Status'), [['Status', 'Declined']]);
  } finally { declined.destroy(); }
  const plain = await domMount(readOnlyAdapter('no-history')); await tick();
  assert.match(plain.root.querySelector('.gcsp-account-history').textContent, /No order history\./);
  assert.equal(plain.root.querySelector('.gcsp-account-history table'), null); plain.destroy();
});

// FUCQ-316 (changed by Gary, 10 November): this page hides unsupplied fields, so identity facts are absent rather than "Not supplied".
test('FUCQ-316: an unknown registration is not listed on the current car or in its record, and unsupplied identity fields are absent, not "Not supplied"', async () => {
  const input = unnamed('ready'); input.value.contracts[0].registration = null;
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    const card = root.querySelector('.gcsp-feature');
    assert.ok(![...card.querySelectorAll('dt')].some((node) => node.textContent === 'Registration'));
    assert.doesNotMatch(card.textContent, /Registration/);
    assert.equal(card.querySelector('.vm-facts-more'), null); assert.doesNotMatch(card.textContent, /More details not supplied/);
    assert.equal(card.querySelectorAll('.is-missing').length, 0);
    const drawer = openFrom(root);
    assert.ok(![...drawer.querySelectorAll('dt')].some((node) => node.textContent === 'Registration'));
    assert.equal(sectionOf(drawer, 'Order and vehicle').querySelector('dl'), null);
    assert.match(sectionOf(drawer, 'Order and vehicle').textContent, /Not supplied for this car\./);
    assert.equal(drawer.querySelectorAll('.is-missing').length, 0);
    const identity = detailsRow(root, 'Employee');
    assert.match(identity.textContent, /Paula Mason/);
    assert.doesNotMatch(identity.textContent, /Date of birth|Not supplied|Override/);
    assert.equal(identity.querySelectorAll('.is-missing').length, 0);
    assert.doesNotMatch(root.querySelector('.gcsp-account-body').textContent.replace(/Not supplied for this car\./g, ''), /Not supplied/);
  } finally { destroy(); root.remove(); }
});

test('FUCQ-195: the current-car card shows readable labels and no raw identifiers', async () => {
  const input = unnamed('ready'); const value = input.value;
  const raw = [value.currentContract.contractId, value.currentContract.slotId, value.currentContract.schemeId,
    value.currentContract.source.sourceRef, value.currentContract.source.sourceVersion];
  const first = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    const card = first.root.querySelector('.gcsp-feature');
    const shownText = [...card.querySelectorAll('dd, p, h2, summary, button')].map((node) => node.textContent);
    const record = openFrom(first.root).textContent; first.root.querySelector('.gcsp-side-drawer .vm-btn').click();
    for (const id of raw) { assert.ok(!shownText.some((text) => text.includes(id)), id); assert.ok(!record.includes(id), id); }
    assert.ok(![...card.querySelectorAll('dd')].some((node) => node.textContent === value.currentContract.status));
    assert.deepEqual(factPairs(card)[0], ['Status', 'Current car']);
    assert.equal(pointsCost(card), '1,100 / 1,300 points per month');
    assert.doesNotMatch(card.textContent, /Synthetic example data/);
    assert.doesNotMatch(card.textContent, /Vehicle slot|Scheme|Current contract|points cost not supplied|Wltp/);
  } finally { first.destroy(); first.root.remove(); }
  value.slots[0].label = 'Company car 1';
  const second = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try { assert.match(second.root.querySelector('.gcsp-feature').textContent, /Vehicle slotCompany car 1/); }
  finally { second.destroy(); second.root.remove(); }
});

function assertRestartedPage(root, reloads) {
  const body = root.querySelector('.gcsp-account-body'); const press = (label) => [...body.querySelectorAll('button')].find((node) => node.textContent === label);
  assert.equal(body.querySelector('h1').textContent, 'Your cars'); assert.match(body.textContent, /Restarted/);
  assert.match(body.textContent, /Reload to continue/);
  assert.doesNotMatch(body.textContent, /This account cannot be opened|Your account is unavailable|Journey could not be saved|stale-run|unknown-session|\u2014/);
  assert.equal(press('Refresh account'), undefined); assert.equal(press('Choose a replacement'), undefined);
  const reload = press('Reload'); assert.ok(reload); reload.click(); assert.equal(reloads(), 1);
}
test('FUCQ-198: a stale-run or unknown-session account read shows the restart screen with a working Reload', async () => {
  for (const status of ['stale-run', 'unknown-session', 'access-required']) {
    let reloads = 0;
    const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => ({ status, reason: 'x' }) }, { reload: () => reloads++ });
    try { assertRestartedPage(root, () => reloads); } finally { destroy(); root.remove(); }
  }
});
test('FUCQ-201: after a restart the shell account header stays quiet and leaves the page its Reload', async () => {
  for (const status of ['stale-run', 'unknown-session', 'access-required']) {
    const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => ({ status, reason: 'x' }) }, { reload: () => {} });
    try {
      const header = root.querySelector('.gcsp-account');
      assert.equal(header.dataset.status, 'restarted'); assert.equal(header.textContent, '');
      assert.equal(header.querySelector('.gcsp-account-retry'), null); assert.equal(header.hasAttribute('aria-label'), false);
      assert.doesNotMatch(root.textContent, /Account unavailable/); assert.match(root.textContent, /Restarted/);
    } finally { destroy(); root.remove(); }
  }
});
test('FUCQ-198: a restarted draft read shows the restart screen', async () => {
  let reloads = 0;
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readDraft: async () => ({ status: 'unknown-session' }) }, { reload: () => reloads++ });
  try { assertRestartedPage(root, () => reloads); } finally { destroy(); root.remove(); }
});
test('FUCQ-198: a start journey reply of stale-run shows the restart screen, not a save failure', async () => {
  let reloads = 0;
  const adapter = { ...readOnlyAdapter(), startJourney: async () => ({ status: 'stale-run' }) };
  const { root, destroy } = await domMount(adapter, { reload: () => reloads++ });
  try {
    findButton(root, 'Choose a replacement').click(); await tick(); await tick();
    assertRestartedPage(root, () => reloads);
  } finally { destroy(); root.remove(); }
});

test('FUCQ-197: order history, saved journey and footer show words, not raw identifiers', async () => {
  const input = unnamed('multi-slot'); const value = input.value;
  const entries = value.histories.flatMap((history) => history.entries);
  const raw = [...new Set([...value.histories.map((history) => history.schemeId), ...entries.flatMap((entry) => [entry.contractId, entry.slotId]),
    value.versions.employeeContract.sourceRef, value.versions.employeeContract.sourceVersion, value.asOf])];
  const draft = { status: 'ok', value: { draftStage: 'intent', draftVersion: 3, choices: { mode: 'replacement',
    oldContractId: value.currentContract.contractId, slotId: value.currentContract.slotId, schemeId: value.currentContract.schemeId } } };
  const mounted = await domMount({ ...readOnlyAdapter(), readAccount: async () => input, readDraft: async () => draft });
  try {
    const body = mounted.root.querySelector('.gcsp-account-body');
    const fresh = body.lastElementChild;
    const parts = [body.querySelector('.gcsp-summary'), body.querySelector('.gcsp-account-history'), fresh];
    const shownText = parts.flatMap((part) => [...part.querySelectorAll('dd, p, h2, h3, summary, button, td, th'), part]).map((node) => node.textContent);
    for (const id of raw) assert.ok(!shownText.some((text) => text.includes(id)), id);
    const saved = parts[0].textContent;
    assert.match(saved, /Current car/); assert.match(saved, new RegExp(value.currentContract.model));
    assert.doesNotMatch(saved, /Mode|Scheme|Draft version|replacement\b/);
    assert.deepEqual(rowsOf(mounted.root).map((tr) => cellsOf(tr)[1]), ['Scheme 1', 'Scheme 2', 'Scheme 2']);
    assert.equal(fresh.textContent, 'Account as of 5 November 2026 at 09:00.');
    assert.ok(fresh.classList.contains('gcsp-synthetic'), 'the freshness line closes the page, after Your details');
  } finally { mounted.destroy(); mounted.root.remove(); }
  value.histories[0].label = 'Fictional car scheme'; value.slots[0].label = 'Company car 1';
  const labelled = await domMount({ ...readOnlyAdapter(), readAccount: async () => input, readDraft: async () => draft });
  try {
    assert.equal(cellsOf(rowsOf(labelled.root)[0])[1], 'Fictional car scheme');
    assert.match(labelled.root.querySelector('.gcsp-summary').textContent, /Vehicle slotCompany car 1/);
  } finally { labelled.destroy(); labelled.root.remove(); }
});

test('FUCQ-204: neither the shell context nor the identity facts show the raw company id; a supplied label does show', async () => {
  const fixture = (company) => { const input = accountFixture('ready'); delete input.value.account.company;
    Object.assign(input.value.account, { companyId: 'demo-bmw-fs-uk', gradeId: 'G7', ...(company && { company }) }); return input; };
  const facts = (input) => toAccountView(input).identityFacts.map((row) => row.label);
  assert.ok(!facts(fixture()).includes('Company')); assert.ok(facts(fixture('BMW Financial Services')).includes('Company'));
  const load = (input) => createAccountHttpAdapter({ fetchImpl: async () => response(input) }).loadAccount();
  assert.doesNotMatch((await load(fixture())).context, /demo-bmw-fs-uk/); assert.equal((await load(fixture())).context, 'Grade G7');
  assert.equal((await load(fixture('BMW Financial Services'))).context, 'BMW Financial Services, Grade G7');
  for (const [company, shown] of [[null, false], ['BMW Financial Services', true]]) {
    const input = fixture(company);
    const { root, destroy } = await domMount({ readAccount: async () => input, readDraft: async () => ({ status: 'not-found' }), startJourney: async () => ({ status: 'unavailable' }) });
    assert.doesNotMatch(root.textContent, /demo-bmw-fs-uk/); assert.equal(root.textContent.includes('BMW Financial Services'), shown);
    assert.match(root.textContent, /Grade G7/); destroy();
  }
});

test('FUCQ-220: the order card of an earlier order shows only the car order number', async () => {
  const row = structuredClone(orderProgressFixtures().states['earlier-order'].stages.value); row.entitlementSlotId = 'slot-paula';
  const envelope = accountFixture('no-entitlement'); for (const slot of envelope.value.slots) slot.state = 'allocated';
  const orders = orderAdapter('earlier-order', [row]);
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => envelope, readOrder: selection(orders.uuid, { name: 'Synthetic 3 Series Saloon 320i' }) },
    { orderAdapter: orders });
  try {
    await settleOrder(root, (node) => node.querySelector('.gcsp-account-order .gcsp-order-number'));
    assert.deepEqual(factPairs(root.querySelector('.gcsp-account-order-status')), [['Car order number', '1000001']]);
    assert.doesNotMatch(root.textContent, /Order reference|GCSP-/);
  } finally { destroy(); }
});

test('FUCQ-220: order history names the car order number, and shows a reference and print label from it only when supplied', async () => {
  const input = accountFixture('unsupported-scheme'); const [entry] = input.value.histories[0].entries;
  Object.assign(entry, { orderNumber: '7654321', orderReference: 'GCSP-000042' });
  const legacy = structuredClone(entry); delete legacy.orderReference; legacy.contractId = 'synthetic:legacy'; input.value.histories[0].entries.push(legacy);
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    const orderFacts = (drawer) => factPairs(drawer).filter(([name]) => /order/i.test(name) && !/date|status/i.test(name));
    const withReference = openRecord(root, 0);
    assert.deepEqual(orderFacts(withReference), [['Order reference', 'GCSP-000042'], ['Car order number', '7654321']]);
    assert.equal(withReference.querySelector('.gcsp-side-drawer-foot button').textContent, 'Print record GCSP-000042');
    const without = openRecord(root, 1);
    assert.deepEqual(orderFacts(without), [['Car order number', '7654321']]);
    assert.equal(without.querySelector('.gcsp-side-drawer-foot button').textContent, 'Print record 7654321');
    assert.doesNotMatch(without.textContent, /Order reference/);
    const names = [...root.querySelectorAll('.gcsp-table-action')].map((b) => b.getAttribute('aria-label'));
    assert.equal(names.length, 3); assert.ok(names.every((name) => name.startsWith('View record for ')));
  } finally { destroy(); }
});

test('FUCQ-223: the account page head has the title and no kicker, and its stylesheet carries the order-progress styles the hosted entry lacks', async () => {
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => accountFixture('populated') });
  try {
    const intro = root.querySelector('.gcsp-account-body .gcsp-intro');
    assert.equal(intro.querySelector('.vm-kicker'), null, 'the frozen reference has no kicker');
    assert.equal(intro.querySelector('h1').textContent, 'Your cars');
  } finally { destroy(); root.remove(); }
  // Pages load only gcsp-account.css, so the order-progress sheet must come in through it.
  const css = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  assert.match(css('blocks/gcsp/account/gcsp-account.css'), /@import "\.\.\/order-progress\/gcsp-order-progress\.css";/);
  assert.match(css('blocks/gcsp/order-progress/gcsp-order-progress.css'), /\.gcsp-order-car \{ display: grid;/);
});

const allowed = { searchConsent: true, holdConsent: true, paused: false, canSearch: true, canHold: true };
const ghost = (root, text) => findButton(root, text).classList.contains('vm-btn-ghost');

test('Account no longer shows the Your buddy card or reads buddy activity', async () => {
  let reads = 0;
  const activity = async () => { reads += 1; return { status: 'ok', value: { state: 'searching', permission: allowed } }; };
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readActivity: activity });
  try {
    await destroy.sync(); await tick();
    assert.equal(reads, 0);
    assert.equal(root.querySelector('[aria-label="Your buddy"]'), null);
    for (const text of ['Set your preferences', 'Change your preferences', 'See buddy activity']) assert.equal(findButton(root, text), undefined, text);
    assert.equal(ghost(root, 'Choose a replacement'), false, 'the replacement control stays primary');
  } finally { destroy(); root.remove(); }
});

test('the HTTP adapter reads buddy activity, and any failure or abort is handled', async () => {
  const value = { permission: { canSearch: true, paused: false }, state: 'searching' }; const seen = [];
  const reply = (ok, body) => createAccountHttpAdapter({ base: 'https://local.invalid', fetchImpl: async (url, init) => { seen.push([url, init.credentials]); return { ok, json: async () => body }; } });
  assert.deepEqual(await reply(true, { status: 'ok', value }).readActivity(), { status: 'ok', value });
  assert.deepEqual(seen[0], ['https://local.invalid/api/gcsp/activity', 'include']);
  assert.deepEqual(await reply(false, { status: 'ok', value }).readActivity(), { status: 'unavailable' });
  assert.deepEqual(await reply(true, { status: 'refused' }).readActivity(), { status: 'unavailable' });
  assert.deepEqual(await createAccountHttpAdapter({ fetchImpl: async () => { throw new Error('offline'); } }).readActivity(), { status: 'unavailable' });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(createAccountHttpAdapter({ fetchImpl: async () => { throw new Error('aborted'); } }).readActivity({ signal: abort.signal }));
});

// Your cars layout (10 November): head row, car, Your preferences, then the secondary components.
test('the page head carries the title only; the freshness line closes the page and Refresh shows only when stale', async () => {
  const input = unnamed('ready');
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    const body = root.querySelector('.gcsp-account-body');
    const head = body.querySelector('.gcsp-account-head');
    assert.ok(head.querySelector('h1')); assert.equal(head.querySelector('.vm-kicker'), null);
    assert.equal(head.children.length, 1, 'nothing on the right of the head yet');
    assert.equal(body.querySelector('.gcsp-account-fresh'), null);
    assert.equal(body.lastElementChild.textContent, 'Account as of 5 November 2026 at 09:00.');
    assert.ok(body.lastElementChild.classList.contains('gcsp-synthetic'));
    assert.equal(head.querySelector('button'), null, 'Refresh account only when stale');
    const secondary = body.querySelector('.gcsp-account-secondary');
    assert.ok(secondary.contains(body.querySelector('.gcsp-account-history')) && secondary.querySelector('#gcsp-account-details-title'));
    assert.equal(secondary.nextElementSibling, body.lastElementChild);
  } finally { destroy(); root.remove(); }
});

test('the current car: heading and specification, countdown, ordered facts, details and the one replacement action', async () => {
  const input = unnamed('ready');
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    const car = root.querySelector('.gcsp-feature');
    assert.equal(car.querySelector('h2').textContent, 'BMW 3 Series Touring 320i');
    assert.equal(car.querySelector('.gcsp-account-spec').textContent, '320i M Sport Touring \u00b7 Petrol');
    assert.equal(car.querySelector('.gcsp-account-spec').previousElementSibling, car.querySelector('h2'));
    const countdown = car.querySelector('.gcsp-countdown');
    assert.equal(countdown.textContent, 'Contract ends in 26 days \u00b7 1 December 2026');
    assert.equal(countdown.previousElementSibling.className, 'gcsp-account-title');
    // Registration is unsupplied in the fixture, so its row is hidden; Points cost is last.
    assert.deepEqual(factPairs(car.querySelector('.gcsp-account-car-facts')), [['Status', 'Current car'], ['Driver', 'Paula Mason'],
      ['Contract end', '1 December 2026'], ['Term', '6 months'], ['Annual mileage', '12,000 mi/year'], ['Current mileage', '5,200 mi'],
      ['Points cost', '1,100 / 1,300 points per month']]);
    const details = car.querySelector('details.gcsp-details');
    assert.equal(details.querySelector('summary.gcsp-details-summary').textContent, 'Order, collection and vehicle details');
    assert.deepEqual(factPairs(details), [['Collected', '1 June 2026'], ['Replacement collection', '12 Nov to 1 Dec']]);
    assert.deepEqual([...car.querySelectorAll('button')].map((node) => node.textContent), ['Choose a replacement']);
    for (const gone of ['.gcsp-account-key', '.gcsp-account-context', '.gcsp-account-dot', '.vm-media-caption', '.gcsp-summary']) assert.equal(car.querySelector(gone), null, gone);
    assert.doesNotMatch(car.textContent, /View car record|Image source|Your buddy|Your allowance/);
    assert.equal(car.querySelector('.gcsp-media').classList.contains('gcsp-media-whole'), true);
  } finally { destroy(); root.remove(); }
  const sparse = unnamed('ready'); const contract = sparse.value.contracts[0];
  for (const key of ['actualCollectionDate', 'earliestCollectionDate', 'latestCollectionDate']) delete contract[key];
  delete contract.vehicle.configuration; delete contract.vehicle.fuel; contract.registration = 'AB12 CDE'; contract.vin = 'ZZSYNTHETIC000009';
  const second = await domMount({ ...readOnlyAdapter(), readAccount: async () => sparse });
  try {
    const car = second.root.querySelector('.gcsp-feature');
    assert.equal(car.querySelector('.gcsp-account-spec'), null, 'no specification line without supplied facts');
    assert.ok(factPairs(car.querySelector('.gcsp-account-car-facts')).some(([label, value]) => label === 'Registration' && value === 'AB12 CDE'));
    assert.deepEqual(factPairs(car.querySelector('details')), [['Delivered VIN', 'ZZSYNTHETIC000009']]);
  } finally { second.destroy(); second.root.remove(); }
  const bare = unnamed('ready'); const naked = bare.value.contracts[0];
  for (const key of ['actualCollectionDate', 'earliestCollectionDate', 'latestCollectionDate', 'vin', 'orderNumber', 'orderReference']) delete naked[key];
  delete naked.contractEndDate;
  const third = await domMount({ ...readOnlyAdapter(), readAccount: async () => bare });
  try {
    const car = third.root.querySelector('.gcsp-feature');
    assert.equal(car.querySelector('details'), null, 'no details element when nothing is supplied');
    assert.equal(car.querySelector('.gcsp-note').textContent, 'Contract end: Not supplied');
  } finally { third.destroy(); third.root.remove(); }
});

test('DOM order: Your cars, then Your preferences, then Order history and Your details; the car holds no record control or key strip', async () => {
  const { root, destroy } = await domMount(readOnlyAdapter());
  try {
    const before = (a, b) => Boolean(a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    const car = root.querySelector('.gcsp-feature'); const prefs = root.querySelector('.gcsp-account-preferences');
    const history = root.querySelector('.gcsp-account-history'); const details = root.querySelector('#gcsp-account-details-title');
    assert.ok(car && prefs && history && details);
    assert.ok(before(car, prefs) && before(prefs, history) && before(history, details));
    assert.ok(before(root.querySelector('.gcsp-account-head'), car));
    assert.equal(root.querySelectorAll('.gcsp-account-key').length, 0);
    assert.equal(root.querySelector('[aria-label="Your buddy"]'), null);
    assert.equal(car.querySelector('.gcsp-actions').textContent, 'Choose a replacement');
    for (const view of root.querySelectorAll('.gcsp-table-action')) assert.ok(history.contains(view));
    assert.equal(findButton(root, 'View car record'), undefined);
  } finally { destroy(); root.remove(); }
});

test('Points cost shows once, from the authoritative terms and allowance, and follows them', async () => {
  const count = (root) => pointsCosts(root).length;
  const ready = await domMount(readOnlyAdapter());
  try {
    assert.deepEqual(pointsCosts(ready.root), ['1,100 / 1,300 points per month']);
    assert.doesNotMatch(ready.root.textContent, /Your allowance|points a month/);
  } finally { ready.destroy(); ready.root.remove(); }
  const render = async (edit, name = 'ready') => {
    const input = accountFixture(name); edit(input.value);
    const view = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
    const text = pointsCost(view.root.querySelector('.gcsp-feature')); view.destroy(); view.root.remove(); return text;
  };
  assert.equal(await render((v) => { v.contracts[0].terms = { kind: 'points-monthly', value: 1250, allowance: 1500 }; }), '1,250 / 1,500 points per month');
  assert.equal(await render((v) => { v.allowance.monthlyPoints = 1400; }), '1,100 / 1,400 points per month', 'the account allowance feeds the trusted scheme');
  assert.equal(await render((v) => { v.contracts[0].vehicle.points = 1000; }), '1,000 / 1,300 points per month');
  assert.equal(await render((v) => { v.contracts[0].terms = { kind: 'points-monthly', value: 1100, allowance: 0 }; }), '1,100 / 0 points per month', 'a zero budget is real');
  assert.equal(await render((v) => { v.contracts[0].terms = { kind: 'points-monthly', value: 0, allowance: 1300 }; }), '0 / 1,300 points per month', 'a zero cost is real');
  assert.equal(await render((v) => { v.contracts[0].terms = { kind: 'points-monthly', allowance: 1300 }; delete v.contracts[0].vehicle.points; }), 'Cost not supplied \u00b7 1,300 points per month budget');
  assert.equal(await render((v) => { v.contracts[0].terms = { kind: 'points-monthly', value: 1100, allowance: null }; }), '1,100 points per month \u00b7 budget not supplied');
  assert.equal(await render((v) => { v.contracts[0].terms = { kind: 'points-monthly', value: null, allowance: null }; delete v.contracts[0].vehicle.points; }), 'Not supplied');
  assert.equal(await render((v) => { v.allowance = { status: 'unknown' }; }), '1,100 points per month \u00b7 budget not supplied', 'an unknown allowance is not supplied');
  // Another scheme's allowance is never borrowed.
  const multi = await domMount(readOnlyAdapter('multi-slot'));
  try {
    const cars = [...multi.root.querySelectorAll('.gcsp-feature')];
    assert.equal(pointsCost(cars[1]), '1,100 points per month \u00b7 budget not supplied');
    assert.equal(count(multi.root), 2);
  } finally { multi.destroy(); multi.root.remove(); }
});

test('Your preferences is a mount point: default content, a supplied capability that survives quiet redraws, teardown on destroy', async () => {
  const keys = [];
  const plain = await domMount(readOnlyAdapter(), { onNavigate: (key) => keys.push(key) });
  try {
    const region = plain.root.querySelector('section.gcsp-account-preferences');
    assert.equal(region.id, 'gcsp-account-preferences');
    const title = region.querySelector('h2.gcsp-h2'); assert.equal(title.textContent, 'Your preferences');
    assert.equal(region.getAttribute('aria-labelledby'), title.id);
    assert.equal(region.querySelector('.gcsp-note').textContent, 'Tell your buddy what matters in your next car.');
    const edit = findLink(region, 'Edit your preferences'); assert.ok(edit.classList.contains('vm-btn-ghost'));
    assert.match(edit.getAttribute('href'), /gcsp-brief-live\.html$/);
    edit.click(); assert.deepEqual(keys, ['brief']);
  } finally { plain.destroy(); plain.root.remove(); }
  let calls = 0; let torn = 0; let mountedRegion; let signal;
  let rating = 1; const adapter = { ...readOnlyAdapter(), readAccount: async () => { const input = unnamed('ready'); input.value.contracts[0].annualMileage = 12000 + rating; return input; } };
  const custom = await domMount(adapter, { preferences: (region, options) => {
    calls += 1; mountedRegion = region; signal = options.signal;
    const node = document.createElement('p'); node.className = 'capability'; node.textContent = 'capability mounted'; region.append(node);
    return () => { torn += 1; };
  } });
  try {
    const region = custom.root.querySelector('.gcsp-account-preferences');
    assert.equal(region, mountedRegion); assert.equal(calls, 1); assert.ok(region.querySelector('.capability'));
    assert.equal(region.querySelector('.gcsp-note'), null, 'the capability owns the whole region');
    const capability = region.querySelector('.capability');
    rating = 2; await custom.destroy.sync(); await tick();
    assert.match(custom.root.querySelector('.gcsp-feature').textContent, /12,002/, 'the sync redrew with changed data');
    assert.equal(custom.root.querySelector('.gcsp-account-preferences'), region, 'the same region node is reused');
    assert.equal(region.querySelector('.capability'), capability); assert.equal(calls, 1); assert.equal(torn, 0);
    assert.equal(signal.aborted, false);
    custom.destroy();
    assert.equal(torn, 1); assert.equal(signal.aborted, true);
  } finally { custom.destroy(); custom.root.remove(); }
});

test('FUCQ-368: the supplied preferences capability fills the region in order', async () => {
  const { mountAccountPreferences } = await import('../../blocks/gcsp/brief/account-preferences.js');
  const { previewPreferenceTransport } = await import('../../blocks/gcsp/brief/account-preferences-fixtures.js');
  let mounted;
  const view = await domMount(readOnlyAdapter(), {
    preferences: (region, { signal }) => { mounted = mountAccountPreferences(region, { signal, transport: previewPreferenceTransport('selected') }); return mounted; } });
  try {
    await mounted.ready; await tick();
    const before = (a, b) => Boolean(a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    const car = view.root.querySelector('.gcsp-feature'); const prefs = view.root.querySelector('.gcsp-account-preferences');
    const history = view.root.querySelector('.gcsp-account-history'); const details = view.root.querySelector('#gcsp-account-details-title');
    assert.equal(prefs.querySelectorAll('.gcsp-prefs-tile').length, 6); assert.equal(prefs.querySelector('a'), null);
    assert.ok(before(car, prefs) && before(prefs, history) && before(history, details));
  } finally { view.destroy(); view.root.remove(); }
});

test('no Your preferences region appears when the account itself could not be read', async () => {
  const view = await domMount(readOnlyAdapter('source-failure'));
  try {
    assert.equal(view.root.querySelector('.gcsp-account-preferences'), null);
    assert.equal(view.root.querySelector('.gcsp-account-history'), null);
  } finally { view.destroy(); view.root.remove(); }
});

test('the offer sits outside the car and opens the offer; a held offer ghosts Choose a replacement', async () => {
  const offers = (state) => async () => ({ status: 'ok', value: { offers: [{ offerId: 'offer-1', runId: 'run-1', ...(state ? { state } : {}) }] } });
  const held = await domMount({ ...readOnlyAdapter(), readOffers: offers('pending') });
  try {
    const offer = held.root.querySelector('[aria-label="Your car offer"]'); const car = held.root.querySelector('.gcsp-feature');
    assert.ok(offer && !car.contains(offer) && !offer.contains(car));
    assert.ok(offer.compareDocumentPosition(car) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'the offer precedes the car');
    assert.equal(offer.querySelector('h2').textContent, 'Your car offer');
    assert.equal(findButton(offer, 'View your offer').classList.contains('vm-btn-primary'), true);
    assert.match(offer.textContent, /Decide on your car offer before choosing another car\./);
    assert.equal(ghost(held.root, 'Choose a replacement'), true);
    assert.equal(findButton(held.root, 'Choose a replacement').disabled, false);
  } finally { held.destroy(); held.root.remove(); }
  const open = await domMount({ ...readOnlyAdapter(), readOffers: offers('declined') });
  try {
    assert.equal(ghost(open.root, 'Choose a replacement'), false);
    assert.doesNotMatch(open.root.textContent, /Decide on your car offer before/);
    assert.ok(findButton(open.root, 'View your offer'));
  } finally { open.destroy(); open.root.remove(); }
});

test('a missing image keeps a readable placeholder in the whole-car well and the car identity', async () => {
  const view = await domMount(readOnlyAdapter('missing-image'));
  try {
    const car = view.root.querySelector('.gcsp-feature');
    const media = car.querySelector('.vm-card-media');
    assert.ok(media.classList.contains('gcsp-media-whole')); assert.equal(media.classList.contains('has-photo'), false);
    assert.equal(media.querySelector('.vm-card-soon').textContent, 'No image available for your car');
    assert.equal(car.querySelector('h2').textContent, 'BMW 3 Series Touring 320i');
    assert.equal(car.querySelector('.gcsp-account-spec').textContent, '320i M Sport Touring \u00b7 Petrol');
  } finally { view.destroy(); view.root.remove(); }
});

test('the car record drawer opens from history rows only, and Escape, Close and the scrim return focus to the exact opener', async () => {
  const { root, destroy } = await domMount(readOnlyAdapter());
  const press = (key) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  try {
    assert.equal(root.querySelector('.gcsp-side-drawer'), null);
    const opener = root.querySelectorAll('.gcsp-account-history tbody .gcsp-table-action')[0]; opener.focus(); opener.click();
    let panel = root.querySelector('.gcsp-side-drawer-panel');
    assert.equal(panel.getAttribute('role'), 'dialog'); assert.equal(panel.getAttribute('aria-modal'), 'true');
    const heading = panel.querySelector('h2'); assert.equal(panel.getAttribute('aria-labelledby'), heading.id);
    assert.equal(heading.textContent, 'BMW 3 Series Touring 320i'); assert.equal(document.activeElement, heading);
    assert.equal(panel.querySelector('.gcsp-side-drawer-context').textContent, 'Car record \u00b7 Scheme 1');
    assert.deepEqual([...panel.querySelectorAll('h3')].map((n) => n.textContent), ['Contract', 'Collection', 'Order and vehicle', 'Technical specification and options']);
    press('Escape'); assert.equal(root.querySelector('.gcsp-side-drawer'), null); assert.equal(document.activeElement, opener);
    // From a history row, with the Close button.
    const rowButton = root.querySelectorAll('.gcsp-account-history tbody .gcsp-table-action')[1]; rowButton.focus(); rowButton.click();
    panel = root.querySelector('.gcsp-side-drawer-panel');
    assert.equal(panel.querySelector('h2').textContent, 'Model not supplied');
    assert.match(sectionOf(panel, 'Contract').textContent, /StatusReturned/); assert.match(sectionOf(panel, 'Contract').textContent, /Returned1 December 2025/);
    findButton(panel, 'Close').click(); assert.equal(root.querySelector('.gcsp-side-drawer'), null);
    assert.equal(document.activeElement.getAttribute('aria-label'), rowButton.getAttribute('aria-label'));
    // The scrim closes it too, and Tab stays inside.
    opener.click(); const inside = root.querySelector('.gcsp-side-drawer-panel');
    const last = inside.querySelector('.gcsp-side-drawer-foot button'); last.focus();
    press('Tab'); assert.ok(inside.contains(document.activeElement));
    root.querySelector('.gcsp-side-drawer-backdrop').click(); assert.equal(root.querySelector('.gcsp-side-drawer'), null);
    assert.equal(document.activeElement, opener);
  } finally { destroy(); root.remove(); }
});

test('the car record shows supplied facts only, with one line for a section that has none', async () => {
  const { root, destroy } = await domMount(readOnlyAdapter());
  try {
    const panel = openFrom(root);
    assert.deepEqual(factPairs(sectionOf(panel, 'Contract')), [['Status', 'Current car'], ['Driver', 'Paula Mason'], ['Term', '6 months'],
      ['Annual mileage', '12,000 mi/year'], ['Contract end', '1 December 2026']]);
    assert.deepEqual(factPairs(sectionOf(panel, 'Collection')), [['Collected', '1 June 2026'],
      ['Replacement window', '12 November 2026 to 1 December 2026'], ['Current mileage', '5,200 mi']]);
    assert.equal(sectionOf(panel, 'Order and vehicle').textContent.replace('Order and vehicle', ''), 'Not supplied for this car.');
    assert.match(sectionOf(panel, 'Technical specification and options').textContent, /does not confirm the fitted equipment on your car\.Not supplied for this car\./);
    assert.equal(panel.querySelectorAll('.is-missing').length, 0); assert.doesNotMatch(panel.textContent, /Not supplied(?! for this car)/);
  } finally { destroy(); root.remove(); }
});

test('order history is one table across schemes with a status word per row, and one muted line for empty and history-only schemes', async () => {
  const { root, destroy } = await domMount(readOnlyAdapter());
  try {
    const section = root.querySelector('.gcsp-account-history');
    assert.equal(section.querySelector('h2').textContent, 'Order history');
    assert.equal(section.querySelectorAll('table').length, 1); assert.ok(section.querySelector('.gcsp-table-wrap.is-stack'));
    assert.deepEqual([...section.querySelectorAll('thead th')].map((n) => n.textContent), ['Car', 'Scheme', 'Collected', 'Ended', 'Status', 'Record']);
    assert.deepEqual(rowsOf(root).map(cellsOf), [
      ['BMW 3 Series Touring 320i', 'Scheme 1', '1 June 2026', 'Ends 1 Dec 2026', 'Current car', 'View record'],
      ['Model not supplied', 'Scheme 2', '1 January 2025', 'Returned 1 Dec 2025', 'Returned', 'View record']]);
    assert.equal(rowsOf(root)[0].querySelector('.is-success').textContent, 'Current car');
    assert.equal(rowsOf(root)[1].querySelector('.is-success'), null);
    assert.equal(section.querySelector('.gcsp-synthetic').textContent, "No Scheme 3 orders. Scheme 2 shows history only; you can't order through it here.");
    assert.equal(root.querySelectorAll('.gcsp-account-history .gcsp-table-action').length, 2);
    assert.equal(findButton(root, 'Choose a replacement').closest('.gcsp-feature') !== null, true);
    assert.equal(root.querySelectorAll('.gcsp-account-history .vm-btn-primary').length, 0);
  } finally { destroy(); root.remove(); }
  const named = await domMount({ ...readOnlyAdapter(), readAccount: async () => accountFixture('ready') });
  try {
    assert.equal(named.root.querySelector('.gcsp-account-history .gcsp-synthetic').textContent,
      "No Motorcycle Choices orders. PCS UK FS BMW shows history only; you can't order through it here.");
  } finally { named.destroy(); named.root.remove(); }
  const none = await domMount(readOnlyAdapter('no-history'));
  try { assert.equal(none.root.querySelector('.gcsp-account-history p').textContent, 'No order history.'); } finally { none.destroy(); none.root.remove(); }
});

test('Your details is two rows, each with its help button, showing supplied values only', async () => {
  const input = unnamed('ready'); input.value.account.allowanceOverride = null;
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    const rows = [...root.querySelectorAll('.gcsp-account-row')];
    assert.equal(root.querySelector('#gcsp-account-details-title').textContent, 'Your details');
    assert.deepEqual(rows.map((node) => node.querySelector('h3').textContent), ['Employee', 'Drivers (2)']);
    assert.equal(root.querySelectorAll('.gcsp-account-secondary details').length, 0);
    assert.equal(rows[0].querySelector('strong').textContent, 'Paula Mason');
    assert.equal(rows[0].querySelector('.gcsp-account-lines').textContent,
      'Paula Mason · Employee number E749057 · Band G7paula.mason@gcsp-demo.com · 01632 96000027 Ashdown Road, Bracknell, RG12 9ZZ');
    assert.deepEqual([...rows[0].querySelectorAll('button')].map((n) => n.textContent), ['Get help with your details']);
    assert.deepEqual([...rows[1].querySelectorAll('.gcsp-account-line')].map((n) => n.textContent), [
      'Paula Mason · You · Car licence valid until 1 January 2030 · MASON900000PM9XX',
      'Casey Ward · Nominated driver, spouse · Car licence valid until 1 January 2030 · WARD9900000CW9XX']);
    assert.deepEqual([...rows[1].querySelectorAll('button')].map((n) => n.textContent), ['Get help with drivers']);
    let route; root.addEventListener('gcsp:support', (event) => { route = event.detail.route; });
    rows[1].querySelector('button').click(); assert.equal(route, 'driver-support');
  } finally { destroy(); root.remove(); }
  const bare = accountFixture('ready'); bare.value.drivers = [];
  const empty = await domMount({ ...readOnlyAdapter(), readAccount: async () => bare });
  try {
    const row = detailsRow(empty.root, 'Drivers (0)');
    assert.match(row.textContent, /No driver or licence details supplied\./); assert.ok(row.querySelector('button'));
  } finally { empty.destroy(); empty.root.remove(); }
});

// FUCQ-372: the saved journey card offers Carry on and a confirmed Discard.
const draftCard = (mode = 'replacement', stage = 'intent') => ({ status: 'ok', value: { draftStage: stage, draftVersion: 3, contextVersion: 'context',
  requiresRefresh: false, choices: { mode, oldContractId: mode === 'replacement' ? 'current:employee-paula' : null, slotId: 'slot-paula', schemeId: 'choices-fs-uk' } } });
const press = (node, key) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));

test('FUCQ-372: the saved journey card names the state, shows Carry on and Discard side by side, and Carry on resumes', async () => {
  const draft = draftCard(); let starts = 0; draft.value.contextVersion = unnamed('ready').value.contextVersion;
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readDraft: async () => draft, discardDraft: async () => ({ status: 'ok' }) });
  const events = []; root.addEventListener('gcsp:journey-start', (event) => events.push(event.detail));
  try {
    const card = root.querySelector('.gcsp-summary');
    assert.equal(card.querySelector('h2').textContent, 'You started choosing a replacement');
    assert.match(card.textContent, /Nothing is held or ordered yet\./);
    assert.doesNotMatch(root.textContent, /Resume saved journey|Your starting context is saved|journey saved/);
    assert.match(card.textContent, /Current carBMW 3 Series Touring 320i/);
    const buttons = [...card.querySelectorAll('.gcsp-actions button')];
    assert.deepEqual(buttons.map((node) => node.textContent), ['Carry on', 'Discard']);
    assert.deepEqual(buttons.map((node) => node.classList.contains('vm-btn-primary')), [true, false]);
    assert.equal(buttons[0].parentElement, buttons[1].parentElement);
    findButton(root, 'Carry on').click(); await tick(); await tick();
    assert.equal(events.length, 1); assert.equal(events[0].draftVersion, 3); starts += 1;
  } finally { destroy(); root.remove(); }
  const complete = await domMount({ ...readOnlyAdapter(), readDraft: async () => draftCard('new', 'complete') });
  try {
    assert.equal(complete.root.querySelector('.gcsp-summary h2').textContent, 'You started a new car order');
    assert.match(complete.root.querySelector('.gcsp-summary').textContent, /Your order choices are saved\. Nothing is ordered yet\./);
    assert.equal(findButton(complete.root, 'Discard'), undefined, 'no Discard without an adapter discardDraft');
    assert.ok(findButton(complete.root, 'Carry on'));
  } finally { complete.destroy(); complete.root.remove(); }
  assert.equal(starts, 1);
});

test('FUCQ-372: Discard opens a confirmation that takes focus; Keep it and Escape return focus to Discard', async () => {
  let discards = 0;
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readDraft: async () => draftCard(), discardDraft: async () => { discards += 1; return { status: 'ok' }; } });
  try {
    findButton(root, 'Discard').click();
    const box = root.querySelector('.gcsp-discard-confirm');
    assert.ok(box); assert.match(box.textContent, /Discard this journey\? Your current car and any offers are not affected\./);
    assert.equal(document.activeElement, box);
    assert.deepEqual([...box.querySelectorAll('button')].map((node) => [node.textContent, node.classList.contains('vm-btn-primary')]),
      [['Discard journey', true], ['Keep it', false]]);
    assert.equal(findButton(root, 'Carry on'), undefined);
    findButton(root, 'Keep it').click();
    assert.equal(root.querySelector('.gcsp-discard-confirm'), null);
    assert.equal(document.activeElement, findButton(root, 'Discard'));
    findButton(root, 'Discard').click(); press(root.querySelector('.gcsp-discard-confirm'), 'Escape');
    assert.equal(root.querySelector('.gcsp-discard-confirm'), null);
    assert.equal(document.activeElement, findButton(root, 'Discard')); assert.equal(discards, 0);
  } finally { destroy(); root.remove(); }
});

test('FUCQ-372: a confirmed discard writes once against the draft version, removes the card and focuses the page heading', async () => {
  const f = await setup(); const calls = [];
  const { root, destroy } = await domMount(serviceAdapter(f, calls));
  try {
    findButton(root, 'Choose a replacement').click(); await tick(); await tick();
    findButton(root, 'Back to account').click(); await destroy.refresh();
    assert.ok(root.querySelector('.gcsp-summary'));
    findButton(root, 'Discard').click(); findButton(root, 'Discard journey').click(); await tick(); await tick(); await tick();
    const posts = calls.filter((call) => call.url.endsWith('/draft/discard'));
    assert.equal(posts.length, 1); assert.deepEqual(Object.keys(posts[0].body).sort(), ['commandId', 'expectedDraftVersion']);
    assert.equal(posts[0].body.expectedDraftVersion, 1);
    assert.equal(root.querySelector('.gcsp-summary'), null); assert.equal(findButton(root, 'Carry on'), undefined);
    assert.equal((await f.service.readDraft(f.context)).status, 'not-found');
    assert.equal(document.activeElement, root.querySelector('main h1'));
    assert.ok(findButton(root, 'Choose a replacement'));
  } finally { destroy(); root.remove(); }
});

test('FUCQ-372: a failed or stale discard keeps the card with a plain message and no raw codes', async () => {
  let reads = 0; let outcome = { status: 'unavailable', code: 'account-transport-unavailable' };
  const adapter = { ...readOnlyAdapter(), readDraft: async () => { reads += 1; return draftCard(); }, discardDraft: async () => outcome };
  const { root, destroy } = await domMount(adapter);
  try {
    findButton(root, 'Discard').click(); findButton(root, 'Discard journey').click(); await tick(); await tick();
    assert.ok(root.querySelector('.gcsp-summary'), 'card kept');
    assert.match(root.querySelector('.gcsp-account-message').textContent, /Journey could not be discarded/);
    assert.doesNotMatch(root.textContent, /unavailable|account-transport|stale-version|release-required/);
    assert.equal(root.querySelector('.gcsp-discard-confirm'), null);
    const before = reads; outcome = { status: 'stale-version', resource: 'manual-draft' };
    findButton(root, 'Discard').click(); findButton(root, 'Discard journey').click(); await tick(); await tick();
    assert.ok(reads > before, 'stale re-reads the draft');
    assert.match(root.querySelector('.gcsp-account-message').textContent, /Your journey has changed[\s\S]*try again/i);
    outcome = { status: 'conflict', reason: 'release-required' };
    findButton(root, 'Discard').click(); findButton(root, 'Discard journey').click(); await tick(); await tick();
    assert.match(root.querySelector('.gcsp-account-message').textContent, /Release it before discarding/);
    assert.ok(root.querySelector('.gcsp-summary'));
  } finally { destroy(); root.remove(); }
});

test('FUCQ-372: a refresh-required card offers neither Carry on nor Discard', async () => {
  const draft = draftCard(); draft.value.requiresRefresh = true;
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readDraft: async () => draft, discardDraft: async () => ({ status: 'ok' }) });
  try {
    assert.match(root.querySelector('.gcsp-summary').textContent, /Your saved context has changed/);
    assert.equal(findButton(root, 'Carry on'), undefined); assert.equal(findButton(root, 'Discard'), undefined);
  } finally { destroy(); root.remove(); }
});
