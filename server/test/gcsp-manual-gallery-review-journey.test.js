// AUTHOR ONLY. Exact F100 source snapshot and ordinary dependencies must be
// materialized/admitted separately; this checkout's older product is not the target.
// One bounded producer/HTTP/host case; no listener, browser, reset or F71 submission.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { Readable } from 'node:stream';
import { JSDOM } from 'jsdom';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createCompositionTestProfile } from './helpers/runtime-composition-profile.js';

const origin = 'https://composition.test';
// Compare booleans with fixed diagnostics: assertion output must never dump a
// cookie, principal, account, contact, command body, quote or server envelope.
const check = (value, message) => assert.equal(Boolean(value), true, message);
const same = (actual, expected, message) => check(isDeepStrictEqual(actual, expected), message);
const good = (value) => { check(value?.status === 'ok', 'Actual authority operation must succeed.'); return value.value; };
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });
const pause = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  for (let turns = 0; turns < 2000 && Date.now() < deadline; turns += 1) {
    if (predicate()) return;
    await pause();
  }
  check(predicate(), message);
}
async function within(operation, message) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

test('actual released TEST stock reaches the delivered host gallery and one quoted review without reclaim', { timeout: 30000 }, async (t) => {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  const profile = createCompositionTestProfile();
  const runtime = good(await createGcspRuntime({ mode: 'memory', repository, stockProvider: profile,
    environmentId: 'fucq69-host-journey-TEST', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'fucq69-host-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  let dom; let destroy; let root; let releaseRead = () => {};
  const pending = new Set(); const previous = new Map();
  // Register cleanup immediately after the owned runtime exists, including failed setup.
  t.after(async () => {
    try {
      destroy?.(); releaseRead();
      await within(Promise.allSettled([...pending]), 'Owned HTTP work did not settle before teardown.');
    } finally {
      try { await within(runtime.close(), 'Owned runtime did not close before teardown.'); }
      finally {
        root?.remove(); dom?.window.close();
        for (const [key, descriptor] of previous) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else delete globalThis[key];
        }
      }
    }
  });
  const local = good(await runtime.createLocalSession());
  const context = local.context;
  const cookie = [local.setCookie].flat().map((entry) => entry.split(';')[0]).join('; ');
  const server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] });
  good(await server.gcspStartup);
  const handlers = server.listeners('request');
  check(handlers.length === 1, 'Use the one actual HTTP request receiver.');
  const counts = new Map(); const commands = [];
  let armRead = false; let heldRead = null;
  // Only these actual routes are admitted; this bridge has no network fallback.
  const allowed = new Set(['GET /api/gcsp/manual/account', 'GET /api/gcsp/manual/draft',
    'POST /api/gcsp/manual/draft', 'GET /api/gcsp/manual/stock', 'GET /api/gcsp/manual/claim',
    'POST /api/gcsp/manual/claim', 'GET /api/gcsp/manual/review-details',
    'POST /api/gcsp/manual/review-details', 'POST /api/gcsp/manual/claim/review',
    'GET /api/gcsp/presenter/clock', 'POST /api/gcsp/presenter/clock/advance',
    'POST /api/gcsp/presenter/clock/tick']);
  const count = (method, path) => counts.get(`${method} ${path}`) ?? 0;
  function fetchActual(url, options = {}) {
    const operation = (async () => {
      const parsed = new URL(url, origin); const method = options.method ?? 'GET';
      check(parsed.origin === origin && !parsed.search && !parsed.hash, 'Only the admitted local HTTP origin is permitted.');
      const key = `${method} ${parsed.pathname}`;
      check(allowed.has(key), 'Only the selected actual HTTP route is permitted.');
      if (options.signal?.aborted) throw new Error('Owned request was aborted.');
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const body = options.body === undefined ? undefined : JSON.parse(options.body);
      if (body !== undefined) commands.push({ path: parsed.pathname, body: structuredClone(body) });
      const req = Readable.from(options.body === undefined ? [] : [Buffer.from(options.body)]);
      Object.assign(req, { url: parsed.pathname, method, headers: { host: 'composition.test', origin, cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) } });
      const response = { headers: {}, ended: false,
        setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
        writeHead(status, headers = {}) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
        end(value) { this.body = value; this.ended = true; } };
      await handlers[0](req, response);
      check(response.ended && Number.isSafeInteger(response.status), 'Actual HTTP receiver must finish its response.');
      const envelope = response.body ? JSON.parse(String(response.body)) : null;
      // Delay only delivery of a completed, genuine subsequent GET, never its contents.
      if (armRead && key === 'GET /api/gcsp/manual/claim' && count('POST', '/api/gcsp/manual/claim') === 1) {
        armRead = false; heldRead = envelope;
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (aborted = false) => {
            if (settled) return; settled = true;
            options.signal?.removeEventListener('abort', abort);
            if (aborted) reject(new Error('Owned current-read delivery was aborted.')); else resolve();
          };
          const abort = () => finish(true);
          releaseRead = () => finish();
          options.signal?.addEventListener('abort', abort, { once: true });
          if (options.signal?.aborted) abort();
        });
      }
      if (options.signal?.aborted) throw new Error('Owned request was aborted.');
      return { status: response.status, ok: response.status >= 200 && response.status < 300,
        headers: new Headers(response.headers), json: async () => structuredClone(envelope) };
    })();
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  }
  const request = async (path, body) => {
    const response = await fetchActual(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
    check(response.status === 200, 'Selected actual HTTP request must return 200.');
    return good(await response.json());
  };
  const account = await request('/api/gcsp/manual/account');
  check(account.state === 'ready', 'The actual employee account must be ready.');
  const beforeContract = structuredClone(account.currentContract);
  dom = new JSDOM('<!doctype html><body></body>', { url: origin, pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'fetch']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true,
      value: key === 'fetch' ? fetchActual : key === 'window' ? dom.window : dom.window[key] });
  }
  root = document.createElement('div'); document.body.append(root);
  let confirmed = 0; let reviewReady = 0; let continued = 0; let handoff; let continuation;
  root.addEventListener('gcsp:manual-claim-confirmed', (event) => { confirmed += 1; handoff = event.detail; });
  root.addEventListener('gcsp:manual-review-ready', () => { reviewReady += 1; });
  // UI class definitions require the owned DOM globals; no test module is imported as a helper.
  const { mountManualJourney } = await import('../../blocks/gcsp/manual-setup/journey.js');
  let sequence = 0;
  destroy = mountManualJourney(root, { commandId: () => `fucq69-host:${++sequence}`,
    onReviewContinue(detail) { continued += 1; continuation = detail; } });
  const heading = () => root.querySelector('h1')?.textContent;
  const button = (label) => [...root.querySelectorAll('button')].find((node) => node.textContent === label && !node.closest('[hidden]'));
  const click = (label) => { const node = button(label); check(node && !node.disabled, 'Expected enabled ordinary host control.'); node.click(); return node; };
  const edit = (name, value) => {
    const node = root.querySelector(`[name="${name}"]`);
    check(node && !node.disabled, 'Expected editable ordinary host field.'); node.value = String(value);
    node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  await waitFor(() => heading() === 'Your cars' && button('Choose a replacement'), 'Actual host account must mount.');
  click('Choose a replacement');
  await waitFor(() => heading() === 'Your order choices' && root.querySelector('[name="driverId"]')?.disabled === false,
    'Actual host setup must mount.');
  const driver = account.choices.drivers.find((entry) => entry.kind === 'employee');
  check(driver, 'Actual account supplies an employee driver.');
  const option = account.choices.contractOptions.find((entry) => entry.schemeIds.includes(context.schemeId) && entry.driverKinds.includes(driver.kind));
  check(option, 'Actual account supplies a compatible term.');
  const location = account.choices.collectionLocations.find((entry) => entry.contractOptionIds.includes(option.contractOptionId) && entry.driverKinds.includes(driver.kind));
  check(location, 'Actual account supplies a compatible collection location.');
  edit('driverId', driver.driverId); edit('contractOptionId', option.contractOptionId);
  const date = root.querySelector('[name="requestedCollectionDate"]');
  const requestedDate = [date.min, account.currentContract.earliestCollectionDate].filter(Boolean).sort().at(-1);
  check(requestedDate && (!date.max || requestedDate <= date.max), 'Use the actual permitted collection window.');
  edit('requestedCollectionDate', requestedDate); edit('collectionLocationId', location.locationId);
  edit('expectedReturnMileage', account.currentContract.currentOdometer.value);
  click('Save choices');
  await waitFor(() => root.textContent.includes('Your choices are saved.') && !button('Continue')?.disabled && pending.size === 0,
    'Actual choices must save and availability must settle.');
  const saved = await request('/api/gcsp/manual/draft');
  check(saved.draftStage === 'complete', 'Actual saved draft must be complete before TEST preparation.');
  const car = await profile.prepare(runtime, context);
  check(profile.calls.length === 0, 'TEST preparation must not call the stock producer.');
  check(!store.state.tables.stock.some((row) => row.orderUuid === car.orderUuid), 'TEST preparation must not write stock.');
  const stockBefore = structuredClone(store.state.tables.stock);
  let clock = await request('/api/gcsp/presenter/clock');
  check(Date.parse(clock.now) < Date.parse('2026-11-05T12:00:00.000Z'), 'Actual TEST clock must precede its release window.');
  await request('/api/gcsp/presenter/clock/advance', { commandId: 'fucq69-host-advance',
    expectedClockVersion: clock.clockVersion, to: '2026-11-05T12:00:00.000Z' });
  clock = await request('/api/gcsp/presenter/clock');
  const released = await request('/api/gcsp/presenter/clock/tick', { eventId: 'fucq69-host-release',
    inputDigest: inputDigest('fucq69-host-release'), expectedClockVersion: clock.clockVersion });
  check(profile.calls.length === 1, 'One actual presenter tick must pull the TEST provider once.');
  const release = good(released.outcomes.find((row) => row.handlerId === 'stock-release')?.outcome);
  same(release.orderUuids, [car.orderUuid], 'Actual producer must release the exact TEST order.');
  const committed = good(await repository.read(context, ref(context, 'stock', { orderUuid: car.orderUuid })));
  check(committed.state === 'released' && committed.orderNumber === car.orderNumber, 'Actual producer must commit released exact stock.');
  same(committed.facts, car.facts, 'Actual producer preserves exact TEST facts.');
  for (const before of stockBefore) same(store.state.tables.stock.find((row) => row.orderUuid === before.orderUuid), before,
    'Actual release preserves unrelated stock.');
  const receipts = good(await repository.query(context, 'event_receipts', { consumerId: 'stock-release', state: 'completed' }));
  check(receipts.length === 1, 'Actual producer must commit one release receipt.');
  same(good(receipts[0].outcome), release, 'Committed receipt must match actual presenter tick outcome.');
  click('Continue');
  await waitFor(() => heading() === 'Released cars' && button('Review this car')?.disabled === false && pending.size === 0,
    'Actual setup-ready host transition must mount usable released stock.');
  const stock = await request('/api/gcsp/manual/stock');
  const raw = good(await runtime.manualClaims.browseStock(context));
  const decision = stock.decisions.find((row) => row.orderUuid === car.orderUuid);
  check(decision?.gateStatus === 'eligible' && decision.claimInput, 'Actual released TEST order must be claimable.');
  same(decision.claimInput, raw.decisions.find((row) => row.orderUuid === car.orderUuid)?.claimInput,
    'Authenticated decorated stock preserves server-issued exact claim input.');
  check(stock.releaseHistory.history.releasedCarCount === 1 && stock.releaseHistory.history.releaseCount === 1,
    'Authenticated history must describe the actual release.');
  same(stock.releaseHistory.history.sourceVersions, [committed.release.sourceVersion], 'History must retain actual source provenance.');
  check(stock.releaseHistory.source.state === 'current-version-unknown', 'Historical provenance must not invent current source health.');
  check(root.querySelector('[data-release-history]')?.textContent.includes('1 car in 1 release'), 'Host must render actual release history.');
  edit('query', 'no-such-TEST-car');
  check(root.textContent.includes('No cars match these filters'), 'Ordinary filtering must render its empty state.');
  edit('query', car.orderNumber); click('Vehicle details');
  check(root.querySelector('.gcsp-gallery-detail')?.textContent.includes(car.orderNumber), 'Ordinary detail view must show the exact order.');
  check(count('POST', '/api/gcsp/manual/claim') === 0, 'Filtering and details must never claim stock.');
  armRead = true;
  const review = click('Review this car'); review.click();
  await waitFor(() => heldRead !== null, 'Hold only the actual subsequent current claim GET.');
  check(count('POST', '/api/gcsp/manual/claim') === 1, 'Duplicate Review click must produce one claim POST.');
  const posted = commands.find((row) => row.path === '/api/gcsp/manual/claim').body;
  const { commandId: postedId, ...postedInput } = posted;
  check(typeof postedId === 'string' && postedId.length > 0, 'Explicit selection must carry a stable command.');
  same(postedInput, decision.claimInput, 'Explicit selection must POST unchanged server-issued input.');
  const back = button('Back to your choices');
  check(back?.disabled, 'Back must remain disabled while current authority delivery is pending.');
  const reason = document.getElementById(back.getAttribute('aria-describedby'));
  check(reason && !reason.hidden && reason.textContent.includes('Wait for the reservation check'), 'Disabled Back must have a visible linked explanation.');
  back.click(); await pause();
  check(heading() === 'Released cars' && confirmed === 0 && !root.querySelector('.gcsp-review-body'),
    'Pending current authority must not navigate or emit confirmation.');
  const authority = good(heldRead);
  check(authority.state === 'quoted' && authority.hold.state === 'active' && authority.pendingOperation === null,
    'The delayed response must be actual active quoted authority.');
  releaseRead();
  await waitFor(() => heading() === 'Review your car' && button('Save details')?.disabled === false && pending.size === 0,
    'Actual matching current authority must reach delivered review.');
  check(confirmed === 1 && root.querySelectorAll('.gcsp-review-body').length === 1, 'One actual selection must confirm and mount one review.');
  same(handoff.claim, heldRead, 'Host handoff must use the actual matching current response.');
  check(handoff.commandId === postedId, 'Host handoff preserves the selection command.');
  same(handoff.selection.claimInput, decision.claimInput, 'Host handoff preserves exact input pins.');
  const details = await request('/api/gcsp/manual/review-details');
  check(details.binding.holdId === authority.hold.holdId && details.binding.quoteId === authority.quote.quoteId
    && details.binding.expectedDraftVersion === authority.quote.draftVersion && details.orderNumber === car.orderNumber,
  'Review must reread matching exact order, hold, quote and draft.');
  same(details.quote.facts, authority.quote.facts, 'Review preserves pinned vehicle facts.');
  check(authority.quote.eligibility.contextVersion === decision.claimInput.expectedContextVersion
    && authority.quote.eligibility.termsDigest === decision.claimInput.expectedTermsDigest
    && authority.quote.policyVersion === stock.versions.policy,
  'Quoted review retains actual context, terms and policy pins.');
  const special = 'TEST host review detail';
  check(details.constraints.maximumSpecialRequirements >= special.length, 'Actual shared review rule permits the selected detail.');
  edit('specialRequirements', special); click('Save details');
  await waitFor(() => button('Save details')?.disabled === false && pending.size === 0, 'Actual review details save must settle.');
  const updated = await request('/api/gcsp/manual/review-details');
  check(updated.reviewDetailsVersion === details.reviewDetailsVersion + 1 && updated.details.specialRequirements === special,
    'Actual F70 save must persist the expected review revision.');
  same(updated.details.contact, details.details.contact, 'Review save must preserve actual account contact.');
  check(updated.binding.expectedDraftVersion === details.binding.expectedDraftVersion, 'Review details must preserve the quoted draft pin.');
  const continueButton = click('Continue to order review'); continueButton.click();
  await waitFor(() => continued === 1 && reviewReady === 1 && pending.size === 0, 'Actual review Continue must deliver one checked host continuation.');
  const current = await request('/api/gcsp/manual/claim');
  const finalDetails = await request('/api/gcsp/manual/review-details');
  check(current.hold.phase === 'order-review' && current.hold.state === 'active', 'Actual Continue must confirm order-review phase.');
  check(continuation.binding.holdId === current.hold.holdId && continuation.binding.quoteId === current.quote.quoteId
    && continuation.binding.expectedHoldVersion === current.hold.version
    && continuation.binding.expectedDraftVersion === current.quote.draftVersion
    && continuation.reviewDetailsVersion === finalDetails.reviewDetailsVersion,
  'Host Continue must carry current exact authority and details revisions.');
  same(continuation.snapshot.claim, current, 'Host Continue snapshot must match actual current authority.');
  check(count('POST', '/api/gcsp/manual/claim') === 1 && count('POST', '/api/gcsp/manual/claim/review') === 1,
    'Review save and Continue must never reclaim the car or duplicate phase transition.');
  check(count('POST', '/api/gcsp/manual/review-details') === 2, 'Save details and Continue each perform their actual details save.');
  same((await request('/api/gcsp/manual/account')).currentContract, beforeContract, 'Scoped preview must preserve the current contract.');
  // Retained diagnostic is counts only; all original identities/payloads stay in memory.
  t.diagnostic(JSON.stringify({ scope: 'actual-TEST-producer-HTTP-host', releaseReceipts: receipts.length,
    producerPulls: profile.calls.length, claimPosts: count('POST', '/api/gcsp/manual/claim'),
    reviewSaves: count('POST', '/api/gcsp/manual/review-details'), reviewBegins: count('POST', '/api/gcsp/manual/claim/review'),
    confirmations: confirmed, continuations: continued, readyEvents: reviewReady }));
});
