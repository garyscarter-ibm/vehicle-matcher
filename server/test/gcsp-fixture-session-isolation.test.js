import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom;
let offer;
let outbox;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://gcsp.test/' });
  for (const key of ['window', 'document', 'location', 'HTMLElement', 'customElements', 'CustomEvent', 'Node', 'DOMException']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
  }
  offer = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  outbox = await import('../../blocks/gcsp/presenter/gcsp-outbox.js');
  offer.defineGcspOffer(); outbox.defineGcspOutbox();
});
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());
const tick = () => new Promise((done) => setTimeout(done, 0));

test('every named offer harness fixture keeps its account menu read-only', async () => {
  const { FIXTURE_NAMES } = await import('../../blocks/gcsp/offer/fixtures.js');
  for (const fixture of FIXTURE_NAMES) {
    dom.reconfigure({ url: `https://gcsp.test/blocks/gcsp/offer/preview.html?fixture=${fixture}` });
    globalThis.location = dom.window.location;
    const root = document.createElement('gcsp-offer'); document.body.append(root);
    await import(`../../blocks/gcsp/offer/harness.js?isolation=${fixture}`);
    await tick();
    assert.equal(root.querySelector('.gcsp-account-name')?.textContent, 'Paula Mason', fixture);
    assert.equal(root.querySelector('.gcsp-account-signout'), null, fixture);
    root.remove();
  }
});

test('every named outbox fixture keeps its account menu read-only', async () => {
  const { FIXTURE_NAMES } = await import('../../blocks/gcsp/presenter/fixtures.js');
  for (const fixture of FIXTURE_NAMES) {
    const root = document.createElement('gcsp-outbox'); root.setAttribute('fixture', fixture); document.body.append(root);
    await tick();
    assert.equal(root.querySelector('.gcsp-account-name')?.textContent, 'Presenter', fixture);
    assert.equal(root.querySelector('.gcsp-account-signout'), null, fixture);
    root.remove();
  }
});

test('component gallery account examples have no live sign-out action in any state', async () => {
  const { mountComponentGallery } = await import('../../blocks/vehicle-matcher/component-gallery.js');
  const root = document.createElement('div'); document.body.append(root); mountComponentGallery(root);
  assert.equal(root.querySelectorAll('.gcsp-header').length, 4);
  assert.equal(root.querySelectorAll('.gcsp-account-details').length, 2);
  assert.equal(root.querySelector('.gcsp-account-signout'), null);
});

test('live offer and outbox compositions retain the default functional sign-out action', async (t) => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, options) => {
    if (String(url) === '/api/gcsp/session/logout') sent.push({ url: String(url), options });
    return { status: 503, ok: false, json: async () => ({ status: 'unavailable' }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const mount of [
    (root) => offer.mountOffer(root, { account: { status: 'ready', name: 'Paula Mason' }, read: async () => ({ status: 'unavailable' }) }),
    (root) => outbox.mountOutbox(root, { loadMessages: async () => ({ status: 'empty' }) }),
  ]) {
    const root = document.createElement('div'); document.body.append(root); const stop = mount(root);
    const action = root.querySelector('.gcsp-account-signout'); assert.ok(action);
    action.click(); await tick();
    assert.equal(sent.at(-1).url, '/api/gcsp/session/logout');
    assert.equal(sent.at(-1).options.method, 'POST');
    assert.equal(sent.at(-1).options.credentials, 'same-origin');
    assert.equal(action.disabled, false, 'failure permits a retry');
    stop(); root.remove();
  }
  assert.equal(sent.length, 2);
});
