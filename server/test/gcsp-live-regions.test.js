// FUCQ-285: each GCSP view announces through at most one live region, and the kit parts are not live.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://live-regions.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
}
const { createManualGalleryFixture, createManualGalleryFixtureAdapter } = await import('../../blocks/gcsp/manual-gallery/fixtures.js');
const { toManualGallery } = await import('../../blocks/gcsp/manual-gallery/gallery-model.js');
const { mountManualGallery } = await import('../../blocks/gcsp/manual-gallery/gcsp-manual-gallery.js');
const { fixtureAdapter: helpFixture } = await import('../../blocks/gcsp/cases/fixtures.js');
const { mountHelpBody } = await import('../../blocks/gcsp/cases/gcsp-help.js');
const { mountPresenterControls } = await import('../../blocks/gcsp/presenter-controls/controls.js');

const LIVE = '[aria-live]:not([aria-live="off"]),[role=status],[role=alert],[role=log],output';
const regions = (root) => [...root.querySelectorAll(LIVE)].filter((node) => !node.closest('.gcsp-presenter-controls, header'));
const assertQuiet = (root, label, max = 1) => assert.ok(regions(root).length <= max,
  `${label}: ${regions(root).length} live regions: ${regions(root).map((n) => `${n.tagName.toLowerCase()}.${n.className}`).join(', ')}`);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const waitFor = async (check) => {
  for (let i = 0; i < 200; i += 1) { if (check()) return; await settle(); }
  assert.ok(check(), 'Expected state was not reached');
};
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

// FUCQ-285 slice 2: help and the presenter strip.
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitMs = async (check) => { for (let i = 0; i < 100 && !check(); i += 1) await pause(10); assert.ok(check(), 'Expected state was not reached'); };
const click = (scope, label) => { const node = [...scope.querySelectorAll('button')].find((b) => b.textContent === label || b.textContent.startsWith(`${label} (`)); assert.ok(node, label); node.click(); return node; };

test('help standalone keeps one live region in every state', async () => {
  for (const name of ['none', 'unavailable', 'loading', 'request']) {
    const host = root(); const stop = mountHelpBody(host, { adapter: helpFixture(name) }); await settle(); await settle();
    assertQuiet(host, `help ${name}`); stop(); host.remove();
  }
});

test('help given an announce option makes no region of its own', async (t) => {
  const host = root(); const said = []; t.after(mountHelpBody(host, { adapter: helpFixture('unavailable'), announce: (text) => said.push(text) }));
  await waitFor(() => said.length > 0); assert.equal(regions(host).length, 0); assert.ok(said.some((text) => /unavailable|could not/i.test(text)), said.join());
});

test('presenter success text clears after a short delay and failures stay', async (t) => {
  const host = root(); const ok = (value) => ({ status: 'ok', value });
  const adapter = { readControls: async () => ok({ runId: 'run-a', runVersion: 1, now: '2026-11-05T09:00:00.000Z', clockVersion: '1',
      principals: [{ principalId: 'p1', name: 'P one', roles: ['employee'] }], controls: { step: { value: 37, unit: 'seconds' }, namedTimes: {}, nextRelease: { status: 'unavailable' } } }),
    readContext: async () => ok({ principalId: 'p1', name: 'P one', roles: ['employee'] }), readScenarios: async () => ok({ policyVersion: 'p', scenarios: [] }),
    tick: async () => (fail ? { status: 'unavailable', reason: 'No clock.' } : ok({})) };
  let fail = false; let ids = 0;
  const controls = mountPresenterControls(host, { adapter, commandId: () => `c-${++ids}`, clearAfter: 25 }); t.after(() => controls.destroy());
  const message = () => host.querySelector('.gcsp-presenter-controls .gcsp-note[role=status]');
  await waitMs(() => message().textContent === 'Presenter controls ready');
  await waitMs(() => message().textContent === ''); click(host, 'Tick');
  await waitMs(() => message().textContent === 'Action recorded'); assert.equal(message().textContent, 'Action recorded');
  await waitMs(() => message().textContent === ''); fail = true; click(host, 'Tick');
  await waitMs(() => /Action not completed/.test(message().textContent)); await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(message().textContent, /Action not completed/);
});
