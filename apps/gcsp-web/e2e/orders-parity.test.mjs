import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, startComposition } from './composition.mjs';

const policy = JSON.parse(readFileSync(path.join(ROOT, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
const assumption = (key) => {
  const row = policy.assumptions.find((entry) => entry.key === key); assert.ok(row, key); return row.value;
};
const confirmationSeconds = assumption('lifecycle.appointments.confirmation.v1').confirmDelaySeconds;
const noShowSeconds = assumption('lifecycle.appointments.outcomeTiming.v1').noShowAfterSlotStartSeconds;
const returnOutcomeSeconds = assumption('lifecycle.return.outcome.v1').delaySecondsAfterSlotEnd;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await delay(150); }
  assert.fail(message);
}
const good = (response, label) => {
  assert.equal(response.status, 200, label); assert.equal(response.body.status, 'ok', label); return response.body.value;
};
const nodeGood = (response, label) => { assert.equal(response.status, 'ok', label); return response.value; };
const query = (orderUuid) => `?orderUuid=${encodeURIComponent(orderUuid)}`;
const posts = (suite, suffix) => suite.receipt.requests.filter((row) => row.method === 'POST' && row.path.endsWith(suffix));
const normalize = (value) => value.replace(/\s+/g, ' ').trim();

async function read(suite, actor, route, label = route) {
  const response = await suite.call(actor, 'GET', route);
  suite.receipt.orders.reads.push({ label, response });
  return good(response, label);
}
async function command(suite, actor, route, body) {
  const response = await suite.call(actor, 'POST', route, body);
  suite.receipt.orders.commands.push({ route, body, response });
  return good(response, route);
}
async function snapshot(suite, employee, orderUuid, label) {
  const out = {};
  for (const [key, route] of Object.entries({ stages: '/orders/progress', appointment: '/appointments', returnPlan: '/return-plan' })) {
    out[key] = await read(suite, employee, route + query(orderUuid), `${label}: ${key}`);
    assert.equal(out[key].orderUuid, orderUuid, `${label}: actual ${key} order identity`);
    assert.equal(out[key].runId, suite.receipt.composition.runId, `${label}: actual ${key} run identity`);
    assert.equal(out[key].employeeId, suite.input.initialBrief.brief.employeeId, `${label}: owned ${key}`);
  }
  out.documents = await read(suite, employee, '/documents', `${label}: documents`);
  suite.receipt.orders.states[label] = out;
  return out;
}
async function openOrders(suite, page) {
  await page.goto(`${suite.origins.web}/gcsp/orders`, { waitUntil: 'domcontentloaded' });
  await page.locator('.gcsp-stage-list').waitFor();
  await until(async () => await page.locator('.order-sections[aria-busy="true"]').count() === 0, 'Orders reads settle');
}
async function refreshOrders(suite, page) {
  const refresh = page.getByRole('button', { name: 'Refresh status', exact: true });
  await until(() => refresh.isEnabled(), 'Refresh is available after command readback');
  const response = page.waitForResponse((value) => value.request().method() === 'GET'
    && new URL(value.url()).pathname.endsWith('/orders/progress/all'));
  await refresh.click();
  const actual = await response;
  const envelope = { status: actual.status(), body: await actual.json() };
  suite.receipt.orders.reads.push({ label: 'Explicit post-command Refresh status', response: envelope });
  good(envelope, 'Explicit Orders refresh reads the current owned orders');
  await page.locator('.gcsp-stage-list').waitFor();
  await until(async () => await page.locator('.order-sections[aria-busy="true"]').count() === 0,
    'Explicit refresh settles with a fresh projection and clears the previous action result');
}
async function screenshots(suite, page, label, widths = [1280, 390]) {
  const captures = {};
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
    captures[width] = await suite.screenshot(page, `${label}-${width}`, { fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${label}: no horizontal overflow at ${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  return captures;
}
async function tracker(page, stages) {
  const root = page.locator('.gcsp-stage-tracker');
  assert.equal(await root.count(), 1);
  const actual = await root.locator('.gcsp-stage-list > .gcsp-stage').evaluateAll((rows) => rows.map((row) => ({
    label: row.querySelector('.gcsp-stage-label')?.textContent?.trim(), state: row.className,
    owner: row.querySelector('.gcsp-stage-owner')?.textContent?.trim() ?? '',
    next: row.querySelector('.gcsp-stage-next')?.textContent?.trim() ?? '',
    note: row.querySelector('.gcsp-stage-note')?.textContent?.trim() ?? '',
  })));
  assert.ok(actual.length >= stages.stages.length, 'Canonical tracker retains all actual approval stages');
  const next = actual.filter((row) => row.next);
  assert.equal(next.length, 1, 'Only the current owner supplies the Next line');
  assert.ok(next[0].owner, 'The current step has an owner');
  assert.ok(next[0].next.startsWith('Next: '));
  if (stages.blocked && stages.stages.some((row) => row.stage === stages.currentStage && row.state === 'pending')) {
    assert.ok(actual.some((row) => row.note === stages.blocked.reason && row.state.includes('is-blocked')));
  }
  return actual;
}
async function acceptOffer(suite, employee, state) {
  await employee.goto(`${suite.origins.web}/gcsp/offers/${encodeURIComponent(state.offer.offerRef.offerId)}`, { waitUntil: 'domcontentloaded' });
  return acceptOnPage(employee, async (response, sent, body) => {
    suite.receipt.orders.acceptance = { status: response.status(), sent, body };
    assert.equal(response.status(), 200); assert.equal(body.status, 'ok');
    assert.equal(sent.runId, suite.receipt.composition.runId);
    assert.equal(sent.decision, 'accept');
    assert.equal(sent.expectedOfferVersion, state.projection.offerVersion);
    assert.equal(sent.expectedHoldVersion, state.projection.holdVersion);
    assert.equal(sent.expectedQuoteVersion, state.projection.quote.revisions.quote);
  });
}
async function acceptOnPage(page, observed) {
  await page.getByRole('button', { name: 'Review & accept', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Accept your offer', exact: true });
  await dialog.waitFor();
  const mileage = dialog.getByLabel('Expected return mileage (miles)', { exact: true });
  await mileage.fill('5400'); await mileage.press('Tab');
  const checkboxes = dialog.getByRole('checkbox');
  assert.ok(await checkboxes.count() > 0, 'The actual offer supplies declarations');
  for (let index = 0; index < await checkboxes.count(); index++) {
    await checkboxes.nth(index).focus(); await page.keyboard.press('Space');
    assert.equal(await checkboxes.nth(index).isChecked(), true);
  }
  const confirm = dialog.getByRole('button', { name: 'Accept offer', exact: true });
  await until(() => confirm.isEnabled(), 'Explicit offer confirmation enables');
  const response = page.waitForResponse((value) => value.request().method() === 'POST' && new URL(value.url()).pathname.endsWith('/decision'));
  await confirm.click();
  const actual = await response; const body = await actual.json();
  await observed(actual, actual.request().postDataJSON(), body);
}
async function tick(suite, presenter, to) {
  const before = await read(suite, presenter, '/presenter/clock');
  if (to) {
    assert.ok(Date.parse(to) > Date.parse(before.now));
    await command(suite, presenter, '/presenter/clock/advance', { commandId: randomUUID(), expectedClockVersion: before.clockVersion, to });
  }
  const clock = await read(suite, presenter, '/presenter/clock');
  await command(suite, presenter, '/presenter/clock/tick', { tickId: randomUUID(), expectedClockVersion: clock.clockVersion });
  return read(suite, presenter, '/presenter/clock');
}
async function reviewedAction(suite, page, locator, title, suffix, expected) {
  const before = posts(suite, suffix).length;
  await locator.focus();
  assert.equal(await locator.evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  const review = page.locator('.order-review'); await review.waitFor();
  assert.equal(normalize(await review.locator('h2').innerText()), title);
  assert.equal(posts(suite, suffix).length, before, 'Keyboard selection prepares a review without writing');
  const response = page.waitForResponse((value) => value.request().method() === 'POST' && new URL(value.url()).pathname.endsWith(suffix));
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  const actual = await response; const sent = actual.request().postDataJSON(); const body = await actual.json();
  suite.receipt.orders.uiCommands.push({ suffix, status: actual.status(), sent, body });
  assert.equal(actual.status(), 200); assert.equal(body.status, 'ok');
  for (const [key, value] of Object.entries(expected)) assert.equal(sent[key], value, `Reviewed command preserves ${key}`);
  assert.ok(sent.commandId); assert.equal(posts(suite, suffix).length, before + 1, 'One explicit confirmation sends one command');
  await until(async () => await page.locator('.order-sections[aria-busy="true"]').count() === 0, 'Command readback settles');
  await refreshOrders(suite, page);
  return body.value;
}
async function documentTasks(suite, employee, orderUuid, state) {
  const doc = state.documents.orders.find((row) => row.orderUuid === orderUuid);
  assert.ok(doc?.tasks.length, 'Real lifecycle opens employee tasks');
  const checklist = employee.locator('section.gcsp-task-list'); await checklist.waitFor();
  const groups = [{ heading: 'Your tasks', items: doc.tasks },
    { heading: 'Being handled by others', items: doc.items.filter((item) => item.owner !== 'employee') }].filter((group) => group.items.length);
  assert.deepEqual(await checklist.locator('.gcsp-task-group-heading').allTextContents(), groups.map((group) => group.heading));
  for (const group of groups) {
    const rendered = checklist.locator('.gcsp-task-group').filter({ has: employee.getByRole('heading', { name: group.heading, exact: true }) });
    assert.equal(await rendered.locator('.gcsp-task').count(), group.items.length, 'Only the actual source group rows are required');
    for (const item of group.items) {
      const row = rendered.locator('.gcsp-task').filter({ has: employee.locator('.gcsp-task-label', { hasText: item.label }) });
      assert.equal(await row.count(), 1, `Real grouped item ${item.itemId} appears once`);
      const statuses = { 'not-started': 'Not started', 'waiting-for-employee': 'Waiting for you', 'in-progress': 'In progress', complete: 'Complete', failed: 'Failed' };
      const tone = item.status === 'complete' ? 'done' : item.status === 'failed' ? 'failed' : item.overdue === true ? 'overdue' : item.status === 'in-progress' ? 'in-progress' : 'todo';
      assert.ok((await row.getAttribute('class')).split(' ').includes(`is-${tone}`), `Actual ${item.itemId} tone`);
      if (statuses[item.status]) assert.ok((await row.innerText()).includes(statuses[item.status]), `Actual ${item.itemId} status`);
      if (item.status !== 'complete' && item.dueAt) assert.match(await row.innerText(), /Due /);
    }
  }
  assert.match(await checklist.innerText(), /Acknowledgement, not a signature/);
  suite.receipt.orders.taskSurface = await checklist.innerText();
  for (const task of doc.tasks.filter((row) => row.actionable && row.status === 'waiting-for-employee')) {
    const current = await read(suite, employee, '/documents', 'Before task acknowledgement');
    const currentDoc = current.orders.find((row) => row.orderUuid === orderUuid);
    const mine = checklist.locator('.gcsp-task-group').filter({ has: employee.getByRole('heading', { name: 'Your tasks', exact: true }) });
    const row = mine.locator('.gcsp-task').filter({ has: employee.locator('.gcsp-task-label', { hasText: task.label }) });
    await reviewedAction(suite, employee, row.getByRole('button', { name: task.action, exact: true }), 'Acknowledge this task?', '/documents/tasks/acknowledge',
      { orderUuid, itemId: task.itemId, expectedDocumentsRevision: currentDoc.documentsRevision });
    const after = await read(suite, employee, '/documents', 'Acknowledged task readback');
    assert.equal(after.orders.find((entry) => entry.orderUuid === orderUuid).tasks.find((entry) => entry.itemId === task.itemId).status, 'complete');
  }
}

test('FUCQ-556: real Orders tracker, tasks, handover keyboard booking and missed-attempt rebooking', { timeout: 300000 }, async () => {
  const suite = await startComposition({ caseId: 'f556' });
  suite.receipt.orders = { reads: [], commands: [], uiCommands: [], states: {}, pairs: {}, uncovered: [
    { state: 'change-proposed / Can\'t make it? Get help', reason: 'Canonical lifecycle.appointments.scenario.v1.proposeChange=false; no general retained policy-file selector is exposed.' },
    { state: 'human-reviewed parity', reason: 'Captured same-state pairs require a human verdict; browser assertions cannot provide it.' },
  ] };
  try {
    const employee = await suite.newPage('employee', 'demo-paula', 'account');
    const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
    const greg = await suite.newPage('greg', 'demo-greg', '');
    const state = await suite.releaseMainOffer(employee, presenter);
    await acceptOffer(suite, employee, state);
    assert.equal(posts(suite, '/decision').length, 1);
    const orderUuid = state.offer.orderUuid;
    const early = await snapshot(suite, employee, orderUuid, 'accepted');
    await openOrders(suite, employee);
    suite.receipt.orders.states.accepted.tracker = await tracker(employee, early.stages);
    assert.ok(early.stages.nextStep);
    assert.equal(suite.receipt.orders.states.accepted.tracker.find((row) => row.next)?.next, `Next: ${early.stages.nextStep}`);
    if (early.stages.source?.orderReference) assert.ok((await employee.locator('.orders-screen').innerText()).includes(early.stages.source.orderReference));
    assert.match(await employee.locator('.orders-screen').innerText(), /Handover times open once your order is sent to ordering/);
    let current = early;
    const approvalTicks = Object.values(assumption('lifecycle.approval.ticks.v1')).reduce((total, value) => total + value, 0);
    const progressionTicks = approvalTicks + early.stages.stageList.length;
    for (let count = 0; count < progressionTicks && current.stages.outcome !== 'sent-to-ordering'; count++) {
      await tick(suite, presenter);
      current = await snapshot(suite, employee, orderUuid, `approval-tick-${count + 1}`);
    }
    assert.equal(current.stages.outcome, 'sent-to-ordering', 'Actual approvals progress to ordering');
    await openOrders(suite, employee); await tracker(employee, current.stages);
    const orderingClock = await read(suite, presenter, '/presenter/clock', 'Actual ordering pair clock');
    suite.receipt.orders.pairs.ordering = { angular: await screenshots(suite, employee, 'angular-ordering') };
    const replay = await suite.visitFrozenNode({ ...suite.receipt.offer, hold: state.hold, clock: state.clock, finalAccount: state.account }, async (source) => {
      await source.page.goto(`${source.origin}/gcsp-offer.html?offerId=${encodeURIComponent(source.offer.offerRef.offerId)}&runId=${encodeURIComponent(source.control.runId)}`, { waitUntil: 'domcontentloaded' });
      await acceptOnPage(source.page, async (response, sent, body) => {
        source.receipt.ordersAcceptance = { status: response.status(), sent, body };
        assert.equal(response.status(), 200); assert.equal(body.status, 'ok');
      });
      source.receipt.orderingTicks = [];
      const ticks = suite.receipt.orders.commands.filter((row) => row.route === '/presenter/clock/tick');
      for (const tick of ticks) {
        const clock = nodeGood(await source.runtime.clock.now(source.control), 'Frozen clock before lifecycle tick');
        const input = { eventId: tick.body.tickId, expectedClockVersion: String(clock.clockVersion),
          inputDigest: createHash('sha256').update(JSON.stringify(tick.body)).digest('hex') };
        const result = await source.runtime.clock.tick(source.control, input);
        source.receipt.orderingTicks.push({ input, result });
        nodeGood(result, 'Frozen public lifecycle clock tick');
      }
      const actual = await source.runtime.lifecycle.read(source.employee, { orderUuid });
      source.receipt.ordersAtOrdering = actual;
      source.receipt.ordersClock = await source.runtime.clock.now(source.control);
      const sourceClock = nodeGood(source.receipt.ordersClock, 'Frozen ordering clock');
      assert.equal(sourceClock.now, orderingClock.now); assert.equal(String(sourceClock.clockVersion), String(orderingClock.clockVersion));
      const stages = nodeGood(actual, 'Frozen actual ordering state');
      assert.equal(stages.orderUuid, current.stages.orderUuid); assert.equal(stages.runId, current.stages.runId);
      assert.deepEqual(stages.stages.map(({ stage, state }) => ({ stage, state })), current.stages.stages.map(({ stage, state }) => ({ stage, state })), 'Actual Node and Java sent-to-ordering approval states agree');
      assert.equal(stages.currentStage, current.stages.currentStage); assert.equal(stages.outcome, current.stages.outcome);
      await source.page.goto(`${source.origin}/gcsp-order-progress-live.html?orderUuid=${encodeURIComponent(orderUuid)}`, { waitUntil: 'domcontentloaded' });
      await source.page.locator('.gcsp-stage-list').waitFor();
      source.receipt.ordersTracker = await tracker(source.page, stages);
      source.receipt.ordersDocuments = await source.runtime.documents.readItems(source.employee);
      source.receipt.ordersAppointment = await source.runtime.appointments.read(source.employee, { orderUuid });
      const nodeDocuments = nodeGood(source.receipt.ordersDocuments, 'Frozen actual document tasks');
      const nodeAppointment = nodeGood(source.receipt.ordersAppointment, 'Frozen offered handover slots');
      const document = nodeDocuments.orders.find((row) => row.orderUuid === orderUuid);
      const javaDocument = current.documents.orders.find((row) => row.orderUuid === orderUuid);
      assert.ok(document && javaDocument);
      // Both raw responses are retained above; Instant.toString() and Date.toISOString() differ only in fractional-zero formatting.
      const itemFacts = (rows) => rows.map(({ itemId, owner, status, dueAt }) => ({ itemId, owner, status,
        dueAt: typeof dueAt === 'string' ? new Date(dueAt).toISOString() : dueAt }));
      assert.deepEqual(itemFacts(document.items), itemFacts(javaDocument.items), 'Same actual ordering document state on both engines');
      assert.equal(nodeAppointment.state, current.appointment.state);
      assert.deepEqual(nodeAppointment.offeredSlots, current.appointment.offeredSlots, 'Same actual offered handover choices on both engines');
      await source.page.locator('section.gcsp-task-list').waitFor();
      assert.ok(await source.page.locator('ul.gcsp-slot-picker button').count() > 0);
      source.receipt.ordersScreenshots = await screenshots(suite, source.page, 'node-ordering');
      suite.receipt.orders.pairs.ordering.node = source.receipt.ordersScreenshots;
      suite.receipt.orders.pairs.ordering.state = { orderUuid, runId: stages.runId, stages: stages.stages, currentStage: stages.currentStage, outcome: stages.outcome, clock: orderingClock };
    });
    assert.notEqual(replay?.state, 'unrun', 'Frozen Node replay is required for the same-state pair');
    await documentTasks(suite, employee, orderUuid, current);
    current = await snapshot(suite, employee, orderUuid, 'documents-acknowledged');
    const slot = current.appointment.offeredSlots[0]; assert.ok(slot?.slotId);
    await reviewedAction(suite, employee, employee.locator('ul.gcsp-slot-picker').first().getByRole('button').first(), 'Request this handover time?', '/appointments/request',
      { orderUuid, slotId: slot.slotId, expectedVersion: current.appointment.version });
    const requested = await read(suite, employee, '/appointments' + query(orderUuid), 'Requested handover readback');
    assert.equal(requested.state, 'requested'); assert.equal(requested.requestedSlot.slotId, slot.slotId); assert.equal(requested.booked, false);
    await tick(suite, presenter, new Date(Date.parse((await read(suite, presenter, '/presenter/clock')).now) + confirmationSeconds * 1000).toISOString());
    const booked = await read(suite, employee, '/appointments' + query(orderUuid), 'Booked handover readback');
    assert.equal(booked.state, 'scheduled'); assert.equal(booked.booked, true); assert.equal(booked.slot.slotId, slot.slotId);
    await openOrders(suite, employee);
    assert.ok(await employee.locator('.gcsp-activity-timeline').count() > 0, 'Actual multiple appointment events use the canonical timeline');
    await screenshots(suite, employee, 'angular-booked');
    const beforeNoShow = await read(suite, presenter, '/presenter/clock', 'Clock before the actual booked handover');
    const availableFrom = Date.parse(booked.slot.start) + noShowSeconds * 1000;
    suite.receipt.orders.noShowTiming = { slot: booked.slot, noShowSeconds, before: beforeNoShow, availableFrom };
    assert.ok(Number.isFinite(availableFrom), 'The actual booked slot and canonical no-show timing define an instant');
    const noShowClock = await tick(suite, presenter, Date.parse(beforeNoShow.now) < availableFrom ? new Date(availableFrom).toISOString() : undefined);
    suite.receipt.orders.noShowTiming.after = noShowClock;
    assert.ok(Date.parse(noShowClock.now) >= availableFrom, 'Greg records the no-show only once the actual booked slot is eligible');
    const atSlot = await read(suite, employee, '/appointments' + query(orderUuid), 'Handover at actual slot start');
    await command(suite, greg, '/appointments/no-show', { commandId: randomUUID(), orderUuid, expectedVersion: atSlot.version });
    const missed = await read(suite, employee, '/appointments' + query(orderUuid), 'Missed handover readback');
    assert.equal(missed.state, 'no-show'); assert.equal(missed.outcome.state, 'no-show');
    await openOrders(suite, employee);
    const next = missed.offeredSlots.find((row) => row.slotId !== slot.slotId); assert.ok(next, 'The actual service offers a fresh handover slot');
    const buttons = employee.locator('ul.gcsp-slot-picker').first().getByRole('button');
    const index = missed.offeredSlots.findIndex((row) => row.slotId === next.slotId);
    await reviewedAction(suite, employee, buttons.nth(index), 'Request this handover time?', '/appointments/request',
      { orderUuid, slotId: next.slotId, expectedVersion: missed.version });
    const rebooked = await read(suite, employee, '/appointments' + query(orderUuid), 'Rebooking retains previous missed attempt');
    assert.equal(rebooked.attempt, 2); assert.equal(rebooked.requestedSlot.slotId, next.slotId);
    assert.ok(rebooked.previousAttempts.some((attempt) => attempt.state === 'no-show' && attempt.slot.slotId === slot.slotId));
    await openOrders(suite, employee);
    assert.match(await employee.locator('.orders-screen').innerText(), /Earlier handover missed/);
    await screenshots(suite, employee, 'angular-rebooked', [1280]);
    await tick(suite, presenter, new Date(Date.parse((await read(suite, presenter, '/presenter/clock')).now) + confirmationSeconds * 1000).toISOString());
    await openOrders(suite, employee);
    const returnPlan = await read(suite, employee, '/return-plan' + query(orderUuid), 'Available old-car return choices');
    const choice = returnPlan.choices.find((row) => row.available && returnPlan.offeredSlots[row.id]?.length);
    assert.ok(choice, 'Actual booked handover exposes an available return choice');
    const returnSlot = returnPlan.offeredSlots[choice.id][0];
    const returnButton = employee.locator('ul.gcsp-slot-picker').getByRole('button', { name: /^Request return/ }).first();
    await reviewedAction(suite, employee, returnButton, 'Request this return time?', '/return-plan/request',
      { orderUuid, choice: choice.id, slotId: returnSlot.slotId, expectedVersion: returnPlan.version });
    await tick(suite, presenter, new Date(Date.parse((await read(suite, presenter, '/presenter/clock')).now) + confirmationSeconds * 1000).toISOString());
    await command(suite, presenter, '/presenter/returns/progress', { commandId: randomUUID() });
    const final = await snapshot(suite, employee, orderUuid, 'return-planned');
    assert.equal(final.returnPlan.state, 'return-scheduled'); assert.equal(final.returnPlan.scheduled, true);
    await openOrders(suite, employee); await screenshots(suite, employee, 'angular-return-planned', [1280]);
    const due = new Date(Date.parse(final.returnPlan.slot.end) + returnOutcomeSeconds * 1000).toISOString();
    await tick(suite, presenter, due);
    await command(suite, presenter, '/presenter/returns/progress', { commandId: randomUUID() });
    const returned = await snapshot(suite, employee, orderUuid, 'return-missed');
    assert.equal(returned.returnPlan.state, 'return-missed', 'The configured existing missed-return scenario reaches its actual outcome');
    await openOrders(suite, employee);
    assert.match(await employee.locator('.orders-screen').innerText(), /Return missed/);
    await screenshots(suite, employee, 'angular-return-missed', [1280]);
    assert.deepEqual(suite.receipt.consoleErrors, [], 'No app runtime errors in the checked lifecycle');
    suite.receipt.orders.observedCoverage = ['owned order / tracker owner and Next', 'early handover closed', 'grouped real document tasks / acknowledgement readback',
      'keyboard slot selection / explicit confirmation / booked readback', 'canonical actual history', 'Greg no-show / rebooking / earlier missed copy', 'real offered return choice / scheduled readback / actual missed-return outcome', 'sent-to-ordering same-order Node/Angular 1280 and 390 captures'];
    suite.receipt.checks.ordersReachableLifecycle = true;
  } catch (error) {
    suite.receipt.failure = { name: error.name, message: error.message.slice(0, 1000) }; throw error;
  } finally { await suite.close(); }
});

test('FUCQ-556: actual declined approval offers Help', {
  skip: 'The existing approvals file seam requires the accepted order composed policyVersion; no supported exporter supplies it. Base-seed version rewriting is not a legitimate input. Original declined connected criterion remains pending.',
}, () => {});

for (const variant of ['blocked']) {
  test(`FUCQ-556: actual ${variant} approval offers its source Orders treatment`, { timeout: 120000 }, async () => {
    const suite = await startComposition({ caseId: `f556-${variant}` });
    suite.receipt.orders = { reads: [], commands: [], uiCommands: [], states: {}, pairs: {}, uncovered: [] };
    try {
      const employee = await suite.newPage('employee', 'demo-paula', 'account');
      const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
      const state = await suite.releaseMainOffer(employee, presenter);
      await acceptOffer(suite, employee, state);
      const route = '/orders/progress' + query(state.offer.orderUuid);
      let stages = await read(suite, employee, route, `Initial ${variant} scenario order`);
      const ticks = Object.values(assumption('lifecycle.approval.ticks.v1')).reduce((total, value) => total + value, 0) + stages.stageList.length;
      const reached = () => Boolean(stages.blocked);
      for (let count = 0; count < ticks && !reached(); count++) {
        const clock = await tick(suite, presenter);
        await command(suite, presenter, '/presenter/approvals/ticks', {
          commandId: randomUUID(), tickId: randomUUID(), now: clock.now, clockVersion: Number(clock.clockVersion),
        });
        stages = await read(suite, employee, route, `${variant} approval tick ${count + 1}`);
      }
      suite.receipt.orders.states[variant] = stages;
      assert.equal(stages.orderUuid, state.offer.orderUuid); assert.equal(stages.runId, suite.receipt.composition.runId);
      assert.equal(stages.employeeId, suite.input.initialBrief.brief.employeeId);
      await openOrders(suite, employee);
      suite.receipt.orders.tracker = await tracker(employee, stages);
      assert.equal(stages.provider.mode, 'none');
      assert.equal(stages.outcome, 'in-progress');
      assert.ok(stages.stages.some((row) => row.stage === stages.currentStage && row.state === 'pending'));
      assert.ok(stages.blocked?.reason, 'The existing unconfigured approval path supplies its actual blocked note');
      assert.equal(normalize(await employee.locator('.gcsp-stage.is-blocked .gcsp-stage-note').innerText()), stages.blocked.reason);
      suite.receipt.orders.screenshot = await suite.screenshot(employee, `angular-${variant}-1280`, { fullPage: true });
      assert.deepEqual(suite.receipt.consoleErrors, []);
      suite.receipt.checks[`orders-${variant}`] = true;
    } catch (error) {
      suite.receipt.failure = { name: error.name, message: error.message.slice(0, 1000) }; throw error;
    } finally { await suite.close(); }
  });
}
