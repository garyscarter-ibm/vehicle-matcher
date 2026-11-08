// FUCQ-220 browser check: order reference and car order number on the order screens, at 1280 and 375, with Tab-only keyboard passes.
// Run with `node --test` and TMPDIR set; memory runtime over HTTPS on 127.0.0.1:FUCQ220_PORT (8990-8999).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { startGcspDemo } from '../../../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../../../../server/gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from '../../../../server/test/helpers/local-https.js';
import { actAs, competingPolicy, good, jar, resetRun, tickTo, walkPaulasPath } from '../../../../server/test/helpers/gcsp-journey.js';

const OUT = fileURLToPath(new URL('./', import.meta.url));
const REL = 'docs/gcsp/evidence/fucq-220';
const PORT = Number(process.env.FUCQ220_PORT ?? 8990);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 375, height: 812 }];
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
// Static fixture pages (gcsp-order-progress.html is not served by the hosted demo), on FUCQ220_PORT + 1.
async function staticServer(t, port) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)); const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || path.includes('..')) { res.writeHead(403).end(); return; }
    let body; try { body = await readFile(file); } catch { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done)); t.after(() => new Promise((done) => server.close(done)));
  return `http://127.0.0.1:${port}`;
}
const REF = /^GCSP-\d{6}$/; const CAR = /^\d{7}$/;
const cookiesOf = (session, origin) => session.split('; ').map((pair) => { const at = pair.indexOf('='); return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }; });

// Order identity pairs in page order, optionally inside one scope.
const identityIn = (page, scope) => page.evaluate((sel) => [...(sel ? document.querySelectorAll(sel) : [document]).values()].flatMap((root) => [...root.querySelectorAll('dl > div')])
  .map((d) => [d.querySelector('dt')?.textContent.trim(), d.querySelector('dd')?.textContent.trim()])
  .filter(([label]) => label === 'Order reference' || label === 'Car order number'), scope);
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const settle = async (page, selector) => { try { await page.locator(selector).first().waitFor({ timeout: 30000 }); } catch (error) { console.error("SETTLE-FAIL", selector, (await page.locator("body").innerText()).slice(0, 1500)); throw error; } await page.waitForTimeout(800); };

// Tab from page load (cap 40) until the target label is focused; records each stop and whether a focus indicator is drawn.
async function tabThrough(page, target) {
  await page.evaluate(() => document.activeElement?.blur());
  const sequence = []; const noVisibleFocus = []; let reached = false;
  for (let n = 0; n < 40 && !reached; n += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.id || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60);
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      return { label, tag: el.tagName.toLowerCase(), visibleFocus: outline || style.boxShadow !== 'none', outline: `${style.outlineStyle} ${style.outlineWidth}`, boxShadow: style.boxShadow.slice(0, 60) };
    });
    if (!stop) { sequence.push('(page body)'); continue; }
    sequence.push(stop.label); if (!stop.visibleFocus) noVisibleFocus.push(stop.label);
    if (target && stop.label === target) reached = true;
  }
  return { target, reached, sequence, noVisibleFocus, visibleFocusEverywhere: noVisibleFocus.length === 0 };
}

test('FUCQ-220: order reference and car order number on every order screen', async (t) => {
  assert.ok(PORT >= 8990 && PORT <= 8999, 'port must be 8990 to 8999');
  assert.ok(PORT + 1 <= 8999, 'static fixture port is FUCQ220_PORT + 1');
  const staticOrigin = await staticServer(t, PORT + 1);
  const { seed, policy } = await competingPolicy();
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: PORT, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: createDemoStockProvider, adoptOfferJourney: true, policy, environmentId: 'fucq220', policyAsOf: seed.effectiveFrom, commandId: 'fucq220-bootstrap' } }));
  t.after(() => app.close());
  const f = { app, services: app.services, policy: app.services.policy, origin: app.origin, seed, counter: 0, presenter: null, context: null };
  f.api = async (path, { body, session, method } = {}) => {
    const response = await https.fetch(`${app.origin}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), timeoutMs: 60000,
      headers: { Origin: app.origin, Cookie: session ?? f.presenter, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, json: await response.json(), headers: response.headers };
  };
  f.reopenPresenter = async () => { const next = good(await f.services.identity.createPresenterSession(`presenter-${++f.counter}`)); f.presenter = jar(next.setCookie); f.context = next.context; };
  await f.reopenPresenter();

  // Manual journey: the API reaches a claimed car (draft, release, claim); the page then reviews and submits through its real controls.
  const toOrderReview = async (label) => {
    await resetRun(f, label); await tickTo(f, label, { mode: 'next-release' });
    const manual = await actAs(f, label, 'paula');
    const account = good((await f.api('/api/gcsp/manual/account', { session: manual })).json);
    const action = account.actions.find((e) => e.enabled); const driver = account.choices.drivers.find((e) => e.kind === 'employee');
    const option = account.choices.contractOptions.find((e) => e.schemeIds.includes(account.account.schemeId) && e.driverKinds.includes(driver.kind));
    const location = account.choices.collectionLocations.find((e) => e.contractOptionIds.includes(option.contractOptionId) && e.driverKinds.includes(driver.kind));
    const choices = { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId, slotId: action.slotId, schemeId: action.schemeId,
      driverId: driver.driverId, contractOptionId: option.contractOptionId, requestedCollectionDate: account.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
      brand: account.choices.brands[0], contact: account.account.contact, expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' };
    const send = async (path, body) => { const r = await f.api(path, { session: manual, body }); assert.equal(r.status, 200, `${path} ${JSON.stringify(r.json).slice(0, 300)}`); return good(r.json, path); };
    await send('/api/gcsp/manual/draft', { commandId: 'draft', expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices });
    const decision = good((await f.api('/api/gcsp/manual/stock', { session: manual })).json).decisions.find((row) => row.claimInput); assert.ok(decision, 'a claimable car');
    await send('/api/gcsp/manual/claim', { commandId: 'claim', ...decision.claimInput });
    return manual;
  };

  const profiles = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'fucq220-chrome-'));
  t.after(async () => { try { execFileSync('/usr/bin/pkill', ['-f', profiles]); } catch { /* none running */ } await rm(profiles, { recursive: true, force: true }); });
  const screens = []; const pageErrors = [];
  const record = (entry) => { screens.push(entry); return entry; };
  const withPage = async (viewport, cookies, run) => {
    const context = await chromium.launchPersistentContext(await mkdtemp(join(profiles, 'p-')), { executablePath: CHROME, headless: true, viewport, ignoreHTTPSErrors: true });
    try {
      await context.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; });
      await context.addCookies(cookies);
      const page = context.pages()[0] ?? await context.newPage(); page.on('pageerror', (e) => pageErrors.push(e.message));
      await run(page);
    } finally { await context.close(); }
  };
  const shoot = async (page, name, viewport) => { const file = `${viewport.width}-${name}.png`; await page.screenshot({ path: join(OUT, file), fullPage: true }); return `${REL}/${file}`; };
  // A reference row immediately followed by its car order number row (the car card may also list the car's own number).
  const hasPair = (pairs) => pairs.some(([l, v], i) => l === 'Order reference' && REF.test(v) && pairs[i + 1]?.[0] === 'Car order number' && CAR.test(pairs[i + 1][1]));
  const onlyCar = (pairs) => pairs.length > 0 && pairs.every(([l, v]) => l === 'Car order number' && CAR.test(v));

  // Screen 4: manual confirmation after Submit, Print order, print media.
  for (const viewport of VIEWPORTS) {
    const manual = await toOrderReview(`fucq220-manual-${viewport.width}`);
    await withPage(viewport, cookiesOf(manual, app.origin), async (page) => {
      await page.goto(`${app.origin}/gcsp-account.html`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Resume saved journey' }).click();
      await page.getByRole('heading', { name: 'Review your car', exact: true }).waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: 'Continue to order review' }).click();
      await page.getByRole('heading', { name: 'Review your order', exact: true }).waitFor({ timeout: 30000 });
      const boxes = page.locator('input[type="checkbox"][data-declaration]'); await boxes.first().waitFor({ timeout: 20000 });
      for (let i = 0; i < await boxes.count(); i += 1) await boxes.nth(i).check();
      const submit = page.getByRole('button', { name: 'Submit order', exact: true }); await submit.waitFor({ timeout: 20000 });
      for (let n = 0; n < 40 && await submit.isDisabled(); n += 1) await page.waitForTimeout(250);
      await submit.click(); await settle(page, '.gcsp-summary-outcome');
      const pairs = await identityIn(page, '.gcsp-summary-outcome'); const keyboard = await tabThrough(page, 'Print order');
      const entry = record({ screen: 4, name: 'manual-confirmation', viewport: viewport.width, url: '/gcsp-account.html (after Submit order)', identityFacts: pairs, overflowPx: await overflowOf(page), keyboard,
        screenshot: await shoot(page, 'manual-confirmation', viewport) });
      await page.getByRole('button', { name: 'Print order', exact: true }).click(); entry.printCalls = await page.evaluate(() => window.__printCalls);
      entry.pass = hasPair(pairs) && entry.printCalls === 1 && keyboard.reached && entry.overflowPx <= 0;
      if (viewport.width === 1280) {
        await page.emulateMedia({ media: 'print' });
        entry.printMedia = await page.evaluate(() => [...document.querySelectorAll('.gcsp-summary-outcome dl > div')].filter((d) => /^(Order reference|Car order number)$/.test(d.querySelector('dt')?.textContent.trim()))
          .map((d) => ({ label: d.querySelector('dt').textContent.trim(), displayed: getComputedStyle(d).display !== 'none' && d.getClientRects().length > 0, inHiddenAncestor: !!d.closest('.gcsp-print-hidden') })));
        entry.printScreenshot = await shoot(page, 'manual-confirmation-print-media', viewport); await page.emulateMedia({ media: null });
        entry.pass = entry.pass && entry.printMedia.length >= 2 && entry.printMedia.some((r) => r.label === "Order reference") && entry.printMedia.every((r) => r.displayed && !r.inHiddenAncestor);
      }
    });
  }

  // Buddy handoff (screens 1, 2, 3, 5 and the fixtures) on a fresh run.
  const seen = await walkPaulasPath(t, f, 'fucq220');
  const link = seen.second.link.replace('/gcsp/offer', '/gcsp-offer.html');
  const paula = [...cookiesOf(seen.sessions.paula, app.origin)];
  for (const viewport of VIEWPORTS) {
    await withPage(viewport, paula, async (page) => { // 1
      await page.goto(app.origin + link, { waitUntil: 'networkidle' }); await settle(page, '.gcsp-offer, gcsp-offer');
      await page.getByText('Offer accepted').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
      const pairs = await identityIn(page, 'main'); const keyboard = await tabThrough(page, null);
      record({ screen: 1, name: 'buddy-handoff', viewport: viewport.width, url: '/gcsp-offer.html (accepted offer)', identityFacts: pairs, overflowPx: await overflowOf(page), keyboard,
        pass: hasPair(pairs) && (await overflowOf(page)) <= 0, screenshot: await shoot(page, 'buddy-handoff', viewport) });
    });
    await withPage(viewport, paula, async (page) => { // 2
      await page.goto(`${app.origin}/gcsp-order-progress-live.html`, { waitUntil: 'networkidle' }); await settle(page, '.gcsp-order-progress');
      const pairs = await identityIn(page, '.gcsp-order-progress');
      record({ screen: 2, name: 'order-progress', viewport: viewport.width, url: '/gcsp-order-progress-live.html', identityFacts: pairs, overflowPx: await overflowOf(page),
        pass: hasPair(pairs) && (await overflowOf(page)) <= 0, screenshot: await shoot(page, 'order-progress', viewport) });
    });
    await withPage(viewport, paula, async (page) => { // 3 and 5
      await page.goto(`${app.origin}/gcsp-account.html`, { waitUntil: 'networkidle' }); await settle(page, '.gcsp-account-order-status');
      const pairs = await identityIn(page, '.gcsp-account-order-status');
      const above = await page.evaluate(() => { const card = document.querySelector('.gcsp-account-order-status');
        const link = [...card.querySelectorAll('a')].find((a) => a.textContent.trim() === 'View order progress'); const dl = card.querySelector('dl');
        return !!link && !!dl && !!(dl.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING); });
      const gapPx = await page.evaluate(() => { const card = document.querySelector('.gcsp-account-order-status'); const link = [...card.querySelectorAll('a')].find((a) => a.textContent.trim() === 'View order progress');
        return Math.round((link.getBoundingClientRect().top - card.querySelector('dl').getBoundingClientRect().bottom) * 10) / 10; });
      const keyboard = await tabThrough(page, 'View order progress');
      const overflowPx = await overflowOf(page);
      record({ screen: 3, name: 'account-order-card', viewport: viewport.width, url: '/gcsp-account.html', identityFacts: pairs, factsAboveViewLink: above, gapFactsToLinkPx: gapPx, overflowPx, keyboard,
        pass: hasPair(pairs) && above && keyboard.reached && overflowPx <= 0, screenshot: await shoot(page, 'account-order-card', viewport) });
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      const history = await page.evaluate(() => [...document.querySelectorAll('.gcsp-account-history')].map((a) => ({ text: a.innerText.replace(/\s+/g, ' ').slice(0, 400),
        facts: [...a.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt').textContent.trim(), d.querySelector('dd').textContent.trim()]).filter(([l]) => /order|reference/i.test(l)) })));
      const section = page.locator('main section, main div').filter({ has: page.getByRole('heading', { name: 'Order history', exact: true }) }).last();
      const file = `${viewport.width}-account-order-history.png`; await section.screenshot({ path: join(OUT, file) });
      const flat = history.flatMap((h) => h.facts);
      record({ screen: 5, name: 'account-order-history', viewport: viewport.width, url: '/gcsp-account.html (Order history)', entries: history.length, identityFacts: flat, historyRows: history,
        overflowPx: await overflowOf(page), pass: history.length > 0 && !flat.some(([l]) => l === 'Order reference') && !history.some((h) => /GCSP-/.test(h.text)) && (await overflowOf(page)) <= 0,
        note: 'Demo history records carry no reference; rows are listed as shown.', screenshot: `${REL}/${file}` });
    });
    for (const [name, path, scope] of [['earlier-order-progress', '/gcsp-order-progress.html?fixture=earlier-order', '.gcsp-order-progress'], ['offer-selection-no-hr', '/blocks/gcsp/offer/preview.html?fixture=selection-no-hr', 'gcsp-offer']]) {
      await withPage(viewport, [], async (page) => { // 6
        await page.goto(staticOrigin + path, { waitUntil: 'networkidle' }); await settle(page, `${scope} dl > div`); await page.waitForTimeout(500);
        const pairs = await identityIn(page, scope);
        record({ screen: 6, name, viewport: viewport.width, url: path, identityFacts: pairs, overflowPx: await overflowOf(page), pass: onlyCar(pairs) && (await overflowOf(page)) <= 0,
          screenshot: await shoot(page, name, viewport) });
      });
    }
  }
  const passed = screens.length === 14 && screens.every((s) => s.pass) && pageErrors.length === 0;
  await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ passed, origin: app.origin, runtime: 'memory', pageErrors, screens }, null, 2)}\n`);
  assert.ok(passed, JSON.stringify(screens.map((s) => [s.screen, s.name, s.viewport, s.pass])));
});
