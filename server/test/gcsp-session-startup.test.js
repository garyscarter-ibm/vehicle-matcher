// FUCQ-322: a session change during an entry's initial read must discard the old account snapshot.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { orderProgressFixtures } from '../../blocks/gcsp/order-progress/fixtures.js';

let dom;
before(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://startup.test/', virtualConsole: new VirtualConsole() });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'location']) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
});
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const reply = (body) => ({ ok: body.status === 'ok', status: body.status === 'ok' ? 200 : 503, json: async () => structuredClone(body) });
const changeSession = () => window.dispatchEvent(new window.StorageEvent('storage', { key: 'gcsp-session-change', newValue: 'changed-account' }));
const account = (name, email) => ({ status: 'ok', value: { state: 'ready', account: { name, contact: { email } }, actions: [] } });

test('order startup discards the previous person\'s delayed car when another tab changes session', async () => {
  const pending = deferred(); const started = deferred();
  const fixture = orderProgressFixtures().states['appointment-requested'];
  const orderUuid = fixture.stages.value.orderUuid;
  const host = document.createElement('gcsp-order-progress'); host.dataset.live = ''; document.body.append(host);
  const routes = {
    '/api/gcsp/manual/account': account('Alex Brennan', 'alex.brennan@gcsp-demo.com'),
    '/api/gcsp/orders/progress/all': { status: 'ok', value: { orders: [{ orderUuid, source: { receivedAt: '2026-11-05T09:00:00.000Z' } }] } },
    '/api/gcsp/orders/progress': fixture.stages, '/api/gcsp/documents': fixture.documents,
    '/api/gcsp/appointments': fixture.appointment, '/api/gcsp/return-plan': fixture.returnPlan,
  };
  globalThis.fetch = async (input) => {
    const path = new URL(input, 'https://startup.test').pathname;
    if (path === '/api/gcsp/manual/order') { started.resolve(); return pending.promise; }
    return reply(routes[path] ?? { status: 'unavailable' });
  };
  const mounted = import('../../blocks/gcsp/order-progress/live.js?session-startup');
  await started.promise; changeSession();
  // This response was issued for the previous session; deliberately ignore cancellation in the transport double.
  pending.resolve(reply({ status: 'ok', value: { selection: { stock: { orderUuid,
    facts: { display: { name: 'Paula\'s privately selected car' } } } } } }));
  await mounted; await tick(); await tick();
  assert.equal(host.querySelector('.gcsp-order-car-name'), null, 'old car data cannot be mounted after the session marker');
  assert.equal(host.querySelector('.gcsp-account-name'), null, 'startup waits for a guarded navigation before showing another identity');
  assert.doesNotMatch(host.textContent, /Paula|Alex Brennan/);
});

test('offer startup discards the previous person\'s delayed identity when another tab changes session', async (t) => {
  const { mountOfferEntry } = await import('../../blocks/gcsp/offer/entry.js');
  const pending = deferred(); const started = deferred(); let offerReads = 0;
  const root = document.createElement('div'); document.body.append(root);
  const fetch = async (input) => {
    const path = new URL(input, 'https://startup.test').pathname;
    if (path === '/api/gcsp/manual/account') { started.resolve(); return pending.promise; }
    if (path.startsWith('/api/gcsp/offers/')) offerReads += 1;
    return reply({ status: 'unavailable' });
  };
  const stop = mountOfferEntry(root, { fetch,
    location: { href: 'https://startup.test/gcsp/offer?offerId=offer-a&runId=run-a', assign() {}, reload() {} },
    history: { replaceState() {} } });
  t.after(stop);
  await started.promise; changeSession();
  pending.resolve(reply(account('Paula Mason', 'paula.mason@gcsp-demo.com')));
  await tick(); await tick();
  assert.equal(root.querySelector('.gcsp-account-name'), null, 'late identity cannot paint after the session marker');
  assert.doesNotMatch(root.textContent, /Paula|paula\.mason/);
  assert.equal(offerReads, 0, 'the invalidated entry does not start offer requests in a changed session');
});
