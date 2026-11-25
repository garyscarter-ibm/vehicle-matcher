import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { startComposition } from './composition.mjs';
import { assertImageParity } from './node-replay.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  assert.fail(message);
}

async function noInternals(page) {
  const copy = await page.locator('.gcsp-console').innerText();
  assert.doesNotMatch(copy, /\bRun id\b|\bClock version\b|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/i,
    'Visible presenter copy uses friendly time and hides internal identifiers');
  assert.equal(await page.getByRole('link', { name: 'Open the portal', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /Switch principal|Reset and switch to Greg/ }).count(), 0);
}

async function fits(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth }));
  assert.ok(size.body <= size.width + 1, `The ${size.width}px presenter page must fit its viewport`);
}

const aggregate = (value) => ({
  counts: Object.fromEntries(['released', 'totalReleased', 'onScheme', 'buddyAllocated', 'manuallyAllocated']
    .map((key) => [key, value.counts?.[key]])),
  allocation: value.allocation,
  cars: value.cars.map(({ id, modelName, colourName }) => ({ id, modelName, colourName }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  modelLines: value.modelLines,
  charts: value.charts,
});

test('FUCQ-561: presenter console follows the actual signed-in release, inspection, mail and Main reset',
  { timeout: 480000 }, async (t) => {
    const suite = await startComposition({ caseId: 'f561' });
    t.after(() => suite.close());
    const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
    let employee;
    let released;
    let latest;
    let angularImage;
    let main;
    async function resetMain() {
      const before = (await suite.call(presenter, 'GET', '/presenter/controls')).body.value;
      await presenter.getByRole('button', { name: 'Start again', exact: true }).click();
      await presenter.getByRole('group', { name: 'Start again?', exact: true })
        .getByRole('button', { name: 'Confirm', exact: true }).click();
      let clock;
      await until(async () => {
        const read = await suite.call(presenter, 'GET', '/presenter/controls');
        const current = await suite.call(presenter, 'GET', '/presenter/scenarios/current');
        clock = read.body.value;
        return read.status === 200 && current.status === 200 && clock.runId !== before.runId
          && current.body.value.runId === clock.runId && current.body.value.currentScenario?.scenarioId === 'main-successful-journey';
      }, 'The actual public reset must prepare and activate Main', 30000);
      return clock;
    }

    await t.test('AC1/5: Basic starts with one headline, a guarded restart and friendly copy', async () => {
      await presenter.locator('.gcsp-console h1').waitFor();
      assert.equal(await presenter.getByRole('button', { name: 'Advanced', exact: true }).getAttribute('aria-pressed'), 'false');
      assert.equal(await presenter.locator('.gcsp-console h1').count(), 1);
      await presenter.getByRole('button', { name: 'Start again', exact: true }).click();
      const confirmation = presenter.getByRole('group', { name: 'Start again?', exact: true });
      await confirmation.getByText('Day 1, cars cleared. Preferences kept.', { exact: true }).waitFor();
      assert.equal(await confirmation.getByRole('button', { name: 'Confirm', exact: true })
        .evaluate((node) => node === document.activeElement), true);
      await presenter.setViewportSize({ width: 375, height: 812 });
      await fits(presenter);
      await suite.screenshot(presenter, 'presenter-confirmation-375');
      const before = await suite.call(presenter, 'GET', '/presenter/controls');
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal((await suite.call(presenter, 'GET', '/presenter/controls')).body.value.runId, before.body.value.runId);
      assert.equal(await presenter.getByRole('button', { name: 'Start again', exact: true })
        .evaluate((node) => node === document.activeElement), true);
      await presenter.setViewportSize({ width: 1280, height: 800 });
      await noInternals(presenter);
      const initialClock = await resetMain();
      await presenter.getByRole('heading', { name: 'Ready for the next release', exact: true }).waitFor();
      assert.equal(await presenter.locator('.gcsp-console-week li').count(), 7);
      const catalogue = await suite.call(presenter, 'GET', '/presenter/scenarios');
      assert.equal(catalogue.status, 200);
      const scenario = catalogue.body.value.scenarios.find((item) => item.scenarioId === 'main-successful-journey');
      assert.equal(scenario.availability.available, true);
      assert.equal(initialClock.controls.nextRelease.status, 'available', 'The actual local Main reset supplies its release cue');
      assert.ok(Date.parse(initialClock.controls.nextRelease.at) > Date.parse(initialClock.now));
      employee = await suite.newPage('employee', 'demo-paula', 'account');
      const [brief, context] = await Promise.all([suite.call(employee, 'GET', '/brief'), suite.call(employee, 'GET', '/context')]);
      assert.equal(brief.status, 200); assert.equal(context.status, 200);
      assert.equal(brief.body.value.brief.status, 'confirmed');
      assert.equal(context.body.value.runId, initialClock.runId);
      main = { initialClock, scenario, brief: brief.body.value.brief, context: context.body.value };
      suite.receipt.presenterMain = main;
      suite.receipt.checks.basic = { confirmation: true, cancelPreservesRun: true, keyboardFocus: true,
        actualPublicMainReset: true, legacyReplayFixtureRetired: true, hosted: 'unrun; this is the owned local composition' };
    });

    await t.test('AC2: actual release populates the day bar, cars, charts and allocation totals', async () => {
      const primary = presenter.getByRole('button', { name: /^Release (?:tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday)'s cars$/ });
      await primary.waitFor({ state: 'visible' });
      await primary.click();
      let finalClock;
      await until(async () => {
        const read = await suite.call(presenter, 'GET', '/presenter/controls');
        finalClock = read.body.value;
        return read.status === 200 && Number(finalClock.clockVersion) > Number(main.initialClock.clockVersion);
      }, 'The actual Basic release button advances and ticks Java');
      assert.ok(Date.parse(finalClock.now) > Date.parse(main.initialClock.now));
      released = { clock: { now: finalClock.now, clockVersion: finalClock.clockVersion } };
      const read = await suite.call(presenter, 'GET', '/presenter/releases/latest');
      assert.equal(read.status, 200);
      latest = read.body.value;
      assert.ok(latest.release && latest.cars?.length > 0, 'The real presenter projection must supply the released cars');
      for (const value of Object.values(aggregate(latest).counts)) assert.ok(Number.isSafeInteger(value) && value >= 0);
      assert.equal(latest.counts.released, latest.cars.length);
      assert.equal(latest.counts.totalReleased,
        latest.counts.onScheme + latest.counts.buddyAllocated + latest.counts.manuallyAllocated);
      for (const key of ['pending', 'declined', 'accepted']) assert.ok(Number.isSafeInteger(latest.allocation?.[key]));
      assert.ok(latest.allocation.pending > 0, 'The actual active offer is counted as pending');
      await presenter.getByRole('heading', {
        name: `${latest.counts.released} ${latest.counts.released === 1 ? 'car' : 'cars'} released`, exact: true,
      }).waitFor();
      await presenter.getByRole('heading', { name: "Today's release", exact: true }).waitFor();
      await until(async () => await presenter.locator('.gcsp-release-grid [role=gridcell]').count() === latest.cars.length,
        'The grid must render every car from the authoritative release, including image fallbacks');
      assert.deepEqual((await presenter.locator('.gcsp-release-grid [role=gridcell]').evaluateAll((cells) =>
        cells.map((cell) => cell.dataset.tileId))).sort(), latest.cars.map((car) => car.id).sort());
      assert.equal(await presenter.locator('.gcsp-release-grid img').count(), latest.cars.filter((car) => car.imageSrc).length);
      await until(() => presenter.locator('.gcsp-release-grid img').evaluateAll((images) =>
        images.every((image) => image.complete && image.naturalWidth > 0)), 'All displayed release images must load');
      await presenter.locator('.gcsp-console-time').waitFor({ state: 'visible' });
      for (const label of ['Allocation Pending', 'Allocation Declined', 'Allocation Accepted']) {
        await presenter.locator('.gcsp-allocation-totals').getByText(label, { exact: true }).waitFor();
      }
      await presenter.getByText('Latest release stats', { exact: true }).click();
      assert.equal(await presenter.locator('.gcsp-release-charts .gcsp-count-bars').count(), 4);
      await presenter.getByText('Latest release stats', { exact: true }).click();
      angularImage = await suite.readImage(presenter, presenter.locator('.gcsp-release-grid img').first());
      await noInternals(presenter);
      await fits(presenter);
      await suite.screenshot(presenter, 'presenter-after-release-1280');
      await presenter.setViewportSize({ width: 375, height: 812 });
      await fits(presenter);
      await suite.screenshot(presenter, 'presenter-after-release-375');
      await presenter.setViewportSize({ width: 1280, height: 800 });
      suite.receipt.checks.release = { counts: latest.counts, allocation: latest.allocation,
        releasedAt: latest.release.releasedAt, actualClock: released.clock };
    });

    await t.test('AC3: the actual suitability matrix opens a recorded decision for inspection', async () => {
      await presenter.getByText('Car suitability', { exact: true }).click();
      const cell = presenter.locator('.gcsp-suitability-cell').first();
      await cell.waitFor({ state: 'visible' });
      await cell.focus();
      await presenter.keyboard.press('Enter');
      await presenter.locator('.gcsp-suitability-details h3').waitFor();
      assert.equal(await cell.getAttribute('aria-pressed'), 'true');
      const read = await suite.call(presenter, 'GET', '/presenter/suitability?page=1&buddyPage=1&release=all');
      assert.equal(read.status, 200);
      assert.ok(read.body.value.cars.length && read.body.value.buddies.length);
      await noInternals(presenter);
      await suite.screenshot(presenter, 'presenter-suitability-1280');
      await presenter.setViewportSize({ width: 375, height: 812 });
      await presenter.locator('.gcsp-suitability-details h3').waitFor({ state: 'visible' });
      assert.equal(await cell.getAttribute('aria-pressed'), 'true');
      await fits(presenter);
      await noInternals(presenter);
      await suite.screenshot(presenter, 'presenter-suitability-375');
      await presenter.setViewportSize({ width: 1280, height: 800 });
      await presenter.getByText('Car suitability', { exact: true }).click();
      suite.receipt.checks.suitability = { actualRead: true, keyboardInspection: true, narrowInspection: true };
    });

    await t.test('AC4/5: What happened opens actual captured mail in the safe drawer', async () => {
      await presenter.getByText('What happened', { exact: true }).click();
      const email = presenter.getByRole('button', { name: /^View email,/ }).first();
      await email.waitFor({ state: 'visible' });
      await email.click();
      const drawer = presenter.getByRole('dialog');
      await drawer.waitFor({ state: 'visible' });
      const frame = drawer.locator('iframe');
      await frame.waitFor();
      assert.equal(await frame.getAttribute('sandbox'), '');
      assert.ok((await frame.getAttribute('srcdoc'))?.length > 0, 'The captured body is rendered through the existing mail view');
      await suite.screenshot(presenter, 'presenter-captured-email-1280');
      await presenter.keyboard.press('Escape');
      await drawer.waitFor({ state: 'hidden' });
      assert.equal(await email.evaluate((node) => node === document.activeElement), true);
      await noInternals(presenter);
      await presenter.setViewportSize({ width: 375, height: 812 });
      await fits(presenter);
      await suite.screenshot(presenter, 'presenter-feed-375');
      await email.click();
      await drawer.waitFor({ state: 'visible' });
      await fits(presenter);
      await suite.screenshot(presenter, 'presenter-captured-email-375');
      await presenter.keyboard.press('Escape');
      await presenter.getByText('What happened', { exact: true }).click();
      await presenter.setViewportSize({ width: 1280, height: 800 });
      await presenter.evaluate(() => scrollTo(0, 0));
      suite.receipt.checks.capturedEmail = { actualJob: true, sandbox: true, narrow: true, returnFocus: true };
    });

    await t.test('AC7 engineering precheck: live frozen and Angular release semantics and 1280 pair agree', async () => {
      const reference = await suite.visitFrozenNode({ presenterMain: { ...main, finalClock: released.clock } },
      async ({ page, images, presenterRelease }) => {
        await page.getByRole('heading', { name: "Today's release", exact: true }).waitFor();
        assert.deepEqual(aggregate(latest), aggregate(presenterRelease), 'Both live release projections use the same actual scenario inputs and stock');
        await until(() => page.locator('.gcsp-release-grid img').evaluateAll((list) =>
          list.length > 0 && list.every((image) => image.complete && image.naturalWidth > 0)), 'Frozen release images must load');
        const image = await images.read(page.locator('.gcsp-release-grid img').first());
        assertImageParity(image, angularImage, { dimensions: null });
        const destination = path.join(path.dirname(suite.receipt.screenshots[0].path ?? suite.receipt.screenshots[0]),
          'presenter-node-after-release-1280.png');
        await page.screenshot({ path: destination, fullPage: false });
        return { presenterPair: { node: destination, angular: suite.receipt.screenshots.find((item) =>
          (item.path ?? item).includes('presenter-after-release-1280')), viewport: '1280x800',
        semanticRelease: true, firstCarImage: image, humanVerdict: 'pending; engineering precheck is not acceptance' } };
      });
      assert.equal(reference.state, 'matched', 'The frozen comparison must run; an omitted reference does not prove parity');
      suite.receipt.checks.parity = { engineeringPrecheck: true, engineRunIds: reference.engineRunIds,
        knownVisualDifference: 'F561 AC1 remains open: Java per-tick allocation summary is unavailable; no cumulative inference is used.', humanVerdict: 'pending' };
    });

    await t.test('AC1/6 local boundary: confirmed Main restart clears cars and Basic releases through Java', async () => {
      const after = await resetMain();
      const resetRead = await suite.call(presenter, 'GET', '/presenter/releases/latest');
      assert.equal(resetRead.status, 200);
      assert.equal(resetRead.body.value.release, null);
      assert.equal(resetRead.body.value.counts.totalReleased, 0);
      const primary = presenter.getByRole('button', { name: /^Release (?:tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday)'s cars$/ });
      await primary.waitFor({ state: 'visible' });
      await until(() => primary.isEnabled(), 'The prepared Main scenario must enable the Basic release action');
      await suite.screenshot(presenter, 'presenter-main-reset-1280');
      await primary.click();
      await until(async () => {
        const read = await suite.call(presenter, 'GET', '/presenter/controls');
        return read.status === 200 && Number(read.body.value.clockVersion) > Number(after.clockVersion);
      }, 'The Basic primary action must advance and tick the real Java run');
      await noInternals(presenter);
      suite.receipt.checks.mainReset = { actualLocalMain: true, newRun: true, carsCleared: true, primaryTick: true,
        hostedReleaseCue: 'unrun; local composition cannot establish actual hosted-dev configuration' };
    });
    assert.deepEqual(suite.receipt.consoleErrors, []);
  });
