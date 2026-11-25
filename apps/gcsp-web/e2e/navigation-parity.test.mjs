import assert from 'node:assert/strict';
import test from 'node:test';
import { startComposition } from './composition.mjs';

const views = [
  ['Next order', '/gcsp/greg/plan', ''],
  ['Demand and supply', '/gcsp/greg', ''],
  ['Policy', '/gcsp/greg', '#policy'],
  ['Order requests', '/gcsp/greg/plan', '#gcsp-order-requests'],
  ['Route comparison', '/gcsp/comparison', ''],
  ['Renewal cases', '/gcsp/greg/cases', ''],
];
const good = (response, name) => {
  assert.equal(response.status, 200, name);
  assert.equal(response.body.status, 'ok', name);
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
const locationOf = (page) => { const url = new URL(page.url()); return { path: url.pathname, hash: url.hash }; };
async function rail(page, label) {
  await page.locator('.gcsp-nav-btn .gcsp-nav-label').filter({ hasText: new RegExp(`^${label}$`) }).click();
}
async function arrived(page, pathname, hash = '') {
  await until(() => { const actual = locationOf(page); return actual.path === pathname && actual.hash === hash; },
    `A visible control must reach ${pathname}${hash}`);
}
async function screenshot(suite, page, name) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await until(async () => await page.locator('[aria-busy="true"]:visible').count() === 0,
    'Navigation capture waits for the visible application read to settle');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => [...document.images].filter((image) => {
    const box = image.getBoundingClientRect();
    return image.loading !== 'lazy' || box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  }).every((image) => image.complete), null, { timeout: 15000 });
  return suite.screenshot(page, name);
}
async function crumbs(page, labels) {
  const trail = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
  await trail.waitFor();
  assert.deepEqual((await trail.locator('.gcsp-crumb').allTextContents()).map((label) => label.trim()), labels);
  assert.equal(await trail.locator('.gcsp-crumb').last().getAttribute('aria-current'), 'page');
  return labels;
}
async function buddyContent(page) {
  const tile = page.locator('.gcsp-buddy-tile');
  await tile.getByRole('heading', { name: 'Recent activity', exact: true }).waitFor();
  await until(async () => await tile.getAttribute('data-state') !== 'loading', 'Buddy tile loads its actual activity');
  const before = locationOf(page);
  const recent = await tile.locator('.gcsp-activity-timeline').allTextContents();
  assert.equal(recent.length, 1, 'The real recent-activity section is rendered');
  await tile.getByRole('button', { name: 'Buddy history', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Buddy history', exact: true });
  await drawer.getByRole('heading', { name: 'Activity history', exact: true }).waitFor();
  const history = await drawer.innerText();
  assert.deepEqual(locationOf(page), before, 'Source Buddy history is an in-page drawer');
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await drawer.waitFor({ state: 'hidden' });
  return { recent, history, before, after: locationOf(page),
    destination: 'Buddy history drawer; recent activity is inline content, neither action navigates to /activity' };
}
async function openBellOffer(page) {
  await page.getByRole('button', { name: 'Notifications, 1 car offer waiting', exact: true }).click();
  const action = page.locator('.gcsp-bell-panel').getByRole('link', { name: 'View your offer', exact: true });
  await action.waitFor();
  const href = await action.getAttribute('href');
  await action.click();
  await page.getByRole('heading', { name: 'Your offer', exact: true, level: 1 }).waitFor();
  return { href, destination: locationOf(page), action: 'View your offer' };
}

async function gregTabs(page, angular) {
  const list = page.getByRole('tablist', { name: 'Employee car ordering', exact: true });
  await list.waitFor();
  assert.deepEqual(await list.getByRole('tab').allTextContents(), views.map(([label]) => label));
  await page.getByRole('heading', { name: 'Next order', exact: true, level: 1 }).waitFor();
  const entries = [];
  for (const [label, pathname, hash] of [...views.slice(1), views[0]]) {
    const tab = list.getByRole('tab', { name: label, exact: true });
    await tab.click();
    await until(async () => await list.getByRole('tab', { name: label, exact: true }).getAttribute('aria-selected') === 'true',
      `${label} is selected after its real tab click`);
    await page.getByRole('heading', { name: label, exact: true, level: 1 }).waitFor();
    if (angular) await arrived(page, pathname, hash);
    entries.push({ label, destination: locationOf(page), selected: true });
  }
  return entries;
}

test('FUCQ-549: live employee and Greg navigation and original off-rail context', { timeout: 540000 }, async (t) => {
  const suite = await startComposition({ caseId: 'f549' });
  t.after(() => suite.close());
  const evidence = suite.receipt.navigation = { initialEntries: [], journeys: {}, screenshots: {},
    humanAcceptance: 'pending Gary/Russell review; automated captures do not satisfy AC4',
    original_ac1_route_gap: {
      state: 'unresolved; original AC1 remains unchecked',
      basis: 'Frozen and Angular Buddy history opens a drawer, recent activity is inline, and the active bell opens Your offer. These do not prove /activity route reachability from those entry points.',
      originalCriterionPreserved: true,
    },
  };
  const group = (name, action) => t.test(name, async () => {
    try { await action(); }
    catch (error) {
      (evidence.failures ??= []).push({ group: name, name: error.name, message: error.message.slice(0, 1000) });
      throw error;
    }
  });
  const employee = await suite.newPage('employee', 'demo-paula', '');
  await arrived(employee, '/gcsp/account');
  const presenter = await suite.newPage('presenter', 'demo-presenter', '');
  await arrived(presenter, '/gcsp/presenter');
  evidence.initialEntries.push({ role: 'employee', route: '/gcsp/', landed: locationOf(employee), login: 'real local OIDC' },
    { role: 'presenter', route: '/gcsp/', landed: locationOf(presenter), login: 'real local OIDC' });
  const state = await suite.releaseMainOffer(employee, presenter);
  await employee.reload({ waitUntil: 'domcontentloaded' });
  evidence.actualReadbacks = {
    context: good(await suite.call(employee, 'GET', '/context'), 'Actual employee context'),
    account: good(await suite.call(employee, 'GET', '/manual/account'), 'Actual employee account'),
    brief: good(await suite.call(employee, 'GET', '/brief'), 'Actual employee brief'),
    clock: good(await suite.call(presenter, 'GET', '/presenter/controls'), 'Actual presenter clock'),
  };
  assert.equal(evidence.actualReadbacks.account.asOf, state.clock.now);
  assert.equal(String(evidence.actualReadbacks.account.versions.clock), String(state.clock.clockVersion));

  await group('AC1 source controls: employee rail, Buddy recent activity and history drawer', async () => {
    assert.deepEqual(await employee.locator('.gcsp-nav-btn .gcsp-nav-label').allTextContents(), ['Your cars', 'Order progress']);
    evidence.screenshots.angularEmployee = await screenshot(suite, employee, 'angular-employee-navigation-1280');
    evidence.journeys.angularBuddy = await buddyContent(employee);
    await rail(employee, 'Order progress'); await arrived(employee, '/gcsp/orders');
    await employee.getByRole('heading', { name: 'Order progress', exact: true, level: 1 }).waitFor();
    await rail(employee, 'Your cars'); await arrived(employee, '/gcsp/account');
    evidence.journeys.angularRail = ['Order progress', 'Your cars'];
  });

  await group('AC3: active bell reaches owned offer with visible breadcrumb', async () => {
    await rail(employee, 'Your cars'); await arrived(employee, '/gcsp/account');
    evidence.journeys.angularBell = await openBellOffer(employee);
    assert.equal(locationOf(employee).path, `/gcsp/offers/${state.offer.offerRef.offerId}`);
    evidence.journeys.angularBell.breadcrumbs = await crumbs(employee, ['Your cars', 'Your offer']);
    evidence.screenshots.angularOffer = await screenshot(suite, employee, 'angular-offer-breadcrumb-1280');
  });

  await group('AC3: presenter reaches Captured emails from controls with visible breadcrumb', async () => {
    await presenter.getByRole('link', { name: 'Outbox', exact: true }).click();
    await arrived(presenter, '/gcsp/presenter/outbox');
    evidence.journeys.angularOutbox = { destination: locationOf(presenter), breadcrumbs: await crumbs(presenter, ['Presenter controls', 'Captured emails']) };
    evidence.screenshots.angularOutbox = await screenshot(suite, presenter, 'angular-outbox-breadcrumb-1280');
  });

  await group('AC2: Greg lands Next order and clicks all six original sections', async () => {
    const greg = await suite.newPage('greg', 'demo-greg', '');
    evidence.initialEntries.push({ role: 'greg', route: '/gcsp/', landed: locationOf(greg), login: 'real local OIDC' });
    await arrived(greg, '/gcsp/greg/plan');
    const actualContext = good(await suite.call(greg, 'GET', '/context'), 'Actual Greg context');
    assert.equal(actualContext.subject, 'demo-greg');
    assert.deepEqual([...actualContext.roles].sort(), ['employee', 'greg']);
    evidence.journeys.angularGregContext = actualContext;
    assert.deepEqual(await greg.locator('.gcsp-nav-btn .gcsp-nav-label').allTextContents(), ['Your cars', 'Order progress', 'Employee car ordering']);
    evidence.journeys.angularGreg = await gregTabs(greg, true);
    evidence.screenshots.angularGreg = await screenshot(suite, greg, 'angular-greg-navigation-1280');
    await greg.close();
  });

  await group('AC4 engineering pairs: frozen live employee and Greg, same real release inputs', async () => {
    const replay = await suite.visitFrozenNode({ ...suite.receipt.offer, hold: state.hold, clock: state.clock,
      finalAccount: state.account }, async ({ page, context, origin, runtime, control, receipt }) => {
      receipt.navigation = { initialEntries: [], journeys: {}, screenshots: {}, humanAcceptance: 'pending',
        original_ac1_route_gap: evidence.original_ac1_route_gap };
      const source = receipt.navigation;
      await page.goto(`${origin}/gcsp-account.html`, { waitUntil: 'domcontentloaded' });
      source.initialEntries.push({ role: 'employee', path: '/gcsp-account.html', reason: 'Initial authenticated role landing only' });
      await page.getByRole('heading', { name: 'Your cars', exact: true, level: 1 }).waitFor();
      source.screenshots.employee = await screenshot(suite, page, 'node-employee-navigation-1280');
      source.journeys.buddy = await buddyContent(page);
      await rail(page, 'Order progress'); await arrived(page, '/gcsp-order-progress-live.html');
      await rail(page, 'Your cars'); await arrived(page, '/gcsp-account.html');
      source.journeys.rail = ['Order progress', 'Your cars'];
      source.journeys.bell = await openBellOffer(page);
      assert.equal(await page.locator('.gcsp-crumbs').count(), 0, 'Frozen single Your offer breadcrumb is suppressed');
      source.journeys.bell.breadcrumbs = { visible: false, basis: 'Frozen setBreadcrumbs suppresses single-item trails; Angular uses the recorded two-entry AC3 interpretation.' };
      source.screenshots.offer = await screenshot(suite, page, 'node-offer-breadcrumb-1280');
      const issued = await runtime.identity.switchPrincipal(control, 'demo-greg', 'f549-node-browser-greg');
      assert.equal(issued.status, 'ok', 'Real frozen Greg session');
      const cookie = issued.value.setCookie.split(';', 1)[0];
      await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
        url: origin, httpOnly: true, secure: true, sameSite: 'Lax' }]);
      await page.goto(`${origin}/gcsp-greg.html`, { waitUntil: 'domcontentloaded' });
      source.initialEntries.push({ role: 'greg', path: '/gcsp-greg.html', reason: 'Initial authenticated Greg role landing only; no direct destination navigation in tab journey' });
      source.journeys.greg = await gregTabs(page, false);
      source.screenshots.greg = await screenshot(suite, page, 'node-greg-navigation-1280');
      source.journeys.outbox = { state: 'unrun', reason: 'No source presenter-control link to outbox established; no direct URL substituted for a click.' };
      return { navigation: source };
    });
    assert.equal(replay.state, 'matched', 'Required engineering pairs need the frozen live runtime');
    evidence.pairs = [
      { role: 'employee', viewport: { width: 1280, height: 800 }, angular: evidence.screenshots.angularEmployee, node: replay.navigation.screenshots.employee },
      { role: 'greg', viewport: { width: 1280, height: 800 }, angular: evidence.screenshots.angularGreg, node: replay.navigation.screenshots.greg },
    ];
    for (const pair of evidence.pairs) assert.ok(pair.angular && pair.node, `Both ${pair.role} captures exist in this run`);
    evidence.pairReview = 'pending human review; original AC4 remains unchecked';
  });

  await group('AC1 runnable preferences exit reaches Activity through visible controls', async () => {
    // Keep the matched navigation captures above on the original Main inputs. As in F552,
    // complete the real Account minimum through public choices before explicitly engaging.
    await rail(employee, 'Your cars'); await arrived(employee, '/gcsp/account');
    const readEditor = async () => good(await suite.call(employee, 'GET', '/brief/editor'), 'Actual preference preparation');
    const before = await readEditor();
    const compact = employee.locator('.gcsp-prefs').first();
    for (const [key, label] of [['comfort', 'Comfort'], ['sportiness', 'Sportiness']]) {
      await compact.locator('.gcsp-prefs-open').filter({ hasText: label }).click();
      await until(async () => (await readEditor()).initial.accountPreferences.categories[key]?.state === 'considered', `${label} public choice is saved`);
      await until(async () => await compact.locator('.gcsp-understanding.is-pending').count() === 0, `${label} save has rendered`);
    }
    const prepared = await readEditor();
    assert.equal(prepared.initial.buddy.canEngage, true, 'Public choices satisfy the existing Account minimum');
    evidence.journeys.preferencesPreparation = { before: before.initial.buddy, after: prepared.initial.buddy,
      actions: ['Comfort', 'Sportiness'], pairCapturesCompletedBeforePreparation: true };
    await employee.getByRole('link', { name: 'Edit your preferences', exact: true }).click();
    await arrived(employee, '/gcsp/preferences');
    await employee.getByRole('button', { name: 'Refresh and review', exact: true }).click();
    await employee.getByRole('button', { name: 'Replace draft with saved preferences', exact: true }).click();
    await employee.getByRole('radio', { name: 'Engage Buddy', exact: true }).check();
    const confirmation = employee.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/brief/confirm') && response.request().method() === 'POST');
    await employee.getByRole('button', { name: 'Save your preferences', exact: true }).click();
    const response = await confirmation; const body = await response.json();
    evidence.journeys.preferenceConfirmation = { status: response.status(), outcome: body.status, problem: body.status === 'ok' ? null : body };
    assert.equal(response.status(), 200, 'Actual confirmation succeeds after the existing minimum is met');
    await employee.getByRole('link', { name: 'See your buddy at work', exact: true }).click();
    await arrived(employee, '/gcsp/activity');
    await employee.getByRole('heading', { name: 'Your buddy', exact: true, level: 1 }).waitFor();
    evidence.journeys.angularPreferences = { actions: ['Your cars', 'Comfort', 'Sportiness', 'Edit your preferences', 'Refresh and review', 'Replace draft with saved preferences', 'Engage Buddy', 'Save your preferences', 'See your buddy at work'], destination: locationOf(employee) };
  });
});
