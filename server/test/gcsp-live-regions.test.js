// FUCQ-285: each GCSP view announces through at most one live region, and the kit parts are not live.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://live-regions.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
}
const { createManualGalleryFixture, createManualGalleryFixtureAdapter } = await import('../../blocks/gcsp/manual-gallery/fixtures.js');
const { toManualGallery } = await import('../../blocks/gcsp/manual-gallery/gallery-model.js');
const { mountManualGallery } = await import('../../blocks/gcsp/manual-gallery/gcsp-manual-gallery.js');
const { mountBriefBody } = await import('../../blocks/gcsp/brief/brief-view.js');
const { createOfferView } = await import('../../blocks/gcsp/offer/offer-view.js');
const { offerFixture } = await import('../../blocks/gcsp/offer/fixtures.js');
const { toOfferPresentation } = await import('../../blocks/gcsp/offer/offer-projection.js');
const { createFollowupView } = await import('../../blocks/gcsp/offer-followup/followup-view.js');
const { mountFollowupBody } = await import('../../blocks/gcsp/offer-followup/gcsp-offer-followup.js');

const LIVE = '[aria-live]:not([aria-live="off"]),[role=status],[role=alert],[role=log],output';
const regions = (root) => [...root.querySelectorAll(LIVE)].filter((node) => !node.closest('.gcsp-presenter-controls, header'));
const assertQuiet = (root, label, max = 1) => assert.ok(regions(root).length <= max,
  `${label}: ${regions(root).length} live regions: ${regions(root).map((n) => `${n.tagName.toLowerCase()}.${n.className}`).join(', ')}`);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const waitFor = async (check) => {
  for (let i = 0; i < 200; i += 1) { if (check()) return; await settle(); }
  assert.ok(check(), 'Expected state was not reached');
};
const briefFixture = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq94/representative-snapshot.json', import.meta.url)));
const access = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json', import.meta.url)));
const handle = { decisionId: `offer-decision:${'a'.repeat(64)}` };
const declined = () => toOfferPresentation({ status: 'ok', value: { ...structuredClone(access), state: 'declined', reason: 'declined',
  offerState: 'rejected', holdState: 'released', availableActions: [], followup: structuredClone(handle) } }).value;
const root = () => { const node = document.createElement('div'); document.body.append(node); return node; };
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());

function manyCars(total) {
  const envelope = createManualGalleryFixture(); const base = envelope.value.decisions[0];
  envelope.value.decisions = Array.from({ length: total }, (_, index) => {
    const car = structuredClone(base); const id = `live-stock-${String(index).padStart(2, '0')}`;
    car.orderUuid = id; car.orderNumber = `91${String(index).padStart(5, '0')}`; car.configurationId = `live-config-${index}`;
    car.candidateKey = `fixture:${id}`; car.snapshot.sourceKeys = { stockId: id }; car.snapshot.display.name = `BMW Live ${String(index).padStart(2, '0')}`;
    car.claimInput.orderUuid = id; return car;
  });
  return envelope;
}
function quoted(selected) {
  return { status: 'ok', value: { state: 'quoted', pendingOperation: null, now: '2026-11-05T12:00:00.000Z', clockVersion: 1,
    hold: { holdId: 'hold-1', quoteId: 'quote-1', orderUuid: selected.orderUuid, type: 'cart', state: 'active', version: 1,
      employeeId: 'employee-1', entitlementSlotId: 'slot-1', runId: 'run-1', expiresAt: '2026-11-05T12:10:00.000Z' },
    quote: { quoteId: 'quote-1', orderUuid: selected.orderUuid, configurationId: selected.configurationId, version: 1,
      employeeId: 'employee-1', entitlementSlotId: 'slot-1', runId: 'run-1', facts: selected.snapshot,
      draftVersion: selected.claimInput.expectedDraftVersion, eligibility: { stockVersion: 6,
        contextVersion: selected.claimInput.expectedContextVersion, termsDigest: selected.claimInput.expectedTermsDigest },
      validUntil: '2026-11-05T12:20:00.000Z' } } };
}
const noDecisionLive = (scope) => assert.equal(scope.querySelectorAll('.vm-card-decision[aria-live]').length, 0, 'card decisions are plain text');
const noOutputs = (scope) => assert.equal(scope.querySelectorAll('output').length, 0, 'slider readouts are not output elements');

test('gallery with released cars and paging has one live region that stays quiet on first paint', async (t) => {
  const host = root(); const adapter = { ...createManualGalleryFixtureAdapter(), browseStock: async () => manyCars(20) };
  const teardown = mountManualGallery(host, { adapter }); t.after(teardown);
  await waitFor(() => host.querySelectorAll('.vm-card').length > 0);
  assertQuiet(host, 'gallery first paint'); noDecisionLive(host);
  const status = host.querySelector('.gcsp-gallery-body [role=status]'); assert.ok(status, 'the gallery has its one status region');
  assert.equal(status.textContent, '');
  host.querySelector('.gcsp-show-more button').click();
  assert.equal(host.querySelector('.gcsp-show-more-count').textContent, 'Showing 12 of 20 cars');
  assert.equal(status.textContent, 'Showing 12 of 20 cars'); assertQuiet(host, 'gallery after show more');
  const search = host.querySelector('[name="query"]'); search.value = 'Live 03'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(status.textContent, /1 matching/); assertQuiet(host, 'gallery after filtering');
});

test('gallery announces the reservation outcome through the same single region', async (t) => {
  const host = root(); const selected = toManualGallery(createManualGalleryFixture()).allCars[0].review; let reads = 0;
  const adapter = { ...createManualGalleryFixtureAdapter(), readOnly: false, readClaim: async () => (++reads === 1 ? { status: 'not-found' } : quoted(selected)),
    claim: async () => quoted(selected) };
  const teardown = mountManualGallery(host, { adapter, commandId: () => 'live-attempt-1' }); t.after(teardown);
  await waitFor(() => host.querySelectorAll('.vm-card').length === 3 && teardown.claim.getState().state !== 'checking');
  const status = host.querySelector('.gcsp-gallery-body [role=status]'); assert.equal(status.textContent, '');
  host.querySelector('[data-action-id="review-car"]').click();
  await waitFor(() => host.querySelector('.gcsp-gallery-claim p').textContent === 'Your car is reserved for review.');
  assert.equal(status.textContent, 'Your car is reserved for review.');
  assertQuiet(host, 'gallery after reserving'); noDecisionLive(host);
});

test('brief has one live region, plain eligibility and slider readouts hidden from assistive technology', async (t) => {
  const main = document.createElement('main'); document.body.append(main);
  const teardown = mountBriefBody(main, { editor: briefFixture.edited.value, transport: { preview: async () => briefFixture.preview,
    saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }) } }); t.after(teardown);
  await new Promise((resolve) => setTimeout(resolve, 340));
  assert.ok(main.querySelectorAll('.vm-card').length > 0);
  assertQuiet(main, 'brief editable'); noDecisionLive(main); noOutputs(main);
  const readouts = main.querySelectorAll('.vm-slider-value'); assert.ok(readouts.length >= 10);
  for (const readout of readouts) assert.equal(readout.getAttribute('aria-hidden'), 'true');
  assert.ok(main.querySelector('input[type=range][aria-valuetext]'));
});

test('read-only brief has no more than one live region', (t) => {
  const main = document.createElement('main'); document.body.append(main);
  const editor = { ...structuredClone(briefFixture.edited.value), selection: { state: 'accepted', briefVersion: 1 } };
  t.after(mountBriefBody(main, { editor, transport: {} }));
  assert.match(main.textContent, /This is your saved brief\. It is read only\./); assertQuiet(main, 'brief read-only');
});

test('pending offer stays quiet on first paint and has one region that never repeats the heading', () => {
  const host = root(); const view = createOfferView(host, {});
  view.update({ ...offerFixture('pending').value, canAccept: true, canDecline: true, countdown: '2 hours remaining' });
  assertQuiet(host, 'offer pending'); noDecisionLive(host);
  const status = host.querySelector('[data-offer-announcement]'); assert.ok(status);
  assert.notEqual(status.textContent, host.querySelector('h1').textContent); assert.equal(status.textContent, '');
  view.update({ ...offerFixture('accepted').value, canAccept: false, canDecline: false });
  assert.equal(status.textContent, host.querySelector('h1').textContent); assertQuiet(host, 'offer after a state change'); view.destroy();
});

test('offer with a follow-up saved change announces through the offer alone', async () => {
  const host = root(); let followup;
  const view = createOfferView(host, { mountFollowup: (target, input) => {
    followup = createFollowupView(target, { hostRefresh: true, headingLevel: 2, announce: input.announce });
    followup.update({ state: 'change-saved', busy: false, savedChange: { briefVersion: 3 }, error: '' });
    return () => followup.destroy();
  } });
  view.update(declined()); await settle();
  assert.ok(host.querySelector('[data-offer-followup] .gcsp-followup'));
  assertQuiet(host, 'offer with saved change');
  assert.equal(host.querySelector('[data-offer-announcement]').textContent, 'Change saved'); view.destroy();
});

test('offer with the follow-up question mounted has one live region', async () => {
  const host = root();
  const transport = { confirm: async () => ({ status: 'unavailable' }), read: async () => ({ status: 'ok', value: {
    schemaVersion: 1, state: 'question', decisionId: handle.decisionId, briefVersion: 2, question: { schemaVersion: 1, questionVersion: 'q1',
      policyVersion: 'p1', reasonCode: 'body-style', path: 'preferences.body.value', prompt: 'Which body style would you prefer?', currentValue: 'estate',
      control: { kind: 'options', options: ['estate', 'suv'].map((value) => ({ value, label: value })) } } } }) };
  const view = createOfferView(host, { mountFollowup: (target, input) => mountFollowupBody(target, { ...input, hostRefresh: true, headingLevel: 2, transport }) });
  view.update(declined()); await settle(); await settle();
  assert.ok(host.querySelector('[data-offer-followup] fieldset')); assertQuiet(host, 'offer with follow-up question'); noOutputs(host); view.destroy();
});

test('standalone follow-up keeps exactly one region in every state', () => {
  const question = (kind) => ({ state: 'question', busy: false, canConfirm: false, error: '', savedChange: null, value: kind === 'slider' ? 50 : 'saloon',
    question: { schemaVersion: 1, questionVersion: 'q1', prompt: 'What would you change?', currentValue: 'saloon',
      control: kind === 'slider' ? { kind, minimum: 0, maximum: 100, unit: 'percent' } : { kind, options: [{ value: 'saloon', label: 'Saloon' }] } } });
  for (const model of [question('options'), question('slider'), { ...question('options'), error: 'Choose another answer.' },
    { state: 'change-saved', busy: false, savedChange: { briefVersion: 2 }, error: '' }, { state: 'waiting', busy: false, savedChange: null, error: '' }]) {
    const host = root(); const view = createFollowupView(host, {}); view.update(model);
    assert.equal(regions(host).length, 1, `${model.state}${model.error ? ' with error' : ''}`); noOutputs(host); view.destroy(); host.remove();
  }
});
