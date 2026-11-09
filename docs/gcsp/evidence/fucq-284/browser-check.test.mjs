// FUCQ-284 browser check: one content inset, crumb-only location label and presenter alignment on four Paula pages
// (plus the presenter workspace) at 1280 and 375. Measurements as FUCQ-280's; the assertions are the shell contract.
// Copy for a sibling story: change STORY, PORT_ENV, PORT_MIN and the PAGES list. TMPDIR must be an owned scratch dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { startGcspDemo } from '../../../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../../../../server/gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from '../../../../server/test/helpers/local-https.js';
import { competingPolicy, good, jar, walkPaulasPath } from '../../../../server/test/helpers/gcsp-journey.js';

const STORY = 'FUCQ-284';
const PORT_ENV = 'FUCQ284_PORT';
const PORT_MIN = 9465; // the story owns PORT_MIN to PORT_MIN + 4
const OUT = fileURLToPath(new URL('./', import.meta.url));
const REL = relative(fileURLToPath(new URL('../../../../', import.meta.url)), OUT).replace(/\/$/, '');
const PORT = Number(process.env[PORT_ENV] ?? PORT_MIN);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 375, height: 812 }];
// name: screenshot label; path: page under the demo origin ('offer' is the live offer link, taken while it is still pending).
const PAGES = [{ name: 'your-cars', path: '/gcsp-account.html' }, { name: 'brief', path: '/gcsp-brief-live.html' },
  { name: 'activity', path: '/gcsp-activity-live.html' }, { name: 'offer', path: null }];

const cookiesOf = (session, origin) => session.split('; ').map((pair) => { const at = pair.indexOf('='); return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }; });

// Everything measured in the page, as plain data. Runs with no input having happened.
const measure = () => {
  const r = (n) => Math.round(n);
  const visible = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const main = document.querySelector('main') ?? document.querySelector('[role="main"]');
  const h1 = main?.querySelector('h1') ?? document.querySelector('h1');
  const active = document.activeElement;
  const ring = (e) => { if (!e) return null; const s = getComputedStyle(e);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow.slice(0, 60), focusVisible: e.matches(':focus-visible'), quietMarker: e.hasAttribute('data-gcsp-quiet-focus'), visible: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 }; };
  const outlineRules = (e) => { const out = []; const walk = (rules) => { for (const rule of rules) { if (rule.styleSheet) { try { walk(rule.styleSheet.cssRules); } catch { /* blocked */ } } else if (rule.cssRules && !rule.selectorText) walk(rule.cssRules);
    else if (rule.selectorText && /outline/.test(rule.style?.cssText ?? '')) { try { if (e.matches(rule.selectorText)) out.push(`${rule.selectorText} { ${rule.style.cssText.match(/outline[^;]*;?/g)?.join(' ')} }`); } catch { /* unsupported selector */ } } } };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* cross-origin sheet */ } } return out.map((x) => x.slice(0, 160)); };
  const left = (e) => (e ? r(e.getBoundingClientRect().left) : null);
  const firstText = main && [...main.querySelectorAll('*')].find((e) => visible(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const firstChild = main && [...main.children].find(visible);
  const prev = h1?.previousElementSibling;
  const kicker = prev && visible(prev) && /vm-kicker|gcsp-eyebrow|eyebrow|kicker/.test(prev.className) ? prev.innerText.trim() : null;
  const bar = document.querySelector('.gcsp-presenter-bar');
  const barBox = bar?.getBoundingClientRect();
  return {
    h1Text: h1?.innerText.trim().slice(0, 60) ?? null,
    focused: active ? { tagName: active.tagName, text: (active.innerText || active.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60), isPageH1: active === h1 } : null,
    ringVisible: ring(active),
    outlineRulesMatching: active ? outlineRules(active) : [],
    contentStartX: { main: left(main), firstChild: left(firstChild), firstTextBlock: left(firstText), h1: left(h1) },
    crumb: document.querySelector('.gcsp-crumbs')?.innerText.trim().replace(/\s+/g, ' ') ?? null,
    kicker,
    nav: [...document.querySelectorAll('.gcsp-nav-btn')].map((b) => ({ label: b.innerText.trim(), ariaDisabled: b.getAttribute('aria-disabled') === 'true', shown: visible(b) })),
    crumbLeft: left(document.querySelector('.gcsp-crumb-list')),
    regionLeft: left(document.querySelector('.gcsp-presenter-region')),
    kickersShown: [...document.querySelectorAll('main .vm-kicker')].filter(visible).map((k) => k.innerText.trim()),
    presenterStrip: bar ? { rect: { left: r(barBox.left), top: r(barBox.top), width: r(barBox.width), height: r(barBox.height) }, open: bar.open,
      leftVsH1: left(h1) === null ? null : r(barBox.left) - left(h1), shown: barBox.width > 0 && barBox.height > 0 } : null,
    overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

test(`${STORY}: shell inset, crumb-only label and presenter alignment, two viewports`, async (t) => {
  assert.ok(PORT >= PORT_MIN && PORT <= PORT_MIN + 4, `${PORT_ENV} must be ${PORT_MIN} to ${PORT_MIN + 4}`);
  const { seed, policy } = await competingPolicy();
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: PORT, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: createDemoStockProvider, adoptOfferJourney: true, policy, environmentId: 'fucq284', policyAsOf: seed.effectiveFrom, commandId: 'fucq284-bootstrap' } }));
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

  const profiles = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'fucq284-chrome-'));
  t.after(async () => { try { execFileSync('/usr/bin/pkill', ['-f', profiles]); } catch { /* none running */ } await rm(profiles, { recursive: true, force: true }); });
  const captures = []; const pageErrors = [];
  const withPage = async (viewport, cookies, run) => {
    const context = await chromium.launchPersistentContext(await mkdtemp(join(profiles, 'p-')), { executablePath: CHROME, headless: true, viewport, ignoreHTTPSErrors: true });
    try {
      await context.addCookies(cookies);
      const page = context.pages()[0] ?? await context.newPage(); page.on('pageerror', (e) => pageErrors.push(e.message));
      return await run(page);
    } finally { await context.close(); }
  };
  // Load, wait for the h1, then let arrival settle with no input; measure before anything else touches the page.
  const arrive = async (page, url, ready) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('main h1, [role="main"] h1'), null, { timeout: 30000 });
    if (ready) await page.getByRole('button', { name: ready }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
  };
  const capture = async (name, viewport, cookies, url, shownUrl, ready) => withPage(viewport, cookies, async (page) => {
    await arrive(page, url, ready);
    const m = await page.evaluate(measure);
    const shot = `${viewport.width}-${name}.png`; await page.screenshot({ path: join(OUT, shot), fullPage: true });
    const entry = { page: name, viewport: viewport.width, url: shownUrl, ...m, screenshot: `${REL}/${shot}` };
    entry.pass = Boolean(m.focused?.isPageH1) && m.ringVisible?.visible === false && m.overflowPx <= 0 && Boolean(m.crumb);
    captures.push(entry);
  });

  // Offer: captured while pending, before Paula accepts.
  const offers = {};
  const seen = await walkPaulasPath(t, f, 'fucq284', { beforeAccept: async (s) => {
    const link = s.second.link.replace('/gcsp/offer', '/gcsp-offer.html');
    for (const viewport of VIEWPORTS) await capture('offer', viewport, cookiesOf(s.sessions.paula, app.origin), app.origin + link, '/gcsp-offer.html (pending offer)', 'Accept this offer');
    offers.done = true;
  } });
  assert.ok(offers.done, 'the pending offer was captured');
  const paula = cookiesOf(seen.sessions.paula, app.origin);
  for (const viewport of VIEWPORTS) {
    for (const p of PAGES.filter((e) => e.path)) await capture(p.name, viewport, paula, app.origin + p.path, p.path);
  }

  // Presenter workspace with a presenter session: the only page where the strip shows, so alignment is measured here.
  const presenterCaptures = [];
  for (const viewport of VIEWPORTS) {
    await withPage(viewport, cookiesOf(f.presenter, app.origin), async (page) => {
      await page.goto(`${app.origin}/gcsp-presenter.html`, { waitUntil: 'networkidle' });
      await page.locator('.gcsp-presenter-bar').first().waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(1000);
      const m = await page.evaluate(measure);
      const shot = `${viewport.width}-presenter-workspace.png`; await page.screenshot({ path: join(OUT, shot), fullPage: true });
      presenterCaptures.push({ page: 'presenter-workspace', viewport: viewport.width, crumbLeft: m.crumbLeft, regionLeft: m.regionLeft, barLeft: m.presenterStrip?.rect.left ?? null,
        barShown: Boolean(m.presenterStrip?.shown), h1Left: m.contentStartX.h1, overflowPx: m.overflowPx, screenshot: `${REL}/${shot}` });
    });
  }

  // Keyboard on Your cars at 1280: Tab, Shift+Tab, then a heading focused by script after keyboard input.
  const keyboard = await withPage(VIEWPORTS[0], paula, async (page) => {
    await arrive(page, `${app.origin}/gcsp-account.html`);
    const stop = () => page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e);
      return { tagName: e.tagName, text: (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth,
        focusVisible: e.matches(':focus-visible'), visible: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 }; });
    await page.keyboard.press('Tab'); const afterTab = await stop();
    await page.keyboard.press('Shift+Tab'); const afterShiftTab = await stop();
    await page.evaluate(() => { const h = document.querySelector('main h1'); if (!h.hasAttribute('tabindex')) h.tabIndex = -1; h.focus(); });
    const headingAfterKeyboard = { ...(await stop()), isPageH1: await page.evaluate(() => document.activeElement === document.querySelector('main h1')) };
    await page.screenshot({ path: join(OUT, '1280-your-cars-keyboard.png'), fullPage: true });
    return { afterTab, afterShiftTab, headingAfterKeyboard, screenshot: `${REL}/1280-your-cars-keyboard.png`,
      pass: afterTab.visible && headingAfterKeyboard.isPageH1 && headingAfterKeyboard.visible };
  });

  // FUCQ-284 contract: one h1 x per width across the pages, crumb at the same x, no kicker above the h1, strip aligned with them.
  const shell = VIEWPORTS.map(({ width }) => { const rows = captures.filter((c) => c.viewport === width); const xs = rows.map((c) => c.contentStartX.h1);
    const strips = presenterCaptures.filter((c) => c.viewport === width);
    return { viewport: width, h1X: Object.fromEntries(rows.map((c) => [c.page, c.contentStartX.h1])), sameH1X: new Set(xs).size === 1,
      crumbOnH1: rows.every((c) => c.crumbLeft === c.contentStartX.h1), noKicker: rows.every((c) => c.kicker === null && c.kickersShown.length === 0),
      stripOnCrumb: strips.length > 0 && strips.every((c) => c.barShown && c.regionLeft === xs[0] && c.barLeft === xs[0] && c.overflowPx <= 0) }; });
  // FUCQ-284 slice B: the same rail (labels and disabled flags) on every page at 1280, with the page's own item current.
  const rails = captures.filter((c) => c.viewport === 1280).map((c) => ({ page: c.page, nav: c.nav.map((n) => `${n.label}|${n.ariaDisabled}`) }));
  const navigation = { pages: rails.map((r) => r.page), labels: rails[0]?.nav.map((n) => n.split('|')[0]) ?? [],
    same: rails.length === 4 && rails.every((r) => JSON.stringify(r.nav) === JSON.stringify(rails[0].nav)), noneDisabled: rails.every((r) => r.nav.every((n) => n.endsWith('|false'))) };
  navigation.pass = navigation.same && navigation.noneDisabled && navigation.labels.length === 4;
  for (const s of shell) s.pass = s.sameH1X && s.crumbOnH1 && s.noKicker && s.stripOnCrumb;
  const passed = captures.length === 8 && captures.every((c) => c.pass) && keyboard.pass && pageErrors.length === 0 && shell.every((s) => s.pass) && navigation.pass;
  await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ story: STORY, passed, origin: app.origin, runtime: 'memory', pageErrors, navigation, shell, presenterCaptures, captures, keyboard }, null, 2)}\n`);
  assert.ok(passed, JSON.stringify({ captures: captures.map((c) => [c.page, c.viewport, c.pass]), keyboard: keyboard.pass, pageErrors, navigation, shell }));
});
