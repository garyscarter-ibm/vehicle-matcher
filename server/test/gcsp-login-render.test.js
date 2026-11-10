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
async function login(fetchImpl = async () => response('unavailable', {}, 503), navigate = () => {}) {
  const { mountLogin } = await import('../../blocks/gcsp/login/gcsp-login.js');
  const root = document.createElement('div'); document.body.append(root);
  const view = mountLogin(root, { fetchImpl, navigate });
  return { ...view, root, email: root.querySelector('[name="email"]'), password: root.querySelector('[name="password"]'),
    form: root.querySelector('form'), submit: root.querySelector('button[type="submit"]') };
}
function submit(view, email = 'paula.robinson@gcsp-demo.com', password = 'fucq') {
  view.email.value = email; view.password.value = password;
  view.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

test('signed-out shell has no loading identity or account actions', () => {
  const shell = portalShell({ account: { status: 'signed-out' }, presenterControls: false });
  document.body.append(shell.root);
  const account = shell.root.querySelector('.gcsp-account');
  assert.equal(account.dataset.status, 'signed-out');
  assert.equal(account.textContent, '');
  assert.equal(account.getAttribute('aria-busy'), 'false');
  assert.equal(account.hasAttribute('aria-label'), false);
  shell.destroy();
});

test('login fields have native labels, password autocomplete and a quiet signed-out header', async () => {
  const view = await login();
  for (const input of [view.email, view.password]) {
    assert.ok(input.labels[0]?.textContent);
    assert.ok(input.required);
  }
  assert.equal(view.email.type, 'email'); assert.equal(view.email.autocomplete, 'username');
  assert.equal(view.password.type, 'password'); assert.equal(view.password.autocomplete, 'current-password');
  assert.equal(view.root.querySelector('.gcsp-account').dataset.status, 'signed-out');
  assert.equal(view.root.querySelector('.gcsp-presenter-region').textContent, '');
  assert.equal(view.root.querySelectorAll('h1').length, 1);
  view.destroy();
});

test('validation focuses the first invalid field and prevents sending empty or malformed credentials', async () => {
  let sent = 0;
  const view = await login(async () => { sent += 1; return response('ok'); });
  submit(view, '', ''); await tick();
  assert.equal(sent, 0); assert.equal(document.activeElement, view.email);
  assert.equal(view.email.getAttribute('aria-invalid'), 'true');
  assert.ok(document.getElementById(view.email.getAttribute('aria-describedby')).textContent);
  submit(view, 'not-an-email', 'fucq'); await tick();
  assert.equal(sent, 0); assert.equal(view.email.getAttribute('aria-invalid'), 'true');
  submit(view, 'paula.robinson@gcsp-demo.com', ''); await tick();
  assert.equal(sent, 0); assert.equal(document.activeElement, view.password);
  view.destroy();
});

test('pending login posts credentials only once, keeps password out of the URL and clears it on success', async () => {
  let finish;
  const sent = [];
  const destinations = [];
  const view = await login((url, options) => { sent.push({ url, options }); return new Promise((resolve) => { finish = resolve; }); }, (to) => destinations.push(to));
  submit(view, '  PAULA.ROBINSON@gcsp-demo.com ', ' fucq ');
  submit(view, 'other@gcsp-demo.com', 'other');
  assert.equal(sent.length, 1); assert.equal(view.submit.disabled, true);
  assert.equal(view.form.getAttribute('aria-busy'), 'true');
  assert.equal(sent[0].url, '/api/gcsp/session/login');
  assert.equal(sent[0].options.method, 'POST'); assert.equal(sent[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(sent[0].options.body), { email: 'PAULA.ROBINSON@gcsp-demo.com', password: ' fucq ' });
  finish(response('ok', { value: { context: { name: 'Paula Robinson', email: 'paula.robinson@gcsp-demo.com' }, redirectTo: '/gcsp-account.html' } }));
  await tick();
  assert.deepEqual(destinations, ['/gcsp-account.html']); assert.equal(view.password.value, '');
  assert.doesNotMatch(JSON.stringify(window.localStorage), /paula|robinson|fucq|@/i);
  assert.equal(window.sessionStorage.length, 0);
  assert.equal(window.location.search, '');
  view.destroy();
});

for (const [status, http] of [['invalid-credentials', 401], ['invalid', 400], ['forbidden', 403], ['unavailable', 503]]) {
  test(`login ${status} failure is accessible and allows another attempt`, async () => {
    const view = await login(async () => response(status, {}, http));
    submit(view); await tick();
    const alert = view.root.querySelector('[role="alert"]');
    assert.ok(alert.textContent.trim()); assert.equal(alert.hidden, false); assert.equal(document.activeElement, alert);
    assert.equal(view.submit.disabled, false); assert.equal(view.form.getAttribute('aria-busy'), 'false');
    assert.equal(view.password.value, '');
    view.destroy();
  });
}

test('login network failure stays on screen with retry feedback', async () => {
  const view = await login(async () => { throw new Error('transport'); });
  submit(view); await tick();
  assert.equal(view.root.querySelector('[role="alert"]').hidden, false);
  assert.equal(view.submit.disabled, false); view.destroy();
});

test('Greg reaches the server-selected page and unknown redirect targets fail closed', async () => {
  for (const target of ['/gcsp-greg.html', 'https://elsewhere.test/', '//elsewhere.test/', '/gcsp-account.html?principal=other', '/gcsp-presenter.html']) {
    const destinations = [];
    const view = await login(async () => response('ok', { value: { context: { name: 'Greg' }, redirectTo: target } }), (to) => destinations.push(to));
    submit(view); await tick();
    assert.deepEqual(destinations, target === '/gcsp-greg.html' ? ['/gcsp-greg.html'] : []);
    if (target !== '/gcsp-greg.html') assert.equal(view.root.querySelector('[role="alert"]').hidden, false);
    view.destroy();
  }
});

test('account menu preserves long email and waits for sign-out before clearing all visible identity', async () => {
  let finish;
  const sent = [];
  const name = 'Bartholomew Featherstonehaugh-Cholmondeley-Wolverstone III';
  const email = 'bartholomew.featherstonehaugh-cholmondeley-wolverstone@gcsp-demo.com';
  const destinations = [];
  const shell = portalShell({ presenterControls: false, account: { status: 'ready', name, email },
    sessionAdapter: { signOut: () => { sent.push('logout'); return new Promise((resolve) => { finish = resolve; }); } },
    navigate: (to) => { destinations.push(to); assert.equal(shell.root.textContent.includes(name), false); assert.equal(shell.main.textContent, ''); } });
  document.body.append(shell.root); shell.main.textContent = `Private details for ${name}`;
  assert.equal(shell.root.querySelector('.gcsp-account-email').textContent, email);
  const summary = shell.root.querySelector('summary'); assert.ok(summary.getAttribute('aria-label').includes(name));
  const action = shell.root.querySelector('.gcsp-account-signout');
  action.click(); action.click();
  assert.equal(action.disabled, true); assert.equal(sent.length, 1); assert.deepEqual(destinations, []);
  finish({ status: 'ok' }); await tick();
  assert.deepEqual(destinations, ['/gcsp/login']); assert.equal(shell.root.querySelector('.gcsp-account').dataset.status, 'signed-out');
  shell.destroy();
});

test('sign-out failure preserves the current account and exposes retry feedback', async () => {
  const shell = portalShell({ presenterControls: false, account: { status: 'ready', name: 'Paula Robinson', email: 'paula.robinson@gcsp-demo.com' },
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
  const shell = portalShell({ presenterControls: false, signOut: false, account: { status: 'ready', name: 'Fixture account' } });
  assert.equal(shell.root.querySelector('.gcsp-account-signout'), null); shell.destroy();
});

test('successful login announces a credential-free session change for other live pages', async () => {
  const view = await login(async () => response('ok', { value: { context: { name: 'Paula Robinson' }, redirectTo: '/gcsp-account.html' } }));
  submit(view); await tick();
  const marker = window.localStorage.getItem('gcsp-session-change');
  assert.ok(marker); assert.doesNotMatch(marker, /paula|robinson|fucq|@/i);
  view.destroy();
});

test('a session change in another tab clears the live page before reloading and blocks late identity repaint', () => {
  let reloads = 0;
  const shell = portalShell({ presenterControls: false, account: { status: 'ready', name: 'Paula Robinson' },
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
  const shell = portalShell({ presenterControls: false, account: { status: 'ready', name: 'Paula Robinson' }, reload: () => { reloads += 1; } });
  document.body.append(shell.root); shell.main.textContent = 'Private account content';
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
  assert.equal(shell.main.textContent, ''); assert.equal(shell.root.querySelector('.gcsp-account').dataset.status, 'signed-out');
  assert.equal(reloads, 0);
  window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(reloads, 1); shell.destroy();
});

test('fixture accounts and the signed-out login ignore cross-tab changes and history restoration', () => {
  for (const options of [{ signOut: false, account: { status: 'ready', name: 'Preview account' } }, { account: { status: 'signed-out' } }]) {
    const shell = portalShell({ ...options, presenterControls: false, reload: () => assert.fail('not a live account') });
    shell.main.textContent = 'Retained preview or login';
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'gcsp-session-change', newValue: 'change' }));
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(shell.main.textContent, 'Retained preview or login'); shell.destroy();
  }
});
