import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createOfferView } from '../../blocks/gcsp/offer/offer-view.js';
import { offerFixture, FIXTURE_NAMES } from '../../blocks/gcsp/offer/fixtures.js';
import { createOfferController } from '../../blocks/gcsp/offer/offer-controller.js';
import { createOfferHttpAdapter } from '../../blocks/gcsp/offer/http-adapter.js';
import { toOfferPresentation } from '../../blocks/gcsp/offer/offer-projection.js';

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
  assert.doesNotMatch(root.textContent, /Order no\. 0123456|Order number/);
  assert.match(root.textContent, /1,100 points a month.*1,300 points a month allowance/);
  assert.match(root.textContent, /320i M Sport Touring/);
  assert.doesNotMatch(root.textContent, /Fitted equipment unknown/);
  assert.doesNotMatch(root.textContent, /Representative|not this exact car/);
  assert.equal(root.querySelector('.gcsp-synthetic'), null);
  assert.equal(root.querySelector('[data-offer-action="accept"]').disabled, true);
  const reason = root.querySelector('[data-offer-action="accept"]').getAttribute('aria-describedby');
  assert.match(root.querySelector(`#${reason}`).textContent, /Decisions are unavailable/);
});

test('FUCQ-383: pending offer leads with h:mm, one uncaptained equal-column comparison and current-first identities', () => {
  const { root } = render('pending');
  const header = root.querySelector('.gcsp-offer-content').firstElementChild;
  assert.ok(header.querySelector('h1')); assert.ok(header.querySelector('.gcsp-countdown'));
  assert.equal(root.querySelectorAll('.gcsp-countdown').length, 1);
  assert.equal(root.querySelectorAll('[data-offer-comparison] table').length, 1);
  const table = root.querySelector('[data-offer-comparison] table');
  assert.equal(table.querySelector('caption').className, 'gcsp-vh');
  assert.ok(table.parentElement.classList.contains('has-equal-columns'));
  assert.deepEqual([...table.querySelectorAll('tbody th')].map((node) => node.textContent), ['Body style', 'Fuel', 'Seats', 'Boot', '0 to 62 mph', 'Fuel economy', 'Points a month']);
  const heads = [...table.querySelectorAll('thead th')].map((node) => node.textContent);
  assert.match(heads[1], /^Your current car /); assert.match(heads[2], /^This offer /);
  assert.deepEqual([...table.querySelectorAll('tbody tr')][3].querySelectorAll('.is-winner').length, 1);
  assert.equal(root.querySelector('.vm-card-gate'), null);
  assert.equal(root.querySelector('.vm-card .vm-facts').classList.contains('vm-facts-pair'), true);
  assert.deepEqual([...root.querySelectorAll('.gcsp-vehicle-summary [data-offer-action]')].map((node) => node.textContent), ['Accept offer', 'Decline offer']);
});

// FUCQ-316: missing card facts collapse into one line, as on the gallery cards (FUCQ-277).
test('FUCQ-316: a card with unknown Colour, Options, Interior and Gearbox lists none of them and shows one line', () => {
  const { root, view, data } = render('pending');
  const card = structuredClone(data.card);
  for (const [label, value] of [['Colour', null], ['Options', null], ['Interior', null], ['Gearbox', null]]) {
    const row = card.members[0].facts.find((fact) => fact.label === label);
    if (row) row.value = value; else card.members[0].facts.push({ label, value, missingLabel: label === 'Options' ? 'Fitted equipment unknown' : 'Not supplied' });
  }
  view.update({ ...data, card, canAccept: false, canDecline: false, decisionUnavailable: true, countdown: '2 hours remaining' });
  const body = root.querySelector('.vm-card');
  assert.doesNotMatch(body.textContent, /Not supplied|Fitted equipment unknown/);
  assert.equal(body.querySelectorAll('.is-missing').length, 0);
  assert.deepEqual([...body.querySelectorAll('.vm-facts dt')].map((node) => node.textContent), ['Body style', 'Fuel', 'Seats', 'Boot', '0 to 62 mph', 'Fuel economy', 'Derivative']);
  assert.equal(body.querySelectorAll('.vm-facts-more').length, 1);
  assert.equal(body.querySelector('.vm-facts-more').textContent, 'More details not supplied');
});

test('FUCQ-275: without a current car the card keeps its specs and the note stands in for the table', () => {
  const { root, view, data } = render('pending');
  view.update({ ...data, currentCar: null, comparisonAvailable: false, canAccept: false, canDecline: false, decisionUnavailable: true, countdown: '2 hours remaining' });
  assert.equal(root.querySelectorAll('table').length, 0); assert.match(root.textContent, /Current-car details not supplied/);
  const shown = [...root.querySelectorAll('.vm-card .vm-facts dt')].map((node) => node.textContent);
  assert.deepEqual(shown.slice(0, 7), ['Body style', 'Fuel', 'Seats', 'Boot', '0 to 62 mph', 'Fuel economy', 'Derivative']);
});

test('missing image has a useful fallback and terminal states have no decision controls', () => {
  const { root, view, data } = render('no-image');
  assert.match(root.textContent, /No image for this car yet|Images coming soon/);
  assert.equal(root.querySelector('.vm-card-photo'), null);
  for (const state of ['accepted', 'declined', 'expired', 'superseded', 'earlier-run', 'not-found', 'uncertain', 'error', 'loading']) {
    view.update({ ...data, state });
    assert.equal(root.querySelectorAll('[data-offer-action="accept"], [data-offer-action="decline"]').length, 0);
    assert.equal(root.querySelectorAll('h1').length, 1);
    if (['earlier-run', 'not-found', 'error', 'loading', 'expired'].includes(state)) assert.equal(root.querySelector('.vm-card'), null);
  }
});

// FUCQ-228: an expired offer shows that it expired and the next step, not the offer's fit.
test('expired offer shows only its expiry and next step', () => {
  const { root, view, data } = render('pending', { links: { activity: '/gcsp-activity-live.html', cars: '/gcsp-account.html' } });
  view.update({ ...data, state: 'expired' });
  assert.equal(root.querySelector('h1').textContent, 'Offer expired');
  assert.match(root.textContent, /no longer available to accept\. Open your account to check for a new offer\./);
  assert.doesNotMatch(root.textContent, /Eligible|Why it suits you|Your current car/);
  assert.equal(root.querySelector('.vm-card'), null);
  assert.equal(root.querySelector('[data-offer-action="refresh"]'), null);
  const exits = [...root.querySelectorAll('a.vm-btn')]; assert.deepEqual(exits.map((a) => a.textContent), ['See buddy activity', 'Back to Your cars']);
  assert.deepEqual(exits.map((a) => a.className.includes('primary')), [true, false]);
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

test('the live announcement is visually hidden with the kit utility, so the title shows once', async () => {
  const { root, view, data } = render('pending');
  const live = root.querySelector('[data-offer-announcement]');
  view.update({ ...data, state: 'expired' });
  assert.equal(live.textContent, 'Offer expired');
  assert.deepEqual([live.className, live.getAttribute('role'), live.getAttribute('aria-live')], ['gcsp-vh', 'status', null]);
  assert.equal(root.querySelector('h1').textContent, 'Offer expired');
  const css = await readFile(new URL('../../blocks/gcsp/shell/gcsp-shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.gcsp-vh \{[^}]*position: absolute;[^}]*clip-path: inset\(50%\);/);
  assert.match(await readFile(new URL('../../gcsp-offer.html', import.meta.url), 'utf8'), /gcsp-shell\.css/);
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
  assert.match(host.textContent, /Your vehicle offer/); assert.equal(reads, 1);
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
  assert.doesNotMatch(root.textContent, /Order no\. 0999987|Order number/); assert.match(root.textContent, /1,100 points a month.*1,300 points a month allowance/);
  assert.match(root.textContent, /Current-car details not supplied/); assert.doesNotMatch(root.textContent, /Fitted equipment unknown/);
  assert.match(root.querySelector('.gcsp-countdown').textContent, /2:00/); assert.equal(model.seconds, 7200);
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
    await ctl.refresh(); const section = root.querySelector('[data-offer-comparison]'); const text = section.textContent;
    assert.match(text, /Partial comparison\. Some current-car facts are unknown\./);
    for (const known of [/500 litres/, /42\.8 mpg/, /7\.6 s/]) assert.match(text, known);
    assert.equal(section.querySelectorAll('td.is-missing').length, 4);
    const full = section.querySelector('table'); assert.equal(full.querySelectorAll('tbody tr').length, 7);
    const unknown = [...full.querySelectorAll('tbody tr')].map((row) => row.children[1].textContent);
    assert.deepEqual(unknown, ['Unknown', 'Unknown', 'Unknown', '500 litres', '7.6 s', '42.8 mpg', 'Unknown']);
  } finally { unsub(); ctl.destroy(); view.destroy(); }
});

test('approved partial DTO renders dated provenance and eight unknowns through HTTP/controller while retaining focus on reads', async () => {
  const dto = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/comparison-access.json', import.meta.url), 'utf8'));
  const adapter = createOfferHttpAdapter({ location: { href: `https://example.test/gcsp/offer?offerId=${dto.offerId}` },
    fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ status: 'ok', value: dto }) }) });
  const root = document.createElement('div'); document.body.append(root);
  const c = createOfferController(adapter); const view = createOfferView(root); const unsubscribe = c.subscribe(view.update);
  try {
    const model = await c.refresh(); const comparison = root.querySelector('[data-offer-comparison]');
    assert.match(comparison.querySelector('thead th:nth-child(2)').textContent, /Your current car\s*Fictional BMW 320i Touring/);
    assert.match(comparison.textContent, /Partial comparison\. Current-car specifications and points are unknown\./);
    assert.doesNotMatch(comparison.textContent, /Synthetic source|manual-records-v1|2026-11-05T11|Observed|Source not supplied/);
    const currentCells = [...comparison.querySelectorAll('tbody tr')].map((row) => row.children[1]);
    assert.equal(currentCells.length, 7); assert.ok(currentCells.every((node) => node.textContent === 'Unknown'));
    assert.equal(comparison.querySelector('img'), null);
    assert.equal(model.comparisonAvailable, false); assert.equal(model.seconds, 7200);
    assert.equal(root.querySelector('[data-offer-action="accept"]').disabled, true);
    const refresh = root.querySelector('[data-offer-action="refresh"]'); refresh.focus();
    dto.serverNow = '2026-11-05T12:00:05.000Z'; await c.refresh();
    assert.equal(root.querySelector('[data-offer-comparison]'), comparison); assert.equal(document.activeElement, refresh);
    dto.comparison.currentCar.source.observedAt = '2026-11-05T12:00:00.001Z'; await c.refresh();
    assert.match(root.textContent, /Current-car details not supplied/); assert.doesNotMatch(root.textContent, /Order no\. 0999987|Order number/);
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
  const comparison = root.querySelector('[data-offer-comparison]');
  assert.equal(comparison.querySelectorAll('script, img, [onerror]').length, 0);
  assert.match(comparison.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(comparison.textContent, /script/); view.destroy();
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
    assert.equal(root.querySelector('.gcsp-countdown').textContent, '1:00'); assert.doesNotMatch(root.textContent, /Order no\. 0123456|Order number/);
    assert.match(root.textContent, /Partial comparison/); assert.equal(root.querySelectorAll('[data-offer-comparison] td.is-missing').length, 7);
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

// FUCQ-275: the comparison table is a kit dataTable, so its kit stylesheet must be in the offer page's chain.
test('offer stylesheet loads shared feature, comparison and equal-column styling', async () => {
  const css = await readFile(new URL('../../blocks/gcsp/offer/gcsp-offer.css', import.meta.url), 'utf8');
  const feature = await readFile(new URL('../../blocks/gcsp/kit/vehicle-decision.css', import.meta.url), 'utf8');
  const compare = await readFile(new URL('../../blocks/gcsp/kit/data-table-compare.css', import.meta.url), 'utf8');
  assert.match(css, /vehicle-decision\.css/); assert.match(css, /max-width: 1680px/);
  assert.match(feature, /@import "\.\/data-table-compare\.css"/);
  assert.match(compare, /table-layout: fixed/); assert.match(compare, /:not\(\.has-equal-columns\)/);
  assert.match(compare, /has-equal-columns \.gcsp-table-th-sub \{ display: block/);
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
    for (const text of ['07700 900123', 'paula.mason@gcsp-demo.com', 'BMW 3 Series Touring 320i', '31 December 2026', '41,250 miles', 'Scheme terms']) assert.match(group.textContent, new RegExp(text));
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
  ['selection-failed', 'The car stays reserved for you. Nothing has been ordered. Contact scheme support and quote order reference GCSP-000123.',
    [['selection received', 'Not accepted'], ['HR approval', 'Not started'], ['sales-manager approval', 'Not started'], ['sent to ordering', 'Not started']]],
]) test(`accepted offer shows the server's stage names and states: ${name}`, async () => {
  const { root, stop } = await mountFixture(name);
  try {
    const refused = name === 'selection-failed';
    assert.equal(root.querySelector('h1').textContent, refused ? 'Your selection was not sent to ordering' : 'Offer accepted');
    assert.equal(root.querySelector(refused ? '.vm-status .vm-lede' : 'p.gcsp-note').textContent, headline);
    if (refused) {
      assert.deepEqual(stageText(root), stages); assert.equal(root.querySelector('.gcsp-stage-heading').textContent, 'Your selection');
      const ids = [...root.querySelector('.gcsp-stage-heading').closest('.gcsp-offer-current').querySelectorAll('dl > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]);
      assert.deepEqual(ids, [['Order reference', 'GCSP-000123'], ['Car order number', '0123456']]);
    } else {
      // The short confirmation: no stage list, no comparison, the car and its order number once each.
      assert.equal(root.querySelector('.gcsp-stage-list'), null); assert.equal(root.querySelector('[data-offer-comparison]'), null);
      assert.equal(root.querySelectorAll('.vm-card').length, 0);
      const rows = [...root.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]);
      assert.deepEqual(rows.map((r) => r[0]), ['Your new car', 'Car order number']); assert.equal(rows[1][1], '0123456');
    }
    assert.doesNotMatch(root.textContent, /Order number/); assert.equal(root.querySelector('[aria-label="Before you accept"]'), null);
    assert.doesNotMatch(root.textContent, /\bapproved\b/i); assert.equal(root.querySelector('[data-offer-action="accept"]'), null);
  } finally { stop(); }
});

test('FUCQ-300: a refused handoff states the outcome, links Renewal help and mounts no tracker', () => {
  const refusedModel = () => ({ ...offerFixture('selection-failed').value, canAccept: false, canDecline: false, orderUuid: ORDER });
  const links = { orderProgress: '/gcsp-order-progress-live.html', cars: '/gcsp-account.html', help: '/gcsp-help.html' };
  const mounts = []; const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, { links, mountOrder: (host, input) => { mounts.push(input); host.textContent = 'tracker'; return () => {}; } });
  view.update(refusedModel());
  assert.equal(root.querySelector('h1').textContent, 'Your selection was not sent to ordering'); assert.equal(root.querySelectorAll('h1').length, 1);
  const status = root.querySelector('.vm-status'); assert.ok(status); assert.equal(status.querySelector('h1.vm-title').textContent, root.querySelector('h1').textContent);
  assert.equal(status.querySelector('.vm-lede').textContent, 'The car stays reserved for you. Nothing has been ordered. Quote order reference GCSP-000123 when you contact scheme support.');
  const help = [...status.querySelectorAll('a.vm-btn')].find((a) => a.textContent === 'Contact scheme support');
  assert.equal(help.getAttribute('href'), '/gcsp-help.html');
  assert.equal(status.querySelector('a[href="/gcsp-account.html"]').textContent, 'Back to Your cars');
  assert.equal(mounts.length, 0); assert.equal(root.querySelector('.gcsp-offer-order'), null);
  assert.doesNotMatch(root.textContent, /Track your order|Offer accepted|not accepted for ordering/);
  assert.equal(root.querySelector('a[href="/gcsp-order-progress-live.html"]'), null);
  assert.equal(root.querySelector('.gcsp-stage-heading').textContent, 'Your selection'); assert.equal(root.querySelectorAll('.vm-card').length, 1);
  assert.equal(root.querySelector('[data-offer-announcement]').textContent, '', 'the heading carries the outcome when the offer lands');
  assert.doesNotMatch(root.textContent, /\u2014/);
  const bare = document.createElement('div'); document.body.append(bare);
  createOfferView(bare, {}).update(refusedModel());
  assert.equal(bare.querySelector('a[href="/gcsp-help.html"]'), null); assert.equal(bare.querySelectorAll('a.vm-btn').length, 0);
  assert.match(bare.querySelector('.vm-status .vm-lede').textContent, /Nothing has been ordered\. Contact scheme support and quote order reference GCSP-000123\./);
  // A normal acknowledged selection keeps its heading and never embeds a tracker.
  const ok = document.createElement('div'); document.body.append(ok); let hosted = 0;
  const okView = createOfferView(ok, { links, mountOrder: (host) => { hosted += 1; return () => {}; } });
  okView.update({ ...offerFixture('selection-hr').value, canAccept: false, canDecline: false, orderUuid: ORDER });
  assert.equal(ok.querySelector('h1').textContent, 'Offer accepted'); assert.equal(hosted, 0); assert.equal(ok.querySelector('.vm-status'), null);
});

test('an accepted offer without a selection record keeps the recorded message and no stage list', async () => {
  const { root, stop } = await mountFixture('accepted');
  try {
    assert.match(root.textContent, /Your selection is recorded\./); assert.equal(root.querySelector('.gcsp-stage-list'), null);
  } finally { stop(); }
});

const ORDER = '00000000-0000-4000-8000-000000000001';
const acceptedModel = (state = 'accepted') => ({ ...offerFixture('accepted').value, state, orderUuid: ORDER, canAccept: false, canDecline: false });

test('an accepted offer is a short confirmation: the car and order number once, onward links, and no tracker or comparison', () => {
  const mounts = []; const links = { orderProgress: '/gcsp-order-progress-live.html', cars: '/gcsp-account.html' };
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, { links, mountOrder: (host, input) => { mounts.push(input); return () => {}; } });
  view.update(acceptedModel());
  const name = acceptedModel().card.members[0].display.name;
  assert.equal(mounts.length, 0); assert.equal(root.querySelector('.gcsp-offer-order'), null); assert.equal(root.querySelector('.gcsp-stage-tracker'), null);
  assert.equal(root.querySelector('.vm-card'), null); assert.equal(root.querySelector('[data-offer-comparison]'), null); assert.equal(root.querySelectorAll('img').length, 0);
  assert.equal(root.querySelectorAll('h1').length, 1); assert.equal(root.querySelector('h1').textContent, 'Offer accepted');
  assert.equal(root.textContent.split(name).length - 1, 1, 'the car name appears once');
  assert.equal(root.textContent.split('0123456').length - 1, 1, 'the car order number appears once');
  view.update(acceptedModel('declined')); assert.equal(root.querySelector('.gcsp-offer-order'), null);
  view.update(acceptedModel()); view.destroy();
});

test('FUCQ-271: the accepted note names the selection stage and keeps the stage claim on the short confirmation', () => {
  const selected = { ...offerFixture('selection-hr').value, canAccept: false, canDecline: false, orderUuid: ORDER };
  const root = document.createElement('div'); document.body.append(root);
  createOfferView(root, {}).update(selected);
  assert.equal(root.querySelector('p.gcsp-note').textContent, 'Selection received. Waiting for HR approval.');
  assert.equal(root.querySelector('.gcsp-stage-list'), null); assert.equal(root.querySelector('.gcsp-offer-order'), null);
});

test('mountOffer no longer mounts the order tracker in an accepted offer', async () => {
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
  assert.deepEqual(seen, []);
});

test('the restarted state shows the restart screen with a single Reload button and no Try again', () => {
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, {}); view.update({ state: 'restarted', canAccept: false, canDecline: false });
  assert.match(root.textContent, /Restarted/); assert.deepEqual([...root.querySelectorAll('button')].map((b) => b.textContent), ['Reload']);
  assert.doesNotMatch(root.textContent, /could not be loaded|Try again|Check current state/); assert.equal(root.querySelector('.vm-card'), null);
  view.update({ state: 'error', canAccept: false, canDecline: false }); root.querySelector('[data-offer-action="refresh"]').focus();
  view.update({ state: 'restarted', canAccept: false, canDecline: false });
  assert.equal(document.activeElement?.textContent, 'Reload'); view.destroy(); root.remove();
});

test('an ended session links back to the account, since a reload of the open offer page cannot recover', () => {
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, {}); view.update({ state: 'error', canAccept: false, canDecline: false }); root.querySelector('[data-offer-action="refresh"]').focus();
  view.update({ state: 'access-lapsed', canAccept: false, canDecline: false });
  assert.match(root.textContent, /Session ended/); assert.match(root.textContent, /Open your account to continue/);
  const link = root.querySelector('a.vm-btn'); assert.equal(link.textContent, 'Open your account'); assert.equal(link.getAttribute('href'), '/gcsp-account.html');
  assert.equal(document.activeElement, link); assert.equal(root.querySelectorAll('button').length, 0); assert.doesNotMatch(root.textContent, /Reload|could not be loaded|Try again/);
  view.destroy(); root.remove();
});

test('GC-041: an accepted offer leads on to order progress and Your cars beside the heading, only when the host supplies the routes', () => {
  const links = { orderProgress: '/gcsp-order-progress-live.html', cars: '/gcsp-account.html' };
  const root = document.createElement('div'); document.body.append(root);
  const view = createOfferView(root, { links, mountOrder: (host) => { host.append(document.createElement('p')); return () => {}; } });
  view.update(acceptedModel());
  const [progress, cars] = [...root.querySelectorAll('a.vm-btn')];
  assert.equal(progress.textContent, 'Track your order'); assert.equal(progress.getAttribute('href'), links.orderProgress);
  assert.ok(progress.classList.contains('vm-btn-primary'));
  assert.equal(cars.textContent, 'Back to Your cars'); assert.equal(cars.getAttribute('href'), links.cars); assert.ok(cars.classList.contains('vm-btn-ghost'));
  const before = (a, b) => Boolean(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(before(root.querySelector('h1'), progress)); assert.equal(root.querySelector('.vm-card'), null);
  assert.ok(before(progress, root.querySelector('[data-offer-action=refresh]')));
  for (const state of ['pending', 'declined', 'uncertain']) { view.update(acceptedModel(state)); assert.equal(root.querySelectorAll('a.vm-btn').length, 0, state); }
  view.destroy(); root.remove();
  const bare = document.createElement('div'); document.body.append(bare); const plain = createOfferView(bare, {});
  plain.update(acceptedModel()); assert.equal(bare.querySelectorAll('a.vm-btn').length, 0); plain.destroy(); bare.remove();
});

test('GC-041: after Accept focus moves to the Offer accepted heading, and a background change to accepted leaves focus alone', () => {
  const root = document.createElement('div'); document.body.append(root);
  const pending = { ...offerFixture('pending').value, canAccept: true, canDecline: true, countdown: '2 hours remaining' };
  let view; const decide = () => { view.update({ ...acceptedModel('uncertain'), message: 'Checking your decision. Please wait.' }); view.update(acceptedModel()); };
  view = createOfferView(root, { decide });
  view.update(pending); root.querySelector('[data-offer-action=accept]').focus(); root.querySelector('[data-offer-action=accept]').click();
  const heading = root.querySelector('h1'); assert.equal(heading.textContent, 'Offer accepted');
  assert.equal(document.activeElement, heading); assert.equal(heading.getAttribute('tabindex'), '-1');
  view.update({ ...acceptedModel(), now: '2026-11-06T12:00:00Z' }); assert.equal(document.activeElement, heading);
  view.update(pending); root.querySelector('[data-offer-action=accept]').focus(); view.update(acceptedModel());
  assert.notEqual(document.activeElement, root.querySelector('h1'));
  view.destroy(); root.remove();
});

test('GC-041: mountOffer shows the host navigation in the rail, and an empty rail without one', async () => {
  const { mountOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  const { signedInPortal, PORTAL_ROUTES } = await import('../../blocks/gcsp/offer/portal-links.js');
  const assigned = []; const location = { assign: (to) => assigned.push(to) };
  const read = async () => offerFixture('accepted');
  const signedIn = document.createElement('div'); document.body.append(signedIn);
  const portal = signedInPortal({ status: 'ready', name: 'Paula' }, location);
  const stop = mountOffer(signedIn, { read, account: { status: 'ready', name: 'Paula' }, ...portal });
  await new Promise((done) => setTimeout(done, 20));
  const items = [...signedIn.querySelectorAll('nav button[data-key]')];
  assert.deepEqual(items.map((node) => node.dataset.key), ['cars', 'brief', 'activity', 'order-progress']);
  assert.ok(items.every((node) => node.getAttribute('aria-disabled') !== 'true'));
  assert.equal(items.find((node) => node.dataset.key === 'activity').textContent.includes('Buddy activity'), true);
  for (const item of items) item.click();
  assert.deepEqual(assigned, [PORTAL_ROUTES.cars, PORTAL_ROUTES.brief, PORTAL_ROUTES.activity, PORTAL_ROUTES['order-progress']]);
  assert.equal(PORTAL_ROUTES.brief, '/gcsp-brief-live.html');
  assert.deepEqual([...signedIn.querySelectorAll('a.vm-btn')].map((a) => a.getAttribute('href')), [PORTAL_ROUTES['order-progress'], PORTAL_ROUTES.cars]);
  stop();
  assert.deepEqual(signedInPortal({ status: 'unavailable' }, location), {}); assert.deepEqual(signedInPortal(undefined, location), {});
  const anonymous = document.createElement('div'); document.body.append(anonymous);
  const stopAnonymous = mountOffer(anonymous, { read, account: { status: 'unavailable' }, ...signedInPortal({ status: 'unavailable' }, location) });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(anonymous.querySelectorAll('nav button[data-key]').length, 0); assert.equal(anonymous.querySelectorAll('a.vm-btn').length, 0); stopAnonymous();
});

test('FUCQ-286: every offer state has one h1 and its heading levels never skip', () => {
  for (const name of FIXTURE_NAMES) {
    const { root } = render(name);
    const levels = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
    assert.equal(levels.filter((level) => level === 1).length, 1, `${name}: ${levels}`);
    levels.forEach((level, i) => assert.ok(level <= (levels[i - 1] ?? 0) + 1, `${name} skips a level: ${levels}`));
  }
  assert.equal(render('pending').root.querySelector('.vm-card-name').tagName, 'H2');
});

test('FUCQ-383: five supplied benefits retain every card and both grounded winning columns', () => {
  const { root, view, data } = render('pending'); const member = data.card.members[0];
  member.terms[0].value = 295;
  data.currentCar.facts.find((row) => row.key === 'points').value = '320 points';
  data.currentCar.facts.find((row) => row.key === 'boot').value = '590 litres';
  member.decision.reasons = ['One', 'Two', 'Three', 'Four'].map((text) => ({ text })); member.decision.tradeOffs = [];
  view.update(data);
  assert.equal(root.querySelectorAll('.gcsp-highlight-benefits .gcsp-highlight').length, 5);
  assert.equal(root.querySelectorAll('.gcsp-highlight-tradeoffs .gcsp-highlight').length, 1);
  const winners = [...root.querySelectorAll('td.is-winner')];
  assert.deepEqual(winners.map((node) => node.textContent), ['590 litres', '295 points']);
  assert.equal(winners[0].cellIndex, 1); assert.equal(winners[1].cellIndex, 2);
  assert.equal(root.querySelectorAll('thead .is-winner').length, 0);
  assert.equal(root.querySelectorAll('.vm-card-decision .vm-reasons').length, 0);
});

test('FUCQ-383: ties, unknowns and preference-dependent rows stay neutral with honest empty groups', () => {
  const { root, view, data } = render('pending'); const member = data.card.members[0];
  member.decision.reasons = []; member.decision.tradeOffs = [];
  data.currentCar.facts.find((row) => row.key === 'boot').value = '500 litres';
  data.currentCar.facts.find((row) => row.key === 'points').value = '1,100 points';
  data.currentCar.facts.find((row) => row.key === 'fuel').value = 'Electric';
  view.update(data);
  assert.equal(root.querySelectorAll('.is-winner').length, 0);
  assert.match(root.textContent, /No benefits confirmed/); assert.match(root.textContent, /No tradeoffs confirmed/);
});

test('FUCQ-383: supplied finish prose remains readable and unsupported colours remain neutral', () => {
  const { root, view, data } = render('pending');
  data.card.members[0].facts = [{ label: 'Colour', value: 'Alpine White' }, { label: 'Interior', value: 'Black upholstery' }, { label: 'Scheme', value: 'Choices' }];
  view.update(data);
  assert.match(root.querySelector('.gcsp-vehicle-details').textContent, /Alpine White.*Black upholstery/);
  assert.equal(root.querySelectorAll('.gcsp-finish-swatch:not(.is-unknown)').length, 0);
  assert.doesNotMatch(root.querySelector('.vm-card').textContent, /Scheme|Choices|Order no\./);
});

test('FUCQ-383: drawer action hook cannot bypass controller declaration acceptance', async () => {
  const calls = []; const root = document.createElement('div'); document.body.append(root);
  const ctl = createOfferController({ read: async () => offerFixture('handoff-replacement'), decide: async () => { calls.push('submit'); }, readReasons: async () => ({ status: 'unavailable' }) });
  const view = createOfferView(root, { openDecision: (kind) => calls.push(kind) }); const unsubscribe = ctl.subscribe(view.update);
  await ctl.refresh(); assert.equal(ctl.snapshot().canAccept, false); assert.equal(ctl.snapshot().canReviewAccept, true);
  root.querySelector('[data-offer-action="accept"]').click(); assert.deepEqual(calls, ['accept']);
  await ctl.decision('accept'); assert.deepEqual(calls, ['accept']);
  unsubscribe(); ctl.destroy(); view.destroy();
});
