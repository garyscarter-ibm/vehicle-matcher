import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
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
  assert.equal(view.additionalDrivers[0].licence.displayNumber, 'FICTIONAL-NOMINEE');
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
const findButton = (root, text) => [...root.querySelectorAll('button')].find((node) => node.textContent === text);
const findDetail = (root, text) => [...root.querySelectorAll('details')].find((node) => node.firstElementChild.textContent === text);
const readOnlyAdapter = (name = 'ready') => ({ readAccount: async () => accountFixture(name),
  readDraft: async () => ({ status: 'not-found' }), startJourney: async () => ({ status: 'unavailable' }) });
function domHost() { const node = document.createElement('div'); document.body.append(node); return node; }
async function domMount(adapter = readOnlyAdapter(), options = {}) {
  const root = domHost(); const destroy = mountAccount(root, { adapter, ...options }); await tick();
  return { root, destroy };
}
function serviceAdapter(f, calls = []) {
  return createAccountHttpAdapter({ fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    const result = options.method === 'POST' ? await f.service.saveDraft(f.context, JSON.parse(options.body))
      : url.endsWith('/account') ? await f.service.readAccount(f.context) : await f.service.readDraft(f.context);
    return response(result, result.status === 'ok' ? 200 : result.status === 'not-found' ? 404 : 409);
  } });
}

test('account composition preserves complete supplied facts, labelled details and dated vehicle hierarchy', async () => {
  const input = accountFixture('multi-slot');
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
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    assert.equal(root.querySelectorAll('main h1').length, 1);
    assert.equal(root.querySelectorAll('.gcsp-feature').length, 2);
    const current = root.querySelector('.gcsp-feature');
    assert.match(current.textContent, /ends in 26 days, on 1 December 2026/);
    assert.match(current.textContent, /1,100 points a month · 1,300 points a month allowance/);
    const otherScheme = root.querySelectorAll('.gcsp-feature')[1];
    assert.doesNotMatch(otherScheme.querySelector('.gcsp-account-terms').textContent, /1,300/);
    assert.match(otherScheme.querySelector('.gcsp-account-terms').textContent, /allowance not supplied/i);
    assert.doesNotMatch(current.textContent, /current:employee-paula|slot-paula|choices-fs-uk/);
    for (const text of ['7654321', '1 May 2026', '30 May 2026', '1 June 2026', '6,500', '6,420',
      'ZZSYNTHETIC000001', '156 g/km (WLTP combined)', '£55,295 (List price)', 'SYN01', 'Fictional option']) assert.ok(current.textContent.includes(text), text);
    assert.equal(root.querySelectorAll('.gcsp-feature > .gcsp-feature-copy > button').length, 1);
    assert.ok(findDetail(root, 'Employee and contact details').textContent.includes('1,500 points/month'));
    const drivers = findDetail(root, 'Drivers and licences (2)');
    for (const text of ['Approved', '2 February 1992', '2 Fictional Avenue', 'FAKE-CAR-BIKE', 'Car licence type', 'Bike licence type', '2032']) {
      assert.ok(drivers.textContent.includes(text), text);
    }
    assert.ok(findDetail(root, 'Scheme 2 (2 records)'));
    assert.match(root.textContent, /Not supplied/);
    assert.doesNotMatch(root.textContent, /\[object Object\]|undefined|NaN|Invalid Date/);
    // The shell's presenter bar (112fdfe2) stays hidden without a presenter session; the account itself has no controls.
    assert.equal([...root.querySelectorAll('input, select, textarea')].filter((n) => !n.closest('.gcsp-presenter-region')).length, 0);
    assert.equal(root.querySelector('.gcsp-presenter-controls').hidden, true);
    assert.equal(root.querySelectorAll('.vm-decision, .vm-card-score').length, 0);
    assert.match(root.textContent, /Synthetic example data/);
  } finally { destroy(); root.remove(); }
});

test('current contracts retain their explicit scheme allowance including zero and unknown', async () => {
  const input = accountFixture('multi-slot');
  input.value.contracts[0].terms = { kind: 'points-monthly', value: 1100, allowance: 0 };
  input.value.contracts[1].terms = { kind: 'points-monthly', value: 900, allowance: 950 };
  const adapter = { ...readOnlyAdapter(), readAccount: async () => input };
  const first = await domMount(adapter);
  try {
    const terms = [...first.root.querySelectorAll('.gcsp-account-terms')].map((node) => node.textContent);
    assert.match(terms[0], /0 points a month allowance/);
    assert.match(terms[1], /950 points a month allowance/);
  } finally { first.destroy(); first.root.remove(); }
  input.value.contracts[0].terms.allowance = null;
  const second = await domMount(adapter);
  try {
    assert.match(second.root.querySelector('.gcsp-account-terms').textContent, /allowance not supplied/i);
  } finally { second.destroy(); second.root.remove(); }
});

test('representative image provenance survives a broken image fallback without claiming exact equipment', async () => {
  const input = accountFixture(); input.value.contracts[0].media = { src: '/fictional-missing.jpg',
    caption: 'Representative model image', provenance: { source: 'dated illustration' } };
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    const media = root.querySelector('.gcsp-media');
    assert.equal(media.querySelector('img').alt, 'Fictional BMW 320i Touring: representative image');
    assert.match(media.textContent, /Representative model image/);
    media.querySelector('img').dispatchEvent(new window.Event('error'));
    assert.equal(media.querySelector('img'), null); assert.equal(media.classList.contains('has-photo'), false);
    assert.match(media.textContent, /No image for this car yet/);
    assert.match(root.textContent, /dated illustration/);
    assert.match(root.textContent, /does not confirm the fitted equipment/);
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
      assert.ok(findButton(root, 'Refresh account'));
      assert.equal(Boolean(findButton(root, 'Start a new order')), name === 'no-current-car');
      if (!['no-current-car', 'no-history'].includes(name)) assert.equal(findButton(root, 'Choose a replacement'), undefined);
      if (name === 'unsupported-scheme') {
        const history = findDetail(root, 'Scheme 1 (1 record)');
        assert.match(history.textContent, /StatusCurrent car/);
        assert.ok(history.querySelector('summary')); assert.equal(history.querySelectorAll('button').length, 1);
        assert.match(history.querySelector('button').textContent, /Print record/);
      }
      if (name === 'absent-hr-account') {
        let event; root.addEventListener('gcsp:support', (value) => { event = value; });
        findButton(root, 'Contact support').click();
        assert.equal(event.detail.route, 'hr-support'); assert.equal(event.bubbles, true); assert.equal(event.composed, true);
        assert.match(root.textContent, /does not send a support request/);
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
    assert.match(root.textContent, /No car has been selected or ordered/);
    assert.match(root.querySelector('.gcsp-feature').textContent, /Fictional BMW 320i Touring/);
    findButton(root, 'Back to account').click(); assert.equal(root.querySelector('main h1').textContent, 'Your cars');
    await destroy.refresh(); assert.ok(findButton(root, 'Resume saved journey'));
    findButton(root, 'Resume saved journey').click(); await tick(); await tick();
    assert.equal(events.length, 2); assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    findButton(root, 'Back to account').click();
    findButton(root, 'Choose a replacement').click(); await tick(); await tick();
    assert.equal(events.length, 3); assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal((await f.service.readAccount(f.context)).value.currentContract.contractEndDate, '2026-12-01');
  } finally { destroy(); root.remove(); document.body.removeEventListener('gcsp:journey-start', listen); }
  const reloaded = await domMount(serviceAdapter(f));
  try { assert.ok(findButton(reloaded.root, 'Resume saved journey')); assert.match(reloaded.root.querySelector('.gcsp-summary').textContent, /Current carFictional BMW 320i Touring/); }
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
    assert.equal(starts, 1); assert.equal(events, 0); assert.match(root.querySelector('.gcsp-account-body [role="alert"]').textContent, /context has changed/);
    assert.match(root.textContent, /Refresh and review/);
    const changed = accountFixture(); changed.value.account.name = 'Changed fictional employee';
    adapter.readAccount = async () => changed; await destroy.refresh();
    assert.match(root.querySelector('.gcsp-account-name').textContent, /Changed fictional employee/);
    assert.equal(root.querySelector('.gcsp-account-body [role="alert"]'), null);
  } finally { destroy(); root.remove(); }
});

test('pending reads cannot render or emit after teardown; native history details and print retain supplied records', async () => {
  let release;
  const delayed = domHost(); const destroy = mountAccount(delayed, { adapter: { ...readOnlyAdapter(),
    readAccount: () => new Promise((done) => { release = done; }) } });
  destroy(); release(accountFixture()); await tick(); assert.equal(delayed.children.length, 0); delayed.remove();
  let printed;
  const active = await domMount(readOnlyAdapter(), { print: (entry) => { printed = entry; assert.ok(entry.querySelector('details').open); } });
  try {
    const history = findDetail(active.root, 'Scheme 1 (1 record)'); history.open = true;
    const entry = history.querySelector('article'); const print = [...entry.querySelectorAll('button')].find((node) => /Print/.test(node.textContent));
    print.focus(); assert.equal(document.activeElement, print); print.click();
    assert.equal(printed, entry); assert.equal(entry.querySelector('details').open, false);
    assert.equal(history.open, true);
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
    assert.equal(events, 1); assert.match(root.querySelector('.gcsp-account-body [role="alert"]').textContent, /context has changed/);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    await destroy.refresh();
    assert.equal(findButton(root, 'Resume saved journey'), undefined);
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
    assert.equal(events, 0); assert.match(root.querySelector('.gcsp-account-body [role="alert"]').textContent, /could not be saved/);
    assert.equal(root.querySelectorAll('.gcsp-feature').length, 0);
  } finally { destroy(); root.remove(); }
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
    assert.ok([...record.querySelectorAll('details')].every((item) => item.open));
    assert.equal(record.querySelectorAll('button').length, 0);
  };
  try {
    const history = findDetail(root, 'Scheme 1 (1 record)'); history.open = true;
    [...history.querySelectorAll('button')].find((item) => /Print/.test(item.textContent)).click();
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
const settleOrder = async (root, ready) => { for (let n = 0; n < 40 && !ready(root); n += 1) await new Promise((done) => setTimeout(done, 15)); };
const selection = (orderUuid, display) => async () => ({ status: 'ok', value: { selection: { stock: { orderUuid, orderNumber: '1000001', facts: { display } } } } });

test('account with an order embeds its progress with the order number, stage names and the selected car', async () => {
  const orders = orderAdapter(); const names = orderProgressFixtures().states['appointment-requested'].stages.value.stages.map((row) => row.label ?? row.name);
  const { root, destroy } = await domMount({ ...readOnlyAdapter(), readOrder: selection(orders.uuid, { name: 'Synthetic i5 eDrive40 Touring', photo: '/img/i5.jpg' }) },
    { orderAdapter: orders });
  try {
    await settleOrder(root, (node) => node.querySelector('.gcsp-account-order .gcsp-order-number'));
    const area = root.querySelector('.gcsp-account-order'); assert.ok(area, 'order area');
    assert.equal(area.getAttribute('aria-label'), 'Your order'); assert.equal(root.querySelectorAll('main h1').length, 1);
    assert.equal(area.querySelector('h2').textContent, 'Order progress');
    assert.match(area.textContent, /Order no\. 1000001/); assert.match(area.textContent, /Synthetic i5 eDrive40 Touring/);
    assert.equal(area.querySelector('img.vm-card-photo').getAttribute('src'), '/img/i5.jpg');
    assert.ok(area.querySelectorAll('.gcsp-stage-tracker li').length >= 3, names.join());
    const first = area.querySelector('.gcsp-order-progress'); (findButton(root, 'Refresh account') ?? {}).disabled; // a redraw keeps the same mounted body
    assert.equal(root.querySelector('.gcsp-account-order .gcsp-order-progress'), first);
  } finally { destroy(); }
  assert.equal(root.querySelector('.gcsp-account-order'), null);
});

test('account shows no order area without an order, on a failed list, or for another order car', async () => {
  const none = await domMount(readOnlyAdapter(), { orderAdapter: orderAdapter('appointment-requested', []) });
  await tick(); assert.equal(none.root.querySelector('.gcsp-account-order'), null); assert.doesNotMatch(none.root.textContent, /No order yet/); none.destroy();
  const failed = orderAdapter(); failed.listOrders = async () => ({ status: 'unavailable' });
  const down = await domMount(readOnlyAdapter(), { orderAdapter: failed }); await tick();
  assert.equal(down.root.querySelector('.gcsp-account-order'), null); down.destroy();
  const plain = await domMount(readOnlyAdapter()); assert.equal(plain.root.querySelector('.gcsp-account-order'), null); plain.destroy();
  const orders = orderAdapter();
  const other = await domMount({ ...readOnlyAdapter(), readOrder: selection('another-order', { name: 'Not this car' }) }, { orderAdapter: orders });
  try {
    await settleOrder(other.root, (node) => node.querySelector('.gcsp-order-number'));
    assert.match(other.root.querySelector('.gcsp-account-order').textContent, /Car details not supplied/);
    assert.doesNotMatch(other.root.textContent, /Not this car/);
  } finally { other.destroy(); }
});

test('FUCQ-193: an accepted offer with its order in progress no longer offers "View your offer"', async () => {
  const offers = (state) => async () => ({ status: 'ok', value: { offers: [{ offerId: 'offer-2', runId: 'run-1', state }, { offerId: 'offer-1', runId: 'run-1', state: 'declined' }] } });
  const orders = orderAdapter();
  const accepted = await domMount({ ...readOnlyAdapter('no-entitlement'), readOffers: offers('accepted'), readOrder: selection(orders.uuid, { name: 'Synthetic 3 Series Saloon 320i' }) }, { orderAdapter: orders });
  try {
    await settleOrder(accepted.root, (node) => node.querySelector('.gcsp-account-order .gcsp-order-number'));
    assert.ok(accepted.root.querySelector('.gcsp-account-order'), 'order progress is shown');
    assert.equal(findButton(accepted.root, 'View your offer'), undefined);
    assert.equal(accepted.root.querySelector('[aria-label="Your car offer"]'), null);
  } finally { accepted.destroy(); }
  const pending = await domMount({ ...readOnlyAdapter(), readOffers: offers('pending') });
  assert.ok(findButton(pending.root, 'View your offer'), 'a pending newest offer keeps its link'); pending.destroy();
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
    await settleOrder(root, (node) => node.querySelector('.gcsp-account-order .gcsp-order-number'));
    assert.doesNotMatch(root.textContent, /No ordering entitlement/);
    const status = root.querySelector('.gcsp-account-order-status'); assert.ok(status, 'order status');
    assert.equal(status.querySelector('h2').textContent, 'Your order is in progress');
    assert.match(status.textContent, /Current step: Sent to ordering\./);
    const link = [...status.querySelectorAll('a')].find((node) => node.textContent === 'View order progress'); assert.ok(link, 'progress link');
    const area = root.querySelector('.gcsp-account-order'); assert.ok(area.id); assert.equal(link.getAttribute('href'), `#${area.id}`);
    assert.equal(findButton(status, 'Contact support'), undefined);
  } finally { destroy(); }
  const other = await mount(orderAdapter('appointment-requested', listed('slot-other')));
  try {
    await settleOrder(other.root, (node) => node.querySelector('.gcsp-account-order .gcsp-order-number'));
    assert.match(other.root.textContent, /No ordering entitlement/); assert.equal(other.root.querySelector('.gcsp-account-order-status'), null);
  } finally { other.destroy(); }
  const none = await domMount(readOnlyAdapter('no-entitlement'), { orderAdapter: orderAdapter('appointment-requested', []) }); await tick();
  assert.match(none.root.textContent, /No ordering entitlement/); none.destroy();
});

test('FUCQ-195: the current-car card shows readable labels and no raw identifiers', async () => {
  const input = accountFixture('ready'); const value = input.value;
  const raw = [value.currentContract.contractId, value.currentContract.slotId, value.currentContract.schemeId,
    value.currentContract.source.sourceRef, value.currentContract.source.sourceVersion];
  const first = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try {
    const card = first.root.querySelector('.gcsp-feature');
    const shownText = [...card.querySelectorAll('dd, p, h2, summary, button')].map((node) => node.textContent);
    for (const id of raw) assert.ok(!shownText.some((text) => text.includes(id)), id);
    assert.ok(![...card.querySelectorAll('dd')].some((node) => node.textContent === value.currentContract.status));
    assert.match(card.textContent, /StatusCurrent car/);
    assert.match(card.querySelector('.gcsp-account-terms').textContent, /^1,100 points a month · 1,300 points a month allowance$/);
    assert.match(card.textContent, /Specification provenanceSynthetic example data/);
    assert.match(card.textContent, /WLTP CO2/);
    assert.doesNotMatch(card.textContent, /Vehicle slot|Scheme|Current contract|points cost not supplied|Wltp/);
  } finally { first.destroy(); first.root.remove(); }
  value.slots[0].label = 'Company car 1';
  const second = await domMount({ ...readOnlyAdapter(), readAccount: async () => input });
  try { assert.match(second.root.querySelector('.gcsp-feature').textContent, /Vehicle slotCompany car 1/); }
  finally { second.destroy(); second.root.remove(); }
});

function assertRestartedPage(root, reloads) {
  const body = root.querySelector('.gcsp-account-body'); const press = (label) => [...body.querySelectorAll('button')].find((node) => node.textContent === label);
  assert.equal(body.querySelector('h1').textContent, 'Your cars'); assert.match(body.textContent, /Demo restarted/);
  assert.match(body.textContent, /Reload the page to continue/);
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
      assert.doesNotMatch(root.textContent, /Account unavailable/); assert.match(root.textContent, /Demo restarted/);
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
  const input = accountFixture('multi-slot'); const value = input.value;
  const entries = value.histories.flatMap((history) => history.entries);
  const raw = [...new Set([...value.histories.map((history) => history.schemeId), ...entries.flatMap((entry) => [entry.contractId, entry.slotId]),
    value.versions.employeeContract.sourceRef, value.versions.employeeContract.sourceVersion, value.asOf])];
  const draft = { status: 'ok', value: { draftStage: 'intent', draftVersion: 3, choices: { mode: 'replacement',
    oldContractId: value.currentContract.contractId, slotId: value.currentContract.slotId, schemeId: value.currentContract.schemeId } } };
  const mounted = await domMount({ ...readOnlyAdapter(), readAccount: async () => input, readDraft: async () => draft });
  try {
    const body = mounted.root.querySelector('.gcsp-account-body');
    const parts = ['.gcsp-summary', '.gcsp-account-histories', ':scope > .gcsp-synthetic'].map((selector) => body.querySelector(selector));
    const shownText = parts.flatMap((part) => [...part.querySelectorAll('dd, p, h2, h3, summary, button'), part]).map((node) => node.textContent);
    for (const id of raw) assert.ok(!shownText.some((text) => text.includes(id)), id);
    const saved = parts[0].textContent;
    assert.match(saved, /Current car/); assert.match(saved, new RegExp(value.currentContract.model));
    assert.doesNotMatch(saved, /Mode|Scheme|Draft version|replacement\b/);
    assert.ok(findDetail(body, 'Scheme 1 (1 record)')); assert.ok(findDetail(body, 'Scheme 2 (2 records)'));
    assert.equal(parts[2].textContent, 'Synthetic example data. Account as of 5 November 2026 at 09:00.');
  } finally { mounted.destroy(); mounted.root.remove(); }
  value.histories[0].label = 'Fictional car scheme'; value.slots[0].label = 'Company car 1';
  const labelled = await domMount({ ...readOnlyAdapter(), readAccount: async () => input, readDraft: async () => draft });
  try {
    assert.ok(findDetail(labelled.root, 'Fictional car scheme (1 record)'));
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
