import assert from 'node:assert/strict';
import test from 'node:test';
import { startComposition } from './composition.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  assert.fail(message);
}
const good = (response, name) => {
  assert.equal(response.status, 200, name); assert.equal(response.body.status, 'ok', name); return response.body.value;
};
const semantic = (value) => JSON.stringify(value, (key, item) => key === 'asOf' ? undefined : item);
const offerPath = (offer) => `/offers/${encodeURIComponent(offer.offerRef.offerId)}`;
const orderSections = ['/orders/progress', '/documents', '/appointments', '/return-plan'];
const posts = (suite, page) => suite.receipt.requests.filter((row) => row.page === page && row.method === 'POST');
async function settled(page, heading, root) {
  await page.getByRole('heading', { name: heading, exact: true, level: 1 }).waitFor();
  await until(async () => await page.locator(`${root}[aria-busy="true"], ${root} [aria-busy="true"]`).count() === 0,
    `${heading}: its actual visible read finishes`);
}
async function capture(suite, page, name, options) {
  await page.waitForFunction(() => [...document.images].filter((image) => {
    const box = image.getBoundingClientRect();
    return image.loading !== 'lazy' || box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  }).every((image) => image.complete), null, { timeout: 15000 });
  return suite.screenshot(page, name, options);
}
async function anchorBuddy(page) {
  await page.locator('.gcsp-buddy-tile').evaluate((node) => {
    const header = document.querySelector('.gcsp-header')?.getBoundingClientRect().height ?? 0;
    scrollTo({ top: scrollY + node.getBoundingClientRect().top - header - 16, behavior: 'instant' });
  });
}
async function step(suite, presenter) {
  const before = good(await suite.call(presenter, 'GET', '/presenter/clock'), 'Actual clock before public Step');
  await presenter.getByRole('button', { name: /^Step \d+ seconds$/ }).click();
  let after;
  await until(async () => {
    after = good(await suite.call(presenter, 'GET', '/presenter/clock'), 'Actual clock after public Step');
    return Number(after.clockVersion) > Number(before.clockVersion);
  }, 'The real presenter Step completes');
  assert.ok(Date.parse(after.now) > Date.parse(before.now));
  return { before: { now: before.now, version: before.clockVersion }, after: { now: after.now, version: after.clockVersion } };
}

function watchReads(page, apiBase, paths) {
  const rows = []; const pending = new Set();
  const observe = (response) => {
    const url = new URL(response.url());
    if (!response.url().startsWith(apiBase + '/') || response.request().method() !== 'GET'
      || !paths.includes(url.pathname.slice(new URL(apiBase).pathname.length))) return;
    assert.ok(rows.length < 128, 'A reader journal stays bounded');
    const row = { path: url.pathname.slice(new URL(apiBase).pathname.length), status: response.status(), at: Date.now() };
    rows.push(row);
    const reading = response.json().then((body) => { row.body = body; }, () => { row.invalidJson = true; });
    pending.add(reading); reading.finally(() => pending.delete(reading));
  };
  page.on('response', observe);
  return { rows, async flush() { await Promise.all([...pending]); },
    async stop() { page.off('response', observe); await Promise.all([...pending]); } };
}
async function readerMatrix(suite, page, presenter, definition, evidence) {
  const { name, heading, root, paths, assertView, unavailablePaths = [] } = definition;
  await settled(page, heading, root); await assertView();
  const journal = watchReads(page, suite.apiBase, paths);
  const pageLabel = ({ outbox: 'outbox', orders: 'orders' })[name] ?? 'employee';
  const writesBefore = posts(suite, pageLabel).length;
  const results = [];
  const run = async (trigger, action, timeout = 15000) => {
    const first = journal.rows.length; const start = Date.now();
    assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
    const details = await action();
    await until(() => paths.every((route) => journal.rows.slice(first).some((row) => row.path === route
      && (row.status === 200 || unavailablePaths.includes(route) && row.status === 503))),
      `${name}: ${trigger} re-reads every route-owned endpoint`, timeout);
    await journal.flush(); await settled(page, heading, root); await assertView();
    const reads = journal.rows.slice(first);
    assert.ok(reads.every((row) => row.status === 200 && row.body?.status === 'ok'
      || unavailablePaths.includes(row.path) && row.status === 503 && row.body?.status === 'unavailable'),
    `${name}: actual reads succeed or retain an explicitly disclosed unavailable supporting producer`);
    for (const row of reads) {
      if (row.body.value?.runId !== undefined) assert.equal(row.body.value.runId, suite.receipt.composition.runId);
    }
    results.push({ trigger, elapsedMs: Date.now() - start, details,
      reads: reads.map(({ path, status, at, body }) => ({ path, status, at, result: body.status, code: body.code })),
      outcome: 'Automatic re-read and settled actual screen; disclosed unavailable supporting producers remain visible. A changed business outcome is asserted separately.' });
  };
  try {
    await run('public presenter action across real tabs', () => step(suite, presenter));
    await run('synthetic visibilitychange listener integration', () => page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      return { synthetic: true, visibilityState: document.visibilityState, nativeHiddenTransition: false };
    }));
    await run('synthetic persisted pageshow listener integration', () => page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      return { synthetic: true, nativeBackForwardCacheRestore: false };
    }));
    console.log(`F550 ${name}: waiting for two successive actual idle polls`);
    await run('actual visible 30-second wall-clock poll', async () => {
      const first = journal.rows.length; const primary = paths.at(-1);
      await until(() => journal.rows.slice(first).some((row) => row.path === primary), `${name}: first idle poll`, 33000);
      const firstPoll = journal.rows.slice(first).find((row) => row.path === primary);
      console.log(`F550 ${name}: first idle poll observed; waiting for its next periodic read`);
      await until(() => journal.rows.slice(first).some((row) => row.path === primary && row.at > firstPoll.at + 1000),
        `${name}: second idle poll`, 33000);
      const secondPoll = journal.rows.slice(first).find((row) => row.path === primary && row.at > firstPoll.at + 1000);
      const interval = secondPoll.at - firstPoll.at;
      assert.ok(interval >= 28000 && interval <= 35000, `${name}: actual successive idle reads are approximately 30 seconds apart (${interval}ms)`);
      assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
      return { intervalMs: interval, synthetic: false, fakeClock: false, employeeInput: false };
    });
    assert.equal(posts(suite, pageLabel).length, writesBefore,
      `${name}: automatic reads never replay a write`);
    evidence.readers[name] = results;
  } finally { await journal.stop(); }
}

async function chips(page) {
  return page.locator('.gcsp-mail-row').evaluateAll((rows) => rows.map((row) => {
    const chip = row.querySelector('.gcsp-mail-status'); const svg = chip?.querySelector('svg');
    return { jobId: row.getAttribute('data-id'), label: chip?.textContent?.trim(), className: chip?.className,
      paths: [...(svg?.querySelectorAll('path') ?? [])].map((item) => item.getAttribute('d')),
      svg: svg && { ariaHidden: svg.getAttribute('aria-hidden'), focusable: svg.getAttribute('focusable'), viewBox: svg.getAttribute('viewBox') },
      color: chip && getComputedStyle(chip).color, background: chip && getComputedStyle(chip).backgroundColor };
  }));
}
function expectedChip(message) {
  const circle = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z';
  if (message.state === 'sent' && ['captured', 'configured'].includes(message.transport)) return {
    label: message.transport === 'captured' ? 'Captured, not sent' : 'Accepted by email provider',
    tone: 'ok', paths: ['M5 12.5l4.5 4.5L19 7.5'] };
  if (message.state === 'retrying') return { label: 'Retrying', tone: 'warn', paths: ['M20 12a8 8 0 1 1-2.5-5.8', 'M20 4v5h-5'] };
  if (message.state === 'failed') return { label: 'Failed', tone: 'bad', paths: [circle, 'M9 9l6 6', 'M15 9l-6 6'] };
  return { label: ({ pending: 'Preparing', sending: 'Sending' })[message.state] ?? 'Delivery status unknown',
    tone: 'wait', paths: [circle, 'M12 7.5V12l3 2'] };
}
async function actualOutbox(suite, presenter) {
  const value = good(await suite.call(presenter, 'GET', '/presenter/outbox'), 'Actual captured-outbox projection');
  assert.equal(value.runId, suite.receipt.composition.runId); assert.ok(value.messages.length > 0);
  return value.messages;
}
async function assertChips(page, messages) {
  const rendered = await chips(page); assert.equal(rendered.length, messages.length);
  const sorted = [...messages].sort((a, b) => Date.parse(b.time ?? '') - Date.parse(a.time ?? '') || a.jobId.localeCompare(b.jobId));
  for (const [index, message] of sorted.entries()) {
    const actual = rendered[index]; const expected = expectedChip(message);
    assert.equal(actual.label, expected.label); assert.equal(actual.className, `gcsp-mail-status is-${expected.tone}`);
    assert.deepEqual(actual.paths, expected.paths);
    assert.deepEqual(actual.svg, { ariaHidden: 'true', focusable: 'false', viewBox: '0 0 24 24' });
  }
  return rendered;
}
async function accept(suite, employee, offer) {
  await employee.getByRole('button', { name: 'Review & accept', exact: true }).click();
  const dialog = employee.getByRole('dialog', { name: 'Accept your offer', exact: true }); await dialog.waitFor();
  await dialog.getByLabel('Expected return mileage (miles)', { exact: true }).fill('5400');
  const boxes = dialog.getByRole('checkbox'); assert.ok(await boxes.count() > 0);
  for (let index = 0; index < await boxes.count(); index++) await boxes.nth(index).check();
  const confirm = dialog.getByRole('button', { name: 'Accept offer', exact: true });
  await until(() => confirm.isEnabled(), 'The real declaration review enables acceptance');
  const response = employee.waitForResponse((value) => value.request().method() === 'POST'
    && new URL(value.url()).pathname.endsWith(`${offerPath(offer)}/decision`));
  await confirm.click(); const actual = await response; const body = await actual.json();
  assert.equal(actual.status(), 200); assert.equal(body.status, 'ok');
  const sent = actual.request().postDataJSON(); assert.equal(sent.decision, 'accept');
  assert.equal(sent.runId, suite.receipt.composition.runId);
  await employee.getByRole('heading', { name: 'Offer accepted', exact: true }).waitFor();
  return { status: actual.status(), decision: sent.decision, offerId: offer.offerRef.offerId, runId: sent.runId };
}

test('FUCQ-550: live Java/OIDC screen refresh and frozen status presentation', { timeout: 540000 }, async (t) => {
  const suite = await startComposition({ caseId: 'f550' });
  const evidence = { readers: {}, acceptance: {}, nativeLifecycle: {
    hiddenVisible: 'unrun: synthetic visibilitychange verifies the listener and real signed re-read only',
    backForwardCache: 'unrun: synthetic persisted pageshow verifies the listener and real signed re-read only' },
  humanAcceptance: 'pending: screenshots and engineering assertions do not grant matches/intended-change or Done' };
  suite.receipt.liveRefresh = evidence;
  const group = async (name, body) => {
    let failure;
    await t.test(name, async () => {
      try { await body(); } catch (error) { failure = error; throw error; }
    });
    if (failure) throw failure;
  };
  let employee; let presenter; let orderPage; let state;
  try {
    employee = await suite.newPage('employee', 'demo-paula', 'account');
    presenter = await suite.newPage('presenter', 'demo-presenter', 'presenter');
    await group('AC1/5: real release updates already-open Your cars without employee input', async () => {
      await settled(employee, 'Your cars', '.account-screen');
      await employee.locator('.gcsp-buddy-tile:not([data-state="loading"])[aria-busy="false"]').waitFor();
      assert.equal(await employee.locator('.gcsp-buddy-tile-offer').count(), 0);
      const initialActivity = good(await suite.call(employee, 'GET', '/activity'), 'Actual activity before the measured release');
      assert.equal(initialActivity.currentOffer, null);
      evidence.accountRecovery = { topScreenshot: await capture(suite, employee, 'account-full-top-diagnostic-1280'),
        banners: await employee.locator('.account-screen gcsp-status-screen').allTextContents(),
        scope: 'Existing recovery banners remain visible and unmodified; absent frozen-source banners are not filtered from this diagnostic.' };
      await anchorBuddy(employee);
      const beforeUrl = employee.url();
      evidence.release = { before: await capture(suite, employee, 'account-before-public-release-1280', { fullPage: true }),
        beforeScroll: await employee.evaluate(() => ({ x: scrollX, y: scrollY })),
        anchoring: 'Programmatically scrolled the actual Buddy tile into view before release; no employee input after this before capture.',
        employeeInputAfterBeforeCapture: false, employeeNavigationAfterBeforeCapture: false };
      state = await suite.releaseMainOffer(employee, presenter);
      await employee.getByRole('heading', { name: 'A car is held for you', exact: true }).waitFor();
      await settled(employee, 'Your cars', '.account-screen');
      assert.equal(employee.url(), beforeUrl, 'The original employee page stays open throughout release');
      assert.equal(await employee.locator('.gcsp-buddy-tile-offer').count(), 1);
      assert.equal(state.offer.state, 'active'); assert.equal(state.hold.state, 'active');
      assert.equal(state.hold.orderUuid, state.offer.orderUuid);
      evidence.release.after = await capture(suite, employee, 'account-after-public-release-1280', { fullPage: true });
      evidence.release.afterScroll = await employee.evaluate(() => ({ x: scrollX, y: scrollY }));
      evidence.release.scrollPreserved = JSON.stringify(evidence.release.afterScroll) === JSON.stringify(evidence.release.beforeScroll);
      evidence.release.heldHeadingInViewport = await employee.getByRole('heading', { name: 'A car is held for you', exact: true }).evaluate((node) => {
        const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight;
      });
      evidence.release.captureScope = 'Actual full-page before/after captures without employee input; viewport scroll changes are recorded, not repaired.';
      evidence.release.actual = { orderUuid: state.offer.orderUuid, offerId: state.offer.offerRef.offerId,
        hold: state.hold, clock: state.clock, accountAsOf: state.account.asOf, runId: suite.receipt.composition.runId };
      evidence.release.heldText = await employee.locator('.gcsp-buddy-tile-offer').innerText();
    });
    assert.ok(state, 'Actual release is required for subsequent proof; no fabricated fallback');

    await group('AC4/5: same-release frozen account and actual outbox status chip pair', async () => {
      await presenter.getByRole('link', { name: 'Outbox', exact: true }).click();
      await presenter.getByRole('heading', { name: 'Captured emails', exact: true, level: 1 }).waitFor();
      await presenter.locator('.gcsp-mail-status').first().waitFor();
      const messages = await actualOutbox(suite, presenter);
      const angular = await assertChips(presenter, messages);
      evidence.outbox = { messages: messages.map(({ jobId, state, transport, messageKind }) => ({ jobId, state, transport, messageKind })),
        angular, screenshot: await capture(suite, presenter, 'outbox-after-public-release-1280') };
      const replay = await suite.visitFrozenNode({ orderUuid: state.offer.orderUuid, expiresAt: state.offer.expiresAt,
        state: state.offer.state, clock: state.clock, hold: state.hold, finalAccount: state.account },
      async ({ page, context, origin, runtime, receipt }) => {
        await page.goto(`${origin}/gcsp-account.html`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Your cars', exact: true, level: 1 }).waitFor();
        await page.getByText('A car is held for you', { exact: true }).waitFor();
        await anchorBuddy(page);
        const account = await capture(suite, page, 'node-account-same-release-1280', { fullPage: true });
        const issued = await runtime.identity.createPresenterSession('f550-node-outbox-presenter');
        assert.equal(issued.status, 'ok');
        const issuedCookies = Array.isArray(issued.value.setCookie) ? issued.value.setCookie : [issued.value.setCookie];
        await context.addCookies(issuedCookies.map((header) => {
          const cookie = header.split(';', 1)[0];
          return { name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
            url: origin, httpOnly: true, secure: true, sameSite: 'Lax' };
        }));
        const sourceResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/gcsp/presenter/outbox'
          && response.request().method() === 'GET');
        await page.goto(`${origin}/gcsp-outbox.html`, { waitUntil: 'domcontentloaded' });
        await page.locator('.gcsp-mail-status').first().waitFor();
        const response = await sourceResponse;
        const sourceValue = good({ status: response.status(), body: await response.json() }, 'Actual frozen outbox read');
        const sourceMessages = sourceValue.messages;
        const source = await assertChips(page, sourceMessages);
        const sourceMessage = sourceMessages.find((message) => decodeURIComponent(message.offerLink ?? '').includes(receipt.offer.offerId));
        const angularMessage = messages.find((message) => decodeURIComponent(message.offerLink ?? '').includes(state.offer.offerRef.offerId));
        assert.ok(sourceMessage && angularMessage, 'Both real outboxes contain the email for their actual current held offer');
        assert.equal(sourceMessage.messageKind, angularMessage.messageKind);
        assert.equal(sourceMessage.recipient.employeeId, angularMessage.recipient.employeeId);
        assert.equal(sourceMessage.state, angularMessage.state); assert.equal(sourceMessage.transport, angularMessage.transport);
        const reference = source.find((chip) => chip.jobId === sourceMessage.jobId);
        const actual = angular[messages.indexOf(angularMessage)]; assert.ok(reference);
        assert.equal(reference.label, actual.label); assert.equal(reference.className, actual.className);
        assert.deepEqual(reference.paths, actual.paths); assert.deepEqual(reference.svg, actual.svg);
        assert.equal(reference.color, actual.color); assert.equal(reference.background, actual.background);
        return { liveRefresh: { account, outbox: await capture(suite, page, 'node-outbox-same-release-1280'), chips: source,
          actualMessages: sourceMessages.map(({ jobId, messageKind, recipient, state, transport }) =>
            ({ jobId, messageKind, recipient: recipient.employeeId, state, transport })),
          inventory: { angular: messages.length, frozen: sourceMessages.length, equal: messages.length === sourceMessages.length,
            scope: 'All actual rows retained; current held-offer chip compared. No whole-outbox inventory parity claim.' },
          matchedCurrentOfferChip: { angular: angularMessage.jobId, frozen: sourceMessage.jobId },
          initialEntries: ['employee account', 'new actual presenter session, initial outbox entry'],
          clock: receipt.tick, parity: 'engineering same-release pair; human review pending' } };
      });
      assert.equal(replay.state, 'matched', 'A live frozen same-input runtime is required for the engineering pair');
      evidence.frozen = { state: replay.state, pair: replay.liveRefresh, humanAcceptance: 'pending' };
      await presenter.getByRole('link', { name: 'Presenter controls', exact: true }).click();
      await presenter.getByRole('button', { name: 'Next release', exact: true }).waitFor();
    });

    await group('AC1: Your cars, Activity and offer each re-read on all four triggers', async () => {
      await readerMatrix(suite, employee, presenter, { name: 'account', heading: 'Your cars', root: '.account-screen',
        paths: ['/manual/account'], assertView: async () => {
          await employee.getByRole('heading', { name: 'A car is held for you', exact: true }).waitFor();
        } }, evidence);
      await employee.goto(`${suite.origins.web}/gcsp/activity`, { waitUntil: 'domcontentloaded' });
      await readerMatrix(suite, employee, presenter, { name: 'activity', heading: 'Your buddy', root: '.activity-page',
        paths: ['/activity', offerPath(state.offer)], assertView: async () => {
          const link = employee.locator('.activity-page').getByRole('link', { name: 'View offer', exact: true });
          await link.waitFor();
          assert.equal(decodeURIComponent(new URL(await link.getAttribute('href'), employee.url()).pathname),
            `/gcsp/offers/${state.offer.offerRef.offerId}`);
          assert.ok((await employee.locator('.activity-offer-name').innerText()).trim());
        } }, evidence);
      await employee.goto(`${suite.origins.web}/gcsp${offerPath(state.offer)}`, { waitUntil: 'domcontentloaded' });
      await readerMatrix(suite, employee, presenter, { name: 'offer', heading: 'Your offer', root: '.gcsp-offer-body',
        paths: [offerPath(state.offer)], assertView: async () => {
          await employee.getByRole('button', { name: 'Review & accept', exact: true }).waitFor();
          assert.equal(decodeURIComponent(new URL(employee.url()).pathname), `/gcsp/offers/${state.offer.offerRef.offerId}`);
        } }, evidence);
      evidence.bellExclusion = 'Activity requires its route-owned offer-display GET as well as activity GET; bell-only activity reads cannot satisfy it.';
    });

    await group('AC2: public acceptance then presenter action updates an already-open order screen and announces once', async () => {
      await employee.goto(`${suite.origins.web}/gcsp${offerPath(state.offer)}`, { waitUntil: 'domcontentloaded' });
      await settled(employee, 'Your offer', '.gcsp-offer-body');
      orderPage = await suite.newPage('orders', 'demo-paula', 'orders');
      await orderPage.getByRole('heading', { name: 'No orders to track', exact: true }).waitFor();
      const url = orderPage.url();
      evidence.orderChange = { before: await capture(suite, orderPage, 'orders-before-acceptance-1280') };
      evidence.orderChange.acceptance = await accept(suite, employee, state.offer);
      const journal = watchReads(orderPage, suite.apiBase, ['/orders/progress/all', ...orderSections]);
      try {
        evidence.orderChange.presenterAction = await step(suite, presenter);
        await orderPage.locator('.order-summary').waitFor();
        await until(async () => (await orderPage.locator('.order-feedback').innerText()).trim() === 'Order progress updated.',
          'The already-open order page announces its actual changed ready projection');
        assert.equal(orderPage.url(), url); await journal.flush();
        const progress = journal.rows.findLast((row) => row.path === '/orders/progress');
        assert.ok(progress); assert.equal(progress.body.status, 'ok');
        assert.equal(progress.body.value.orderUuid, state.offer.orderUuid);
        assert.equal(progress.body.value.runId, suite.receipt.composition.runId);
        assert.ok(await orderPage.locator('.stage-list li').count() > 0);
        evidence.orderChange.actual = progress.body.value;
        evidence.orderChange.sections = Object.fromEntries(orderSections.map((route) => {
          const row = journal.rows.findLast((item) => item.path === route);
          assert.ok(row); return [route, row.body];
        }));
        evidence.orderChange.sectionHttp = Object.fromEntries(orderSections.map((route) => {
          const row = journal.rows.findLast((item) => item.path === route);
          assert.ok(row.status === 200 && row.body.status === 'ok'
            || route === '/appointments' && row.status === 503 && row.body.status === 'unavailable',
          `${route}: actual ordinary producer result is retained; authority/run failures are never accepted`);
          return [route, row.status];
        }));
        evidence.orderChange.after = await capture(suite, orderPage, 'orders-after-presenter-action-1280');
      } finally { await journal.stop(); }
      const silence = watchReads(orderPage, suite.apiBase, ['/orders/progress']);
      try {
        await orderPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await until(() => silence.rows.length > 0, 'Unchanged reread reaches the actual order producer');
        await silence.flush();
        await until(async () => !(await orderPage.locator('.order-feedback').innerText()).trim(), 'Unchanged re-read stays silent');
        assert.equal(semantic(silence.rows.at(-1).body.value), semantic(evidence.orderChange.actual));
        evidence.orderChange.unchanged = { status: 'real unchanged reread is silent', asOf: silence.rows.at(-1).body.value.asOf };
      } finally { await silence.stop(); }
      const clockChange = watchReads(orderPage, suite.apiBase, orderSections);
      try {
        const before = good(await suite.call(presenter, 'GET', '/presenter/clock'), 'Clock before time-only advance');
        const summary = presenter.getByText('Advanced clock controls', { exact: true });
        if (!await summary.evaluate((node) => node.parentElement.open)) await summary.click();
        await presenter.getByLabel('Seconds', { exact: true }).fill('1');
        await presenter.getByRole('button', { name: 'Advance clock', exact: true }).click();
        let clock;
        await until(async () => {
          clock = good(await suite.call(presenter, 'GET', '/presenter/clock'), 'Clock after time-only advance');
          return Number(clock.clockVersion) > Number(before.clockVersion);
        }, 'Public time-only advance completes without a tick');
        await until(() => orderSections.every((route) => clockChange.rows.some((row) => row.path === route)),
          'Time-only presenter action re-reads all four actual order producers');
        await clockChange.flush(); await settled(orderPage, 'Order progress', '.orders-screen');
        const after = Object.fromEntries(orderSections.map((route) => [route, clockChange.rows.findLast((row) => row.path === route).body]));
        evidence.orderChange.clockChange = { before: evidence.orderChange.sections, after, clock,
          announcement: (await orderPage.locator('.order-feedback').innerText()).trim(),
          scope: 'A real one-second clock advance. Documents now also changes and stages has no asOf; this does not supply an asOf-only scenario. Named focused order specs retain that boundary.' };
        assert.equal(Date.parse(clock.now) - Date.parse(before.now), 1000);
        assert.equal(orderPage.url(), url);
        for (const route of orderSections) {
          const row = clockChange.rows.findLast((item) => item.path === route);
          assert.ok(row.status === 200 && row.body.status === 'ok'
            || route === '/appointments' && row.status === 503 && row.body.status === 'unavailable'
              && row.body.code === 'appointments-provider-not-configured', `${route}: actual clock-change read retains its contract`);
        }
        assert.equal(after['/orders/progress'].value.orderUuid, state.offer.orderUuid);
        assert.equal(after['/orders/progress'].value.runId, suite.receipt.composition.runId);
      } finally { await clockChange.stop(); }
      await employee.close(); employee = null;
      await readerMatrix(suite, orderPage, presenter, { name: 'orders', heading: 'Order progress', root: '.orders-screen',
        paths: ['/orders/progress/all', ...orderSections], unavailablePaths: ['/appointments'], assertView: async () => {
          await orderPage.locator('.order-summary').waitFor(); assert.ok(await orderPage.locator('.stage-list li').count() > 0);
        } }, evidence);
      await orderPage.close(); orderPage = null;
    });

    await group('AC1/4: outbox uses actual presenter authority and all four refresh triggers', async () => {
      const outbox = await suite.newPage('outbox', 'demo-presenter', 'presenter/outbox');
      try {
        await readerMatrix(suite, outbox, presenter, { name: 'outbox', heading: 'Captured emails', root: '.gcsp-presenter',
          paths: ['/presenter/outbox'], assertView: async () => { await outbox.locator('.gcsp-mail-status').first().waitFor(); } }, evidence);
        evidence.outbox.finalActual = await assertChips(outbox, await actualOutbox(suite, outbox));
      } finally { await outbox.close(); }
    });

    await group('AC3: shared-service integration covers the five route owners', () => {
      assert.deepEqual(Object.keys(evidence.readers).sort(), ['account', 'activity', 'offer', 'orders', 'outbox']);
      assert.ok(Object.values(evidence.readers).every((triggers) => triggers.length === 4));
      evidence.acceptance.sharedService = 'Five connected reader matrices supplement existing focused LiveRefreshService specs for one timer, subscriptions and teardown; no browser-wide timer-count claim. Bell timer excluded.';
    });
    assert.deepEqual(suite.receipt.consoleErrors, [], 'No checked Angular runtime errors');
  } catch (error) {
    suite.receipt.failure = { name: error.name, message: error.message.slice(0, 1000) }; throw error;
  } finally { await orderPage?.close(); await suite.close(); }
});
