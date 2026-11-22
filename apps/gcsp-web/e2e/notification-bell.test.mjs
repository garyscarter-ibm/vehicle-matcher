import assert from 'node:assert/strict';
import test from 'node:test';
import { startComposition } from './composition.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  assert.fail(message);
}
const activityRequests = (suite, label = 'employee') => suite.receipt.requests.filter((row) => row.page === label
  && row.method === 'GET' && row.path === '/activity' && row.status === 200);
const bell = (page) => page.getByRole('button', { name: /^Notifications,/ });
const panel = (page) => page.locator('.gcsp-bell-panel');
const isOpen = (page) => bell(page).getAttribute('aria-expanded');

test('FUCQ-548: employee bell follows actual Java offers on the started signed-in composition', { timeout: 480000 }, async (t) => {
  const suite = await startComposition();
  t.after(() => suite.close());
  const employee = await suite.newPage('employee', 'demo-paula', 'account');
  const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
  let offer;
  let activeRows;

  await t.test('AC1/2: initial empty state and employee header placement', async () => {
    await bell(employee).waitFor({ state: 'visible' });
    await until(async () => await bell(employee).getAttribute('aria-label') === 'Notifications, none waiting', 'The initial badge must be empty');
    const account = employee.getByLabel('Account details', { exact: true });
    const [bellBox, accountBox] = await Promise.all([bell(employee).boundingBox(), account.boundingBox()]);
    assert.ok(bellBox && accountBox && bellBox.x + bellBox.width <= accountBox.x + 1, 'The bell is left of the account menu');
    assert.ok(bellBox.width >= 44 && bellBox.height >= 44, 'The bell has a usable target');
    await bell(employee).click();
    await panel(employee).getByText('No notifications yet.', { exact: true }).waitFor();
    await suite.screenshot(employee, 'empty-1280');
    await employee.keyboard.press('Escape');
    assert.equal(await isOpen(employee), 'false');
    assert.equal(await bell(employee).evaluate((node) => document.activeElement === node), true);
    assert.equal(await employee.locator('.gcsp-bell-note').isVisible(), false, 'First read has no new-offer note');
    suite.receipt.checks.empty = true;
  });

  await t.test('AC2/3/4: exact initial input, real release/allocation and one-off new-offer note', async () => {
    const catalogue = await suite.call(presenter, 'GET', '/presenter/scenarios');
    assert.equal(catalogue.status, 200);
    const main = catalogue.body.value.scenarios.find((item) => item.scenarioId === 'main-successful-journey');
    assert.ok(main, 'The canonical Main input remains identifiable');
    suite.receipt.namedReset = { observedAvailability: main.availability.available, bug: 'FUCQ-562',
      missingCapabilities: main.availability.missingCapabilities, used: false,
      setup: 'Explicit immutable initial-input fixture; no successful named-reset claim' };
    await suite.prepareInitialBrief(employee, presenter);
    // Establish a successful searching read before the first offer; no rows/counts are supplied by the test.
    let before = activityRequests(suite).length;
    await employee.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await until(() => activityRequests(suite).length > before, 'Initial source reread reaches Java');
    let actionAt = Date.now();
    before = activityRequests(suite).length;
    await presenter.getByRole('button', { name: 'Next release', exact: true }).click();
    await until(() => activityRequests(suite).length > before, 'Presenter action must cause an employee activity read', 8000);
    let clock = await suite.call(presenter, 'GET', '/presenter/controls');
    assert.equal(clock.status, 200);
    const target = suite.input.clock.nextRelease.at;
    if (Date.parse(clock.body.value.now) < Date.parse(target)) {
      const stepSeconds = clock.body.value.controls.step.value;
      const seconds = (Date.parse(target) - Date.parse(clock.body.value.now)) / 1000 - stepSeconds;
      assert.ok(Number.isSafeInteger(seconds) && seconds > 0);
      await presenter.getByText('Advanced clock controls', { exact: true }).click();
      await presenter.getByLabel('Seconds', { exact: true }).fill(String(seconds));
      await presenter.getByRole('button', { name: 'Advance clock', exact: true }).click();
      await until(async () => {
        const state = await suite.call(presenter, 'GET', '/presenter/clock');
        return Date.parse(state.body.value.now) === Date.parse(target) - stepSeconds * 1000;
      }, 'The public Advanced clock reaches the retained generated window minus one step');
      before = activityRequests(suite).length;
      actionAt = Date.now();
      await presenter.getByRole('button', { name: /^Step \d+ seconds$/ }).click();
      await until(() => activityRequests(suite).length > before, 'The real tick refresh reaches employee activity', 8000);
      clock = await suite.call(presenter, 'GET', '/presenter/controls');
      suite.receipt.releaseSetupDifference = { namedCue: suite.input.clock.namedTimes.release, actualGeneratedTarget: target,
        extraPublicAdvanceSeconds: seconds, tickStepSeconds: stepSeconds,
        reason: 'Java Next release uses namedTimes.release; frozen generated Node uses its actual planned windows.' };
    }
    assert.equal(clock.body.value.now, target, 'Release/allocation uses the exact frozen generated instant');
    await until(async () => await bell(employee).getAttribute('aria-label') === 'Notifications, 1 car offer waiting', 'Real allocation must yield one waiting offer', 12000);
    assert.ok(activityRequests(suite).at(-1).at - actionAt < 8000, 'Presenter notification refresh happens before the next 30s poll');
    await employee.locator('.gcsp-bell-note').getByText('Your buddy found a car', { exact: true }).waitFor({ state: 'visible' });
    const raw = await suite.call(employee, 'GET', '/activity');
    assert.equal(raw.status, 200);
    offer = raw.body.value.currentOffer;
    assert.equal(offer.state, 'active');
    assert.ok(offer.orderUuid && offer.offerRef?.offerId && offer.expiresAt);
    const sourceCars = suite.plan.windows.flatMap((window) => window.stock);
    assert.ok(sourceCars.some((car) => car.orderUuid === offer.orderUuid), 'The held car comes from the exact retained Node input');
    suite.receipt.offer = { orderUuid: offer.orderUuid, offerId: offer.offerRef.offerId, state: offer.state, expiresAt: offer.expiresAt };
    await suite.screenshot(employee, 'new-offer-note-1280');
    await bell(employee).click();
    await panel(employee).getByRole('heading', { name: 'Notifications', exact: true }).waitFor();
    await panel(employee).getByText('Your buddy found a car', { exact: true }).waitFor();
    assert.match(await panel(employee).innerText(), /Reserved for you\. Respond by \d{2}:\d{2}\./);
    const image = panel(employee).locator('img.gcsp-bell-thumb');
    await image.waitFor();
    await until(() => image.evaluate((node) => node.complete && node.naturalWidth > 0), 'The real offer thumbnail must load');
    const href = await panel(employee).getByRole('link', { name: 'View your offer', exact: true }).getAttribute('href');
    assert.ok(href.includes(encodeURIComponent(offer.offerRef.offerId)) || href.includes(offer.offerRef.offerId));
    activeRows = await panel(employee).locator('.gcsp-bell-row').count();
    assert.ok(activeRows >= 1 && activeRows <= 6, 'Notification projection is bounded');
    const badgeColor = await employee.locator('.gcsp-bell-badge').evaluate((node) => getComputedStyle(node).backgroundColor);
    const channels = badgeColor.match(/[\d.]+/g)?.map(Number);
    assert.ok(channels && channels[0] > channels[1] * 1.5 && channels[0] > channels[2] * 1.5, 'The waiting-count badge is red');
    await suite.screenshot(employee, 'active-open-1280');
    suite.receipt.activePanel = { car: await panel(employee).locator('.gcsp-bell-copy p').nth(1).innerText(),
      detail: await panel(employee).locator('.gcsp-bell-muted').innerText(), image: await image.getAttribute('src') };
    await suite.compareFrozenNode({ ...suite.receipt.offer, panel: suite.receipt.activePanel });
    await employee.keyboard.press('Escape');
    await delay(6500);
    assert.equal(await employee.locator('.gcsp-bell-note').isVisible(), false);
    before = activityRequests(suite).length;
    await employee.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await until(() => activityRequests(suite).length > before, 'New offer reread reaches Java');
    assert.equal(await employee.locator('.gcsp-bell-note').isVisible(), false, 'The same offer is not announced again');
    suite.receipt.checks.realOfferAndOneOffNote = true;
  });

  await t.test('AC1/5: keyboard, account disclosure, outside close, narrow layout and offer navigation preserve count', async () => {
    await employee.getByLabel('Account details', { exact: true }).click();
    assert.equal(await employee.locator('.gcsp-account-details').getAttribute('open'), '');
    await bell(employee).focus(); await employee.keyboard.press('Enter');
    assert.equal(await isOpen(employee), 'true');
    assert.equal(await employee.locator('.gcsp-account-details').getAttribute('open'), null, 'Opening the bell closes the account disclosure');
    await employee.keyboard.press('Escape');
    assert.equal(await bell(employee).evaluate((node) => document.activeElement === node), true);
    await bell(employee).click();
    const outside = employee.getByRole('heading', { level: 1 }).first();
    await outside.focus(); await outside.click();
    assert.equal(await isOpen(employee), 'false', 'Outside click closes the panel');
    assert.equal(await outside.evaluate((node) => document.activeElement === node), true, 'Outside close preserves deliberate outside focus');
    assert.equal(await bell(employee).getAttribute('aria-label'), 'Notifications, 1 car offer waiting');
    await employee.setViewportSize({ width: 375, height: 812 });
    await bell(employee).click();
    const box = await panel(employee).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 376, 'The narrow panel fits the viewport');
    assert.equal(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The header adds no narrow horizontal overflow');
    await suite.screenshot(employee, 'active-open-375');
    await panel(employee).getByRole('link', { name: 'View your offer', exact: true }).click();
    await employee.waitForURL((url) => url.pathname.includes('/gcsp/offers/'));
    await bell(employee).waitFor();
    assert.equal(await bell(employee).getAttribute('aria-label'), 'Notifications, 1 car offer waiting', 'Opening the actual offer does not clear the count');
    await suite.screenshot(employee, 'offer-count-preserved-375');
    await employee.setViewportSize({ width: 1280, height: 800 });
    await employee.goto(`${suite.origins.web}/gcsp/account`);
    await bell(employee).waitFor();
    suite.receipt.checks.keyboardNarrowAndCount = true;
  });

  await t.test('AC4: actual interval requests, visibility handler and restored-page handler', async () => {
    // Two consecutive automatic reads establish the real 30s interval without changing timers.
    const start = activityRequests(suite).length;
    await until(() => activityRequests(suite).length >= start + 2, 'Two automatic activity polls must complete', 65000);
    const polls = activityRequests(suite).slice(-2);
    const elapsed = polls[1].at - polls[0].at;
    assert.ok(elapsed >= 28500 && elapsed <= 33000, `Real polling interval was ${elapsed}ms`);
    suite.receipt.polling = { elapsedMs: elapsed, requests: polls };
    const other = await suite.context.newPage();
    await other.goto('about:blank');
    const observedVisibility = await employee.evaluate(() => document.visibilityState);
    await other.close();
    let before = activityRequests(suite).length;
    await employee.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await until(() => activityRequests(suite).length > before, 'Visibility handler must make a real activity request');
    suite.receipt.visibility = { observedWhileOtherHeadlessPageExists: observedVisibility,
      evidence: 'Synthetic visible-document event; real Java request. No claim of an actual hidden-to-visible transition.' };
    await employee.addInitScript(() => {
      window.__gcspE2ePageShows = [];
      addEventListener('pageshow', (event) => window.__gcspE2ePageShows.push({ persisted: event.persisted }));
    });
    await employee.goto(`${suite.origins.web}/gcsp/activity`);
    await bell(employee).waitFor();
    await employee.goBack();
    await bell(employee).waitFor();
    const shows = await employee.evaluate(() => window.__gcspE2ePageShows ?? []);
    before = activityRequests(suite).length;
    await employee.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await until(() => activityRequests(suite).length > before, 'Persisted-pageshow handler must make a real activity request');
    suite.receipt.pageshow = { actualHistoryNavigation: shows, handler: 'Synthetic persisted pageshow; real Java request',
      actualBFCacheRestore: shows.some((event) => event.persisted) };
    suite.receipt.checks.refreshTriggers = true;
  });

  await t.test('AC2/5: actual expiry yields an expired-offer row and clears the waiting count', async () => {
    const clock = await suite.call(presenter, 'GET', '/presenter/clock');
    assert.equal(clock.status, 200);
    const seconds = Math.ceil((Date.parse(offer.expiresAt) - Date.parse(clock.body.value.now)) / 1000) + 60;
    assert.ok(seconds > 0);
    const advanced = presenter.locator('details').filter({ has: presenter.getByText('Advanced clock controls', { exact: true }) });
    if (!await advanced.evaluate((node) => node.open)) await advanced.locator('summary').click();
    await presenter.getByLabel('Seconds', { exact: true }).fill(String(seconds));
    await presenter.getByRole('button', { name: 'Advance clock', exact: true }).click();
    await until(async () => {
      const state = await suite.call(presenter, 'GET', '/presenter/clock');
      return Date.parse(state.body.value.now) > Date.parse(offer.expiresAt);
    }, 'Presenter clock advance is real');
    // Tick actual lifecycle handlers; display-only expiry is not enough to call the durable offer expired.
    await presenter.getByRole('button', { name: /^Step \d+ seconds$/ }).click();
    await until(async () => await bell(employee).getAttribute('aria-label') === 'Notifications, none waiting', 'The expired offer must leave the waiting count', 12000);
    await bell(employee).click();
    await panel(employee).getByRole('link', { name: 'View expired offer', exact: true }).waitFor();
    assert.ok(await panel(employee).locator('.gcsp-bell-row').count() <= 6);
    const expired = await suite.call(employee, 'GET', '/activity');
    const prior = expired.body.value.offers.find((row) => row.offerRef.offerId === offer.offerRef.offerId);
    assert.equal(prior.state, 'expired', 'The real service expired the offer');
    await suite.screenshot(employee, 'expired-open-1280');
    await employee.setViewportSize({ width: 375, height: 812 });
    await suite.screenshot(employee, 'expired-open-375');
    assert.deepEqual(suite.receipt.consoleErrors, [], 'No app runtime errors on the checked flow');
    suite.receipt.checks.expiry = true;
  });
});
