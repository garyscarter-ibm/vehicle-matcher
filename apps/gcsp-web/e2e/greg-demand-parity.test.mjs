import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startComposition } from './composition.mjs';

const tabs = ['Next order', 'Demand and supply', 'Policy', 'Order requests', 'Route comparison', 'Renewal cases'];
const labels = ['Active briefs', 'Briefs with no suitable car', 'Offers made', 'Selected'];
const captions = ['By model line', 'By body style', 'By fuel type', 'By essential requirement',
  'Briefs with no suitable car, by gate', 'Stock by model line', 'Declined offers, by reason'];
const good = (response, label) => {
  assert.equal(response.status, 200, label); assert.equal(response.body?.status, 'ok', label);
  return response.body.value;
};
const serviceGood = (response, label) => { assert.equal(response.status, 'ok', label); return response.value; };
async function until(check, message) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(message);
}
function privacy(value) {
  if (!value || typeof value !== 'object') return;
  if (value.kind === 'band') assert.equal(Object.hasOwn(value, 'value'), false, 'A privacy band contains no hidden exact value');
  for (const child of Object.values(value)) privacy(child);
}
// Compare public facts, excluding engine-local projection digests/revisions and presentation labels.
function facts(value) {
  const count = evidence => evidence.count;
  const groups = rows => rows.map(row => ({ key: row.key, count: count(row) })).sort((a, b) => a.key.localeCompare(b.key));
  return {
    runId: value.runId, asOf: value.asOf, clock: String(value.versions.clock), policy: [...value.versions.policy].sort(),
    threshold: value.privacy.threshold, active: count(value.demand.activeBriefs), unmet: count(value.demand.unmet.total),
    models: groups(value.demand.byModelLine), bodies: groups(value.demand.byBody), fuels: groups(value.demand.byFuel),
    essentials: value.demand.essentials.map(row => ({ field: row.field, operator: row.operator, value: row.value,
      unit: row.unit, state: row.state, count: count(row) })), gates: groups(value.demand.unmet.byGate),
    offers: Object.fromEntries(['made', 'accepted', 'declined', 'expired', 'selected'].map(key => [key, count(value.offers[key])])),
    declinedByReason: groups(value.offers.declinedByReason),
    stock: value.stock.byModelLine.map(row => ({ key: row.key, released: count(row.released), held: count(row.held),
      allocated: count(row.allocated) })).sort((a, b) => a.key.localeCompare(b.key)), source: value.stock.source,
  };
}
async function composition(page, root) {
  await root.locator('.gcsp-greg-headline .gcsp-tile').first().waitFor();
  const navigation = page.getByRole('tablist', { name: 'Employee car ordering', exact: true });
  assert.deepEqual((await navigation.getByRole('tab').allTextContents()).map(text => text.trim()), tabs);
  const structure = await root.evaluate(node => ({
    sections: [...node.querySelectorAll('.gcsp-greg-section:not(.gcsp-greg-region) > .gcsp-greg-h2')].map(h => h.textContent.trim()),
    headline: [...node.querySelectorAll('.gcsp-greg-headline .gcsp-tile-label')].map(h => h.textContent.trim()),
    offers: [...node.querySelectorAll('.gcsp-greg-tiles .gcsp-tile-label')].map(h => h.textContent.trim()),
    captions: [...node.querySelectorAll('table caption')].map(h => h.textContent.trim()),
    grid: [...node.querySelectorAll('.gcsp-greg-grid > .gcsp-greg-section, .gcsp-greg-grid > * > .gcsp-greg-section')]
      .map(section => section.querySelector('.gcsp-greg-h2')?.textContent.trim()),
    columns: [...node.querySelectorAll('table')].map(table => [...table.querySelectorAll('thead th')].map(cell => cell.textContent.trim())),
    rows: [...node.querySelectorAll('table')].map(table => [...table.querySelectorAll('tbody tr')].map(row =>
      [...row.querySelectorAll('th,td')].map(cell => ({
        // Separate visual and spoken bands; normalize template whitespace and retained final punctuation.
        label: (cell.querySelector('.gcsp-vh')?.textContent ?? cell.textContent).replace(/\s+/g, ' ').trim().replace(/\.$/, ''),
        visualBand: cell.querySelector('[aria-hidden="true"]')?.textContent ?? null,
        band: cell.getAttribute('data-band') === 'true',
      })))),
  }));
  assert.deepEqual(structure.sections, ['At a glance', 'Demand', 'Unmet needs', 'Stock', 'Offers']);
  assert.deepEqual(structure.headline, labels);
  assert.deepEqual(structure.offers, ['Offers made', 'Accepted', 'Declined', 'Expired', 'Selected']);
  assert.deepEqual(structure.captions, captions);
  assert.deepEqual(structure.grid, ['Unmet needs', 'Stock']);
  assert.equal(await root.locator('.gcsp-tile-headline').count(), 4);
  assert.equal(await root.locator('.gcsp-tile-standard').count(), 5);
  assert.equal(await root.locator('.gcsp-greg-tables .gcsp-table').count(), 3);
  return structure;
}
async function displayedCounts(root, value) {
  const all = [value.demand.activeBriefs, value.demand.unmet.total, value.offers.made, value.offers.selected,
    ...['made', 'accepted', 'declined', 'expired', 'selected'].map(key => value.offers[key])];
  const tiles = root.locator('.gcsp-greg-headline .gcsp-tile, .gcsp-greg-tiles .gcsp-tile');
  assert.equal(await tiles.count(), all.length);
  for (let index = 0; index < all.length; index++) {
    const count = all[index].count; const tile = tiles.nth(index); const figure = tile.locator('.gcsp-tile-figure');
    assert.equal(await figure.getAttribute('data-band'), count.kind === 'band' ? 'true' : null);
    if (count.kind === 'band' && Number.isFinite(count.fewerThan)) {
      assert.equal(await figure.locator('[aria-hidden="true"]').textContent(), `<${count.fewerThan}`);
      assert.equal(await figure.locator('.gcsp-vh').textContent(), count.label,
        'The spoken band is the supplied label, once, without an inferred exact number');
    } else assert.equal((await figure.textContent()).trim(), count.label);
  }
  return all.map(item => item.count);
}
async function capture(suite, page, prefix) {
  const shots = {};
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
      `The real ${prefix} dashboard fits ${width}px; data tables may scroll within their named regions`);
    shots[width] = await suite.screenshot(page, `${prefix}-${width}`, { fullPage: true });
  }
  return shots;
}
async function keyboard(page, root) {
  // The demand view's read-only tiles need no extra tab stops. Tables remain keyboard-scrollable regions.
  const region = root.getByRole('region', { name: 'By model line', exact: true });
  assert.equal(await region.getAttribute('tabindex'), '0');
  await region.focus(); await region.press('ArrowRight');
  assert.equal(await region.evaluate(node => document.activeElement === node), true);
  const demand = page.getByRole('tab', { name: 'Demand and supply', exact: true });
  await demand.focus(); await demand.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Policy', exact: true }).evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('ArrowLeft');
  await until(async () => await demand.getAttribute('aria-selected') === 'true', 'Keyboard returns to the demand tab');
  assert.equal(await demand.evaluate(node => document.activeElement === node), true);
}
async function signInFrozenGreg(replay) {
  const reference = process.env.GCSP_NODE_REFERENCE;
  const load = file => import(pathToFileURL(path.join(reference, file)).href);
  const [{ loadDemoPrincipalSeed }, { demoLoginProfile }] = await Promise.all([
    load('server/gcsp/fixtures/principals.js'), load('server/gcsp/identity/login-adapter.js')]);
  const { runtime, repository, control, origin, context } = replay;
  const clock = serviceGood(await runtime.clock.now(control), 'Frozen released clock');
  const seed = serviceGood(await loadDemoPrincipalSeed(runtime.policy, { runId: control.runId,
    asOf: clock.now, policyVersion: control.policyVersion }), 'Frozen configured principals');
  const principal = seed.principals.find(row => row.roles.includes('greg')); assert.ok(principal);
  const stored = serviceGood(await repository.read(control, { table: 'employees', key: {
    runId: control.runId, employeeId: principal.employeeId } }), 'Frozen configured Greg');
  const profile = demoLoginProfile(principal, stored);
  // Same existing in-memory demo verifier as F559; credentials never enter receipts, arguments or logs.
  const password = /digest\('([^']+)'\)/.exec(readFileSync(path.join(reference, 'server/gcsp/identity/login-adapter.js'), 'utf8'))?.[1];
  assert.ok(password);
  const signed = serviceGood(await runtime.identity.signIn({ email: profile.email, password }, 'f558-real-greg'), 'Frozen real Greg login');
  assert.ok(signed.context.roles.includes('greg')); assert.ok(!signed.context.roles.includes('presenter'));
  const cookies = (Array.isArray(signed.setCookie) ? signed.setCookie : [signed.setCookie])
    .filter(cookie => cookie && !/Max-Age=0(?:;|$)/i.test(cookie));
  await context.addCookies(cookies.map(cookie => {
    const pair = cookie.split(';', 1)[0]; const at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin, httpOnly: true, secure: true, sameSite: 'Lax' };
  }));
}

test('FUCQ-558: Greg demand tiles and composition after the same actual release, frozen Node and Angular',
  { timeout: 480000 }, async t => {
    const suite = await startComposition({ caseId: 'f558' }); t.after(() => suite.close());
    const evidence = suite.receipt.gregDemand = { scenario: 'Main initial inputs and actual public release', screenshots: {},
      pairs: [], humanReview: { reviewer: '', date: '', verdict: '', source: '' },
      limitations: ['Automated checks and captures do not satisfy the original human-reviewed screenshot criterion.',
        'Angular retains its existing provenance/version facts and refusal wording; metadata copy differs from the frozen dashboard.',
        'Empty-brief, stock-source unavailable/stale and stale-run screen states remain covered by focused component tests; this case claims no connected proof of those states.'] };
    const presenter = await suite.newPage('presenter-demand', 'demo-presenter', 'presenter');
    const paula = await suite.newPage('employee-demand', 'demo-paula', 'preferences');
    const greg = await suite.newPage('greg-demand', 'demo-greg', 'greg');
    const root = greg.locator('gcsp-greg-demand');
    await t.test('Actual pre-release unchecked stock and role refusal are distinct from the happy path', async () => {
      const before = good(await suite.call(greg, 'GET', '/greg/demand'), 'Greg initial demand API');
      evidence.beforeRelease = before; privacy(before);
      assert.deepEqual(before.stock.byModelLine, [], 'The actual owned run starts without released stock');
      assert.equal(before.stock.source.status, 'not-checked', 'No release pull has run yet; an empty list does not prove an empty source');
      await root.getByRole('table', { name: 'Stock by model line', exact: true })
        .getByText('New stock could not be checked.', { exact: true }).waitFor();
      evidence.screenshots.beforeRelease = await suite.screenshot(greg, 'angular-demand-before-release-1280', { fullPage: true });
      const denied = await suite.call(paula, 'GET', '/greg/demand');
      assert.equal(denied.status, 403); assert.equal(denied.body.status, 'forbidden');
      evidence.employeeDemandRefusal = denied;
    });
    const released = await suite.releaseMainOffer(paula, presenter);
    await greg.reload({ waitUntil: 'domcontentloaded' });
    const demand = good(await suite.call(greg, 'GET', '/greg/demand'), 'Greg actual post-release demand API');
    evidence.postRelease = demand; privacy(demand);
    assert.equal(demand.asOf, released.clock.now);
    assert.equal(String(demand.versions.clock), String(released.clock.clockVersion));
    assert.ok(demand.stock.byModelLine.length > 0, 'This is a real released-stock dashboard, not an empty fixture');
    assert.ok(demand.demand.byModelLine.length > 0, 'Confirmed initial demand participates in the real projection');
    assert.ok(demand.projectionVersion && demand.versions.policy.length);
    await t.test('AC1/2 engineering: headline/offer tiles, source sections, tables, grid and tab order', async () => {
      evidence.angularStructure = await composition(greg, root);
      evidence.angularCounts = await displayedCounts(root, demand);
      evidence.screenshots.angular = await capture(suite, greg, 'angular-demand-post-release');
      await keyboard(greg, root);
    });
    await t.test('AC3 evidence: live frozen Node has matching public facts and the same 1280/375 dashboard', async () => {
      const replay = await suite.visitFrozenNode({ clock: released.clock, orderUuid: released.offer.orderUuid,
        expiresAt: released.offer.expiresAt, hold: released.hold, finalAccount: released.account }, async source => {
        await signInFrozenGreg(source);
        const page = source.page;
        await page.goto(`${source.origin}/gcsp-greg.html`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('tab', { name: 'Demand and supply', exact: true }).click();
        const response = await page.evaluate(async () => {
          const actual = await fetch('/api/gcsp/greg/demand', { credentials: 'include', cache: 'no-store' });
          return { status: actual.status, body: await actual.json() };
        });
        const value = good(response, 'Frozen real Greg demand API'); privacy(value);
        assert.deepEqual(facts(value), facts(demand), 'Same input/release services produce the same band-safe public demand facts');
        const nodeRoot = page.locator('.gcsp-greg-figures');
        const structure = await composition(page, nodeRoot);
        assert.deepEqual(structure, evidence.angularStructure);
        const counts = await displayedCounts(nodeRoot, value);
        assert.deepEqual(counts, evidence.angularCounts);
        const screenshots = await capture(suite, page, 'node-demand-post-release');
        await keyboard(page, nodeRoot);
        return { gregDemand: { response, structure, counts, screenshots, realGregLogin: true } };
      });
      assert.equal(replay.state, 'matched', 'Frozen live runtime is required; absence is never a parity pass');
      evidence.node = replay.gregDemand;
      evidence.pairs = [1280, 375].map(width => ({ screen: 'greg-demand', state: 'post-release',
        scenario: evidence.scenario, viewport: `${width}x${width === 1280 ? 800 : 812}`,
        angular: evidence.screenshots.angular[width], node: replay.gregDemand.screenshots[width],
        reviewer: '', date: '', verdict: '', source: '' }));
      const output = path.dirname(evidence.screenshots.angular[1280]);
      evidence.pairLedger = path.join(output, 'greg-demand-pairs.json');
      writeFileSync(evidence.pairLedger, JSON.stringify({ sourceRevision: suite.receipt.sourceRevision,
        reference: suite.input.reference.commit, pairs: evidence.pairs }, null, 2));
      assert.deepEqual(suite.receipt.consoleErrors, []);
    });
    await t.test('An actual demand transport failure clears the figures and deliberate refresh recovers', async () => {
      const block = route => route.abort('failed');
      await greg.route('**/greg/demand', block);
      try {
        await greg.getByRole('button', { name: 'Refresh demand and policy', exact: true }).click();
        await root.getByRole('heading', { name: 'Demand figures unavailable', exact: true }).waitFor();
        assert.equal(await root.locator('.gcsp-tile').count(), 0, 'Failed fresh read displays no apparently current figures');
        evidence.transportFailure = { kind: 'actual browser transport aborted; no response substituted',
          screenshot: await suite.screenshot(greg, 'angular-demand-transport-unavailable-375', { fullPage: true }) };
      } finally { await greg.unroute('**/greg/demand', block); }
      await greg.getByRole('button', { name: 'Refresh demand and policy', exact: true }).click();
      await root.locator('.gcsp-greg-headline .gcsp-tile').first().waitFor();
      assert.deepEqual(await displayedCounts(root, good(await suite.call(greg, 'GET', '/greg/demand'), 'Recovered actual demand')), evidence.angularCounts);
    });
  });
