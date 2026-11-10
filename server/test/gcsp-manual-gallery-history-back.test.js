// Component boundary only: typed release-history fixtures, no stock producer or host acceptance.
// Execute only through the separately reviewed, exact-source history/back supervisor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { toManualGallery } from '../../blocks/gcsp/manual-gallery/gallery-model.js';
import { createManualGalleryFixture, createManualGalleryFixtureAdapter } from '../../blocks/gcsp/manual-gallery/fixtures.js';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://gallery.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
}
const { mountManualGallery } = await import('../../blocks/gcsp/manual-gallery/gcsp-manual-gallery.js');
test.after(() => window.close());
const copy = (value) => structuredClone(value);
const history = (state = 'released') => ({ runId: 'TEST-history-run', observedAt: '2026-11-05T12:00:00.000Z',
  history: state === 'none-visible'
    ? { state, releasedCarCount: 0, releaseCount: 0, latestReleasedAt: null, sourceVersions: [] }
    : { state, releasedCarCount: 5, releaseCount: 2, latestReleasedAt: '2026-11-05T11:00:00.000Z', sourceVersions: ['TEST-release-v1'] },
  source: { state: 'current-version-unknown' } });
const withHistory = (input = createManualGalleryFixture(), value = history()) => ({ ...copy(input),
  value: { ...copy(input.value), releaseHistory: value } });
const waitFor = async (check) => {
  for (let i = 0; i < 200; i += 1) { if (check()) return; await new Promise((done) => setImmediate(done)); }
  assert.ok(check(), 'Expected component state was not reached');
};
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };
const button = (root, label) => [...root.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
async function mount(t, { envelope = withHistory(), ...options } = {}) {
  const root = document.createElement('div'); document.body.append(root);
  const adapter = { ...createManualGalleryFixtureAdapter(), readOnly: false, browseStock: async () => copy(envelope), ...options.adapter };
  const teardown = mountManualGallery(root, { ...options, adapter, commandId: () => 'TEST-history-back-attempt' });
  t.after(() => { teardown(); root.remove(); });
  await waitFor(() => !['idle', 'loading'].includes(teardown.gallery.getState().state));
  return { root, teardown };
}
function quoted() {
  const selected = toManualGallery(createManualGalleryFixture()).allCars[0].review;
  return { status: 'ok', value: { state: 'quoted', pendingOperation: null, now: '2026-11-05T12:00:00.000Z', clockVersion: 1,
    hold: { holdId: 'TEST-hold', quoteId: 'TEST-quote', orderUuid: selected.orderUuid, type: 'cart', state: 'active', version: 1,
      employeeId: 'TEST-employee', entitlementSlotId: 'TEST-slot', runId: 'TEST-history-run', expiresAt: '2026-11-05T12:10:00.000Z' },
    quote: { quoteId: 'TEST-quote', orderUuid: selected.orderUuid, configurationId: selected.configurationId, version: 1,
      employeeId: 'TEST-employee', entitlementSlotId: 'TEST-slot', runId: 'TEST-history-run', facts: selected.snapshot,
      draftVersion: selected.claimInput.expectedDraftVersion, eligibility: { stockVersion: selected.claimInput.expectedStockVersion,
        contextVersion: selected.claimInput.expectedContextVersion, termsDigest: selected.claimInput.expectedTermsDigest },
      validUntil: '2026-11-05T12:20:00.000Z' } } };
}

test('visible release history survives filters and current ineligibility without changing exact selections', () => {
  const input = withHistory(); const before = copy(input); const baseline = toManualGallery(createManualGalleryFixture());
  const result = toManualGallery(input);
  assert.deepEqual(result.allCars, baseline.allCars); assert.deepEqual(result.releaseHistory, input.value.releaseHistory);
  const filtered = toManualGallery(input, { query: 'no matching car' });
  assert.equal(filtered.state, 'empty-search'); assert.equal(filtered.cars.length, 0);
  assert.deepEqual(filtered.releaseHistory, input.value.releaseHistory);
  const excluded = copy(input); excluded.value.decisions.forEach((car) => { car.gateStatus = 'ineligible'; car.claimInput = null; });
  assert.equal(toManualGallery(excluded).state, 'no-suitable-stock');
  assert.deepEqual(toManualGallery(excluded).releaseHistory, input.value.releaseHistory);
  const empty = toManualGallery(withHistory(createManualGalleryFixture('empty-stock')));
  assert.equal(empty.state, 'empty-stock'); assert.equal(empty.releaseHistory.history.releasedCarCount, 5);
  result.releaseHistory.history.sourceVersions.push('local-change');
  assert.deepEqual(input, before); assert.equal(result.browsingReservesStock, false);
});

test('none-visible stays employee-relative and missing or invalid history never becomes a zero-history fact', () => {
  const empty = createManualGalleryFixture('empty-stock');
  assert.equal(toManualGallery(empty).state, 'empty-stock'); assert.equal(toManualGallery(empty).releaseHistory, null);
  const none = toManualGallery(withHistory(empty, history('none-visible')));
  assert.equal(none.state, 'no-visible-releases'); assert.equal(none.releaseHistory.source.state, 'current-version-unknown');
  assert.equal(toManualGallery(withHistory(createManualGalleryFixture('nothing-released-yet'), history('none-visible'))).state, 'no-visible-releases');
  const invalid = [null, {}, { ...history(), source: { state: 'healthy' } },
    { ...history(), runId: '' }, { ...history(), history: { ...history().history, releaseCount: -1 } },
    { ...history(), history: { ...history().history, latestReleasedAt: '2026-11-06T12:00:00.000Z' } },
    { ...history('none-visible'), history: { ...history('none-visible').history, releasedCarCount: 1 } },
    { ...history(), history: { ...history().history, sourceVersions: ['same', 'same'] } }];
  for (const value of invalid) {
    const result = toManualGallery(withHistory(empty, value));
    assert.equal(result.state, 'source-unavailable'); assert.equal(result.releaseHistory, null); assert.deepEqual(result.allCars, []);
  }
  const wrongRun = withHistory(empty); wrongRun.value.runId = 'other-run';
  assert.equal(toManualGallery(wrongRun).state, 'source-unavailable');
  const refused = toManualGallery({ status: 'unavailable', reason: 'Confirmed release history is unavailable.' });
  assert.equal(refused.state, 'source-unavailable'); assert.equal(refused.releaseHistory, null);
});

test('rendered history shows visible past releases and unknown current version independently of search', async (t) => {
  const f = await mount(t); const region = f.root.querySelector('[aria-label="Release history"]');
  assert.equal(region.hidden, false); assert.match(region.textContent, /5 cars in 2 releases visible to you/);
  assert.match(region.textContent, /Latest visible release:.*UTC\./);
  assert.doesNotMatch(region.textContent, /source version|unknown/i);
  const text = region.textContent;
  f.teardown.gallery.setControls({ query: 'no matching car' });
  assert.match(f.root.textContent, /No cars match these filters/); assert.equal(region.textContent, text);
  const none = await mount(t, { envelope: withHistory(createManualGalleryFixture('empty-stock'), history('none-visible')) });
  assert.match(none.root.textContent, /No released cars are visible to you yet/);
  assert.doesNotMatch(none.root.textContent, /No cars have been released yet|first release|source is healthy/);
  const absent = await mount(t, { envelope: createManualGalleryFixture('empty-stock') });
  assert.equal(absent.root.querySelector('[aria-label="Release history"]').hidden, true);
});

test('Back stays visible explained and guarded through claim checks until the matching terminal read', async (t) => {
  const initial = deferred(); const post = deferred(); const pending = deferred();
  const receipt = quoted(); const terminal = copy(receipt);
  terminal.value.state = 'released'; terminal.value.hold.state = 'released'; terminal.value.hold.version = 2;
  let reads = 0; let posts = 0; let backs = 0; let events = 0;
  const f = await mount(t, { onBack() { backs += 1; }, adapter: {
    readClaim: () => ++reads === 1 ? initial.promise : reads === 2 ? pending.promise
      : Promise.resolve(reads === 3 ? { status: 'unavailable' } : terminal),
    claim: () => { posts += 1; return post.promise; } } });
  f.root.addEventListener('gcsp:manual-gallery-back', () => { events += 1; });
  const back = button(f.root, 'Back to your choices'); const reason = document.getElementById(back.getAttribute('aria-describedby'));
  assert.equal(back.hidden, false); assert.equal(back.disabled, true); assert.equal(reason.hidden, false);
  assert.match(reason.textContent, /Wait for the reservation check/);
  back.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); assert.equal(backs, 0); assert.equal(events, 0);
  initial.resolve({ status: 'not-found' }); await waitFor(() => !back.disabled);
  back.click(); assert.equal(backs, 1); assert.equal(events, 1); assert.equal(reason.hidden, true);
  button(f.root, 'Review this car').click(); assert.equal(posts, 1); assert.equal(back.disabled, true);
  back.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); assert.equal(backs, 1);
  post.resolve(receipt); await waitFor(() => reads === 2); assert.equal(back.disabled, true);
  pending.resolve({ status: 'pending' }); await waitFor(() => f.teardown.claim.getState().state === 'pending');
  assert.equal(reason.hidden, false); assert.match(reason.textContent, /Resolve your current reservation/);
  await f.teardown.claim.checkStatus(); assert.equal(f.teardown.claim.getState().state, 'uncertain'); assert.equal(back.disabled, true);
  await f.teardown.claim.checkStatus(); await waitFor(() => !back.disabled);
  assert.equal(f.teardown.claim.getState().state, 'released'); assert.equal(reason.hidden, true); assert.equal(posts, 1);
  back.click(); assert.equal(backs, 2); assert.equal(events, 2);
  const readOnly = await mount(t, { adapter: { readOnly: true, readClaim: async () => ({ status: 'pending' }) } });
  assert.equal(button(readOnly.root, 'Back to your choices').disabled, false);
});
