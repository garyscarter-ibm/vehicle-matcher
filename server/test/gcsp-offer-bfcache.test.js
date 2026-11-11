// FUCQ-343: an offer kept in the Back/Forward cache hides the person on pagehide and re-reads the server on restore.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';

let dom; let reloads; let requests;
const reply = (body) => ({ ok: body.status === 'ok', status: body.status === 'ok' ? 200 : 503,
  headers: { get: () => 'application/json' }, json: async () => structuredClone(body) });
const account = { status: 'ok', value: { state: 'ready', account: { name: 'Paula Mason', contact: { email: 'paula.mason@gcsp-demo.com' } }, actions: [] } };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(predicate) {
  for (let n = 0; n < 100 && !predicate(); n += 1) await tick();
  assert.ok(predicate(), 'the offer entry did not settle');
}
const pageEvent = (type, persisted) => dom.window.dispatchEvent(new dom.window.PageTransitionEvent(type, { persisted }));

before(() => {
  dom = new JSDOM('<!doctype html><body><gcsp-offer></gcsp-offer></body>', { url: 'https://bfcache.test/gcsp/offer', virtualConsole: new VirtualConsole() });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  Object.defineProperty(globalThis, 'location', { configurable: true, writable: true,
    value: { href: 'https://bfcache.test/gcsp/offer?offerId=offer-a&runId=run-a', assign() {}, reload() { reloads += 1; } } });
  Object.defineProperty(globalThis, 'history', { configurable: true, writable: true, value: { replaceState() {} } });
  globalThis.fetch = async (input) => {
    const path = new URL(input, 'https://bfcache.test').pathname; requests.push(path);
    return reply(path === '/api/gcsp/manual/account' ? account : { status: 'unavailable' });
  };
});
beforeEach(() => { reloads = 0; requests = []; });
after(() => dom.window.close());

test('a persisted pagehide clears the person and the restore reloads current server state', async () => {
  const host = document.querySelector('gcsp-offer');
  await import('../../blocks/gcsp/offer/entry-harness.js?bfcache');
  await settle(() => host.querySelector('.gcsp-account-name'));
  assert.match(host.textContent, /Paula Mason/);
  pageEvent('pagehide', true);
  assert.doesNotMatch(host.textContent, /Paula|paula\.mason/, 'the cached snapshot holds no former-user data');
  assert.equal(reloads, 0);
  pageEvent('pageshow', true);
  assert.equal(reloads, 1, 'the restored page asks the server again instead of staying blank');
});

test('an ordinary unload still disposes the entry, so nothing reloads later', async () => {
  document.body.replaceChildren(document.createElement('gcsp-offer'));
  const host = document.querySelector('gcsp-offer');
  await import('../../blocks/gcsp/offer/entry-harness.js?unload');
  await settle(() => host.querySelector('.gcsp-account-name'));
  pageEvent('pagehide', false);
  assert.equal(host.childNodes.length, 0);
  pageEvent('pageshow', true);
  assert.equal(reloads, 0);
});
