import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { writeFile } from 'node:fs/promises';

const enabled = Boolean(process.env.GCSP_FUCQ105_MODULE_MAP && process.env.GCSP_FUCQ105_CHECKPOINT);

// Deliberately selected through the owned supervisor; a normal suite cannot import uncomposed foreign modules.
test('actual producer to access HTTP to offer view preserves authority, custody, timing and reset', {
  skip: enabled ? false : 'Run the root-approved bounded FUCQ-105 producer supervisor.',
}, async (t) => {
  let phase = 'imports'; const completed = [];
  const record = async (failure) => writeFile(process.env.GCSP_FUCQ105_CHECKPOINT, JSON.stringify({
    completed, ...(failure ? { failure } : {}), synthetic: true,
    scope: 'Actual memory producer/access/streamed HTTP/controller/DOM; no browser, real106 or deployed host.',
  }, null, 2) + '\n');
  const checkpoint = async (name) => { completed.push(name); await record(); };
  try {
    const [{ createMemoryRepository, createMemoryStore, inputDigest }, { createPolicyService }, { createDemoRuntime },
      { BriefService }, { seedManualDemoContext }, { BuddyHoldService }, { verifyOfferToken },
      { createOfferAccessService }, { createOfferAccessHandler }, { stock, essential, preference },
      { createOfferHttpAdapter }, { createOfferController }, { createOfferView }, { JSDOM }] = await Promise.all([
      import('../gcsp/repository/index.js'), import('../gcsp/policy/index.js'), import('../gcsp/clock/index.js'),
      import('../gcsp/brief/index.js'), import('../gcsp/manual-context/fixtures.js'), import('../gcsp/offers/buddy-hold.js'),
      import('../gcsp/offers/offer-token.js'), import('../gcsp/offers/access.js'), import('../gcsp/offers/access-http.js'),
      import('./helpers/employee-recommendation.js'), import('../../blocks/gcsp/offer/http-adapter.js'),
      import('../../blocks/gcsp/offer/offer-controller.js'), import('../../blocks/gcsp/offer/offer-view.js'), import('jsdom'),
    ]);
    const passed = (outcome) => { assert.equal(outcome?.status, 'ok'); return outcome.value; };
    phase = 'real-runtime-and-allocation';
    const store = createMemoryStore(); const repository = createMemoryRepository({ store });
    passed(await repository.open()); t.after(() => repository.close());
    const policy = createPolicyService(); const wall = '2026-11-05T12:00:00.000Z';
    const { clock, identity } = passed(await createDemoRuntime({ repository, policy,
      environmentId: 'fucq105-producer-view-proof', environmentKind: 'synthetic', policyAsOf: wall,
      commandId: 'view-bootstrap', sessionNow: () => wall }));
    const presenter = passed(await identity.createPresenterSession('view-presenter'));
    const acting = passed(await identity.switchPrincipal(presenter.context, 'demo-paula', 'view-paula'));
    const context = acting.context;
    const ref = (table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
    passed(await seedManualDemoContext({ repository, identity, clock, context }));
    const advanceTo = async (instant, commandId) => {
      const time = passed(await clock.now(context));
      return passed(await clock.advance(presenter.context, { commandId, expectedClockVersion: time.clockVersion,
        bySeconds: (Date.parse(instant) - Date.parse(time.now)) / 1000 }));
    };
    const tick = async (eventId) => {
      const time = passed(await clock.now(context));
      return passed(await clock.tick(presenter.context, { eventId, inputDigest: inputDigest(eventId), expectedClockVersion: time.clockVersion }));
    };
    await advanceTo(wall, 'view-noon');
    const brief = new BriefService({ repository, policy, clock, identity });
    passed(await brief.saveDraft(context, { commandId: 'view-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
      brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
    passed(await brief.confirm(context, { commandId: 'view-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
      consent: { search: true, hold: true } }));
    const car = stock(1);
    passed(await repository.transaction(context, { commandId: 'view-stock', inputDigest: inputDigest('view-stock') },
      (tx) => tx.insert('stock', { runId: context.runId, orderUuid: car.orderUuid, orderNumber: '0123456',
        configurationId: car.configurationId, state: 'released', available: true, held: false, allocated: false,
        facts: car.snapshot, release: { eventId: 'explicit-synthetic-release', availability: car.availability },
        visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } })));
    const employee = passed(await repository.read(context, ref('employees', { employeeId: context.employeeId })));
    const slot = passed(await repository.read(context, ref('entitlement_slots', { entitlementSlotId: context.entitlementSlotId })));
    const input = { commandId: 'view-allocate', orderUuid: car.orderUuid, expectedBriefVersion: 1,
      expectedStockVersion: 1, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version };
    const producer = new BuddyHoldService({ repository, policy, clock, identity, adapter: { mode: 'local-synthetic' } });
    const allocated = passed(await producer.allocate(context, input));
    const jobs = passed(await repository.query(context, 'notification_outbox')); assert.equal(jobs.length, 1);
    // Only committed outbox custody supplies the credential. Never assert/print the raw link or token.
    let link;
    try { link = new URL(jobs[0].payload.offerLink, 'https://explicit-synthetic.test'); }
    catch { throw Error('Outbox link unavailable'); }
    const token = new URLSearchParams(link.hash.slice(1)).get('token');
    assert.equal(typeof token, 'string'); assert.equal(token.length, 43);
    const selector = { runId: link.searchParams.get('runId'), offerId: link.searchParams.get('offerId') };
    assert.equal(selector.runId, context.runId); assert.equal(selector.offerId, allocated.offer.offerId);
    const accessOptions = { repository, policy, clock, identity, environmentId: context.environmentId,
      sessionNow: () => wall, verifyOfferToken };
    let access = createOfferAccessService(accessOptions);
    let handler = createOfferAccessHandler({ service: access, identity, allowedOrigins: ['https://explicit-synthetic.test'] });
    let cookie = ''; let allowedOrigin = true; let latestDTO; const calls = [];
    const fetch = async (url, options) => {
      const target = new URL(url); const headers = { origin: allowedOrigin ? 'https://explicit-synthetic.test' : 'https://refused-synthetic.test' };
      for (const [key, value] of Object.entries(options.headers || {})) headers[key.toLowerCase()] = value;
      if (cookie) headers.cookie = cookie;
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body).sort(), ['offerId', 'runId', 'token']);
        assert.equal(body.token === token, true); // Boolean comparison cannot disclose either credential.
      } else assert.equal(options.body, undefined);
      assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer');
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'same-origin');
      calls.push({ method: options.method, pathname: target.pathname });
      const req = Readable.from(options.body ? [options.body] : []); req.method = options.method; req.headers = headers;
      const responseHeaders = new Map(); let responseStatus; let answer;
      const res = { setHeader: (key, value) => responseHeaders.set(key.toLowerCase(), value) };
      await handler({ req, res, pathname: target.pathname, searchParams: target.searchParams, gateAuthorized: true,
        sendJson: (_res, status, value, extra = {}) => {
          responseStatus = status; answer = value;
          responseHeaders.set('content-type', 'application/json');
          for (const [key, value] of Object.entries(extra)) responseHeaders.set(key.toLowerCase(), value);
        } });
      assert.equal(responseHeaders.get('cache-control'), 'no-store');
      assert.equal(responseHeaders.get('referrer-policy'), 'no-referrer');
      if (responseHeaders.has('set-cookie')) cookie = responseHeaders.get('set-cookie').split(';')[0];
      if (answer.status === 'ok') latestDTO = structuredClone(answer.value);
      return { ok: responseStatus >= 200 && responseStatus < 300,
        headers: { get: (name) => responseHeaders.get(name.toLowerCase()) }, json: async () => structuredClone(answer) };
    };
    const business = () => JSON.stringify(Object.fromEntries(['offers', 'holds', 'stock', 'claims', 'quotes', 'notification_outbox']
      .map((table) => [table, store.state.tables[table]])));
    const custody = (safe) => {
      assert.equal(JSON.stringify(safe).includes(token), false);
      const credential = cookie.split('=')[1];
      for (const [table, rows] of Object.entries(store.state.tables)) {
        if (table !== 'notification_outbox') assert.equal(JSON.stringify(rows).includes(token), false, table);
        if (credential) assert.equal(JSON.stringify(rows).includes(credential), false, table);
      }
      assert.equal(JSON.stringify(latestDTO).match(/employeeId|principalId|tokenHash|tokenMetadata|contractId|employeeVersion|slotVersion|"binding"/), null);
    };
    await checkpoint(phase);

    phase = 'real-exchange-to-shared-view';
    const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', { url: 'https://explicit-synthetic.test/' });
    const previous = { document: globalThis.document, window: globalThis.window };
    globalThis.document = dom.window.document; globalThis.window = dom.window;
    t.after(() => { dom.window.close(); globalThis.document = previous.document; globalThis.window = previous.window; });
    const scheduled = new Map(); let timerId = 0; let reading;
    let cleared = false; let cleanEntry;
    const adapter = createOfferHttpAdapter({ location: { href: link.href }, fetch,
      history: { replaceState: (_state, _title, clean) => { assert.equal(clean.includes('#'), false); cleared = true; cleanEntry = clean; } },
      schedule: (callback, milliseconds) => { assert.equal(milliseconds, 5000); scheduled.set(++timerId, callback); return timerId; },
      cancel: (id) => scheduled.delete(id) });
    assert.equal(cleared, true); assert.equal(calls.length, 0);
    const controller = createOfferController(adapter); const root = dom.window.document.querySelector('main');
    const view = createOfferView(root); const unsubscribe = controller.subscribe(view.update);
    const unsubscribeClock = adapter.subscribeClock(() => { reading = controller.refresh(); });
    t.after(() => { unsubscribeClock(); unsubscribe(); controller.destroy(); view.destroy(); assert.equal(scheduled.size, 0); });
    const beforeRead = business(); const initial = await controller.refresh();
    assert.equal(business() === beforeRead, true); assert.equal(initial.state, 'pending');
    assert.deepEqual(initial.actions, { accept: true, decline: true });
    assert.equal(initial.canAccept, false); assert.equal(initial.canDecline, false); assert.equal(initial.decisionUnavailable, true);
    assert.equal(initial.seconds, 7200); assert.equal(initial.expiresAt, allocated.hold.expiresAt);
    const member = initial.card.members[0];
    assert.equal(member.identity.orderUuid, allocated.quote.orderUuid); assert.equal(member.identity.configurationId, allocated.quote.configurationId);
    assert.equal(member.provenance.quoteId, allocated.quote.quoteId); assert.deepEqual(member.provenance.revisions, latestDTO.quote.revisions);
    assert.equal(member.display.line, 'Order no. 0123456'); assert.equal(member.terms[0].value, 1100); assert.equal(member.terms[0].allowance, 1300);
    assert.equal(initial.currentCar.status, 'partial'); assert.equal(initial.comparisonAvailable, false);
    assert.deepEqual(initial.currentCar.source, allocated.quote.eligibility.currentCarComparison.display.source);
    assert.equal(initial.currentCar.display.name, allocated.quote.eligibility.currentCarComparison.display.model);
    assert.equal(initial.currentCar.facts.length, 8); assert.ok(initial.currentCar.facts.every((f) => f.value === null));
    assert.match(root.textContent, /Order no\. 0123456/); assert.match(root.textContent, /1,100 points a month.*1,300 points a month allowance/);
    assert.match(root.textContent, /Partial comparison/); assert.match(root.textContent, /Fitted equipment unknown/);
    assert.match(root.textContent, /Observed 2026-11-05T09:00:00\.000Z/); assert.match(root.textContent, /2 hours remaining/);
    assert.equal(root.querySelectorAll('.vm-card').length, 1); assert.equal(root.querySelectorAll('.gcsp-offer-current dd.is-missing').length, 8);
    assert.ok([...root.querySelectorAll('[data-offer-action="accept"], [data-offer-action="decline"]')].every((node) => node.disabled));
    custody({ allocated, initial }); await checkpoint(phase);

    phase = 'replay-reload-account-and-credential-custody';
    const replay = passed(await producer.allocate(context, input)); assert.equal(JSON.stringify(replay) === JSON.stringify(allocated), true);
    const initialDTO = structuredClone(latestDTO); const beforeParity = business();
    access = createOfferAccessService(accessOptions);
    handler = createOfferAccessHandler({ service: access, identity, allowedOrigins: ['https://explicit-synthetic.test'] });
    const reloaded = createOfferHttpAdapter({ location: { href: new URL(cleanEntry, link.origin).href }, fetch });
    assert.equal((await reloaded.read()).status, 'ok'); assert.equal(JSON.stringify(latestDTO) === JSON.stringify(initialDTO), true);
    const account = passed(await access.fromAccount(context, selector)).offer;
    assert.equal(JSON.stringify(account) === JSON.stringify(initialDTO), true); assert.equal(business() === beforeParity, true);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    for (const table of ['holds', 'offers', 'quotes', 'notification_outbox']) assert.equal(passed(await repository.query(context, table)).length, 1);
    custody({ replay, account }); await checkpoint(phase);

    phase = 'real-quote-expiry-to-decline-only-readback';
    passed(await producer.start()); const beforeQuoteExpiry = business();
    await advanceTo(allocated.quote.validUntil, 'view-quote-expiry'); await tick('view-quote-expiry-tick');
    assert.equal(business() === beforeQuoteExpiry, true);
    const cardNode = root.querySelector('.vm-card'); const refreshNode = root.querySelector('[data-offer-action="refresh"]'); refreshNode.focus();
    const [id, callback] = scheduled.entries().next().value; scheduled.delete(id); callback(); await reading;
    const decline = controller.snapshot();
    assert.equal(decline.state, 'pending'); assert.deepEqual(decline.actions, { accept: false, decline: true });
    assert.equal(decline.seconds, 3600); assert.equal(decline.expiresAt, initial.expiresAt);
    assert.equal(decline.canAccept, false); assert.equal(decline.canDecline, false); // No FUCQ-106 port was injected.
    assert.equal(root.querySelector('.vm-card'), cardNode); assert.equal(dom.window.document.activeElement, refreshNode);
    assert.match(root.textContent, /1 hour remaining/); assert.equal(latestDTO.holdState, 'active');
    assert.equal(latestDTO.offerState, 'active'); assert.equal(business() === beforeQuoteExpiry, true);
    custody(decline); await checkpoint(phase);

    phase = 'real-hold-expiry-terminal-readback';
    await advanceTo(allocated.hold.expiresAt, 'view-hold-expiry'); await tick('view-hold-expiry-tick');
    assert.equal(passed(await repository.read(context, ref('offers', { offerId: selector.offerId }))).state, 'expired');
    assert.equal(passed(await repository.read(context, ref('holds', { holdId: allocated.hold.holdId }))).state, 'expired');
    const released = passed(await repository.read(context, ref('stock', { orderUuid: car.orderUuid })));
    assert.equal(released.state, 'released'); assert.equal(released.available, true); assert.equal(released.held, false);
    const beforeTerminalReads = business();
    for (let i = 0; i < 2; i++) {
      const expired = await controller.refresh(); assert.equal(expired.state, 'expired');
      assert.equal(expired.expiresAt, initial.expiresAt); assert.deepEqual(expired.actions, { accept: false, decline: false });
      assert.match(root.textContent, /Offer expired/); assert.equal(root.querySelectorAll('[data-offer-action="accept"], [data-offer-action="decline"]').length, 0);
    }
    assert.equal(business() === beforeTerminalReads, true); custody(controller.snapshot()); await checkpoint(phase);

    phase = 'real-reset-authenticated-earlier-run-and-tamper-refusal';
    const state = passed(await clock.readState(presenter.context));
    passed(await clock.reset(presenter.context, { commandId: 'view-reset', expectedRunId: state.runId,
      expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture }));
    const stale = await controller.refresh(); assert.equal(stale.state, 'earlier-run'); assert.equal(stale.reference, undefined);
    assert.equal(root.querySelector('.vm-card'), null); assert.equal(root.querySelector('.gcsp-offer-current'), null);
    assert.equal(root.querySelectorAll('[data-offer-action="accept"], [data-offer-action="decline"]').length, 0);
    const tampered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    assert.equal((await access.exchange({ ...selector, token: tampered })).status, 'not-found');
    assert.equal((await access.exchange({ ...selector, offerId: 'unknown', token })).status, 'not-found');
    custody(stale); await checkpoint(phase);

    phase = 'real-handler-unavailable-and-origin-refusal';
    handler = createOfferAccessHandler({ identity, allowedOrigins: ['https://explicit-synthetic.test'] });
    assert.equal((await controller.refresh()).state, 'error'); assert.equal(root.querySelector('.vm-card'), null);
    handler = createOfferAccessHandler({ service: access, identity, allowedOrigins: ['https://explicit-synthetic.test'] });
    allowedOrigin = false;
    assert.equal((await controller.refresh()).state, 'refused'); assert.equal(root.querySelector('.vm-card'), null);
    custody(controller.snapshot()); await checkpoint(phase);
  } catch (error) {
    // Keep diagnostic location/phase without ever retaining provider errors, request bodies or credentials.
    const location = String(error?.stack || '').split('\n').find((line) => line.includes('gcsp-offer-view-producer.test.js:'))?.trim();
    await record({ phase, kind: error?.name || 'Error', operator: error?.operator || null, location: location || null });
    throw Error(`Producer-to-view proof failed during ${phase}; see the safe phase checkpoint.`);
  }
});
