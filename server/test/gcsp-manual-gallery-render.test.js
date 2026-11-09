import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createManualGalleryFixture, createManualGalleryFixtureAdapter, MANUAL_GALLERY_FIXTURES } from '../../blocks/gcsp/manual-gallery/fixtures.js';
import { createManualClaimController, isConfirmedManualClaim } from '../../blocks/gcsp/manual-gallery/claim-controller.js';
import { createManualGalleryHttpAdapter } from '../../blocks/gcsp/manual-gallery/http-adapter.js';
import { toManualGallery } from '../../blocks/gcsp/manual-gallery/gallery-model.js';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://gallery.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
}
const { mountManualGallery, defineGcspManualGallery } = await import('../../blocks/gcsp/manual-gallery/gcsp-manual-gallery.js');
const waitFor = async (check) => {
  for (let i = 0; i < 200; i += 1) { if (check()) return; await new Promise((done) => setImmediate(done)); }
  assert.ok(check(), 'Expected gallery state was not reached');
};
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };
const selection = () => ({ ...toManualGallery(createManualGalleryFixture()).allCars[0].review, commandId: 'exact-attempt-1' });
function quoted(selected = selection()) {
  return { status: 'ok', value: { state: 'quoted', pendingOperation: null, now: '2026-11-05T12:00:00.000Z', clockVersion: 1,
    hold: { holdId: 'hold-1', quoteId: 'quote-1', orderUuid: selected.orderUuid, type: 'cart', state: 'active', version: 1,
      employeeId: 'employee-1', entitlementSlotId: 'slot-1', runId: 'run-1', expiresAt: '2026-11-05T12:10:00.000Z' },
    quote: { quoteId: 'quote-1', orderUuid: selected.orderUuid, configurationId: selected.configurationId, version: 1,
      employeeId: 'employee-1', entitlementSlotId: 'slot-1', runId: 'run-1', facts: selected.snapshot,
      draftVersion: selected.claimInput.expectedDraftVersion, eligibility: { stockVersion: 6,
        contextVersion: selected.claimInput.expectedContextVersion, termsDigest: selected.claimInput.expectedTermsDigest },
      validUntil: '2026-11-05T12:20:00.000Z' } } };
}
async function mount(t, options = {}) {
  const root = document.createElement('div'); document.body.append(root);
  const adapter = { ...createManualGalleryFixtureAdapter(), readOnly: false, ...options.adapter };
  const teardown = mountManualGallery(root, { commandId: () => 'exact-attempt-1', ...options, adapter });
  t.after(() => { teardown(); root.remove(); });
  await waitFor(() => root.querySelectorAll('.vm-card').length === 3 && teardown.claim.getState().state !== 'checking');
  return { root, teardown, adapter };
}
const click = (root, label) => [...root.querySelectorAll('button')].find((node) => node.textContent === label)?.click();
const chips = (root, name) => [...root.querySelectorAll(`[data-nav="${name}"] [role="radio"]`)];
function change(root, name, value) {
  if (['series', 'body'].includes(name)) {
    const chip = value ? chips(root, name).find((node) => node.querySelector('.vm-option-label').textContent === value) : chips(root, name)[0];
    chip.click(); return root.querySelector(`[data-nav="${name}"] [aria-checked="true"]`);
  }
  const node = root.querySelector(`[name="${name}"]`); node.value = value;
  node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return node;
}

test('native labelled filters keep focus and expose every exact car, allowance and independent counts', async (t) => {
  const f = await mount(t); assert.equal(f.root.querySelectorAll('main').length, 1);
  assert.equal(f.root.querySelector('h1').textContent, 'Released cars');
  assert.match(f.root.textContent, /3 released cars · 2 eligible · 3 matching · 2 eligible matching/);
  assert.match(f.root.textContent, /Your allowance: 1,300 points a month/);
  for (const name of ['query', 'sort']) {
    const control = f.root.querySelector(`[name="${name}"]`);
    assert.equal(f.root.querySelector(`label[for="${control.id}"]`).htmlFor, control.id);
  }
  for (const name of ['series', 'body']) {
    const group = f.root.querySelector(`[data-nav="${name}"]`); assert.equal(group.getAttribute('role'), 'radiogroup');
    assert.ok(document.getElementById(group.getAttribute('aria-labelledby')).textContent);
  }
  assert.deepEqual(chips(f.root, 'series').map((node) => node.textContent), ['All series3 cars', '3 Series2 cars', '5 Series1 car']);
  const search = f.root.querySelector('[name="query"]'); search.focus(); change(f.root, 'query', 'Technology Plus');
  assert.equal(document.activeElement, search); assert.equal(f.root.querySelector('[name="query"]'), search);
  assert.equal(f.root.querySelectorAll('.vm-card').length, 1);
  change(f.root, 'query', 'missing car'); assert.match(f.root.textContent, /No cars match these filters/);
  click(f.root, 'Clear filters'); assert.equal(f.root.querySelectorAll('.vm-card').length, 3);
  change(f.root, 'series', '5 Series'); assert.equal(f.root.querySelectorAll('.vm-card').length, 1);
  assert.ok(f.root.querySelector('[data-action-id="review-car"]').disabled);
  change(f.root, 'series', ''); change(f.root, 'sort', 'points');
  assert.equal(f.root.querySelectorAll('.vm-card').length, 3);
  assert.equal(f.root.querySelectorAll('.vm-score:not([hidden])').length, 0);
});

test('details preserve exact identity, separated reference facts, equipment and image provenance; Back restores focus', async (t) => {
  let posts = 0; const f = await mount(t, { adapter: { claim: async () => { posts += 1; return { status: 'pending' }; } } });
  const origin = f.root.querySelector('.vm-card [data-action-id="review-car"]').parentElement.querySelector('button:last-child');
  origin.focus(); origin.click();
  const detail = f.root.querySelector('.gcsp-gallery-detail'); assert.equal(detail.hidden, false);
  assert.equal(document.activeElement.tagName, 'H2'); assert.match(detail.textContent, /Order no. 4815161/);
  assert.match(detail.textContent, /Exact vehicle facts/); assert.match(detail.textContent, /Model reference facts/);
  assert.match(detail.textContent, /Configured equipment and options/); assert.match(detail.textContent, /Parking Assistant Plus/);
  assert.match(detail.textContent, /BMW brand image, not this car/); assert.match(detail.textContent, /fixture:manual-gallery:2026-11-05/);
  assert.match(detail.textContent, /NEDC \/ correlated CO2/); assert.match(detail.textContent, /WLTP CO2/);
  assert.match(detail.textContent, /Monthly scheme cost/); assert.equal(posts, 0);
  click(detail, 'Back to released cars'); assert.equal(document.activeElement, origin); assert.equal(detail.hidden, true);
});

test('image errors use the shared media fallback and long names remain whole', async (t) => {
  const f = await mount(t); const image = f.root.querySelector('.vm-card img'); assert.ok(image);
  image.dispatchEvent(new window.Event('error'));
  assert.match(f.root.textContent, /No image for this car yet/);
  assert.match(f.root.textContent, /BMW 330e M Sport Pro Edition Touring with Technology Plus and Comfort Pack/);
});

test('only one explicit Review posts issued claimInput; authoritative GET emits callback and bubbling event once', async (t) => {
  const post = deferred(); const read = deferred(); let reads = 0; const inputs = []; const callbacks = []; const events = [];
  const f = await mount(t, { onClaimConfirmed: (detail) => callbacks.push(detail), adapter: {
    readClaim: () => ++reads === 1 ? Promise.resolve({ status: 'not-found' }) : read.promise,
    claim: (input) => { inputs.push(input); return post.promise; } } });
  f.root.addEventListener('gcsp:manual-claim-confirmed', (event) => { assert.ok(event.bubbles && event.composed); events.push(event.detail); });
  const review = f.root.querySelector('[data-action-id="review-car"]'); const search = f.root.querySelector('[name="query"]');
  review.click(); review.click(); assert.equal(inputs.length, 1); assert.ok(review.disabled);
  assert.deepEqual(inputs[0], { commandId: 'exact-attempt-1', ...selection().claimInput });
  search.focus(); change(f.root, 'query', '320i'); assert.equal(document.activeElement, search);
  post.resolve(quoted()); await waitFor(() => reads === 2); assert.equal(callbacks.length, 0);
  read.resolve(quoted()); await waitFor(() => callbacks.length === 1);
  assert.equal(events.length, 1); assert.deepEqual(events[0], callbacks[0]);
  await f.teardown.claim.checkStatus(); assert.equal(callbacks.length, 1); assert.equal(inputs.length, 1);
});

test('pending or unavailable outcomes keep one attempt blocked and Check status never repeats POST', async () => {
  for (const receipt of [{ status: 'pending' }, { status: 'unavailable' }]) {
    let posts = 0; let reads = 0; const confirmed = [];
    const controller = createManualClaimController({ adapter: { readClaim: async () => ++reads === 1 ? { status: 'not-found' } : { status: 'pending' },
      claim: async () => { posts += 1; return receipt; } }, onConfirmed: (detail) => confirmed.push(detail) });
    await controller.load(); await controller.review(selection()); await controller.review({ ...selection(), commandId: 'other' }); await controller.checkStatus();
    assert.equal(posts, 1); assert.equal(controller.getState().commandId, 'exact-attempt-1'); assert.ok(controller.getState().blocked);
    assert.equal(confirmed.length, 0); controller.destroy();
  }
});

test('readback validates identity, pins, ownership alignment and server-authoritative expiry', () => {
  const selected = selection(); const current = quoted(selected); assert.equal(isConfirmedManualClaim(current, selected), true);
  const mutations = [
    (v) => { v.hold.orderUuid = 'other'; }, (v) => { v.quote.configurationId = 'other'; },
    (v) => { v.quote.quoteId = 'other'; }, (v) => { v.quote.employeeId = 'other'; }, (v) => { v.quote.entitlementSlotId = 'other'; },
    (v) => { v.quote.runId = 'other'; }, (v) => { v.quote.draftVersion += 1; },
    (v) => { v.quote.eligibility.contextVersion = 'other'; }, (v) => { v.quote.eligibility.termsDigest = 'other'; },
    (v) => { v.quote.facts.sourceKeys.stockId = 'other'; }, (v) => { v.hold.state = 'expired'; },
    (v) => { v.hold.expiresAt = v.now; }, (v) => { v.quote.validUntil = v.now; }, (v) => { v.pendingOperation = {}; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(current); mutate(changed.value); assert.equal(isConfirmedManualClaim(changed, selected), false); }
  const posted = quoted(); posted.value.hold.holdId = 'other'; assert.equal(isConfirmedManualClaim(current, selected, posted), false);
});

test('explicit failed-before-dispatch retry preserves command and input, and coalesces clicks', async () => {
  const retryPost = deferred(); const inputs = []; let reads = 0; let confirmed = 0;
  const controller = createManualClaimController({ adapter: { readClaim: async () => ++reads < 3 ? { status: 'not-found' } : quoted(),
    claim: (input) => { inputs.push(input); return inputs.length === 1 ? Promise.resolve({ status: 'unavailable' }) : retryPost.promise; } },
  onConfirmed: () => { confirmed += 1; } });
  await controller.load(); await controller.review(selection());
  assert.equal(controller.getState().state, 'retry-available'); assert.ok(controller.getState().blocked);
  await controller.review({ ...selection(), commandId: 'new-command' }); assert.equal(inputs.length, 1);
  const one = controller.retry(); const two = controller.retry(); assert.equal(one, two); assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[0], inputs[1]); retryPost.resolve(quoted()); await one; assert.equal(confirmed, 1); controller.destroy();
});

test('verified released, expired and claim-failed reads recover, but allocated and torn terminal state block', async () => {
  for (const terminal of ['released', 'expired', 'claim-failed', 'allocated', 'torn']) {
    const current = quoted(); current.value.state = terminal === 'torn' ? 'released' : terminal;
    current.value.hold.state = terminal === 'torn' ? 'active' : terminal; let released = 0;
    const controller = createManualClaimController({ adapter: { readClaim: async () => current }, onReleased: () => { released += 1; } });
    await controller.load(); const permitted = ['released', 'expired', 'claim-failed'].includes(terminal);
    assert.equal(controller.getState().blocked, !permitted, terminal); assert.equal(released, Number(permitted)); controller.destroy();
  }
});

test('an old terminal hold cannot clear a new uncertain attempt for the same car', async () => {
  const old = quoted(); old.value.state = 'released'; old.value.hold.state = 'released';
  old.value.hold.holdId = 'previous-hold'; old.value.hold.quoteId = 'previous-quote'; old.value.quote.quoteId = 'previous-quote';
  let released = 0; let confirmed = 0; const inputs = [];
  const controller = createManualClaimController({ adapter: { readClaim: async () => structuredClone(old),
    claim: async (input) => { inputs.push(input); return { status: 'unavailable' }; } },
  onReleased: () => { released += 1; }, onConfirmed: () => { confirmed += 1; } });
  await controller.load(); assert.equal(released, 1); await controller.review(selection());
  assert.equal(controller.getState().state, 'retry-available'); assert.ok(controller.getState().blocked);
  assert.equal(controller.getState().commandId, 'exact-attempt-1'); assert.equal(released, 1);
  await controller.review({ ...selection(), commandId: 'different-attempt' }); assert.equal(inputs.length, 1);
  await controller.retry(); assert.equal(inputs.length, 2); assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(released, 1); assert.equal(confirmed, 0); controller.destroy();
});

test('terminal readback tied to the issued receipt resolves that exact attempt', async () => {
  const ended = quoted(); ended.value.state = 'expired'; ended.value.hold.state = 'expired'; let reads = 0; let released = 0;
  const controller = createManualClaimController({ adapter: { readClaim: async () => ++reads === 1 ? { status: 'not-found' } : ended,
    claim: async () => quoted() }, onReleased: () => { released += 1; } });
  await controller.load(); await controller.review(selection()); assert.equal(released, 1);
  assert.equal(controller.getState().blocked, false); assert.equal(controller.getState().commandId, null); controller.destroy();
});

test('removed refreshed filter remains visibly selected and can be cleared without replacing its control', async (t) => {
  let next = createManualGalleryFixture(); const f = await mount(t, { adapter: { browseStock: async () => structuredClone(next) } });
  change(f.root, 'series', '5 Series').focus(); next.value.decisions = next.value.decisions.slice(0, 2);
  await f.teardown.gallery.refresh();
  const series = f.root.querySelector('[data-nav="series"] [aria-checked="true"]'); assert.equal(document.activeElement, series);
  assert.match(series.textContent, /5 Series \(not currently available\)0 cars/);
  assert.equal(f.teardown.gallery.getState().controls.series, '5 Series'); assert.match(f.root.textContent, /No cars match these filters/);
  click(f.root, 'Clear filters'); assert.match(f.root.querySelector('[data-nav="series"] [aria-checked="true"]').textContent, /^All series/);
  assert.equal(f.root.querySelectorAll('.vm-card').length, 2);
});

test('mismatched readback never confirms, while a definitive failed command permits fresh browse recovery', async () => {
  let reads = 0; let confirmed = 0; let failed;
  const wrong = quoted(); wrong.value.quote.configurationId = 'other';
  const controller = createManualClaimController({ adapter: { readClaim: async () => ++reads === 1 ? { status: 'not-found' } : wrong,
    claim: async () => quoted() }, onConfirmed: () => { confirmed += 1; } });
  await controller.load(); await controller.review(selection()); assert.equal(controller.getState().state, 'readback-mismatch'); assert.equal(confirmed, 0); controller.destroy();
  const recovery = createManualClaimController({ adapter: { readClaim: async () => ({ status: 'not-found' }), claim: async () => ({ status: 'conflict' }) }, onFailure: (result) => { failed = result; } });
  await recovery.load(); await recovery.review(selection()); assert.equal(failed.status, 'conflict'); assert.equal(recovery.getState().blocked, false); recovery.destroy();
});

test('reload exposes current claim without manufacturing command evidence or posting', async (t) => {
  let posts = 0; let confirmed = 0; const f = await mount(t, { onClaimConfirmed: () => { confirmed += 1; }, adapter: {
    readClaim: async () => quoted(), claim: async () => { posts += 1; return quoted(); } } });
  assert.equal(f.teardown.claim.getState().state, 'existing-claim'); assert.equal(f.teardown.claim.getState().commandId, null);
  assert.match(f.root.textContent, /already have a current reservation/);
  assert.ok([...f.root.querySelectorAll('[data-action-id="review-car"]')].every((node) => node.disabled));
  click(f.root, 'Check status'); await waitFor(() => f.teardown.claim.getState().state === 'existing-claim'); assert.equal(posts, 0); assert.equal(confirmed, 0);
});

test('destroy aborts in-flight authority and suppresses late confirmed callbacks', async () => {
  const pending = deferred(); let signal; let confirmed = 0;
  const controller = createManualClaimController({ adapter: { readClaim: ({ signal: request }) => { signal = request; return pending.promise; } }, onConfirmed: () => { confirmed += 1; } });
  const operation = controller.load(); controller.destroy(); assert.ok(signal.aborted); pending.resolve(quoted()); await operation; assert.equal(confirmed, 0);
});

test('every authored recovery fixture renders a distinct state and Back notifies the host', async (t) => {
  for (const name of MANUAL_GALLERY_FIXTURES.filter((value) => value !== 'available')) {
    const root = document.createElement('div'); document.body.append(root); let back = 0;
    const teardown = mountManualGallery(root, { adapter: createManualGalleryFixtureAdapter(name), onBack: () => { back += 1; } });
    t.after(() => { teardown(); root.remove(); });
    await waitFor(() => !['idle', 'loading'].includes(teardown.gallery.getState().state));
    const expected = { 'empty-stock': 'No cars are available', 'nothing-released-yet': 'No cars have been released yet',
      'no-suitable-stock': 'No suitable cars are available', 'source-unavailable': 'Availability cannot be checked right now',
      'context-refresh': 'Your choices need refreshing', 'car-taken': 'This car is no longer available' };
    assert.ok(root.textContent.includes(expected[name]), name); click(root, 'Back to your choices'); assert.equal(back, 1);
  }
});

test('HTTP adapter composes authenticated GET stock and claim GET/POST without changing issued input', async () => {
  const calls = []; const adapter = createManualGalleryHttpAdapter({ fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ status: 'not-found' }) }; } });
  await adapter.browseStock(); await adapter.readClaim(); const input = { commandId: 'issued', ...selection().claimInput }; await adapter.claim(input);
  assert.deepEqual(calls.map((row) => [row.url, row.options.method]), [['/api/gcsp/manual/stock', 'GET'], ['/api/gcsp/manual/claim', 'GET'], ['/api/gcsp/manual/claim', 'POST']]);
  assert.ok(calls.every((row) => row.options.credentials === 'include')); assert.deepEqual(JSON.parse(calls[2].options.body), input);
});

test('new harness is external-module-only and registered custom element tears down its shell', async () => {
  const html = await readFile(new URL('../../gcsp-manual-gallery.html', import.meta.url), 'utf8'); const parsed = new JSDOM(html).window.document;
  assert.equal(parsed.querySelectorAll('gcsp-manual-gallery').length, 1);
  assert.equal(parsed.querySelector('script').getAttribute('src'), './blocks/gcsp/manual-gallery/harness.js');
  assert.ok([...parsed.querySelectorAll('script')].every((node) => node.type === 'module' && node.src && !node.textContent.trim()));
  assert.ok([...parsed.querySelectorAll('*')].every((node) => [...node.attributes].every((attr) => !/^on/i.test(attr.name))));
  for (const file of ['gcsp-manual-gallery.js', 'harness.js', 'http-adapter.js', 'claim-controller.js', 'fixtures.js']) {
    const source = await readFile(new URL(`../../blocks/gcsp/manual-gallery/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(|set(?:Timeout|Interval)\s*\(\s*['"`]|\.innerHTML\s*=/);
  }
  defineGcspManualGallery(); const node = document.createElement('gcsp-manual-gallery'); node.adapter = createManualGalleryFixtureAdapter(); document.body.append(node);
  await waitFor(() => node.querySelectorAll('.vm-card').length === 3); assert.ok(node.claimState); node.remove(); assert.equal(node.querySelector('main'), null);
});

test('cards lead with points and allowance fit, keep key facts concise, and chips navigate by keyboard', async (t) => {
  const f = await mount(t); const [first, , third] = f.root.querySelectorAll('.vm-card');
  assert.match(first.querySelector('.vm-card-terms').textContent, /^1,100 points a monthWithin your allowance, 200 points left$/);
  assert.match(third.querySelector('.vm-card-terms').textContent, /100 points over your allowance/);
  assert.deepEqual([...first.querySelectorAll('.vm-fact-label, dt')].map((node) => node.textContent).filter(Boolean).slice(0, 6),
    ['Engine', 'Exterior', 'Interior', 'Transmission', 'Earliest collection', 'WLTP CO2']);
  assert.doesNotMatch(first.textContent, /Insurance group/);
  const series = chips(f.root, 'series'); series[0].focus();
  series[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(document.activeElement.getAttribute('aria-checked'), 'true'); assert.match(document.activeElement.textContent, /^3 Series/);
  assert.equal(f.root.querySelectorAll('.vm-card').length, 2);
  first.querySelector('[data-action-id="review-car"]').parentElement.querySelector('button:last-child').click();
  const detail = f.root.querySelector('.gcsp-gallery-detail');
  for (const label of ['Insurance group', 'NEDC / correlated CO2', 'Body style', 'Available allowance', 'Scheme contribution']) assert.match(detail.textContent, new RegExp(label));
  assert.match(detail.textContent, /Within your allowance, 200 points left/);
});

test('a saved date the server now refuses offers Back to your choices, never a dead Refresh (FUCQ-222)', async (t) => {
  const root = document.createElement('div'); document.body.append(root); let back = 0; let reads = 0;
  const invalid = { status: 'invalid', code: 'invalid-manual-draft', reasons: [{ field: 'requestedCollectionDate', reason: 'Choose a date inside the supplied collection and renewal window.' }] };
  const teardown = mountManualGallery(root, { adapter: { ...createManualGalleryFixtureAdapter(), browseStock: async () => { reads += 1; return structuredClone(invalid); } }, onBack: () => { back += 1; } });
  t.after(() => { teardown(); root.remove(); });
  await waitFor(() => teardown.gallery.getState().state === 'choices-invalid');
  const status = root.querySelector('.gcsp-gallery-results');
  assert.match(status.textContent, /Your saved choices need updating/); assert.match(status.textContent, /pick a new date/);
  const buttons = [...status.querySelectorAll('button')].map((node) => node.textContent);
  assert.deepEqual(buttons, ['Back to your choices']); assert.equal(reads, 1);
  const recover = status.querySelector('button'); recover.focus(); teardown.gallery.setControls({ query: 'x' });
  assert.equal(recover.isConnected, true); assert.equal(document.activeElement, recover); // a re-render keeps focus
  recover.click(); assert.equal(back, 1);
});
