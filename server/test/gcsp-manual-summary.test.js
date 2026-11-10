import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://summary.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
}
const { mountManualSummaryBody, mountManualSummary, defineGcspManualSummary } = await import('../../blocks/gcsp/manual-summary/gcsp-manual-summary.js');
const { createManualSummaryHttpAdapter } = await import('../../blocks/gcsp/manual-summary/http-adapter.js');
const seed = JSON.parse(readFileSync(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const assumption = (key) => structuredClone(seed.assumptions.find((entry) => entry.key === key));
const rules = assumption('manual.context.v1');
const timing = { preview: assumption('hold.cart.durationSeconds').value, review: assumption('hold.cart.orderReview.durationSeconds').value };
const now = '2026-11-05T12:00:00.000Z';
const later = (seconds) => new Date(Date.parse(now) + seconds * 1000).toISOString();
const ok = (value) => ({ status: 'ok', value: structuredClone(value) });
const settle = async (check) => { for (let i = 0; i < 200; i += 1) { if (check()) return; await new Promise(setImmediate); } assert.ok(check()); };
const RAW = /slot-paula|demo-collection-centre|current:employee|driver:employee|nominated:employee|employee-paula|six-month-8000/;
const terms = { termsVersion: 'fictional-order-terms-v1', wording: 'Fictional demonstration terms for this exact car.', fictional: true, validUntil: '2026-12-01T00:00:00.000Z',
  termsDigest: 'digest-1', approvalStages: ['sales-manager approval', 'sent to ordering'],
  declarations: [{ id: 'terms', label: 'I accept these fictional scheme terms.', appliesTo: 'all' },
    { id: 'driver', label: 'The nominated driver and licence details are correct.', appliesTo: 'all' },
    { id: 'return', label: 'The old contract and expected return mileage are correct.', appliesTo: 'replacement' }] };
const licence = (number) => ({ displayNumber: number, categories: ['car'], validFrom: '2010-01-01', validUntil: '2030-01-01' });
const account = { account: { employeeId: 'employee-paula', name: 'Paula Fictional', companyId: 'demo-bmw-fs-uk', gradeId: 'G7', employeeNumber: 'DEMO-employee-paula' },
  drivers: [{ driverId: 'driver:employee-paula', name: 'Paula Fictional', kind: 'employee', licence: licence('FICTIONAL-LICENCE') },
    { driverId: 'nominated:employee-paula', name: 'Casey Fictional', kind: 'nominated', relationship: 'spouse', licence: licence('FICTIONAL-NOMINEE') }],
  choices: { collectionLocations: [{ locationId: 'demo-collection-centre', label: 'Fictional collection centre' }] },
  currentContract: { earliestCollectionDate: '2026-11-12' }, slots: [{ entitlementSlotId: 'slot-paula', earliestCollectionDate: '2026-11-12' }] };
const quote = { runId: 'run', employeeId: 'employee-paula', entitlementSlotId: 'slot-paula', quoteId: 'quote', orderUuid: 'stock', configurationId: 'configuration',
  version: 1, policyVersion: seed.policyVersion, draftVersion: 1, validUntil: later(timing.review * 2), eligibility: { timing },
  facts: { identityKind: 'exact-stock', sourceKeys: { stockId: 'stock' }, display: { name: 'BMW 320i M Sport Touring' }, facts: { model: { status: 'known', value: 'BMW 320i' } } },
  terms: { kind: 'employee-scheme', points: { value: 1100, unit: 'points' }, allowanceInputs: { allowance: { value: 1300, unit: 'points' } } } };
const oldContract = { model: 'Returning BMW Touring', registration: 'SYNTHETIC', contractEndDate: '2026-12-01', currentOdometer: { value: 5200, unit: 'mi' } };

function projection(selectionState = 'acknowledged', mode = 'replacement', operationState = 'acknowledged', reference = 'GCSP-000001') {
  const names = terms.approvalStages;
  const stage = { acknowledged: 'complete', 'handoff-pending': 'pending', 'handoff-failed': 'failed' }[selectionState];
  const value = { operationId: 'selection:abc', operationState, selectionReceived: true, orderReference: reference,
    selection: { orderReference: reference, stock: { orderNumber: '9000001' }, quote, terms, employee: account.account, driver: account.drivers[1],
      draft: { choices: { mode, requestedCollectionDate: '2026-11-20', collectionLocationId: 'demo-collection-centre' }, contract: { months: 6, annualMileage: 8000, mileageUnit: 'mi/year' } },
      oldContract: mode === 'replacement' ? oldContract : null, vehicleSlot: { entitlementSlotId: 'slot-paula' },
      reviewDetails: { details: { contact: { phone: '01632 960001', email: 'chooser@example.invalid' }, expectedReturnMileage: mode === 'replacement' ? 6700 : null, specialRequirements: 'Child seat' } } },
    progress: { selectionState, approved: false, current: selectionState === 'acknowledged' ? names[0] : 'selection received',
      stages: [{ name: 'selection received', state: stage }, ...names.map((name, i) => ({ name, state: i === 0 && selectionState === 'acknowledged' ? 'waiting' : 'not-started' }))] },
    order: selectionState === 'acknowledged' ? { orderNumber: '9000001', orderStatus: names[0] } : null, failure: null, view: {} };
  return value;
}

function setup(t, options = {}) {
  const mode = options.mode || 'replacement';
  const hold = { runId: 'run', employeeId: 'employee-paula', entitlementSlotId: 'slot-paula', holdId: 'hold', quoteId: 'quote', orderUuid: 'stock',
    type: 'cart', state: 'active', phase: 'order-review', version: 2, policyVersion: seed.policyVersion, expiresAt: later(timing.review) };
  const model = { binding: { runId: 'run', employeeId: 'employee-paula', entitlementSlotId: 'slot-paula', holdId: 'hold', quoteId: 'quote', expectedHoldVersion: 2, expectedDraftVersion: 1 },
    reviewDetailsVersion: 3, stockVersion: 7, hold, quote, orderNumber: '9000001', now, clockVersion: '1', mode,
    details: { contact: { phone: '01632 960001', email: 'chooser@example.invalid' }, expectedReturnMileage: mode === 'new' ? null : 6700, specialRequirements: 'Child seat' },
    constraints: { maximumSpecialRequirements: rules.value.maximumSpecialRequirements, maximumReturnMileage: rules.value.maximumReturnMileage,
      mileageUnit: 'mi', textLengthUnit: 'UTF-16 code units', provenance: rules },
    currentContract: mode === 'new' ? null : oldContract, oldContractId: mode === 'new' ? null : 'current:employee-paula',
    requestedCollection: { date: '2026-11-20', locationId: 'demo-collection-centre' }, contract: { months: 6, annualMileage: 8000, mileageUnit: 'mi/year' },
    frozen: false, editable: true, canContinue: true };
  const f = { calls: [], posts: [], model, hold, terms: structuredClone(options.terms ?? terms), order: options.order ?? null, submitOutcomes: [], orderReads: [...(options.orderReads ?? [])], finished: 0,
    edits: 0, car: 0, choices: 0, released: 0, prints: 0 };
  const claim = () => ({ state: hold.state === 'active' ? 'quoted' : hold.state, hold, quote, now: model.now, clockVersion: model.clockVersion, pendingOperation: null });
  const adapter = {
    readClaim: async () => { f.calls.push('claim'); return ok(claim()); },
    readReviewDetails: async () => ok(model),
    release: async (input) => { f.calls.push(`release:${input.reason}`); hold.state = 'released'; hold.version += 1; model.binding.expectedHoldVersion = hold.version; model.editable = false; model.canContinue = false; return ok(claim()); },
    readAccount: async () => ok(options.noAccount ? { ...account, drivers: [] } : account),
    readDraft: async () => ok({ draftVersion: 1, choices: { mode, driverId: 'nominated:employee-paula', collectionLocationId: 'demo-collection-centre' } }),
    readTerms: async () => { f.calls.push('terms'); return f.termsOutcome ?? ok(f.terms); },
    readOrder: async () => { f.calls.push('order'); if (f.orderReads.length) return f.orderReads.shift(); return f.order ? { status: f.order.pending ? 'pending' : 'ok', value: f.order.value } : { status: 'not-found' }; },
    submitOrder: async (body) => { f.posts.push(structuredClone(body)); const next = f.submitOutcomes.shift();
      return typeof next === 'function' ? next() : next ?? { status: 'ok', value: projection('acknowledged', mode) }; },
  };
  const root = document.createElement('div'); root.className = 'gcsp'; document.body.append(root); let tick; let sequence = 0;
  window.print = () => { f.prints += 1; };
  const args = { adapter, commandId: () => `cmd-${++sequence}`, subscribeClock: (callback) => { tick = callback; return () => { tick = null; }; },
    onFinish: () => { f.finished += 1; }, onEditDetails: () => { f.edits += 1; }, onChangeCar: () => { f.car += 1; }, onChangeChoices: () => { f.choices += 1; }, onReleased: () => { f.released += 1; } };
  const destroy = options.shell ? mountManualSummary(root, { ...args, location: options.location, loadAccount: async () => ({ status: 'ready', name: 'Fictional employee', context: 'Synthetic demo' }) }) : mountManualSummaryBody(root, args);
  t.after(() => { destroy(); root.remove(); });
  return Object.assign(f, { root, destroy, adapter, tick: () => tick?.() });
}
const buttons = (f) => [...f.root.querySelectorAll('button')];
const named = (f, text) => buttons(f).find((node) => node.textContent === text);
const click = (f, text) => { const node = named(f, text); assert.ok(node, `Expected button ${text}`); node.click(); };
const boxes = (f) => [...f.root.querySelectorAll('input[type="checkbox"]')];
const tickAll = (f) => { for (const box of boxes(f)) { box.checked = true; box.dispatchEvent(new window.Event('change', { bubbles: true })); } };
const ready = (f) => settle(() => named(f, 'Submit order'));

test('replacement readback shows every section with human labels and no raw ids', async (t) => {
  const f = setup(t); await ready(f);
  const text = f.root.textContent;
  for (const expected of [/Review your order/, /9000001/, /Casey Fictional/, /FICTIONAL-NOMINEE/, /Spouse/, /Valid until/, /1 January 2030/,
    /Returning BMW Touring/, /Expected return mileage/, /6,700 miles/, /Child seat/, /01632 960001/, /Fictional collection centre/,
    /20 November 2026/, /12 November 2026/, /1,100 points a month/, /1,300 points a month/, /Cash contribution/, /6 months/, /requested, not a confirmed appointment/]) {
    assert.match(text, expected);
  }
  assert.doesNotMatch(text, RAW); assert.doesNotMatch(text, /—/); assert.equal(text.includes(terms.termsVersion), false);
  assert.match(text, /Order review: \d+:\d\d remaining/);
  assert.equal(f.root.querySelector('.gcsp-review-countdown').closest('[aria-live]'), null);
});

test('a new order has no return section and one fewer declaration', async (t) => {
  const f = setup(t, { mode: 'new' }); await ready(f);
  const returns = [...f.root.querySelectorAll('h2')].find((node) => node.textContent === 'Car you are returning');
  assert.equal(returns.closest('section').hidden, true);
  assert.equal(boxes(f).length, 2);
  const replacement = setup(t); await ready(replacement); assert.equal(boxes(replacement).length, 3);
});

test('FUCQ-237: a new order leaves out the replacement sentence and its declaration; a replacement keeps both', async (t) => {
  const seeded = { ...assumption('ordering.terms.v1').value, termsDigest: 'digest-1', approvalStages: terms.approvalStages };
  const fresh = setup(t, { mode: 'new', terms: seeded }); await ready(fresh);
  const wording = () => fresh.root.querySelector('.gcsp-summary-declarations .gcsp-note').textContent;
  assert.equal(wording(), seeded.wordingByMode.new); assert.doesNotMatch(wording(), /For a replacement/);
  assert.deepEqual(boxes(fresh).map((box) => box.dataset.declaration), ['terms', 'driver']);
  tickAll(fresh); click(fresh, 'Submit order'); await settle(() => fresh.posts.length === 1);
  assert.deepEqual(fresh.posts[0].declarations, { terms: true, driver: true });
  const replacement = setup(t, { terms: seeded }); await ready(replacement);
  assert.equal(replacement.root.querySelector('.gcsp-summary-declarations .gcsp-note').textContent, seeded.wording);
  assert.match(replacement.root.querySelector('.gcsp-summary-declarations .gcsp-note').textContent, /For a replacement/);
  assert.ok(boxes(replacement).some((box) => box.dataset.declaration === 'return'));
});

test('declarations start unchecked and Submit stays disabled until every applicable one is ticked', async (t) => {
  const f = setup(t); await ready(f);
  assert.equal(boxes(f).every((box) => box.checked === false), true);
  assert.match(f.root.textContent, /Fictional demonstration terms/);
  assert.equal(named(f, 'Submit order').disabled, true); assert.match(f.root.textContent, /Tick every declaration to submit/);
  const [first, second, third] = boxes(f); first.checked = true; first.dispatchEvent(new window.Event('change', { bubbles: true }));
  second.checked = true; second.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(named(f, 'Submit order').disabled, true);
  assert.equal(boxes(f)[0], first, 'checkboxes stay mounted so focus is kept');
  third.checked = true; third.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(named(f, 'Submit order').disabled, false);
  first.checked = false; first.dispatchEvent(new window.Event('change', { bubbles: true })); assert.equal(named(f, 'Submit order').disabled, true);
  assert.equal(f.posts.length, 0);
});

test('Submit sends the exact body once on a double click and shows the confirmation', async (t) => {
  const f = setup(t); await ready(f); tickAll(f);
  const submit = named(f, 'Submit order'); submit.click(); submit.click();
  await settle(() => f.root.querySelector('.gcsp-summary-outcome'));
  assert.equal(f.posts.length, 1);
  assert.deepEqual(f.posts[0], { commandId: 'cmd-1', source: { type: 'cart', holdId: 'hold', expectedHoldVersion: 2, expectedDraftVersion: 1 },
    expectedQuoteId: 'quote', expectedStockVersion: 7, termsDigest: 'digest-1', declarations: { terms: true, driver: true, return: true }, expectedReviewDetailsVersion: 3 });
  const text = f.root.textContent;
  assert.match(text, /Order received/); assert.match(text, /9000001/); assert.match(text, /Awaiting approval/);
  assert.match(text, /Selection received/); assert.match(text, /Sales manager approval/); assert.match(text, /Sent to ordering/);
  assert.match(text, /not an appointment/); assert.match(text, /Casey Fictional/); assert.match(text, /Returning BMW Touring/);
  assert.doesNotMatch(text, /\bapproved\b|collected|booked/i); assert.doesNotMatch(text, RAW); assert.doesNotMatch(text, /—/);
  assert.equal(document.activeElement, f.root.querySelector('h1'));
});

const facts = (f) => Object.fromEntries([...f.root.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt')?.textContent, d.querySelector('dd')?.textContent]));

test('the confirmation shows the order reference and the car order number, and Print keeps both rows', async (t) => {
  const f = setup(t, { order: { value: projection('acknowledged') } });
  await settle(() => named(f, 'Print order'));
  const shown = facts(f);
  assert.equal(shown['Order reference'], 'GCSP-000001'); assert.equal(shown['Car order number'], '9000001');
  assert.doesNotMatch(f.root.textContent, /Order number/);
  assert.match(f.root.querySelector('[role="status"]').textContent, /Order reference GCSP-000001\. Car order number 9000001\./);
  for (const label of ['Order reference', 'Car order number']) {
    const row = [...f.root.querySelectorAll('dt')].find((dt) => dt.textContent === label);
    assert.ok(row && !row.closest('.gcsp-print-hidden'), `${label} must print`);
  }
});

test('an order from before references shows only the car order number, with nothing invented', async (t) => {
  const f = setup(t, { order: { value: projection('acknowledged', 'new', 'acknowledged', null) } });
  await settle(() => named(f, 'Print order'));
  const shown = facts(f);
  assert.equal(shown['Car order number'], '9000001'); assert.equal('Order reference' in shown, false);
  assert.doesNotMatch(f.root.textContent, /GCSP-|Order reference/);
  assert.match(f.root.querySelector('[role="status"]').textContent, /^[^]*Awaiting approval\. Car order number 9000001\.$/);
});

test('a malformed reference is dropped rather than shown', async (t) => {
  const f = setup(t, { order: { value: projection('acknowledged', 'new', 'acknowledged', '<b>GCSP 1</b>') } });
  await settle(() => named(f, 'Print order'));
  assert.equal('Order reference' in facts(f), false); assert.equal(facts(f)['Car order number'], '9000001');
});

test('an unavailable submit keeps one command and retries the same body without a second order', async (t) => {
  const f = setup(t); await ready(f); tickAll(f);
  f.submitOutcomes.push({ status: 'unavailable', uncertain: true }, { status: 'unavailable', uncertain: true });
  click(f, 'Submit order'); await settle(() => named(f, 'Retry the same submission'));
  assert.match(f.root.textContent, /could not confirm whether your order was placed/);
  assert.equal(boxes(f).every((box) => box.disabled), true);
  click(f, 'Retry the same submission'); await settle(() => f.posts.length === 2); await settle(() => named(f, 'Retry the same submission')?.disabled === false);
  assert.deepEqual(f.posts[1], f.posts[0]); assert.equal(f.posts[0].commandId, 'cmd-1');
  click(f, 'Retry the same submission'); await settle(() => f.root.querySelector('.gcsp-summary-outcome'));
  assert.equal(new Set(f.posts.map((body) => body.commandId)).size, 1); assert.equal(f.posts.length, 3);
});

test('a lost response recovers from the stored order without posting again', async (t) => {
  const f = setup(t); await ready(f); tickAll(f); f.submitOutcomes.push({ status: 'unavailable', uncertain: true });
  click(f, 'Submit order'); await settle(() => named(f, 'Check order status'));
  click(f, 'Check order status'); await settle(() => /No order is recorded yet/.test(f.root.textContent));
  f.order = { value: projection('acknowledged') }; click(f, 'Check order status');
  await settle(() => f.root.querySelector('.gcsp-summary-outcome')); assert.equal(f.posts.length, 1);
});

for (const [reason, pattern, button] of [['terms-changed', /terms have changed/, null], ['claim-expired', /reservation has expired/, 'Refresh stock'],
  ['quote-expired', /reservation has expired/, 'Refresh stock'], ['claim-changed', /reservation or details changed/, 'Check current claim'],
  ['quote-changed', /reservation or details changed/, 'Check current claim'], ['stale-version', /reservation or details changed/, 'Check current claim'],
  ['stock-changed', /changed or been taken/, 'Refresh stock'], ['review-details-locked', /details are locked/, 'Check order status'],
  ['active-selection-exists', /order in progress/, 'Check order status']]) {
  test(`conflict ${reason} shows the returned state with recovery`, async (t) => {
    const f = setup(t); await ready(f); tickAll(f);
    f.submitOutcomes.push({ status: 'conflict', reason }); click(f, 'Submit order');
    await settle(() => pattern.test(f.root.textContent));
    if (button) assert.ok(named(f, button), `Expected ${button}`);
    assert.equal(f.root.querySelector('.gcsp-summary-outcome'), null);
    if (reason === 'terms-changed') { await settle(() => f.calls.filter((c) => c === 'terms').length === 2); assert.equal(boxes(f).every((box) => !box.checked), true); }
    assert.equal(f.posts.length, 1);
  });
}

test('rejected validation lists the problem in the error summary', async (t) => {
  const f = setup(t); await ready(f); tickAll(f);
  f.submitOutcomes.push({ status: 'invalid', reasons: [{ field: 'declarations', reason: 'Review the required selection fields and declarations.' }] });
  click(f, 'Submit order'); await settle(() => !f.root.querySelector('.gcsp-error-summary').hidden);
  assert.match(f.root.querySelector('.gcsp-error-summary').textContent, /Review the required selection fields/);
  assert.equal(document.activeElement.textContent, 'Check your order');
});

test('an expired claim disables Submit and offers Refresh stock', async (t) => {
  const f = setup(t); await ready(f); tickAll(f); assert.equal(named(f, 'Submit order').disabled, false);
  f.model.now = f.hold.expiresAt; f.model.clockVersion = '2'; f.tick();
  await settle(() => named(f, 'Submit order')?.disabled && /expired/.test(f.root.textContent));
  assert.ok(named(f, 'Refresh stock')); assert.equal(f.posts.length, 0);
});

test('missing required details disable Submit and are marked Required', async (t) => {
  const f = setup(t); f.model.details.contact.phone = ''; await ready(f); tickAll(f);
  assert.equal(named(f, 'Submit order').disabled, true); assert.match(f.root.textContent, /Required/); assert.match(f.root.textContent, /Add contact phone/);
});

test('edit actions: details keep the claim, car and choices release it first', async (t) => {
  const f = setup(t); await ready(f);
  assert.match(f.root.textContent, /Releases this car/); assert.match(f.root.textContent, /Keeps your reservation/);
  click(f, 'Change contact or requirements'); assert.equal(f.edits, 1); assert.equal(f.calls.some((c) => c.startsWith('release')), false);
  click(f, 'Change car'); await settle(() => f.car === 1); assert.ok(f.calls.includes('release:change')); assert.equal(f.choices, 0);
  const g = setup(t); await ready(g); click(g, 'Change order choices'); await settle(() => g.choices === 1); assert.ok(g.calls.includes('release:change')); assert.equal(g.car, 0);
});

test('reload with an existing order shows the outcome with no POST', async (t) => {
  const f = setup(t, { order: { value: projection('acknowledged') } });
  await settle(() => f.root.querySelector('.gcsp-summary-outcome'));
  assert.match(f.root.textContent, /9000001/); assert.equal(f.posts.length, 0); assert.equal(boxes(f).length, 0);
  assert.equal(f.calls.includes('claim'), false);
});

test('a pending handoff offers a status check and a tick refreshes it; a failed one points to support', async (t) => {
  const f = setup(t, { order: { pending: true, value: projection('handoff-pending', 'replacement', 'unknown') } });
  await settle(() => f.root.querySelector('.gcsp-summary-outcome'));
  assert.match(f.root.textContent, /Order saved/); assert.match(f.root.textContent, /Handoff pending/); assert.match(f.root.textContent, /Checking never creates another order/);
  assert.doesNotMatch(f.root.textContent, /\bapproved\b|collected|booked/i);
  f.order = { value: projection('acknowledged') }; f.tick(); await settle(() => /Awaiting approval/.test(f.root.textContent));
  assert.equal(named(f, 'Check order status'), undefined);
  const failed = setup(t, { order: { value: projection('handoff-failed', 'new', 'handoff-failed') } });
  await settle(() => /Handoff failed/.test(failed.root.textContent)); assert.match(failed.root.textContent, /Contact scheme support/);
  assert.equal(failed.root.textContent.includes('Car you are returning'), false);
});

test('Print calls window.print, Finish returns to the account and controls are print-hidden', async (t) => {
  const f = setup(t, { order: { value: projection('acknowledged') } });
  await settle(() => named(f, 'Print order'));
  click(f, 'Print order'); assert.equal(f.prints, 1);
  for (const label of ['Print order', 'Finish']) assert.ok(named(f, label).closest('.gcsp-print-hidden'), `${label} must be print-hidden`);
  click(f, 'Finish'); assert.equal(f.finished, 1);
  const css = readFileSync(new URL('../../blocks/gcsp/manual-summary/manual-summary.css', import.meta.url), 'utf8');
  assert.match(css, /@media print[\s\S]*gcsp-print-hidden[\s\S]*display: none/);
});

test('summary controls carry the print-hidden class and the page has no inline script or handler', async (t) => {
  const f = setup(t); await ready(f);
  for (const label of ['Submit order', 'Change car', 'Change contact or requirements']) assert.ok(named(f, label).closest('.gcsp-print-hidden'));
  assert.equal(f.root.querySelectorAll('script, [onclick]').length, 0);
});

test('an unreadable order or claim never offers Submit', async (t) => {
  const f = setup(t, { orderReads: [{ status: 'unavailable' }] });
  await settle(() => /Order unavailable/.test(f.root.textContent)); assert.equal(named(f, 'Submit order'), undefined);
  click(f, 'Check again'); await ready(f);
});

test('shell mount, nav leave and the custom element tear down owned content', async (t) => {
  const f = setup(t, { shell: true }); await ready(f);
  assert.equal(f.root.querySelectorAll('main').length, 1); assert.equal(defineGcspManualSummary(), defineGcspManualSummary());
  const element = document.createElement('gcsp-manual-summary'); element.adapter = f.adapter;
  element.loadAccount = async () => ({ status: 'ready', name: 'Fictional employee', context: 'Synthetic demo' });
  document.body.append(element); await settle(() => element.querySelector('h1')); element.remove(); assert.equal(element.childNodes.length, 0);
  f.destroy(); assert.equal(f.root.childNodes.length, 0);
});

test('a rail click releases the reservation as Back does, then routes to the chosen page', async (t) => {
  const assigned = []; const f = setup(t, { shell: true, location: { assign: (to) => assigned.push(to) } }); await ready(f);
  f.root.querySelector('nav button[data-key="order-progress"]').click(); await settle(() => assigned.length);
  assert.deepEqual(assigned, ['/gcsp-order-progress-live.html']); assert.deepEqual(f.calls.filter((entry) => entry.startsWith('release')), ['release:back']);
  assert.equal(f.released, 1);
});

test('the HTTP adapter posts the body unchanged and treats transport loss as an uncertain outcome', async () => {
  const seen = [];
  const reply = (status, body) => async (url, init) => { seen.push({ url, init }); return { status, ok: status < 300, json: async () => body }; };
  const body = { commandId: 'c', declarations: { terms: true } };
  const accepted = createManualSummaryHttpAdapter({ fetchImpl: reply(200, { status: 'ok', value: projection() }) });
  assert.equal((await accepted.submitOrder(body)).status, 'ok'); assert.equal(seen[0].url, '/api/gcsp/manual/order'); assert.deepEqual(JSON.parse(seen[0].init.body), body);
  const lost = createManualSummaryHttpAdapter({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await lost.submitOrder(body)).uncertain, true);
  const malformed = createManualSummaryHttpAdapter({ fetchImpl: reply(200, { status: 'ok', value: { nothing: true } }) });
  assert.equal((await malformed.readOrder()).status, 'unavailable');
  const missing = createManualSummaryHttpAdapter({ fetchImpl: reply(404, { status: 'not-found' }) });
  assert.equal((await missing.readOrder()).status, 'not-found');
});

test('FUCQ-277: a settled claim shows no re-check control or presenter-clock prose; an unconfirmed one keeps its recovery', async (t) => {
  const f = setup(t); await ready(f);
  assert.equal(named(f, 'Check current claim'), undefined); assert.doesNotMatch(f.root.textContent, /Time follows the presenter clock|current claim has been checked/i);
  assert.match(f.root.textContent, /Submitting places your order\./); assert.equal(f.root.querySelector('.gcsp-synthetic'), null);
  f.adapter.readClaim = async () => ({ status: 'unavailable', code: 'manual-claim-unavailable', retryable: true }); f.tick();
  await settle(() => /Reservation not confirmed/.test(f.root.textContent)); assert.ok(named(f, 'Check current claim'));
});

test('a slow recheck after expiry keeps the expiry message and Refresh stock', async (t) => {
  const f = setup(t); await ready(f); tickAll(f);
  f.model.now = f.hold.expiresAt; f.model.clockVersion = '2'; f.tick();
  await settle(() => named(f, 'Refresh stock'));
  f.adapter.readClaim = () => new Promise(() => {}); f.tick();
  await settle(() => /reservation has expired/i.test(f.root.querySelector('[id$="-notice"]')?.textContent ?? f.root.textContent));
  assert.doesNotMatch(f.root.textContent, /Checking your current claim/); assert.ok(named(f, 'Refresh stock'));
});

// FUCQ-285: the review and the placed order each speak through one region.
const LIVE = '[aria-live]:not([aria-live="off"]),[role=status],[role=alert],[role=log],output';
const liveRegions = (scope) => [...scope.querySelectorAll(LIVE)].filter((node) => !node.closest('.gcsp-presenter-controls, header'));
test('FUCQ-285: the review and the placed order keep one live region and a plain notice', async (t) => {
  const f = setup(t); await ready(f);
  assert.ok(liveRegions(f.root).length <= 1, `review: ${liveRegions(f.root).map((n) => n.className).join(', ')}`);
  assert.equal(f.root.querySelector('.gcsp-review-countdown').closest('[aria-live]'), null); assert.equal(f.root.querySelector('[id$="-notice"]').hasAttribute('role'), false);
  tickAll(f); click(f, 'Submit order'); await settle(() => f.root.querySelector('.gcsp-summary-outcome'));
  assert.equal(liveRegions(f.root).length, 1, 'outcome');
  assert.match(f.root.querySelector('[role=status]').textContent, /Car order number 9000001/);
});
