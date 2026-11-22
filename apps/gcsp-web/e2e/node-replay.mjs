import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const good = (out, name) => { assert.equal(out?.status, 'ok', `${name}: ${out?.code ?? out?.status}`); return out.value; };

// Optional engineering parity capture. The frozen checkout is read-only; all state stays in memory.
export async function captureNodeReplay({ browser, input, plan, cert, key, output, expected }) {
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
  let runtime; let server; let api; let context;
  const receipt = { reference: input.reference, stockPlan: input.stockPlan, setupDifferences: [
    'The frozen named Main loader establishes initial brief/account/clock in an isolated memory repository.',
    'The same lossless generated stock instance enters the existing synthetic stock-provider seam.',
    'The real clock advanceAndTick service targets the captured generated release instant; provider injection does not recreate stock-generation control metadata.',
    'Run/environment IDs and slot creation/update wall timestamps differ; semantic source/brief/clock values are asserted.',
  ] };
  try {
    runtime = good(await createGcspRuntime({ mode: 'memory', repository, environmentId: 'f548-node-replay',
      commandId: 'f548-node-replay', policyAsOf: input.clock.now, wallNow: () => new Date(input.clock.now),
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
    const reset = good(await runtime.scenarios.reset(control, { commandId: 'f548-node-main', expectedRunId: state.runId,
      expectedRunVersion: state.runVersion, scenarioId: selected.scenarioId, scenarioVersion: selected.scenarioVersion,
      fixtureVersion: selected.fixtureVersion, policyVersion: selected.policyVersion }), 'Node Main reset');
    assert.equal(reset.startState.status, 'ok');
    control = good(await runtime.identity.createPresenterSession('f548-node-current-presenter'), 'Node current presenter').context;
    const employee = good(await runtime.identity.resolveEmployeeContext(control, 'employee-paula'), 'Node Paula');
    const brief = good(await runtime.brief.readCurrent(employee), 'Node initial brief').brief;
    for (const name of ['schemaVersion', 'preferences', 'essentials', 'knownFacts', 'buddy', 'policyVersion']) {
      assert.deepEqual(brief[name], input.initialBrief.brief[name], `Node actual initial ${name}`);
    }
    const account = good(await runtime.account.readAccount(employee), 'Node initial account');
    for (const name of ['state', 'asOf', 'account', 'drivers', 'contracts', 'currentContract', 'contractState', 'choices', 'allowance', 'versions']) {
      assert.deepEqual(account[name], input.account[name], `Node actual account ${name}`);
    }
    const initialClock = good(await runtime.clock.now(control), 'Node actual initial clock');
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
    const tick = good(await runtime.clock.advanceAndTick(control, { commandId: 'f548-node-release',
      expectedClockVersion: initialClock.clockVersion, mode: 'to', to: input.clock.nextRelease.at }), 'Node actual release/allocation');
    const activity = good(await runtime.activity.readActivity(employee), 'Node actual activity');
    const offer = activity.currentOffer;
    assert.equal(offer?.state, 'active', 'Node real services create an active offer');
    assert.equal(offer.orderUuid, expected.orderUuid, 'The same exact car is held by actual Node and Java services');
    assert.equal(offer.expiresAt, expected.expiresAt, 'The actual Node and Java offer deadlines agree');
    const actualHold = good(await repository.read(control, { table: 'holds', key: { runId: control.runId, holdId: offer.holdId } }), 'Node actual held row');
    const holdSemantic = Object.fromEntries(['orderUuid', 'employeeId', 'entitlementSlotId', 'type', 'state'].map((key) => [key, actualHold[key]]));
    holdSemantic.expiresAt = new Date(actualHold.expiresAt).toISOString();
    assert.deepEqual(holdSemantic, expected.hold, 'Actual Node and Java hold rows have identical common semantics');
    receipt.actualHold = { row: Object.fromEntries(['runId', 'holdId', 'version', 'orderUuid', 'employeeId', 'entitlementSlotId',
      'type', 'state', 'expiresAt'].map((key) => [key, actualHold[key]])), semantic: holdSemantic,
      identifierMapping: 'Each actual offer supplies its actual holdId; IDs/versions are recorded, not equated or seeded.' };
    context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce', locale: 'en-GB', timezoneId: 'Europe/London' });
    const issued = good(await runtime.identity.switchPrincipal(control, 'demo-paula', 'f548-node-browser-paula'), 'Node Paula session');
    const cookie = issued.setCookie.split(';', 1)[0];
    await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      url: origin, httpOnly: true, secure: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
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
    assert.equal(visible.car, expected.panel.car, 'The actual Node/Angular car titles agree');
    assert.equal(visible.detail, expected.panel.detail, 'The actual Node/Angular displayed deadlines agree');
    assert.equal(visible.image, expected.panel.image, 'The actual Node/Angular thumbnail sources agree');
    const destination = path.join(output, 'node-active-open-1280.png');
    await page.screenshot({ path: destination, fullPage: false });
    Object.assign(receipt, { state: 'matched', actualInitialBrief: { preferences: brief.preferences, essentials: brief.essentials, buddy: brief.buddy },
      actualInitialAccount: { account: account.account, slots: account.slots, versions: account.versions }, initialClock,
      actualContext: { runId: employee.runId, environmentId: employee.environmentId, employeeId: employee.employeeId, policyVersion: employee.policyVersion },
      tick: { clockVersion: tick.advance.clockVersion, now: tick.advance.now },
      offer: { orderUuid: offer.orderUuid, expiresAt: offer.expiresAt, state: offer.state }, visible,
      screenshot: destination, humanAcceptance: 'pending Gary/Russell review; engineering equality is not acceptance' });
    return receipt;
  } catch (error) {
    receipt.failure = { name: error.name, message: error.message.slice(0, 1000) };
    throw error;
  } finally {
    await context?.close();
    if (server) await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
    api?.closeAllConnections();
    await runtime?.close();
    writeFileSync(path.join(output, 'node-replay-receipt.json'), JSON.stringify(receipt, null, 2));
  }
}
