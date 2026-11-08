import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { JSDOM } from 'jsdom';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { RenewalCaseService } from '../gcsp/cases/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { buildServer } from '../index.js';
import { preference, essential } from './helpers/employee-recommendation.js';
import { createCaseHttpAdapter } from '../../blocks/gcsp/cases/http-adapter.js';

const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const cookie = (session) => [session.value.setCookie].flat().map((value) => value.split(';')[0]).join('; ');
async function setup(t) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  await repository.open();
  t.after(() => repository.close());
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'case-journey', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const greg = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'greg');
  const context = paula.value.context;
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context })).status, 'ok');
  const brief = new BriefService({ repository, policy, clock, identity });
  const cases = new RenewalCaseService({ repository, policy, clock, identity });
  const server = buildServer({ gcspIdentity: identity, gcspClock: clock, gcspBrief: brief, gcspCases: cases,
    gcspAllowedOrigins: ['https://case-journey.test'] });
  assert.equal((await server.gcspStartup).status, 'ok');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetchFor = (session) => (url, options = {}) => fetch(url, { ...options,
    headers: { ...options.headers, Origin: 'https://case-journey.test', Cookie: cookie(session) } });
  const call = async (path, body, session = paula) => {
    const response = await fetchFor(session)(`${base}/api/gcsp${path}`, { method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const outcome = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return outcome;
  };
  return { store, repository, clock, context, presenter, paula, greg, cases, call,
    adapter: createCaseHttpAdapter({ base, fetchImpl: fetchFor(paula) }),
    gregAdapter: createCaseHttpAdapter({ base, fetchImpl: fetchFor(greg) }) };
}
const button = (root, label) => {
  const found = [...root.querySelectorAll('button')].find((element) => element.textContent === label);
  assert.ok(found, `Missing button: ${label}`); return found;
};
const readyAfter = async (root, action) => {
  const ready = once(root, 'gcsp:ready', { signal: AbortSignal.timeout(3000) }); action(); await ready;
};
async function waitFor(check) {
  const until = Date.now() + 3000;
  while (!check()) { assert.ok(Date.now() < until, 'Timed out waiting for current server options'); await new Promise((resolve) => setTimeout(resolve, 5)); }
}
function field(root, name, value, event = 'input') {
  const element = root.querySelector(`[id$="-${name}"]`);
  assert.ok(element, `Missing field: ${name}`); element.value = value;
  element.dispatchEvent(new window.Event(event, { bubbles: true })); return element;
}

test('authenticated HTTP help, scheme-team remedy, employee reload and single-change confirmation persist actual state', { timeout: 10000 }, async (t) => {
  const f = await setup(t);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://case-journey.test/' });
  const previous = new Map();
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom.window : dom.window[key] });
  }
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const { mountHelpBody } = await import('../../blocks/gcsp/cases/gcsp-help.js');
  const { mountCaseQueue } = await import('../../blocks/gcsp/cases/gcsp-case-queue.js');
  const root = document.createElement('div'); document.body.append(root);
  let destroy;
  const beforeRead = structuredClone(f.store.state);
  await readyAfter(root, () => { destroy = mountHelpBody(root, { adapter: f.adapter, commandId: () => 'ui-help' }); });
  t.after(() => destroy());
  assert.deepEqual(f.store.state, beforeRead, 'Opening help is read-only across HTTP');
  assert.match(root.textContent, /No renewal case/);
  button(root, 'Ask for help').click();
  const reason = 'Please review my replacement before the contract ends.';
  root.querySelector('textarea').value = reason;
  root.querySelector('textarea').dispatchEvent(new window.Event('input', { bubbles: true }));
  button(root, 'Review help request').click();
  assert.deepEqual(f.store.state, beforeRead, 'Review does not submit the request');
  await readyAfter(root, () => button(root, 'Confirm help request').click());
  assert.match(root.textContent, /Your help request was recorded/);
  let c = (await f.call('/scheme-team/cases', null, f.greg)).value.cases[0];
  assert.equal(c.reason, reason); assert.equal(c.owner.role, 'scheme-team');
  assert.equal(c.trigger.type, 'employee-request');
  assert.equal((await f.repository.query(f.context, 'renewal_cases')).value.length, 1);

  const data = { schemaVersion: 1, preferences: { body: preference('estate'), comfort: preference(75, 0) },
    essentials: { seats: essential(5), charging: { value: null, operator: 'equals', unit: null, state: 'needs-confirmation', source: 'employee' } } };
  assert.equal((await f.call('/brief/draft', { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: data })).status, 'ok');
  const confirmed = await f.call('/brief/confirm', { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } });
  assert.equal(confirmed.status, 'ok');
  // Synthetic recorded decline is setup for this UI/HTTP contract, not offer-decision producer evidence.
  assert.equal((await f.repository.transaction(f.context, command('decline-setup'), (tx) => tx.insert('decisions', {
    runId: f.context.runId, decisionId: 'recorded-decline', employeeId: f.context.employeeId, offerId: 'prior-offer',
    decision: 'decline', versions: { brief: 1 } }))).status, 'ok');
  const queueRoot = document.createElement('div'); document.body.append(queueRoot);
  let closeQueue;
  await readyAfter(queueRoot, () => { closeQueue = mountCaseQueue(queueRoot, { adapter: f.gregAdapter }); });
  t.after(() => closeQueue());
  assert.match(queueRoot.textContent, /Paula/);
  field(queueRoot, 'selection', c.caseId, 'change'); button(queueRoot, 'Open selected case').click();
  await waitFor(() => queueRoot.querySelector('[id$="-status"]'));
  const update = async (status, preference = false) => {
    field(queueRoot, 'status', status, 'change'); field(queueRoot, 'reason', 'Scheme team reviewed the renewal.');
    field(queueRoot, 'nextAction', 'Paula to review one body preference change.'); field(queueRoot, 'dueAt', '2026-11-06T12:00:00');
    if (preference) {
      const choices = queueRoot.querySelector('[id$="-remedyKey"]');
      const body = [...choices.options].find((option) => option.textContent === 'Change body'); assert.ok(body);
      field(queueRoot, 'remedyKey', body.value, 'change');
      const values = queueRoot.querySelector('[id$="-preferenceValue"]');
      const suv = [...values.options].find((option) => option.textContent === 'suv'); assert.ok(suv);
      field(queueRoot, 'preferenceValue', suv.value, 'change');
    }
    const beforeReview = structuredClone(f.store.state);
    button(queueRoot, 'Review case update').click();
    assert.deepEqual(f.store.state, beforeReview, 'Greg reviews the update without writing');
    await readyAfter(queueRoot, () => button(queueRoot, 'Confirm case update').click());
    assert.match(queueRoot.textContent, /The case update was recorded/);
    c = (await f.call('/scheme-team/cases', null, f.greg)).value.cases[0];
    assert.equal(c.status, status);
  };
  let options = await f.call(`/scheme-team/cases/options?caseId=${c.caseId}`, null, f.greg);
  assert.equal(options.status, 'ok'); assert.ok(options.value.nextStatuses.includes('in-progress'));
  await update('in-progress');
  options = await f.call(`/scheme-team/cases/options?caseId=${c.caseId}`, null, f.greg);
  const choice = options.value.options.preferenceRelaxations.items.find((item) => item.path === 'preferences.body.value');
  assert.ok(choice.values.includes('suv'));
  await update('remedy-proposed', true);
  assert.deepEqual({ type: c.remedy.type, decisionId: c.remedy.decisionId, expectedBriefVersion: c.remedy.expectedBriefVersion,
    path: c.remedy.path, value: c.remedy.value }, { type: choice.type, decisionId: choice.decisionId,
    expectedBriefVersion: choice.expectedBriefVersion, path: choice.path, value: 'suv' });
  destroy();
  await readyAfter(root, () => { destroy = mountHelpBody(root, { adapter: f.adapter, commandId: () => 'ui-one-change' }); });
  assert.match(root.textContent, /Paula to review one body preference change/);
  assert.match(root.textContent, /Waiting for your confirmation/);
  button(root, 'Review body change').click();
  assert.match(root.textContent, /estate → suv/);
  await readyAfter(root, () => button(root, 'Confirm preference change').click());
  assert.match(root.textContent, /You confirmed this preference change/);
  const after = (await f.call('/brief')).value.brief;
  assert.equal(after.briefVersion, 2); assert.equal(after.preferences.body.value, 'suv');
  assert.deepEqual({ ...after.preferences, body: { ...after.preferences.body, value: 'estate' } }, confirmed.value.brief.preferences);
  assert.deepEqual(after.essentials, confirmed.value.brief.essentials);
  const own = (await f.call('/cases')).value.cases[0];
  assert.equal(own.relaxation.confirmed, true); assert.equal(own.status, 'remedy-proposed');
  assert.equal(own.history.at(-1).actorRole, 'scheme-team');
  assert.equal(own.history.at(-1).dueAt, '2026-11-06T12:00:00.000Z');
  destroy();
  await readyAfter(root, () => { destroy = mountHelpBody(root, { adapter: f.adapter }); });
  assert.match(root.textContent, /You confirmed this preference change/);
  assert.equal([...root.querySelectorAll('button')].some((element) => element.textContent === 'Review body change'), false);
});

test('actual authenticated clock tick produces the deadline case and replay opens no duplicate', { timeout: 5000 }, async (t) => {
  const f = await setup(t);
  assert.equal((await f.repository.transaction(f.context, command('deadline-fact'), async (tx) => {
    const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.context.employeeId } };
    const row = (await tx.get(ref)).value;
    return tx.compareAndSwap(ref, row.version, { contract: { ...row.contract, manualContext: { ...row.contract.manualContext,
      contracts: row.contract.manualContext.contracts.map((contract) => contract.status === 'current'
        ? { ...contract, contractEndDate: '2026-11-12' } : contract) } } });
  })).status, 'ok');
  assert.deepEqual((await f.call('/cases')).value.cases, []);
  const state = (await f.call('/presenter/clock', null, f.presenter)).value;
  const input = { eventId: 'actual-deadline-tick', expectedClockVersion: state.clockVersion, inputDigest: inputDigest('actual-deadline-tick') };
  const tick = await f.call('/presenter/clock/tick', input, f.presenter);
  assert.equal(tick.status, 'ok', JSON.stringify(tick));
  assert.ok(tick.value.handlerOrder.some((handler) => handler.handlerId === 'renewal-risk-cases'));
  const own = (await f.call('/cases')).value.cases;
  assert.equal(own.length, 1); assert.equal(own[0].trigger.type, 'renewal-deadline');
  assert.equal(own[0].history[0].actorId, 'renewal-risk-clock');
  assert.equal(own[0].renewalDeadline, '2026-11-12');
  const beforeReplay = structuredClone(f.store.state);
  assert.deepEqual(await f.call('/presenter/clock/tick', input, f.presenter), tick);
  assert.deepEqual(f.store.state, beforeReplay);
  assert.equal((await f.call('/scheme-team/cases', null, f.greg)).value.cases[0].caseId, own[0].caseId);
});
