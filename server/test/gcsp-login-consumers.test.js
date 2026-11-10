import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createAccountHttpAdapter as createShellAccountAdapter } from '../../blocks/gcsp/shell/account-runtime.js';
import { createAccountHttpAdapter } from '../../blocks/gcsp/account/http-adapter.js';
import { createGregHttpAdapter } from '../../blocks/gcsp/greg/http-adapter.js';
import { ACCOUNT_SNAPSHOT } from '../../blocks/gcsp/account/fixtures.js';

let dom;
let employee;
let greg;
let gregFixtures;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://gcsp.test/gcsp-greg.html' });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'Node']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
  }
  employee = await import('../../blocks/gcsp/employee/gcsp-employee.js');
  greg = await import('../../blocks/gcsp/greg/gcsp-greg.js');
  gregFixtures = await import('../../blocks/gcsp/greg/fixtures.js');
});
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());
const tick = () => new Promise((done) => setTimeout(done, 0));
const response = (value, status = 200) => ({ status, ok: status < 400, json: async () => value });
const liveAccount = () => {
  const result = structuredClone(ACCOUNT_SNAPSHOT);
  result.value.account.name = 'Ada Longworth'; result.value.account.contact.email = 'ada.longworth@gcsp-demo.com';
  return result;
};
const host = () => { const root = document.createElement('div'); document.body.append(root); return root; };

test('both employee account adapters preserve the server profile email for shared menu consumers', async () => {
  const fetch = async () => response(liveAccount());
  const shell = await createShellAccountAdapter({ fetch }).loadAccount();
  const account = await createAccountHttpAdapter({ fetchImpl: fetch }).loadAccount();
  for (const projected of [shell, account]) {
    assert.equal(projected.name, 'Ada Longworth'); assert.equal(projected.email, 'ada.longworth@gcsp-demo.com');
  }
});

test('employee shell forwards email and explicit preview sign-out opt-out', async () => {
  for (const signOut of [true, false]) {
    const root = host();
    const stop = employee.mountEmployee(root, { signOut,
      loadAccount: async () => ({ status: 'ready', name: 'Ada Longworth', email: 'ada.longworth@gcsp-demo.com' }) });
    await tick();
    assert.equal(root.querySelector('.gcsp-account-email').textContent, 'ada.longworth@gcsp-demo.com');
    assert.equal(Boolean(root.querySelector('.gcsp-account-signout')), signOut); stop();
  }
});

test('named employee custom element fixtures never offer live sign-out', async () => {
  employee.defineGcspEmployee();
  const element = document.createElement('gcsp-employee'); element.setAttribute('fixture', 'representative'); document.body.append(element);
  await new Promise((done) => setTimeout(done, 500));
  assert.ok(element.querySelector('.gcsp-account-name'));
  assert.equal(element.querySelector('.gcsp-account-signout'), null); element.remove();
});

test('live account screen carries the durable profile email into its menu', async () => {
  const { mountAccount } = await import('../../blocks/gcsp/account/gcsp-account.js');
  const root = host();
  const stop = mountAccount(root, { adapter: { readAccount: async () => liveAccount(), readDraft: async () => ({ status: 'not-found' }) } });
  await tick(); await tick();
  assert.equal(root.querySelector('.gcsp-account-email')?.textContent, 'ada.longworth@gcsp-demo.com'); stop();
});

test('Greg HTTP identity loader reads the current session context with no fixed person', async () => {
  let sent;
  const adapter = createGregHttpAdapter({ fetchImpl: async (url, options) => {
    sent = { url, options };
    return response({ status: 'ok', value: { name: 'Morgan Ashworth', email: 'morgan.ashworth@gcsp-demo.com', roles: ['greg'],
      principal: { principalId: 'scheme-lead', name: 'Morgan Ashworth', email: 'morgan.ashworth@gcsp-demo.com' } } });
  } });
  const context = await adapter.loadAccount();
  assert.equal(context.name, 'Morgan Ashworth'); assert.equal(context.email, 'morgan.ashworth@gcsp-demo.com');
  assert.equal(sent.url, '/api/gcsp/context'); assert.equal(sent.options.credentials, 'same-origin');
  assert.equal(sent.options.cache, 'no-store');
});

test('Greg live shell waits for injected identity and never falls back to a named account', async () => {
  let resolve;
  const root = host();
  const stop = greg.mountGregDashboard(root, {
    loadDemand: async () => ({ status: 'ready', projection: gregFixtures.fixtureProjection('populated') }),
    loadAccount: () => new Promise((done) => { resolve = done; }) });
  assert.equal(root.querySelector('.gcsp-account').dataset.status, 'loading');
  resolve({ status: 'ready', name: 'Morgan Ashworth', email: 'morgan.ashworth@gcsp-demo.com', context: 'Scheme ordering lead' }); await tick();
  assert.equal(root.querySelector('.gcsp-account-name').textContent, 'Morgan Ashworth');
  assert.equal(root.querySelector('.gcsp-account-email').textContent, 'morgan.ashworth@gcsp-demo.com'); stop();
  const denied = host(); const deny = greg.mountGregDashboard(denied, { loadAccount: async () => ({ status: 'unavailable' }) });
  await tick(); assert.equal(denied.querySelector('.gcsp-account-name'), null); deny();
});

test('Greg fixture elements retain explicit fixture identity without live sign-out', async () => {
  greg.defineGcspGregDashboard();
  const element = document.createElement('gcsp-greg-dashboard'); element.setAttribute('fixture', 'populated'); document.body.append(element);
  await tick();
  assert.equal(element.querySelector('.gcsp-account-name')?.textContent, 'Greg Lawson');
  assert.equal(element.querySelector('.gcsp-account-signout'), null); element.remove();
});

test('signed-in Greg landing mounts the live HTTP composition and its current session menu', async (t) => {
  const html = readFileSync(new URL('../../gcsp-greg.html', import.meta.url), 'utf8');
  const markup = new JSDOM(html);
  const node = markup.window.document.querySelector('gcsp-greg-dashboard');
  assert.equal(node.hasAttribute('fixture'), false); markup.window.close();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === '/api/gcsp/context') return response({ status: 'ok', value: { name: 'Morgan Ashworth', email: 'morgan.ashworth@gcsp-demo.com', roles: ['greg'] } });
    if (String(url) === '/api/gcsp/greg/demand') return response({ status: 'ok', value: gregFixtures.fixtureProjection('populated') });
    return response({ status: 'unavailable' }, 503);
  };
  t.after(() => { document.body.replaceChildren(); globalThis.fetch = originalFetch; });
  document.body.append(document.createElement('gcsp-greg-dashboard'));
  await import('../../blocks/gcsp/greg/harness.js'); await tick(); await tick();
  const dashboard = document.querySelector('gcsp-greg-dashboard');
  assert.equal(dashboard.querySelector('.gcsp-account-name')?.textContent, 'Morgan Ashworth');
  assert.equal(dashboard.querySelector('.gcsp-account-email')?.textContent, 'morgan.ashworth@gcsp-demo.com');
  assert.equal(dashboard.querySelector('.gcsp-fixture-notice'), null);
  assert.ok(dashboard.regions.orderTracking.querySelector('.gcsp-orders') || dashboard.regions.orderTracking.querySelector('[role="alert"]'));
});
