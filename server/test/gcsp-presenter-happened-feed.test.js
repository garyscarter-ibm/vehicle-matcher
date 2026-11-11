// FUCQ-366: the "What happened" list under the Basic console body, and View email in the side drawer.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let dom; let feedMod; let consoleMod; let basicMod;
before(async () => {
  dom = new JSDOM('<!doctype html><body class="gcsp"></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'customElements']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
  feedMod = await import('../../blocks/gcsp/presenter-controls/happened-feed.js');
  consoleMod = await import('../../blocks/gcsp/presenter-controls/console.js');
  basicMod = await import('../../blocks/gcsp/presenter-controls/basic-console.js');
});
beforeEach(() => { document.body.replaceChildren(); window.sessionStorage.clear(); window.localStorage.clear(); });
after(() => dom.window.close());
const ok = (value) => ({ status: 'ok', value });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };
const START = '2026-11-09T09:00:00.000Z';
const NOON = '2026-11-10T11:30:00.000Z';
const main = { scenarioId: 'main-successful-journey', name: 'Main successful journey', scenarioVersion: 'v1', fixtureVersion: 'f1',
  availability: { available: true }, inputs: { briefs: [{ principalId: 'someone' }] }, clockStart: START };
const catalogue = { policyVersion: 'p1', scenarios: [main] };
const stockRelease = (runId, tickId, n) => ({ handlerId: 'stock-release', stage: 'release-pull', outcome: { status: 'ok',
  value: { kind: n ? 'stock-released' : 'no-release', runId, tickId, orderUuids: Array.from({ length: n }, (_, i) => `o-${i}`) } } });
const expiry = (n) => ({ handlerId: 'buddy-expiry', stage: 'buddy-expiry', outcome: { status: 'ok', value: { expired: Array.from({ length: n }, (_, i) => ({ holdId: `h${i}` })) } } });
const controls = (extra = {}) => ({ runId: 'run-a', runVersion: 1, now: START, clockVersion: '7', lastTick: null,
  currentScenario: { scenarioId: main.scenarioId, name: main.name, fixtureVersion: main.fixtureVersion }, principals: [],
  controls: { step: { value: 60, unit: 'seconds' }, namedTimes: {}, nextRelease: { status: 'unavailable', reason: 'No release cue.' } }, ...extra });
const tickState = (runId, tickId, now, outcomes) => controls({ runId, now, clockVersion: tickId, lastTick: { runId, tickId, eventId: tickId, now, outcomes } });
const HTML = '<p>Hello there</p>';
const message = (extra = {}) => ({ jobId: 'job-1', messageKind: 'offer', state: 'sent', transport: 'capture', time: NOON, subject: 'A car is ready for you',
  htmlBody: HTML, textBody: 'Hello there', offerLink: 'https://example.test/offer', recipient: { name: 'Zed Person', email: 'zed@example.test' }, attempts: 1, error: null, nextAttemptAt: null, ...extra });
const rows = (root) => [...root.querySelectorAll('.gcsp-timeline-event')].map((li) => ({ time: li.querySelector('.gcsp-timeline-time').textContent, label: li.querySelector('.gcsp-timeline-label').textContent }));
const labels = (root) => rows(root).map((r) => r.label);
function mount(overrides = {}, options = {}) {
  const host = document.createElement('div'); host.className = 'gcsp'; document.body.append(host);
  const adapter = { readScenarios: async () => ok(catalogue), readOutbox: async () => ok({ runId: 'run-a', messages: [] }), ...overrides };
  const feed = feedMod.mountHappenedFeed(host, { adapter, storage: window.sessionStorage, ...options });
  return { host, adapter, feed };
}

test('an empty run shows one Scheme started row with a London friendly time', async () => {
  const f = mount(); await f.feed.update(controls());
  assert.deepEqual(rows(f.feed.root), [{ time: 'Mon 9 Nov, 9:00am', label: 'Scheme started, no cars on the scheme yet' }]);
  assert.equal(f.feed.root.querySelector('h2').textContent, 'What happened');
  assert.doesNotMatch(f.feed.root.textContent, /UTC|—/);
  assert.equal(f.feed.root.hidden, false); f.feed.destroy();
});

test('What happened is a disclosure that starts closed and opens from its summary', async () => {
  const f = mount(); await f.feed.update(controls());
  const fold = f.feed.root.querySelector('details.gcsp-happened-fold');
  assert.ok(fold); assert.equal(fold.open, false);
  assert.equal(fold.querySelector('summary').textContent, 'What happened');
  assert.ok(fold.contains(f.feed.root.querySelector('.gcsp-timeline-list'))); f.feed.destroy();
});

test('release, hold lapse and offer email rows come newest first with plain labels and no recipient name', async () => {
  const f = mount({ readOutbox: async () => ok({ runId: 'run-a', messages: [message(), message({ jobId: 'job-2', state: 'failed', time: '2026-11-10T09:00:00.000Z' }),
    message({ jobId: 'job-3', messageKind: 'other' })] }) });
  await f.feed.update(tickState('run-a', 't1', NOON, [stockRelease('run-a', 't1', 100), expiry(3)]));
  assert.deepEqual(labels(f.feed.root), ['Offer email sent', '3 holds lapsed', '100 cars released', 'Offer email not delivered', 'Scheme started']);
  assert.equal(rows(f.feed.root)[0].time, 'Tue 10 Nov, 11:30am');
  assert.doesNotMatch(f.feed.root.textContent, /Zed|zed@|UTC|—|demo|synthetic|fictional|\btick\b/i);
  assert.equal(f.feed.root.querySelectorAll('button[data-job-id]').length, 2); f.feed.destroy();
});

test('View email opens the captured email in a drawer, Escape closes it and focus returns, and a repaint keeps it open', async () => {
  const f = mount({ readOutbox: async () => ok({ messages: [message()] }) }); await f.feed.update(controls());
  const open = f.feed.root.querySelector('button[data-job-id="job-1"]');
  assert.equal(open.textContent, 'View email'); assert.equal(open.getAttribute('aria-label'), 'View email, Tue 10 Nov, 11:30am');
  open.focus(); open.click();
  const dialog = f.feed.root.querySelector('[role="dialog"]'); assert.ok(dialog);
  assert.equal(dialog.querySelector('.gcsp-side-drawer-title').textContent, 'A car is ready for you');
  assert.equal(dialog.querySelector('.gcsp-side-drawer-context').textContent, 'Captured email');
  const frame = dialog.querySelector('iframe'); assert.equal(frame.getAttribute('sandbox'), ''); assert.equal(frame.srcdoc, HTML);
  assert.equal(dialog.querySelectorAll('.gcsp-mail-heading').length, 0);
  await f.feed.update(controls()); assert.ok(f.feed.root.querySelector('[role="dialog"]'), 'survives a repaint');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.feed.root.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, f.feed.root.querySelector('button[data-job-id="job-1"]'));
  f.feed.destroy();
});

test('destroy closes an open drawer', async () => {
  const f = mount({ readOutbox: async () => ok({ messages: [message({ htmlBody: undefined, subject: '' })] }) }); await f.feed.update(controls());
  f.feed.root.querySelector('button[data-job-id]').click();
  assert.equal(f.feed.root.querySelector('.gcsp-side-drawer-title').textContent, 'Email not created yet');
  f.feed.destroy(); assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('refresh after Release: the console feed shows the new release row', async () => {
  let current = controls(); const outbox = [];
  const adapter = { readControls: async () => ok(current), readContext: async () => ok({ roles: ['presenter'] }), readScenarios: async () => ok(catalogue),
    readFaults: async () => ok({ faults: [] }), listOrders: async () => ok({ orders: [] }), readOutbox: async () => ok({ messages: outbox }),
    tick: async (p) => { current = tickState('run-a', 't9', p.to, [stockRelease('run-a', 't9', 100)]); return ok({}); } };
  const host = document.createElement('div'); document.body.append(host);
  const api = consoleMod.mountPresenterConsole(host, { ...basicMod.basicConsoleOptions({ adapter }), adapter, commandId: () => 'c1' });
  await api.ready; await settle();
  const feedRoot = api.root.querySelector('.gcsp-console-stage > .gcsp-happened'); assert.ok(feedRoot);
  assert.equal(feedRoot, api.root.querySelector('.gcsp-console-stage').lastElementChild);
  assert.deepEqual(labels(feedRoot), ['Scheme started, no cars on the scheme yet']);
  api.basic.release.click(); await settle();
  assert.deepEqual(labels(feedRoot), ['100 cars released', 'Scheme started']);
  api.destroy();
});

test('a different run clears the history; a reload keeps it', async () => {
  const a = mount(); await a.feed.update(tickState('run-a', 't1', NOON, [stockRelease('run-a', 't1', 2)]));
  assert.deepEqual(labels(a.feed.root), ['2 cars released', 'Scheme started']);
  a.feed.destroy(); const b = mount(); await b.feed.update(controls());
  assert.deepEqual(labels(b.feed.root), ['2 cars released', 'Scheme started'], 'restored from sessionStorage');
  await b.feed.update(controls({ runId: 'run-b' }));
  assert.deepEqual(labels(b.feed.root), ['Scheme started, no cars on the scheme yet']); b.feed.destroy();
});

test('an outbox failure shows a note and keeps the tick rows; broken adapters never throw', async () => {
  const f = mount({ readOutbox: async () => ({ status: 'unavailable' }) });
  await f.feed.update(tickState('run-a', 't1', NOON, [stockRelease('run-a', 't1', 1)]));
  assert.deepEqual(labels(f.feed.root), ['1 car released', 'Scheme started']);
  const note = f.feed.root.querySelector('p.gcsp-note'); assert.equal(note.hidden, false); assert.equal(note.textContent, 'Captured emails could not be loaded.');
  f.feed.destroy();
  window.sessionStorage.clear();
  const g = mount({ readOutbox: async () => { throw new Error('x'); }, readScenarios: async () => { throw new Error('y'); } });
  await g.feed.update(controls()); assert.equal(labels(g.feed.root).length, 1); g.feed.destroy();
  const h = mount({ readOutbox: undefined }); await h.feed.update(controls());
  assert.equal(h.feed.root.querySelector('p.gcsp-note').hidden, true); h.feed.destroy();
});

test('feedEvents orders equal times email, lapsed, released, started and puts unknown times last', () => {
  const events = feedMod.feedEvents({ controls: tickState('run-a', 't', NOON, []), clockStart: NOON, history: [{ tickId: 't', at: NOON, released: 2, lapsed: 1 }, { tickId: 'u', at: NOON, released: 0, lapsed: 0 }],
    messages: [message({ state: 'pending' }), message({ jobId: 'x', time: null })] });
  assert.deepEqual(events.map((e) => e.label), ['Offer email waiting to send', 'Hold lapsed', '2 cars released', 'Scheme started']);
  const none = feedMod.feedEvents({ controls: controls({ now: 'bad' }), clockStart: 'bad' });
  assert.equal(none[0].occurredAt, null);
});

test('the page links the feed styles and the painted feed has no em dash', () => {
  const html = readFileSync(new URL('../../gcsp-presenter.html', import.meta.url), 'utf8');
  for (const sheet of ['kit/activity-timeline.css', 'kit/side-drawer.css', 'presenter-controls/happened-feed.css']) assert.ok(html.includes(sheet), sheet);
  assert.doesNotMatch(readFileSync(new URL('../../blocks/gcsp/presenter-controls/happened-feed.css', import.meta.url), 'utf8'), /border-(left|right)\s*:\s*[2-9]|presenter\.css/);
});

test('What happened shows a skeleton from mount until its first paint, never an empty list', async () => {
  const hold = { open: null }; const wait = new Promise((resolve) => { hold.open = resolve; });
  const f = mount({ readOutbox: async () => { await wait; return ok({ runId: 'run-a', messages: [] }); } });
  assert.ok(f.feed.root.querySelector('.gcsp-skeleton')); assert.equal(f.feed.root.querySelector('.gcsp-timeline-event'), null);
  const pending = f.feed.update(controls()); await settle();
  assert.equal(f.feed.root.hidden, false); assert.ok(f.feed.root.querySelector('.gcsp-skeleton')); assert.equal(f.feed.root.querySelector('.gcsp-timeline-event'), null);
  hold.open(); await pending;
  assert.equal(f.feed.root.querySelector('.gcsp-skeleton'), null); assert.equal(labels(f.feed.root).length, 1); f.feed.destroy();
});
