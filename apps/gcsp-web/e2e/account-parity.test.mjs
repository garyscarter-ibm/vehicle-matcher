import assert from 'node:assert/strict';
import test from 'node:test';
import { startComposition } from './composition.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  assert.fail(message);
}
const good = (response, name) => {
  assert.equal(response.status, 200, name); assert.equal(response.body.status, 'ok', name); return response.body.value;
};
const focused = (locator) => locator.evaluate((node) => document.activeElement === node);
const warning = 'Some offer or order details could not be read.';
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /authorization|cookie|token|password|secret|api[-_]?key|capabilit/i.test(key) ? '[redacted]' : redact(item)]));
  return value;
}

async function readbacks(suite, employee, presenter) {
  const paths = ['/context', '/manual/account', '/brief', '/offers/current', '/orders/progress/all', '/manual/order', '/activity'];
  const result = Object.fromEntries(await Promise.all(paths.map(async (route) =>
    [route, await suite.call(employee, 'GET', route)])));
  result['/presenter/controls'] = await suite.call(presenter, 'GET', '/presenter/controls');
  const retained = redact(result);
  (suite.receipt.account.readbackCaptures ??= []).push(retained);
  const id = result['/offers/current'].body?.value?.offers?.[0]?.offerId;
  if (typeof id === 'string' && id) retained[`/offers/${encodeURIComponent(id)}`] = redact(await suite.call(employee, 'GET', `/offers/${encodeURIComponent(id)}`));
  return retained;
}

async function ready(page) {
  await page.locator('.gcsp-feature .gcsp-vehicle-title').first().waitFor();
  await page.locator('.gcsp-buddy-tile[data-state="active"]').waitFor();
  await until(async () => await page.getByText('Reading your offers and orders…', { exact: true }).count() === 0,
    'Account preview reads settle');
}

async function surface(page) {
  return page.evaluate(() => {
    const hero = document.querySelector('.gcsp-feature');
    const title = hero?.querySelector('.gcsp-vehicle-title');
    const facts = hero?.querySelector('.gcsp-account-facts');
    const photo = hero?.querySelector('.vm-card-photo');
    const pair = document.querySelector('.gcsp-account-buddy-preferences');
    const buddy = pair?.querySelector('.gcsp-buddy-tile');
    const style = (node, key) => node ? getComputedStyle(node)[key] : null;
    const text = (node) => node?.textContent.replace(/\s+/g, ' ').trim();
    const box = (node) => node ? Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, node.getBoundingClientRect()[key]])) : null;
    return { title: title?.textContent.trim(), titleSize: style(title, 'fontSize'),
      factsColumns: style(facts, 'gridTemplateColumns'), facts: [...(facts?.querySelectorAll('.vm-fact') ?? [])].map(text),
      pairColumns: style(pair, 'gridTemplateColumns'), pairBox: box(pair), preferencesBox: box(pair?.firstElementChild), buddyBox: box(buddy),
      countdown: hero?.querySelector('.gcsp-countdown')?.textContent.trim(), clock: !!hero?.querySelector('.gcsp-countdown svg path'),
      photo: photo ? { rawUrl: photo.getAttribute('src'), actualUrl: photo.currentSrc || photo.src,
        complete: photo.complete, naturalWidth: photo.naturalWidth, naturalHeight: photo.naturalHeight,
        box: box(photo), objectFit: style(photo, 'objectFit') } : null,
      ratingOnPhoto: !!hero?.querySelector('.gcsp-feature-media .gcsp-star-rating-overlay.gcsp-star-rating-pill'),
      ratingNames: [...(hero?.querySelectorAll('.gcsp-star-rating input') ?? [])].map((radio) => radio.getAttribute('aria-label')),
      buddyState: buddy?.getAttribute('data-state'), held: text(buddy?.querySelector('.gcsp-buddy-tile-offer')),
      lamp: !!buddy?.querySelector('.gcsp-buddy-dot'), recent: buddy?.querySelector('.gcsp-activity-timeline')?.textContent.trim(),
    };
  });
}

async function displayedImage(suite, page, images) {
  const image = page.locator('.gcsp-feature .vm-card-photo').first();
  await image.scrollIntoViewIfNeeded();
  await until(() => image.evaluate((node) => node.complete && node.naturalWidth > 0), 'Actual current-car image loads');
  const actual = await image.evaluate((node) => ({ rawUrl: node.getAttribute('src'), actualUrl: node.currentSrc || node.src,
    complete: node.complete, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight }));
  // The retained observer covers root /assets and Node display routes, but not Angular's /gcsp/assets prefix.
  const observedPath = /^(?:\/assets\/gcsp-vehicle-evidence\/|\/api\/gcsp\/(?:v1\/)?vehicle-images\/)/.test(new URL(actual.actualUrl).pathname);
  const observation = observedPath ? await (images ? images.read(image) : suite.readImage(page, image)) : null;
  if (observation?.response.status !== undefined) assert.equal(observation.response.status, 200);
  return { ...actual, observation, evidence: observation?.response.status === 200 ? 'actual displayed image HTTP 200' :
    'actual displayed image complete with positive natural dimensions; response outside existing observer coverage' };
}

async function offerLink(dialog, page, offer) {
  const link = dialog.getByRole('link', { name: 'View offer', exact: true }); await link.waitFor();
  const actual = new URL(await link.getAttribute('href'), page.url());
  assert.equal(actual.href, new URL(offer.href, page.url()).href, 'The link uses its actual activity API offer target');
  assert.equal(actual.searchParams.get('offerId') ?? decodeURIComponent(actual.pathname.split('/').at(-1)), offer.offerRef.offerId);
  return { href: actual.href, offerId: offer.offerRef.offerId };
}

async function dismissDrawer(page, opener, name, inspect = async () => {}) {
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name, exact: true }); await dialog.waitFor();
  assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true, `${name}: focus enters drawer`);
  await inspect(dialog);
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true, `${name}: keyboard stays in drawer`);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await focused(opener), true, `${name}: Escape restores opener focus`);
}

test('FUCQ-551: actual held account, frozen pair, commands, truthful failure and finished Buddy', { timeout: 540000 }, async (t) => {
  const suite = await startComposition({ caseId: 'f551' });
  t.after(() => suite.close());
  const names = ['held account and hero', 'frozen held pair', 'history, drawers and narrow keyboard',
    'Pause and Resume commands', 'genuine read failure and recovery', 'accepted offer and finished Buddy'];
  const evidence = suite.receipt.account = { groups: names.map((name) => ({ name, state: 'unrun' })),
    humanAcceptance: 'pending Gary/Russell review of the same-state 1280 pair',
    hostedImage: 'Separate hosted-image.json is asset availability evidence; this local signed-in journey is not hosted acceptance.',
    statusEvidence: 'INFERRED from uniquely gated real UI states and full actual readbacks; no private Angular objects inspected.' };
  async function check(index, action) {
    const group = evidence.groups[index]; let failure;
    await t.test(group.name, async () => {
      group.state = 'running';
      try { await action(); group.state = 'passed'; }
      catch (error) { group.state = 'failed'; group.failure = error.message.slice(0, 1000); failure = error; throw error; }
    });
    if (failure) throw failure;
  }
  try {
    const employee = await suite.newPage('employee', 'demo-paula', 'account');
    const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
    const state = await suite.releaseMainOffer(employee, presenter);
    await employee.setViewportSize({ width: 1280, height: 800 });
    await employee.reload({ waitUntil: 'domcontentloaded' }); await ready(employee);
    const tile = employee.locator('.gcsp-buddy-tile');

    await check(0, async () => {
      evidence.heldReadbacks = await readbacks(suite, employee, presenter);
      const reads = evidence.heldReadbacks;
      const listed = good(reads['/offers/current'], 'Actual current list');
      assert.equal(listed.offers[0].offerId, state.offer.offerRef.offerId);
      const detail = good(reads[`/offers/${encodeURIComponent(listed.offers[0].offerId)}`], 'Actual followed offer detail');
      assert.equal(detail.state, 'pending');
      const orders = good(reads['/orders/progress/all'], 'Actual exhaustive orders read');
      assert.deepEqual(orders.orders, []); assert.equal(orders.nextAfter, null);
      assert.equal(orders.failedCount, 0); assert.deepEqual(orders.failed, []);
      assert.equal(reads['/manual/order'].status, 404); assert.equal(reads['/manual/order'].body.status, 'not-found');
      await employee.getByText('No orders to track.', { exact: true }).waitFor();
      assert.equal(await employee.getByText(warning, { exact: true }).count(), 0);
      assert.equal(await employee.getByRole('button', { name: 'Retry offers and orders', exact: true }).count(), 0);
      assert.equal(await employee.getByRole('button', { name: 'Choose a replacement', exact: true }).count(), 0,
        'The pending-offer projection suppresses replacement');
      evidence.inferredAccountStates = { offers: 'ok with pending followed detail', completeOrders: 'ok, exhausted and empty', manualOrder: 'not-found',
        source: 'account.component.ts pendingOffer, completeOrders, handoffState and noOrders; account.client.ts readOffers follows the trusted detail' };
      await tile.getByRole('heading', { name: 'A car is held for you', exact: true }).waitFor();
      await tile.getByRole('heading', { name: 'Recent activity', exact: true }).waitFor();
      assert.match(await tile.locator('.gcsp-buddy-tile-offer').innerText(), /Respond by/);
      await tile.getByRole('button', { name: 'View held offer', exact: true }).waitFor();
      evidence.angularImage = await displayedImage(suite, employee);
      evidence.angularHeld = await surface(employee);
      const actual = evidence.angularHeld;
      assert.equal(actual.titleSize, '23px'); assert.equal(actual.factsColumns.split(' ').length, 2);
      assert.equal(actual.pairColumns.split(' ').length, 2);
      const columns = actual.pairColumns.split(' ').map(parseFloat);
      assert.ok(columns[1] >= 320 && Math.abs(columns[0] / columns[1] - 1.6) < .02, 'Source 1.6fr / min-320px Buddy grid');
      assert.ok(actual.ratingOnPhoto && actual.clock && actual.lamp);
      assert.equal(actual.ratingNames.length, 5); assert.ok(actual.ratingNames.every((name) => /stars?: .+/.test(name)));
      assert.equal(Math.round(actual.preferencesBox.y), Math.round(actual.buddyBox.y));
      await suite.screenshot(employee, 'angular-account-held-1280', { fullPage: true });
    });

    await check(1, async () => {
      const replay = await suite.visitFrozenNode({ ...suite.receipt.offer, hold: state.hold, clock: state.clock,
        finalAccount: state.account }, async ({ page, origin, runtime, employee: principal, offer, images, receipt }) => {
        await page.goto(`${origin}/gcsp-account.html`, { waitUntil: 'domcontentloaded' });
        await page.locator('.gcsp-buddy-tile-offer').waitFor();
        const actual = { brief: await runtime.brief.readCurrent(principal), account: await runtime.account.readAccount(principal),
          activity: await runtime.activity.readActivity(principal) };
        receipt.account = { readbacks: redact(actual), humanAcceptance: 'pending' };
        receipt.account.surface = await surface(page);
        receipt.account.image = await displayedImage(suite, page, images);
        await suite.screenshot(page, 'node-account-held-1280', { fullPage: true });
        const source = receipt.account.surface; const target = evidence.angularHeld;
        assert.equal(source.title, target.title); assert.equal(source.titleSize, target.titleSize);
        assert.equal(source.factsColumns, target.factsColumns); assert.deepEqual(source.facts, target.facts);
        assert.equal(source.pairColumns, target.pairColumns); assert.equal(source.held, target.held);
        const sourceActivity = actual.activity; assert.equal(sourceActivity.status, 'ok');
        assert.equal(sourceActivity.value.currentOffer.offerRef.offerId, offer.offerRef.offerId);
        evidence.offerIdentityMapping = { node: offer.offerRef.offerId, java: state.offer.offerRef.offerId,
          basis: 'Each engine creates its own offer ID; the shared boundary verifies the actual same car, deadline and hold semantics.' };
        await page.getByRole('button', { name: 'View held offer', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Your held offer', exact: true }); await dialog.waitFor();
        receipt.account.offerLink = await offerLink(dialog, page, sourceActivity.value.currentOffer);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        evidence.imageComparison = { node: receipt.account.image, angular: evidence.angularImage,
          sameNaturalDimensions: receipt.account.image.naturalWidth === evidence.angularImage.naturalWidth &&
            receipt.account.image.naturalHeight === evidence.angularImage.naturalHeight,
          framing: 'Actual Node live display variant and Angular retained raw asset are recorded independently; no photo-byte or crop equality is claimed.' };
        return {};
      });
      assert.equal(replay.state, 'matched', 'The frozen reference is required for the held pair');
    });

    await check(2, async () => {
      const history = employee.locator('.gcsp-account-history gcsp-data-table'); await history.waitFor();
      assert.ok(await history.getByText('Current car', { exact: true }).count() > 0);
      const records = history.getByRole('button', { name: /^View record for / }); assert.ok(await records.count() > 0);
      evidence.history = { actions: await records.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
        text: await history.innerText(), source: 'Actual Main account histories; no inserted history row.' };
      const currentRow = history.getByRole('row').filter({ has: employee.getByText('Current car', { exact: true }) }).first();
      const currentRecord = currentRow.getByRole('button', { name: /^View record for / });
      await dismissDrawer(employee, currentRecord, evidence.angularHeld.title);
      await dismissDrawer(employee, tile.getByRole('button', { name: 'Buddy history', exact: true }), 'Buddy history');
      await dismissDrawer(employee, tile.getByRole('button', { name: 'View held offer', exact: true }), 'Your held offer', async (dialog) => {
        evidence.offerLink = await offerLink(dialog, employee, evidence.heldReadbacks['/activity'].body.value.currentOffer);
      });
      await employee.setViewportSize({ width: 390, height: 844 });
      await dismissDrawer(employee, tile.getByRole('button', { name: 'Buddy history', exact: true }), 'Buddy history');
      const star = employee.locator('.gcsp-feature .gcsp-star-rating input').first(); await star.focus();
      const tip = employee.getByRole('tooltip'); await tip.waitFor();
      evidence.ratingHelp = { radioName: await star.getAttribute('aria-label'), text: await tip.innerText() };
      assert.match(evidence.ratingHelp.text, /How highly do you rate/);
      await employee.keyboard.press('Escape'); await tip.waitFor({ state: 'hidden' }); assert.equal(await focused(star), true);
      evidence.narrow = await surface(employee);
      assert.equal(evidence.narrow.pairColumns.split(' ').length, 1);
      assert.equal(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await suite.screenshot(employee, 'angular-account-held-390', { fullPage: true });
      await employee.setViewportSize({ width: 1280, height: 800 });
    });

    await check(3, async () => {
      evidence.commands = [];
      for (const [label, route, paused] of [['Pause search', '/brief/pause-search', true], ['Resume search', '/brief/resume-search', false]]) {
        const command = employee.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(route));
        await tile.getByRole('button', { name: label, exact: true }).click();
        const response = await command; const body = await response.json();
        evidence.commands.push({ label, response: redact({ status: response.status(), body }) });
        assert.equal(response.status(), 200); assert.equal(body.status, 'ok');
        await until(async () => await tile.getAttribute('data-state') === (paused ? 'paused' : 'active'), `${label} authoritative tile state`);
        const activity = await suite.call(employee, 'GET', '/activity'); const brief = await suite.call(employee, 'GET', '/brief');
        evidence.commands.at(-1).readbacks = redact({ activity, brief });
        assert.equal(good(activity, `${label} activity`).permission.paused, paused); good(brief, `${label} saved brief`);
        assert.equal(activity.body.value.currentOffer.offerRef.offerId, state.offer.offerRef.offerId, 'Pausing preserves the real held offer');
        assert.equal(activity.body.value.currentOffer.state, 'active');
        await tile.getByRole('button', { name: paused ? 'Resume search' : 'Pause search', exact: true }).waitFor();
        await suite.screenshot(employee, paused ? 'angular-account-paused-1280' : 'angular-account-resumed-1280', { fullPage: true });
      }
    });

    await check(4, async () => {
      const pattern = '**/api/gcsp/v1/offers/current'; let aborted = 0;
      const abort = async (route) => { aborted++; await route.abort('failed'); };
      await employee.route(pattern, abort);
      try {
        await employee.reload({ waitUntil: 'domcontentloaded' });
        await employee.getByText(warning, { exact: true }).waitFor(); assert.ok(aborted > 0);
        await employee.getByRole('button', { name: 'Retry offers and orders', exact: true }).waitFor();
        evidence.transportFailure = { abortedReads: aborted, route: '/offers/current', mechanism: 'actual network abort, no response substitution' };
        await suite.screenshot(employee, 'angular-account-real-read-failure-1280', { fullPage: true });
      } finally { await employee.unroute(pattern, abort); }
      await employee.getByRole('button', { name: 'Retry offers and orders', exact: true }).click();
      await until(async () => await employee.getByText(warning, { exact: true }).count() === 0, 'Actual reread recovers the preview');
      await ready(employee); evidence.recoveredReadbacks = await readbacks(suite, employee, presenter);
    });

    await check(5, async () => {
      const offerId = encodeURIComponent(state.offer.offerRef.offerId);
      await employee.goto(`${suite.origins.web}/gcsp/offers/${offerId}`, { waitUntil: 'domcontentloaded' });
      await employee.getByRole('button', { name: 'Review & accept', exact: true }).click();
      const dialog = employee.getByRole('dialog', { name: 'Accept your offer', exact: true }); await dialog.waitFor();
      const mileage = dialog.getByLabel('Expected return mileage (miles)', { exact: true });
      await mileage.fill('5400'); await mileage.press('Tab');
      const declarations = dialog.getByRole('checkbox');
      for (let index = 0; index < await declarations.count(); index++) await declarations.nth(index).check();
      const decision = employee.waitForResponse((response) => response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/offers/${offerId}/decision`));
      await dialog.getByRole('button', { name: 'Accept offer', exact: true }).click();
      const response = await decision;
      evidence.acceptance = redact({ status: response.status(), body: await response.json() }); good(evidence.acceptance, 'Actual acceptance');
      await employee.goto(`${suite.origins.web}/gcsp/account`, { waitUntil: 'domcontentloaded' });
      await employee.locator('.gcsp-buddy-tile[data-state="finished"]').waitFor();
      evidence.finishedReadbacks = await readbacks(suite, employee, presenter);
      assert.equal(good(evidence.finishedReadbacks['/activity'], 'Actual finished activity').currentOffer.state, 'accepted');
      const order = employee.locator('.gcsp-buddy-tile').getByRole('link', { name: 'Track your order', exact: true }); await order.waitFor();
      assert.equal(new URL(await order.getAttribute('href'), employee.url()).pathname, '/gcsp/orders');
      assert.equal(await employee.locator('.gcsp-buddy-tile').getByRole('button', { name: /^(Pause|Resume) search$/ }).count(), 0);
      await suite.screenshot(employee, 'angular-account-finished-1280', { fullPage: true });
      await order.focus(); await employee.keyboard.press('Enter'); await employee.waitForURL((url) => url.pathname === '/gcsp/orders');
    });
    assert.deepEqual(suite.receipt.consoleErrors, [], 'No application runtime errors in the account flow');
    assert.ok(evidence.groups.every((group) => group.state === 'passed')); suite.receipt.checks.f551 = true;
  } catch (error) {
    suite.receipt.failure ??= { name: error.name, message: error.message.slice(0, 1000) }; throw error;
  }
});
