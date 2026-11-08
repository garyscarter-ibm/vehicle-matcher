import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createOfferView } from '../../blocks/gcsp/offer/offer-view.js';
import { offerFixture } from '../../blocks/gcsp/offer/fixtures.js';
import { createOfferController } from '../../blocks/gcsp/offer/offer-controller.js';
import { createOfferHttpAdapter } from '../../blocks/gcsp/offer/http-adapter.js';
import { toOfferPresentation } from '../../blocks/gcsp/offer/offer-projection.js';
import { orderProgressFixtures } from '../../blocks/gcsp/order-progress/fixtures.js';

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

test('recorded current-car facts render formatted beside Unknown ones with the subset note', async () => {
  const dto = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/comparison-access.json', import.meta.url), 'utf8'));
  const c = dto.comparison;
  c.currentCar.facts = { boot: { value: 500, unit: 'L' }, mpg: { value: 42.8, unit: 'mpg-imperial' }, zeroTo62: { value: 7.6, unit: 's' } };
  c.unknowns = c.unknowns.filter((k) => !['boot', 'mpg', 'zeroTo62'].includes(k)); c.comparisonAvailable = true; c.reason = 'current-car-facts-recorded';
  const adapter = createOfferHttpAdapter({ location: { href: `https://example.test/gcsp/offer?offerId=${dto.offerId}` },
    fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ status: 'ok', value: dto }) }) });
  const root = document.createElement('div'); document.body.append(root);
  const ctl = createOfferController(adapter); const view = createOfferView(root); const unsub = ctl.subscribe(view.update);
  try {
    await ctl.refresh(); const text = root.querySelector('.gcsp-offer-current').textContent;
    assert.match(text, /Partial comparison\. Some current-car facts are unknown\./);
    for (const known of [/500 litres/, /42\.8 mpg/, /7\.6 s/]) assert.match(text, known);
    assert.equal(root.querySelectorAll('.gcsp-offer-current dd.is-missing').length, 5);
    assert.equal(root.querySelectorAll('.gcsp-offer-current dd').length, 8);
  } finally { unsub(); ctl.destroy(); view.destroy(); }
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
  let dto = { ...initial, handoff: offerFixture('handoff-replacement').value.handoff }; const calls = [];
  const adapter = createOfferHttpAdapter({ location: { href: `https://example.test/gcsp/offer?offerId=${dto.offerId}` },
    fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ status: 'ok', value: dto }) }) });
  // Contract spy only; no actual FUCQ-106 command or successful decision is claimed.
  const c = createOfferController({ ...adapter, readReasons: async () => ({ status: 'ok', value: { schemaVersion: 1, key: 'offer.declineReasons.v1', policyVersion: 'contract-spy', reasons: [{ code: 'test-reason', label: 'Test reason', attribute: 'body' }] } }),
    createCommandId: () => 'render-decline-spy', decide: async ({ kind }) => { calls.push(kind); } });
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, { decide: c.decision }); const unsubscribe = c.subscribe(view.update);
  try {
    await c.refresh(); for (const id of ['terms', 'driver', 'return']) c.tickDeclaration(id, true);
    const accept = root.querySelector('[data-offer-action="accept"]'); accept.focus();
    const declineButton = root.querySelector('[data-offer-action="decline"]'); const card = root.querySelector('.vm-card');
    assert.equal(accept.disabled, false); assert.equal(declineButton.disabled, false);
    dto = { ...decline, handoff: dto.handoff }; await c.refresh(); // Same handoff, so only the clock read changes.
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

const stageText = (root) => [...root.querySelectorAll('.gcsp-stage-item')].map((row) => [...row.children].map((node) => node.textContent));
async function mountFixture(name, decide) {
  const root = document.createElement('div'); document.body.append(root);
  const c = createOfferController({ read: async () => offerFixture(name), decide, readReasons: async () => ({ status: 'unavailable' }) });
  const view = createOfferView(root, { decide: c.decision, tickDeclaration: c.tickDeclaration });
  const unsubscribe = c.subscribe(view.update); await c.refresh();
  return { root, c, stop: () => { unsubscribe(); c.destroy(); view.destroy(); } };
}

test('before accepting, the handoff shows contact, return car, wording and one checkbox per declaration gating Accept', async () => {
  const calls = []; const { root, c, stop } = await mountFixture('handoff-replacement', async (input) => { calls.push(input); return { status: 'ok' }; });
  try {
    const group = root.querySelector('[aria-label="Before you accept"]');
    assert.equal(group.querySelector('h2').textContent, 'Before you accept');
    for (const text of ['07700 900123', 'paula@example.invalid', 'G20 320d M Sport', '31 December 2026', '41,250 miles', 'Fictional demonstration terms']) assert.match(group.textContent, new RegExp(text));
    const boxes = [...group.querySelectorAll('input[type="checkbox"]')];
    assert.equal(boxes.length, 3); assert.ok(boxes.every((box) => box.labels[0].textContent.length > 10 && !box.checked));
    const accept = root.querySelector('[data-offer-action="accept"]'); assert.equal(accept.disabled, true);
    assert.match(root.textContent, /Tick each declaration to accept this offer\./);
    for (const box of boxes.slice(0, 2)) { box.checked = true; box.dispatchEvent(new window.Event('change', { bubbles: true })); }
    assert.equal(accept.disabled, true); assert.equal(root.querySelector('[aria-label="Before you accept"] input'), boxes[0]);
    boxes[2].checked = true; boxes[2].dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(accept.disabled, false);
    boxes[1].checked = false; boxes[1].dispatchEvent(new window.Event('change', { bubbles: true })); assert.equal(accept.disabled, true);
    boxes[1].checked = true; boxes[1].dispatchEvent(new window.Event('change', { bubbles: true }));
    accept.click(); await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1); assert.equal(calls[0].termsDigest, 'synthetic-terms-digest');
    assert.deepEqual(calls[0].declarations, { terms: true, driver: true, return: true });
  } finally { stop(); }
});

test('a handoff blocker names the reason, points to scheme support and offers no Accept', async () => {
  const { root, stop } = await mountFixture('handoff-blocked', async () => ({ status: 'ok' }));
  try {
    const group = root.querySelector('[aria-label="Before you accept"]');
    assert.match(group.textContent, /valid contact phone and email are needed/); assert.match(group.textContent, /Contact scheme support\./);
    assert.equal(group.querySelectorAll('input').length, 0);
    assert.equal(root.querySelector('[data-offer-action="accept"]').hidden, true);
    assert.equal(root.querySelector('[data-offer-action="decline"]').hidden, false);
  } finally { stop(); }
});

for (const [name, headline, stages] of [
  ['selection-hr', 'Selection received. Waiting for HR approval.', [['selection received', 'Done'], ['HR approval', 'Waiting'],
    ['sales-manager approval', 'Not started'], ['sent to ordering', 'Not started']]],
  ['selection-no-hr', 'Selection received. Waiting for sales-manager approval.', [['selection received', 'Done'],
    ['sales-manager approval', 'Waiting'], ['sent to ordering', 'Not started']]],
  ['selection-pending', 'Sending your selection to ordering. Ordering owns the next step. You do not need to do anything.', [['selection received', 'Sending'], ['HR approval', 'Not started'],
    ['sales-manager approval', 'Not started'], ['sent to ordering', 'Not started']]],
  ['selection-failed', 'Your selection was not accepted for ordering. The car stays reserved. Contact scheme support.', [['selection received', 'Not accepted'],
    ['HR approval', 'Not started'], ['sales-manager approval', 'Not started'], ['sent to ordering', 'Not started']]],
]) test(`accepted offer shows the server's stage names and states: ${name}`, async () => {
  const { root, stop } = await mountFixture(name);
  try {
    assert.equal(root.querySelector('h1').textContent, 'Offer accepted');
    assert.equal(root.querySelector('p.gcsp-note').textContent, headline);
    assert.deepEqual(stageText(root), stages);
    assert.equal(root.querySelector('.gcsp-stage-heading').textContent, 'Your selection');
    const ids = [...root.querySelector('.gcsp-stage-heading').closest('.gcsp-offer-current').querySelectorAll('dl > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]);
    assert.deepEqual(ids, name === 'selection-no-hr' ? [['Car order number', '0123456']] : [['Order reference', 'GCSP-000123'], ['Car order number', '0123456']]);
    assert.doesNotMatch(root.textContent, /Order number/); assert.equal(root.querySelector('[aria-label="Before you accept"]'), null);
    assert.doesNotMatch(root.textContent, /\bapproved\b/i); assert.equal(root.querySelector('[data-offer-action="accept"]'), null);
  } finally { stop(); }
});

test('an accepted offer without a selection record keeps the recorded message and no stage list', async () => {
  const { root, stop } = await mountFixture('accepted');
  try {
    assert.match(root.textContent, /Your selection is recorded\./); assert.equal(root.querySelector('.gcsp-stage-list'), null);
  } finally { stop(); }
});

const ORDER = '00000000-0000-4000-8000-000000000001';
const acceptedModel = (state = 'accepted') => ({ ...offerFixture('accepted').value, state, orderUuid: ORDER, canAccept: false, canDecline: false });

test('accepted offer mounts order progress with its own car and uuid; other states and a missing uuid mount none', () => {
  const mounts = []; let stops = 0;
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, { mountOrder: (host, input) => { mounts.push(input); host.textContent = 'progress'; return () => { stops += 1; }; } });
  view.update(acceptedModel('pending')); view.update(acceptedModel('declined'));
  assert.equal(mounts.length, 0); assert.equal(root.querySelector('.gcsp-offer-order'), null);
  view.update(acceptedModel());
  assert.equal(mounts.length, 1); assert.equal(mounts[0].orderUuid, ORDER);
  const member = acceptedModel().card.members[0];
  assert.equal(mounts[0].car.name, member.display.name); assert.equal(mounts[0].car.photo, member.media.src || undefined);
  assert.equal(root.querySelector('.gcsp-offer-order').getAttribute('aria-label'), 'Your order progress');
  view.update(acceptedModel()); assert.equal(mounts.length, 1); // an unchanged read keeps the mounted progress
  view.update(acceptedModel('declined')); assert.equal(stops, 1); assert.equal(root.querySelector('.gcsp-offer-order'), null);
  view.update(acceptedModel()); view.destroy(); assert.equal(stops, 2);
  const bare = document.createElement('div'); document.body.append(bare); const count = mounts.length;
  createOfferView(bare, { mountOrder: (host, input) => { mounts.push(input); return () => {}; } }).update(offerFixture('accepted').value);
  assert.equal(mounts.length, count); // no order uuid on the read, so nothing is mounted
});

test('the DTO projection carries the quote order uuid and the real embedded progress shows the offer car and order number', async () => {
  const sample = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json', import.meta.url)));
  const projected = toOfferPresentation({ status: 'ok', value: { ...structuredClone(sample), state: 'accepted', reason: 'accepted', offerState: 'accepted',
    holdState: 'converted', availableActions: [], followup: null } });
  assert.equal(projected.status, 'ok'); assert.equal(projected.value.orderUuid, sample.quote.orderUuid);
  const { mountOrderProgress } = await import('../../blocks/gcsp/order-progress/gcsp-order-progress.js');
  const states = orderProgressFixtures().states['appointment-requested'];
  const adapter = { readStages: async () => structuredClone(states.stages), readDocuments: async () => structuredClone(states.documents),
    readAppointment: async () => structuredClone(states.appointment), readReturnPlan: async () => structuredClone(states.returnPlan) };
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, { mountOrder: (host, { orderUuid, car }) => mountOrderProgress(host, { adapter, orderUuid: ORDER, car, embedded: true, headingLevel: 2 }) });
  view.update({ ...projected.value, orderUuid: ORDER, canAccept: false, canDecline: false });
  for (let n = 0; n < 60 && !root.querySelector('.gcsp-offer-order .gcsp-order-number'); n += 1) await new Promise((done) => setTimeout(done, 15));
  const area = root.querySelector('.gcsp-offer-order');
  assert.match(area.textContent, /Order referenceGCSP-000123Car order number1000001/); assert.match(area.textContent, new RegExp(projected.value.card.members[0].display.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(area.querySelector('h2').textContent, 'Order progress'); assert.ok(area.querySelectorAll('.gcsp-stage-tracker li').length >= 3);
  view.destroy(); assert.equal(root.querySelector('.gcsp-offer-order'), null);
});

test('mountOffer forwards the host order port to an accepted offer only', async () => {
  const sample = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json', import.meta.url)));
  const { mountOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  const read = (state) => async () => toOfferPresentation({ status: 'ok', value: { ...structuredClone(sample), state, reason: state, offerState: state,
    holdState: 'converted', availableActions: [], followup: null } });
  const seen = [];
  for (const state of ['accepted', 'expired']) {
    const root = document.createElement('div'); document.body.append(root);
    const stop = mountOffer(root, { read: read(state), order: { mount: (host, input) => { seen.push([state, input.orderUuid]); return () => {}; } } });
    await new Promise((done) => setTimeout(done, 30)); stop();
  }
  assert.deepEqual(seen, [['accepted', sample.quote.orderUuid]]);
});

test('the restarted state shows the restart screen with a single Reload button and no Try again', () => {
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, {}); view.update({ state: 'restarted', canAccept: false, canDecline: false });
  assert.match(root.textContent, /Demo restarted/); assert.deepEqual([...root.querySelectorAll('button')].map((b) => b.textContent), ['Reload']);
  assert.doesNotMatch(root.textContent, /could not be loaded|Try again|Check current state/); assert.equal(root.querySelector('.vm-card'), null);
  view.update({ state: 'error', canAccept: false, canDecline: false }); root.querySelector('[data-offer-action="refresh"]').focus();
  view.update({ state: 'restarted', canAccept: false, canDecline: false });
  assert.equal(document.activeElement?.textContent, 'Reload'); view.destroy(); root.remove();
});

test('a lapsed access key links to the access form, back to the account, since a reload of the open offer page cannot recover', () => {
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, {}); view.update({ state: 'error', canAccept: false, canDecline: false }); root.querySelector('[data-offer-action="refresh"]').focus();
  view.update({ state: 'access-lapsed', canAccept: false, canDecline: false });
  assert.match(root.textContent, /Demo access needed/); assert.match(root.textContent, /open this offer from your account/);
  const link = root.querySelector('a.vm-btn'); assert.equal(link.textContent, 'Enter the access key'); assert.equal(link.getAttribute('href'), '/gcsp/access?next=%2Fgcsp-account.html');
  assert.equal(document.activeElement, link); assert.equal(root.querySelectorAll('button').length, 0); assert.doesNotMatch(root.textContent, /Reload|could not be loaded|Try again/);
  view.destroy(); root.remove();
});
