// FUCQ-212 browser check: Paula's main journey through buddy accept, then her header and Buddy activity at 1280 and 375.
// Run with `node --test` and TMPDIR set; memory runtime over HTTPS on 127.0.0.1:FUCQ212_PORT (8982-8989).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { startGcspDemo } from '../../../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../../../../server/gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from '../../../../server/test/helpers/local-https.js';
import { competingPolicy, good, jar, walkPaulasPath } from '../../../../server/test/helpers/gcsp-journey.js';

const OUT = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.FUCQ212_PORT ?? 8986);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('FUCQ-212: after a buddy accept Paula keeps her header and Buddy activity', async (t) => {
  assert.ok(PORT >= 8982 && PORT <= 8989, 'port must be 8982 to 8989');
  const { seed, policy } = await competingPolicy();
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: PORT, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: createDemoStockProvider, adoptOfferJourney: true, policy, environmentId: 'fucq212', policyAsOf: seed.effectiveFrom, commandId: 'fucq212-bootstrap' } }));
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
  const seen = await walkPaulasPath(t, f, 'fucq212');
  const account = (await f.api('/api/gcsp/manual/account', { session: seen.sessions.paula })).json.value?.state;
  // Known separate fault (not FUCQ-212): record what the brief editor returns after the accept.
  const editor = (await f.api('/api/gcsp/brief/editor', { session: seen.sessions.paula })).json;
  const briefEditor = { status: editor.status, reason: editor.reason ?? editor.code ?? null };
  const cookies = seen.sessions.paula.split('; ').map((pair) => { const at = pair.indexOf('='); return { name: pair.slice(0, at), value: pair.slice(at + 1), url: app.origin }; });
  const profiles = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'fucq212-chrome-'));
  t.after(() => rm(profiles, { recursive: true, force: true }));
  const runs = [];
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const context = await chromium.launchPersistentContext(await mkdtemp(join(profiles, 'p-')), { executablePath: CHROME, headless: true, viewport, ignoreHTTPSErrors: true });
    try {
      await context.addCookies(cookies);
      const page = context.pages()[0] ?? await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      for (const [key, path] of [['activity', '/gcsp-activity-live.html'], ['brief', '/gcsp-brief-live.html']]) {
        await page.goto(app.origin + path, { waitUntil: 'networkidle' });
        await page.locator('.gcsp-account-name, .gcsp-account-unavailable').first().waitFor({ timeout: 20000 });
        if (key === 'activity') await page.locator('main h1').first().waitFor({ timeout: 20000 });
        await page.waitForTimeout(500);
        const header = (await page.locator('header').first().innerText()).replace(/\s+/g, ' ');
        const body = (await page.locator('main').first().innerText()).replace(/\s+/g, ' ');
        const shot = `${viewport.width}-${key}.png`; await page.screenshot({ path: join(OUT, shot), fullPage: true });
        runs.push({ viewport: viewport.width, page: key, header: header.slice(0, 160), body: body.slice(0, 400), screenshot: `docs/gcsp/evidence/fucq-212/${shot}`,
          headerUnavailable: /Account unavailable/.test(header), activityUnavailable: /Activity unavailable/.test(body), paula: /Paula/.test(header),
          overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), errors: [...errors] });
      }
    } finally { await context.close(); }
  }
  const passed = account === 'no-entitlement' && runs.length === 4 && runs.every((run) => run.paula && !run.headerUnavailable && !run.activityUnavailable && run.overflow <= 0 && !run.errors.length);
  await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ passed, accountState: account, briefEditor, origin: app.origin, runtime: 'memory', runs }, null, 2)}\n`);
  assert.ok(passed, JSON.stringify(runs.map(({ body: _body, ...run }) => run)));
});
