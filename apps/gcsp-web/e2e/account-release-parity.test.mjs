import assert from 'node:assert/strict';
import test from 'node:test';
import { startComposition } from './composition.mjs';

const warning = 'Some offer or order details could not be read.';
const retryName = 'Retry offers and orders';
const retain = (value) => JSON.parse(JSON.stringify(value, (key, item) =>
  /token|password|authorization|secret|cookie/i.test(key) ? '[redacted]' : item));
const good = (response, label) => {
  assert.equal(response.status, 200, label);
  assert.equal(response.body?.status, 'ok', label);
  return response.body.value;
};
async function until(check, message) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}
async function ready(page) {
  await page.locator('.gcsp-feature .gcsp-vehicle-title').first().waitFor();
  await page.locator('.gcsp-buddy-tile[data-state="active"]').waitFor();
  await until(async () => await page.getByText('Reading your offers and orders…', { exact: true }).count() === 0,
    'The real account preview reads settle');
}
async function healthy(page) {
  await ready(page);
  await page.getByText('No orders to track.', { exact: true }).waitFor();
  assert.equal(await page.getByText(warning, { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: retryName, exact: true }).count(), 0);
  const preferences = page.locator('section.account-preferences');
  assert.equal(await preferences.getByText(/^Saved status:/).count(), 0);
  assert.equal(await preferences.getByRole('button', { name: 'Reload Buddy status', exact: true }).count(), 0);
  await page.locator('.gcsp-buddy-tile').getByRole('heading', { name: 'A car is held for you', exact: true }).waitFor();
}
async function readbacks(suite, employee) {
  const routes = ['/manual/account', '/offers/current', '/orders/progress/all', '/manual/order'];
  const result = Object.fromEntries(await Promise.all(routes.map(async (route) =>
    [route, retain(await suite.call(employee, 'GET', route))])));
  const id = result['/offers/current'].body?.value?.offers?.[0]?.offerId;
  if (id) result['/offers/' + encodeURIComponent(id)] = retain(await suite.call(employee, 'GET', '/offers/' + encodeURIComponent(id)));
  return result;
}
function assertReadbacks(reads, state) {
  good(reads['/manual/account'], 'Actual account facts');
  const listed = good(reads['/offers/current'], 'Actual current offers');
  assert.equal(listed.offers[0]?.offerId, state.offer.offerRef.offerId);
  const detail = good(reads['/offers/' + encodeURIComponent(listed.offers[0].offerId)], 'Actual followed offer');
  assert.equal(detail.state, 'pending');
  const orders = good(reads['/orders/progress/all'], 'Actual exhausted order list');
  assert.deepEqual(orders.orders, []);
  assert.deepEqual(orders.failed, []);
  assert.equal(orders.failedCount, 0);
  assert.equal(orders.nextAfter, null);
  assert.equal(reads['/manual/order'].status, 404);
  assert.equal(reads['/manual/order'].body?.status, 'not-found');
}

test('FUCQ-595: healthy public release omits duplicate panels and genuine read failure remains recoverable',
  { timeout: 540000 }, async (t) => {
    const suite = await startComposition({ caseId: 'f595' });
    t.after(() => suite.close());
    const evidence = suite.receipt.accountRelease = {
      groups: [], humanAcceptance: 'pending human review of the new same-state 1280 pair',
      source: 'Real Angular/Java/native PostgreSQL and signed demo OIDC; no substituted success responses.',
    };
    async function check(name, action) {
      const group = { name, state: 'running' };
      evidence.groups.push(group);
      let failure;
      await t.test(name, async () => {
        try { await action(); group.state = 'passed'; }
        catch (error) { group.state = 'failed'; group.failure = error.message.slice(0, 1000); failure = error; throw error; }
      });
      if (failure) throw failure;
    }

    const employee = await suite.newPage('employee', 'demo-paula', 'account');
    const presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
    await employee.setViewportSize({ width: 1280, height: 800 });
    const accountUrl = employee.url();
    const state = await suite.releaseMainOffer(employee, presenter);

    await check('actual public release in the original account tab', async () => {
      evidence.releaseReadbacks = await readbacks(suite, employee);
      assertReadbacks(evidence.releaseReadbacks, state);
      await healthy(employee);
      assert.equal(employee.url(), accountUrl);
      evidence.originalTab = { accountUrl, currentUrl: employee.url(), reloadedByTestBeforeCapture: false };
      await suite.screenshot(employee, 'angular-account-release-1280', { fullPage: true });
    });

    await check('matching frozen Node public-release pair at 1280', async () => {
      const replay = await suite.visitFrozenNode({ ...suite.receipt.offer, hold: state.hold, clock: state.clock,
        finalAccount: state.account }, async ({ page, origin }) => {
        await page.goto(origin + '/gcsp-account.html', { waitUntil: 'domcontentloaded' });
        await page.locator('.gcsp-buddy-tile-offer').waitFor();
        assert.equal(page.viewportSize().width, 1280);
        assert.equal(await page.getByText(warning, { exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: retryName, exact: true }).count(), 0);
        assert.equal(await page.getByText(/^Saved status:/).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Reload Buddy status', exact: true }).count(), 0);
        await suite.screenshot(page, 'node-account-release-1280', { fullPage: true });
      });
      evidence.nodeReplay = replay;
      assert.equal(replay.state, 'matched', 'A supplied frozen reference must actually produce the matching scenario');
    });

    await check('actual transport failure and keyboard recovery, desktop and narrow', async () => {
      const pattern = '**/api/gcsp/v1/offers/current';
      let aborted = 0;
      const abort = async (route) => { aborted++; await route.abort('failed'); };
      await employee.route(pattern, abort);
      try {
        await employee.reload({ waitUntil: 'domcontentloaded' });
        await employee.getByText(warning, { exact: true }).waitFor();
        await employee.getByRole('button', { name: retryName, exact: true }).waitFor();
        assert.ok(aborted > 0);
        evidence.transportFailure = { abortedReads: aborted, route: '/offers/current', mechanism: 'actual network abort' };
        await suite.screenshot(employee, 'angular-account-read-failure-1280', { fullPage: true });
        await employee.setViewportSize({ width: 375, height: 812 });
        await suite.screenshot(employee, 'angular-account-read-failure-375', { fullPage: true });
      } finally { await employee.unroute(pattern, abort); }
      const retry = employee.getByRole('button', { name: retryName, exact: true });
      await retry.focus();
      const [response] = await Promise.all([
        employee.waitForResponse((reply) => reply.request().method() === 'GET'
          && reply.url().startsWith(suite.apiBase + '/')
          && new URL(reply.url()).pathname === new URL(suite.apiBase).pathname + '/offers/current'
          && reply.status() === 200),
        retry.press('Enter'),
      ]);
      evidence.successfulRecoveryTransport = { status: response.status(), body: retain(await response.json()), keyboard: 'Enter' };
      good(evidence.successfulRecoveryTransport, 'Actual successful recovery transport');
      await until(async () => await employee.getByText(warning, { exact: true }).count() === 0,
        'The successful real reread clears the failure warning');
      await healthy(employee);
      evidence.recoveredReadbacks = await readbacks(suite, employee);
      assertReadbacks(evidence.recoveredReadbacks, state);
      evidence.narrow = await employee.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));
      assert.ok(evidence.narrow.documentWidth <= evidence.narrow.width + 1);
      await suite.screenshot(employee, 'angular-account-release-375', { fullPage: true });
    });
  });
