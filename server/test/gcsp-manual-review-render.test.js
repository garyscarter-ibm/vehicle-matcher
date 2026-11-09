import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://review.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
}
const { mountManualReviewBody, mountManualReview, defineGcspManualReview } = await import('../../blocks/gcsp/manual-review/gcsp-manual-review.js');
const seed = JSON.parse(readFileSync(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const assumption = (key) => structuredClone(seed.assumptions.find((entry) => entry.key === key));
const rules = assumption('manual.context.v1');
const timing = { preview: assumption('hold.cart.durationSeconds').value, review: assumption('hold.cart.orderReview.durationSeconds').value };
const now = '2026-11-05T12:00:00.000Z';
const later = (seconds) => new Date(Date.parse(now) + seconds * 1000).toISOString();
const ok = (value) => ({ status: 'ok', contractVersion: '1.0.0', value: structuredClone(value) });
const settle = async (check) => { for (let i = 0; i < 100; i += 1) { if (check()) return; await new Promise(setImmediate); } assert.ok(check()); };
function setup(t, options = {}) {
  // Deliberate HTTP/service-boundary doubles. These prove DOM behavior, not live FUCQ-66/71 integration.
  const hold = { runId: 'run', employeeId: 'employee', entitlementSlotId: 'slot', holdId: 'hold', quoteId: 'quote', orderUuid: 'stock',
    type: 'cart', state: 'active', phase: 'preview', version: 1, policyVersion: seed.policyVersion, expiresAt: later(timing.preview) };
  const quote = { runId: 'run', employeeId: 'employee', entitlementSlotId: 'slot', quoteId: 'quote', orderUuid: 'stock',
    configurationId: 'configuration', version: 1, policyVersion: seed.policyVersion, draftVersion: 1, validUntil: later(timing.review * 2), eligibility: { timing },
    facts: { identityKind: 'exact-stock', sourceKeys: { stockId: 'stock' }, display: { name: 'BMW 320i M Sport Touring with Individual extended leather and comfort specification' },
      facts: { model: { status: 'known', value: 'BMW 320i' }, transmission: { status: 'unknown', value: null },
        wltpCo2: { status: 'known', value: { value: 140, unit: 'g/km', basis: 'WLTP' } } } },
    terms: { kind: 'employee-scheme', points: { value: 1100, unit: 'points' }, allowanceInputs: { allowance: { value: 1300, unit: 'points' } } } };
  const model = { binding: { runId: 'run', employeeId: 'employee', entitlementSlotId: 'slot', holdId: 'hold', quoteId: 'quote', expectedHoldVersion: 1, expectedDraftVersion: 1 },
    reviewDetailsVersion: 0, hold, quote, orderNumber: '9000001', now, clockVersion: '1', mode: options.mode || 'replacement',
    details: { contact: { phone: '01632 960001', email: 'chooser@example.invalid' }, expectedReturnMileage: options.mode === 'new' ? null : 6700, specialRequirements: '' },
    constraints: { maximumSpecialRequirements: rules.value.maximumSpecialRequirements, maximumReturnMileage: rules.value.maximumReturnMileage,
      mileageUnit: 'mi', textLengthUnit: 'UTF-16 code units', provenance: rules },
    currentContract: { model: 'Returning BMW Touring', registration: 'SYNTHETIC' }, oldContractId: options.mode === 'new' ? null : 'old-contract',
    requestedCollection: { date: '2026-11-20', locationId: 'collection-centre' }, contract: { months: 6, annualMileage: 8000, mileageUnit: 'mi/year' },
    frozen: false, editable: true, canContinue: true };
  const calls = []; let claimOutcome; let ready = 0; let released = 0; let tick;
  const claim = () => ({ state: hold.state === 'active' ? 'quoted' : hold.state, hold, quote, now: model.now, clockVersion: model.clockVersion, pendingOperation: null });
  const adapter = {
    readClaim: async () => { calls.push('read'); return claimOutcome || ok(claim()); },
    readReviewDetails: async () => ok(model),
    saveReviewDetails: async (input) => { calls.push('save'); model.details = structuredClone(input.details); model.reviewDetailsVersion += 1; return ok(model); },
    beginReview: async () => { calls.push('review'); hold.phase = 'order-review'; hold.version += 1; hold.expiresAt = later(timing.review); model.binding.expectedHoldVersion = hold.version; return ok(claim()); },
    release: async (input) => { calls.push(`release:${input.reason}`); hold.state = 'released'; hold.version += 1; model.binding.expectedHoldVersion = hold.version; model.editable = false; model.canContinue = false; return ok(claim()); },
  };
  let sequence = 0; const root = document.createElement('div'); root.className = 'gcsp'; document.body.append(root);
  const args = { adapter, commandId: () => `render-${++sequence}`, onContinue: () => { ready += 1; }, onReleased: () => { released += 1; },
    subscribeClock: (callback) => { tick = callback; return () => { tick = null; }; } };
  const destroy = options.shell ? mountManualReview(root, { ...args, loadAccount: async () => ({ status: 'ready', name: 'Fictional employee', context: 'Synthetic demo' }) }) : mountManualReviewBody(root, args);
  t.after(() => { destroy(); root.remove(); });
  return { root, destroy, model, calls, adapter, get ready() { return ready; }, get released() { return released; },
    setClaim: (value) => { claimOutcome = value; }, tick: () => tick?.() };
}
const control = (f, key) => f.root.querySelector(`[name="${key}"]`);
const click = (f, text) => [...f.root.querySelectorAll('button')].find((node) => node.textContent === text)?.click();
function input(f, key, value) { const node = control(f, key); node.value = value; node.dispatchEvent(new window.Event('input', { bubbles: true })); }

test('pinned card, typed points, current contract and requested collection use native stable fields', async (t) => {
  const f = setup(t); await settle(() => control(f, 'contact.phone'));
  assert.equal(f.calls.filter((entry) => entry === 'read').length, 1); assert.equal(f.calls.length, 1);
  assert.match(f.root.textContent, /1,100 points a month.*1,300 points a month allowance/);
  assert.match(f.root.textContent, /9000001/); assert.match(f.root.textContent, /Returning BMW Touring/); assert.match(f.root.textContent, /2026-11-20/);
  assert.match(f.root.textContent, /No image for this car yet/); assert.match(f.root.textContent, /140 g\/km WLTP/);
  const phone = control(f, 'contact.phone'); phone.focus(); input(f, 'contact.phone', '01632 960009');
  assert.equal(control(f, 'contact.phone'), phone); assert.equal(document.activeElement, phone);
  assert.equal(phone.required, true); assert.equal(phone.labels[0].textContent, 'Contact phone');
  assert.equal(control(f, 'specialRequirements').maxLength, rules.value.maximumSpecialRequirements);
  input(f, 'specialRequirements', 'x'.repeat(rules.value.maximumSpecialRequirements));
  assert.match(f.root.textContent, new RegExp(`${rules.value.maximumSpecialRequirements} / ${rules.value.maximumSpecialRequirements} characters`));
  assert.equal(f.root.querySelectorAll('script, [onclick]').length, 0); assert.equal(f.ready, 0);
});
test('invalid Continue focuses linked summary, retains fields, and Cancel releases without validation', async (t) => {
  const f = setup(t); await settle(() => control(f, 'contact.phone'));
  input(f, 'contact.phone', ''); input(f, 'specialRequirements', 'Keep this safe text'); click(f, 'Continue to order review');
  await settle(() => document.activeElement.textContent === 'Check your review details');
  assert.equal(control(f, 'contact.phone').getAttribute('aria-invalid'), 'true');
  f.root.querySelector('.gcsp-error-summary a').click(); assert.equal(document.activeElement, control(f, 'contact.phone'));
  assert.equal(f.calls.includes('save'), false); assert.equal(f.ready, 0); click(f, 'Cancel review'); await settle(() => f.released === 1);
  assert.ok(f.calls.includes('release:cancel')); assert.equal(control(f, 'specialRequirements').value, 'Keep this safe text');
});
test('Continue saves, transitions once and emits only current order review authority', async (t) => {
  const f = setup(t); await settle(() => control(f, 'contact.phone')); click(f, 'Continue to order review'); click(f, 'Continue to order review');
  await settle(() => f.ready === 1); assert.equal(f.calls.filter((entry) => entry === 'review').length, 1);
  assert.equal(f.calls.filter((entry) => entry === 'save').length, 1); assert.equal(f.destroy.controller.state.model.hold.phase, 'order-review');
  assert.match(f.root.querySelector('.gcsp-review-countdown').textContent, /Order review/);
});
test('presenter clock refresh expires safely, with numeric time outside the live region', async (t) => {
  const f = setup(t); await settle(() => control(f, 'contact.phone')); input(f, 'specialRequirements', 'Retained at deadline');
  f.model.now = f.model.hold.expiresAt; f.model.clockVersion = '2'; f.tick();
  await settle(() => f.destroy.controller.state.countdown?.expired);
  assert.equal(f.root.querySelector('.gcsp-review-countdown').closest('[aria-live]'), null);
  assert.match(f.root.querySelector('.gcsp-review-announcement').textContent, /expired/);
  assert.equal([...f.root.querySelectorAll('button')].find((b) => b.textContent === 'Continue to order review').disabled, true);
  assert.equal(control(f, 'specialRequirements').value, 'Retained at deadline'); assert.match(f.root.textContent, /Refresh stock/); assert.equal(f.ready, 0);
});
test('pending authority disables continuation and new orders omit return mileage', async (t) => {
  const f = setup(t, { mode: 'new' }); await settle(() => control(f, 'contact.phone'));
  assert.equal(control(f, 'expectedReturnMileage').closest('.gcsp-field').hidden, true);
  f.setClaim({ status: 'pending', operationId: 'uncertain' }); await f.destroy.refresh();
  assert.equal(f.destroy.controller.state.status, 'pending'); assert.equal(f.ready, 0); assert.equal(f.released, 0);
  assert.equal(control(f, 'contact.phone').disabled, true);
});
test('shell mount and repeatable custom element registration tear down owned content', async (t) => {
  const f = setup(t, { shell: true }); await settle(() => control(f, 'contact.phone'));
  assert.equal(f.root.querySelectorAll('main').length, 1); assert.equal(defineGcspManualReview(), defineGcspManualReview());
  const element = document.createElement('gcsp-manual-review'); element.adapter = f.adapter;
  element.loadAccount = async () => ({ status: 'ready', name: 'Fictional employee', context: 'Synthetic demo' });
  document.body.append(element); await settle(() => element.querySelector('form')); element.remove(); assert.equal(element.childNodes.length, 0);
  f.destroy(); assert.equal(f.root.childNodes.length, 0);
});

test('a pending claim past its original deadline cannot offer browse navigation or announce expiry', async (t) => {
  const f = setup(t); await settle(() => control(f, 'contact.phone'));
  f.model.hold.state = 'release-pending'; f.model.now = f.model.hold.expiresAt; f.model.clockVersion = '2';
  await f.destroy.refresh(); assert.equal(f.destroy.controller.state.status, 'pending');
  assert.match(f.root.textContent, /stays unavailable until its status is confirmed/);
  assert.equal([...f.root.querySelectorAll('button')].some((b) => b.textContent === 'Refresh stock'), false);
  assert.equal(f.root.querySelector('.gcsp-review-announcement').textContent, '');
  assert.equal(f.released, 0); assert.equal(f.ready, 0);
});

test('an unavailable claim reread never shows the last countdown or reserved wording', async (t) => {
  const f = setup(t); await settle(() => f.root.textContent.includes('Car reservation:'));
  f.setClaim({ status: 'unavailable', code: 'manual-claim-unavailable', retryable: true }); f.tick();
  await settle(() => f.root.textContent.includes('Reservation not confirmed'));
  assert.doesNotMatch(f.root.textContent, /remaining|reserved until the deadline/);
  assert.equal([...f.root.querySelectorAll('button')].find((node) => node.textContent === 'Continue to order review').disabled, true);
  f.setClaim(null); f.tick(); await settle(() => f.root.textContent.includes('Car reservation:'));
});

test('review shows no raw slot, location, contract, quote or source ids (FUCQ-197)', async (t) => {
  const f = setup(t); await settle(() => control(f, 'contact.phone'));
  for (const text of ['old-contract', 'collection-centre', 'Vehicle slot', 'Quote reference', 'Terms source', 'Current contract']) assert.equal(f.root.textContent.includes(text), false, text);
});
