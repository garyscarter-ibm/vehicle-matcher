import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { JSDOM } from 'jsdom';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createCaseHttpAdapter } from '../../blocks/gcsp/cases/http-adapter.js';
import { createAccountHttpAdapter } from '../../blocks/gcsp/account/http-adapter.js';
import { createGregHttpAdapter } from '../../blocks/gcsp/greg/http-adapter.js';

// Requires the combined central launcher/runtime and DEV-084 case/page sources.
// JSDOM mounts the real controllers; it does not execute browser module scripts.
// Explicit actor headers do not model browser cookie Path matching or apply page
// Set-Cookie replies. Served-page checks do not prove bootstrap/session navigation.
const good = (outcome) => { assert.equal(outcome?.status, 'ok'); return outcome.value; };
const cookies = (values) => [values].flat().map((value) => value.split(';')[0]).join('; ');
const button = (root, label) => {
  const found = [...root.querySelectorAll('button')].find((node) => node.textContent === label);
  assert.ok(found, `Missing button: ${label}`);
  assert.equal(found.disabled, false, `Disabled button: ${label}`);
  return found;
};
const readyAfter = async (root, action) => {
  const ready = once(root, 'gcsp:ready', { signal: AbortSignal.timeout(3000) });
  await Promise.all([ready, Promise.resolve().then(action)]);
};
async function waitFor(check) {
  const until = Date.now() + 3000;
  while (!check()) {
    assert.ok(Date.now() < until, 'Timed out waiting for current case options');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function field(root, name, value, type = 'input') {
  const control = root.querySelector(`[id$="-${name}"]`);
  assert.ok(control, `Missing field: ${name}`);
  assert.equal(control.disabled, false, `Disabled field: ${name}`);
  control.value = value;
  control.dispatchEvent(new control.ownerDocument.defaultView.Event(type, { bubbles: true }));
}

test('local HTTPS launcher serves case entries and connects trusted Paula and Greg actions with persisted reload', { timeout: 20000 }, async (t) => {
  const https = await createLocalHttpsFixture(t);
  let app; let dom; let destroyHelp; let destroyQueue; let destroyDashboard;
  const previous = new Map();
  try {
    app = good(await startGcspDemo({ port: 0, tls: https.configuration, runtime: {
      mode: 'memory', environmentId: 'cases-local-demo', policyAsOf: '2026-11-06T09:00:00.000Z',
      commandId: 'cases-local-bootstrap', sessionNow: () => '2026-11-06T09:00:00.000Z',
    } }));
    const { services, origin } = app;
    assert.ok(services.cases, 'The central runtime supplies the case service');
    assert.equal(services.dependencies.gcspCases, services.cases);

    // Trusted backend setup uses the existing identity ports, without adding a
    // browser bootstrap contract or choosing authority through page parameters.
    const paula = good(await services.createLocalSession());
    const paulaCookie = cookies(paula.setCookie);
    const presenter = good(await services.identity.resolveSession({ authorized: true,
      cookie: paulaCookie, purpose: 'presenter-control' }));
    const greg = good(await services.identity.switchPrincipal(presenter, 'demo-greg', 'cases-local-greg'));
    const gregCookie = cookies(greg.setCookie);
    assert.ok(paulaCookie !== gregCookie, 'The actors have distinct sessions');

    const requests = [];
    const actor = (cookie) => {
      const fetch = async (input, init = {}) => {
        const url = new URL(input, origin);
        assert.equal(url.origin, origin, 'Only the launched HTTPS origin is used');
        const headers = new Headers(init.headers);
        headers.set('Origin', origin); headers.set('Cookie', cookie);
        const response = await https.fetch(url, { ...init, signal: init.signal ?? t.signal,
          headers: Object.fromEntries(headers) });
        requests.push({ path: url.pathname, method: init.method ?? 'GET', status: response.status });
        return response;
      };
      const read = async (path) => {
        const response = await fetch(`${origin}/api/gcsp/${path}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        return good(await response.json());
      };
      return { fetch, read, cases: createCaseHttpAdapter({ base: origin, fetchImpl: fetch }) };
    };
    const employee = actor(paulaCookie); const schemeTeam = actor(gregCookie);
    const employeeContext = await employee.read('context'); const gregContext = await schemeTeam.read('context');
    assert.equal(employeeContext.principalId, 'demo-paula');
    assert.ok(employeeContext.roles.includes('employee')); assert.ok(gregContext.roles.includes('greg'));
    assert.equal(gregContext.principalId, 'demo-greg');
    assert.equal(employeeContext.runId, gregContext.runId);
    assert.equal(employeeContext.environmentId, gregContext.environmentId);

    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: origin });
    for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent']) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true,
        value: key === 'window' ? dom.window : dom.window[key] });
    }
    const servedHost = async (client, path, selector) => {
      // The authenticated client here checks served source/assets, not browser
      // navigation: API-scoped cookies must not be assumed to accompany HTML GETs.
      const response = await client.fetch(`${origin}${path}`);
      assert.equal(response.status, 200, `The launcher serves ${path}`);
      assert.match(response.headers.get('content-type'), /^text\/html\b/);
      const page = new dom.window.DOMParser().parseFromString(await response.text(), 'text/html');
      const host = page.querySelector(selector); assert.ok(host, `Missing served host: ${selector}`);
      for (const resource of page.querySelectorAll('link[rel="stylesheet"][href], script[src]')) {
        const url = new URL(resource.getAttribute('href') ?? resource.getAttribute('src'), `${origin}${path}`);
        const asset = await client.fetch(url);
        assert.equal(asset.status, 200, `The launcher serves ${url.pathname}`);
        assert.ok((await asset.text()).length, `Nonempty asset: ${url.pathname}`);
      }
      const node = dom.window.document.importNode(host, true); document.body.append(node); return node;
    };
    const helpHost = await servedHost(employee, '/gcsp-help.html', 'gcsp-help');
    const gregHost = await servedHost(schemeTeam, '/gcsp-greg.html', 'gcsp-greg-dashboard');
    for (const path of ['/blocks/gcsp/cases/register.js', '/blocks/gcsp/cases/gcsp-case-queue.js',
      '/blocks/gcsp/cases/gcsp-cases.css', '/blocks/gcsp/kit/form-controls.css']) {
      const response = await schemeTeam.fetch(`${origin}${path}`);
      assert.equal(response.status, 200, `The launcher serves ${path}`);
      assert.ok((await response.text()).length);
    }

    const { mountHelp } = await import('../../blocks/gcsp/cases/gcsp-help.js');
    const { mountCaseQueue } = await import('../../blocks/gcsp/cases/gcsp-case-queue.js');
    const { mountGregDashboard } = await import('../../blocks/gcsp/greg/gcsp-greg.js');
    const helpOptions = { adapter: employee.cases,
      accountAdapter: createAccountHttpAdapter({ base: origin, fetchImpl: employee.fetch }) };
    const ownCases = async () => (await employee.read('cases')).cases;
    const posts = (path) => requests.filter((entry) => entry.method === 'POST' && entry.path === `/api/gcsp/${path}`);
    const before = await ownCases(); assert.deepEqual(before, []);
    await readyAfter(helpHost, () => { destroyHelp = mountHelp(helpHost, helpOptions); });
    assert.deepEqual(await ownCases(), before, 'Opening help creates no case');
    button(helpHost, 'Ask for help').click();
    const reason = 'Please review my replacement before my current contract ends.';
    const reasonInput = helpHost.querySelector('textarea'); assert.ok(reasonInput);
    reasonInput.value = reason; reasonInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    button(helpHost, 'Review help request').click();
    assert.match(helpHost.textContent, /This opens a scheme-team case or adds to your existing case/);
    assert.deepEqual(await ownCases(), before, 'Review does not create a case');
    assert.equal(posts('cases').length, 0);
    await readyAfter(helpHost, () => button(helpHost, 'Confirm help request').click());
    const opened = await ownCases(); assert.equal(opened.length, 1);
    const c = opened[0]; assert.equal(c.reason, reason); assert.equal(c.status, 'open');
    assert.equal(c.employeeId, employeeContext.employeeId); assert.equal(c.owner.role, 'scheme-team');
    assert.equal(c.trigger.type, 'employee-request'); assert.equal(posts('cases').length, 1);

    const gregAdapter = createGregHttpAdapter({ base: origin, fetchImpl: schemeTeam.fetch });
    let demandFinished;
    const demand = new Promise((resolve) => { demandFinished = resolve; });
    destroyDashboard = mountGregDashboard(gregHost, { async loadDemand(options) {
      const state = await gregAdapter.loadDemand(options); demandFinished(state); return state;
    } });
    assert.equal((await demand).status, 'ready');
    const queueHost = destroyDashboard.regions.caseQueue; assert.ok(queueHost);
    queueHost.removeAttribute('aria-labelledby'); queueHost.setAttribute('aria-label', 'Renewal cases');
    await readyAfter(queueHost, () => { destroyQueue = mountCaseQueue(queueHost,
      { adapter: schemeTeam.cases, embedded: true, commandId: () => 'cases-local-update' }); });
    assert.match(queueHost.textContent, /Paula/); assert.ok(queueHost.textContent.includes(reason));
    field(queueHost, 'selection', c.caseId, 'change'); button(queueHost, 'Open selected case').click();
    await waitFor(() => queueHost.querySelector('[id$="-status"]'));
    const projection = await schemeTeam.read(`scheme-team/cases/options?${new URLSearchParams({ caseId: c.caseId })}`);
    assert.equal(projection.case.caseId, c.caseId); assert.ok(projection.nextStatuses.includes('in-progress'));
    assert.equal(projection.options.manualDecision.available, true);
    const choices = queueHost.querySelector('[id$="-remedyKey"]');
    const manual = [...choices.options].find((option) => option.textContent === 'Manual decision'); assert.ok(manual);
    field(queueHost, 'remedyKey', manual.value, 'change');
    const nextAction = 'Scheme team to contact Paula about the renewal plan.';
    const decision = 'Scheme team will discuss the renewal plan with Paula.';
    const dueInput = new Date(Date.parse(projection.asOf) + 3600000).toISOString().slice(0, 16);
    const dueAt = new Date(`${dueInput}Z`).toISOString();
    field(queueHost, 'status', 'in-progress', 'change');
    field(queueHost, 'reason', 'Scheme team reviewed the request.'); field(queueHost, 'nextAction', nextAction);
    field(queueHost, 'dueAt', dueInput); field(queueHost, 'decision', decision);
    button(queueHost, 'Review case update').click();
    assert.deepEqual(await ownCases(), opened, 'Greg options and review leave the case unchanged');
    assert.equal(posts('scheme-team/cases/update').length, 0);
    await readyAfter(queueHost, () => button(queueHost, 'Confirm case update').click());
    assert.equal(posts('scheme-team/cases/update').length, 1);
    const updated = (await ownCases())[0];
    assert.equal(updated.caseId, c.caseId); assert.equal(updated.status, 'in-progress');
    assert.equal(updated.version, c.version + 1); assert.deepEqual(updated.owner, c.owner);
    assert.equal(updated.nextAction, nextAction); assert.equal(updated.dueAt, dueAt);
    assert.deepEqual(updated.remedy, { type: 'manual-decision', decision });
    assert.equal(updated.history.length, c.history.length + 1);
    assert.equal(updated.history.at(-1).actorId, gregContext.principalId);
    assert.equal(updated.history.at(-1).actorRole, 'scheme-team');
    assert.equal(updated.history.at(-1).at, projection.asOf);
    assert.equal(updated.history.at(-1).nextAction, nextAction); assert.equal(updated.history.at(-1).dueAt, dueAt);
    const persisted = good(await services.repository.query(paula.context, 'renewal_cases', { employeeId: employeeContext.employeeId }));
    assert.equal(persisted.length, 1); assert.deepEqual(persisted[0], updated);

    destroyHelp(); destroyHelp = null;
    await readyAfter(helpHost, () => { destroyHelp = mountHelp(helpHost, helpOptions); });
    assert.ok(helpHost.textContent.includes(nextAction)); assert.ok(helpHost.textContent.includes(decision));
    assert.ok(helpHost.textContent.includes(c.caseId)); assert.match(helpHost.textContent, /In progress/);
    assert.match(helpHost.textContent, /Dated case history/);
    assert.match(helpHost.textContent, /No specific next car or greater priority is guaranteed/);
    assert.deepEqual(await ownCases(), [updated], 'Reload preserves the recorded case');
    assert.equal(posts('cases').length, 1); assert.equal(posts('scheme-team/cases/update').length, 1);
  } finally {
    const cleanupErrors = [];
    try {
      for (const close of [destroyQueue, destroyHelp, destroyDashboard, () => dom?.window.close(), app?.close]) {
        try { await close?.(); } catch (error) { cleanupErrors.push(error); }
      }
    } finally {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Local case journey cleanup failed');
  }
});
