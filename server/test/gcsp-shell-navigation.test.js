// FUCQ-284 slice B: every Paula page shows the same three-item rail, all working, routed from one place.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'Event', 'customElements', 'DOMException']) {
  Object.defineProperty(globalThis, name, { value: name === 'window' ? dom.window : dom.window[name], configurable: true, writable: true });
}
let portal; let emp; let pages;
const stops = [];
const account = { status: 'ready', name: 'Paula (synthetic)', context: 'Synthetic' };
const loadAccount = async () => account;
const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));
const place = () => { const node = document.createElement('div'); document.body.append(node); return node; };
const LABELS = ['Your cars', 'Order progress'];
const KEYS = ['cars', 'order-progress'];

before(async () => {
  portal = await import('../../blocks/gcsp/employee/portal-navigation.js');
  emp = await import('../../blocks/gcsp/employee/gcsp-employee.js');
  pages = {
    brief: await import('../../blocks/gcsp/brief/gcsp-brief.js'),
    activity: await import('../../blocks/gcsp/activity/gcsp-activity.js'),
    order: await import('../../blocks/gcsp/order-progress/gcsp-order-progress.js'),
    help: await import('../../blocks/gcsp/cases/gcsp-help.js'),
    cases: await import('../../blocks/gcsp/cases/fixtures.js'),
    followup: await import('../../blocks/gcsp/offer-followup/gcsp-offer-followup.js'),
    offer: await import('../../blocks/gcsp/offer/gcsp-offer.js'),
    offerEntry: await import('../../blocks/gcsp/offer/entry.js'),
    links: await import('../../blocks/gcsp/offer/portal-links.js'),
    review: await import('../../blocks/gcsp/manual-review/gcsp-manual-review.js'),
  };
});
after(() => { stops.splice(0).forEach((stop) => stop()); dom.window.close(); });
beforeEach(() => { stops.splice(0).forEach((stop) => stop()); document.body.replaceChildren(); });

const fakeLocation = () => { const assigned = []; return { assigned, assign: (to) => assigned.push(to) }; };
// A live host element, wired the way each live.js wires it: its navigate event is routed by the shared helper.
function element(tag, define, adapter, extra = {}) {
  define(dom.window.customElements);
  const host = document.createElement(tag); const location = fakeLocation();
  for (const [key, value] of Object.entries(extra)) host[key] = value;
  host.adapter = adapter; portal.routePortalEvents(host, location);
  document.body.append(host); stops.push(() => host.remove());
  return { root: host, location };
}
const unavailable = { loadAccount: async () => ({ status: 'unavailable' }) };
const PAGES = {
  'Your cars (mountEmployee default)': { active: 'cars', crumb: 'Your cars', mount() {
    const root = place(); const location = fakeLocation();
    stops.push(emp.mountEmployee(root, { loadAccount, location })); return { root, location };
  } },
  brief: { active: null, crumb: 'Your preferences', mount: () => element('gcsp-brief', pages.brief.defineGcspBrief, unavailable) },
  activity: { active: null, crumb: 'Buddy activity', mount: () => element('gcsp-activity', pages.activity.defineGcspActivity, unavailable) },
  'order progress': { active: 'order-progress', crumb: 'Order progress', mount: () => element('gcsp-order-progress', pages.order.defineGcspOrderProgress, unavailable) },
  help: { active: null, crumb: 'Renewal help', mount: () => element('gcsp-help', pages.help.defineGcspHelp, pages.cases.fixtureAdapter('request'),
    { accountAdapter: pages.cases.fixtureAccountAdapter }) },
  'offer follow-up': { active: null, crumb: 'Your next offer', mount: () => element('gcsp-offer-followup', pages.followup.defineGcspOfferFollowup, unavailable) },
  offer: { active: null, crumb: 'Your offer', mount() {
    const root = place(); const location = fakeLocation();
    stops.push(pages.offer.mountOffer(root, { read: async () => ({ status: 'unavailable' }), account, ...pages.links.signedInPortal(account, location) }));
    return { root, location };
  } },
  // Its reservation state is unknown here, so a click stays put; gcsp-manual-review-render.test.js proves release then route.
  'manual review': { active: 'cars', crumb: 'Your cars', stays: true, mount() {
    const root = place(); const location = fakeLocation();
    stops.push(pages.review.mountManualReview(root, { adapter: {}, loadAccount, location })); return { root, location };
  } },
};
const buttons = (root) => [...root.querySelectorAll('nav[aria-label="Portal"] button[data-key]')];

for (const accountStatus of ['stale-run', 'access-required', 'unavailable']) {
  test(`FUCQ-390: an out-of-date offer keeps all three working destinations when the account is ${accountStatus}`, async () => {
    const root = place(); const location = { ...fakeLocation(), href: 'https://example.test/gcsp/offer?offerId=old-offer&runId=old-run' };
    const calls = [];
    stops.push(pages.offerEntry.mountOfferEntry(root, { location, history: { replaceState() {} }, fetch: async (input, init) => {
      const path = new URL(input, location.href).pathname; calls.push({ path, method: init.method });
      return { ok: false, status: accountStatus === 'access-required' ? 401 : 503,
        headers: { get: () => 'application/json' }, json: async () => ({ status: path === '/api/gcsp/manual/account' ? accountStatus : 'stale-run' }) };
    } }));
    await tick();
    assert.equal(root.querySelector('h1').textContent, 'Offer out of date');
    const items = buttons(root);
    assert.deepEqual(items.map((node) => node.querySelector('.gcsp-nav-label').textContent), LABELS);
    assert.deepEqual(items.map((node) => node.dataset.key), KEYS);
    assert.ok(items.every((node) => !node.disabled && !node.hasAttribute('aria-disabled')));
    assert.equal(root.querySelector('.gcsp-account-details'), null);
    assert.equal(root.querySelector('[data-offer-action="accept"], [data-offer-action="decline"]'), null);
    for (const item of items) item.click();
    assert.deepEqual(location.assigned, KEYS.map((key) => portal.PORTAL_ROUTES[key]));
    assert.ok(calls.every((call) => call.method === 'GET'));
    assert.deepEqual(calls.map((call) => call.path), ['/api/gcsp/manual/account', '/api/gcsp/offers/old-offer']);
  });
}

for (const [name, page] of Object.entries(PAGES)) {
  test(`${name}: the same three working rail items, the right one current, every other one routes`, async () => {
    const { root, location } = page.mount(); await tick();
    const items = buttons(root);
    assert.deepEqual(items.map((node) => node.querySelector('.gcsp-nav-label').textContent), LABELS);
    assert.deepEqual(items.map((node) => node.dataset.key), KEYS);
    assert.ok(items.every((node) => node.getAttribute('aria-disabled') === null), 'no placeholder items');
    assert.deepEqual(items.filter((node) => node.getAttribute('aria-current') === 'page').map((node) => node.dataset.key), page.active ? [page.active] : []);
    const crumb = root.querySelector('nav[aria-label="Breadcrumb"] [aria-current="page"]');
    if (crumb) assert.equal(crumb.textContent, page.crumb);
    for (const node of items) node.click();
    await tick();
    assert.deepEqual(location.assigned, page.stays ? [] : KEYS.filter((key) => key !== page.active).map((key) => portal.PORTAL_ROUTES[key]));
  });
}

test('the rail is one frozen list and the old placeholders are gone', () => {
  assert.equal(emp.EMPLOYEE_NAVIGATION, portal.PORTAL_NAVIGATION);
  assert.ok(Object.isFrozen(portal.PORTAL_NAVIGATION));
  assert.deepEqual(portal.PORTAL_NAVIGATION.map((item) => item.label), LABELS);
  assert.ok(portal.PORTAL_NAVIGATION.every((item) => item.available === true));
  assert.equal(pages.activity.ACTIVITY_DESTINATION, portal.BUDDY_ACTIVITY_DESTINATION);
  assert.equal(pages.order.ORDER_PROGRESS_DESTINATION, portal.PORTAL_NAVIGATION.find((item) => item.key === 'order-progress'));
  assert.equal(pages.links.PORTAL_ROUTES, portal.PORTAL_ROUTES);
});

test('a host that passes onNavigate hears the key instead of the default routing', async () => {
  const root = place(); const location = fakeLocation(); const heard = [];
  stops.push(emp.mountEmployee(root, { loadAccount, location, onNavigate: (key) => heard.push(key) })); await tick();
  buttons(root).forEach((node) => node.click());
  assert.deepEqual(heard, ['order-progress']); assert.deepEqual(location.assigned, []);
});

test('routePortal ignores keys outside the rail and routeAfterRelease routes only once nothing is held', async () => {
  const location = fakeLocation();
  assert.equal(portal.routePortal('help', location), false); assert.equal(portal.routePortal('order', location), false);
  assert.deepEqual(location.assigned, []);
  const calls = [];
  assert.equal(await portal.routeAfterRelease('brief', { held: () => true, release: async () => (calls.push('release'), { status: 'ok' }), location }), true);
  assert.equal(await portal.routeAfterRelease('activity', { held: () => false, release: async () => calls.push('never'), location }), true);
  assert.equal(await portal.routeAfterRelease('cars', { held: () => true, release: async () => ({ status: 'pending' }), location }), false);
  assert.equal(await portal.routeAfterRelease('cars', { held: () => true, release: async () => { throw new Error('boom'); }, location }), false);
  assert.deepEqual(calls, ['release']); assert.deepEqual(location.assigned, ['/gcsp-account.html#gcsp-account-preferences', '/gcsp-activity-live.html']);
});
