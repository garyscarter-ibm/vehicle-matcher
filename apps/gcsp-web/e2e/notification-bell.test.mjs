import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { showAdvanced, startComposition } from './composition.mjs';

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
const waitOpen = (page, open) => until(async () => await isOpen(page) === String(open),
  `The actual bell disclosure must render ${open ? 'open' : 'closed'}`);
async function insideViewport(page, locator, label) {
  const box = await locator.boundingBox(); const viewport = page.viewportSize();
  assert.ok(box, `${label} must be rendered`);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `${label} must fit ${viewport.width}×${viewport.height}: ${JSON.stringify(box)}`);
  return box;
}
async function captureViewport(suite, page, name) {
  const output = process.env.GCSP_E2E_OUTPUT;
  assert.ok(output, 'The registered FUCQ-548 runner supplies its output directory');
  const destination = path.join(output, `${name}.png`);
  await page.screenshot({ path: destination, fullPage: false });
  suite.receipt.screenshots.push({ name, path: destination, viewport: page.viewportSize(), fullPage: false });
}

test('FUCQ-548: employee bell follows actual Java offers on the started signed-in composition', { timeout: 480000 }, async (t) => {
  const suite = await startComposition();
  t.after(() => suite.close());
  const employee = await suite.newPage('employee', 'demo-paula', 'account');
  const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
  let offer;
  let offerRunId;
  let offerHref;
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
    await waitOpen(employee, false);
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
    await showAdvanced(presenter);
    await presenter.getByRole('button', { name: 'Next release', exact: true }).click();
    await until(() => activityRequests(suite).length > before, 'Presenter action must cause an employee activity read', 8000);
    let clock = await suite.call(presenter, 'GET', '/presenter/controls');
    assert.equal(clock.status, 200);
    const target = suite.input.clock.nextRelease.at;
    const clockActions = [{ action: 'Next release', observedNow: clock.body.value.now, clockVersion: clock.body.value.clockVersion }];
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
      clockActions.push({ action: 'Advanced clock advance', seconds }, { action: 'Step and tick', seconds: stepSeconds });
      suite.receipt.releaseSetupDifference = { namedCue: suite.input.clock.namedTimes.release, actualGeneratedTarget: target,
        extraPublicAdvanceSeconds: seconds, tickStepSeconds: stepSeconds,
        reason: 'Java Next release uses namedTimes.release; frozen generated Node uses its actual planned windows.' };
    }
    assert.equal(clock.body.value.now, target, 'Release/allocation uses the exact frozen generated instant');
    suite.receipt.actualReleaseClock = { now: clock.body.value.now, clockVersion: clock.body.value.clockVersion, actions: clockActions };
    await until(async () => await bell(employee).getAttribute('aria-label') === 'Notifications, 1 car offer waiting', 'Real allocation must yield one waiting offer', 12000);
    assert.ok(activityRequests(suite).at(-1).at - actionAt < 8000, 'Presenter notification refresh happens before the next 30s poll');
    await employee.locator('.gcsp-bell-note').getByText('Your buddy found a car', { exact: true }).waitFor({ state: 'visible' });
    const raw = await suite.call(employee, 'GET', '/activity');
    assert.equal(raw.status, 200);
    offer = raw.body.value.currentOffer;
    offerRunId = raw.body.value.runId;
    assert.equal(offer.state, 'active');
    assert.ok(offer.orderUuid && offer.offerRef?.offerId && offer.expiresAt);
    assert.ok(typeof offerRunId === 'string' && offerRunId.length > 0);
    offerHref = `/gcsp/offers/${encodeURIComponent(offer.offerRef.offerId)}?runId=${encodeURIComponent(offerRunId)}`;
    const sourceCars = suite.plan.windows.flatMap((window) => window.stock);
    assert.ok(sourceCars.some((car) => car.orderUuid === offer.orderUuid), 'The held car comes from the exact retained Node input');
    suite.receipt.offer = { orderUuid: offer.orderUuid, offerId: offer.offerRef.offerId, state: offer.state, expiresAt: offer.expiresAt };
    suite.readActualHold(offer);
    const accountName = employee.locator('.gcsp-account-name');
    const actualAccountName = await accountName.textContent();
    const stressAccountName = 'Alexandra Cartwright-Llewellyn';
    const noteViews = [];
    let noteFailure;
    try {
      await accountName.evaluate((node, value) => { node.textContent = value; }, stressAccountName);
      const note = employee.locator('.gcsp-bell-note');
      const desktopNote = await note.boundingBox(); const desktopBell = await employee.locator('.gcsp-bell').boundingBox();
      assert.ok(desktopNote && desktopBell && Math.abs(desktopNote.x + desktopNote.width - desktopBell.x - desktopBell.width - 8) <= 1,
        'F566 preserves desktop note placement beside the bell');
      await captureViewport(suite, employee, 'f566-note-1280');
      noteViews.push({ width: 1280, note: desktopNote });
      for (const width of [375, 390]) {
        await employee.setViewportSize({ width, height: 812 });
        await note.waitFor({ state: 'visible' });
        const noteBox = await insideViewport(employee, note, `F566 ${width}px one-off note`);
        const titleBox = await insideViewport(employee, note.locator('strong'), `F566 ${width}px note title`);
        const textBox = await insideViewport(employee, note.locator('span'), `F566 ${width}px note text`);
        assert.equal(await note.locator('strong').innerText(), 'Your buddy found a car');
        assert.match(await note.locator('span').innerText(), /BMW X2 M35i in Black Sapphire/);
        await captureViewport(suite, employee, `f566-note-${width}`);
        noteViews.push({ width, note: noteBox, title: titleBox, text: textBox });
      }
    } catch (error) {
      noteFailure = error;
    } finally {
      await accountName.evaluate((node, value) => { node.textContent = value; }, actualAccountName);
      await employee.setViewportSize({ width: 1280, height: 800 });
    }
    suite.receipt.f566Responsive = { accountNameStress: stressAccountName, noteViews };
    await suite.screenshot(employee, 'new-offer-note-1280');
    await bell(employee).click();
    await panel(employee).getByRole('heading', { name: 'Notifications', exact: true }).waitFor();
    await panel(employee).getByText('Your buddy found a car', { exact: true }).waitFor();
    assert.match(await panel(employee).innerText(), /Reserved for you\. Respond by \d{2}:\d{2}\./);
    const image = panel(employee).locator('img.gcsp-bell-thumb');
    await image.waitFor();
    await until(() => image.evaluate((node) => node.complete && node.naturalWidth > 0), 'The real offer thumbnail must load');
    const href = await panel(employee).getByRole('link', { name: 'View your offer', exact: true }).getAttribute('href');
    assert.equal(href, offerHref, 'The bell retains the exact encoded current-offer identity and run context');
    activeRows = await panel(employee).locator('.gcsp-bell-row').count();
    assert.ok(activeRows >= 1 && activeRows <= 6, 'Notification projection is bounded');
    const badgeColor = await employee.locator('.gcsp-bell-badge').evaluate((node) => getComputedStyle(node).backgroundColor);
    const channels = badgeColor.match(/[\d.]+/g)?.map(Number);
    assert.ok(channels && channels[0] > channels[1] * 1.5 && channels[0] > channels[2] * 1.5, 'The waiting-count badge is red');
    await suite.screenshot(employee, 'active-open-1280');
    suite.receipt.activePanel = { car: await panel(employee).locator('.gcsp-bell-copy p').nth(1).innerText(),
      detail: await panel(employee).locator('.gcsp-bell-muted').innerText(), image: await image.getAttribute('src'),
      imageEvidence: await suite.readImage(employee, image) };
    await employee.keyboard.press('Escape');
    await delay(6500);
    assert.equal(await employee.locator('.gcsp-bell-note').isVisible(), false);
    before = activityRequests(suite).length;
    await employee.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await until(() => activityRequests(suite).length > before, 'New offer reread reaches Java');
    assert.equal(await employee.locator('.gcsp-bell-note').isVisible(), false, 'The same offer is not announced again');
    suite.receipt.checks.realOfferAndOneOffNote = true;
    if (noteFailure) throw noteFailure;
  });

  await t.test('AC1/5: keyboard, account disclosure, outside close, narrow layout and offer navigation preserve count', async (caseContext) => {
    if (!offer) { caseContext.skip('Offer setup failed; keyboard/narrow/count behavior remains unrun'); return; }
    await employee.getByLabel('Account details', { exact: true }).click();
    await until(async () => await employee.locator('.gcsp-account-details').getAttribute('open') === '', 'The account disclosure opens');
    await bell(employee).focus(); await employee.keyboard.press('Enter');
    await waitOpen(employee, true);
    await until(async () => await employee.locator('.gcsp-account-details').getAttribute('open') === null, 'Opening the bell closes the account disclosure');
    await employee.keyboard.press('Escape');
    await waitOpen(employee, false);
    assert.equal(await bell(employee).evaluate((node) => document.activeElement === node), true);
    await bell(employee).click();
    const outside = employee.getByRole('heading', { level: 1 }).first();
    await outside.focus(); await outside.click();
    await waitOpen(employee, false);
    assert.equal(await outside.evaluate((node) => document.activeElement === node), true, 'Outside close preserves deliberate outside focus');
    assert.equal(await bell(employee).getAttribute('aria-label'), 'Notifications, 1 car offer waiting');
    await employee.setViewportSize({ width: 375, height: 812 });
    await bell(employee).click();
    await waitOpen(employee, true);
    const box = await panel(employee).boundingBox();
    suite.receipt.narrowGeometry = { box, viewport: employee.viewportSize(), actual: await panel(employee).evaluate((node) => {
      const css = getComputedStyle(node); const bell = node.closest('.gcsp-bell'); const header = node.closest('header');
      const style = (item) => { const value = getComputedStyle(item); const rect = item.getBoundingClientRect();
        return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, position: value.position,
          width: value.width, right: value.right, padding: value.padding, gap: value.gap, overflowX: value.overflowX }; };
      return { panel: style(node), bell: style(bell), header: style(header), hidden: node.hidden,
        expanded: bell.querySelector('button').getAttribute('aria-expanded'),
        innerWidth, scrollWidth: document.documentElement.scrollWidth,
        tokens: { space4: css.getPropertyValue('--gcsp-space-4'), headerHeight: css.getPropertyValue('--gcsp-header-height') } };
    }) };
    await suite.screenshot(employee, 'active-open-375');
    suite.receipt.narrowGeometry.baselineAssessment = { bug: 'FUCQ-566', contained: !!box && box.x >= 0 && box.x + box.width <= 376,
      origin: 'FUCQ-375; frozen Node has the same off-left panel and right:-44px rule.',
      scope: 'Separate Medium baseline Bug; original F548 keyboard, navigation and count checks continue without a new containment gate.' };
    await suite.compareFrozenNode({ ...suite.receipt.offer, hold: suite.receipt.actualHold.semantic, panel: suite.receipt.activePanel,
      clock: suite.receipt.actualReleaseClock });
    assert.equal(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The header adds no narrow horizontal overflow');
    const offerResponse = employee.waitForResponse((response) => response.request().method() === 'GET'
      && response.url() === `${suite.apiBase}/offers/${encodeURIComponent(offer.offerRef.offerId)}?runId=${encodeURIComponent(offerRunId)}`);
    await panel(employee).getByRole('link', { name: 'View your offer', exact: true }).click();
    const target = new URL(offerHref, suite.origins.web);
    const opensExactOffer = (url) => {
      // Angular canonicalizes characters such as colon; decode only the owned final segment.
      const segments = url.pathname.split('/');
      return url.origin === target.origin && segments.length === 4 && segments[0] === ''
        && segments[1] === 'gcsp' && segments[2] === 'offers'
        && decodeURIComponent(segments[3]) === offer.offerRef.offerId
        && url.search === target.search && url.hash === target.hash;
    };
    await employee.waitForURL(opensExactOffer);
    assert.ok(opensExactOffer(new URL(employee.url())), `The bell opens the exact owned offer route: ${employee.url()}`);
    const loadedResponse = await offerResponse;
    assert.equal(loadedResponse.status(), 200);
    const loaded = await loadedResponse.json();
    assert.equal(loaded.status, 'ok');
    assert.equal(loaded.value.offerId, offer.offerRef.offerId);
    assert.equal(loaded.value.runId, offerRunId);
    assert.equal(loaded.value.quote.orderUuid, offer.orderUuid, 'The opened offer retains its actual held car');
    suite.receipt.offerNavigation = { href: employee.url(), offerId: loaded.value.offerId,
      runId: loaded.value.runId, orderUuid: loaded.value.quote.orderUuid };
    await bell(employee).waitFor();
    await until(async () => await bell(employee).getAttribute('aria-label') === 'Notifications, 1 car offer waiting', 'Opening the actual offer does not clear the count');
    await suite.screenshot(employee, 'offer-count-preserved-375');
    await employee.setViewportSize({ width: 1280, height: 800 });
    await employee.goto(`${suite.origins.web}/gcsp/account`);
    await bell(employee).waitFor();
    suite.receipt.checks.keyboardNarrowAndCount = true;
    const accountName = employee.locator('.gcsp-account-name');
    const actualAccountName = await accountName.textContent();
    const stressAccountName = 'Alexandra Cartwright-Llewellyn';
    const panelViews = [];
    try {
      await accountName.evaluate((node, value) => { node.textContent = value; }, stressAccountName);
      await bell(employee).click();
      await waitOpen(employee, true);
      const heading = panel(employee).getByRole('heading', { name: 'Notifications', exact: true });
      const image = panel(employee).locator('img.gcsp-bell-thumb');
      const car = panel(employee).locator('.gcsp-bell-copy p').nth(1);
      const action = panel(employee).getByRole('link', { name: 'View your offer', exact: true });
      for (const width of [1280, 375, 390]) {
        if (width !== 1280) await employee.setViewportSize({ width, height: 812 });
        const panelBox = await insideViewport(employee, panel(employee), `F566 ${width}px open panel`);
        const headingBox = await insideViewport(employee, heading, `F566 ${width}px heading`);
        const imageBox = await insideViewport(employee, image, `F566 ${width}px offer image`);
        const carBox = await insideViewport(employee, car, `F566 ${width}px exact car`);
        const actionBox = await insideViewport(employee, action, `F566 ${width}px primary action`);
        assert.equal(await heading.innerText(), 'Notifications');
        assert.equal((await car.innerText()).trim(), 'BMW X2 M35i in Black Sapphire');
        assert.equal(await action.innerText(), 'View your offer');
        assert.equal(await image.evaluate((node) => node.complete && node.naturalWidth > 0), true);
        if (width === 1280) {
          const bellBox = await employee.locator('.gcsp-bell').boundingBox();
          assert.ok(bellBox && Math.abs(panelBox.x + panelBox.width - bellBox.x - bellBox.width - 8) <= 1,
            'F566 preserves desktop panel placement beside the bell');
        }
        await captureViewport(suite, employee, `f566-panel-${width}`);
        panelViews.push({ width, panel: panelBox, heading: headingBox, image: imageBox, car: carBox, action: actionBox });
      }
      suite.receipt.f566Responsive = { ...(suite.receipt.f566Responsive ?? {}), accountNameStress: stressAccountName, panelViews };
    } finally {
      await accountName.evaluate((node, value) => { node.textContent = value; }, actualAccountName);
      await employee.setViewportSize({ width: 1280, height: 800 });
      if (await isOpen(employee) === 'true') await bell(employee).click();
    }
  });

  await t.test('AC4: actual interval requests, visibility handler and restored-page handler', async () => {
    // Bell and Account are independent real consumers. A timer event can cause more than one read.
    const start = activityRequests(suite).length;
    const bursts = () => activityRequests(suite).slice(start).reduce((groups, request) => {
      const last = groups.at(-1);
      if (last && request.at - last.requests.at(-1).at <= 1000) last.requests.push(request);
      else groups.push({ at: request.at, requests: [request] });
      return groups;
    }, []);
    try { await until(() => bursts().length >= 2, 'Two distinct automatic activity poll bursts must complete', 65000); }
    finally { suite.receipt.polling = { requests: activityRequests(suite).slice(start), bursts: bursts(),
      grouping: 'Requests within 1000ms belong to one observed burst; no timers or independent consumers changed.' }; }
    const polls = suite.receipt.polling.bursts;
    const elapsed = polls[1].at - polls[0].at;
    suite.receipt.polling.elapsedMs = elapsed;
    assert.ok(elapsed >= 28500 && elapsed <= 33000, `Real polling interval was ${elapsed}ms`);
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

  await t.test('AC2/5: actual expiry yields an expired-offer row and clears the waiting count', async (caseContext) => {
    if (!offer) { caseContext.skip('Offer setup failed; actual expiry remains unrun'); return; }
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
