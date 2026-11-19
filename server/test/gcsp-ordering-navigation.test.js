import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createContextHttpAdapter } from '../../blocks/gcsp/shell/account-runtime.js';

let dom; let portalShell;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://gcsp.test/gcsp/greg' });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
  }
  ({ portalShell } = await import('../../blocks/gcsp/shell/portal-shell.js'));
});
after(() => dom.window.close());

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
  assert.deepEqual(destinations, ['/gcsp/greg']);
  const shell = portalShell({ navigation: ORDERING_NAVIGATION, signOut: false });
  for (const account of [{ status: 'loading' }, { status: 'unavailable' }, { status: 'ready', name: 'Paula', roles: ['employee'] }]) {
    shell.setAccount(account);
    assert.equal(shell.root.querySelectorAll('.gcsp-nav-btn').length, 0);
  }
  shell.destroy();
});
