// FUCQ-375: the header notification bell. Kit component, row derivation, live source and the shell slot.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let mods; let dom;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };
const ROUTES = { activity: '/gcsp-activity-live.html', 'order-progress': '/gcsp-order-progress-live.html' };
const IMAGE = '/assets/gcsp-vehicle-evidence/00419fa06ad620a42de6311039c7df679f692b7f2af52d5a7daba46cd034dc93.webp';

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://bell.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException', 'Event', 'KeyboardEvent', 'MouseEvent']) {
    Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
  }
  mods = {
    bell: await import('../../blocks/gcsp/kit/notification-bell.js'),
    source: await import('../../blocks/gcsp/activity/notification-source.js'),
    shell: await import('../../blocks/gcsp/shell/portal-shell.js'),
    emp: await import('../../blocks/gcsp/employee/gcsp-employee.js'),
  };
});
after(() => dom.window.close());
beforeEach(() => { document.body.replaceChildren(); setVisibility('visible'); });

function setVisibility(state) { Object.defineProperty(document, 'visibilityState', { value: state, configurable: true }); }
const press = (target, key) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
const offer = (over = {}) => ({ offerRef: { offerId: 'o1' }, state: 'active', version: 1, createdAt: '2026-11-10T09:30:00.000Z',
  expiresAt: '2026-11-10T16:40:00.000Z', href: '/gcsp/offer?offerId=o1&runId=r1', ...over });
const value = (current, extra = {}) => ({ runId: 'r1', state: 'offer', currentOffer: current, offers: current ? [current] : [], stateChanges: [], ...extra });
const display = { offerRef: { offerId: 'o1' }, title: 'BMW i5 Touring', images: [{ src: IMAGE, alt: 'Front', fidelity: 'representative-configuration' }] };

test('rows: an active offer is the waiting row with car, deadline and one button', () => {
  const rows = mods.source.notificationRows(value(offer()), display, ROUTES);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].waiting, rows[0].title, rows[0].car, rows[0].detail], [true, 'Your buddy found a car', 'BMW i5 Touring', 'Reserved for you. Respond by 16:40.']);
  assert.deepEqual(rows[0].action, { label: 'View your offer', href: '/gcsp/offer?offerId=o1&runId=r1', variant: 'button' });
  assert.equal(rows[0].image.src, IMAGE);
  // FUCQ-354: "Respond by" is the UK clock, so a July deadline reads an hour on from UTC.
  const summer = mods.source.notificationRows(value(offer({ expiresAt: '2026-07-10T16:40:00.000Z' })), display, ROUTES);
  assert.equal(summer[0].detail, 'Reserved for you. Respond by 17:40.');
});

test('rows: only active and expired offers notify; decisions stay in Buddy history', () => {
  for (const state of ['accepted', 'decision-pending', 'release-pending', 'rejected', 'declined']) {
    assert.deepEqual(mods.source.notificationRows(value(offer({ state })), display), []);
    assert.equal(mods.source.notificationModel(value(offer({ state })), display).waiting, 0);
  }
  const [expired] = mods.source.notificationRows(value(offer({ state: 'expired' })), display);
  assert.equal(expired.title, 'Your offer expired.'); assert.equal(expired.waiting, undefined);
  assert.deepEqual(expired.action, { label: 'View expired offer', href: '/gcsp/offer?offerId=o1&runId=r1', variant: 'link' });
});

test('rows: preference and permission events never appear; expired offers are deduplicated and newest first', () => {
  const stateChanges = ['confirmed', 'paused', 'resumed', 'engaged', 'disengaged', 'changed-after-decline'].map((operation, index) => ({
    eventId: `e${index}`, operation, occurredAt: '2026-11-10T09:12:00.000Z' }));
  assert.deepEqual(mods.source.notificationRows(value(null, { stateChanges })), []);
  const expired = (id, day) => offer({ offerRef: { offerId: id }, state: 'expired', expiresAt: `2026-11-${day}T16:40:00.000Z` });
  const older = expired('o2', '09'); const recent = expired('o3', '10');
  const input = value(offer(), { stateChanges, offers: [older, recent, recent, offer(), offer({ offerRef: { offerId: 'old-active' } }), offer({ offerRef: { offerId: 'accepted' }, state: 'accepted' })] });
  const rows = mods.source.notificationRows(input, display);
  assert.deepEqual(rows.map((r) => r.key), ['offer:o1', 'offer:o3', 'offer:o2']);
  assert.ok(rows.every((r) => r.kind === 'offer'));
  assert.equal(rows[1].image, undefined, 'an older offer never borrows the current car image');
  assert.deepEqual(mods.source.notificationRows(null), []);
  assert.equal(mods.source.notificationModel(input, display).allHref, undefined);
});

test('component: badge, accessible name and the closed state', () => {
  const bell = mods.bell.notificationBell({}); document.body.append(bell.root);
  assert.equal(bell.button.getAttribute('aria-label'), 'Notifications, none waiting');
  bell.update({ status: 'ok', waiting: 1, rows: mods.source.notificationRows(value(offer()), display, ROUTES), allHref: ROUTES.activity });
  assert.equal(bell.button.getAttribute('aria-label'), 'Notifications, 1 car offer waiting');
  const badge = bell.root.querySelector('.gcsp-bell-badge');
  assert.equal(badge.hidden, false); assert.equal(badge.textContent, '1'); assert.equal(badge.getAttribute('aria-hidden'), 'true');
  bell.update({ status: 'ok', waiting: 0, rows: [], allHref: ROUTES.activity });
  assert.equal(badge.hidden, true); assert.equal(bell.button.getAttribute('aria-label'), 'Notifications, none waiting');
  assert.equal(bell.button.getAttribute('aria-expanded'), 'false');
  assert.equal(bell.button.getAttribute('aria-controls'), bell.root.querySelector('.gcsp-bell-panel').id);
});

test('component: opening does not clear the badge; Escape and click outside close and return focus', () => {
  const bell = mods.bell.notificationBell({}); document.body.append(bell.root);
  const outside = document.createElement('button'); document.body.append(outside);
  const model = { status: 'ok', waiting: 1, rows: mods.source.notificationRows(value(offer()), display, ROUTES), allHref: ROUTES.activity };
  bell.update(model);
  bell.button.click();
  const panel = bell.root.querySelector('.gcsp-bell-panel');
  assert.equal(panel.hidden, false); assert.equal(bell.button.getAttribute('aria-expanded'), 'true');
  assert.equal(bell.root.querySelector('.gcsp-bell-badge').hidden, false);
  assert.equal(panel.querySelector('h2').textContent, 'Notifications');
  assert.equal(panel.querySelector('.vm-btn').textContent, 'View your offer');
  assert.equal(panel.querySelector('.gcsp-bell-foot'), null);
  panel.querySelector('.vm-btn').focus(); press(document.activeElement, 'Escape');
  assert.equal(panel.hidden, true); assert.equal(document.activeElement, bell.button);
  bell.button.click(); outside.focus(); outside.click();
  assert.equal(panel.hidden, true); assert.equal(bell.button.getAttribute('aria-expanded'), 'false');
  bell.button.click(); panel.querySelector('.vm-btn').focus(); document.body.click();
  assert.equal(panel.hidden, true); assert.equal(document.activeElement, bell.button);
  bell.destroy();
});

test('component: a new offer note shows for the set time and is announced once', () => {
  const timers = []; const bell = mods.bell.notificationBell({ schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, cancel() {} });
  document.body.append(bell.root);
  const note = { id: 'o1', title: 'Your buddy found a car', text: 'BMW i5 Touring. Respond by 16:40.' };
  bell.update({ status: 'ok', waiting: 1, rows: [], note });
  const box = bell.root.querySelector('.gcsp-bell-note'); const live = bell.root.querySelector('[role="status"]');
  assert.equal(box.hidden, false); assert.match(box.textContent, /BMW i5 Touring\. Respond by 16:40\./);
  assert.equal(live.textContent, 'Your buddy found a car. BMW i5 Touring. Respond by 16:40.'); assert.equal(timers[0].ms, 6000);
  timers[0].fn(); assert.equal(box.hidden, true);
  live.textContent = ''; bell.update({ status: 'ok', waiting: 1, rows: [], note });
  assert.equal(box.hidden, true); assert.equal(live.textContent, '');
  assert.equal(dom.window.document.querySelectorAll('.gcsp-bell [aria-live]').length, 0);
});

function fakeAdapter(script) {
  const calls = { reads: 0, displays: 0, signals: [] }; let pending = null;
  return { calls, release: () => pending?.(),
    readActivity: async ({ signal } = {}) => {
      calls.reads += 1; calls.signals.push(signal); const step = script(calls.reads);
      if (step?.hold) await new Promise((resolve) => { pending = resolve; });
      return step?.result ?? { status: 'unavailable' };
    },
    readOfferDisplay: async () => { calls.displays += 1; return display; } };
}
const ok = (v) => ({ status: 'ok', value: v });
function harness(adapter, extra = {}) {
  const actions = new Set(); const timers = new Map(); let nextTimer = 0; const models = [];
  const source = mods.source.createNotificationSource({ adapter, routes: ROUTES, document,
    subscribe: (listener) => { actions.add(listener); return () => actions.delete(listener); },
    setTimer: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; }, clearTimer: (id) => timers.delete(id), ...extra });
  const stop = source.connect((model) => models.push(model));
  return { source, stop, models, actions, timers, last: () => models.at(-1), fire: () => [...actions].forEach((l) => l()),
    tickTimer: () => [...timers.values()].forEach((t) => t.fn()) };
}

test('source: unavailable before the first read, last state kept after a later failure', async () => {
  const adapter = fakeAdapter((n) => (n === 2 ? { result: { status: 'unavailable' } } : { result: ok(value(offer())) }));
  adapter.readActivity = ((read) => async (input) => { const out = await read(input); return adapter.calls.reads === 2 ? { status: 'unavailable' } : out; })(adapter.readActivity);
  const failing = { readActivity: async () => ({ status: 'unavailable' }) };
  const early = harness(failing); await settle();
  assert.equal(early.models[0].status, 'loading'); assert.equal(early.last().status, 'unavailable'); assert.equal(early.last().waiting, 0); early.stop();
  const h = harness(adapter); await settle();
  assert.equal(h.last().status, 'ok'); assert.equal(h.last().waiting, 1);
  h.fire(); await settle();
  assert.equal(h.last().status, 'ok'); assert.equal(h.last().waiting, 1);
  h.stop();
});

test('source: no note on the first read; a newly active offer shows one note, a repeat read does not', async () => {
  let current = offer({ offerRef: { offerId: 'o1' } });
  const adapter = fakeAdapter(() => ({ result: ok(value(current)) }));
  const h = harness(adapter); await settle();
  assert.equal(h.last().waiting, 1); assert.equal(h.last().note, null);
  h.fire(); await settle(); assert.equal(h.last().note, null);
  current = offer({ state: 'accepted' }); h.fire(); await settle(); assert.equal(h.last().waiting, 0);
  current = offer({ offerRef: { offerId: 'o2' }, href: '/gcsp/offer?offerId=o2&runId=r1' }); h.fire(); await settle();
  assert.equal(h.last().waiting, 1); assert.equal(h.last().note.id, 'o2'); assert.match(h.last().note.text, /Respond by 16:40\.$/);
  h.fire(); await settle(); assert.equal(h.last().note, null);
  h.stop();
});

test('source: a poll that finds a newly active offer shows the same note', async () => {
  let current = null;
  const h = harness(fakeAdapter(() => ({ result: ok(value(current)) }))); await settle();
  assert.equal(h.last().waiting, 0);
  current = offer(); h.tickTimer(); await settle();
  assert.equal(h.last().note.title, 'Your buddy found a car'); assert.equal(h.last().waiting, 1);
  h.stop();
});

test('source: re-reads on presenter action, visible tab and a restored page, not on a first load pageshow', async () => {
  const adapter = fakeAdapter(() => ({ result: ok(value(null)) }));
  const h = harness(adapter); await settle(); assert.equal(adapter.calls.reads, 1);
  h.fire(); await settle(); assert.equal(adapter.calls.reads, 2);
  setVisibility('hidden'); document.dispatchEvent(new dom.window.Event('visibilitychange')); await settle(); assert.equal(adapter.calls.reads, 2);
  setVisibility('visible'); document.dispatchEvent(new dom.window.Event('visibilitychange')); await settle(); assert.equal(adapter.calls.reads, 3);
  const page = (persisted) => { const e = new dom.window.Event('pageshow'); e.persisted = persisted; dom.window.dispatchEvent(e); };
  page(false); await settle(); assert.equal(adapter.calls.reads, 3);
  page(true); await settle(); assert.equal(adapter.calls.reads, 4);
  h.stop();
});

test('poll: defaults to 30 seconds, ticks read, hidden tabs stop and resume it', async () => {
  const adapter = fakeAdapter(() => ({ result: ok(value(null)) }));
  const h = harness(adapter); await settle();
  assert.equal([...h.timers.values()][0].ms, 30000); assert.equal(adapter.calls.reads, 1);
  h.tickTimer(); await settle(); assert.equal(adapter.calls.reads, 2);
  setVisibility('hidden'); document.dispatchEvent(new dom.window.Event('visibilitychange')); await settle();
  assert.equal(h.timers.size, 0); h.tickTimer(); await settle(); assert.equal(adapter.calls.reads, 2);
  setVisibility('visible'); document.dispatchEvent(new dom.window.Event('visibilitychange')); await settle();
  assert.equal(adapter.calls.reads, 3); assert.equal(h.timers.size, 1);
  h.stop();
});

test('poll: a tick is skipped while a read is in flight, and pollMs is injectable', async () => {
  const adapter = fakeAdapter((n) => (n === 1 ? { hold: true, result: ok(value(null)) } : { result: ok(value(null)) }));
  const h = harness(adapter, { pollMs: 5 }); await settle();
  assert.equal([...h.timers.values()][0].ms, 5); assert.equal(adapter.calls.reads, 1);
  h.tickTimer(); h.tickTimer(); await settle(); assert.equal(adapter.calls.reads, 1);
  adapter.release(); await settle(); h.tickTimer(); await settle(); assert.equal(adapter.calls.reads, 2);
  h.stop();
});

test('destroy stops polling and listeners and aborts the read in flight', async () => {
  const adapter = fakeAdapter(() => ({ hold: true, result: ok(value(offer())) }));
  const h = harness(adapter); await settle();
  assert.equal(h.timers.size, 1); assert.equal(h.actions.size, 1);
  h.stop(); assert.equal(h.timers.size, 0); assert.equal(h.actions.size, 0); assert.equal(adapter.calls.signals[0].aborted, true);
  const seen = h.models.length; adapter.release(); await settle(); h.tickTimer(); h.fire();
  setVisibility('visible'); document.dispatchEvent(new dom.window.Event('visibilitychange')); await settle();
  assert.equal(adapter.calls.reads, 1); assert.equal(h.models.length, seen);
});

function shellWith(options = {}) {
  const shell = mods.shell.portalShell({ account: { status: 'ready', name: 'Paula Mason', email: 'p@x.test' }, accountMenu: [{ key: 'brief', label: 'Your preferences' }], ...options });
  document.body.append(shell.root); return shell;
}

test('shell: no bell without notifications; the bell sits just left of the account when supplied', () => {
  const plain = shellWith(); assert.equal(plain.root.querySelector('.gcsp-bell'), null); assert.equal(plain.bell, null); plain.setNotifications({ status: 'ok' }); plain.destroy();
  const shell = shellWith({ notifications: { status: 'unavailable' } });
  const header = shell.root.querySelector('.gcsp-header');
  assert.equal(shell.root.querySelector('.gcsp-bell').nextElementSibling, shell.root.querySelector('.gcsp-account'));
  assert.equal(header.contains(shell.bell), true);
  assert.equal(shell.bell.querySelector('.gcsp-bell-badge').hidden, true);
  shell.bell.querySelector('.gcsp-bell-btn').click();
  assert.equal(shell.bell.querySelector('.gcsp-bell-empty').textContent, 'Notifications are unavailable right now.');
  shell.setNotifications({ status: 'ok', waiting: 1, rows: [{ key: 'a', kind: 'offer', waiting: true, title: 'Your buddy found a car' }] });
  assert.equal(shell.bell.querySelector('.gcsp-bell-btn').getAttribute('aria-label'), 'Notifications, 1 car offer waiting');
  shell.destroy();
});

test('shell: the bell and the account menu close each other, and a source is connected and disconnected', async () => {
  const log = []; const source = { connect: (update) => { log.push('connect'); update({ status: 'ok', waiting: 0, rows: [] }); return () => log.push('disconnect'); } };
  const shell = shellWith({ notifications: source });
  const details = shell.root.querySelector('.gcsp-account-details'); const trigger = shell.bell.querySelector('.gcsp-bell-btn');
  details.open = true; trigger.click();
  assert.equal(details.open, false); assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  details.open = true; await settle();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false'); assert.equal(shell.bell.querySelector('.gcsp-bell-panel').hidden, true);
  trigger.click(); press(trigger, 'Escape');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false'); assert.equal(document.activeElement, trigger);
  shell.destroy(); assert.deepEqual(log, ['connect', 'disconnect']);
});

test('employee entry passes ctx.notifications to the shell; absent, no bell', async () => {
  const node = document.createElement('div'); document.body.append(node);
  const stop = mods.emp.mountEmployee(node, { loadAccount: async () => ({ status: 'ready', name: 'Paula Mason' }), notifications: { status: 'unavailable' } });
  await settle(); assert.ok(node.querySelector('.gcsp-header .gcsp-bell')); stop();
  const bare = document.createElement('div'); document.body.append(bare);
  const stopBare = mods.emp.mountEmployee(bare, { loadAccount: async () => ({ status: 'ready', name: 'Paula Mason' }) });
  await settle(); assert.equal(bare.querySelector('.gcsp-bell'), null); stopBare();
});

test('offer page: without an employee session the bell shows with no badge and no read', async () => {
  const { mountOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  const node = document.createElement('div'); document.body.append(node);
  const stop = mountOffer(node, { account: { status: 'unavailable' }, notifications: { status: 'unavailable' }, read: async () => ({ status: 'unavailable' }) });
  await settle();
  assert.equal(node.querySelector('.gcsp-bell-badge').hidden, true); assert.equal(node.querySelector('.gcsp-bell-btn').getAttribute('aria-label'), 'Notifications, none waiting');
  stop();
});

test('kit housekeeping: stylesheet is imported by the shell, tokens only, catalogued and in the gallery', () => {
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const css = read('blocks/gcsp/kit/notification-bell.css');
  assert.match(read('blocks/gcsp/shell/gcsp-shell.css'), /@import "\.\.\/kit\/notification-bell\.css";/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(read('COMPONENTS.md'), /notificationBell/);
  assert.match(read('blocks/vehicle-matcher/component-gallery.js'), /notificationBellExample/);
  assert.doesNotMatch(read('blocks/gcsp/activity/notification-source.js') + read('blocks/gcsp/kit/notification-bell.js'), /—/);
});
