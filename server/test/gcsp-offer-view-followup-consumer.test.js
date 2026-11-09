// Authored one-case consumer composition. Requires a separate exact external grant.
// No listener/browser/native DB; accepted backend cases are not registered or rerun here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile, writeFile } from 'node:fs/promises';

const enabled = Boolean(process.env.GCSP_FUCQ105_FOLLOWUP_MAP && process.env.GCSP_FUCQ105_FOLLOWUP_CHECKPOINT);
const yes = (out) => { assert.equal(out?.status, 'ok'); return out.value; };
const pair = (cookie) => cookie.split(';')[0];
const completed = [];
async function checkpoint(name) {
  completed.push(name);
  await writeFile(process.env.GCSP_FUCQ105_FOLLOWUP_CHECKPOINT, JSON.stringify({ completed,
    scope: 'Actual100/102/106/107 memory services to current105 HTTP/controller/host and real107 body; explicit question-policy input.' }) + '\n');
}
async function until(predicate) {
  for (let turn = 0; turn < 100; turn += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Selected consumer checkpoint did not settle within 100 event-loop turns.');
}

test('current105 reload opens actual102 persisted decline in employee-only107 and preserves saved change', {
  skip: enabled ? false : 'Requires the reviewed finite105 follow-up consumer supervisor.',
}, async (t) => {
  const [{ JSDOM }, { createMemoryRepository, createMemoryStore, inputDigest },
    { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore }, { createDemoRuntime }, { BriefService },
    { seedManualDemoContext }, { BuddyHoldService }, { verifyOfferToken },
    { createStoredSubjectRecommendationEvaluator }, { createOfferAccessService, OFFER_ACCESS_COOKIE },
    { createOfferAccessHandler }, { OfferDecisionService, DECISION_EVENTS }, { createOfferDecisionHandler },
    { createOfferFollowupService }, { createOfferFollowupRoutes }, { createGcspHandler },
    { ManualContextService }, { createRepositoryManualPorts }, { createManualContextRoutes },
    { stock, essential, preference }, { createOfferHttpAdapter }, { createOfferController },
    { createAccountHttpAdapter }] = await Promise.all([
    import('jsdom'), import('../gcsp/repository/index.js'), import('../gcsp/policy/index.js'),
    import('../gcsp/clock/index.js'), import('../gcsp/brief/index.js'), import('../gcsp/manual-context/fixtures.js'),
    import('../gcsp/offers/buddy-hold.js'), import('../gcsp/offers/offer-token.js'), import('../gcsp/recommendation/index.js'),
    import('../gcsp/offers/access.js'), import('../gcsp/offers/access-http.js'), import('../gcsp/offers/decision.js'),
    import('../gcsp/offers/decision-http.js'), import('../gcsp/offers/followup.js'), import('../gcsp/offers/followup-http.js'),
    import('../gcsp/identity/http.js'), import('../gcsp/manual-context/index.js'), import('../gcsp/manual-context/ports.js'),
    import('../gcsp/manual-context/http.js'), import('./helpers/employee-recommendation.js'),
    import('../../blocks/gcsp/offer/http-adapter.js'), import('../../blocks/gcsp/offer/offer-controller.js'),
    import('../../blocks/gcsp/shell/account-runtime.js'),
  ]);
  const store = createMemoryStore(); const raw = createMemoryRepository({ store }); yes(await raw.open());
  t.after(() => raw.close());
  let afterQuery;
  const repository = { ...raw, async query(...args) {
    const out = await raw.query(...args); await afterQuery?.(...args); return out;
  } };
  const policy = new PolicyService({ provider: new MemoryPolicyProvider({ store: createMemoryPolicyStore() }) });
  const wall = '2026-11-06T09:00:00.000Z'; const origin = 'https://explicit-synthetic.test';
  const { clock, identity } = yes(await createDemoRuntime({ repository, policy,
    environmentId: 'fucq105-followup-consumer', environmentKind: 'synthetic', policyAsOf: wall,
    commandId: 'bootstrap', sessionNow: () => wall }));
  const presenter = yes(await identity.createPresenterSession('presenter'));
  let acting = yes(await identity.switchPrincipal(presenter.context, 'demo-paula', 'employee'));
  let employeeCookie = pair(acting.setCookie);
  let context = yes(await identity.resolveSession({ authorized: true, cookie: employeeCookie }));
  yes(await seedManualDemoContext({ repository, identity, clock, context }));
  const initialTime = yes(await clock.now(context));
  yes(await clock.advance(presenter.context, { commandId: 'morning', expectedClockVersion: initialTime.clockVersion,
    bySeconds: (Date.parse(wall) - Date.parse(initialTime.now)) / 1000 }));
  const brief = new BriefService({ repository, policy, clock, identity });
  const input = { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } };
  yes(await brief.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: input }));
  yes(await brief.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } }));
  const ref = (table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
  const row = async (table, key = {}) => yes(await raw.read(context, ref(table, key)));
  const rows = async (table, filter = {}) => yes(await raw.query(context, table, filter));
  const digest = () => inputDigest(store.state);
  const car = stock(1);
  yes(await repository.transaction(context, { commandId: 'stock', inputDigest: inputDigest('stock') },
    (tx) => tx.insert('stock', { runId: context.runId, orderUuid: car.orderUuid, orderNumber: '9000001',
      configurationId: car.configurationId, state: 'released', available: true, held: false, allocated: false,
      facts: car.snapshot, release: { eventId: 'explicit-synthetic-release', availability: car.availability },
      visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } })));
  const employee = await row('employees', { employeeId: context.employeeId });
  const slot = await row('entitlement_slots', { entitlementSlotId: context.entitlementSlotId });
  const producer = new BuddyHoldService({ repository, policy, clock, identity, adapter: { mode: 'local-synthetic' } });
  const produced = yes(await producer.allocate(context, { commandId: 'allocate', orderUuid: car.orderUuid,
    expectedBriefVersion: 1, expectedStockVersion: 1, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version }));
  const outbox = await rows('notification_outbox'); assert.equal(outbox.length, 1);
  const link = new URL(outbox[0].payload.offerLink, origin);
  const selector = { offerId: link.searchParams.get('offerId'), runId: link.searchParams.get('runId') };
  const cleanURL = `${origin}${link.pathname}?${new URLSearchParams(selector)}`;
  const token = new URLSearchParams(link.hash.slice(1)).get('token'); assert.equal(typeof token, 'string');
  const quoteBefore = await row('quotes', { quoteId: produced.quote.quoteId });
  const deadline = (await row('holds', { holdId: produced.hold.holdId })).expiresAt;
  // Preserve distinct quoted (1) and confirmed decline (2) brief revisions.
  yes(await brief.saveDraft(context, { commandId: 'draft-2', expectedBriefVersion: 1, expectedDraftVersion: 1, brief: input }));
  yes(await brief.confirm(context, { commandId: 'confirm-2', expectedBriefVersion: 1, expectedDraftVersion: 2,
    consent: { search: true, hold: true } }));
  const greg = yes(await identity.switchPrincipal(presenter.context, 'demo-greg', 'greg')).context;
  const now = yes(await clock.now(context));
  yes(await policy.withPublicationPorts({ identity, clock, repository }).adoptReviewedAssumptions(greg, {
    commandId: 'adopt-reasons', expectedActiveVersion: produced.quote.policyVersion,
    policyVersion: 'entry-reasons-v2', effectiveFrom: now.now, definitionSetId: 'offer-decline-reasons-v1' }));
  acting = yes(await identity.switchPrincipal(presenter.context, 'demo-paula', 'employee-current'));
  employeeCookie = pair(acting.setCookie);
  context = yes(await identity.resolveSession({ authorized: true, cookie: employeeCookie }));
  const access = createOfferAccessService({ repository, policy, clock, identity, environmentId: context.environmentId,
    sessionNow: () => wall, verifyOfferToken });
  const decisions = new OfferDecisionService({ repository, policy, clock, access,
    createStoredSubjectEvaluator: createStoredSubjectRecommendationEvaluator, mode: 'local-synthetic' });
  const accessHandler = createOfferAccessHandler({ service: access, identity, allowedOrigins: [origin] });
  let accountResolutions = 0;
  const resolveAccess = async ({ selector: requested, cookie }) => {
    const hasOffer = typeof cookie === 'string' && cookie.split(';').some((part) => part.trim().startsWith(`${OFFER_ACCESS_COOKIE}=`));
    let out;
    if (hasOffer) out = await access.fromSession(requested, cookie);
    else { accountResolutions += 1;
      const resolved = await identity.resolveSession({ authorized: true, cookie });
      out = resolved.status === 'ok' ? await access.fromAccount(resolved.value, requested) : resolved;
    }
    return out.status === 'ok' ? { status: 'ok', value: { context: out.value.context } } : out;
  };
  const decisionHandler = createOfferDecisionHandler({ service: decisions, resolveAccess, allowedOrigins: [origin] });
  const questionBundle = JSON.parse(await readFile(process.env.GCSP_FUCQ105_FOLLOWUP_QUESTION_INPUT, 'utf8'));
  // Accepted107 explicit input boundary. Canonical default registration is a separate gate.
  const questionPolicy = { async getAssumption(key, read) {
    return key === 'offer.followupQuestions.v1' ? { status: 'ok', policyVersion: read.policyVersion, value: questionBundle.definitions[0] }
      : policy.getAssumption(key, read);
  } };
  const followup = createOfferFollowupService({ repository, policy: questionPolicy, clock, identity, brief });
  const manual = new ManualContextService({ repository, policy, clock, identity,
    ports: createRepositoryManualPorts({ repository, policy }) });
  const employeeHandler = createGcspHandler({ identity, allowedOrigins: [origin],
    routes: [...createOfferFollowupRoutes(followup), ...createManualContextRoutes(manual)] });
  let jar = ''; let offerCookie; let loseDecision = true; let publicOffer; let savedChange;
  const calls = []; const confirmations = [];
  const request = async (url, options = {}, cookie = jar) => {
    const target = new URL(url, origin); const headers = { origin };
    for (const [key, value] of Object.entries(options.headers || {})) headers[key.toLowerCase()] = value;
    if (cookie) headers.cookie = cookie;
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []); req.method = options.method || 'GET'; req.headers = headers;
    const responseHeaders = new Map(); let code; let answer;
    const res = { setHeader: (key, value) => responseHeaders.set(key.toLowerCase(), value) };
    const handler = target.pathname.startsWith('/api/gcsp/offer-followup') || target.pathname.startsWith('/api/gcsp/manual/')
      ? employeeHandler : /\/(decision|decision-reasons)$/.test(target.pathname) ? decisionHandler : accessHandler;
    await handler({ req, res, pathname: target.pathname, searchParams: target.searchParams, gateAuthorized: true,
      sendJson: (_res, status, value) => { code = status; answer = value; responseHeaders.set('content-type', 'application/json'); } });
    assert.equal(responseHeaders.get('cache-control'), 'no-store');
    return { code, answer, responseHeaders };
  };
  const fetch = async (url, options = {}, cookie = jar) => {
    const path = new URL(url, origin).pathname; calls.push({ path, method: options.method || 'GET' });
    if (path.endsWith('/confirm')) confirmations.push(JSON.parse(options.body));
    const response = await request(url, options, cookie);
    if (response.responseHeaders.has('set-cookie')) { jar = pair(response.responseHeaders.get('set-cookie')); offerCookie = jar; }
    if (response.answer.status === 'ok' && response.answer.value?.quote) publicOffer = response.answer.value;
    if (path.endsWith('/confirm') && response.answer.status === 'ok') savedChange = response.answer.value;
    if (path.endsWith('/decision') && loseDecision && response.answer.status === 'ok') {
      loseDecision = false; throw Error('Owned transport discarded one committed106 response.');
    }
    return { ok: response.code >= 200 && response.code < 300,
      headers: { get: (key) => response.responseHeaders.get(key.toLowerCase()) }, json: async () => response.answer };
  };
  const adapter = createOfferHttpAdapter({ fetch, enableDecisions: true, location: { href: link.href },
    history: { replaceState: (_state, _title, clean) => assert.equal(clean.includes('#'), false) } });
  const controller = createOfferController({ ...adapter, createCommandId: () => 'one-native-decline' });
  t.after(controller.destroy);
  assert.equal((await controller.refresh()).state, 'pending');
  await controller.decision('decline'); assert.equal(controller.snapshot().declineReason.status, 'ready');
  await controller.decision('decline', { reasonCode: 'body-style' });
  const declined = controller.snapshot(); assert.equal(declined.state, 'declined');
  assert.match(declined.followup?.decisionId || '', /^offer-decision:[a-f0-9]{64}$/);
  assert.deepEqual(declined.followup, publicOffer.followup); assert.equal(loseDecision, false);
  assert.equal(declined.canAccept, false); assert.equal(declined.canDecline, false);
  const native = (await rows('decisions'))[0]; const receipt = (await rows('event_receipts', { consumerId: DECISION_EVENTS }))[0];
  assert.equal(native.decisionId, declined.followup.decisionId); assert.equal(native.versions.brief, 2);
  assert.equal(native.versions.pinnedBrief, 1); assert.equal(receipt.outcome.value.event.renewalId, slot.renewalId);
  assert.equal((await row('offers', { offerId: selector.offerId })).version, native.outcome.value.offerVersion);
  assert.equal((await row('holds', { holdId: produced.hold.holdId })).version, native.outcome.value.holdVersion);
  const readURL = `/api/gcsp/offers/${encodeURIComponent(selector.offerId)}?runId=${encodeURIComponent(selector.runId)}`;
  const beforeRefusal = digest(); const resolutions = accountResolutions;
  const refused = await request(readURL, {}, `${OFFER_ACCESS_COOKIE}=invalid; ${employeeCookie}`);
  assert.notEqual(refused.answer.status, 'ok'); assert.equal(accountResolutions, resolutions); assert.equal(digest(), beforeRefusal);
  assert.notEqual((await request(`/api/gcsp/offer-followup?${new URLSearchParams(declined.followup)}`, {}, offerCookie)).answer.status, 'ok');
  await checkpoint('native-decline-lost-response-real102-handle-history-and-token-refusal');

  const dom = new JSDOM('<!doctype html><body><main></main>', { url: cleanURL });
  const globals = Object.fromEntries(['document', 'window', 'HTMLElement', 'customElements'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { document: dom.window.document, window: dom.window,
    HTMLElement: dom.window.HTMLElement, customElements: dom.window.customElements });
  let mounted; let mountCount = 0; let teardownCount = 0; const signals = [];
  t.after(() => { mounted?.(); dom.window.close();
    for (const [key, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const [{ mountOffer }, { mountFollowupBody }] = await Promise.all([
    import('../../blocks/gcsp/offer/gcsp-offer.js'), import('../../blocks/gcsp/offer-followup/gcsp-offer-followup.js'),
  ]);
  const root = dom.window.document.querySelector('main'); jar = employeeCookie;
  const employeeFetch = (url, options) => fetch(url, options, employeeCookie);
  const account = createAccountHttpAdapter({ fetch: employeeFetch });
  const mount = () => {
    mounted?.();
    const reloaded = createOfferHttpAdapter({ fetch, location: { href: cleanURL }, history: {},
      schedule: () => 1, cancel: () => {} });
    mounted = mountOffer(root, { ...reloaded, followup: { loadAccount: account.loadAccount,
      mount(body, input) {
        assert.deepEqual(Object.keys(input).sort(), ['announce', 'decisionId', 'signal']); assert.equal(input.decisionId, declined.followup.decisionId);
        signals.push(input.signal); mountCount += 1;
        const cleanup = mountFollowupBody(body, { ...input, hostRefresh: true, fetchImpl: employeeFetch, createCommandId: () => 'one-confirmed-change' });
        return () => { teardownCount += 1; cleanup(); };
      } } });
  };
  const beforeMount = digest(); mount();
  await until(() => root.querySelector('.gcsp-followup-question'));
  assert.equal(mounted.snapshot().state, 'declined'); assert.deepEqual(mounted.snapshot().followup, declined.followup);
  assert.equal(publicOffer.expiresAt, deadline); assert.equal(digest(), beforeMount);
  assert.ok(calls.some((call) => call.path === '/api/gcsp/manual/account'));
  const refreshes = () => [...root.querySelectorAll('button')].filter((node) => node.textContent === 'Check current state').length;
  assert.equal(refreshes(), 1); assert.equal(mountCount, 1); const questionNode = root.querySelector('.gcsp-followup-question');
  const option = [...questionNode.querySelectorAll('[role="radio"]')].find((node) => /SUV/i.test(node.textContent));
  assert.ok(option); option.click(); option.focus();
  const beforePoll = digest(); await mounted.refresh();
  assert.equal(root.querySelector('.gcsp-followup-question'), questionNode);
  assert.equal(document.activeElement, option); assert.equal(mountCount, 1); assert.equal(digest(), beforePoll);
  assert.equal(root.querySelector('[data-followup-action="confirm"]').disabled, false);
  await checkpoint('fresh-account-real105-host-real107-question-and-poll-retention');

  root.querySelector('[data-followup-action="confirm"]').click();
  await until(() => root.querySelector('[data-followup-saved]'));
  assert.equal(confirmations.length, 1); assert.equal(savedChange.state, 'change-saved'); assert.equal(savedChange.briefVersion, 3);
  assert.match(savedChange.event.receiptReference, /^brief-change:[a-f0-9]{64}$/);
  assert.equal(savedChange.event.eventType, 'brief-changed'); assert.equal(savedChange.decisionId, declined.followup.decisionId);
  assert.deepEqual(Object.keys(confirmations[0]).sort(), ['commandId', 'decisionId', 'expectedBriefVersion', 'questionVersion', 'value']);
  assert.equal(confirmations[0].value, 'suv'); assert.equal(confirmations[0].expectedBriefVersion, 2);
  assert.equal((await row('quotes', { quoteId: produced.quote.quoteId })).briefVersion, quoteBefore.briefVersion);
  assert.deepEqual(await row('quotes', { quoteId: produced.quote.quoteId }), quoteBefore);
  assert.equal((await row('holds', { holdId: produced.hold.holdId })).expiresAt, deadline);
  const afterSave = digest(); mount();
  await until(() => root.querySelector('[data-followup-saved]'));
  assert.equal(signals[0].aborted, true); assert.equal(teardownCount, 1); assert.equal(confirmations.length, 1);
  assert.match(root.querySelector('[data-followup-saved]').textContent, /brief version 3/); assert.equal(refreshes(), 1);
  assert.deepEqual(mounted.snapshot().followup, declined.followup); assert.equal(digest(), afterSave);
  assert.equal(calls.filter((call) => call.path.endsWith('/decision') && call.method === 'POST').length, 1);
  await checkpoint('confirmed-change-public-receipt-and-original-coordinate-saved-reload');

  const validState = structuredClone(store.state);
  const decisionsBefore = store.state.tables.decisions.length;
  for (const malformed of [false, true]) {
    store.state = structuredClone(validState);
    if (malformed) store.state.tables.decisions[0].originalResponse = null;
    else store.state.tables.decisions = [];
    const before = digest(); await mounted.refresh();
    assert.equal(mounted.snapshot().state, 'declined'); assert.equal(mounted.snapshot().followup, null);
    assert.match(root.querySelector('[data-offer-followup]').textContent, /Follow-up unavailable/);
    assert.equal(digest(), before); assert.equal(root.querySelector('.gcsp-followup-question'), null);
  }
  store.state = structuredClone(validState);
  let raced = false;
  afterQuery = (_context, table) => {
    if (table === 'decisions' && !raced) { raced = true; store.state.tables.decisions[0].version += 1; }
  };
  await mounted.refresh(); assert.equal(raced, true); assert.equal(mounted.snapshot().state, 'error');
  afterQuery = undefined; store.state = structuredClone(validState);
  const callsBeforeRefresh = calls.length; const beforeRefresh = digest();
  root.querySelector('[data-offer-action="refresh"]').click();
  await until(() => root.querySelector('[data-followup-saved]'));
  assert.ok(calls.slice(callsBeforeRefresh).every((call) => call.method === 'GET'));
  assert.equal(digest(), beforeRefresh); assert.equal(store.state.tables.decisions.length, decisionsBefore);
  assert.equal((await rows('event_receipts', { consumerId: DECISION_EVENTS })).length, 1);
  const lastSignal = signals.at(-1); mounted(); mounted = null;
  assert.equal(lastSignal.aborted, true); assert.equal(teardownCount, mountCount);
  assert.equal(root.querySelector('[data-offer-followup]'), null); assert.equal(confirmations.length, 1);
  assert.equal(JSON.stringify(publicOffer).includes(token), false);
  assert.equal(/employeeId|eventId|consumerId|principalId|tokenHash/.test(JSON.stringify(publicOffer)), false);
  await checkpoint('declined-null-versus-race-unavailable-read-only-refresh-and-mount-teardown');
});
