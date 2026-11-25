import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const good = (out, name) => { assert.equal(out?.status, 'ok', `${name}: ${out?.code ?? out?.status}`); return out.value; };
const replayEnvironment = 'f548-node-replay';
const bootstrapCommandId = 'f548-node-replay';
const resetCommandId = 'f548-node-main';
const initialRunId = `demo-${sha(JSON.stringify([replayEnvironment, bootstrapCommandId])).slice(0, 32)}`;
const wrappedResetCommandId = `scenario:${sha(JSON.stringify(resetCommandId))}`;
// Frozen clock.initialize/reset hash primitive strings/arrays with inputDigest (canonical JSON SHA-256).
// Keep this current-run identity equal in both real engines: it participates in the car lottery.
export const NODE_REPLAY_IDENTITY = Object.freeze({ environmentId: replayEnvironment, bootstrapCommandId, resetCommandId,
  initialRunId, runId: `demo-${sha(JSON.stringify([replayEnvironment, initialRunId, wrappedResetCommandId])).slice(0, 32)}` });

// Observe the actual image responses used by the page. Never substitute an asset or equate raw routes.
export function observeImageResponses(page, { origins, records, label }) {
  const pending = new Set(); let observed = 0;
  const listener = (response) => {
    const url = new URL(response.url());
    if (!origins.includes(url.origin) || !/^(?:\/assets\/gcsp-vehicle-evidence\/[a-f0-9]{64}|\/api\/gcsp\/(?:v1\/)?vehicle-images\/bmw-display-[a-f0-9]{20})\.webp$/.test(url.pathname)) return;
    if (observed++ >= 128) return;
    const headers = response.headers();
    const record = { page: label, url: url.href, status: response.status(), mime: (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() };
    records.push(record);
    const reading = (async () => {
      try {
        const declared = headers['content-length'];
        if (declared && (!/^\d+$/.test(declared) || Number(declared) > 2 * 1024 * 1024)) throw new Error('Image response exceeds the 2 MiB bound');
        const bytes = await response.body();
        assert.ok(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024, 'Actual image response body is bounded');
        record.bytes = bytes.length; record.sha256 = sha(bytes);
      } catch (error) { record.failure = error.message.slice(0, 300); }
    })();
    pending.add(reading); reading.finally(() => pending.delete(reading));
  };
  page.on('response', listener);
  return {
    async read(locator) {
      const deadline = Date.now() + 15000;
      let image;
      while (Date.now() < deadline) {
        image = await locator.evaluate((node) => {
          const box = node.getBoundingClientRect(); const css = getComputedStyle(node);
          return { rawUrl: node.getAttribute('src'), actualUrl: node.currentSrc || node.src,
            complete: node.complete, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight,
            renderedWidth: box.width, renderedHeight: box.height, objectFit: css.objectFit };
        });
        const response = records.findLast((record) => record.page === label && record.url === image.actualUrl && (record.sha256 || record.failure));
        if (image.complete && image.naturalWidth > 0 && response) return { ...image, response: { ...response } };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { ...image, response: { state: 'unobserved-or-unloaded', responseLimitReached: observed > 128 } };
    },
    async stop() { page.off('response', listener); await Promise.allSettled([...pending]); },
  };
}

export function assertImageParity(node, angular, { dimensions = { width: 84, height: 56 } } = {}) {
  for (const [name, image] of [['Node', node], ['Angular', angular]]) {
    assert.equal(image.response.status, 200, `${name}: actual displayed image response succeeded`);
    assert.match(image.response.sha256 ?? '', /^[a-f0-9]{64}$/, `${name}: actual response bytes were hashed`);
    assert.ok(image.response.bytes > 0 && image.response.bytes <= 2 * 1024 * 1024);
    assert.ok(['image/webp', 'image/png', 'image/jpeg'].includes(image.response.mime));
    assert.ok(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && image.renderedWidth > 0 && image.renderedHeight > 0);
  }
  const catalogueBytes = readFileSync(new URL('../../../server/data/gcsp/vehicle-evidence/display-images.v1.json', import.meta.url));
  const catalogueSha256 = sha(catalogueBytes);
  assert.equal(catalogueSha256, 'f12e588c78ca900dc98800697960f7d2857283d982fadd5cde292ba6be27b694', 'Use the reviewed display-image catalogue');
  const catalogue = JSON.parse(catalogueBytes);
  const images = [...catalogue.configurations.map((row) => row.image), ...Object.values(catalogue.variants), ...Object.values(catalogue.models)];
  const nodePath = new URL(node.actualUrl).pathname; const angularPath = new URL(angular.actualUrl).pathname;
  const registration = images.find((image) => `/${image.asset}` === angularPath
    && `/api/gcsp/vehicle-images/${image.imageId}.webp` === nodePath);
  assert.ok(registration, 'Actual Node route and Angular asset belong to the same reviewed image registration');
  assert.equal(angular.response.sha256, registration.sha256, 'Actual Angular bytes match the registered retained image');
  assert.equal(angular.response.bytes, registration.bytes);
  assert.equal(angular.naturalWidth, registration.width); assert.equal(angular.naturalHeight, registration.height);
  for (const image of [node, angular]) {
    if (dimensions) {
      assert.equal(image.renderedWidth, dimensions.width); assert.equal(image.renderedHeight, dimensions.height);
    }
    assert.equal(image.objectFit, 'cover');
  }
  if (!dimensions) {
    assert.ok(Math.abs(node.renderedWidth - angular.renderedWidth) <= 1, 'Responsive image widths agree within one CSS pixel');
    assert.ok(Math.abs(node.renderedHeight - angular.renderedHeight) <= 1, 'Responsive image heights agree within one CSS pixel');
  }
  return { catalogueSha256, registration,
    nodeBytesMatchRecordedSource: node.response.sha256 === registration.sourceSha256,
    nodeBytesMatchRetainedAsset: node.response.sha256 === registration.sha256,
    sameResponseBytes: node.response.sha256 === angular.response.sha256,
    sameNaturalDimensions: node.naturalWidth === angular.naturalWidth && node.naturalHeight === angular.naturalHeight,
    providerDifference: 'Frozen Node can serve a live source-framed image; Angular serves the registered retained crop. Raw URLs, hashes, byte counts and natural dimensions remain distinct evidence.',
    humanReview: 'The same-offer 1280 pair remains pending Gary/Russell review; registration and rendering checks do not establish identical photos or visual acceptance.' };
}

// Optional engineering parity capture. The frozen checkout is read-only; all state stays in memory.
export async function withNodeReplay({ browser, input, plan, cert, key, output, expected }, visit) {
  assert.equal(typeof visit, 'function', 'A live Node visitor is required');
  const reference = process.env.GCSP_NODE_REFERENCE;
  if (!reference) return { state: 'unrun', reason: 'GCSP_NODE_REFERENCE was not supplied; no Node parity evidence claimed' };
  assert.ok(path.isAbsolute(reference) && !/OneDrive|CloudStorage/i.test(reference));
  assert.equal(process.env.GCSP_NODE_REFERENCE_REVISION, input.reference.commit, 'The supervisor must verify the frozen commit');
  for (const [file, digest] of Object.entries(input.reference.sourceFiles)) {
    assert.equal(sha(readFileSync(path.join(reference, file))), digest, `Frozen source ${file}`);
  }
  const pgModule = process.env.GCSP_E2E_PG_MODULE;
  if (pgModule) assert.ok(path.isAbsolute(pgModule) && !/OneDrive|CloudStorage/i.test(pgModule));
  // The frozen memory runtime imports its PostgreSQL implementation without using it. Resolve that
  // import from an existing reviewed install when the preserved checkout has no node_modules.
  const hook = pgModule ? registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === 'pg' && context.parentURL?.startsWith(pathToFileURL(reference + path.sep).href)) {
      return { url: pathToFileURL(pgModule).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } }) : null;
  const load = (file) => import(pathToFileURL(path.join(reference, file)).href);
  let modules;
  try {
    modules = await Promise.all([load('server/gcsp/runtime.js'), load('server/gcsp/repository/memory.js'),
      load('server/gcsp/stock/synthetic-provider.js'), load('server/gcsp/stock/demo-provider.js'),
      load('server/index.js'), load('server/gcsp/host.js')]);
  } finally { hook?.deregister(); }
  const [{ createGcspRuntime }, { createMemoryStore, createMemoryRepository }, { createSyntheticStockProvider },
    { createDemoUpstream }, { buildServer }, { createGcspFront }] = modules;
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  const providers = new Map();
  const stockProvider = { pull(request) {
    if (!providers.has(request.runId)) providers.set(request.runId, createSyntheticStockProvider({ runId: request.runId, ...plan }));
    return providers.get(request.runId).pull(request);
  } };
  let runtime; let server; let api; let context; let imageObserver;
  const receipt = { reference: input.reference, stockPlan: input.stockPlan, setupDifferences: [
    'The frozen named Main loader establishes initial brief/account/clock in an isolated memory repository.',
    'The same lossless generated stock instance enters the existing synthetic stock-provider seam.',
    'The real clock advanceAndTick service targets the captured generated release instant; provider injection does not recreate stock-generation control metadata.',
    'The environment and slot creation/update wall timestamps differ; the replay run ID and semantic source/brief/clock values are asserted.',
  ] };
  try {
    const wallInstant = expected.presenterMain?.initialClock.now ?? input.clock.now;
    runtime = good(await createGcspRuntime({ mode: 'memory', repository, environmentId: NODE_REPLAY_IDENTITY.environmentId,
      commandId: NODE_REPLAY_IDENTITY.bootstrapCommandId, policyAsOf: input.clock.now, wallNow: () => new Date(wallInstant),
      stockProvider, production: createDemoUpstream().production, adoptOfferJourney: true,
      offerLandingUrl: 'https://gcsp-proof.example.test/gcsp-offer.html',
      mail: { env: { GCSP_PUBLIC_ORIGIN: 'http://127.0.0.1:7548' } } }), 'Node runtime');
    const tls = { key: readFileSync(key), cert: readFileSync(cert) };
    let front;
    server = createServer(tls, (req, res) => front ? front(req, res) : res.writeHead(503).end());
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `https://127.0.0.1:${server.address().port}`;
    api = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] });
    good(await api.gcspStartup, 'Node HTTP composition');
    front = createGcspFront({ root: reference, services: runtime, api, origin });
    let control = good(await runtime.identity.createPresenterSession('f548-node-presenter'), 'Node presenter').context;
    const catalogue = good(await runtime.scenarios.readCatalogue(control), 'Node catalogue');
    const selected = catalogue.scenarios.find((item) => item.scenarioId === input.scenario.scenarioId);
    const state = good(await runtime.scenarios.readState(control), 'Node initial state');
    assert.equal(state.runId, NODE_REPLAY_IDENTITY.initialRunId, 'Actual frozen bootstrap identity follows its unchanged clock initializer');
    if (expected.presenterMain) {
      const actual = expected.presenterMain;
      assert.equal(actual.scenario.scenarioId, 'main-successful-journey');
      assert.deepEqual(selected.inputs, actual.scenario.inputs, 'Both public Main resets use identical semantic inputs');
      context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce', locale: 'en-GB', timezoneId: 'Europe/London' });
      const session = good(await runtime.identity.createPresenterSession('f561-node-public-main'), 'Node presenter session');
      const cookies = Array.isArray(session.setCookie) ? session.setCookie : [session.setCookie];
      await context.addCookies(cookies.map((cookie) => {
        const pair = cookie.split(';', 1)[0]; const at = pair.indexOf('=');
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin,
          httpOnly: true, secure: true, sameSite: 'Lax' };
      }));
      const page = await context.newPage();
      receipt.imageResponses = [];
      imageObserver = observeImageResponses(page, { origins: [origin], records: receipt.imageResponses, label: 'frozen-node-presenter' });
      receipt.consoleErrors = [];
      page.on('pageerror', (error) => receipt.consoleErrors.push(error.message.slice(0, 300)));
      await page.goto(`${origin}/gcsp-presenter.html`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Start again', exact: true }).click();
      const resetResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/gcsp/presenter/scenarios/reset'
        && response.request().method() === 'POST');
      await page.getByRole('group', { name: 'Start again?', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
      const reset = await resetResponse;
      assert.equal(reset.status(), 200);
      const resetBody = await reset.json();
      assert.equal(resetBody.status, 'ok');
      assert.equal(resetBody.value.startState.status, 'ok', 'The real public frozen Main reset completes preparation');
      control = good(await runtime.identity.createPresenterSession('f561-node-current-main'), 'Node prepared presenter').context;
      const current = good(await runtime.scenarios.readState(control), 'Node prepared Main state');
      assert.equal(current.currentScenario.scenarioId, actual.scenario.scenarioId);
      const employee = good(await runtime.identity.resolveEmployeeContext(control, 'employee-paula'), 'Node prepared employee');
      assert.equal(employee.employeeId, actual.context.employeeId);
      const brief = good(await runtime.brief.readCurrent(employee), 'Node public Main brief').brief;
      const canonicalTimes = (value) => {
        if (Array.isArray(value)) return value.map(canonicalTimes);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalTimes(item)]));
        return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))
          ? new Date(value).toISOString() : value;
      };
      const briefKeys = ['schemaVersion', 'preferences', 'essentials', 'buddy', 'briefVersion', 'status', 'policyVersion', 'confirmedBy'];
      const semanticBrief = (value) => canonicalTimes(Object.fromEntries(briefKeys.map((key) => [key, value[key]])));
      assert.deepEqual(semanticBrief(brief), semanticBrief(actual.brief), 'Publicly prepared Main brief values, consent and versions agree');
      const initialClock = good(await runtime.clock.now(control), 'Node public Main clock');
      const run = good(await repository.read(control, { table: 'runs', key: { runId: control.runId } }), 'Node prepared clock configuration');
      assert.equal(Date.parse(initialClock.now), Date.parse(actual.initialClock.now));
      assert.equal(String(initialClock.clockVersion), String(actual.initialClock.clockVersion));
      assert.equal(Date.parse(run.versions.scenarioClock.startsAt), Date.parse(actual.initialClock.startsAt));
      assert.deepEqual(canonicalTimes(run.versions.scenarioClock.namedTimes), canonicalTimes(actual.initialClock.namedTimes));
      assert.equal(control.policyVersion, actual.context.policyVersion);
      const primary = page.getByRole('button', { name: /^Release (?:tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday)'s cars$/ });
      await primary.waitFor({ state: 'visible' });
      const tickResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/gcsp/presenter/controls/tick'
        && response.request().method() === 'POST');
      await primary.click();
      const tick = await tickResponse;
      assert.equal(tick.status(), 200);
      const tickBody = await tick.json();
      assert.equal(tickBody.status, 'ok');
      const finalClock = good(await runtime.clock.now(control), 'Node actual Basic release clock');
      assert.equal(Date.parse(finalClock.now), Date.parse(actual.finalClock.now), 'Both actual Basic buttons reach the same instant');
      assert.equal(String(finalClock.clockVersion), String(actual.finalClock.clockVersion));
      const latest = await page.evaluate(async () => (await fetch('/api/gcsp/presenter/releases/latest',
        { credentials: 'include', cache: 'no-store' })).json());
      assert.equal(latest.status, 'ok');
      assert.ok(latest.value.release && latest.value.cars.length > 0);
      Object.assign(receipt, { state: 'matched', comparison: 'actual public Main resets and Basic releases; engine-local IDs retained',
        setupDifferences: ['Node uses the actual Java Main reset London date as its controlled wall date.',
          'Each engine generates and retains its own run ID; presenter parity compares actual scenario, brief, clock and released stock.',
          'The immutable identical stock plan enters both existing provider seams; all release/allocation/mail state is created by the real services.'],
        engineRunIds: { node: control.runId, java: actual.context.runId },
        actualMainReadbacks: { scenario: current, brief, initialClock, finalClock, latest: latest.value },
        publicMainReset: { status: resetBody.status, startState: resetBody.value.startState },
        humanAcceptance: 'pending human verdict; engineering semantic checks do not accept parity' });
      Object.assign(receipt, await visit({ page, context, origin, runtime, employee, control, repository,
        receipt, images: imageObserver, presenterRelease: latest.value }));
      assert.deepEqual(receipt.consoleErrors, [], 'No frozen presenter runtime errors');
      return receipt;
    }
    const reset = good(await runtime.scenarios.reset(control, { commandId: NODE_REPLAY_IDENTITY.resetCommandId, expectedRunId: state.runId,
      expectedRunVersion: state.runVersion, scenarioId: selected.scenarioId, scenarioVersion: selected.scenarioVersion,
      fixtureVersion: selected.fixtureVersion, policyVersion: selected.policyVersion }), 'Node Main reset');
    assert.equal(reset.startState.status, 'ok');
    control = good(await runtime.identity.createPresenterSession('f548-node-current-presenter'), 'Node current presenter').context;
    assert.equal(control.runId, NODE_REPLAY_IDENTITY.runId, 'Actual frozen reset identity follows its unchanged scenario/clock services');
    assert.equal(control.runId, expected.runId, 'Actual Node and Java run IDs agree before their real car lotteries');
    receipt.replayIdentity = { ...NODE_REPLAY_IDENTITY, javaRunId: expected.runId,
      reason: 'Run ID is an input of both unchanged car lottery functions; only the environment identifier differs.' };
    const employee = good(await runtime.identity.resolveEmployeeContext(control, 'employee-paula'), 'Node Paula');
    const brief = good(await runtime.brief.readCurrent(employee), 'Node initial brief').brief;
    receipt.actualInitialBrief = brief;
    for (const name of ['schemaVersion', 'preferences', 'essentials', 'knownFacts', 'buddy', 'policyVersion']) {
      assert.deepEqual(brief[name], input.initialBrief.brief[name], `Node actual initial ${name}`);
    }
    const account = good(await runtime.account.readAccount(employee), 'Node initial account');
    receipt.actualInitialAccount = account;
    for (const name of ['state', 'asOf', 'account', 'drivers', 'contracts', 'currentContract', 'contractState', 'choices', 'allowance', 'versions']) {
      assert.deepEqual(account[name], input.account[name], `Node actual account ${name}`);
    }
    const initialClock = good(await runtime.clock.now(control), 'Node actual initial clock');
    receipt.initialClock = initialClock;
    assert.equal(initialClock.now, input.clock.now);
    assert.equal(initialClock.clockVersion, input.clock.clockVersion);
    assert.equal(control.policyVersion, input.clock.policyVersion);
    const run = good(await repository.read(control, { table: 'runs', key: { runId: control.runId } }), 'Node actual clock configuration');
    assert.equal(run.versions.scenarioClock.startsAt, input.clock.startsAt);
    assert.deepEqual(run.versions.scenarioClock.namedTimes, input.clock.namedTimes);
    const initialDerivedCounts = {};
    for (const table of ['offers', 'holds']) {
      initialDerivedCounts[table] = good(await repository.query(control, table), table).length;
      assert.equal(initialDerivedCounts[table], 0);
    }
    const allocationReceipts = good(await repository.query(control, 'event_receipts', { consumerId: 'buddy-allocation' }), 'Node allocation receipts');
    initialDerivedCounts.allocationReceipts = allocationReceipts.length;
    assert.equal(allocationReceipts.length, 0, 'No real Node allocation receipt exists before the public release');
    receipt.initialDerivedCounts = initialDerivedCounts;
    const actions = expected.clock.actions;
    assert.ok(Array.isArray(actions) && actions[0]?.action === 'Next release', 'Actual Java clock transitions are required');
    let tick = good(await runtime.clock.advanceAndTick(control, { commandId: 'f548-node-release',
      expectedClockVersion: initialClock.clockVersion, mode: 'to', to: actions[0].observedNow }), 'Node actual Next release');
    if (actions.length > 1) {
      assert.equal(actions.length, 3);
      assert.equal(actions[1].action, 'Advanced clock advance');
      assert.equal(actions[2].action, 'Step and tick');
      const advanced = good(await runtime.clock.advance(control, { commandId: 'f548-node-generated-window',
        expectedClockVersion: tick.advance.clockVersion, bySeconds: actions[1].seconds }), 'Node actual Advanced advance');
      tick = good(await runtime.clock.advanceAndTick(control, { commandId: 'f548-node-generated-tick',
        expectedClockVersion: advanced.clockVersion, mode: 'to', to: input.clock.nextRelease.at }), 'Node actual generated-window tick');
      assert.equal(Date.parse(tick.advance.now) - Date.parse(advanced.now), actions[2].seconds * 1000);
    }
    const finalAccount = good(await runtime.account.readAccount(employee), 'Node actual final account');
    receipt.finalClockComparison = { node: { now: tick.advance.now, clockVersion: tick.advance.clockVersion, actions },
      java: expected.clock, versionEqualityRequired: true, actualFinalAccount: finalAccount,
      reason: 'Both engines executed the same meaningful clock transitions; instant and version must agree.' };
    assert.equal(tick.advance.now, expected.clock.now, 'Actual Node and Java final clock instants agree');
    assert.equal(String(tick.advance.clockVersion), String(expected.clock.clockVersion), 'Actual final clock versions agree');
    assert.equal(finalAccount.asOf, expected.clock.now);
    assert.equal(String(finalAccount.versions.clock), String(expected.clock.clockVersion));
    if (expected.finalAccount) {
      assert.equal(finalAccount.asOf, expected.finalAccount.asOf);
      assert.equal(String(finalAccount.versions.clock), String(expected.finalAccount.versions.clock));
    }
    const activity = good(await runtime.activity.readActivity(employee), 'Node actual activity');
    const offer = activity.currentOffer;
    receipt.actualActivity = activity;
    assert.equal(offer?.state, 'active', 'Node real services create an active offer');
    assert.equal(offer.orderUuid, expected.orderUuid, 'The same exact car is held by actual Node and Java services');
    assert.equal(offer.expiresAt, expected.expiresAt, 'The actual Node and Java offer deadlines agree');
    const actualHold = good(await repository.read(control, { table: 'holds', key: { runId: control.runId, holdId: offer.holdId } }), 'Node actual held row');
    const holdSemantic = Object.fromEntries(['orderUuid', 'employeeId', 'entitlementSlotId', 'type', 'state'].map((key) => [key, actualHold[key]]));
    holdSemantic.expiresAt = new Date(actualHold.expiresAt).toISOString();
    receipt.actualHold = { row: Object.fromEntries(['runId', 'holdId', 'version', 'orderUuid', 'employeeId', 'entitlementSlotId',
      'type', 'state', 'expiresAt'].map((key) => [key, actualHold[key]])), semantic: holdSemantic,
      identifierMapping: 'Each actual offer supplies its actual holdId; IDs/versions are recorded, not equated or seeded.' };
    assert.deepEqual(holdSemantic, expected.hold, 'Actual Node and Java hold rows have identical common semantics');
    context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce', locale: 'en-GB', timezoneId: 'Europe/London' });
    const issued = good(await runtime.identity.switchPrincipal(control, 'demo-paula', 'f548-node-browser-paula'), 'Node Paula session');
    const cookie = issued.setCookie.split(';', 1)[0];
    await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      url: origin, httpOnly: true, secure: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    receipt.imageResponses = [];
    imageObserver = observeImageResponses(page, { origins: [origin], records: receipt.imageResponses, label: 'frozen-node' });
    receipt.consoleErrors = [];
    page.on('pageerror', (error) => receipt.consoleErrors.push(error.message.slice(0, 300)));
    Object.assign(receipt, { state: 'matched', initialClock,
      actualContext: { runId: employee.runId, environmentId: employee.environmentId, employeeId: employee.employeeId, policyVersion: employee.policyVersion },
      tick: { clockVersion: tick.advance.clockVersion, now: tick.advance.now },
      offer: { orderUuid: offer.orderUuid, offerId: offer.offerRef.offerId, expiresAt: offer.expiresAt, state: offer.state },
      humanAcceptance: 'pending Gary/Russell review; engineering equality is not acceptance' });
    Object.assign(receipt, await visit({ page, context, origin, runtime, employee, control, repository, offer, receipt, images: imageObserver }));
    assert.deepEqual(receipt.consoleErrors, [], 'No frozen source app runtime errors');
    return receipt;
  } catch (error) {
    receipt.failure = { name: error.name, message: error.message.slice(0, 1000) };
    throw error;
  } finally {
    await context?.close();
    await imageObserver?.stop();
    if (server) await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
    api?.closeAllConnections();
    await runtime?.close();
    writeFileSync(path.join(output, 'node-replay-receipt.json'), JSON.stringify(receipt, null, 2));
  }
}

// Existing bell proof keeps the same public behavior while other cases visit the live source runtime.
export async function captureNodeReplay(options) {
  return withNodeReplay(options, async ({ page, origin, receipt, images }) => {
    const { expected, output } = options;
    await page.goto(`${origin}/gcsp-account.html`, { waitUntil: 'domcontentloaded' });
    const bell = page.getByRole('button', { name: 'Notifications, 1 car offer waiting', exact: true });
    await bell.waitFor(); await bell.click();
    const panel = page.locator('.gcsp-bell-panel');
    await panel.getByRole('link', { name: 'View your offer', exact: true }).waitFor();
    const image = panel.locator('.gcsp-bell-thumb');
    await image.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.gcsp-bell-thumb')].every((item) => item.complete && item.naturalWidth > 0));
    const visible = { car: await panel.locator('.gcsp-bell-copy p').nth(1).innerText(),
      detail: await panel.locator('.gcsp-bell-muted').innerText(), image: await image.getAttribute('src') };
    const imageEvidence = await images.read(image);
    receipt.thumbnailComparison = { angular: expected.panel.imageEvidence, node: imageEvidence,
      offerIdentity: { node: receipt.offer, angular: { orderUuid: expected.orderUuid, offerId: expected.offerId,
        expiresAt: expected.expiresAt, state: expected.state },
      binding: 'The actual activity offers and hold rows above already assert the same exact car, active state and deadline.' } };
    receipt.visible = visible;
    const destination = path.join(output, 'node-active-open-1280.png');
    await page.screenshot({ path: destination, fullPage: false }); receipt.screenshot = destination;
    await page.setViewportSize({ width: 375, height: 812 });
    receipt.narrowGeometry = { box: await panel.boundingBox(), viewport: page.viewportSize(),
      actual: await panel.evaluate((node) => {
        const style = (item) => { const css = getComputedStyle(item); const rect = item.getBoundingClientRect();
          return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, position: css.position,
            width: css.width, right: css.right, padding: css.padding, gap: css.gap, overflowX: css.overflowX }; };
        const root = node.closest('.gcsp-bell');
        return { panel: style(node), bell: style(root), header: style(node.closest('header')), hidden: node.hidden,
          expanded: root.querySelector('button').getAttribute('aria-expanded'), innerWidth, scrollWidth: document.documentElement.scrollWidth };
      }) };
    receipt.narrowScreenshot = path.join(output, 'node-active-open-375.png');
    await page.screenshot({ path: receipt.narrowScreenshot, fullPage: false });
    const box = receipt.narrowGeometry.box;
    receipt.narrowGeometry.baselineAssessment = { bug: 'FUCQ-566', contained: !!box && box.x >= 0 && box.x + box.width <= 376,
      origin: 'FUCQ-375; right:-44px introduced by 5f0e9d7f2 before the frozen migration baseline.',
      scope: 'Existing narrow-panel defect, separately prioritized; no containment pass or repair is claimed by F548/F555.' };
    assert.equal(visible.car, expected.panel.car, 'The actual Node/Angular car titles agree');
    assert.equal(visible.detail, expected.panel.detail, 'The actual Node/Angular displayed deadlines agree');
    receipt.thumbnailComparison.registrationAssessment = assertImageParity(imageEvidence, expected.panel.imageEvidence);
    return { visible, screenshot: destination };
  });
}
