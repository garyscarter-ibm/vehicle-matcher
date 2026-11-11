import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createContextHttpAdapter } from '../../blocks/gcsp/shell/account-runtime.js';

let dom; let portalShell; let dashboard; let fixtures;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://gcsp.test/gcsp-greg.html' });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
  }
  ({ portalShell } = await import('../../blocks/gcsp/shell/portal-shell.js'));
  dashboard = await import('../../blocks/gcsp/greg/gcsp-greg.js');
  fixtures = await import('../../blocks/gcsp/greg/fixtures.js');
});
after(() => dom.window.close());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('trusted session roles reach the shared shell without deriving authority from a name', async () => {
  const adapter = createContextHttpAdapter({ fetch: async () => ({ ok: true, json: async () => ({ status: 'ok',
    value: { name: 'Another ordering lead', roles: ['greg'] } }) }) });
  assert.deepEqual((await adapter.loadAccount()).roles, ['greg']);
});

test('shared rail shows the ordering icon only for the ordering role, and clears it on account changes', async () => {
  const { PORTAL_NAVIGATION } = await import('../../blocks/gcsp/employee/portal-navigation.js');
  const shell = portalShell({ navigation: PORTAL_NAVIGATION, signOut: false });
  document.body.append(shell.root);
  const ordering = () => shell.root.querySelector('.gcsp-nav-btn[data-key="ordering"]');
  assert.equal(ordering(), null);
  shell.setAccount({ status: 'ready', name: 'Greg Lawson', roles: ['employee'] });
  assert.equal(ordering(), null, 'a name is not an access role');
  shell.setAccount({ status: 'ready', name: 'Scheme team member', roles: ['greg'] });
  assert.equal(ordering()?.textContent, 'Employee car ordering');
  assert.equal(shell.root.querySelectorAll('.gcsp-nav-btn').length, 1, 'no employee links that Greg cannot open');
  shell.setAccount({ status: 'unavailable' }); assert.equal(ordering(), null);
  shell.setAccount({ status: 'signed-out' }); assert.equal(ordering(), null);
  shell.destroy();
});

test('the ordering route is shared, and an unknown dashboard identity never shows employee-only destinations', async () => {
  const { routePortal, ORDERING_NAVIGATION } = await import('../../blocks/gcsp/employee/portal-navigation.js');
  const destinations = [];
  assert.equal(routePortal('ordering', { assign: (path) => destinations.push(path) }), true);
  assert.deepEqual(destinations, ['/gcsp-greg.html']);
  const shell = portalShell({ navigation: ORDERING_NAVIGATION, signOut: false });
  for (const account of [{ status: 'loading' }, { status: 'unavailable' }, { status: 'ready', name: 'Paula', roles: ['employee'] }]) {
    shell.setAccount(account);
    assert.equal(shell.root.querySelectorAll('.gcsp-nav-btn').length, 0);
  }
  shell.destroy();
});

test('dashboard retains one shared shell and ordering icon while its working sections switch as tabs', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const stop = dashboard.mountGregDashboard(root, fixtures.fixtureAdapter('populated'));
  await tick();
  const header = root.querySelector('.gcsp-header'); const rail = root.querySelector('.gcsp-nav');
  assert.equal(root.querySelector('.gcsp-nav-btn[aria-current="page"]')?.dataset.key, 'ordering');
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  assert.equal(tabs.length, 6);
  for (const tab of tabs) {
    tab.click();
    assert.equal(tab.getAttribute('aria-selected'), 'true');
    assert.equal(root.querySelector('.gcsp-header'), header);
    assert.equal(root.querySelector('.gcsp-nav'), rail);
    assert.equal(root.querySelectorAll('[role="tabpanel"]:not([hidden])').length, 1);
  }
  stop(); root.remove();
});
