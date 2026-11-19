import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom;
let portalShell;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://gcsp.test/gcsp/login' });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'Node']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
  }
  ({ portalShell } = await import('../../blocks/gcsp/shell/portal-shell.js'));
});
beforeEach(() => { document.body.replaceChildren(); window.localStorage.clear(); });
after(() => dom.window.close());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = (status, body, http = 200) => ({ ok: http < 400, status: http, json: async () => ({ status, ...body }) });
test('signed-out shell has no loading identity or account actions', () => {
  const shell = portalShell({ account: { status: 'signed-out' } });
  document.body.append(shell.root);
  const account = shell.root.querySelector('.gcsp-account');
  assert.equal(account.dataset.status, 'signed-out');
  assert.equal(account.textContent, '');
  assert.equal(account.getAttribute('aria-busy'), 'false');
  assert.equal(account.hasAttribute('aria-label'), false);
  shell.destroy();
});

test('account menu preserves long email and waits for sign-out before clearing all visible identity', async () => {
  let finish;
  const sent = [];
  const name = 'Bartholomew Featherstonehaugh-Cholmondeley-Wolverstone III';
  const email = 'bartholomew.featherstonehaugh-cholmondeley-wolverstone@gcsp-demo.com';
  const destinations = [];
  const shell = portalShell({ account: { status: 'ready', name, email },
    sessionAdapter: { signOut: () => { sent.push('logout'); return new Promise((resolve) => { finish = resolve; }); } },
    navigate: (to) => { destinations.push(to); assert.equal(shell.root.textContent.includes(name), false); assert.equal(shell.main.textContent, ''); } });
  document.body.append(shell.root); shell.main.textContent = `Private details for ${name}`;
  assert.equal(shell.root.querySelector('.gcsp-account-email').textContent, email);
  const summary = shell.root.querySelector('summary'); assert.ok(summary.getAttribute('aria-label').includes(name));
  const action = shell.root.querySelector('.gcsp-account-signout');
  action.click(); action.click();
  assert.equal(action.disabled, true); assert.equal(sent.length, 1); assert.deepEqual(destinations, []);
  finish({ status: 'ok' }); await tick();
  assert.deepEqual(destinations, ['/gcsp/sign-in']); assert.equal(shell.root.querySelector('.gcsp-account').dataset.status, 'signed-out');
  shell.destroy();
});

test('sign-out failure preserves the current account and exposes retry feedback', async () => {
  const shell = portalShell({ account: { status: 'ready', name: 'Paula Robinson', email: 'paula.robinson@gcsp-demo.com' },
    sessionAdapter: { signOut: async () => ({ status: 'unavailable' }) }, navigate: () => assert.fail('must stay on page') });
  document.body.append(shell.root);
  shell.root.querySelector('.gcsp-account-signout').click(); await tick();
  assert.equal(shell.root.querySelector('.gcsp-account-signout').disabled, false);
  assert.ok(shell.root.querySelector('.gcsp-account-panel [role="alert"]').textContent);
  assert.equal(shell.root.querySelector('.gcsp-account-name').textContent, 'Paula Robinson'); shell.destroy();
});

test('session adapter uses same-origin logout POST and does not put credentials in URLs', async () => {
  const { createSessionHttpAdapter } = await import('../../blocks/gcsp/login/http-adapter.js');
  const sent = [];
  const adapter = createSessionHttpAdapter({ fetchImpl: async (url, options) => { sent.push({ url, options }); return response('ok'); } });
  assert.deepEqual(await adapter.signOut(), { status: 'ok' });
  assert.equal(sent[0].url, '/api/gcsp/session/logout'); assert.equal(sent[0].options.method, 'POST');
  assert.equal(sent[0].options.credentials, 'same-origin'); assert.equal(sent[0].options.body, '{}');
});

test('explicit fixture sign-out opt-out keeps preview accounts from changing a live session', () => {
  const shell = portalShell({ signOut: false, account: { status: 'ready', name: 'Fixture account' } });
  assert.equal(shell.root.querySelector('.gcsp-account-signout'), null); shell.destroy();
});

test('a session change in another tab clears the live page before reloading and blocks late identity repaint', () => {
  let reloads = 0;
  const shell = portalShell({ account: { status: 'ready', name: 'Paula Robinson' },
    reload: () => { reloads += 1; assert.equal(shell.main.textContent, ''); assert.equal(shell.root.textContent.includes('Paula Robinson'), false); } });
  document.body.append(shell.root); shell.main.textContent = 'Private account content';
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'unrelated-key', newValue: 'change' }));
  assert.equal(reloads, 0);
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'gcsp-session-change', newValue: 'change' }));
  assert.equal(reloads, 1);
  shell.setAccount({ status: 'ready', name: 'Late account response' });
  assert.equal(shell.root.querySelector('.gcsp-account').dataset.status, 'signed-out');
  shell.destroy();
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'gcsp-session-change', newValue: 'again' }));
  assert.equal(reloads, 1);
});

test('history restoration reloads live content that was cleared on pagehide', () => {
  let reloads = 0;
  const shell = portalShell({ account: { status: 'ready', name: 'Paula Robinson' }, reload: () => { reloads += 1; } });
  document.body.append(shell.root); shell.main.textContent = 'Private account content';
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
  assert.equal(shell.main.textContent, ''); assert.equal(shell.root.querySelector('.gcsp-account').dataset.status, 'signed-out');
  assert.equal(reloads, 0);
  window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(reloads, 1); shell.destroy();
});

test('fixture accounts and the signed-out login ignore cross-tab changes and history restoration', () => {
  for (const options of [{ signOut: false, account: { status: 'ready', name: 'Preview account' } }, { account: { status: 'signed-out' } }]) {
    const shell = portalShell({ ...options, reload: () => assert.fail('not a live account') });
    shell.main.textContent = 'Retained preview or login';
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'gcsp-session-change', newValue: 'change' }));
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(shell.main.textContent, 'Retained preview or login'); shell.destroy();
  }
});
