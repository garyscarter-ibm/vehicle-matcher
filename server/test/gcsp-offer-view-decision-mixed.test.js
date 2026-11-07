// Finite authored proposal. No foreign module imports until an exact reviewed map is supplied.
// Memory service/streamed HTTP/JSDOM only; no delivered gate, browser or remote-provider claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { writeFile } from 'node:fs/promises';

const enabled = Boolean(process.env.GCSP_FUCQ105_DECISION_MAP && process.env.GCSP_FUCQ105_DECISION_CHECKPOINT);
const completed = [];
async function checkpoint(name) {
  completed.push(name);
  await writeFile(process.env.GCSP_FUCQ105_DECISION_CHECKPOINT, JSON.stringify({ completed,
    scope: 'Actual canonical memory policy/producer/access/106 to105 consumer; streamed HTTP/JSDOM, not delivered host/browser/remote.' }) + '\n');
}
const yes = (outcome) => { assert.equal(outcome?.status, 'ok'); return outcome.value; };
const cookiePair = (header) => header.split(';')[0];

async function setup(t, label) {
  const [{ createMemoryRepository, createMemoryStore, inputDigest },
    { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore }, { activateRunPolicy }, { createDemoRuntime },
    { BriefService }, { seedManualDemoContext }, { BuddyHoldService }, { verifyOfferToken },
    { createStoredSubjectRecommendationEvaluator }, { createOfferAccessService, OFFER_ACCESS_COOKIE },
    { createOfferAccessHandler }, { OfferDecisionService, DECISION_EVENTS, DECLINE_REASONS_KEY },
    { createOfferDecisionHandler }, { stock, essential, preference }, { createOfferHttpAdapter },
    { createOfferController }, { createOfferView }, { JSDOM }] = await Promise.all([
    import('../gcsp/repository/index.js'), import('../gcsp/policy/index.js'), import('../gcsp/policy/activation.js'),
    import('../gcsp/clock/index.js'), import('../gcsp/brief/index.js'), import('../gcsp/manual-context/fixtures.js'),
    import('../gcsp/offers/buddy-hold.js'), import('../gcsp/offers/offer-token.js'), import('../gcsp/recommendation/index.js'),
    import('../gcsp/offers/access.js'), import('../gcsp/offers/access-http.js'), import('../gcsp/offers/decision.js'),
    import('../gcsp/offers/decision-http.js'), import('./helpers/employee-recommendation.js'),
    import('../../blocks/gcsp/offer/http-adapter.js'), import('../../blocks/gcsp/offer/offer-controller.js'),
    import('../../blocks/gcsp/offer/offer-view.js'), import('jsdom'),
  ]);
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  yes(await repository.open()); t.after(() => repository.close());
  const provider = new MemoryPolicyProvider({ store: createMemoryPolicyStore() });
  const policy = new PolicyService({ provider });
  const wall = '2026-11-06T09:00:00.000Z';
  const { clock, identity } = yes(await createDemoRuntime({ repository, policy,
    environmentId: `fucq105-decision-${label}`, environmentKind: 'synthetic', policyAsOf: wall,
    commandId: 'bootstrap', sessionNow: () => wall }));
  const presenter = yes(await identity.createPresenterSession('presenter'));
  const acting = yes(await identity.switchPrincipal(presenter.context, 'demo-paula', 'employee'));
  const employeeCookie = cookiePair(acting.setCookie);
  // Use a real resolved employee cookie, never a copied/private fabricated context.
  const context = yes(await identity.resolveSession({ authorized: true, cookie: employeeCookie }));
  yes(await seedManualDemoContext({ repository, identity, clock, context }));
  const advanceTo = async (instant, commandId) => {
    const time = yes(await clock.now(context));
    return yes(await clock.advance(presenter.context, { commandId, expectedClockVersion: time.clockVersion,
      bySeconds: (Date.parse(instant) - Date.parse(time.now)) / 1000 }));
  };
  await advanceTo(wall, 'noon');
  const brief = new BriefService({ repository, policy, clock, identity });
  yes(await brief.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
  yes(await brief.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } }));
  const ref = (table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
  const read = async (table, key = {}) => yes(await repository.read(context, ref(table, key)));
  const rows = async (table, filter = {}) => yes(await repository.query(context, table, filter));
  // Explicit synthetic starting inventory is fed to the actual producer; no pending offer/quote is hand-authored.
  const car = stock(1);
  yes(await repository.transaction(context, { commandId: 'release', inputDigest: inputDigest('release') },
    (tx) => tx.insert('stock', { runId: context.runId, orderUuid: car.orderUuid, orderNumber: '0123456',
      configurationId: car.configurationId, state: 'released', available: true, held: false, allocated: false,
      facts: car.snapshot, release: { eventId: 'explicit-synthetic-release', availability: car.availability },
      visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } })));
  const employee = await read('employees', { employeeId: context.employeeId });
  const slot = await read('entitlement_slots', { entitlementSlotId: context.entitlementSlotId });
  const producer = new BuddyHoldService({ repository, policy, clock, identity, adapter: { mode: 'local-synthetic' } });
  const produced = yes(await producer.allocate(context, { commandId: 'allocate', orderUuid: car.orderUuid,
    expectedBriefVersion: 1, expectedStockVersion: 1, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version }));
  const jobs = await rows('notification_outbox'); assert.equal(jobs.length, 1);
  const origin = 'https://explicit-synthetic.test';
  const link = new URL(jobs[0].payload.offerLink, origin);
  const token = new URLSearchParams(link.hash.slice(1)).get('token'); assert.equal(typeof token, 'string');
  const selector = { runId: link.searchParams.get('runId'), offerId: link.searchParams.get('offerId') };
  assert.equal(selector.offerId, produced.offer.offerId); assert.equal(selector.runId, context.runId);
  // This one actual access instance owns every branded context used by both actual handlers and106.
  const access = createOfferAccessService({ repository, policy, clock, identity, environmentId: context.environmentId,
    sessionNow: () => wall, verifyOfferToken });
  const service = new OfferDecisionService({ repository, policy, clock, access,
    createStoredSubjectEvaluator: createStoredSubjectRecommendationEvaluator, mode: 'local-synthetic' });
  const accessHandler = createOfferAccessHandler({ service: access, identity, allowedOrigins: [origin] });
  let accountResolutions = 0;
  const resolveAccess = async ({ selector: requested, cookie }) => {
    const hasOfferCookie = typeof cookie === 'string'
      && cookie.split(';').some((part) => part.trim().startsWith(`${OFFER_ACCESS_COOKIE}=`));
    let outcome;
    if (hasOfferCookie) outcome = await access.fromSession(requested, cookie);
    else {
      ++accountResolutions;
      const resolved = await identity.resolveSession({ authorized: true, cookie });
      outcome = resolved.status === 'ok' ? await access.fromAccount(resolved.value, requested) : resolved;
    }
    return outcome.status === 'ok' ? { status: 'ok', value: { context: outcome.value.context } } : outcome;
  };
  const decisionHandler = createOfferDecisionHandler({ service, resolveAccess, allowedOrigins: [origin] });
  let jar = ''; let lastPublic; let droppedCommand = false; let dropRead = false; let loseResponse = false;
  const commands = [];
  const request = async (url, options, cookie = jar, gateAuthorized = true, requestOrigin = origin) => {
    const target = new URL(url, origin); const headers = { origin: requestOrigin };
    for (const [key, value] of Object.entries(options.headers || {})) headers[key.toLowerCase()] = value;
    if (cookie) headers.cookie = cookie;
    const req = Readable.from(options.body ? [options.body] : []); req.method = options.method; req.headers = headers;
    const responseHeaders = new Map(); let status; let answer;
    const res = { setHeader: (key, value) => responseHeaders.set(key.toLowerCase(), value) };
    const handler = /\/(decision|decision-reasons)$/.test(target.pathname) ? decisionHandler : accessHandler;
    await handler({ req, res, pathname: target.pathname, searchParams: target.searchParams, gateAuthorized,
      sendJson: (_res, code, value, extra = {}) => {
        status = code; answer = value; responseHeaders.set('content-type', 'application/json');
        for (const [key, value] of Object.entries(extra)) responseHeaders.set(key.toLowerCase(), value);
      } });
    assert.equal(responseHeaders.get('cache-control'), 'no-store');
    assert.equal(responseHeaders.get('referrer-policy'), 'no-referrer');
    return { status, answer, responseHeaders };
  };
  const fetch = async (url, options) => {
    const path = new URL(url).pathname;
    for (const [key, expected] of Object.entries({ credentials: 'same-origin', mode: 'same-origin',
      cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })) assert.equal(options[key], expected);
    if (dropRead && options.method === 'GET' && !path.endsWith('/decision-reasons')) {
      dropRead = false; throw Error('Owned transport lost one readback');
    }
    if (path.endsWith('/decision')) {
      const body = JSON.parse(options.body); commands.push(body);
      assert.deepEqual(Object.keys(body).sort(), ['commandId', 'runId', 'decision', 'expectedOfferVersion',
        'expectedHoldVersion', 'expectedQuoteVersion', ...(body.decision === 'decline' ? ['reasonCode'] : [])].sort());
      assert.equal(options.body.includes(token), false);
    }
    const response = await request(url, options);
    if (response.responseHeaders.has('set-cookie')) jar = cookiePair(response.responseHeaders.get('set-cookie'));
    if (response.answer.status === 'ok' && response.answer.value?.quote) lastPublic = response.answer.value;
    if (loseResponse && path.endsWith('/decision') && !droppedCommand && response.answer.status === 'ok') {
      droppedCommand = true; dropRead = true; throw Error('Owned transport lost one committed response');
    }
    return { ok: response.status >= 200 && response.status < 300,
      headers: { get: (key) => response.responseHeaders.get(key.toLowerCase()) }, json: async () => response.answer };
  };
  const dom = new JSDOM('<!doctype html><body><main></main>', { url: origin });
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  let cleared = false;
  const adapter = createOfferHttpAdapter({ enableDecisions: true, fetch, location: { href: link.href },
    history: { replaceState: (_state, _title, clean) => { assert.equal(clean.includes('#'), false); cleared = true; } } });
  assert.equal(cleared, true);
  const controller = createOfferController({ ...adapter, createCommandId: () => `decision-${label}` });
  const root = dom.window.document.querySelector('main');
  const view = createOfferView(root); const unsubscribe = controller.subscribe(view.update);
  t.after(() => { unsubscribe(); controller.destroy(); view.destroy(); dom.window.close();
    globalThis.document = previous.document; globalThis.window = previous.window; });
  const business = () => inputDigest(Object.fromEntries(['offers', 'holds', 'claims', 'stock', 'quotes', 'briefs',
    'decisions', 'pending_operations', 'notification_outbox'].map((table) => [table, store.state.tables[table]])));
  const assertCustody = (value) => {
    assert.equal(JSON.stringify(value).includes(token), false);
    const credential = jar.split('=')[1];
    for (const [table, records] of Object.entries(store.state.tables)) {
      if (table !== 'notification_outbox') assert.equal(JSON.stringify(records).includes(token), false, table);
      if (credential) assert.equal(JSON.stringify(records).includes(credential), false, table);
    }
    assert.equal(/employeeId|principalId|tokenHash|tokenMetadata|employeeVersion|slotVersion|"binding"/.test(JSON.stringify(lastPublic)), false);
  };
  const writer = policy.withPublicationPorts({ identity, clock, repository });
  const greg = yes(await identity.switchPrincipal(presenter.context, 'demo-greg', 'greg')).context;
  const adopt = async () => {
    const time = yes(await clock.now(context)); const run = await read('runs');
    return yes(await writer.adoptReviewedAssumptions(greg, { commandId: 'adopt-reasons',
      expectedActiveVersion: run.policyVersion, policyVersion: 'fucq105-reasons-v2', effectiveFrom: time.now,
      definitionSetId: 'offer-decline-reasons-v1' }));
  };
  return { controller, root, adapter, request, selector, origin, produced, read, rows, business, assertCustody,
    employeeCookie, OFFER_ACCESS_COOKIE, accountResolutions: () => accountResolutions, commands, adopt,
    policy, writer, greg, context, clock, advanceTo, activateRunPolicy, repository, DECLINE_REASONS_KEY, DECISION_EVENTS,
    loseResponse: () => { loseResponse = true; }, useAccount: () => { jar = employeeCookie; },
    cookie: () => jar, publicOffer: () => lastPublic };
}

test('actual106 acceptance reaches105 through one private102 instance and survives lost response/readback', {
  skip: enabled ? false : 'Requires the reviewed finite105 decision supervisor.',
}, async (t) => {
  const f = await setup(t, 'accept'); const initial = await f.controller.refresh();
  assert.equal(initial.state, 'pending'); assert.equal(initial.canAccept, true);
  assert.deepEqual(initial.reference, { ...f.selector, offerVersion: f.produced.offer.version,
    holdVersion: f.produced.hold.version, quoteVersion: f.produced.quote.version });
  const originalQuote = await f.read('quotes', { quoteId: f.produced.quote.quoteId });
  const originalDeadline = initial.expiresAt; const before = f.business();
  const command = { commandId: 'refused-stale', runId: f.selector.runId, decision: 'accept',
    expectedOfferVersion: initial.reference.offerVersion, expectedHoldVersion: initial.reference.holdVersion,
    expectedQuoteVersion: initial.reference.quoteVersion + 1 };
  const decisionURL = `/api/gcsp/offers/${encodeURIComponent(f.selector.offerId)}/decision`;
  const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const invalidCookie = `${f.OFFER_ACCESS_COOKIE}=invalid; ${f.employeeCookie}`;
  const priorAccounts = f.accountResolutions();
  assert.notEqual((await f.request(decisionURL, post(command), invalidCookie)).answer.status, 'ok');
  assert.equal(f.accountResolutions(), priorAccounts);
  const readURL = `/api/gcsp/offers/${encodeURIComponent(f.selector.offerId)}?runId=${encodeURIComponent(f.selector.runId)}`;
  assert.notEqual((await f.request(readURL, { method: 'GET' }, invalidCookie)).answer.status, 'ok');
  assert.equal((await f.request(decisionURL, post(command))).answer.status, 'stale-version');
  assert.equal((await f.request(decisionURL, post(command), f.cookie(), true, 'https://refused-synthetic.test')).answer.status, 'forbidden');
  assert.equal((await f.request(decisionURL, post(command), f.cookie(), false)).status, 401);
  assert.equal(f.business(), before);
  assert.equal((await f.rows('event_receipts', { consumerId: f.DECISION_EVENTS })).length, 0);
  await checkpoint('same-instance-revisions-invalid-cookie-origin-gate-and-stale-refusal');

  f.loseResponse(); await f.controller.decision('accept');
  assert.equal(f.controller.snapshot().state, 'uncertain');
  assert.equal(f.controller.snapshot().canAccept, false); assert.match(f.root.textContent, /could not be confirmed/);
  assert.equal((await f.rows('decisions')).length, 1);
  const accepted = await f.controller.refresh(); assert.equal(accepted.state, 'accepted');
  assert.match(f.root.textContent, /Offer accepted/); assert.equal(accepted.expiresAt, originalDeadline);
  assert.equal(accepted.card.members[0].terms[0].value, initial.card.members[0].terms[0].value);
  assert.equal((await f.read('stock', { orderUuid: f.produced.quote.orderUuid })).state, 'allocated');
  assert.equal((await f.read('entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId })).state, 'allocated');
  assert.equal(JSON.stringify(await f.read('quotes', { quoteId: originalQuote.quoteId })) === JSON.stringify(originalQuote), true);
  f.useAccount();
  const replay = await f.request(decisionURL, post(f.commands[0]), f.employeeCookie);
  assert.equal(replay.answer.status, 'ok'); assert.equal(replay.answer.value.state, 'accepted');
  assert.equal(f.accountResolutions() > priorAccounts, true);
  const account = await f.controller.refresh(); assert.equal(account.state, 'accepted');
  assert.equal((await f.rows('decisions')).length, 1);
  const events = await f.rows('event_receipts', { consumerId: f.DECISION_EVENTS });
  assert.equal(events.length, 1); assert.equal(events[0].eventType, 'offer-accepted');
  f.assertCustody(account); f.assertCustody(replay.answer);
  await checkpoint('actual-commit-loss-uncertainty-authoritative-accepted-account-replay-once');
});

test('canonical adoption and changed reason label reach105 required control and real decline after quote expiry', {
  skip: enabled ? false : 'Requires the reviewed finite105 decision supervisor.',
}, async (t) => {
  const f = await setup(t, 'decline'); const initial = await f.controller.refresh();
  const originalQuote = await f.read('quotes', { quoteId: f.produced.quote.quoteId });
  const originalBriefs = await f.rows('briefs'); const before = f.business();
  await f.controller.decision('decline');
  assert.equal(f.controller.snapshot().declineReason.status, 'unavailable');
  assert.equal(f.commands.length, 0); assert.equal(f.business(), before);
  await f.adopt();
  await f.controller.refreshDeclineReasons();
  const loaded = f.controller.snapshot().declineReason; assert.equal(loaded.status, 'ready');
  const time = yes(await f.clock.now(f.context));
  const registered = yes(await f.policy.getAssumption(f.DECLINE_REASONS_KEY,
    { runId: f.context.runId, asOf: time.now, policyVersion: loaded.policyVersion }));
  assert.deepEqual(loaded.choices, registered.value.reasons);
  await f.controller.decision('decline', { reasonCode: '' });
  assert.match(f.controller.snapshot().declineReason.error, /Choose a reason/); assert.equal(f.commands.length, 0);
  const choice = loaded.choices[0]; f.controller.selectDeclineReason(choice.code);
  const select = f.root.querySelector('select'); const card = f.root.querySelector('.vm-card');
  assert.ok(card); assert.ok(select);
  const changed = structuredClone(registered.value); changed.reasons[0].label = `${choice.label} (revised)`;
  const effectiveFrom = new Date(Date.parse(time.now) + 1000).toISOString();
  await f.advanceTo(effectiveFrom, 'reason-label-time');
  yes(await f.writer.publishPolicyVersion(f.greg, { commandId: 'reason-label-publication',
    expectedActiveVersion: loaded.policyVersion, policyVersion: 'fucq105-reasons-v3', effectiveFrom,
    changes: [{ table: 'assumptions', key: f.DECLINE_REASONS_KEY, patch: { value: changed, status: 'assumed',
      source: 'docs/gcsp/evidence/fucq105/decision-mixed-plan.md', sourceDate: '2026-11-06',
      basis: 'Isolated canonical consumer regression; not a new seed or browser fallback.' } }] }));
  yes(await f.activateRunPolicy({ repository: f.repository, policy: f.policy }, f.greg));
  await f.controller.refresh();
  const refreshed = f.controller.snapshot(); assert.equal(refreshed.declineReason.policyVersion, 'fucq105-reasons-v3');
  assert.equal(f.root.querySelector('select'), select); assert.equal(f.root.querySelector('.vm-card'), card);
  assert.equal(select.options[1].textContent, changed.reasons[0].label);
  assert.equal(refreshed.declineReason.selectedCode, choice.code); assert.equal(refreshed.expiresAt, initial.expiresAt);
  await checkpoint('canonical-missing-adopted-published-reason-list-required-and-mounted-refresh');

  const afterQuote = new Date(Date.parse(originalQuote.validUntil) + 1000).toISOString();
  assert.equal(Date.parse(afterQuote) < Date.parse(initial.expiresAt), true);
  await f.advanceTo(afterQuote, 'quote-expiry'); await f.controller.refresh();
  assert.equal(f.controller.snapshot().canAccept, false); assert.equal(f.controller.snapshot().canDecline, true);
  assert.equal(f.controller.snapshot().expiresAt, initial.expiresAt);
  await f.controller.decision('decline', { reasonCode: choice.code });
  const declined = f.controller.snapshot(); assert.equal(declined.state, 'declined'); assert.match(f.root.textContent, /Offer declined/);
  assert.equal(declined.expiresAt, initial.expiresAt); assert.equal(declined.canDecline, false);
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].reasonCode, choice.code);
  assert.equal(f.commands[0].expectedQuoteVersion, originalQuote.version);
  assert.equal(JSON.stringify(await f.read('quotes', { quoteId: originalQuote.quoteId })) === JSON.stringify(originalQuote), true);
  assert.equal(JSON.stringify(await f.rows('briefs')) === JSON.stringify(originalBriefs), true);
  assert.equal((await f.read('stock', { orderUuid: originalQuote.orderUuid })).available, true);
  const decisions = await f.rows('decisions'); assert.equal(decisions.length, 1);
  assert.equal(decisions[0].reason.label, changed.reasons[0].label);
  assert.equal(decisions[0].reason.policyVersion, 'fucq105-reasons-v3');
  assert.equal(decisions[0].versions.quotePolicy, originalQuote.policyVersion);
  assert.equal(decisions[0].versions.exclusion.policyVersion, 'fucq105-reasons-v3');
  const events = await f.rows('event_receipts', { consumerId: f.DECISION_EVENTS });
  assert.equal(events.length, 1); assert.equal(events[0].eventType, 'offer-declined');
  assert.equal(events[0].outcome.value.event.reasonCode, choice.code);
  f.assertCustody(declined);
  await checkpoint('actual106-decline-after-quote-expiry-original-hold-quote-brief-and-event-once');
});
