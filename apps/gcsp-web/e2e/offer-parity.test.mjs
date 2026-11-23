import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { startComposition } from './composition.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(150); }
  assert.fail(message);
}
const good = (response, name) => { assert.equal(response.status, 200, name); assert.equal(response.body.status, 'ok', name); return response.body.value; };
const offerPath = (id) => `/offers/${encodeURIComponent(id)}`;
const decisions = (suite) => suite.receipt.requests.filter((row) => row.method === 'POST' && row.path.endsWith('/decision'));
async function focused(locator) { return locator.evaluate((node) => node === document.activeElement); }
async function actualRead(suite, employee, id) { return good(await suite.call(employee, 'GET', offerPath(id)), 'Actual owned offer read'); }
function assertMainPoints(projection) {
  assert.equal(projection.comparison.comparisonAvailable, true, 'The actual Main quote retains a usable current-car pin');
  assert.deepEqual(projection.comparison.currentCar.facts.points, { value: 1100, unit: 'points-per-month' });
  assert.deepEqual(projection.quote.terms.points, { value: 800, unit: 'points' }, 'The actual allocated Main offer costs 800 points');
}
async function activeOfferSnapshot(suite, employee, presenter, state) {
  const projection = await actualRead(suite, employee, state.offer.offerRef.offerId);
  const clock = good(await suite.call(presenter, 'GET', '/presenter/clock'), 'Signed presenter clock around active-offer restart');
  const persistence = suite.readOfferPersistence(state.offer);
  suite.readActualHold(state.offer);
  assertMainPoints(projection);
  assert.equal(state.account.currentContract.vehicle.points, 1100, 'Actual retained Main account current car costs 1100 points');
  assert.equal(projection.offerId, state.offer.offerRef.offerId);
  assert.equal(projection.runId, suite.receipt.composition.runId);
  assert.equal(projection.state, 'pending'); assert.equal(projection.offerState, 'active'); assert.equal(projection.holdState, 'active');
  assert.equal(projection.quote.revisions.quote, 1, 'Immutable buddy_quotes rows expose quote revision 1');
  const { offer, quote, hold } = persistence;
  for (const row of [offer, quote, hold]) {
    assert.equal(row.environment_id, suite.receipt.composition.environmentId);
    assert.equal(row.run_id, suite.receipt.composition.runId);
    assert.equal(row.employee_id, suite.input.initialBrief.brief.employeeId);
    assert.equal(row.order_uuid, state.offer.orderUuid);
  }
  assert.equal(offer.offer_id, projection.offerId); assert.equal(offer.quote_id, projection.quote.quoteId);
  assert.equal(quote.quote_id, projection.quote.quoteId); assert.equal(offer.hold_id, state.offer.holdId); assert.equal(hold.hold_id, state.offer.holdId);
  assert.equal(hold.slot_id, suite.input.initialBrief.brief.entitlementSlotId); assert.equal(quote.slot_id, hold.slot_id);
  assert.equal(offer.state, 'active'); assert.equal(hold.state, 'active'); assert.equal(hold.hold_type, 'buddy-offer');
  assert.ok(Number.isSafeInteger(offer.version) && offer.version > 0); assert.ok(Number.isSafeInteger(hold.version) && hold.version > 0);
  assert.equal(offer.version, projection.offerVersion); assert.equal(hold.version, projection.holdVersion);
  assert.equal(new Date(offer.expires_at).toISOString(), projection.expiresAt);
  assert.equal(new Date(hold.expires_at).toISOString(), projection.expiresAt);
  assert.equal(new Date(quote.valid_until).toISOString(), projection.quote.validUntil);
  assert.equal(new Date(quote.quoted_at).toISOString(), projection.quote.quotedAt);
  assert.equal(quote.monthly_points, 800);
  const pin = quote.quote.currentCarComparison;
  assert.equal(pin.display.facts.points.value, 1100);
  assert.equal(pin.binding.environmentId, offer.environment_id); assert.equal(pin.binding.runId, offer.run_id);
  assert.equal(pin.binding.employeeId, offer.employee_id); assert.equal(pin.binding.slotId, hold.slot_id);
  assert.deepEqual(pin.display.facts.points, projection.comparison.currentCar.facts.points);
  assert.equal(projection.serverNow, clock.now); assert.equal(String(projection.clockVersion), String(clock.clockVersion));
  return { projection, clock, persistence };
}
async function visibleRefresh(page) {
  // This native handler signal makes real signed reads; it does not claim a physical visibility transition.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}
async function installDeadlineJournal(page) {
  await page.evaluate(() => {
    const entries = []; let previous; let overflow = false;
    const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const capture = (reason) => {
      const value = {
        countdown: text(document.querySelector('.gcsp-countdown')),
        announcement: text(document.querySelector('[data-offer-announcement]')),
        headings: [...document.querySelectorAll('h1')].map(text),
        controls: [...document.querySelectorAll('[data-offer-action="accept"], [data-offer-action="decline"]')].map((node) => ({
          action: node.getAttribute('data-offer-action'), disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true',
          visible: node.getClientRects().length > 0 && !node.closest('[hidden]'),
        })),
      };
      const semantic = JSON.stringify(value);
      if (semantic === previous) return;
      previous = semantic;
      if (entries.length === 256) { overflow = true; return; }
      entries.push({ sequence: entries.length, observedAt: new Date().toISOString(), reason, ...value });
    };
    const observer = new MutationObserver(() => capture('DOM mutation'));
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'hidden'] });
    capture('installed before public clock advances');
    window.__f555DeadlineJournal = { entries, capture, observer, overflow: () => overflow };
  });
}
async function deadlineJournal(page, stop = false) {
  return page.evaluate((stop) => {
    const journal = window.__f555DeadlineJournal;
    if (!journal) return { state: 'unavailable', entries: [] };
    journal.capture(stop ? 'final readback' : 'assertion readback');
    if (stop) journal.observer.disconnect();
    return { state: 'observed', overflow: journal.overflow(), entries: journal.entries };
  }, stop);
}
function assertDeadlineTransitions(journal, label, requireChecking = false) {
  assert.equal(journal.state, 'observed', `${label}: actual DOM journal exists`);
  assert.equal(journal.overflow, false, `${label}: the bounded transition journal is complete`);
  const threshold = journal.entries.findIndex((entry) => entry.countdown === '0h 05m'
    && entry.announcement === 'Less than five minutes remain on this offer.' && entry.controls.some((control) => control.visible && !control.disabled));
  assert.ok(threshold >= 0, `${label}: actual under-five announcement with available decisions`);
  const checking = journal.entries.findIndex((entry, index) => index > threshold
    && entry.announcement === 'The deadline has been reached. Checking the current offer state.');
  if (requireChecking || checking >= 0) {
    assert.ok(checking >= 0, `${label}: preserves the pending-at-zero transition actually observed in frozen Node`);
    assert.equal(journal.entries[checking].countdown, '0h 00m', `${label}: the observed checking state has a zero countdown`);
    assert.ok(journal.entries[checking].controls.length > 0 && journal.entries[checking].controls.every((control) => control.disabled),
      `${label}: decisions are disabled in the observed pending-at-zero state`);
  }
  assert.ok(journal.entries.some((entry, index) => index > Math.max(threshold, checking) && entry.headings.includes('Offer expired')
    && entry.announcement === 'Offer expired' && entry.controls.every((control) => control.disabled)),
    `${label}: the actual deadline result announces expiry with decisions disabled or absent`);
  return checking >= 0;
}
async function openOffer(suite, employee, offer) {
  await employee.goto(`${suite.origins.web}/gcsp/offers/${encodeURIComponent(offer.offerRef.offerId)}`, { waitUntil: 'domcontentloaded' });
  await employee.getByRole('heading', { name: 'Your offer', exact: true, level: 1 }).waitFor();
  await employee.locator('[data-offer-action="accept"]').waitFor();
}
async function surface(page) {
  return page.evaluate(() => {
    const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const card = document.querySelector('.gcsp-vehicle-focused');
    const table = document.querySelector('.gcsp-table-wrap.is-compare');
    return {
      name: text(card?.querySelector('.vm-card-name')), points: text(card?.querySelector('.gcsp-points')),
      saving: text(card?.querySelector('.gcsp-vehicle-saving')),
      deadline: text(card?.querySelector('.gcsp-decision-deadline')),
      finishes: [...(card?.querySelectorAll('.gcsp-vehicle-heading .gcsp-finish') ?? [])].map((row) => ({
        label: text(row.querySelector('.gcsp-finish-label')), value: text(row.querySelector('.gcsp-finish-value')),
        swatch: getComputedStyle(row.querySelector('.gcsp-finish-swatch')).backgroundColor,
        decorative: row.querySelector('.gcsp-finish-swatch').getAttribute('aria-hidden'),
      })),
      highlights: [...document.querySelectorAll('.gcsp-highlight-group')].map((group) => ({
        heading: text(group.querySelector('h3')), entries: [...group.querySelectorAll('.gcsp-highlight')].map((row) => ({
          heading: text(row.querySelector('.gcsp-highlight-heading')), number: text(row.querySelector('.gcsp-highlight-number')),
          detail: text(row.querySelector('.gcsp-highlight-detail')),
        })), empty: text(group.querySelector('.gcsp-highlight-empty')),
      })),
      columns: [...(table?.querySelectorAll('thead th') ?? [])].map(text),
      rows: [...(table?.querySelectorAll('tbody tr') ?? [])].map((row) => ({
        cells: [...row.children].map(text), winners: [...row.children].map((cell) => cell.classList.contains('is-winner')),
      })),
    };
  });
}
async function checkSurface(page, projection) {
  await page.waitForFunction(() => {
    const image = document.querySelector('.gcsp-vehicle-focused .vm-card-photo');
    return image?.complete && image.naturalWidth > 0;
  });
  const actual = await surface(page);
  assertMainPoints(projection);
  assert.equal(actual.name, projection.quote.facts.display.name);
  assert.equal(actual.points, '800 points a month');
  assert.equal(actual.saving, '300 fewer than your current car');
  const points = actual.rows.find((row) => /^points/i.test(row.cells[0]));
  assert.ok(points, 'The actual current-versus-offered points row renders');
  assert.deepEqual(points.cells.slice(1), ['1,100 points', '800 points']);
  assert.ok(actual.highlights.some((group) => group.heading === 'Benefits'
    && group.entries.some((entry) => entry.number === '300' && entry.heading === '300 fewer points')));
  assert.equal(actual.finishes.length, 2);
  assert.deepEqual(actual.finishes.map((finish) => finish.label), ['Paint', 'Upholstery']);
  assert.ok(actual.finishes.every((finish) => finish.value && finish.swatch && finish.decorative === 'true'));
  assert.deepEqual(actual.highlights.map((group) => group.heading), ['Benefits', 'Tradeoffs']);
  assert.ok(actual.rows.length > 0);
  for (const row of actual.rows) {
    const [label, current, offered] = row.cells;
    const numeric = (value) => { const number = Number(value.replaceAll(',', '').match(/-?\d+(?:\.\d+)?/)?.[0]); return value.match(/\d/) ? number : null; };
    const one = numeric(current); const two = numeric(offered);
    const direction = /^points/i.test(label) ? -1 : /^boot/i.test(label) ? 1 : 0;
    const winner = direction && one !== null && two !== null && one !== two ? ((two - one) * direction > 0 ? 2 : 1) : -1;
    assert.deepEqual(row.winners, row.cells.map((_cell, index) => index === winner), `Only lower points/larger boot can win: ${label}`);
    if (/^points/i.test(label) && one !== null && two !== null && two < one) {
      assert.equal(actual.saving, `${(one - two).toLocaleString('en-GB')} fewer than your current car`);
      assert.ok(actual.highlights.some((group) => group.entries.some((entry) => entry.number === (one - two).toLocaleString('en-GB'))));
    }
  }
  assert.match(actual.deadline, /Held until \d{2}:\d{2}/);
  assert.match(actual.deadline, /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
  assert.match(actual.deadline, /\d+h \d{2}m.*left to decide/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  return actual;
}
async function details(page) {
  const opener = page.locator('.gcsp-vehicle-details-entry');
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Car details', exact: true });
  await dialog.waitFor();
  assert.equal(await focused(dialog.getByRole('heading', { name: 'Car details', exact: true })), true);
  const specification = await dialog.locator('.gcsp-vehicle-specification').innerText();
  const equipment = dialog.getByRole('tab', { name: /^Selected equipment/ });
  await equipment.focus(); await page.keyboard.press('Enter');
  const equipmentText = await dialog.locator('.gcsp-vehicle-equipment').innerText();
  assert.ok(specification.trim() && equipmentText.trim());
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await focused(opener), true);
  return { specification: specification.replace(/\s+/g, ' ').trim(), equipment: equipmentText.replace(/\s+/g, ' ').trim() };
}
async function acceptanceDocuments(suite, employee) {
  const before = decisions(suite).length;
  await employee.getByRole('button', { name: 'Review & accept', exact: true }).click();
  const dialog = employee.getByRole('dialog', { name: 'Accept your offer', exact: true }); await dialog.waitFor();
  const mileage = dialog.getByLabel('Expected return mileage (miles)', { exact: true });
  await mileage.fill('not-a-mileage'); await mileage.press('Tab');
  const summary = dialog.locator('.gcsp-error-summary'); await summary.waitFor();
  assert.match(await summary.innerText(), /Confirm the expected return mileage/);
  await summary.getByRole('link').click(); assert.equal(await focused(mileage), true);
  await mileage.fill('5400'); await mileage.press('Tab');
  for (const [label, target] of [['Read scheme terms', 'Scheme terms'], ['View driver and licence record', 'Driver and licence'], ['View old contract and return mileage', 'The car you will return']]) {
    await dialog.getByRole('link', { name: label, exact: true }).click();
    const destination = target === 'Scheme terms' ? dialog.locator('details summary') : dialog.getByRole('heading', { name: target, exact: true });
    assert.equal(await focused(destination), true, `${label} focuses its actual document`);
    assert.equal(await mileage.inputValue(), '5400');
  }
  const checkboxes = dialog.getByRole('checkbox'); const count = await checkboxes.count(); assert.ok(count > 0);
  for (let index = 0; index < count; index++) {
    const checkbox = checkboxes.nth(index); await checkbox.focus(); await employee.keyboard.press('Space');
    assert.equal(await checkbox.isChecked(), true); assert.equal(await focused(checkbox), true);
  }
  const confirm = dialog.getByRole('button', { name: 'Accept offer', exact: true });
  try { await until(() => confirm.isEnabled(), 'Actual acceptance control enables after declaration rendering'); }
  finally {
    suite.receipt.acceptanceControls = { mileage: await mileage.inputValue(),
      declarations: await checkboxes.evaluateAll((nodes) => nodes.map((node) => ({ id: node.id, checked: node.checked, disabled: node.disabled }))),
      confirmEnabled: await confirm.isEnabled(), focusedControl: await dialog.evaluate(() => document.activeElement?.id ?? null) };
  }
  assert.equal(await confirm.isEnabled(), true);
  assert.equal(decisions(suite).length, before, 'Review, documents and declarations never submit a decision');
  await suite.screenshot(employee, 'documents-1280');
  await employee.setViewportSize({ width: 390, height: 844 }); await suite.screenshot(employee, 'documents-390');
  assert.equal(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  return dialog;
}
async function accept(suite, employee, offer) {
  const dialog = await acceptanceDocuments(suite, employee);
  const response = employee.waitForResponse((value) => value.request().method() === 'POST' && new URL(value.url()).pathname.endsWith(`${offerPath(offer.offerRef.offerId)}/decision`));
  await dialog.getByRole('button', { name: 'Accept offer', exact: true }).click();
  const actual = await response; const body = await actual.json();
  const sent = actual.request().postDataJSON();
  suite.receipt.accept = { status: actual.status(), decision: sent.decision, commandId: sent.commandId, runId: sent.runId,
    offerId: offer.offerRef.offerId, declarations: sent.declarations, expectedReturnMileage: sent.expectedReturnMileage,
    expectedOfferVersion: sent.expectedOfferVersion, expectedHoldVersion: sent.expectedHoldVersion, expectedQuoteVersion: sent.expectedQuoteVersion,
    result: body };
  assert.equal(actual.status(), 200); assert.equal(sent.decision, 'accept'); assert.equal(sent.runId, suite.receipt.composition.runId);
  assert.equal(decisions(suite).length, 1, 'Exactly one explicit browser decision');
  return body;
}
async function advance(suite, presenter, to) {
  const before = good(await suite.call(presenter, 'GET', '/presenter/clock'), 'Clock before advance');
  assert.ok(Date.parse(to) > Date.parse(before.now));
  const after = good(await suite.call(presenter, 'POST', '/presenter/clock/advance', {
    commandId: randomUUID(), expectedClockVersion: before.clockVersion, to,
  }), 'Public clock advance');
  assert.equal(after.now, to); return after;
}
async function flow(t, name, ordering, check) {
  await t.test(name, async () => {
    const suite = await startComposition({ caseId: name, ordering });
    try {
      const employee = await suite.newPage('employee', 'demo-paula', 'account');
      const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
      const state = await suite.releaseMainOffer(employee, presenter);
      await openOffer(suite, employee, state.offer);
      await check(suite, employee, presenter, state);
      assert.deepEqual(suite.receipt.consoleErrors, [], 'No app runtime errors in the checked flow');
      suite.receipt.checks[name] = true;
    } catch (error) {
      suite.receipt.failure = { name: error.name, message: error.message.slice(0, 1000) }; throw error;
    } finally { await suite.close(); }
  });
}

test('FUCQ-555: real offer decision support and exits against frozen Main inputs', { timeout: 540000 }, async (t) => {
  await flow(t, 'f555-pending', 'synthetic', async (suite, employee, presenter, state) => {
    const before = await activeOfferSnapshot(suite, employee, presenter, state);
    suite.receipt.activeOfferRestart = { before };
    const lifecycle = await suite.restartApi();
    const after = await activeOfferSnapshot(suite, employee, presenter, state);
    suite.receipt.activeOfferRestart.after = after;
    assert.equal(lifecycle.oldAfterStop, null);
    assert.notDeepEqual([lifecycle.after.pid, lifecycle.after.start], [lifecycle.before.pid, lifecycle.before.start]);
    assert.deepEqual(lifecycle.binding, { database: before.persistence.database, schema: before.persistence.schema,
      environmentId: suite.receipt.composition.environmentId, runId: suite.receipt.composition.runId,
      policyVersion: before.projection.quote.policyVersion });
    assert.deepEqual(after.persistence, before.persistence, 'Literal JVM restart preserves every actual quote, offer and hold column, including identities, pin, state, versions and expiries');
    assert.deepEqual(after.projection.quote, before.projection.quote, 'The signed owner rereads the same immutable quote after restart');
    assert.deepEqual(after.projection.comparison, before.projection.comparison, 'The owner current-car pin is unchanged after restart');
    for (const key of ['offerId', 'runId', 'state', 'reason', 'expiresAt', 'offerVersion', 'holdVersion', 'offerState', 'holdState', 'availableActions']) {
      assert.deepEqual(after.projection[key], before.projection[key], `Restart preserves the actual owner offer ${key}`);
    }
    const { lastTick: presenterTick, ...beforeClock } = before.clock;
    const { lastTick: startupTick, ...afterClock } = after.clock;
    assert.deepEqual(afterClock, beforeClock, 'Every semantic clock property survives the active-offer JVM restart');
    assert.equal(presenterTick.kind, 'presenter');
    assert.match(startupTick.tickId, /^startup-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(startupTick.tickId, presenterTick.tickId);
    assert.equal(startupTick.kind, 'startup'); assert.equal(startupTick.state, 'completed');
    for (const key of ['runId', 'now', 'clockVersion']) {
      assert.equal(startupTick[key], before.clock[key], `Startup tick preserves the authoritative before ${key}`);
      assert.equal(startupTick[key], after.clock[key], `Startup tick uses the authoritative after ${key}`);
    }
    assert.equal(startupTick.policyVersion, presenterTick.policyVersion);
    assert.equal(startupTick.policyVersion, before.projection.quote.policyVersion);
    assert.equal(startupTick.policyVersion, after.projection.quote.policyVersion);
    assert.deepEqual(startupTick.missingStages, []);
    // clock.commands.v1 startupStages: restart reconciles existing work without releasing or allocating stock.
    const startupStages = ['manual-expiry', 'buddy-expiry', 'pending-reconciliation'];
    const expectedHandlers = presenterTick.handlerOrder.filter(({ stage }) => startupStages.includes(stage));
    assert.deepEqual([...new Set(expectedHandlers.map(({ stage }) => stage))], startupStages, 'Every configured startup stage has a retained presenter handler');
    assert.deepEqual(startupTick.handlerOrder, expectedHandlers, 'Startup runs exactly the configured subset in the original handler order');
    assert.deepEqual(startupTick.outcomes.map(({ handlerId, stage }) => ({ handlerId, stage })), expectedHandlers,
      'Startup outcomes cover every expected handler once and in order');
    for (const { handlerId, outcome } of startupTick.outcomes) assert.equal(outcome.status, 'ok', `Startup handler ${handlerId} succeeds`);
    await openOffer(suite, employee, state.offer);
    const java = {};
    for (const width of [1280, 390]) {
      await employee.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      java[width] = await checkSurface(employee, state.projection);
      await suite.screenshot(employee, `angular-pending-${width}`);
    }
    java.details = await details(employee);
    await employee.getByRole('link', { name: /Back to Your cars$/, exact: false }).click();
    await employee.waitForURL((url) => url.pathname === '/gcsp/account');
    assert.equal(decisions(suite).length, 0, 'The account exit does not submit a decision');
    assert.equal((await actualRead(suite, employee, state.offer.offerRef.offerId)).state, 'pending');
    await openOffer(suite, employee, state.offer);
    const replay = await suite.visitFrozenNode({ ...suite.receipt.offer, hold: state.hold, clock: state.clock, finalAccount: state.account }, async (source) => {
      await source.page.goto(`${source.origin}/gcsp-offer.html?offerId=${encodeURIComponent(source.offer.offerRef.offerId)}&runId=${encodeURIComponent(source.control.runId)}`, { waitUntil: 'domcontentloaded' });
      await source.page.locator('.gcsp-vehicle-focused').waitFor();
      const pair = {};
      source.receipt.pendingSurfaces = {};
      for (const width of [1280, 390]) {
        await source.page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
        source.receipt.pendingSurfaces[width] = await surface(source.page);
        const actual = await checkSurface(source.page, state.projection);
        const destination = path.join(process.env.GCSP_E2E_OUTPUT, 'f555-pending', `node-pending-${width}.png`);
        await source.page.screenshot({ path: destination, fullPage: false }); pair[width] = { node: destination, angular: `angular-pending-${width}.png` };
        source.receipt.pendingScreenshotPairs = pair;
        assert.deepEqual(actual, java[width], `Actual same-car pending surface at ${width}`);
      }
      assert.deepEqual(await details(source.page), java.details, 'Actual source specification and equipment match');
      suite.receipt.deadlineDom = {}; source.receipt.deadlineDom = {};
      try {
        await installDeadlineJournal(employee);
        await installDeadlineJournal(source.page);
        const threshold = new Date(Date.parse(state.offer.expiresAt) - 300000).toISOString();
        for (const [to, countdown, message] of [[threshold, '0h 05m', 'Less than five minutes remain on this offer.'], [state.offer.expiresAt, null, 'Offer expired']]) {
          const javaClock = await advance(suite, presenter, to);
          const current = good({ status: 200, body: await source.runtime.clock.now(source.control) }, 'Node clock before advance');
          const nodeClock = good({ status: 200, body: await source.runtime.clock.advance(source.control, { commandId: randomUUID(), expectedClockVersion: current.clockVersion, to }) }, 'Node public clock advance');
          suite.receipt.checks.clockTransitions ??= []; suite.receipt.checks.clockTransitions.push({ java: javaClock, node: nodeClock });
          assert.equal(nodeClock.now, javaClock.now); assert.equal(String(nodeClock.clockVersion), String(javaClock.clockVersion));
          await visibleRefresh(employee);
          if (countdown) {
            await until(async () => (await employee.locator('.gcsp-countdown').innerText()) === countdown, 'Java threshold countdown');
            await until(async () => (await source.page.locator('.gcsp-countdown').innerText()) === countdown, 'Frozen source threshold countdown');
          } else {
            await employee.getByRole('heading', { name: 'Offer expired', exact: true }).waitFor();
            await source.page.getByRole('heading', { name: 'Offer expired', exact: true }).waitFor();
            assert.equal(await employee.locator('[data-offer-action="accept"]:enabled, [data-offer-action="decline"]:enabled').count(), 0);
          }
          await until(async () => (await employee.locator('[data-offer-announcement]').innerText()) === message, 'Java deadline announcement');
          await until(async () => (await source.page.locator('[data-offer-announcement]').innerText()) === message, 'Frozen deadline announcement');
        }
        const angularJournal = await deadlineJournal(employee); const nodeJournal = await deadlineJournal(source.page);
        suite.receipt.deadlineDom = { angular: angularJournal, node: nodeJournal }; source.receipt.deadlineDom = nodeJournal;
        const frozenChecking = nodeJournal.entries.some((entry) => entry.announcement === 'The deadline has been reached. Checking the current offer state.');
        const deadlineContract = { frozenPendingAtZeroObserved: frozenChecking,
          path: frozenChecking ? 'Require the observed frozen pending-at-zero transition in Angular as well.'
            : 'Ordinary active offer projects directly expired; conditional pending-at-zero proof reused from existing component/store regressions.',
          sourceCitations: ['Frozen server/gcsp/offers/access.js:116-117', 'Java services/gcsp-api/src/main/java/gcsp/api/offers/OfferView.java:61-63',
            'Frozen blocks/gcsp/offer/offer-view.js:364-366'],
          conditionalRegressionReferences: ['apps/gcsp-web/src/app/offers/offer-screen.component.spec.ts:118',
            'apps/gcsp-web/src/app/offers/offer-interaction.store.spec.ts:53'],
          evidenceScope: 'Actual connected ordinary expiry journals; existing regressions cover conditional pending-at-zero behavior. No derived state injection.' };
        suite.receipt.deadlineContract = deadlineContract; source.receipt.deadlineContract = deadlineContract;
        assertDeadlineTransitions(nodeJournal, 'Frozen Node'); assertDeadlineTransitions(angularJournal, 'Angular', frozenChecking);
      } finally {
        const journals = await Promise.allSettled([deadlineJournal(employee, true), deadlineJournal(source.page, true)]);
        const retained = (result) => result.status === 'fulfilled' ? result.value : { state: 'readback-failed', message: result.reason.message.slice(0, 300) };
        suite.receipt.deadlineDom = { angular: retained(journals[0]), node: retained(journals[1]) };
        source.receipt.deadlineDom = retained(journals[1]);
      }
      return { screenshots: pair, engineeringComparison: 'actual live source/Java same held car and clock; human review pending' };
    });
    assert.equal(replay.state, 'matched', 'F555 requires the frozen live Node reference');
    const tickClock = good(await suite.call(presenter, 'GET', '/presenter/clock'), 'Clock at expiry');
    good(await suite.call(presenter, 'POST', '/presenter/clock/tick', { tickId: `f555-expiry-${randomUUID()}`, expectedClockVersion: tickClock.clockVersion }), 'Actual expiry handlers');
    const expired = await actualRead(suite, employee, state.offer.offerRef.offerId);
    assert.equal(expired.state, 'expired');
    await employee.getByRole('link', { name: 'See buddy activity', exact: true }).click();
    await employee.waitForURL((url) => url.pathname === '/gcsp/activity');
    await suite.screenshot(employee, 'expired-activity-390');
    suite.receipt.parity = { humanAcceptance: 'pending', pairs: replay.screenshots,
      emptyHighlightState: 'Retained source/component proof; no derived Main quote was changed to manufacture an empty group' };
    writeFileSync(path.join(process.env.GCSP_E2E_OUTPUT, 'f555-pending', 'offer-surface-comparison.json'), JSON.stringify(java, null, 2));
  });

  await flow(t, 'f555-accept', 'synthetic', async (suite, employee, _presenter, state) => {
    await accept(suite, employee, state.offer);
    await employee.getByRole('heading', { name: 'Offer accepted', exact: true }).waitFor();
    const actual = await actualRead(suite, employee, state.offer.offerRef.offerId);
    suite.receipt.acceptedReadback = actual;
    assert.equal(actual.state, 'accepted'); assert.equal(actual.selection.selectionState, 'acknowledged');
    assert.equal(actual.quote.orderUuid, state.offer.orderUuid);
    await suite.screenshot(employee, 'accepted-390');
    await employee.getByRole('link', { name: 'Track your order', exact: true }).click();
    await employee.waitForURL((url) => url.pathname === '/gcsp/orders');
    const order = good(await suite.call(employee, 'GET', '/manual/order'), 'Actual selected order');
    assert.equal(order.selection.orderUuid, state.offer.orderUuid);
    await suite.screenshot(employee, 'track-order-390');
  });

  await flow(t, 'f555-decline', 'synthetic', async (suite, employee, presenter, state) => {
    await employee.getByRole('button', { name: 'Decline offer', exact: true }).click();
    const dialog = employee.getByRole('dialog', { name: 'Decline your offer', exact: true });
    const group = dialog.getByRole('radiogroup', { name: 'Reason for declining', exact: true }); await group.waitFor();
    await dialog.getByRole('button', { name: 'Confirm decline', exact: true }).click();
    const summary = dialog.locator('.gcsp-error-summary'); await summary.waitFor();
    assert.equal(decisions(suite).length, 0);
    assert.equal(await focused(summary.getByRole('heading', { name: 'Check before continuing', exact: true })), true);
    await summary.getByRole('link').click();
    assert.equal(await focused(group.locator('[role="radio"][tabindex="0"]')), true);
    const reasons = good(await suite.call(employee, 'GET', `${offerPath(state.offer.offerRef.offerId)}/decision-reasons`), 'Actual decline registry');
    const body = reasons.reasons.find((reason) => reason.attribute === 'body'); assert.ok(body, 'A registered body reason supports the unchanged Main follow-up');
    const radio = group.getByRole('radio', { name: body.label, exact: true });
    try {
      await radio.focus(); await employee.keyboard.press('Space');
      await until(async () => await radio.getAttribute('aria-checked') === 'true', 'Actual keyboard-selected decline reason renders');
    } finally {
      suite.receipt.declineControls = { selected: await radio.evaluate((node) => ({ value: node.value, checked: node.getAttribute('aria-checked'),
        disabled: node.disabled, tabIndex: node.tabIndex, focused: node === document.activeElement })),
        group: await group.evaluate((node) => ({ disabled: node.getAttribute('aria-disabled'), invalid: node.getAttribute('aria-invalid'),
          radios: [...node.querySelectorAll('[role="radio"]')].map((item) => ({ value: item.value, checked: item.getAttribute('aria-checked'), disabled: item.disabled })) })),
        errorSummaryVisible: await summary.isVisible(), decisionPosts: decisions(suite).length };
    }
    assert.equal(await radio.getAttribute('aria-checked'), 'true');
    assert.equal(await focused(radio), true, 'Native Space selection keeps focus on the chosen reason');
    assert.equal(decisions(suite).length, 0, 'Reason selection never submits a decision');
    await suite.screenshot(employee, 'decline-radio-1280');
    await dialog.getByRole('button', { name: 'Confirm decline', exact: true }).click();
    await employee.getByRole('heading', { name: 'Offer declined', exact: true }).waitFor();
    const offer = await actualRead(suite, employee, state.offer.offerRef.offerId); assert.equal(offer.state, 'declined');
    assert.ok(offer.followup?.decisionId);
    const followupPath = `/offer-followup?decisionId=${encodeURIComponent(offer.followup.decisionId)}`;
    const question = good(await suite.call(employee, 'GET', followupPath), 'Actual follow-up question');
    suite.receipt.followupQuestion = question;
    assert.equal(question.state, 'question'); assert.equal(question.question.control.kind, 'options');
    const currentAnswers = Array.isArray(question.question.currentValue) ? question.question.currentValue : [question.question.currentValue];
    const option = question.question.control.options.find((item) => currentAnswers.length !== 1 || item.value !== currentAnswers[0]); assert.ok(option);
    const followup = employee.locator('.followup');
    const before = suite.receipt.requests.filter((row) => row.method === 'POST' && row.path === '/offer-followup/confirm').length;
    const answer = followup.getByRole('radio', { name: option.label, exact: true });
    const confirm = followup.getByRole('button', { name: 'Confirm this change', exact: true });
    try {
      await answer.check();
      await until(async () => await answer.isChecked() && await confirm.isEnabled(), 'Actual follow-up answer and explicit confirmation render ready');
    } finally {
      suite.receipt.followupControls = { selected: await answer.evaluate((node) => ({ value: node.value, checked: node.checked,
        disabled: node.disabled, focused: node === document.activeElement })), confirmEnabled: await confirm.isEnabled(),
        confirmPosts: suite.receipt.requests.filter((row) => row.method === 'POST' && row.path === '/offer-followup/confirm').length };
    }
    assert.equal(await answer.isChecked(), true); assert.equal(await confirm.isEnabled(), true);
    assert.equal(suite.receipt.followupControls.confirmPosts, before, 'Choosing a follow-up answer never saves it');
    const confirmResponse = employee.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/offer-followup/confirm'));
    await confirm.click();
    const confirmed = await confirmResponse;
    const confirmedBody = await confirmed.json();
    suite.receipt.followupConfirm = { status: confirmed.status(), request: confirmed.request().postDataJSON(), response: confirmedBody };
    const saved = good({ status: confirmed.status(), body: confirmedBody }, 'Actual explicit follow-up confirmation');
    assert.equal(saved.state, 'change-saved'); assert.equal(saved.briefVersion, question.briefVersion + 1);
    assert.equal(suite.receipt.followupConfirm.request.value, option.value);
    assert.equal(suite.receipt.followupConfirm.request.expectedBriefVersion, question.briefVersion);
    await until(async () => {
      const response = await suite.call(employee, 'GET', followupPath);
      suite.receipt.savedFollowupReadback = response;
      if (response.status !== 200) return false;
      suite.receipt.savedFollowup = response.body;
      return ['change-saved', 'waiting', 'ready'].includes(response.body.value.state);
    }, 'Actual saved follow-up readback');
    assert.equal(suite.receipt.requests.filter((row) => row.method === 'POST' && row.path === '/offer-followup/confirm').length, before + 1);
    const brief = good(await suite.call(employee, 'GET', '/brief'), 'Actual brief after saved follow-up');
    suite.receipt.savedBrief = brief;
    suite.receipt.savedFollowupClockContext = { releaseClock: state.clock,
      currentClockReadback: await suite.call(presenter, 'GET', '/presenter/clock'),
      actualSavedFollowup: suite.receipt.savedFollowup, actualSavedBrief: brief,
      comparison: 'Actual values retained side by side; no timestamp normalization or added timestamp parity assertion.' };
    assert.equal(brief.brief.briefVersion, question.briefVersion + 1, 'Exactly one new brief version was saved');
    assert.equal(brief.brief.preferences.body.value, option.value);
    await employee.setViewportSize({ width: 390, height: 844 }); await suite.screenshot(employee, 'saved-followup-390');
    const activityResponse = employee.waitForResponse((response) => response.request().method() === 'GET'
      && response.url() === `${suite.apiBase}/activity`);
    await followup.getByRole('link', { name: 'See buddy activity', exact: true }).click();
    await employee.waitForURL((url) => url.pathname === '/gcsp/activity');
    const activityRead = await activityResponse;
    suite.receipt.savedFollowupActivity = { method: activityRead.request().method(), url: activityRead.url(), status: activityRead.status() };
    const activityBody = await activityRead.json(); suite.receipt.savedFollowupActivity.body = activityBody;
    const activity = good({ status: activityRead.status(), body: activityBody }, 'Actual saved-follow-up navigation activity read');
    assert.equal(activity.runId, suite.receipt.composition.runId);
    assert.equal(activity.employeeId, suite.input.initialBrief.brief.employeeId);
    assert.equal(activity.briefVersion, brief.brief.briefVersion, 'Activity uses the newly saved brief version');
    assert.equal(activity.currentOffer?.offerRef?.offerId, state.offer.offerRef.offerId);
    assert.equal(activity.currentOffer.state, 'declined'); assert.equal(activity.currentOffer.orderUuid, state.offer.orderUuid);
    const terminalOffers = activity.offers.filter((row) => row.offerRef.offerId === state.offer.offerRef.offerId);
    assert.equal(terminalOffers.length, 1); assert.equal(terminalOffers[0].state, 'declined');
    const activitySummary = employee.locator('.activity-summary[aria-label="Buddy status"]');
    const activityTimeline = employee.locator('.activity-timeline');
    await activitySummary.waitFor({ state: 'visible' });
    await activityTimeline.getByRole('heading', { name: 'Activity', exact: true }).waitFor();
    await activityTimeline.locator('.activity-timeline-list li').first().waitFor();
    const activityOfferState = employee.locator('.activity-offer-state');
    await activityOfferState.waitFor({ state: 'visible' });
    assert.equal(await activityOfferState.innerText(), 'Declined');
    const buddyStatus = await activitySummary.locator('.activity-badge').innerText();
    const timelineRows = await activityTimeline.locator('.activity-timeline-list li').evaluateAll((rows) => rows.map((row) => ({
      label: row.querySelector('p')?.textContent, occurredAt: row.querySelector('time')?.getAttribute('datetime'),
    })));
    suite.receipt.savedFollowupActivity.rendered = { buddyStatus, timelineRows, summary: await activitySummary.innerText(), timeline: await activityTimeline.innerText() };
    assert.match(buddyStatus.trim(), /^Buddy (?:engaged|disengaged)$/);
    assert.ok(timelineRows.length > 0 && timelineRows.every((row) => row.label?.trim()), 'Ready Activity contains actual history entries');
    assert.notEqual(await employee.locator('.activity-page').getAttribute('aria-busy'), 'true');
    await suite.screenshot(employee, 'saved-followup-activity-390');
  });

  for (const ordering of ['rejected', 'unknown-then-rejected']) {
    await flow(t, ordering === 'rejected' ? 'f555-rejected' : 'f555-uncertain', ordering, async (suite, employee, presenter, state) => {
      await accept(suite, employee, state.offer);
      if (ordering === 'unknown-then-rejected') {
        await until(async () => {
          const actual = await actualRead(suite, employee, state.offer.offerRef.offerId); suite.receipt.pendingReadback = actual;
          return actual.selection?.selectionState === 'handoff-pending';
        }, 'Real unknown ordering outcome remains pending');
        await suite.screenshot(employee, 'uncertain-390'); suite.ordering.rejectPending();
        await until(async () => {
          good(await suite.call(presenter, 'POST', '/presenter/ordering/reconcile', { limit: 1 }), 'Public ordering reconciliation');
          const actual = await actualRead(suite, employee, state.offer.offerRef.offerId); suite.receipt.reconciledReadback = actual;
          return actual.selection?.selectionState === 'handoff-failed';
        }, 'The same real operation reconciles to rejected', 45000);
        await visibleRefresh(employee);
      }
      await employee.getByRole('heading', { name: 'Your selection was not sent to ordering', exact: true }).waitFor();
      const actual = await actualRead(suite, employee, state.offer.offerRef.offerId); suite.receipt.refusedReadback = actual;
      assert.equal(actual.selection.selectionState, 'handoff-failed'); assert.equal(actual.quote.orderUuid, state.offer.orderUuid);
      const stages = await employee.locator('.gcsp-stage-item').evaluateAll((rows) => rows.map((row) => ({ name: row.querySelector('.gcsp-stage-name').textContent, state: row.className.replace('gcsp-stage-item is-', '') })));
      assert.deepEqual(stages, actual.selection.stages);
      for (const identity of [actual.selection.orderReference, actual.selection.orderNumber].filter(Boolean)) assert.ok((await employee.locator('main').innerText()).includes(identity));
      assert.match(await employee.locator('main').innerText(), /Nothing has been ordered/);
      const requests = suite.ordering.requests; const executions = requests.filter((row) => row.method === 'POST');
      assert.equal(executions.length, 1); assert.equal(requests[0].reply.status, 'not-found');
      assert.ok(requests.every((row) => row.operationId === executions[0].operationId && row.runId === executions[0].runId && row.orderUuid === state.offer.orderUuid && row.authenticated));
      assert.equal(executions[0].idempotencyKey, executions[0].operationId);
      await employee.setViewportSize({ width: 1280, height: 800 }); await suite.screenshot(employee, 'refused-stages-1280');
      await employee.setViewportSize({ width: 390, height: 844 }); await suite.screenshot(employee, 'refused-stages-390');
      await employee.getByRole('link', { name: 'Contact scheme support', exact: true }).click();
      await employee.waitForURL((url) => url.pathname === '/gcsp/help'); await suite.screenshot(employee, 'refused-support-390');
    });
  }
});
