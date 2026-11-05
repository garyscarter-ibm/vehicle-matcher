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
  assert.equal(toAccountView({ status: 'stale-run', view: { supportOwner: 'employee', action: 'reopen-session' } }).state, 'refused');
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
