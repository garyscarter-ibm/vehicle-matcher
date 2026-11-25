import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { startComposition } from './composition.mjs';

const good = (response, label) => {
  assert.equal(response.status, 200, label); assert.equal(response.body.status, 'ok', label); return response.body.value;
};
const sourceGood = (result, label) => { assert.equal(result.status, 'ok', label); return result.value; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(100); }
  assert.fail(label);
}
function completeChoices(account) {
  const action = account.actions.find(value => value.enabled && ['replace', 'order'].includes(value.action));
  assert.ok(action, 'The actual account supplies a permitted ordering journey');
  const driver = account.drivers.find(value => value.kind === 'employee' && value.eligible?.value === true);
  assert.ok(driver, 'The actual employee driver is eligible');
  const contract = account.choices.contractOptions.find(value => value.schemeIds.includes(action.schemeId) && value.driverKinds.includes(driver.kind));
  assert.ok(contract, 'The actual policy supplies a contract for the driver');
  const location = account.choices.collectionLocations.find(value => value.contractOptionIds.includes(contract.contractOptionId) && value.driverKinds.includes(driver.kind));
  assert.ok(location, 'The actual policy supplies a collection location');
  const rules = account.assumptions.find(value => value.key === 'manual.context.v1').value;
  const window = account.contracts?.find(value => value.contractId === action.oldContractId) ?? account.currentContract
    ?? account.slots.find(value => value.entitlementSlotId === action.slotId);
  const lead = new Date(Date.parse(account.asOf.slice(0, 10) + 'T00:00:00Z') + rules.minimumLeadDays * 86400000).toISOString().slice(0, 10);
  let date = [lead, window?.earliestCollectionDate].filter(Boolean).sort().at(-1);
  while (location.closedDates?.includes(date)) date = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  assert.ok(!window?.latestCollectionDate || date <= window.latestCollectionDate);
  return { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
    slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: contract.contractOptionId,
    requestedCollectionDate: date, collectionLocationId: location.locationId, brand: account.choices.brands[0],
    contact: { phone: account.account.contact.phone, email: account.account.contact.email },
    expectedReturnMileage: action.action === 'replace' ? 20000 : null, specialRequirements: '' };
}
async function saveActualDraft(suite, employee) {
  const account = good(await suite.call(employee, 'GET', '/manual/account'), 'Actual account');
  const prior = await suite.call(employee, 'GET', '/manual/draft');
  assert.ok([200, 404].includes(prior.status));
  assert.ok(['ok', 'not-found'].includes(prior.body.status), 'Actual draft is saved or authoritatively absent');
  const choices = completeChoices(account);
  const draft = good(await suite.call(employee, 'POST', '/manual/draft', { commandId: randomUUID(),
    expectedDraftVersion: prior.body.status === 'ok' ? prior.body.value.draftVersion : 0,
    expectedContextVersion: account.contextVersion, choices }), 'Actual complete draft');
  return { account, draft, choices };
}
async function declineActualOffer(suite, employee, id) {
  const offer = good(await suite.call(employee, 'GET', `/offers/${id}`), 'Actual owned offer');
  const reasons = good(await suite.call(employee, 'GET', `/offers/${id}/decision-reasons`), 'Actual decline reasons');
  return good(await suite.call(employee, 'POST', `/offers/${id}/decision`, { commandId: randomUUID(), runId: offer.runId,
    decision: 'decline', reasonCode: reasons.reasons[0].code, expectedOfferVersion: offer.offerVersion,
    expectedHoldVersion: offer.holdVersion, expectedQuoteVersion: offer.quote.revisions.quote }), 'Actual decline');
}
const claimPosts = page => page.__f553Claims.filter(row => row.method === 'POST');
function observeClaims(page) {
  page.__f553Claims = [];
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/manual/claim')) {
    page.__f553Claims.push({ method: request.method(), body: request.method() === 'POST' ? request.postDataJSON() : null });
  } });
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'The actual screen fits its viewport');
}

test('FUCQ-553: source stock, choices and gallery reservation handover', { timeout: 540000 }, async t => {
  const suite = await startComposition({ caseId: 'f553', claims: 'controlled' });
  t.after(() => suite.close());
  const evidence = suite.receipt.stockChoices = { humanAcceptance: 'pending human review of original same-state 1280 pending/failed pairs',
    provider: 'Existing Java remote claim-stock contract over controlled HTTPS; fictional acknowledgements, real persisted custody and signed commands',
    groups: [] };
  async function check(name, work) {
    let failure;
    await t.test(name, async () => { const item = { name, state: 'running' }; evidence.groups.push(item);
      try { await work(); item.state = 'passed'; } catch (error) { item.state = 'failed'; item.failure = error.message; failure = error; throw error; } });
    if (failure) throw failure;
  }
  const employee = await suite.newPage('employee', 'demo-paula', 'account');
  const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
  await suite.prepareInitialBrief(employee, presenter);
  const released = await suite.releaseMainOffer(employee, presenter);
  const offerId = released.offer.offerRef.offerId;
  await saveActualDraft(suite, employee);
  observeClaims(employee);
  await employee.setViewportSize({ width: 1280, height: 800 });
  await check('held-offer navigation preserves the source cards', async () => {
    const stock = good(await suite.call(employee, 'GET', '/manual/stock'), 'Actual current-context held-offer stock');
    assert.equal(stock.heldOffer.offerId, offerId);
    await employee.goto(`${suite.origins.web}/gcsp/stock`);
    await employee.getByRole('button', { name: 'View your offer', exact: true }).waitFor();
    assert.ok(await employee.locator('.vm-card.vm-card-explicit.gcsp-card').count() > 0);
    await suite.screenshot(employee, 'angular-held-offer-stock-1280', { fullPage: true });
    await employee.setViewportSize({ width: 375, height: 812 }); await noOverflow(employee);
    await suite.screenshot(employee, 'angular-held-offer-stock-375', { fullPage: true });
    await employee.getByRole('button', { name: 'View your offer', exact: true }).focus();
    await employee.getByRole('button', { name: 'View your offer', exact: true }).press('Enter');
    await employee.waitForURL(url => url.pathname.endsWith(`/offers/${offerId}`));
    await employee.setViewportSize({ width: 1280, height: 800 });
    await declineActualOffer(suite, employee, offerId);
    evidence.choices = await saveActualDraft(suite, employee);
  });
  await check('employee and selected-driver facts, support and eligible count', async () => {
    await employee.goto(`${suite.origins.web}/gcsp/account`);
    await employee.getByRole('button', { name: 'Carry on', exact: true }).click();
    await employee.getByRole('heading', { name: 'Review choices', exact: true }).waitFor();
    await employee.getByText('Employee details', { exact: true }).click();
    assert.ok(await employee.getByText('Employee number', { exact: true }).count());
    assert.ok(await employee.getByText('Licence number', { exact: true }).count());
    await employee.getByRole('button', { name: 'Get help with drivers and licences', exact: true }).click();
    await employee.getByText('Contact driver support to correct driver or licence details. No request has been sent.', { exact: true }).waitFor();
    await employee.getByRole('button', { name: 'Save choices', exact: true }).click();
    await employee.getByText(/Availability refreshed \([0-9]+ eligible cars\)/).waitFor();
    await suite.screenshot(employee, 'angular-choices-1280', { fullPage: true });
    await employee.setViewportSize({ width: 375, height: 812 }); await noOverflow(employee);
    await suite.screenshot(employee, 'angular-choices-375', { fullPage: true });
    await employee.getByRole('button', { name: 'Find a car', exact: true }).click();
    await employee.waitForURL(url => url.pathname.endsWith('/stock'));
    await employee.setViewportSize({ width: 1280, height: 800 });
  });
  await check('a real competing employee produces the retained-list car-taken notice and refresh', async () => {
    const rival = await suite.newPage('other-employee', 'demo-jordan', 'account');
    await saveActualDraft(suite, rival);
    const stock = good(await suite.call(rival, 'GET', '/manual/stock'), 'Other employee actual stock');
    assert.equal(stock.payloadShape, 'manual-stock-compact-v1');
    const button = employee.locator('.vm-card [data-review-id]:enabled').first(); await button.waitFor();
    const id = await button.getAttribute('data-review-id'); const target = stock.decisions.find(car => car.orderUuid === id);
    assert.ok(stock.carIds.includes(id) && target?.gateStatus === 'eligible' && target.claimInput,
      'Both actual employees are eligible for this same exact car');
    suite.claims.confirm();
    const rivalClaim = good(await suite.call(rival, 'POST', '/manual/claim', { commandId: randomUUID(), ...target.claimInput }), 'Other employee actual reservation');
    assert.equal(rivalClaim.state, 'quoted');
    const count = await employee.locator('.vm-card').count(); await button.click();
    await employee.getByRole('heading', { name: 'This car is no longer available', exact: true }).waitFor();
    assert.equal(await employee.locator('.vm-card').count(), count, 'One car refusal retains the browsed list');
    await suite.screenshot(employee, 'angular-car-taken-1280', { fullPage: true });
    const refreshed = employee.waitForResponse(response => new URL(response.url()).pathname.endsWith('/manual/stock'));
    await employee.getByRole('button', { name: 'Refresh availability', exact: true }).click(); await refreshed;
    assert.equal(await employee.getByRole('heading', { name: 'This car is no longer available', exact: true }).count(), 0);
    const releasedClaim = good(await suite.call(rival, 'POST', '/manual/claim/release', { commandId: randomUUID(), holdId: rivalClaim.hold.holdId,
      expectedHoldVersion: rivalClaim.hold.version, expectedDraftVersion: rivalClaim.quote.draftVersion, reason: 'cancel' }), 'Other employee actual release');
    assert.equal(releasedClaim.state, 'released'); await rival.close();
    await employee.reload({ waitUntil: 'domcontentloaded' });
    await employee.locator('.vm-card [data-review-id]:enabled').first().waitFor();
  });
  let selected;
  await check('real pending custody, GET-only status and matching terminal recovery', async () => {
    await employee.locator('.vm-card [data-review-id]:enabled').first().waitFor();
    selected = await employee.locator('.vm-card [data-review-id]:enabled').first().getAttribute('data-review-id');
    suite.claims.pending(); await employee.locator('.vm-card [data-review-id]:enabled').first().click();
    await employee.getByText('Your reservation is still being checked. Check its status before choosing another car.', { exact: true }).waitFor();
    evidence.pending = good(await suite.call(employee, 'GET', '/manual/claim'), 'Actual persisted pending claim');
    assert.equal(evidence.pending.state, 'claim-pending'); assert.equal(evidence.pending.hold.orderUuid, selected);
    await suite.screenshot(employee, 'angular-reservation-pending-1280', { fullPage: true });
    const before = claimPosts(employee).length;
    await employee.getByRole('button', { name: 'Check status', exact: true }).click();
    await until(async () => await employee.getByRole('button', { name: 'Check status', exact: true }).isEnabled(), 'Status read completed');
    assert.equal(claimPosts(employee).length, before, 'Check status sends no browser POST');
    await employee.setViewportSize({ width: 375, height: 812 }); await noOverflow(employee);
    await suite.screenshot(employee, 'angular-reservation-pending-375', { fullPage: true });
    suite.claims.rejectPending(); await employee.getByRole('button', { name: 'Check status', exact: true }).click();
    await employee.getByText('Your previous reservation has ended. Availability has been refreshed.', { exact: true }).waitFor();
    evidence.failed = good(await suite.call(employee, 'GET', '/manual/claim'), 'Actual refused custody');
    assert.equal(evidence.failed.state, 'claim-failed'); assert.equal(evidence.failed.pendingOperation, null);
    await employee.setViewportSize({ width: 1280, height: 800 });
    await suite.screenshot(employee, 'angular-reservation-failed-1280', { fullPage: true });
    await employee.setViewportSize({ width: 375, height: 812 }); await noOverflow(employee);
    await suite.screenshot(employee, 'angular-reservation-failed-375', { fullPage: true });
    await employee.setViewportSize({ width: 1280, height: 800 });
  });
  await check('fresh pins, explicit identical retry after a lost request, held review without another reserve', async () => {
    await employee.locator('.vm-card [data-review-id]:enabled').first().waitFor();
    suite.claims.confirm(); let intercepted = false;
    const interrupt = async route => { if (!intercepted && route.request().method() === 'POST') { intercepted = true; await route.abort('failed'); } else await route.continue(); };
    await employee.route('**/manual/claim', interrupt);
    await employee.locator('.vm-card [data-review-id]:enabled').first().click();
    await employee.getByRole('button', { name: 'Retry this reservation', exact: true }).waitFor();
    await employee.unroute('**/manual/claim', interrupt);
    const command = claimPosts(employee).at(-1).body;
    assert.notEqual(command.commandId, claimPosts(employee)[0].body.commandId);
    const before = claimPosts(employee).length;
    await employee.getByRole('button', { name: 'Check status', exact: true }).click();
    await employee.getByRole('button', { name: 'Retry this reservation', exact: true }).waitFor();
    assert.equal(claimPosts(employee).length, before);
    await employee.getByRole('button', { name: 'Retry this reservation', exact: true }).click();
    await employee.waitForURL(url => url.pathname.endsWith('/manual/review'));
    assert.deepEqual(claimPosts(employee).at(-1).body, command);
    assert.equal(await employee.getByRole('button', { name: 'Reserve this car to review', exact: true }).count(), 0);
    evidence.held = good(await suite.call(employee, 'GET', '/manual/claim'), 'Actual held review claim');
    assert.equal(evidence.held.state, 'quoted'); assert.equal(evidence.held.hold.orderUuid, command.orderUuid);
    assert.equal(claimPosts(employee).length, before + 1, 'Opening review performs no second reserve');
    await employee.setViewportSize({ width: 375, height: 812 }); await noOverflow(employee);
    await suite.screenshot(employee, 'angular-held-review-375', { fullPage: true });
  });
  await check('frozen same-custody-state pending and failed 1280 pairs for human review', async () => {
    const replay = await suite.visitFrozenNode({ ...suite.receipt.offer, hold: released.hold, clock: released.clock,
      finalAccount: released.account, stockGallery: true }, async ({ page, origin, runtime, employee: principal, offer, galleryClaims, receipt }) => {
      const selector = { runId: principal.runId, offerId: offer.offerRef?.offerId ?? offer.offerId };
      const entry = sourceGood(await runtime.offerAccess.fromAccount(principal, selector), 'Node owned offer access');
      const reasons = sourceGood(await runtime.offerDecisions.readReasons(entry.context, selector), 'Node actual decline reasons');
      const current = entry.offer;
      sourceGood(await runtime.offerDecisions.decide(entry.context, { ...selector, commandId: randomUUID(), decision: 'decline',
        reasonCode: reasons.reasons[0].code, expectedOfferVersion: current.offerVersion, expectedHoldVersion: current.holdVersion,
        expectedQuoteVersion: current.quote.revisions.quote }), 'Node actual decline');
      const account = sourceGood(await runtime.manualRead.readAccount(principal), 'Node actual manual account');
      sourceGood(await runtime.manualRead.saveDraft(principal, { commandId: randomUUID(), expectedDraftVersion: 0,
        expectedContextVersion: account.contextVersion, choices: completeChoices(account) }), 'Node actual complete draft');
      await page.goto(`${origin}/gcsp-manual-gallery.html`);
      await page.locator('.vm-card [data-review-id]:enabled').first().waitFor();
      galleryClaims.pending(); await page.locator('.vm-card [data-review-id]:enabled').first().click();
      await page.getByRole('button', { name: 'Check status', exact: true }).waitFor();
      receipt.stockGallery.pending = await runtime.manualClaims.readClaim(principal);
      assert.equal(receipt.stockGallery.pending.status, 'pending');
      await suite.screenshot(page, 'node-reservation-pending-1280', { fullPage: true });
      galleryClaims.rejectPending(); await page.getByRole('button', { name: 'Check status', exact: true }).click();
      await until(async () => (await runtime.manualClaims.readClaim(principal)).value?.state === 'claim-failed', 'Node real custody failure');
      receipt.stockGallery.failed = await runtime.manualClaims.readClaim(principal);
      await suite.screenshot(page, 'node-reservation-failed-1280', { fullPage: true });
      return { stockChoicesParity: { pending: 'Captured actual pending operation', failed: 'Captured actual terminal claim-failed', humanAcceptance: 'pending' } };
    });
    assert.equal(replay.state, 'matched', 'The frozen reference must actually run');
  });
});
