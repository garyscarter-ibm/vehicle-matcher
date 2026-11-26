import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, startComposition } from './composition.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  assert.fail(message);
}
const good = ({ status, body }, label) => {
  assert.equal(status, 200, label); assert.equal(body.status, 'ok', label); return body.value;
};
const appointmentPath = (orderUuid) => `/appointments?orderUuid=${encodeURIComponent(orderUuid)}`;
const posts = (suite) => suite.receipt.requests.filter((row) => row.method === 'POST' && row.path === '/appointments/request');
const slots = (page) => page.locator('ul.gcsp-slot-picker').first().getByRole('button');
async function settled(page) {
  await until(async () => await page.locator('.order-sections[aria-busy="true"]').count() === 0
    && await page.getByRole('button', { name: 'Refresh status', exact: true }).isEnabled(), 'Orders settles after the actual read');
}
async function capture(suite, page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${label}: no horizontal overflow`);
  return suite.screenshot(page, label, { fullPage: true });
}
async function read(suite, page, route, label) {
  const response = await suite.call(page, 'GET', route);
  suite.receipt.noEffectRetry.reads.push({ label, response });
  return good(response, label);
}
async function refresh(suite, page) {
  const count = posts(suite).length;
  const response = page.waitForResponse((value) => value.request().method() === 'GET'
    && new URL(value.url()).pathname.endsWith('/orders/progress/all'));
  const button = page.getByRole('button', { name: 'Refresh status', exact: true });
  await button.focus(); await page.keyboard.press('Enter');
  const actual = await response;
  good({ status: actual.status(), body: await actual.json() }, 'Refresh reads actual owned orders');
  await settled(page);
  assert.equal(posts(suite).length, count, 'Refresh sends zero appointment POSTs');
  suite.receipt.noEffectRetry.refreshFocus ??= [];
  suite.receipt.noEffectRetry.refreshFocus.push(await page.evaluate(() => ({ tag: document.activeElement?.tagName,
    text: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 120) })));
}
async function review(suite, page) {
  const count = posts(suite).length;
  const button = slots(page).first();
  await until(() => button.isEnabled(), 'Authoritative offered slot permits a fresh review');
  await button.focus(); await page.keyboard.press('Enter');
  const panel = page.locator('.order-review'); await panel.waitFor();
  assert.equal(await panel.locator('h2').innerText(), 'Request this handover time?');
  await until(() => panel.evaluate((node) => node === document.activeElement), 'Keyboard review receives focus');
  assert.equal(posts(suite).length, count, 'Review alone never sends a command');
  return panel;
}
async function confirm(suite, page, panel) {
  const count = posts(suite).length;
  const response = page.waitForResponse((value) => value.request().method() === 'POST'
    && new URL(value.url()).pathname.endsWith('/appointments/request'));
  await panel.getByRole('button', { name: 'Confirm', exact: true }).focus();
  await page.keyboard.press('Enter');
  const actual = await response;
  await until(() => posts(suite).length === count + 1, 'Exactly one actual command response is observed');
  await settled(page);
  return { status: actual.status(), sent: actual.request().postDataJSON(), body: await actual.json() };
}
async function notice(page, expected) {
  const live = page.locator('.order-feedback');
  assert.equal(await live.getAttribute('aria-live'), 'polite');
  const message = live.locator('.order-notice'); await message.waitFor();
  assert.match(await message.innerText(), expected);
  await until(() => message.evaluate((node) => node === document.activeElement), 'The outcome notice receives keyboard focus');
}

test('FUCQ-521: only a proven no-effect refusal permits deliberate retry; uncertain durable writes stay locked', { timeout: 480000 }, async () => {
  const suite = await startComposition({ caseId: 'f521' });
  suite.receipt.noEffectRetry = { reads: [], refusals: [], recovered: [], transportFault: null,
    coverageLimits: ['The browser receives a malformed acknowledgement after the genuine pending202; direct pending-acknowledgement UI and generic unavailable classification are covered by the focused Orders specs.'] };
  try {
    assert.ok(suite.appointments, 'The scoped test-only appointment host is required');
    const employee = await suite.newPage('employee', 'demo-paula', 'account');
    const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
    const state = await suite.releaseMainOffer(employee, presenter);
    await employee.goto(`${suite.origins.web}/gcsp/offers/${encodeURIComponent(state.offer.offerRef.offerId)}`, { waitUntil: 'domcontentloaded' });
    await employee.getByRole('button', { name: 'Review & accept', exact: true }).click();
    const acceptance = employee.getByRole('dialog', { name: 'Accept your offer', exact: true });
    const mileage = acceptance.getByLabel('Expected return mileage (miles)', { exact: true });
    await mileage.fill('5400'); await mileage.press('Tab');
    const declarations = acceptance.getByRole('checkbox');
    assert.ok(await declarations.count() > 0);
    for (let index = 0; index < await declarations.count(); index++) await declarations.nth(index).check();
    const decision = employee.waitForResponse((value) => value.request().method() === 'POST' && new URL(value.url()).pathname.endsWith('/decision'));
    await acceptance.getByRole('button', { name: 'Accept offer', exact: true }).click();
    const accepted = await decision; good({ status: accepted.status(), body: await accepted.json() }, 'The real offer is accepted');
    const orderUuid = state.offer.orderUuid;
    let progress = await read(suite, employee, `/orders/progress?orderUuid=${encodeURIComponent(orderUuid)}`, 'Accepted owned order');
    const policy = JSON.parse(readFileSync(path.join(ROOT, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
    const ticks = policy.assumptions.find((row) => row.key === 'lifecycle.approval.ticks.v1'); assert.ok(ticks);
    const maximum = Object.values(ticks.value).reduce((sum, count) => sum + count, 0) + progress.stageList.length;
    for (let count = 0; count < maximum && progress.outcome !== 'sent-to-ordering'; count++) {
      const clock = await read(suite, presenter, '/presenter/clock', 'Approval clock');
      good(await suite.call(presenter, 'POST', '/presenter/clock/tick', { tickId: randomUUID(), expectedClockVersion: clock.clockVersion }), 'Actual approval tick');
      progress = await read(suite, employee, `/orders/progress?orderUuid=${encodeURIComponent(orderUuid)}`, 'Actual approval progress');
    }
    assert.equal(progress.outcome, 'sent-to-ordering');
    await employee.goto(`${suite.origins.web}/gcsp/orders`, { waitUntil: 'domcontentloaded' });
    await employee.locator('.gcsp-stage-list').waitFor(); await settled(employee);
    const original = await read(suite, employee, appointmentPath(orderUuid), 'Actual version-zero offering');
    assert.equal(original.orderUuid, orderUuid); assert.equal(original.runId, suite.receipt.composition.runId);
    assert.equal(original.employeeId, suite.input.initialBrief.brief.employeeId);
    assert.equal(original.version, 0); assert.equal(original.state, 'not-requested'); assert.equal(original.pending, null);
    assert.ok(original.offeredSlots[0]?.slotId);
    const commandIds = [];
    for (const width of [1280, 375]) {
      await employee.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      const panel = await review(suite, employee);
      suite.appointments.configure(orderUuid, { offerUnavailable: true });
      const refusal = await confirm(suite, employee, panel);
      suite.receipt.noEffectRetry.refusals.push({ width, ...refusal });
      assert.equal(refusal.status, 503); assert.equal(refusal.body.status, 'unavailable');
      assert.equal(refusal.body.code, 'offer-unavailable'); assert.equal(refusal.body.retryable, true);
      assert.equal(refusal.sent.orderUuid, orderUuid); assert.equal(refusal.sent.expectedVersion, 0);
      assert.equal(refusal.sent.slotId, original.offeredSlots[0].slotId); assert.ok(refusal.sent.commandId);
      assert.ok(!commandIds.includes(refusal.sent.commandId)); commandIds.push(refusal.sent.commandId);
      const empty = suite.appointments.persistence(orderUuid);
      assert.equal(empty.appointments, 0); assert.equal(empty.pendingIntents, 0);
      await notice(employee, /handover|available|try|refresh/i);
      await capture(suite, employee, `no-effect-refusal-${width}`);
      suite.appointments.configure(orderUuid, { offerUnavailable: false });
      const recovered = await read(suite, employee, appointmentPath(orderUuid), 'Provider recovered before explicit Refresh');
      assert.equal(recovered.version, 0); assert.equal(recovered.pending, null);
      assert.deepEqual(recovered.offeredSlots, original.offeredSlots);
      assert.equal(suite.appointments.persistence(orderUuid).pendingIntents, 0);
      await refresh(suite, employee);
      await until(() => slots(employee).first().isEnabled(), 'Recovered unchanged version permits deliberate review');
      suite.receipt.noEffectRetry.recovered.push({ width, version: recovered.version, pending: recovered.pending, posts: posts(suite).length });
      await capture(suite, employee, `no-effect-recovered-${width}`);
    }
    assert.equal(posts(suite).length, 2, 'Two deliberate refusals and no automatic replay');
    suite.appointments.configure(orderUuid, { writePending: true });
    const panel = await review(suite, employee);
    const requestUrl = `${suite.apiBase}/appointments/request`;
    await employee.route(requestUrl, async (route) => {
      const actual = await route.fetch();
      const body = await actual.json();
      const persistence = suite.appointments.persistence(orderUuid);
      suite.receipt.noEffectRetry.transportFault = { actual: { status: actual.status(), body, sent: route.request().postDataJSON() },
        persistenceBeforeResponseFault: persistence, delivered: 'Malformed JSON after actual Java pending response and durable native PostgreSQL intent' };
      assert.equal(actual.status(), 202); assert.equal(body.status, 'pending'); assert.ok(body.operationId);
      assert.equal(persistence.appointments, 1); assert.equal(persistence.pendingIntents, 1);
      await route.fulfill({ status: 202, contentType: 'application/json', body: '{' });
    }, { times: 1 });
    const finalResponse = employee.waitForResponse((value) => value.request().method() === 'POST' && value.url() === requestUrl);
    await panel.getByRole('button', { name: 'Confirm', exact: true }).focus(); await employee.keyboard.press('Enter');
    await finalResponse; await settled(employee);
    const committed = suite.receipt.noEffectRetry.transportFault.actual;
    assert.ok(!commandIds.includes(committed.sent.commandId), 'Fresh confirmation uses a new commandId after no-effect recovery');
    assert.equal(committed.sent.expectedVersion, 0); assert.equal(committed.sent.slotId, original.offeredSlots[0].slotId);
    await until(() => posts(suite).length === 3, 'Fresh confirmation sends exactly one further POST');
    await notice(employee, /Waiting for confirmation of your update/);
    const pending = await read(suite, employee, appointmentPath(orderUuid), 'Authoritative genuinely pending request');
    assert.ok(pending.version > 0); assert.equal(pending.pending?.step, 'request'); assert.equal(pending.booked, false);
    for (const width of [1280, 375]) {
      await employee.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await notice(employee, /Waiting for confirmation of your update/);
      await capture(suite, employee, `uncertain-durable-intent-${width}`);
    }
    for (const width of [1280, 375]) {
      await employee.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await refresh(suite, employee);
      assert.match(await employee.locator('.orders-screen').innerText(), /Waiting for confirmation of your last update/);
      assert.equal(await employee.locator('.order-review').count(), 0);
      assert.equal(await employee.locator('ul.gcsp-slot-picker button:not(:disabled)').count(), 0, 'Pending writes never expose a fresh command');
      assert.equal(posts(suite).length, 3, 'Uncertain/pending refresh never replays the possibly committed command');
      const persistence = suite.appointments.persistence(orderUuid);
      assert.equal(persistence.appointments, 1); assert.equal(persistence.pendingIntents, 1);
      await capture(suite, employee, `authoritative-pending-locked-${width}`);
    }
    assert.deepEqual(suite.receipt.consoleErrors, []);
    suite.receipt.checks.noEffectRetry = true;
  } catch (error) {
    suite.receipt.failure = { name: error.name, message: error.message.slice(0, 1000) }; throw error;
  } finally { await suite.close(); }
});
