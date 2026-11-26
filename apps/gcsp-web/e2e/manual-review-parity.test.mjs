import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { startComposition } from './composition.mjs';

const good = (response, label) => {
  assert.equal(response.status, 200, label); assert.equal(response.body.status, 'ok', label); return response.body.value;
};
const sourceGood = (result, label) => { assert.equal(result.status, 'ok', label); return result.value; };
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.fail(label);
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const claimCommand = claim => ({ holdId: claim.hold.holdId, expectedHoldVersion: claim.hold.version,
  expectedDraftVersion: claim.quote.draftVersion });
const releasePaths = ['/manual/claim', '/manual/claim/review', '/manual/claim/release', '/manual/order', '/manual/review-details'];
function observeWrites(page) {
  const writes = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname.replace('/api/gcsp/v1', '');
    if (request.method() === 'POST' && releasePaths.includes(path)) writes.push({ path, body: request.postDataJSON() });
  });
  return { writes, at: path => writes.filter(row => row.path === path) };
}
function completeChoices(account) {
  const action = account.actions.find(row => row.enabled && ['replace', 'order'].includes(row.action));
  const driver = account.drivers.find(row => row.kind === 'employee' && row.eligible?.value === true);
  assert.ok(action && driver, 'Actual account supplies the replacement journey and eligible employee driver');
  const contract = account.choices.contractOptions.find(row => row.schemeIds.includes(action.schemeId) && row.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find(row => row.contractOptionIds.includes(contract.contractOptionId) && row.driverKinds.includes(driver.kind));
  const rules = account.assumptions.find(row => row.key === 'manual.context.v1').value;
  const window = account.contracts?.find(row => row.contractId === action.oldContractId) ?? account.currentContract
    ?? account.slots.find(row => row.entitlementSlotId === action.slotId);
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
async function saveDraft(suite, page) {
  const account = good(await suite.call(page, 'GET', '/manual/account'), 'Actual account');
  const prior = await suite.call(page, 'GET', '/manual/draft');
  assert.ok([200, 404].includes(prior.status));
  const choices = completeChoices(account);
  const draft = good(await suite.call(page, 'POST', '/manual/draft', { commandId: randomUUID(), choices,
    expectedDraftVersion: prior.body.status === 'ok' ? prior.body.value.draftVersion : 0,
    expectedContextVersion: account.contextVersion }), 'Actual complete choices');
  return { account, draft, choices };
}
async function decline(suite, page, id) {
  const offer = good(await suite.call(page, 'GET', `/offers/${id}`), 'Actual offer');
  const reasons = good(await suite.call(page, 'GET', `/offers/${id}/decision-reasons`), 'Actual decline reasons');
  good(await suite.call(page, 'POST', `/offers/${id}/decision`, { commandId: randomUUID(), runId: offer.runId,
    decision: 'decline', reasonCode: reasons.reasons[0].code, expectedOfferVersion: offer.offerVersion,
    expectedHoldVersion: offer.holdVersion, expectedQuoteVersion: offer.quote.revisions.quote }), 'Actual decline');
}
async function settled(page) {
  await until(async () => await page.locator('gcsp-manual-route').count() > 0
    && await page.locator('gcsp-manual-route [aria-busy="true"]').count() === 0, 'Manual authoritative reads settle');
}
async function capture(suite, page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name}: no horizontal overflow`);
  await suite.screenshot(page, name, { fullPage: true });
}
async function plain(page, claim) {
  const text = await page.locator('main').innerText();
  for (const label of ['Quote id', 'Draft version', 'Reservation id', 'Reservation version', 'Returning contract id', 'Car ID', 'Terms version', 'Terms valid until']) {
    assert.ok(!text.includes(label), `Employee copy omits ${label}`);
  }
  for (const id of [claim.hold.holdId, claim.quote.quoteId, claim.quote.orderUuid, claim.quote.driverId]) {
    if (id) assert.ok(!text.includes(id), 'Employee copy omits raw claim/car/driver identifiers');
  }
}
async function timer(page, claim) {
  const seconds = Math.max(0, Math.ceil((Date.parse(claim.hold.expiresAt) - Date.parse(claim.now)) / 1000));
  const expected = `${claim.hold.phase === 'preview' ? 'Car reservation' : 'Order review'}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining`;
  await until(async () => (await page.locator('[data-testid="manual-reservation-timer"]').innerText()).includes(expected),
    'Countdown agrees with the authoritative claim read');
  return { now: claim.now, expiresAt: claim.hold.expiresAt, expected };
}
async function saveDetails(page) {
  const save = button(page, 'Save review details');
  if (await save.isEnabled()) {
    const response = page.waitForResponse(row => row.request().method() === 'POST' && new URL(row.url()).pathname.endsWith('/manual/review-details'));
    await save.click(); assert.equal((await response).status(), 200, 'Actual details save succeeds');
  }
  await settled(page);
}
async function refresh(page) {
  const response = page.waitForResponse(row => row.request().method() === 'GET' && new URL(row.url()).pathname.endsWith('/manual/claim'));
  await button(page, 'Check current claim').click(); await response; await settled(page);
}
async function continueReview(page, label = 'Continue to order review') {
  await button(page, label).click();
  await page.getByRole('heading', { name: 'Review your order', exact: true, level: 1 }).waitFor();
  await settled(page);
}

test('FUCQ-554: authoritative manual review, six-card summary and safe navigation match the frozen live journey', { timeout: 540000 }, async t => {
  const suite = await startComposition({ caseId: 'f554', claims: 'controlled' });
  t.after(() => suite.close());
  const evidence = suite.receipt.manualReview = { humanAcceptance: 'Original AC7 unchecked: same-state 1280 pair awaits an actual collaborator verdict', groups: [],
    setupDifference: 'Confirmed gallery-held handover consumes the existing explicit resume before review edits; no command replay.' };
  async function check(name, run) {
    const row = { name, state: 'running' }; evidence.groups.push(row);
    try { await run(); row.state = 'passed'; } catch (error) { row.state = 'failed'; row.failure = error.message; throw error; }
  }
  const employee = await suite.newPage('employee', 'demo-paula', 'account');
  const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
  await suite.prepareInitialBrief(employee, presenter);
  const released = await suite.releaseMainOffer(employee, presenter);
  await decline(suite, employee, released.offer.offerRef.offerId);
  evidence.inputs = await saveDraft(suite, employee);
  const journal = observeWrites(employee);
  suite.claims.confirm();
  async function reserve() {
    await employee.goto(`${suite.origins.web}/gcsp/stock`, { waitUntil: 'domcontentloaded' });
    const control = employee.locator('.vm-card [data-review-id]:enabled').first(); await control.waitFor();
    const id = await control.getAttribute('data-review-id');
    const stock = good(await suite.call(employee, 'GET', '/manual/stock'), 'Actual eligible stock');
    const selected = stock.decisions.find(row => row.orderUuid === id);
    assert.equal(selected.gateStatus, 'eligible'); assert.ok(selected.claimInput);
    const before = journal.at('/manual/claim').length;
    await control.click(); await employee.waitForURL(url => url.pathname.endsWith('/manual/review'));
    await employee.locator('#manual-contact-phone').waitFor(); await settled(employee);
    assert.equal(journal.at('/manual/claim').length, before + 1, 'F553 handover performs exactly one gallery reserve');
    const { commandId, ...pins } = journal.at('/manual/claim').at(-1).body;
    assert.ok(commandId); assert.deepEqual(pins, selected.claimInput, 'Actual stock supplies all claim version pins');
    assert.equal(await button(employee, 'Reserve this car to review').count(), 0, 'Confirmed held handover has no second reserve');
    const claim = good(await suite.call(employee, 'GET', '/manual/claim'), 'GET-confirmed held handover');
    assert.equal(claim.state, 'quoted'); assert.equal(claim.hold.state, 'active'); assert.equal(claim.hold.phase, 'preview');
    assert.equal(claim.quote.orderUuid, id); assert.equal(claim.quote.driverId, evidence.inputs.choices.driverId);
    const resume = button(employee, 'Continue reviewing this selection'); const writesBeforeResume = journal.writes.length;
    const explicitResumeConsumed = await resume.isVisible();
    if (explicitResumeConsumed) await resume.click();
    await until(() => employee.locator('#manual-contact-phone').isEnabled(), 'Explicit resume enables review details');
    assert.equal(journal.writes.length, writesBeforeResume, 'Explicit resume sends no reserve, review, release or submit command');
    (evidence.resumeSetup ??= []).push({ explicitResumeConsumed, additionalCommands: 0 });
    return { claim, selected };
  }
  let held = await reserve();
  await check('AC1/2: authoritative countdown, consequences and plain context at both widths', async () => {
    evidence.preview = held.claim;
    const root = employee.locator('gcsp-manual-review');
    for (const label of ['Journey', 'Requested collection', 'Contract term', 'Returning car']) assert.ok(await root.getByText(label, { exact: true }).count());
    await plain(employee, held.claim); evidence.previewTimer = await timer(employee, held.claim);
    assert.match(await root.locator('.gcsp-review-time').innerText(), /reserved until the deadline.*Continuing does not place an order/s);
    for (const [width, height] of [[1280, 800], [375, 812]]) {
      await employee.setViewportSize({ width, height }); await capture(suite, employee, `angular-review-${width}`);
    }
    await button(employee, 'Back').focus();
    assert.equal(await button(employee, 'Back').evaluate(node => node === document.activeElement), true, 'Back receives keyboard focus');
    await employee.setViewportSize({ width: 1280, height: 800 });
  });
  await check('AC6: local discard restores saved details and a real conflict loads the newer saved values', async () => {
    const phone = employee.locator('#manual-contact-phone'); const saved = await phone.inputValue();
    await phone.fill('07700 900999'); const before = journal.writes.length;
    await button(employee, 'Discard local edits').click(); assert.equal(await phone.inputValue(), saved);
    assert.equal(journal.writes.length, before, 'Local discard sends no command');
    await phone.fill('07700 900998');
    const current = good(await suite.call(employee, 'GET', '/manual/review-details'), 'Current details before concurrent save');
    const newer = good(await suite.call(employee, 'POST', '/manual/review-details', { commandId: randomUUID(),
      ...claimCommand(held.claim), quoteId: held.claim.quote.quoteId, expectedReviewDetailsVersion: current.reviewDetailsVersion,
      details: { ...current.details, contact: { ...current.details.contact, phone: '07700 900997' } } }), 'Actual concurrent details save');
    const conflict = employee.waitForResponse(row => row.request().method() === 'POST' && new URL(row.url()).pathname.endsWith('/manual/review-details'));
    await button(employee, 'Save review details').click(); assert.equal((await conflict).status(), 409, 'Stale details actually conflict');
    await settled(employee);
    for (const [width, height] of [[1280, 800], [375, 812]]) {
      await employee.setViewportSize({ width, height }); await capture(suite, employee, `angular-review-conflict-dirty-${width}`);
    }
    await employee.setViewportSize({ width: 1280, height: 800 }); await refresh(employee);
    assert.equal(await phone.inputValue(), '07700 900998', 'Authoritative refresh retains the dirty local phone');
    const afterRead = journal.writes.length; await button(employee, 'Discard local edits').click();
    await until(async () => await phone.inputValue() === newer.details.contact.phone, 'Discard accepts the latest saved details');
    assert.equal(journal.writes.length, afterRead, 'Discard after conflict sends no command');
    evidence.savedDetails = newer.details;
  });
  await saveDetails(employee); await continueReview(employee);
  let summary = good(await suite.call(employee, 'GET', '/manual/claim'), 'Actual summary claim');
  await check('AC3/4: six readback cards with edits/hints and declarations gate one explicit submit', async () => {
    const cards = [['order', 'Your replacement order'], ['driver', 'Driver and licence'], ['points', 'Points and contract'],
      ['collection', 'Collection'], ['contact', 'Contact and requirements'], ['return', 'Car you are returning']];
    assert.equal(await employee.locator('.gcsp-summary-section[data-card]').count(), 6);
    for (const [key, heading] of cards) {
      const card = employee.locator(`[data-card="${key}"]`);
      await card.getByRole('heading', { name: heading, exact: true }).waitFor();
      assert.ok(await card.getByRole('button').count(), `${heading}: mapped edit control`);
      assert.ok((await card.locator('.gcsp-field-hint').allInnerTexts()).join('').length > 0, `${heading}: consequence hint`);
    }
    const { account, choices } = evidence.inputs;
    const driver = account.drivers.find(row => row.driverId === summary.quote.driverId);
    const location = account.choices.collectionLocations.find(row => row.locationId === choices.collectionLocationId);
    assert.ok(driver?.licence?.displayNumber && location?.label, 'Actual selected driver/licence and collection labels exist');
    for (const [key, values] of [['order', [account.account.name]], ['driver', [driver.name, driver.licence.displayNumber]],
      ['collection', [location.label]], ['contact', [evidence.savedDetails.contact.phone, evidence.savedDetails.contact.email]],
      ['return', [account.currentContract.model, '20,000']]]) {
      const text = await employee.locator(`[data-card="${key}"]`).innerText();
      for (const value of values) assert.ok(text.includes(value), `${key}: reads back the actual saved ${value}`);
    }
    await plain(employee, summary); evidence.summaryTimer = await timer(employee, summary);
    await employee.getByRole('heading', { name: 'Before you submit', exact: true }).waitFor();
    assert.equal(await button(employee, 'Submit order').isDisabled(), true, 'Unticked declarations refuse submission');
    for (const [width, height] of [[1280, 800], [375, 812]]) {
      await employee.setViewportSize({ width, height }); await capture(suite, employee, `angular-summary-${width}`);
    }
    await employee.setViewportSize({ width: 1280, height: 800 }); evidence.summary = summary;
  });
  await check('AC6: contact and return edits preserve hold, phase, deadline and review command identity', async () => {
    const before = { reserves: journal.at('/manual/claim').length, reviews: journal.at('/manual/claim/review').length,
      releases: journal.at('/manual/claim/release').length };
    for (const [name, selector, value] of [['Change contact or requirements', '#manual-contact-phone', '07700 900997'],
      ['Change return mileage', '#manual-return-mileage', '20001']]) {
      await employee.locator('[id^="manual-declaration-"]').first().check();
      const edit = button(employee, name); await edit.focus();
      assert.equal(await edit.evaluate(node => node === document.activeElement), true, `${name} receives native keyboard focus`);
      await edit.press('Enter'); await employee.locator(selector).waitFor();
      await employee.locator(selector).fill(value); await saveDetails(employee); await continueReview(employee, 'Return to order review');
      assert.equal(await employee.locator('[id^="manual-declaration-"]:checked').count(), 0, 'Editing details invalidates all declarations');
      const current = good(await suite.call(employee, 'GET', '/manual/claim'), 'Actual retained summary hold');
      assert.equal(current.hold.holdId, summary.hold.holdId); assert.equal(current.hold.expiresAt, summary.hold.expiresAt);
      assert.equal(current.hold.reviewStartedAt, summary.hold.reviewStartedAt); assert.equal(current.hold.phase, 'order-review');
      assert.equal(current.quote.quoteId, summary.quote.quoteId); assert.equal(current.quote.draftVersion, summary.quote.draftVersion);
    }
    assert.deepEqual({ reserves: journal.at('/manual/claim').length, reviews: journal.at('/manual/claim/review').length,
      releases: journal.at('/manual/claim/release').length }, before, 'Detail edits neither release, reserve nor restart review');
  });
  await check('AC1: actual presenter clock operations announce low time and expiry once per hold', async () => {
    await employee.evaluate(() => {
      window.__f554Announcements = [];
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const node = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
          const status = node.closest?.('.gcsp-review-announcement');
          if (status?.textContent.trim()) window.__f554Announcements.push(status.textContent.trim());
        }
      });
      observer.observe(document.querySelector('gcsp-manual-route'), { childList: true, subtree: true, characterData: true });
      window.__f554AnnouncementObserver = observer;
    });
    async function advanceTo(target) {
      const before = good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Actual presenter clock');
      const seconds = (target - Date.parse(before.now)) / 1000; assert.ok(Number.isSafeInteger(seconds) && seconds > 0);
      const details = presenter.getByText('Advanced clock controls', { exact: true });
      if (!await presenter.getByLabel('Seconds', { exact: true }).isVisible()) await details.click();
      await presenter.getByLabel('Seconds', { exact: true }).fill(String(seconds));
      const refreshed = employee.waitForResponse(row => row.request().method() === 'GET' && new URL(row.url()).pathname.endsWith('/manual/claim'));
      await button(presenter, 'Advance clock').click();
      await until(async () => Date.parse(good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Advanced authoritative clock').now) === target,
        'Presenter actually advances the authoritative business clock');
      assert.equal((await refreshed).status(), 200, 'Presenter mutation automatically refreshes the employee claim');
      await settled(employee);
    }
    const low = Date.parse(summary.hold.expiresAt) - summary.quote.timing.reviewSeconds * 250;
    await advanceTo(low);
    const lowClaim = good(await suite.call(employee, 'GET', '/manual/claim'), 'Actual low-time claim'); await timer(employee, lowClaim);
    const spoken = employee.locator('.gcsp-review-announcement');
    await until(async () => /(?:left|remaining|soon|nearly over)/i.test(await spoken.innerText()), 'Low-time announcement is rendered');
    const lowCount = await employee.evaluate(() => window.__f554Announcements.length);
    await refresh(employee); assert.equal(await employee.evaluate(() => window.__f554Announcements.length), lowCount, 'Repeated read does not announce low time twice');
    await advanceTo(Date.parse(summary.hold.expiresAt) + 1000);
    await employee.getByRole('heading', { name: 'Reservation expired', exact: true }).waitFor();
    const expiredCount = await employee.evaluate(() => window.__f554Announcements.length);
    await refresh(employee); assert.equal(await employee.evaluate(() => window.__f554Announcements.length), expiredCount, 'Repeated read does not announce expiry twice');
    evidence.announcements = await employee.evaluate(() => { window.__f554AnnouncementObserver.disconnect(); return window.__f554Announcements; });
    assert.ok(evidence.announcements.some(value => /expired/i.test(value)), 'Expiry is announced, not silently removed');
    await capture(suite, employee, 'angular-expired-1280');
  });
  await check('AC6: Back, Change car and Cancel review send their exact release reasons', async () => {
    for (const [name, reason] of [['Back', 'back'], ['Change car', 'change'], ['Cancel review', 'cancel']]) {
      held = await reserve(); const before = journal.at('/manual/claim/release').length;
      const response = employee.waitForResponse(row => row.request().method() === 'POST' && new URL(row.url()).pathname.endsWith('/manual/claim/release'));
      await button(employee, name).focus(); await button(employee, name).press('Enter'); assert.equal((await response).status(), 200);
      await until(() => journal.at('/manual/claim/release').length === before + 1, 'Exactly one release command');
      const { commandId, ...input } = journal.at('/manual/claim/release').at(-1).body;
      assert.ok(commandId); assert.deepEqual(input, { ...claimCommand(held.claim), reason });
      const claim = good(await suite.call(employee, 'GET', '/manual/claim'), 'Actual released hold');
      assert.equal(claim.state, 'released'); assert.equal(claim.hold.releaseReason, reason);
    }
  });
  await check('AC4/5: one explicit pinned submit, lost acknowledgement reconciles by GET, outcome stages/print/finish', async () => {
    held = await reserve(); await saveDetails(employee); await continueReview(employee);
    summary = good(await suite.call(employee, 'GET', '/manual/claim'), 'Final review claim');
    const details = good(await suite.call(employee, 'GET', '/manual/review-details'), 'Final saved details');
    const terms = good(await suite.call(employee, 'GET', '/manual/order/terms'), 'Actual current declarations');
    for (const field of await employee.locator('[id^="manual-declaration-"]').all()) await field.check();
    assert.equal(await button(employee, 'Submit order').isEnabled(), true);
    const before = journal.at('/manual/order').length;
    await employee.route('**/manual/order', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const actual = await route.fetch(); assert.equal(actual.status(), 200, 'Actual submission is committed before acknowledgement loss');
      await route.abort('failed');
    }, { times: 1 });
    await button(employee, 'Submit order').click(); await employee.getByRole('heading', { name: 'Next steps', exact: true }).waitFor();
    assert.equal(journal.at('/manual/order').length, before + 1, 'One deliberate browser submit, no automatic replay');
    const sent = journal.at('/manual/order').at(-1).body;
    assert.deepEqual(sent.source, { type: 'cart', ...claimCommand(summary) });
    assert.equal(sent.expectedQuoteId, summary.quote.quoteId); assert.equal(sent.expectedStockVersion, details.stockVersion);
    assert.equal(sent.expectedReviewDetailsVersion, details.reviewDetailsVersion); assert.equal(sent.termsDigest, terms.termsDigest);
    assert.deepEqual(Object.keys(sent.declarations).sort(), terms.declarations.filter(row => row.appliesTo === 'all' || row.appliesTo === summary.hold.mode).map(row => row.id).sort());
    assert.ok(Object.values(sent.declarations).every(value => value === true));
    const order = good(await suite.call(employee, 'GET', '/manual/order'), 'Authoritative submitted outcome');
    assert.equal(order.selection.orderUuid, summary.quote.orderUuid); assert.equal(order.selection.quoteId, summary.quote.quoteId);
    assert.ok(await employee.locator('.gcsp-stage-list li').count() > 0); await plain(employee, summary);
    await employee.evaluate(() => { window.__f554Prints = 0; window.print = () => { window.__f554Prints++; }; });
    await button(employee, 'Print order').click(); assert.equal(await employee.evaluate(() => window.__f554Prints), 1, 'Print control invokes printing');
    for (const [width, height] of [[1280, 800], [375, 812]]) {
      await employee.setViewportSize({ width, height }); await capture(suite, employee, `angular-outcome-${width}`);
    }
    await employee.reload({ waitUntil: 'domcontentloaded' }); await button(employee, 'Finish').waitFor();
    assert.equal(journal.at('/manual/order').length, before + 1, 'Returning to a completed outcome never resubmits');
    await button(employee, 'Finish').click(); await employee.waitForURL(url => !url.pathname.includes('/manual/'));
    evidence.order = order; evidence.submitCommand = sent;
  });
  await check('Original AC7 engineering inputs: live frozen review/summary of the same car, choices, details and deadlines', async () => {
    await suite.context.close();
    evidence.angularContextClosedBeforeFrozenReplay = true;
    const initial = evidence.inputs; const chosenId = evidence.preview.quote.orderUuid;
    const replay = await suite.visitFrozenNode({ ...suite.receipt.offer, hold: released.hold, clock: released.clock,
      finalAccount: released.account }, async ({ page, origin, runtime, employee: principal, offer, receipt }) => {
      const selector = { runId: principal.runId, offerId: offer.offerRef?.offerId ?? offer.offerId };
      const entry = sourceGood(await runtime.offerAccess.fromAccount(principal, selector), 'Frozen owned offer');
      const reasons = sourceGood(await runtime.offerDecisions.readReasons(entry.context, selector), 'Frozen decline reasons');
      sourceGood(await runtime.offerDecisions.decide(entry.context, { ...selector, commandId: randomUUID(), decision: 'decline',
        reasonCode: reasons.reasons[0].code, expectedOfferVersion: entry.offer.offerVersion,
        expectedHoldVersion: entry.offer.holdVersion, expectedQuoteVersion: entry.offer.quote.revisions.quote }), 'Frozen actual decline');
      const account = sourceGood(await runtime.manualRead.readAccount(principal), 'Frozen actual account');
      sourceGood(await runtime.manualRead.saveDraft(principal, { commandId: randomUUID(), expectedDraftVersion: 0,
        expectedContextVersion: account.contextVersion, choices: initial.choices }), 'Frozen same choices');
      await page.goto(`${origin}/gcsp-account.html`); await button(page, 'Carry on').click(); await button(page, 'Continue').click();
      const review = page.locator(`.vm-card [data-review-id="${chosenId}"]`); await review.waitFor(); await review.click();
      await page.locator('.gcsp-review-body').waitFor();
      const claim = sourceGood(await runtime.manualClaims.readClaim(principal), 'Frozen actual manual hold');
      assert.equal(claim.quote.orderUuid, chosenId); assert.equal(claim.hold.phase, 'preview');
      assert.equal(Date.parse(claim.hold.expiresAt), Date.parse(evidence.preview.hold.expiresAt), 'Same live preview deadline');
      await capture(suite, page, 'node-review-1280');
      await page.setViewportSize({ width: 375, height: 812 }); await capture(suite, page, 'node-review-375');
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByLabel('Contact phone', { exact: true }).fill(evidence.savedDetails.contact.phone);
      await page.getByLabel('Contact email', { exact: true }).fill(evidence.savedDetails.contact.email);
      await page.getByLabel('Expected returning-car mileage (miles)', { exact: true }).fill(String(evidence.savedDetails.expectedReturnMileage));
      await button(page, 'Save details').click(); await button(page, 'Continue to order review').click();
      await page.locator('.gcsp-summary-body').waitFor();
      const phase = sourceGood(await runtime.manualClaims.readClaim(principal), 'Frozen actual review phase');
      assert.equal(phase.hold.phase, 'order-review');
      assert.equal(Date.parse(phase.hold.expiresAt), Date.parse(evidence.summary.hold.expiresAt), 'Same live order-review deadline');
      await capture(suite, page, 'node-summary-1280');
      await page.setViewportSize({ width: 375, height: 812 }); await capture(suite, page, 'node-summary-375');
      receipt.manualReview = { claim, summary: phase, choices: initial.choices, humanAcceptance: 'pending actual human pair review' };
      return {};
    });
    assert.equal(replay.state, 'matched', 'Frozen live composition actually ran');
  });
  assert.deepEqual(suite.receipt.consoleErrors, [], 'No runtime errors in the checked actual composition');
  suite.receipt.checks.f554 = true;
});
