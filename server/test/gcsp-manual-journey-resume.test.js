// Authored only. Real memory runtime and authenticated HTTP; no listener or live source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { JSDOM } from 'jsdom';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { inputDigest } from '../gcsp/repository/index.js';
import { createCompositionTestProfile } from './helpers/runtime-composition-profile.js';

const origin = 'https://resume.test';
const good = (result) => { assert.equal(result?.status, 'ok'); return result.value; };
const cookies = (value) => [value].flat().map((entry) => entry.split(';')[0]).join('; ');
async function waitFor(check) {
  const deadline = performance.now() + 10000;
  while (!check() && performance.now() < deadline) await new Promise((done) => setTimeout(done, 1));
  assert.ok(check(), 'Expected journey DOM state.');
}
function click(root, label) {
  const control = [...root.querySelectorAll('button')].find((node) => node.textContent === label);
  assert.ok(control, 'Expected journey control.'); assert.equal(control.disabled, false); control.click();
}
async function expectReview(f) {
  await waitFor(() => [...f.root.querySelectorAll('button')].some((node) =>
    node.textContent === 'Continue to order review' && !node.disabled));
  assert.equal(f.root.querySelector('main h1')?.textContent, 'Review your car');
  const vehicle = f.root.querySelector('.gcsp-review-vehicle'); assert.ok(vehicle);
  // The quote id is a raw reference, so it stays off screen (FUCQ-197).
  assert.ok(f.claim.quote.quoteId); assert.equal(vehicle.textContent.includes(f.claim.quote.quoteId), false);
  for (const value of [f.car.facts.display.name, f.car.orderNumber, f.claim.quote.validUntil]) {
    assert.ok(value); assert.ok(vehicle.textContent.includes(value), 'Expected pinned claim detail.');
  }
  const contact = f.root.querySelector('[name="contact.phone"]'); assert.ok(contact);
  assert.equal(contact.disabled, false); assert.equal(contact.value, f.saved.choices.contact.phone);
  assert.equal(f.root.querySelectorAll('main').length, 1);
}

async function setup(t, { claim = true, defaults = false } = {}) {
  const profile = createCompositionTestProfile();
  const runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: profile,
    environmentId: 'manual-resume-test', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'resume-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  const pending = new Set(); const gates = new Set(); let destroy; let dom; let root;
  const keys = ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'fetch'];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(async () => {
    try {
      destroy?.(); for (const release of gates) release();
      await Promise.allSettled([...pending]); root?.remove(); dom?.window.close();
    } finally {
      for (const key of keys) {
        if (previous.get(key)) Object.defineProperty(globalThis, key, previous.get(key)); else delete globalThis[key];
      }
      await runtime.close();
    }
  });
  const local = good(await runtime.createLocalSession());
  const session = cookies(local.setCookie);
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: session, purpose: 'presenter-control' }));
  const server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] }); good(await server.gcspStartup);
  const f = { runtime, profile, presenter, employee: local.context, requests: [], claimTransportUnavailable: false, claimDelay: null, aborted: 0 };
  async function request(path, { body, cookie = session } = {}) {
    f.requests.push({ path, method: body === undefined ? 'GET' : 'POST' });
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url: path, method: body === undefined ? 'GET' : 'POST', headers: {
      host: 'resume.test', origin, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    } });
    const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
      end(body) { this.body = body; } };
    await server.listeners('request')[0](req, response);
    return { status: response.status, ok: response.status >= 200 && response.status < 300,
      json: async () => response.body ? JSON.parse(response.body) : null };
  }
  f.request = async (path, options) => (await request(path, options)).json();
  f.fetch = (path, options = {}) => {
    const work = (async () => {
      const url = new URL(path, origin); assert.equal(url.origin, origin, 'No external HTTP is admitted.');
      const claimRead = url.pathname === '/api/gcsp/manual/claim' && (options.method ?? 'GET') === 'GET';
      if (claimRead && f.claimTransportUnavailable) throw Error('Controlled claim read transport unavailable.');
      let result = await request(url.pathname, { body: options.body === undefined ? undefined : JSON.parse(options.body) });
      if (claimRead && f.claimRewrite) { const body = await result.json(); result = { ...result, json: async () => f.claimRewrite(body) }; }
      if (claimRead && f.claimDelay) {
        const delay = f.claimDelay; f.claimDelay = null;
        options.signal?.addEventListener('abort', () => { f.aborted += 1; }, { once: true });
        await delay;
        // Deliberately deliver the original real response after abort to verify
        // generation fencing as well as cooperative cancellation.
      }
      return result;
    })();
    pending.add(work); work.then(() => pending.delete(work), () => pending.delete(work)); return work;
  };
  const account = good(await f.request('/api/gcsp/manual/account'));
  const action = account.actions.find((row) => row.enabled); assert.ok(action);
  const driver = account.choices.drivers.find((row) => row.kind === 'employee'); assert.ok(driver);
  const term = account.choices.contractOptions.find((row) => row.schemeIds.includes(f.employee.schemeId) && row.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((row) => row.contractOptionIds.includes(term.contractOptionId) && row.driverKinds.includes(driver.kind));
  f.saved = good(await f.request('/api/gcsp/manual/draft', { body: { commandId: 'resume-save',
    expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices: {
      mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
      slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: term.contractOptionId,
      requestedCollectionDate: account.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
      brand: account.choices.brands[0], contact: account.account.contact,
      expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '',
    } } }));
  f.currentContract = structuredClone(account.currentContract);
  if (claim) {
    f.car = await profile.prepare(runtime, f.employee);
    let clock = good(await runtime.clock.now(presenter));
    good(await runtime.clock.advance(presenter, { commandId: 'resume-noon', expectedClockVersion: clock.clockVersion,
      to: '2026-11-05T12:00:00.000Z' }));
    clock = good(await runtime.clock.now(presenter));
    good(await runtime.clock.tick(presenter, { eventId: 'resume-pull', inputDigest: inputDigest('resume-pull'), expectedClockVersion: clock.clockVersion }));
    const stock = good(await f.request('/api/gcsp/manual/stock'));
    const decision = stock.decisions.find((row) => row.orderUuid === f.car.orderUuid);
    assert.equal(decision?.gateStatus, 'eligible'); assert.ok(decision.claimInput);
    f.claim = good(await f.request('/api/gcsp/manual/claim', { body: { commandId: 'resume-one-claim', ...decision.claimInput } }));
    assert.equal(f.claim.state, 'quoted');
    // Prove the reported authority barrier on the unmodified server contract.
    const refused = await f.request('/api/gcsp/manual/draft', { body: { commandId: 'occupied-draft-must-refuse',
      expectedDraftVersion: f.saved.draftVersion, expectedContextVersion: f.saved.contextVersion, choices: f.saved.choices } });
    assert.equal(refused.status, 'conflict'); assert.equal(refused.reason, 'release-required');
  }
  dom = new JSDOM('<!doctype html><body></body>', { url: origin, pretendToBeVisual: true });
  for (const key of keys) Object.defineProperty(globalThis, key, {
    value: key === 'fetch' ? f.fetch : key === 'window' ? dom.window : dom.window[key], configurable: true,
  });
  root = dom.window.document.createElement('div'); dom.window.document.body.append(root); f.root = root;
  const { mountManualJourney } = await import('../../blocks/gcsp/manual-setup/journey.js');
  const { createAccountHttpAdapter } = await import('../../blocks/gcsp/account/http-adapter.js');
  const { createManualGalleryHttpAdapter } = await import('../../blocks/gcsp/manual-gallery/http-adapter.js');
  const { createManualReviewHttpAdapter } = await import('../../blocks/gcsp/manual-review/http-adapter.js');
  let sequence = 0;
  f.mount = async (options = {}) => {
    destroy?.();
    destroy = mountManualJourney(root, { ...(defaults ? {} : {
      adapter: createAccountHttpAdapter({ fetchImpl: f.fetch }),
      galleryAdapter: createManualGalleryHttpAdapter({ fetchImpl: f.fetch }),
      reviewAdapter: createManualReviewHttpAdapter({ fetchImpl: f.fetch }),
    }), commandId: () => `resume-ui:${++sequence}`, ...options });
    await waitFor(() => [...root.querySelectorAll('button')].some((node) => node.textContent === 'Resume saved journey'));
  };
  f.dispose = () => { destroy?.(); destroy = null; };
  f.delayClaim = () => {
    let release; f.claimDelay = new Promise((resolve) => { release = resolve; }); gates.add(release);
    return () => { gates.delete(release); release(); };
  };
  f.postsSince = (offset) => f.requests.slice(offset).filter((row) => row.method === 'POST');
  await f.mount(); return f;
}

test('real account Resume recovers the same quoted claim through default HTTP without another write', async (t) => {
  const f = await setup(t, { defaults: true });
  for (let reload = 0; reload < 2; reload += 1) {
    if (reload) await f.mount();
    const offset = f.requests.length; click(f.root, 'Resume saved journey');
    await expectReview(f);
    assert.equal(document.activeElement, f.root.querySelector('main h1'));
    const reads = f.requests.slice(offset).filter((row) => row.method === 'GET');
    assert.ok(reads.filter((row) => row.path === '/api/gcsp/manual/claim').length >= 3,
      'Entry, gallery and review must each reread claim authority.');
    assert.ok(reads.some((row) => row.path === '/api/gcsp/manual/review-details'));
    const claim = good(await f.request('/api/gcsp/manual/claim'));
    assert.deepEqual(claim.hold, f.claim.hold); assert.deepEqual(claim.quote, f.claim.quote);
    assert.equal(good(await f.request('/api/gcsp/manual/draft')).draftVersion, f.saved.draftVersion);
    assert.deepEqual(good(await f.request('/api/gcsp/manual/account')).currentContract, f.currentContract);
    assert.deepEqual(f.postsSince(offset), []);
  }
  assert.equal(f.requests.filter((row) => row.method === 'POST' && row.path === '/api/gcsp/manual/claim').length, 1);
});

test('Resume heading focus never steals from a field and stops at teardown (FUCQ-145)', async (t) => {
  const f = await setup(t, { defaults: true }); click(f.root, 'Resume saved journey'); await expectReview(f);
  assert.equal(document.activeElement, f.root.querySelector('main h1'));
  // The user moves on, then the review replaces its heading: focus stays in the field.
  const phone = f.root.querySelector('[name="contact.phone"]'); phone.focus();
  const heading = f.root.querySelector('main h1'); heading.replaceWith(heading.cloneNode(true));
  await new Promise((done) => setImmediate(done)); assert.equal(document.activeElement, phone);
  f.dispose(); phone.blur();
  const main = document.createElement('main'); main.append(document.createElement('h1')); f.root.append(main);
  await new Promise((done) => setImmediate(done)); assert.equal(document.activeElement, document.body);
});

test('real no-claim entry retains setup Back save and Resume choices through supplied HTTP ports', async (t) => {
  const f = await setup(t, { claim: false }); const offset = f.requests.length;
  click(f.root, 'Resume saved journey'); await waitFor(() => f.root.querySelector('[name="requestedCollectionDate"]'));
  assert.deepEqual(f.postsSince(offset), []);
  assert.equal(f.root.querySelector('[name="requestedCollectionDate"]').value, f.saved.choices.requestedCollectionDate);
  click(f.root, 'Back to account'); await waitFor(() => f.root.querySelector('h1')?.textContent === 'Your cars');
  const saved = good(await f.request('/api/gcsp/manual/draft'));
  assert.equal(saved.draftVersion, f.saved.draftVersion + 1); assert.deepEqual(saved.choices, f.saved.choices);
  click(f.root, 'Resume saved journey'); await waitFor(() => f.root.querySelector('[name="driverId"]'));
  assert.equal(f.root.querySelector('[name="driverId"]').value, f.saved.choices.driverId);
  assert.deepEqual(good(await f.request('/api/gcsp/manual/account')).currentContract, f.currentContract);
});

test('real released claim permits ordinary setup without recreating its hold or quote', async (t) => {
  const f = await setup(t);
  good(await f.request('/api/gcsp/manual/claim/release', { body: { commandId: 'resume-release', reason: 'back',
    holdId: f.claim.hold.holdId, expectedHoldVersion: f.claim.hold.version, expectedDraftVersion: f.saved.draftVersion } }));
  await f.mount(); const offset = f.requests.length;
  click(f.root, 'Resume saved journey'); await waitFor(() => f.root.querySelector('[name="driverId"]'));
  const claim = good(await f.request('/api/gcsp/manual/claim'));
  assert.equal(claim.state, 'released'); assert.equal(claim.hold.holdId, f.claim.hold.holdId);
  assert.equal(claim.quote.quoteId, f.claim.quote.quoteId); assert.deepEqual(f.postsSince(offset), []);
});

test('unavailable claim reads stay blocked until Check status recovers actual current authority', async (t) => {
  const f = await setup(t); f.claimTransportUnavailable = true; const offset = f.requests.length;
  click(f.root, 'Resume saved journey');
  await waitFor(() => [...f.root.querySelectorAll('button')].some((node) => node.textContent === 'Check status' && !node.hidden));
  assert.equal(f.root.querySelector('.gcsp-review-form'), null); assert.equal(f.root.querySelector('[name="driverId"]'), null);
  const back = [...f.root.querySelectorAll('button')].find((node) => node.textContent === 'Back to your choices');
  assert.ok(back); assert.equal(back.disabled, true); assert.deepEqual(f.postsSince(offset), []);
  f.claimTransportUnavailable = false; click(f.root, 'Check status');
  await expectReview(f);
  assert.equal(good(await f.request('/api/gcsp/manual/claim')).hold.holdId, f.claim.hold.holdId);
  assert.deepEqual(f.postsSince(offset), []);
});

test('pending and allocated claim reads keep Resume in guarded recovery without a duplicate write', async (t) => {
  const f = await setup(t);
  const outcomes = {
    'pending envelope': () => ({ status: 'pending' }),
    'pending operation': (body) => { body.value.pendingOperation = { kind: 'claim', commandId: 'resume-one-claim' }; return body; },
    allocated: (body) => { body.value.state = 'allocated'; body.value.hold.state = 'allocated'; return body; },
  };
  for (const [name, rewrite] of Object.entries(outcomes)) {
    f.claimRewrite = (body) => rewrite(structuredClone(body)); await f.mount(); const offset = f.requests.length;
    click(f.root, 'Resume saved journey');
    await waitFor(() => f.requests.slice(offset).filter((row) => row.path === '/api/gcsp/manual/claim').length >= 2
      && !f.root.querySelector('[aria-busy="true"]'));
    await new Promise((done) => setTimeout(done, 50));
    assert.equal(f.root.querySelector('.gcsp-review-form'), null, name); assert.equal(f.root.querySelector('[name="driverId"]'), null, name);
    const buttons = (label) => [...f.root.querySelectorAll('main button')].filter((node) => node.textContent === label && !node.hidden);
    assert.ok(buttons('Review this car').length, name); assert.ok(buttons('Review this car').every((node) => node.disabled), name);
    assert.equal(buttons('Back to your choices')[0]?.disabled, true, name);
    const check = buttons('Check status')[0]; assert.ok(check && !check.disabled, name);
    check.click(); await new Promise((done) => setTimeout(done, 50));
    assert.equal(f.root.querySelector('.gcsp-review-form'), null, name); assert.deepEqual(f.postsSince(offset), [], name);
  }
  f.claimRewrite = null; await f.mount(); click(f.root, 'Resume saved journey'); await expectReview(f);
  assert.equal(f.requests.filter((row) => row.method === 'POST' && row.path === '/api/gcsp/manual/claim').length, 1);
});

test('disposing a checking generation aborts its real read and fences late response and clock callbacks', async (t) => {
  const f = await setup(t); let clock; let unsubscribed = 0;
  await f.mount({ subscribeClock(callback) { clock = callback; return () => { unsubscribed += 1; }; } });
  const release = f.delayClaim(); const offset = f.requests.length; click(f.root, 'Resume saved journey');
  await waitFor(() => f.root.textContent.includes('Checking your saved journey'));
  await waitFor(() => f.claimDelay === null);
  assert.equal(f.root.querySelector('[role="status"][aria-busy="true"] h2'), document.activeElement);
  f.dispose(); assert.equal(f.aborted, 1); assert.equal(unsubscribed, 1);
  release(); clock(); await new Promise((done) => setImmediate(done)); await new Promise((done) => setImmediate(done));
  assert.equal(f.root.childElementCount, 0); assert.deepEqual(f.postsSince(offset), []);
  await f.mount(); click(f.root, 'Resume saved journey'); await expectReview(f);
});

test('a presenter Tick past the hold expiry refreshes the mounted review without writing or losing the draft', async (t) => {
  const f = await setup(t); const { subscribePresenterActions } = await import('../../blocks/gcsp/presenter-controls/controls.js');
  await f.mount({ subscribeClock: subscribePresenterActions(f.root) });
  click(f.root, 'Resume saved journey'); await expectReview(f);
  const hold = good(await f.request('/api/gcsp/manual/claim')).hold; const offset = f.requests.length;
  const phone = f.root.querySelector('[name="contact.phone"]'); phone.value = '07700 900123'; phone.dispatchEvent(new f.root.ownerDocument.defaultView.Event('input', { bubbles: true }));
  const tick = () => { const node = [...f.root.querySelectorAll('button')].find((row) => row.textContent.startsWith('Tick (')); assert.ok(node, 'Expected presenter Tick.'); node.click(); };
  const cont = () => [...f.root.querySelectorAll('button')].find((row) => row.textContent === 'Continue to order review');
  const posts = () => f.postsSince(offset).length;
  tick(); await waitFor(() => posts() === 1 && !f.root.querySelector('[aria-busy="true"]'));
  await new Promise((done) => setTimeout(done, 100)); assert.equal(cont().disabled, false);
  tick(); await waitFor(() => posts() === 2); await waitFor(() => cont().disabled);
  const notices = [...f.root.querySelectorAll('[role="status"], [role="alert"]')].map((node) => node.textContent);
  assert.ok(notices.some((text) => /hold has expired/i.test(text)), 'Expected an accessible expiry notice.');
  assert.match(f.root.textContent, /reservation has expired/i); assert.equal(phone.isConnected, true); assert.equal(phone.value, '07700 900123');
  assert.deepEqual(f.postsSince(offset).map((row) => row.path), Array(2).fill('/api/gcsp/presenter/controls/tick'));
  const after = good(await f.request('/api/gcsp/manual/claim'));
  assert.equal(after.hold.expiresAt, hold.expiresAt); assert.notEqual(after.hold.state, 'active');
});
