// Owned browser: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
// Invoked only by browser-supervisor.py after separate dispatcher admission.
import assert from 'node:assert/strict';
import { createServer, request as httpsRequest } from 'node:https';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildServer } from '../../../../server/index.js';
import { createGcspRuntime } from '../../../../server/gcsp/runtime.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../../../../server/gcsp/policy/index.js';
import { inputDigest, ok } from '../../../../server/gcsp/repository/index.js';
import { stock, fact, preference, essential } from '../../../../server/test/helpers/employee-recommendation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const chunk = process.env.FUCQ103_CHUNK;
assert.ok(['smoke-desktop', 'journey-desktop', 'journey-narrow320'].includes(chunk));
const scratch = resolve(process.env.FUCQ103_SCRATCH);
const output = resolve(process.env.FUCQ103_OUTPUT);
const ledgerPath = resolve(process.env.FUCQ103_PROCESS_LEDGER);
const sourcePlan = JSON.parse(await readFile(process.env.FUCQ103_SOURCE_PLAN, 'utf8'));
const viewport = { width: chunk === 'journey-narrow320' ? 320 : 1280, height: 900 };
const ledger = { pids: [process.pid], ports: [], profile: resolve(scratch, 'chrome-profile') };
const report = { chunk, viewport, state: 'incomplete', checks: [], screenshots: [], responses: [],
  consoleErrors: [], pageErrors: [], requestFailures: [], resourceFailures: [], externalRequests: [], overflow: [],
  scenario: 'Five synthetic persisted subjects; actual stored driver eligibility projected with provenance into Greg subject facts; canonical policy/privacy/cookies; memory provider',
  boundaries: 'Actual local memory runtime and HTTP adapters; no PostgreSQL, producer corpus, external integration or native proof.' };
const good = (reply) => { assert.equal(reply?.status, 'ok', JSON.stringify(reply)); return reply.value; };
const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mark = (name) => report.checks.push(name);
const saveLedger = () => writeFile(ledgerPath, JSON.stringify(ledger));
let runtime; let server; let backend; let chrome; let browser; let browserContext; let origin; let handler;
let sequence = 0; let presenterCookie; let sessionCookie; let session; let presenter; let pinnedBefore;
const apiPath = '/api/gcsp/greg/policy';
const embedPath = '/docs/gcsp/evidence/fucq103/browser-embed.html';
const responseJobs = new Set();
const policyStore = createMemoryPolicyStore();
const readPolicy = new PolicyService({ provider: new MemoryPolicyProvider({ store: policyStore }) });
const bound = (promise, milliseconds, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })])
    .finally(() => clearTimeout(timer));
};
async function request(path, { body, cookie = sessionCookie, expected = 200 } = {}) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  const reply = await new Promise((done, reject) => {
    const req = httpsRequest(origin + path, { rejectUnauthorized: false, method: encoded ? 'POST' : 'GET',
      headers: { Accept: 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
        ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}) } }, (res) => {
      const parts = []; let bytes = 0;
      res.on('data', (part) => { bytes += part.length; if (bytes > 1024 * 1024) req.destroy(new Error('API response cap')); else parts.push(part); });
      res.on('end', () => { try { done({ status: res.statusCode, headers: res.headers, json: JSON.parse(Buffer.concat(parts).toString()) }); } catch (error) { reject(error); } });
    });
    req.setTimeout(8000, () => req.destroy(new Error('API timeout'))); req.on('error', reject); req.end(encoded);
  });
  if (expected !== null) assert.equal(reply.status, expected, JSON.stringify(reply.json));
  return reply;
}
async function switchPrincipal(principalId) {
  const reply = await request('/api/gcsp/session/switch', { cookie: presenterCookie,
    body: { commandId: `browser-switch-${++sequence}`, principalId } });
  good(reply.json);
  const issued = reply.headers['set-cookie']; assert.ok(Array.isArray(issued) && issued.length);
  sessionCookie = issued.map((cookie) => cookie.split(';')[0]).join('; ');
  return good(await runtime.identity.resolveSession({ authorized: true, cookie: sessionCookie }));
}
async function advance() {
  const current = good(await runtime.clock.now(presenter));
  good(await runtime.clock.advance(presenter, { commandId: `browser-step-${++sequence}`,
    expectedClockVersion: current.clockVersion, bySeconds: 1 }));
}
async function retained() {
  return Object.fromEntries(await Promise.all(['quotes', 'holds', 'offers'].map(async (table) =>
    [table, good(await runtime.repository.query(session.value.context, table))])));
}
async function scenario(existing) {
  assert.equal(existing, runtime);
  session = await runtime.createLocalSession(); good(session);
  const cookies = [session.value.setCookie].flat();
  presenterCookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  sessionCookie = presenterCookie;
  presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: presenterCookie, purpose: 'presenter-control' }));
  const paula = session.value.context;
  const write = (work) => runtime.repository.transaction(paula,
    { commandId: `browser-synthetic-${++sequence}`, inputDigest: inputDigest(sequence) }, work).then(good);
  const instant = good(await runtime.clock.now(paula)).now;
  async function release(id) {
    const candidate = stock(id, { modelLine: fact('G21 Touring') });
    await write((tx) => tx.insert('stock', { runId: paula.runId, orderUuid: candidate.orderUuid,
      configurationId: candidate.configurationId, state: 'released', available: true, facts: candidate.snapshot,
      release: { availability: { ...candidate.availability, availableFrom: instant } },
      visibility: { companyIds: [paula.companyId], schemeIds: [paula.schemeId], employeeIds: null } }));
  }
  const brief = { schemaVersion: 1, preferences: { body: preference('estate'), fuel: preference('diesel') },
    essentials: { seats: essential(5), modelLine: essential('G21 Touring', 'equals', null) } };
  await release(1);
  good((await request('/api/gcsp/brief/draft', { body: { commandId: 'browser-draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief } })).json);
  good((await request('/api/gcsp/brief/confirm', { body: { commandId: 'browser-confirm', expectedBriefVersion: 0,
    expectedDraftVersion: 1, consent: { search: true, hold: true } } })).json);
  const recommendations = good((await request('/api/gcsp/recommendations', { body: { ...brief, briefVersion: 1 } })).json);
  const pinned = recommendations.recommendations[0]; assert.ok(pinned); assert.equal(pinned.terms.points.value, 1100);
  await write(async (tx) => {
    good(await tx.insert('quotes', { runId: paula.runId, quoteId: 'browser-pinned', orderUuid: pinned.orderUuid,
      employeeId: paula.employeeId, briefVersion: 1, policyVersion: pinned.versions.policy, terms: pinned.terms }));
    good(await tx.insert('holds', { runId: paula.runId, holdId: 'browser-pinned', orderUuid: pinned.orderUuid,
      employeeId: paula.employeeId, entitlementSlotId: paula.entitlementSlotId, type: 'buddy-offer', state: 'active',
      quoteId: 'browser-pinned', policyVersion: pinned.versions.policy }));
    good(await tx.insert('offers', { runId: paula.runId, offerId: 'browser-pinned', holdId: 'browser-pinned', orderUuid: pinned.orderUuid,
      employeeId: paula.employeeId, state: 'active', quoteId: 'browser-pinned', briefVersion: 1, policyVersion: pinned.versions.policy }));
    const ref = { table: 'stock', key: { runId: paula.runId, orderUuid: pinned.orderUuid } };
    return tx.compareAndSwap(ref, good(await tx.get(ref)).version, { state: 'held', held: true, available: false });
  });
  await release(2);
  // Explicit synthetic scenario preparation, never a default/provider/seed repair.
  const stored = good(await runtime.repository.read(paula, { table: 'employees', key: { runId: paula.runId, employeeId: paula.employeeId } }));
  const manual = stored.contract.manualContext;
  const drivers = manual.drivers.filter((row) => row.kind === 'employee' && row.employeeId === paula.employeeId);
  assert.equal(drivers.length, 1); const eligibility = structuredClone(drivers[0].eligible);
  assert.equal(eligibility.status, 'known'); assert.equal(eligibility.value, true);
  assert.equal(eligibility.provenance.assurance, 'synthetic-scenario');
  await write((tx) => tx.compareAndSwap({ table: 'employees', key: { runId: paula.runId, employeeId: paula.employeeId } },
    stored.version, { contract: { ...stored.contract, manualContext: { ...manual,
      employeeFacts: { ...manual.employeeFacts, driverEligible: eligibility } } } }));
  const originalEmployee = good(await runtime.repository.read(paula, { table: 'employees', key: { runId: paula.runId, employeeId: paula.employeeId } }));
  const originalBrief = good(await runtime.repository.read(paula, { table: 'briefs', key: { runId: paula.runId, employeeId: paula.employeeId, briefVersion: 1 } }));
  const stripMetadata = ({ version, createdAt, updatedAt, ...row }) => row;
  // Persist four extra explicitly synthetic subjects; no identity principal, policy or privacy override.
  await write(async (tx) => {
    for (let index = 2; index <= 5; index += 1) {
      const employeeId = `fucq103-synthetic-${index}`; const entitlementSlotId = `slot:${employeeId}`;
      const rewrite = (value) => typeof value === 'string' ? value === paula.entitlementSlotId ? entitlementSlotId
        : value.replaceAll(paula.employeeId, employeeId).replaceAll(originalEmployee.name, `Synthetic subject ${index}`)
        : Array.isArray(value) ? value.map(rewrite) : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)])) : value;
      good(await tx.insert('employees', { ...rewrite(stripMetadata(originalEmployee)), employeeId, principalId: employeeId,
        entitlementSlotId, name: `Synthetic subject ${index}` }));
      good(await tx.insert('entitlement_slots', { runId: paula.runId, entitlementSlotId, employeeId,
        renewalId: `renewal:${employeeId}`, capacity: 1, employeeCapacity: 1, state: 'entitled' }));
      good(await tx.insert('briefs', { ...rewrite(stripMetadata(originalBrief)), employeeId, entitlementSlotId, confirmedBy: employeeId }));
    }
    return ok({ syntheticSubjects: 5 });
  });
  pinnedBefore = await retained();
  const greg = await switchPrincipal('demo-greg');
  const projection = good((await request(apiPath)).json);
  const adopted = good(await runtime.policy.adoptReviewedAssumptions(greg, { commandId: 'browser-adopt-editor',
    expectedActiveVersion: projection.activeVersion, policyVersion: 'browser-editor-v2', effectiveFrom: projection.asOf,
    definitionSetId: 'greg-publish-editor-v1' }));
  assert.equal(adopted.activationRequired, false);
  await advance();
  report.initialPinnedDigest = hash(pinnedBefore);
  mark('Real runtime, HTTP-confirmed brief and calculated 1100-point pinned quote; explicit stored driver-fact projection and five synthetic subjects; reviewed editor adoption');
  return cookies;
}
function cookieForBrowser(line) {
  const [pair, ...attributes] = line.split(';').map((part) => part.trim());
  const at = pair.indexOf('='); const values = new Map(attributes.map((part) => { const at = part.indexOf('='); return at < 0 ? [part.toLowerCase(), true] : [part.slice(0, at).toLowerCase(), part.slice(at + 1)]; }));
  assert.equal(values.get('secure'), true); assert.equal(values.get('httponly'), true);
  const sameSite = String(values.get('samesite')); assert.ok(['Strict', 'Lax', 'None'].includes(sameSite));
  return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: '127.0.0.1', path: values.get('path'),
    secure: true, httpOnly: true, sameSite, expires: Date.parse(values.get('expires')) / 1000 };
}
async function pageRequest(page, path, body, expected = 200) {
  const response = await page.request.fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin }, ...(body === undefined ? {} : { data: body }) });
  const json = await response.json(); assert.equal(response.status(), expected, JSON.stringify(json)); return good(json);
}
async function actualEmployee(page, expectedPoints, eligible) {
  // Ordinary role-switch HTTP command changes the acting cookie; the brief view uses its real transport.
  await pageRequest(page, '/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: `employee-${++sequence}` });
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/gcsp/brief/preview');
  await page.goto(origin + embedPath + '?view=brief');
  const response = await responsePromise; const value = good(await response.json());
  assert.equal(value.eligibleCount > 0, eligible);
  if (eligible) assert.ok(value.decisions.some((decision) => decision.gateStatus === 'eligible' && decision.terms.points.value === expectedPoints));
  await page.locator('.gcsp-brief-preview-status').filter({ hasText: eligible ? /[1-9].*eligible/ : /^0 eligible/ }).waitFor();
  const rendered = await page.locator('.gcsp-brief-preview').innerText();
  if (eligible) assert.ok(rendered.includes(String(expectedPoints)) || rendered.includes(expectedPoints.toLocaleString('en-GB')));
  const term = eligible ? page.locator('.gcsp-brief-cards .vm-card-terms .vm-specs')
    .filter({ hasText: `${expectedPoints.toLocaleString('en-GB')} points a month` }).first()
    : page.locator('.gcsp-brief-preview-status');
  await capture(page, eligible ? `employee-${expectedPoints}` : 'employee-no-suitable', { target: term });
  if (!eligible) await capture(page, 'employee-no-suitable-reasons', {
    target: page.locator('.gcsp-brief-cards .vm-card-decision').first() });
  mark(`Actual employee brief HTTP preview/render ${eligible ? expectedPoints + ' points' : 'no suitable car'}`);
  await pageRequest(page, '/api/gcsp/session/switch', { principalId: 'demo-greg', commandId: `greg-${++sequence}` });
}
async function gregPage(page) {
  await page.goto(origin + '/gcsp-presenter.html'); await state(page, 'draft');
  assert.equal(await page.locator('.gcsp-publish input[type=number]').count(), 7);
}
const panel = (page) => page.locator('.gcsp-publish').first();
const state = (page, name) => page.locator(`.gcsp-publish[data-state="${name}"]`).first().waitFor();
const points = (page) => panel(page).getByLabel('Monthly points cost', { exact: true });
async function priceRow(page) {
  const policy = await pageRequest(page, apiPath);
  const row = policy.fields.find((field) => field.kind === 'price' && field.matchValue === 'G21 Touring|320i' && field.schemeId === session.value.context.schemeId);
  assert.ok(row); await panel(page).getByLabel('Published points row', { exact: true }).selectOption(row.id); return { policy, row };
}
async function captureTarget(page, name, target) {
  const focus = await page.evaluateHandle(() => document.activeElement);
  let surface = null;
  try {
    if (target) {
      await target.waitFor({ state: 'visible' });
      await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      surface = await target.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { text: node.textContent.trim().slice(0, 500), tag: node.tagName, id: node.id,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
          scroll: { x: scrollX, y: scrollY }, viewport: { width: innerWidth, height: innerHeight } };
      });
      const { rect } = surface;
      assert.ok(rect.width > 0 && rect.height > 0 && rect.x >= -1 && rect.y >= -1
        && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1,
      `Capture target must be visible inside the viewport: ${JSON.stringify(surface)}`);
    }
    const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter((node) => {
        const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && rect.right > innerWidth + 1 && !node.closest('.gcsp-table-wrap, .gcsp-table-scroll, .gcsp-data-table-scroll');
      }).slice(0, 12).map((node) => ({ tag: node.tagName, class: node.className })) }));
    report.overflow.push({ name, ...overflow }); assert.ok(overflow.document <= viewport.width + 1, JSON.stringify(overflow));
    const path = resolve(output, `${name}.png`); await page.screenshot({ path, fullPage: false });
    assert.equal(await page.evaluate((original) => document.activeElement === original, focus), true);
    report.screenshots.push({ name, path, viewport, surface, focusPreserved: true });
  } finally { await focus.dispose(); }
}
async function capture(page, name, { target, overview = false } = {}) {
  if (overview || target) return captureTarget(page, name, target);
  const publish = panel(page);
  await captureTarget(page, name, name === 'validation-errors'
    ? publish.locator('.gcsp-error-summary') : publish.locator('[role=status]').first());
  const current = await publish.getAttribute('data-state');
  if (current === 'draft') {
    await captureTarget(page, `${name}-heading`, publish.locator('h2').first());
    await captureTarget(page, `${name}-controls`, publish.locator('.gcsp-publish-control').first());
  }
  if (current === 'preview-ready') {
    for (const [suffix, caption] of [['outcomes', 'Preview outcomes'], ['changes', 'Changed values in this preview']])
      await captureTarget(page, `${name}-${suffix}`, publish.getByRole('region', { name: caption, exact: true }));
  }
  if (current === 'published')
    await captureTarget(page, `${name}-details`, publish.locator('.gcsp-publish-results'));
}
async function observeBusy(page, path, busyState, name, action) {
  if (report.screenshots.some((capture) => capture.name === name)) return action();
  let release; let arrived;
  const held = new Promise((done) => { release = done; });
  const seen = new Promise((done) => { arrived = done; });
  const routePattern = '**' + path;
  const gate = async (route) => {
    const actual = await route.fetch({ timeout: 8000 }); arrived(); await held;
    await route.fulfill({ response: actual });
  };
  await page.route(routePattern, gate);
  try { await action(); await bound(seen, 8000, 'Busy-state response gate timeout'); await state(page, busyState); await capture(page, name); }
  finally { release(); await page.unroute(routePattern, gate); }
}
async function preview(page) {
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === apiPath + '/preview');
  await observeBusy(page, apiPath + '/preview', 'preview-loading', 'preview-loading',
    async () => { const button = panel(page).getByRole('button', { name: 'Preview changes', exact: true });
      await button.focus(); await button.press('Enter'); });
  const reply = await responsePromise; assert.equal(reply.status(), 200); const value = good(await reply.json());
  await state(page, 'preview-ready'); return value;
}
async function publish(page) {
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === apiPath + '/publish');
  await observeBusy(page, apiPath + '/publish', 'publishing', 'publishing',
    () => panel(page).getByRole('button', { name: 'Publish this preview', exact: true }).click());
  const response = await responsePromise; assert.equal(response.status(), 200); const value = good(await response.json());
  await state(page, 'published'); assert.equal(value.activationRequired, false); return value;
}
async function controls(page) {
  const { policy, row } = await priceRow(page);
  assert.equal(policy.fields.filter((field) => field.kind === 'weight').length, 6);
  assert.ok(policy.fields.every((field) => field.presentationRange));
  const select = panel(page).getByLabel('Published points row', { exact: true });
  const input = points(page); const identity = await input.elementHandle(); await input.focus();
  await input.fill('1201'); assert.equal(await input.evaluate((node) => node === document.activeElement), true);
  const second = policy.fields.find((field) => field.kind === 'price' && field.id !== row.id); assert.ok(second);
  await select.selectOption(second.id); await input.fill('1301'); await select.selectOption(row.id); assert.equal(await input.inputValue(), '1201');
  await select.selectOption(second.id); assert.equal(await input.inputValue(), '1301'); await input.fill(String(second.value)); await select.selectOption(row.id);
  const slider = panel(page).locator('.gcsp-publish-control').first().locator('input[type=range]');
  await slider.focus(); const old = Number(await input.inputValue()); await slider.press('ArrowRight'); assert.equal(Number(await input.inputValue()), old + 1);
  await input.fill('5000'); assert.equal(await input.inputValue(), '5000'); assert.equal(await slider.isVisible(), false);
  assert.ok((await panel(page).innerText()).includes('It is retained'));
  await input.fill(''); await select.selectOption(second.id); await input.fill('-1');
  await panel(page).getByRole('button', { name: 'Preview changes', exact: true }).click();
  const summary = panel(page).locator('.gcsp-error-summary'); await summary.waitFor();
  assert.equal(await summary.locator('h2').evaluate((node) => node === document.activeElement), true);
  const links = summary.locator('a'); assert.equal(await links.count(), 2);
  await capture(page, 'validation-errors');
  const invalidOrder = policy.fields.filter((field) => [row.id, second.id].includes(field.id));
  for (let index = 0; index < invalidOrder.length; index += 1) {
    await links.nth(index).click(); assert.equal(await select.inputValue(), invalidOrder[index].id);
    assert.equal(await input.evaluate((node) => node === document.activeElement), true);
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
  }
  await select.selectOption(second.id); await input.fill(String(second.value));
  await select.selectOption(row.id); await input.fill('1200');
  await input.press('Tab'); assert.notEqual(await input.evaluate((node) => node === document.activeElement), true);
  await input.press('Shift+Tab');
  await preview(page); assert.equal(await input.evaluate((node, original) => node === original, identity), true);
  await input.fill('1201'); await state(page, 'draft'); assert.equal(await panel(page).getByRole('button', { name: 'Publish this preview', exact: true }).isDisabled(), true);
  await input.fill('1200');
  const fuelWeight = policy.fields.find((field) => field.kind === 'weight' && field.key === 'fuel'); assert.ok(fuelWeight);
  await panel(page).getByLabel('Fuel weight', { exact: true }).fill(String(fuelWeight.value + 1));
  const weighted = await preview(page);
  assert.equal(weighted.active.fit.meanBestScore.status, 'available');
  assert.equal(weighted.draft.fit.meanBestScore.status, 'available');
  assert.notEqual(weighted.active.fit.meanBestScore.value, weighted.draft.fit.meanBestScore.value);
  await capture(page, 'preview-ready');
  mark('Stable native inputs, row retention, arrow slider/exact sync, retained out-of-range value, two-row validation focus/links, Tab/Enter and preview invalidation');
}
async function journey(page) {
  await gregPage(page); await controls(page);
  const keptPanel = await panel(page).elementHandle();
  const keptQueue = await page.locator('[data-region=case-queue]').elementHandle();
  const first = await publish(page);
  assert.equal(await panel(page).evaluate((node, original) => node === original, keptPanel), true);
  assert.equal(await page.locator('[data-region=case-queue]').evaluate((node, original) => node === original, keptQueue), true); assert.equal(first.heldOffers.count, 1); await capture(page, 'published-1200');
  assert.deepEqual(await retained(), pinnedBefore);
  await actualEmployee(page, 1200, true);
  await advance(); await gregPage(page); await priceRow(page);
  await points(page).fill('4000');
  const changed = await preview(page);
  assert.equal(changed.active.demand.privacy.threshold, 5);
  assert.equal(changed.active.fit.employeesWithEligibleStock.kind, 'exact');
  assert.equal(changed.active.fit.employeesWithEligibleStock.value, 5);
  assert.equal(changed.draft.demand.demand.unmet.total.count.kind, 'exact');
  assert.equal(changed.draft.demand.demand.unmet.total.count.value, 5);
  assert.equal(changed.draft.fit.meanBestScore.status, 'suppressed');
  await capture(page, 'allowance-crossing-preview'); await publish(page);
  await actualEmployee(page, null, false);
  await advance(); await gregPage(page); const { policy, row } = await priceRow(page);
  await points(page).fill('1200');
  const weight = policy.fields.find((field) => field.kind === 'weight');
  await panel(page).getByLabel(`${weight.key[0].toUpperCase()}${weight.key.slice(1)} weight`, { exact: true }).fill(String(weight.value + 1));
  const weighted = await preview(page); assert.ok(weighted.differences.some((field) => field.id === weight.id));
  // Competing accepted publication produces an actual stale rejection in the still-open panel.
  const competing = await pageRequest(page, apiPath + '/publish', { expectedActiveVersion: policy.activeVersion,
    commandId: 'competing-publication', policyVersion: 'browser-competing-v3', effectiveFrom: weighted.asOf,
    changes: [{ id: row.id, value: 1250 }] }); assert.equal(competing.accepted, true);
  const rejected = page.waitForResponse((response) => new URL(response.url()).pathname === apiPath + '/publish');
  await panel(page).getByRole('button', { name: 'Publish this preview', exact: true }).click();
  assert.equal((await rejected).status(), 409); await state(page, 'rejected'); await capture(page, 'stale-rejection');
  mark('Actual 1200-point terms, visible canonical-threshold demand/fit change, weight preview, stale publication rejection; retained held history');
  await advance(); await panel(page).getByRole('button', { name: 'Refresh policy', exact: true }).click(); await state(page, 'draft'); await priceRow(page); await points(page).fill('1200'); await preview(page);
  const priorVersionCount = policyStore.runs.get(session.value.context.runId).length;
  const acceptedBodies = []; let dropped = false; let acceptedVersion;
  await page.route('**/api/gcsp/greg/policy/publish', async (route) => {
    acceptedBodies.push(route.request().postData());
    if (!dropped) {
      dropped = true;
      const completed = await route.fetch({ timeout: 8000 }); assert.equal(completed.status(), 200);
      const accepted = good(await completed.json()); assert.equal(accepted.accepted, true); acceptedVersion = accepted.policyVersion;
      await route.abort('connectionfailed');
    } else await route.continue();
  });
  await panel(page).getByRole('button', { name: 'Publish this preview', exact: true }).click(); await state(page, 'unavailable');
  await capture(page, 'accepted-response-lost');
  await panel(page).getByRole('button', { name: 'Retry original publication', exact: true }).click(); await state(page, 'published');
  assert.equal(acceptedBodies.length, 2); assert.equal(acceptedBodies[0], acceptedBodies[1]);
  const history = policyStore.runs.get(session.value.context.runId);
  assert.equal(history.filter((record) => record.seed.policyVersion === acceptedVersion).length, 1);
  assert.equal(history.length, priorVersionCount + 1);
  report.retry = { identicalBody: true, bodyDigest: hash(acceptedBodies[0]), policyVersion: acceptedVersion,
    appendCount: 1, fault: 'Real HTTP acceptance completed; browser response deliberately dropped once' };
  await page.unroute('**/api/gcsp/greg/policy/publish');
  assert.deepEqual(await retained(), pinnedBefore); report.finalPinnedDigest = hash(await retained());
  await capture(page, 'retry-published'); mark('Accepted-but-lost real HTTP response; identical original retry and one appended version');
  await pageRequest(page, '/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: `refused-${++sequence}` });
  await page.goto(origin + embedPath); await state(page, 'refused'); await capture(page, 'employee-refused');
  mark('Standalone custom element actual non-Greg HTTP refusal');
}
async function smoke(page) {
  await gregPage(page); await capture(page, 'draft-desktop-overview', { overview: true }); await capture(page, 'draft-desktop');
  await page.goto(origin + embedPath + '?view=dashboard'); await state(page, 'draft');
  assert.equal(await page.locator('gcsp-greg-dashboard').count(), 1);
  assert.equal(await page.locator('[data-proof-host]').getAttribute('data-ready'), 'true');
  await page.goto(origin + embedPath + '?view=two');
  await page.locator('.gcsp-publish[data-state=draft]').nth(1).waitFor();
  const ids = await page.locator('.gcsp-publish [id]').evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.equal(ids.length, new Set(ids).size);
  // Exercise disconnect while a real policy response is held, then remount to a fresh HTTP read.
  let release; let arrived;
  const held = new Promise((done) => { release = done; }); const seen = new Promise((done) => { arrived = done; });
  await page.route('**/api/gcsp/greg/policy', async (route) => { arrived(); await held; await route.continue().catch(() => {}); });
  await page.locator('gcsp-greg-publish').first().evaluate((node) => { node.refresh(); }); await bound(seen, 8000, 'Detached request gate timeout');
  await page.locator('gcsp-greg-publish').first().evaluate((node) => { globalThis.detachedProof = node; node.remove(); });
  release(); await page.unroute('**/api/gcsp/greg/policy');
  assert.equal(await page.evaluate(() => globalThis.detachedProof.childElementCount), 0);
  await page.evaluate(() => { document.querySelector('[data-proof-host]').prepend(globalThis.detachedProof); delete globalThis.detachedProof; });
  await state(page, 'draft'); await capture(page, 'custom-elements');
  mark('Presenter/dashboard embedding, two-instance unique IDs and disconnect/remount during real policy request');
  await actualEmployee(page, 1100, true); assert.deepEqual(await retained(), pinnedBefore);
}
async function start() {
  await mkdir(resolve(scratch, 'tls'), { recursive: true }); await saveLedger();
  const cert = resolve(scratch, 'tls/cert.pem'); const key = resolve(scratch, 'tls/key.pem');
  const openssl = spawn(sourcePlan.executables.openssl.path, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  ledger.pids.push(openssl.pid); await saveLedger();
  const [code] = await bound(once(openssl, 'exit'), 6000, 'TLS preparation timeout'); assert.equal(code, 0);
  server = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
    try {
      const path = new URL(req.url, 'https://127.0.0.1').pathname;
      if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (path.startsWith('/api/gcsp/')) { assert.ok(handler); return handler(req, res); }
      const relative = decodeURIComponent(path).replace(/^\//, '');
      if (req.method !== 'GET' || !Object.hasOwn(sourcePlan.sources, relative) || /^(?:server|_tools)\//.test(relative)
        || !['.js', '.mjs', '.css', '.html', '.svg', '.png', '.jpg', '.webp', '.woff', '.woff2', '.json'].includes(extname(relative))) {
        res.writeHead(404); return res.end();
      }
      const file = resolve(root, relative); assert.ok(file.startsWith(root + '/'));
      const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };
      res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'" });
      res.end(await readFile(file));
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  ledger.ports.push(server.address().port); await saveLedger(); origin = `https://127.0.0.1:${server.address().port}`;
  // Composition is deferred until the origin is known. The bootstrap below never changes identity cookie policy.
  runtime = good(await createGcspRuntime({ mode: 'memory', environmentId: `fucq103-${chunk}`,
    policy: readPolicy, policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'browser-bootstrap' }));
  backend = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] });
  good(await backend.gcspStartup); handler = backend.listeners('request')[0];
  // scenario() consumes this same delivered runtime.
  const cookies = await scenario(runtime);
  const { chromium } = await import(sourcePlan.playwrightEntry);
  chrome = spawn(sourcePlan.executables.chrome.path, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${ledger.profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-breakpad',
    '--metrics-recording-only', '--disable-application-cache', '--disk-cache-size=1048576', '--media-cache-size=1048576', 'about:blank'],
  { stdio: 'ignore' }); ledger.pids.push(chrome.pid); await saveLedger();
  const activePort = resolve(ledger.profile, 'DevToolsActivePort'); const deadline = Date.now() + 8000;
  while (true) { try { await access(activePort); break; } catch { assert.ok(Date.now() < deadline, 'Chrome DevTools timeout'); await pause(50); } }
  const [port] = (await readFile(activePort, 'utf8')).trim().split('\n'); ledger.ports.push(Number(port)); await saveLedger();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 8000 });
  browserContext = await browser.newContext({ viewport, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
  await browserContext.addCookies(cookies.map(cookieForBrowser));
  const page = await browserContext.newPage(); page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(10000);
  await pageRequest(page, '/api/gcsp/session/switch', { principalId: 'demo-greg', commandId: 'browser-initial-greg' });
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== origin) { report.externalRequests.push(route.request().url().split('?')[0]); await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 500)); });
  page.on('pageerror', (error) => report.pageErrors.push(error.message.slice(0, 500)));
  page.on('requestfailed', (req) => report.requestFailures.push({ path: new URL(req.url()).pathname, failure: req.failure()?.errorText }));
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && !(path.startsWith(apiPath) && [403, 409].includes(response.status())))
      report.resourceFailures.push({ path, status: response.status() });
    if (!path.startsWith(apiPath)) return;
    const job = (async () => { const json = await response.json(); report.responses.push({ path, status: response.status(), body: json }); })()
      .catch(() => {}).finally(() => responseJobs.delete(job)); responseJobs.add(job);
  });
  if (chunk === 'smoke-desktop') await smoke(page); else await journey(page);
  await Promise.all(responseJobs);
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.resourceFailures, []);
  const unexpectedFailures = report.requestFailures.filter((failure) => !(failure.path === apiPath + '/publish'
    && chunk !== 'smoke-desktop') && !(failure.path === apiPath && chunk === 'smoke-desktop'));
  assert.deepEqual(unexpectedFailures, []);
  report.state = 'passed'; report.origin = origin; report.finishedAt = new Date().toISOString();
}
try { await start(); }
catch (error) { report.error = { name: error.name, message: error.message.slice(0, 2500), stack: error.stack?.slice(0, 4000) }; }
finally {
  const cleanupErrors = [];
  for (const [name, close] of [ ['browserContext', () => browserContext?.close()], ['browser', () => browser?.close()],
    ['server', () => server && new Promise((done) => { server.close(done); server.closeAllConnections(); })],
    ['runtime', () => runtime?.close()], ['policy', () => readPolicy.close()] ]) {
    try { await bound(Promise.resolve().then(close), 3000, name + ' close timeout'); } catch (error) { cleanupErrors.push(error.message); }
  }
  if (chrome && chrome.exitCode === null) { chrome.kill('SIGTERM'); try { await bound(once(chrome, 'exit'), 3000, 'Chrome exit timeout'); } catch (error) { cleanupErrors.push(error.message); } }
  report.driverCleanupErrors = cleanupErrors;
  if (cleanupErrors.length) report.state = 'incomplete';
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ chunk, state: report.state, checks: report.checks.length, screenshots: report.screenshots.length }));
}
process.exitCode = report.state === 'passed' ? 0 : 1;
