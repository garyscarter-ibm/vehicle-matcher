import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createOfferView } from '../../blocks/gcsp/offer/offer-view.js';
import { offerFixture } from '../../blocks/gcsp/offer/fixtures.js';
import { createOfferController } from '../../blocks/gcsp/offer/offer-controller.js';
import { createOfferHttpAdapter } from '../../blocks/gcsp/offer/http-adapter.js';

let dom;
before(() => { dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.customElements = dom.window.customElements;
});
after(() => dom.window.close());
beforeEach(() => document.body.replaceChildren());
function render(name, ports = {}) {
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, ports);
  const data = offerFixture(name).value;
  view.update({ ...data, canAccept: false, canDecline: false, decisionUnavailable: true, countdown: '2 hours remaining' });
  return { root, view, data };
}

test('exact shared card, points and current car comparison preserve supplied unknowns and provenance', () => {
  const { root } = render('pending');
  assert.equal(root.querySelectorAll('.vm-card').length, 1);
  assert.match(root.textContent, /Order no\. 0123456/);
  assert.match(root.textContent, /1,100 points a month.*1,300 points a month allowance/);
  assert.match(root.textContent, /G21 320i M Sport Touring/);
  assert.match(root.textContent, /Fitted equipment unknown/);
  assert.match(root.textContent, /Representative BMW brand image, not this exact car/);
  assert.match(root.textContent, /Synthetic presentation example/);
  assert.equal(root.querySelector('[data-offer-action="accept"]').disabled, true);
  const reason = root.querySelector('[data-offer-action="accept"]').getAttribute('aria-describedby');
  assert.match(root.querySelector(`#${reason}`).textContent, /Decisions are unavailable/);
});

test('missing image has a useful fallback and terminal states have no decision controls', () => {
  const { root, view, data } = render('no-image');
  assert.match(root.textContent, /No image for this car yet|Images coming soon/);
  assert.equal(root.querySelector('.vm-card-photo'), null);
  for (const state of ['accepted', 'declined', 'expired', 'superseded', 'earlier-run', 'not-found', 'uncertain', 'error', 'loading']) {
    view.update({ ...data, state });
    assert.equal(root.querySelectorAll('[data-offer-action="accept"], [data-offer-action="decline"]').length, 0);
    assert.equal(root.querySelectorAll('h1').length, 1);
    if (['earlier-run', 'not-found', 'error', 'loading'].includes(state)) assert.equal(root.querySelector('.vm-card'), null);
  }
});

test('live announcements are bounded and refresh retains visible keyboard focus', () => {
  const { root, view, data } = render('pending');
  const control = root.querySelector('[data-offer-action="refresh"]'); control.focus();
  const card = root.querySelector('.vm-card');
  view.update({ ...data, state: 'pending', countdown: '4 minutes remaining', seconds: 240 });
  assert.equal(document.activeElement.dataset.offerAction, 'refresh');
  assert.equal(document.activeElement, control); assert.equal(root.querySelector('.vm-card'), card);
  const live = root.querySelector('[data-offer-announcement]');
  assert.equal(live.textContent, 'Less than five minutes remain on this offer.');
  view.update({ ...data, state: 'pending', countdown: '3 minutes remaining', seconds: 180 });
  assert.equal(live.textContent, 'Less than five minutes remain on this offer.');
  view.update({ ...data, state: 'expired' });
  assert.equal(live.textContent, 'Offer expired');
  assert.equal(document.activeElement.dataset.offerAction, 'refresh');
});

test('multiple embeds have unique descriptions and text is rendered without HTML execution', () => {
  const one = render('pending'); const two = render('pending');
  const ids = [...document.querySelectorAll('[data-offer-action="accept"]')].map((control) => control.getAttribute('aria-describedby'));
  assert.equal(new Set(ids).size, 2);
  one.data.card.members[0].display.name = '<script>throw 1</script>';
  one.view.update(one.data);
  assert.equal(one.root.querySelectorAll('script').length, 0);
  assert.match(one.root.textContent, /<script>throw 1<\/script>/);
  one.view.destroy(); two.view.destroy(); assert.equal(document.querySelectorAll('.gcsp-offer-body').length, 0);
});

test('custom element mounts, reads presenter events, and unsubscribes on disconnect', async () => {
  const { defineGcspOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  defineGcspOffer(); let event; let unsubscribed = false; let reads = 0;
  const host = document.createElement('gcsp-offer');
  host.adapter = { read: async () => { reads++; return offerFixture('pending'); },
    subscribeClock: (listener) => { event = listener; return () => { unsubscribed = true; }; } };
  document.body.append(host); await new Promise((resolve) => setImmediate(resolve));
  assert.match(host.textContent, /Your car offer/); assert.equal(reads, 1);
  event(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(reads, 2);
  host.remove(); assert.equal(unsubscribed, true); event(); assert.equal(reads, 2);
});

test('approved DTO flows through the default HTTP adapter/controller into the shared card with unavailable comparison', async () => {
  const dto = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json', import.meta.url), 'utf8'));
  const adapter = createOfferHttpAdapter({ location: { href: `https://example.test/gcsp/offer?offerId=${dto.offerId}` },
    fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ status: 'ok', value: dto }) }) });
  const root = document.createElement('div'); document.body.append(root);
  const c = createOfferController(adapter); const view = createOfferView(root); const unsubscribe = c.subscribe(view.update);
  const model = await c.refresh();
  assert.match(root.textContent, /Order no\. 0999987/); assert.match(root.textContent, /1,100 points a month.*1,300 points a month allowance/);
  assert.match(root.textContent, /Current-car details not supplied/); assert.match(root.textContent, /Fitted equipment unknown/);
  assert.match(root.textContent, /2 hours remaining/); assert.equal(model.seconds, 7200);
  assert.equal(root.querySelector('[data-offer-action="accept"]').disabled, true);
  unsubscribe(); c.destroy(); view.destroy();
});

test('approved partial DTO renders dated provenance and eight unknowns through HTTP/controller while retaining focus on reads', async () => {
  const dto = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/comparison-access.json', import.meta.url), 'utf8'));
  const adapter = createOfferHttpAdapter({ location: { href: `https://example.test/gcsp/offer?offerId=${dto.offerId}` },
    fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ status: 'ok', value: dto }) }) });
  const root = document.createElement('div'); document.body.append(root);
  const c = createOfferController(adapter); const view = createOfferView(root); const unsubscribe = c.subscribe(view.update);
  try {
    const model = await c.refresh(); const comparison = root.querySelector('.gcsp-offer-current');
    assert.equal(comparison.querySelector('h3').textContent, 'Fictional BMW 320i Touring');
    assert.match(comparison.textContent, /Partial comparison\. Current-car specifications and points are unknown\./);
    assert.match(comparison.textContent, /Synthetic source: manual-records-v1\. Observed 2026-11-05T11:00:00\.000Z\./);
    assert.equal(comparison.querySelectorAll('dd').length, 8);
    assert.ok([...comparison.querySelectorAll('dd')].every((node) => node.textContent === 'Unknown'));
    assert.match(comparison.textContent, /No image for this car yet/); assert.equal(comparison.querySelector('img'), null);
    assert.equal(model.comparisonAvailable, false); assert.equal(model.seconds, 7200);
    assert.equal(root.querySelector('[data-offer-action="accept"]').disabled, true);
    const refresh = root.querySelector('[data-offer-action="refresh"]'); refresh.focus();
    dto.serverNow = '2026-11-05T12:00:05.000Z'; await c.refresh();
    assert.equal(root.querySelector('.gcsp-offer-current'), comparison); assert.equal(document.activeElement, refresh);
    dto.comparison.currentCar.source.observedAt = '2026-11-05T12:00:00.001Z'; await c.refresh();
    assert.match(root.textContent, /Current-car details not supplied/); assert.match(root.textContent, /Order no\. 0999987/);
    assert.doesNotMatch(root.textContent, /Fictional BMW 320i Touring/);
  } finally { unsubscribe(); c.destroy(); view.destroy(); }
});

test('partial model and provenance use text nodes for untrusted display strings', async () => {
  const dto = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/comparison-access.json', import.meta.url), 'utf8'));
  dto.comparison.currentCar.model = '<img src=x onerror=alert(1)>';
  dto.comparison.currentCar.source.sourceVersion = '<script>throw 1</script>';
  const { toOfferPresentation } = await import('../../blocks/gcsp/offer/offer-projection.js');
  const root = document.createElement('div'); const view = createOfferView(root);
  view.update(toOfferPresentation({ status: 'ok', value: dto }).value);
  const comparison = root.querySelector('.gcsp-offer-current');
  assert.equal(comparison.querySelectorAll('script, img, [onerror]').length, 0);
  assert.match(comparison.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(comparison.textContent, /<script>throw 1<\/script>/); view.destroy();
});

test('published decline-only DTO updates mounted actions and accessible explanation without resetting the hold countdown', async () => {
  const initial = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/producer-access.json', import.meta.url), 'utf8'));
  const decline = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/producer-decline-access.json', import.meta.url), 'utf8'));
  let dto = initial; const calls = [];
  const adapter = createOfferHttpAdapter({ location: { href: `https://example.test/gcsp/offer?offerId=${dto.offerId}` },
    fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ status: 'ok', value: dto }) }) });
  // Contract spy only; no actual FUCQ-106 command or successful decision is claimed.
  const c = createOfferController({ ...adapter, createCommandId: () => 'render-decline-spy', decide: async ({ kind }) => { calls.push(kind); } });
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, { decide: c.decision }); const unsubscribe = c.subscribe(view.update);
  try {
    await c.refresh(); const accept = root.querySelector('[data-offer-action="accept"]'); accept.focus();
    const declineButton = root.querySelector('[data-offer-action="decline"]'); const card = root.querySelector('.vm-card');
    assert.equal(accept.disabled, false); assert.equal(declineButton.disabled, false);
    dto = decline; await c.refresh();
    assert.equal(root.querySelector('[data-offer-action="accept"]'), accept); assert.equal(root.querySelector('.vm-card'), card);
    assert.equal(accept.disabled, true); assert.equal(declineButton.disabled, false); assert.equal(document.activeElement, declineButton);
    const reason = root.querySelector(`#${accept.getAttribute('aria-describedby')}`);
    assert.equal(reason.textContent, 'Acceptance is unavailable. You can still decline this offer.');
    assert.match(root.textContent, /1 hour remaining/); assert.match(root.textContent, /Order no\. 0123456/);
    assert.match(root.textContent, /Partial comparison/); assert.equal(root.querySelectorAll('.gcsp-offer-current dd.is-missing').length, 8);
    accept.click(); assert.deepEqual(calls, []);
    delete dto.comparison; await c.refresh();
    assert.match(root.textContent, /Current-car details not supplied/); assert.equal(root.querySelector('[data-offer-action="decline"]').disabled, false);
  } finally { unsubscribe(); c.destroy(); view.destroy(); }
});

test('scoped offer sources and harness obey embed CSP and composition styling boundaries', async () => {
  for (const file of ['offer-view.js', 'offer-controller.js', 'offer-projection.js', 'http-adapter.js', 'gcsp-offer.js', 'harness.js', 'fixtures.js', 'preview.html']) {
    const text = await readFile(new URL(`../../blocks/gcsp/offer/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bon[a-z]+\s*=|\beval\s*\(|new\s+Function\s*\(|set(?:Timeout|Interval)\s*\(\s*['"`]/i);
    if (file.endsWith('.html')) assert.doesNotMatch(text, /<script(?![^>]*\bsrc=)[^>]*>\s*\S/i);
  }
  const css = await readFile(new URL('../../blocks/gcsp/offer/gcsp-offer.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.vm-card|\.vm-btn|#[\da-f]{3,8}\b/i);
  assert.match(css, /minmax\(0, 1fr\)/);
});
