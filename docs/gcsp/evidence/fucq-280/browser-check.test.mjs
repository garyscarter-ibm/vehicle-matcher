// FUCQ-280 browser check: arrival focus on four Paula pages at 1280 and 375, no input, then a keyboard ring check.
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

const STORY = 'FUCQ-280';
const PORT_ENV = 'FUCQ280_PORT';
const PORT_MIN = 9460; // the story owns PORT_MIN to PORT_MIN + 4
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
    presenterStrip: bar ? { rect: { left: r(barBox.left), top: r(barBox.top), width: r(barBox.width), height: r(barBox.height) }, open: bar.open,
      leftVsH1: left(h1) === null ? null : r(barBox.left) - left(h1) } : null,
    overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

test(`${STORY}: arrival focus on four pages, two viewports`, async (t) => {
  assert.ok(PORT >= PORT_MIN && PORT <= PORT_MIN + 4, `${PORT_ENV} must be ${PORT_MIN} to ${PORT_MIN + 4}`);
  const { seed, policy } = await competingPolicy();
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: PORT, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: createDemoStockProvider, adoptOfferJourney: true, policy, environmentId: 'fucq280', policyAsOf: seed.effectiveFrom, commandId: 'fucq280-bootstrap' } }));
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

  const profiles = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'fucq280-chrome-'));
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
  const seen = await walkPaulasPath(t, f, 'fucq280', { beforeAccept: async (s) => {
    const link = s.second.link.replace('/gcsp/offer', '/gcsp-offer.html');
    for (const viewport of VIEWPORTS) await capture('offer', viewport, cookiesOf(s.sessions.paula, app.origin), app.origin + link, '/gcsp-offer.html (pending offer)', 'Accept this offer');
    offers.done = true;
  } });
  assert.ok(offers.done, 'the pending offer was captured');
  const paula = cookiesOf(seen.sessions.paula, app.origin);
  for (const viewport of VIEWPORTS) {
    for (const p of PAGES.filter((e) => e.path)) await capture(p.name, viewport, paula, app.origin + p.path, p.path);
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

  const passed = captures.length === 8 && captures.every((c) => c.pass) && keyboard.pass && pageErrors.length === 0;
  await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ story: STORY, passed, origin: app.origin, runtime: 'memory', pageErrors, captures, keyboard }, null, 2)}\n`);
  assert.ok(passed, JSON.stringify({ captures: captures.map((c) => [c.page, c.viewport, c.pass]), keyboard: keyboard.pass, pageErrors }));
});
