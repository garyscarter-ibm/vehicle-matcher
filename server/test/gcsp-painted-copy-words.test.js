// FUCQ-321: painted Paula and Greg copy and emails never read as a demo or as synthetic data.
// Only painted text and visible attributes are checked, never identifiers, provenance or basis prose.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const BANNED = /\b(?:demos?|demonstrations?|synthetic|fictional|made[- ]up|examples?|samples?|not real|invented|pretend(?:ed)?)\b|\.invalid\b|@example\.|example\.com/gi;
// FUCQ-373: car images carry no representative-image disclaimer either.
const DISCLAIMER = /\brepresentative\b|\bimage disclaimer\b|\bimage,? not (?:this|your)\b|\bnot (?:this|your) exact car\b/gi;
// The collaborator-approved account domain is allowed only inside a complete email address.
const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+(?![a-z0-9_@-])/gi;
const ATTRIBUTES = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt'];
const covered = []; let assertions = 0;
const seed = JSON.parse(readFileSync(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const assumption = (key) => seed.assumptions.find((row) => row.key === key).value;
const principals = assumption('identity.demo.principals');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://painted.test/', pretendToBeVisual: true });
const { window } = dom;
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException', 'location']) {
  Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
}
after(() => window.close());
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { for (let i = 0; i < 4; i += 1) await tick(); };
const host = () => { const node = document.createElement('div'); document.body.append(node); return node; };

/** Painted words in a text blob, with a little context for the failure message. */
function words(text) {
  const source = String(text);
  const scanned = source.replace(EMAIL, (email) => email.slice(email.lastIndexOf('@') + 1).toLowerCase() === 'gcsp-demo.com' ? ' '.repeat(email.length) : email);
  return [...scanned.matchAll(BANNED), ...scanned.matchAll(DISCLAIMER)].map((m) => `"${source.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25).replace(/\s+/g, ' ')}"`);
}
/** Painted text: text nodes joined by spaces, skipping hidden, script and style subtrees. */
function visibleText(node, parts = []) {
  if (node.nodeType === 3) parts.push(node.nodeValue);
  else if (node.nodeType === 1 || node.nodeType === 11) {
    if (node.nodeType === 1 && (node.hasAttribute('hidden') || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(node.tagName))) return parts;
    for (const child of node.childNodes) visibleText(child, parts);
  }
  return parts;
}
/** Visible text plus every visible attribute value under (and including) a root. */
function painted(root) {
  const found = [{ where: 'text', text: visibleText(root).join(' ') }];
  const shown = (node) => !node.closest('[hidden]');
  for (const node of [root, ...root.querySelectorAll('*')].filter(shown)) {
    for (const name of ATTRIBUTES) if (node.hasAttribute?.(name)) found.push({ where: `[${name}]`, text: node.getAttribute(name) });
    const type = node.getAttribute?.('type');
    if (node.tagName === 'BUTTON' || (node.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(type))) {
      if (node.value) found.push({ where: '[value]', text: node.value });
    }
  }
  return found;
}
function check(view, root, expected) {
  covered.push(view);
  if (expected) assert.match(root.textContent, expected, `${view} did not render the expected view`);
  const hits = painted(root).flatMap(({ where, text }) => words(text).map((hit) => `${where} ${hit}`));
  assertions += 1;
  assert.deepEqual(hits, [], `${view} paints demo or synthetic wording`);
}
function checkText(view, text) {
  covered.push(view); assertions += 1;
  assert.deepEqual(words(text), [], `${view} paints demo or synthetic wording`);
}

// ---------------------------------------------------------------------------------------------
// Account (Your cars)
const { mountAccount } = await import('../../blocks/gcsp/account/gcsp-account.js');
const { mountOrderProgress } = await import('../../blocks/gcsp/order-progress/gcsp-order-progress.js');
const { accountFixture, FIXTURE_NAMES: ACCOUNT_NAMES } = await import('../../blocks/gcsp/account/fixtures.js');

test('Your cars paints no demo or synthetic wording in any account state', async () => {
  for (const name of ACCOUNT_NAMES) {
    const root = host();
    const destroy = mountAccount(root, { adapter: { readAccount: async () => accountFixture(name), readDraft: async () => ({ status: 'not-found' }),
      startJourney: async () => ({ status: 'unavailable' }) } });
    await settle(); check(`account:${name}`, root, /\S/); destroy(); root.remove();
  }
});

// Real service data for Paula: names, sites and scheme labels come from the seed, not from a fixture.
const [{ createMemoryRepository, createMemoryStore }, { createPolicyService }, { createDemoRuntime }, manualContext, { seedManualDemoContext }] = await Promise.all([
  import('../gcsp/repository/index.js'), import('../gcsp/policy/index.js'), import('../gcsp/clock/index.js'),
  import('../gcsp/manual-context/index.js'), import('../gcsp/manual-context/fixtures.js')]);
const INSTANT = '2026-11-05T09:00:00.000Z';
async function paulaService(principal = 'demo-paula') {
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => INSTANT }); await repository.open();
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'painted-copy', environmentKind: 'synthetic',
    policyAsOf: INSTANT, commandId: 'bootstrap', sessionNow: () => INSTANT });
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, principal, 'painted-copy');
  const f = { repository, policy, clock, identity, presenter, acting, context: acting.value.context };
  await seedManualDemoContext(f);
  f.service = new manualContext.ManualContextService({ ...f, ports: manualContext.createRepositoryManualPorts(f) });
  return f;
}

test('Your cars paints no demo or synthetic wording from the seeded service, for each principal', async () => {
  for (const principal of ['demo-paula', 'demo-sam']) {
    const f = await paulaService(principal); const account = await f.service.readAccount(f.context);
    const root = host();
    const destroy = mountAccount(root, { adapter: { readAccount: async () => account, readDraft: async () => ({ status: 'not-found' }),
      startJourney: async () => ({ status: 'unavailable' }) } });
    await settle(); check(`account:service:${principal}`, root, /Paula Mason|Sam Patel/); destroy(); root.remove();
  }
});

test('Your cars and order progress paint no demo or run wording when the page is stale or access has lapsed', async () => {
  for (const status of ['stale-run', 'unknown-session', 'access-required']) {
    const root = host();
    const destroy = mountAccount(root, { adapter: { readAccount: async () => ({ status }), readDraft: async () => ({ status }), startJourney: async () => ({ status }) } });
    await settle(); check(`account:${status}`, root, /\S/); destroy(); root.remove();
    const orders = host();
    const adapter = new Proxy({ loadAccount: READY_ACCOUNT_FOR_ORDERS }, { get: (target, key) => (key in target || key === 'subscribeClock' ? target[key] : async () => ({ status })) });
    const stop = mountOrderProgress(orders, { adapter }); await settle(); await tick(50); check(`order progress:${status}`, orders, /\S/); stop(); orders.remove();
  }
});

// ---------------------------------------------------------------------------------------------
// Run-restarted, access and stale-page screens from the kit
const kit = await import('../../blocks/gcsp/kit/run-restarted.js');
test('the restarted, access-needed and stale-page screens paint no demo or run wording', () => {
  for (const [name, screen] of [['screen', kit.runRestartedScreen()], ['notice', kit.runRestartedNotice().root], ['access lapsed', kit.accessLapsedScreen()]]) {
    const root = host(); root.append(screen); check(`kit restarted ${name}`, root); root.remove();
  }
});

// ---------------------------------------------------------------------------------------------
// Brief
const { mountBriefBody } = await import('../../blocks/gcsp/brief/brief-view.js');
const briefFixture = JSON.parse(readFileSync(new URL('../../docs/gcsp/evidence/fucq94/representative-snapshot.json', import.meta.url), 'utf8'));
const { createGcspRuntime } = await import('../gcsp/runtime.js');
// The editor comes from the real service, so Paula's names are the seeded ones. Only the preview cards are recorded.
async function liveEditor() {
  const runtime = (await createGcspRuntime({ mode: 'memory', environmentId: 'painted-copy-brief', policyAsOf: INSTANT, commandId: 'bootstrap-brief',
    sessionNow: () => INSTANT })).value;
  const session = await runtime.createLocalSession(); const editor = await runtime.editor.readEditor(session.value.context);
  assert.equal(editor.status, 'ok'); await runtime.close(); return editor.value;
}
test('the brief paints no demo or synthetic wording in editing, accepted and unavailable states', async () => {
  const editor = await liveEditor();
  const transport = { preview: async () => briefFixture.preview, saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }) };
  const states = { editor: { editor, transport }, 'editor, preview unavailable': { editor, transport: { ...transport, preview: async () => ({ status: 'unavailable' }) } },
    accepted: { editor: { ...structuredClone(editor), selection: { state: 'accepted', briefVersion: 1 } }, transport: {} },
    unavailable: {}, restarted: { loadEditor: async () => ({ status: 'stale-run' }) } };
  for (const [name, options] of Object.entries(states)) {
    const root = host(); const destroy = mountBriefBody(root, options); await tick(400); check(`brief:${name}`, root, name === 'editor' ? /Comfort/ : /\S/); destroy(); root.remove();
  }
});

// ---------------------------------------------------------------------------------------------
// Buddy activity
const { mountActivity } = await import('../../blocks/gcsp/activity/gcsp-activity.js');
const { activityFixtures } = await import('../../blocks/gcsp/activity/activity-fixtures.js');
const { mountHelpBody } = await import('../../blocks/gcsp/cases/gcsp-help.js');
const { mountCaseQueue } = await import('../../blocks/gcsp/cases/gcsp-case-queue.js');
const casesFixtures = await import('../../blocks/gcsp/cases/fixtures.js');
const queueFixtures = await import('../../blocks/gcsp/cases/queue-fixtures.js');
const stripTags = (html) => html.replace(/<(style|script|title)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
const READY_ACCOUNT_FOR_ORDERS = async () => ({ status: 'ready', name: 'Paula Mason', context: 'Choices' });
const READY_ACCOUNT = async () => ({ status: 'ready', name: 'Paula Mason', context: 'Choices' });

test('buddy activity paints no demo or synthetic wording in any search, offer or error state', async () => {
  const snapshots = { ...activityFixtures.snapshots };
  const accepted = structuredClone(snapshots['offer-declined']); accepted.value.currentOffer.state = 'accepted'; snapshots['offer-accepted'] = accepted;
  const adapterFor = (read) => ({ loadAccount: READY_ACCOUNT, readActivity: read, readOfferDisplay: async () => activityFixtures.offerExample });
  const cases = Object.entries(snapshots).map(([name, snapshot]) => [name, adapterFor(async () => structuredClone(snapshot))]);
  cases.push(['stale-run', adapterFor(async () => ({ status: 'stale-run' }))], ['unknown-session', adapterFor(async () => ({ status: 'unknown-session' }))],
    ['access-required', adapterFor(async () => ({ status: 'access-required' }))], ['failed read', adapterFor(async () => { throw new Error('x'); })],
    ['account unavailable', { loadAccount: async () => ({ status: 'unavailable' }), readActivity: async () => ({ status: 'unavailable' }) }]);
  for (const [name, adapter] of cases) {
    const root = host(); const destroy = mountActivity(root, { adapter }); await settle(); await tick(20); check(`activity:${name}`, root, /Buddy activity|Session ended|Restarted|unavailable/i); destroy(); root.remove();
  }
});

// ---------------------------------------------------------------------------------------------
// Help and renewal cases
test('help and the case queue paint no demo or synthetic wording in any case or error state', async () => {
  for (const name of casesFixtures.FIXTURE_NAMES) {
    const root = host(); const destroy = mountHelpBody(root, { adapter: casesFixtures.fixtureAdapter(name) }); await settle();
    check(`help:${name}`, root); destroy(); root.remove();
  }
  const queueCase = queueFixtures.queueCaseFixtures()[0];
  for (const name of queueFixtures.QUEUE_FIXTURE_NAMES) {
    const root = host(); const destroy = mountCaseQueue(root, { adapter: queueFixtures.queueFixtureAdapter(name) }); await settle();
    root.querySelector('[data-case-id], .gcsp-case-row button')?.click(); await settle();
    check(`case queue:${name}`, root); destroy(); root.remove();
  }
  assert.ok(queueCase);
});

// ---------------------------------------------------------------------------------------------
// Order progress
const { orderProgressBody } = await import('../../blocks/gcsp/order-progress/order-progress-body.js');
const orderFixtures = (await import('../../blocks/gcsp/order-progress/fixtures.js')).orderProgressFixtures();
test('order progress paints no demo or synthetic wording in any of its states', () => {
  for (const name of Object.keys(orderFixtures.states)) {
    const node = orderProgressBody({ progress: structuredClone(orderFixtures.states[name]), car: orderFixtures.car });
    const root = host(); root.append(node); check(`order progress:${name}`, root, /\S/); root.remove();
  }
  const pending = orderProgressBody({ progress: structuredClone(orderFixtures.states['appointment-requested']), car: orderFixtures.car, pending: true, message: 'Saving' });
  const root = host(); root.append(pending); check('order progress:pending', root); root.remove();
});

// ---------------------------------------------------------------------------------------------
// Offer, decline and second offer
const { mountOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
const offerFixtures = await import('../../blocks/gcsp/offer/fixtures.js');
const { createFollowupView } = await import('../../blocks/gcsp/offer-followup/followup-view.js');
const reviewed = (file) => JSON.parse(readFileSync(new URL(`../gcsp/policy/reviewed/${file}`, import.meta.url), 'utf8')).definitions[0].value;
const declineRegistry = { ...reviewed('offer-decline-reasons-v1.json'), key: 'offer.declineReasons.v1', policyVersion: seed.policyVersion };
const followupQuestions = reviewed('offer-followup-questions-v1.json').questions;

test('the offer paints no demo or synthetic wording in any state, including decline and its reasons', async () => {
  const account = { status: 'ready', name: 'Paula Mason', scheme: 'Choices' };
  for (const name of offerFixtures.FIXTURE_NAMES) {
    const root = host();
    const read = name === 'loading' ? () => new Promise(() => {}) : async () => (name === 'error' ? { status: 'unavailable' } : offerFixtures.offerFixture(name));
    const destroy = mountOffer(root, { read, account }); await settle(); check(`offer:${name}`, root, name === 'pending' ? /Accept offer/ : /\S/); destroy(); root.remove();
  }
  for (const status of ['stale-run', 'unknown-session', 'access-required']) {
    const root = host(); const destroy = mountOffer(root, { read: async () => ({ status }), account }); await settle();
    check(`offer:${status}`, root); destroy(); root.remove();
  }
  // Decline: open the reason picker, then confirm and read the declined offer.
  let shown = 'handoff-replacement';
  const root = host();
  const destroy = mountOffer(root, { account, read: async () => offerFixtures.offerFixture(shown),
    decide: async ({ kind }) => { if (kind === 'decline') shown = 'declined'; return { status: 'ok' }; },
    readReasons: async () => ({ status: 'ok', value: declineRegistry }) });
  await settle(); root.querySelector('[data-offer-action="decline"]').click(); await settle(); check('offer:decline reasons', root, /Confirm decline/);
  const reason = root.querySelector('[data-offer-reason]'); assert.ok(reason); reason.click();
  assert.equal(reason.getAttribute('aria-checked'), 'true');
  root.querySelector('[data-offer-action="decline-confirm"]').click(); await settle(); check('offer:declined after decline', root, /Offer declined/); destroy(); root.remove();
});

test('the second offer question and its outcomes paint no demo or synthetic wording', () => {
  const mount = () => { const root = host(); return { root, view: createFollowupView(root, { activityHref: '/gcsp-activity.html' }) }; };
  for (const q of followupQuestions) {
    for (const adding of [false, true]) {
      const { root, view } = mount();
      const control = q.control.kind === 'options' ? { ...q.control } : q.control.kind === 'slider' ? { ...q.control, minimum: 0, maximum: 100 } : { ...q.control, maximumItems: 3, maximumItemLength: 20 };
      const value = q.control.kind === 'options' ? q.control.options[0].value : q.control.kind === 'slider' ? 50 : [];
      view.update({ state: 'question', busy: false, canConfirm: true, error: '', savedChange: null, value,
        question: { ...q, questionVersion: 'q1', currentValue: adding ? null : value, control } });
      check(`second offer question:${q.reasonCode}${adding ? ' (adding)' : ''}`, root); view.destroy(); root.remove();
    }
  }
  for (const state of ['idle', 'loading', 'change-saved', 'waiting', 'no-match', 'unavailable', 'forbidden', 'stale-run', 'access-lapsed', 'confirmation-uncertain']) {
    const { root, view } = mount();
    view.update({ state, busy: false, canConfirm: false, error: '', savedChange: { briefVersion: 2 }, evaluation: { carsChecked: 3 }, question: null, value: null });
    check(`second offer state:${state}`, root); view.destroy(); root.remove();
  }
});

// ---------------------------------------------------------------------------------------------
// Manual order: setup, gallery, review and summary
const { mountManualGallery } = await import('../../blocks/gcsp/manual-gallery/gcsp-manual-gallery.js');
const galleryFixtures = await import('../../blocks/gcsp/manual-gallery/fixtures.js');
const { mountManualSetup } = await import('../../blocks/gcsp/manual-setup/gcsp-manual-setup.js');
const { mountManualReviewBody } = await import('../../blocks/gcsp/manual-review/gcsp-manual-review.js');
const { mountManualSummaryBody } = await import('../../blocks/gcsp/manual-summary/gcsp-manual-summary.js');
const until = async (done) => { for (let i = 0; i < 200 && !done(); i += 1) await new Promise((resolve) => setImmediate(resolve)); };

test('manual gallery paints no demo or synthetic wording in any stock state', async () => {
  for (const name of galleryFixtures.MANUAL_GALLERY_FIXTURES) {
    const root = host(); const destroy = mountManualGallery(root, { adapter: galleryFixtures.createManualGalleryFixtureAdapter(name) });
    await until(() => root.querySelector('.vm-card, [role="alert"], .vm-status')); await settle(); check(`gallery:${name}`, root, /\S/); destroy(); root.remove();
  }
});

test('manual setup paints no demo or synthetic wording, including the saved intent and a failed save', async () => {
  const f = await paulaService(); const account = () => f.service.readAccount(f.context);
  const adapters = { ready: { readAccount: account, readDraft: async () => ({ status: 'not-found' }), saveDraft: async () => ({ status: 'unavailable' }), browseStock: async () => ({ status: 'unavailable' }),
    startJourney: async () => ({ status: 'unavailable' }) },
  restarted: { readAccount: async () => ({ status: 'stale-run' }), readDraft: async () => ({ status: 'stale-run' }) } };
  for (const [name, adapter] of Object.entries(adapters)) {
    const root = host(); const destroy = mountManualSetup(root, { adapter }); await until(() => root.querySelector('h1')); await settle();
    check(`setup:${name}`, root, /\S/);
    if (name === 'ready') { root.querySelector('button[type="submit"], .vm-btn-primary')?.click(); await settle(); check('setup:ready, submitted empty', root); }
    destroy(); root.remove();
  }
});

// Doubles for the review and summary readbacks, built from the seeded account and the seeded terms wording.
const later = (seconds) => new Date(Date.parse(INSTANT) + seconds * 1000).toISOString();
const okay = (value) => ({ status: 'ok', value: structuredClone(value) });
async function orderDoubles(mode, phase = 'order-review') {
  const f = await paulaService(); const account = (await f.service.readAccount(f.context)).value;
  const rules = assumption('manual.context.v1'); const timing = { preview: assumption('hold.cart.durationSeconds'), review: assumption('hold.cart.orderReview.durationSeconds') };
  const terms = { ...assumption('ordering.terms.v1'), termsDigest: 'digest-1', approvalStages: assumption('ordering.approvalStages.v1') };
  const hold = { runId: 'run', employeeId: account.account.employeeId, entitlementSlotId: 'slot-paula', holdId: 'hold', quoteId: 'quote', orderUuid: 'stock',
    type: 'cart', state: 'active', phase, version: 2, policyVersion: seed.policyVersion, expiresAt: later(timing.review) };
  const quote = { runId: 'run', employeeId: account.account.employeeId, entitlementSlotId: 'slot-paula', quoteId: 'quote', orderUuid: 'stock', configurationId: 'configuration',
    version: 1, policyVersion: seed.policyVersion, draftVersion: 1, validUntil: later(timing.review * 2), eligibility: { timing },
    facts: { identityKind: 'exact-stock', sourceKeys: { stockId: 'stock' }, display: { name: 'BMW 320i M Sport Touring' }, facts: { model: { status: 'known', value: 'BMW 320i' } } },
    terms: { kind: 'employee-scheme', points: { value: 1100, unit: 'points' }, allowanceInputs: { allowance: { value: 1300, unit: 'points' } } } };
  const site = account.choices.collectionLocations[0]; const old = mode === 'new' ? null : account.currentContract;
  const model = { binding: { runId: 'run', employeeId: account.account.employeeId, entitlementSlotId: 'slot-paula', holdId: 'hold', quoteId: 'quote', expectedHoldVersion: 2, expectedDraftVersion: 1 },
    reviewDetailsVersion: 3, stockVersion: 7, hold, quote, orderNumber: '9000001', now: INSTANT, clockVersion: '1', mode,
    details: { contact: account.account.contact, expectedReturnMileage: old ? 6700 : null, specialRequirements: 'Child seat' },
    constraints: { maximumSpecialRequirements: rules.maximumSpecialRequirements, maximumReturnMileage: rules.maximumReturnMileage, mileageUnit: 'mi',
      textLengthUnit: 'UTF-16 code units', provenance: seed.assumptions.find((row) => row.key === 'manual.context.v1') },
    currentContract: old, oldContractId: old ? 'old-contract' : null, requestedCollection: { date: '2026-11-20', locationId: site.locationId },
    contract: { months: 6, annualMileage: 8000, mileageUnit: 'mi/year' }, frozen: false, editable: true, canContinue: true };
  const claim = () => ({ state: 'quoted', hold, quote, now: INSTANT, clockVersion: '1', pendingOperation: null });
  const stages = terms.approvalStages; const driver = account.drivers[1];
  const submitted = (selectionState) => ({ operationId: 'selection:abc', operationState: 'acknowledged', selectionReceived: true, orderReference: 'GCSP-000001',
    selection: { orderReference: 'GCSP-000001', stock: { orderNumber: '9000001' }, quote, terms, employee: account.account, driver,
      draft: { choices: { mode, requestedCollectionDate: '2026-11-20', collectionLocationId: site.locationId }, contract: model.contract },
      oldContract: old, vehicleSlot: { entitlementSlotId: 'slot-paula' }, reviewDetails: { details: model.details } },
    progress: { selectionState, approved: false, current: selectionState === 'acknowledged' ? stages[0] : 'selection received',
      stages: [{ name: 'selection received', state: { acknowledged: 'complete', 'handoff-pending': 'pending', 'handoff-failed': 'failed' }[selectionState] },
        ...stages.map((name, i) => ({ name, state: i === 0 && selectionState === 'acknowledged' ? 'waiting' : 'not-started' }))] },
    order: selectionState === 'acknowledged' ? { orderNumber: '9000001', orderStatus: stages[0] } : null, failure: null, view: {} });
  const adapter = { readClaim: async () => okay(claim()), readReviewDetails: async () => okay(model),
    saveReviewDetails: async () => okay(model), beginReview: async () => okay(claim()), release: async () => okay(claim()),
    readAccount: async () => okay(account), readDraft: async () => okay({ draftVersion: 1, choices: { mode, driverId: driver.driverId, collectionLocationId: site.locationId } }),
    readTerms: async () => okay(terms), readOrder: async () => ({ status: 'not-found' }), submitOrder: async () => okay(submitted('acknowledged')) };
  return { adapter, submitted };
}
test('order review and the order summary paint no demo or synthetic wording for a replacement or a new order', async () => {
  for (const mode of ['replacement', 'new']) {
    const reviewing = await orderDoubles(mode, 'preview'); const { adapter, submitted } = await orderDoubles(mode);
    const review = host(); const stopReview = mountManualReviewBody(review, { adapter: reviewing.adapter, commandId: () => 'c-1' });
    await until(() => review.querySelector('[name="contact.phone"]')); check(`review:${mode}`, review, /Contact phone/);
    review.querySelector('input[name="contact.phone"]').value = ''; review.querySelector('input[name="contact.phone"]').dispatchEvent(new window.Event('input', { bubbles: true }));
    [...review.querySelectorAll('button')].find((b) => b.textContent === 'Continue to order review')?.click(); await settle(); check(`review:${mode}, invalid`, review);
    stopReview(); review.remove();
    for (const [name, order] of [['before submit', null], ['acknowledged', submitted('acknowledged')], ['handoff pending', submitted('handoff-pending')], ['handoff failed', submitted('handoff-failed')]]) {
      const summary = host();
      const stop = mountManualSummaryBody(summary, { adapter: { ...adapter, readOrder: async () => (order ? okay(order) : { status: 'not-found' }) }, commandId: () => 'c-2' });
      await until(() => summary.querySelector('h1, h2')); await settle(); check(`summary:${mode}, ${name}`, summary, order ? /GCSP-000001|Order/ : /Submit order/);
      if (!order) { summary.querySelectorAll('input[type="checkbox"]').forEach((box) => { box.checked = true; box.dispatchEvent(new window.Event('change', { bubbles: true })); });
        [...summary.querySelectorAll('button')].find((b) => b.textContent === 'Submit order')?.click(); await settle(); check(`summary:${mode}, after submit`, summary); }
      stop(); summary.remove();
    }
  }
  const stale = host(); const stop = mountManualReviewBody(stale, { adapter: { readClaim: async () => ({ status: 'stale-run' }), readReviewDetails: async () => ({ status: 'stale-run' }) } });
  await settle(); check('review:restarted', stale); stop(); stale.remove();
});

// ---------------------------------------------------------------------------------------------
// Greg: demand, order plan, publish, route comparison, order requests
const { mountGregDashboard } = await import('../../blocks/gcsp/greg/gcsp-greg.js');
const gregFixtures = await import('../../blocks/gcsp/greg/fixtures.js');
const planFixtures = await import('../../blocks/gcsp/greg/plan/fixtures.js');
const { mountGregOrderPlan } = await import('../../blocks/gcsp/greg/plan/panel.js');
const { driveToState } = await import('../../blocks/gcsp/greg/plan/gallery.js');
const { mountGregPublish } = await import('../../blocks/gcsp/greg/publish/panel.js');
const { galleryPolicy, galleryPreview } = await import('../../blocks/gcsp/greg/publish/gallery.js');
const { mountGregComparison } = await import('../../blocks/gcsp/greg/comparison/panel.js');
const comparisonFixtures = await import('../../blocks/gcsp/greg/comparison/fixtures.js');
const { outcomeToState } = await import('../../blocks/gcsp/greg/comparison/http-adapter.js');
const { mountGregOrders } = await import('../../blocks/gcsp/greg-orders/greg-orders.js');
// The real server in process: Greg's dashboard, plan, policy and comparison read what a presenter would see.
const { Readable } = await import('node:stream');
const { buildServer } = await import('../index.js');
const { createGregHttpAdapter } = await import('../../blocks/gcsp/greg/http-adapter.js');
const { createGregOrdersHttpAdapter } = await import('../../blocks/gcsp/greg-orders/http-adapter.js');
const ORIGIN = 'https://painted.test';
const cookieOf = (values) => [values].flat().map((entry) => entry.split(';')[0]).join('; ');
async function liveServer(principal) {
  const runtime = (await createGcspRuntime({ mode: 'memory', environmentId: `painted-copy-${principal}`, policyAsOf: INSTANT, commandId: 'bootstrap-live',
    sessionNow: () => INSTANT })).value;
  const presenter = await runtime.identity.createPresenterSession(`painted-${principal}`);
  const acting = await runtime.identity.switchPrincipal(presenter.value.context, principal, `painted-${principal}-1`);
  if (principal !== 'demo-greg') await seedManualDemoContext({ repository: runtime.repository, identity: runtime.identity, clock: runtime.clock, context: acting.value.context });
  const cookie = cookieOf([presenter.value.setCookie[1], acting.value.setCookie]);
  const server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [ORIGIN] }); await server.gcspStartup;
  const fetchImpl = async (url, options = {}) => {
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    Object.assign(req, { url, method: options.method ?? 'GET', headers: { host: 'painted.test', origin: ORIGIN, cookie,
      ...(options.body ? { 'content-type': 'application/json' } : {}) } });
    const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(code, headers) { this.status = code; for (const [k, v] of Object.entries(headers)) this.setHeader(k, v); }, end(body) { this.body = body; } };
    await server.listeners('request')[0](req, res);
    return { status: res.status, ok: res.status >= 200 && res.status < 300, headers: { get: (k) => res.headers[k.toLowerCase()] ?? null }, json: async () => JSON.parse(res.body) };
  };
  return { runtime, fetchImpl, close: () => runtime.close() };
}
const openAll = (root) => root.querySelectorAll('details').forEach((node) => { node.open = true; });
const stored = JSON.parse(readFileSync(new URL('./fixtures/gcsp-comparison-process-result.json', import.meta.url), 'utf8')).storedResult;
const click = (root, label) => [...root.querySelectorAll('button')].find((node) => node.textContent === label || node.textContent.startsWith(label))?.click();

test('Greg dashboard paints no demo or synthetic wording from the real server or in any demand state', async () => {
  const live = await liveServer('demo-greg');
  try {
    const greg = createGregHttpAdapter({ fetchImpl: live.fetchImpl });
    const root = host();
    const destroy = mountGregDashboard(root, { loadDemand: greg.loadDemand, orderPlanAdapter: greg.orderPlan, comparisonAdapter: greg.comparison, publishAdapter: greg.publish });
    await settle(); await tick(100); openAll(root); check('Greg dashboard:real server', root, /Demand and supply/); destroy(); root.remove();
    const orders = host(); const stop = mountGregOrders(orders, { adapter: createGregOrdersHttpAdapter({ fetchImpl: live.fetchImpl }), productionControls: true });
    await settle(); await tick(50); openAll(orders); check('Greg order requests:real server', orders, /Order requests/); stop(); orders.remove();
  } finally { await live.close(); }
  for (const name of gregFixtures.FIXTURE_NAMES) {
    const root = host();
    const destroy = mountGregDashboard(root, { loadDemand: gregFixtures.fixtureAdapter(name).loadDemand, orderPlanAdapter: planFixtures.planFixtureAdapter('ready'),
      comparisonAdapter: comparisonFixtures.comparisonFixtureAdapter('no-clear-difference') });
    await settle(); await tick(20); openAll(root); check(`Greg dashboard:${name}`, root, /Demand and supply/); destroy(); root.remove();
  }
  for (const status of ['stale-run', 'unknown-session', 'access-required']) {
    const root = host(); const destroy = mountGregDashboard(root, { loadDemand: async () => ({ status }) }); await settle();
    check(`Greg dashboard:${status}`, root); destroy(); root.remove();
  }
});

test('the order plan paints no demo or synthetic wording in any plan state', async () => {
  for (const name of planFixtures.FIXTURE_NAMES) {
    const root = host(); root.className = 'gcsp';
    const destroy = mountGregOrderPlan(root, { adapter: planFixtures.planFixtureAdapter(name), commandId: () => 'plan-command' });
    await settle(); driveToState(root, name); await tick(300); await settle(); openAll(root); check(`order plan:${name}`, root); destroy(); root.remove();
  }
});

test('publish policy paints no demo or synthetic wording as a draft, a preview or a published result', async () => {
  const live = await liveServer('demo-greg');
  try {
    const adapter = createGregHttpAdapter({ fetchImpl: live.fetchImpl }).publish;
    const root = host(); const destroy = mountGregPublish(root, { adapter, commandId: () => 'publish-command' }); await settle();
    check('publish:draft', root, /Version reference/); openAll(root); check('publish:draft, expanded', root);
    const input = root.querySelector('.gcsp-publish input[type="number"]'); input.value = String(Number(input.value) + 10);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    click(root, 'Preview changes'); await settle(); await tick(50); openAll(root); check('publish:preview', root);
    click(root, 'Publish'); await settle(); await tick(50); openAll(root); check('publish:after publish', root); destroy(); root.remove();
  } finally { await live.close(); }
  const refused = host(); const stop = mountGregPublish(refused, { adapter: { readPolicy: async () => ({ status: 'refused', message: 'x' }) } }); await settle();
  check('publish:refused', refused); stop(); refused.remove();
});

test('the route comparison paints no demo or synthetic wording, with assumptions and experiments expanded', async () => {
  const adapters = [...comparisonFixtures.FIXTURE_NAMES.map((name) => [name, comparisonFixtures.comparisonFixtureAdapter(name)]),
    ['stored process result', { load: async () => outcomeToState(200, { status: 'ok', value: stored }) }],
    ...comparisonFixtures.EXPERIMENT_FIXTURE_NAMES.map((name) => [name, comparisonFixtures.experimentFixtureAdapter(name)])];
  for (const [name, adapter] of adapters) {
    const root = host(); root.className = 'gcsp'; const destroy = mountGregComparison(root, { adapter, pollMs: 0 }); await settle(); openAll(root);
    check(`comparison:${name}`, root, /\S/);
    for (const option of root.querySelectorAll('.gcsp-comparison-picker [data-value]')) { option.click(); await settle(); openAll(root); check(`comparison:${name}, ${option.dataset.value}`, root); }
    destroy(); root.remove();
  }
});

test('order requests and production controls paint no demo or synthetic wording', async () => {
  const ok = (value) => ({ status: 'ok', value });
  const tracking = (stage) => ({ runId: 'run-a', asOf: INSTANT, versions: { policy: 'policy-a', stock: 'stock-a' },
    adapter: { status: 'ready', choices: [{ model: '3 Series', derivative: '320i Touring' }] },
    requests: stage ? [{ requestId: 'request-a', version: 2, model: '3 Series', derivative: '320i Touring', quantity: 3, stage,
      confirmedQuantity: 1, outstandingQuantity: 2, releasedQuantity: stage === 'released' ? 3 : 0,
      supplies: [{ supplyId: 'supply-a', quantity: 1, expectedAt: '2027-01-01T09:00:00.000Z', queued: true }],
      delay: stage === 'delayed' ? { until: '2027-02-01T00:00:00.000Z', reason: 'Supplier delay' } : null,
      latestReleasedAt: stage === 'released' ? '2027-01-01T09:00:00.000Z' : null }] : [] });
  for (const stage of [null, 'requested', 'partly-confirmed', 'delayed', 'released']) {
    const root = host(); const destroy = mountGregOrders(root, { adapter: { loadTracking: async () => ok(tracking(stage)) }, productionControls: true }); await settle();
    openAll(root); check(`orders:${stage ?? 'empty'}, production controls`, root); destroy(); root.remove();
  }
  for (const out of [{ status: 'forbidden' }, { status: 'unavailable' }, { status: 'stale-run' }, ok({ ...tracking(null), adapter: { status: 'unavailable' } })]) {
    const root = host(); const destroy = mountGregOrders(root, { adapter: { loadTracking: async () => out }, productionControls: true }); await settle();
    check(`orders:${out.status}${out.value ? ' adapter unavailable' : ''}`, root); destroy(); root.remove();
  }
});

// ---------------------------------------------------------------------------------------------
// Paula's live pages, mounted with their default adapters over the real server
const { mountManualJourney } = await import('../../blocks/gcsp/manual-setup/journey.js');
const { createOrderProgressHttpAdapter } = await import('../../blocks/gcsp/order-progress/order-progress-http.js');
const { createActivityHttpAdapter } = await import('../../blocks/gcsp/activity/activity-http.js');
const { createCaseHttpAdapter } = await import('../../blocks/gcsp/cases/http-adapter.js');
const { createOfferHttpAdapter } = await import('../../blocks/gcsp/offer/http-adapter.js');
const { mountBrief } = await import('../../blocks/gcsp/brief/gcsp-brief.js');
const { createBriefTransport } = await import('../../blocks/gcsp/brief/brief-transport.js');
const { createAccountHttpAdapter: createShellAccountAdapter } = await import('../../blocks/gcsp/shell/account-runtime.js');

test('Paula\'s live pages paint no demo or synthetic wording over the real server', async () => {
  const live = await liveServer('demo-paula'); const originalFetch = globalThis.fetch; globalThis.fetch = live.fetchImpl;
  try {
    const help = createCaseHttpAdapter({ fetchImpl: live.fetchImpl });
    const pages = {
      'Your cars (journey home)': [(root) => mountManualJourney(root, { orderAdapter: createOrderProgressHttpAdapter({ fetch: live.fetchImpl }), helpAdapter: help }), /Your cars|Choices/],
      'Buddy activity': [(root) => mountActivity(root, { adapter: createActivityHttpAdapter({ fetch: live.fetchImpl, loadAccount: createShellAccountAdapter({ fetch: live.fetchImpl }).loadAccount }),
        helpAdapter: help }), /Buddy activity/],
      'Order progress': [(root) => mountOrderProgress(root, { adapter: createOrderProgressHttpAdapter({ fetch: live.fetchImpl, loadAccount: createShellAccountAdapter({ fetch: live.fetchImpl }).loadAccount }),
        helpAdapter: help }), /Order progress/],
      Brief: [(root) => mountBrief(root, { ...createShellAccountAdapter({ fetch: live.fetchImpl }), transport: createBriefTransport({ fetch: live.fetchImpl }) }), /What matters to you/],
      Offer: [(root) => mountOffer(root, { ...createOfferHttpAdapter({ fetch: live.fetchImpl }), account: { status: 'ready', name: 'Paula Mason', scheme: 'Choices' } }), /offer/i],
    };
    for (const [name, [mountPage, expected]] of Object.entries(pages)) {
      const root = host(); const destroy = mountPage(root); await settle(); await tick(300); await settle(); openAll(root);
      check(`live Paula:${name}`, root, expected); destroy?.(); root.remove();
    }
  } finally { globalThis.fetch = originalFetch; await live.close(); }
});

// ---------------------------------------------------------------------------------------------
// Presenter strip and the captured email viewer
const { mountPresenterControls } = await import('../../blocks/gcsp/presenter-controls/controls.js');
const { mountOutbox } = await import('../../blocks/gcsp/presenter/gcsp-outbox.js');
const outboxFixtures = await import('../../blocks/gcsp/presenter/fixtures.js');
const { createScenarioService } = await import('../gcsp/scenarios/index.js');
const { createPresenterControlsService } = await import('../gcsp/presenter-controls/index.js');

test('the presenter strip paints no demo or synthetic wording, with its principals and scenarios from the real services', async () => {
  const f = await paulaService(); const scenarios = createScenarioService({ repository: f.repository, policy: f.policy, clock: f.clock, identity: f.identity });
  const controls = createPresenterControlsService({ clock: f.clock, identity: f.identity, scenarios });
  const presenter = f.presenter.value.context;
  const ok = (value) => ({ status: 'ok', value });
  const adapter = { readControls: () => controls.readState(presenter), readScenarios: () => controls.readCatalogue(presenter),
    readContext: async () => ok({ principalId: 'demo-presenter', name: 'Presenter', roles: ['presenter'] }),
    tick: (input) => controls.tick(presenter, input), reset: async () => ({ status: 'unavailable' }), switchPrincipal: async () => ({ status: 'unavailable' }) };
  const states = { 'real services': adapter, 'stale run': { ...adapter, readControls: async () => ({ status: 'stale-run' }) },
    'controls unavailable': { ...adapter, readControls: async () => ({ status: 'unavailable' }) },
    'tick refused': { ...adapter, tick: async () => ({ status: 'forbidden' }) } };
  for (const [name, state] of Object.entries(states)) {
    const root = host(); const control = mountPresenterControls(root, { adapter: state, commandId: () => 'strip-command' }); await settle(); await tick(50);
    control.root.open = true; check(`presenter strip:${name}`, root, /Tick/);
    click(root, 'Tick'); await settle(); await tick(50); check(`presenter strip:${name}, after Tick`, root); control.destroy(); root.remove();
  }
});

test('the captured email viewer paints no demo or synthetic wording, including the open message', async () => {
  for (const name of outboxFixtures.FIXTURE_NAMES) {
    const root = host(); const destroy = mountOutbox(root, { loadMessages: outboxFixtures.fixtureAdapter(name).loadMessages }); await settle();
    check(`outbox:${name}`, root, /Captured emails|Presenter/);
    const row = root.querySelector('.gcsp-mail-row');
    for (let i = 0; row && i < 4; i += 1) {
      const rows = root.querySelectorAll('.gcsp-mail-row'); rows[i]?.click(); rows[i]?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
      check(`outbox:${name}, message ${i + 1}`, root); const frame = root.querySelector('iframe'); if (frame?.srcdoc) checkText(`outbox:${name}, message ${i + 1} body`, stripTags(frame.srcdoc));
    }
    destroy(); root.remove();
  }
});

// ---------------------------------------------------------------------------------------------
// Emails
const { renderOfferMessage } = await import('../gcsp/notify/templates.js');
const { renderCaseMessage } = await import('../gcsp/cases/notification.js');

test('the offer and renewal case emails paint no demo or synthetic wording', () => {
  const paula = principals.find((p) => p.principalId === 'demo-paula');
  const employee = { employeeId: paula.employeeId, name: paula.name };
  const now = '2026-11-05T09:00:00.000Z'; const link = '/gcsp-offer.html?offer=o-1';
  const quote = { facts: { display: { name: 'BMW 320i Touring' } }, terms: { points: { value: 1100, unit: 'points' } } };
  const offers = [renderOfferMessage({ offer: { expiresAt: '2026-11-05T11:00:00.000Z', state: 'active' }, quote, employee, offerLink: link, now }),
    renderOfferMessage({ offer: { expiresAt: '2026-11-05T11:00:00.000Z', state: 'expired' }, quote, employee, offerLink: link, now }),
    renderOfferMessage({ offer: { expiresAt: '2026-11-05T11:00:00.000Z', state: 'active' }, employee: { employeeId: 'e' }, offerLink: link, now })];
  const update = { employeeId: paula.employeeId, caseId: 'case-1', caseVersion: 1, status: 'open', owner: { name: 'Scheme team', role: 'scheme-team' },
    reason: 'My replacement may miss my contract end.', nextAction: 'Review the renewal options.', dueAt: '2026-11-06T12:00:00.000Z', occurredAt: now };
  const cases = [renderCaseMessage({ update, employee }), renderCaseMessage({ update, employee: { employeeId: paula.employeeId } })];
  offers.forEach((m, i) => { checkText(`offer email ${i + 1} subject`, m.subject); checkText(`offer email ${i + 1} text`, m.textBody);
    checkText(`offer email ${i + 1} html`, stripTags(m.htmlBody)); checkText(`offer email ${i + 1} recipient`, m.recipient.name); });
  cases.forEach((m, i) => { checkText(`case email ${i + 1} subject`, m.subject); checkText(`case email ${i + 1} text`, m.textBody);
    checkText(`case email ${i + 1} html`, stripTags(m.htmlBody)); checkText(`case email ${i + 1} recipient`, m.recipient.name); });
});

// ---------------------------------------------------------------------------------------------
// Seed display values
test('the policy seed display values that reach the screen carry no demo or synthetic wording', () => {
  const terms = assumption('ordering.terms.v1'); const manual = assumption('manual.context.v1');
  const catalog = assumption('orderPlan.catalog.v1');
  const painted = [
    ...principals.map((p) => [`principal ${p.principalId}`, p.name]),
    ...manual.locations.map((l) => [`site ${l.locationId}`, l.label]),
    ['terms wording', terms.wording], ...Object.entries(terms.wordingByMode ?? {}).map(([mode, text]) => [`terms wording ${mode}`, text]),
    ...terms.declarations.map((d) => [`declaration ${d.id}`, d.label]),
    ...assumption('ordering.approvalStages.v1').map((stage) => [`approval stage ${stage}`, stage]),
    ...catalog.derivatives.flatMap((d) => [[`catalog ${d.derivativeId} model`, d.production.model], [`catalog ${d.derivativeId} derivative`, d.production.derivative]]),
    ['policy version', seed.policyVersion],
    ['decline reason', assumption('lifecycle.approval.declineScenario.v1').reason],
    ['document failure reason', assumption('lifecycle.documents.scenario.v1').failureReason],
    ['appointment proposal reason', assumption('lifecycle.appointments.scenario.v1').proposalReason],
  ];
  for (const [label, text] of painted) checkText(`seed ${label}`, String(text ?? ''));
});

test('the matcher sees visible attributes, shown addresses and glued words, and ignores hidden text', () => {
  const root = host();
  root.innerHTML = '<p>Run <b>demo-1</b></p><button aria-label="Demo mode">Go</button><a title="made up">x</a><p>mail a@b.invalid</p><p hidden>synthetic</p><span>Examples</span>';
  const hits = painted(root).flatMap(({ where, text }) => words(text).map((hit) => `${where} ${hit}`));
  assert.equal(hits.length, 5, hits.join(' | ')); assert.ok(!hits.some((hit) => /synthetic/.test(hit)));
  root.remove();
});

test('the matcher exempts only complete emails at the approved gcsp-demo.com domain', () => {
  for (const text of ['paula.mason@gcsp-demo.com', 'Contact <Greg.Lawson@GCSP-DEMO.COM>.', 'Email paula.mason@gcsp-demo.com.']) {
    assert.deepEqual(words(text), [], text);
  }
  assert.equal(words('demo paula.mason@gcsp-demo.com demo').length, 2, 'surrounding demo prose stays banned');
  for (const text of ['gcsp-demo.com', 'paula.mason@gcsp-demo.com.invalid', 'paula.mason@gcsp-demo.com.evil', 'paula.mason@gcsp-demo.com_evil', 'paula.mason@other-demo.com', 'paula.mason@example.com', 'synthetic']) {
    assert.ok(words(text).length > 0, text);
  }
});

test('coverage summary', () => { console.log(`painted-copy views checked: ${covered.length}; assertions: ${assertions}`); assert.ok(covered.length > 0); });
