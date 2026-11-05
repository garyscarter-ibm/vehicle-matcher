// Actual same-origin service proof. Memory mode and a one-shot HTTP failure are explicit test inputs.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGcspDemo } from '../../../../scripts/gcsp-demo.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
assert(process.env.TMPDIR, 'Run through the registered resource supervisor.');
const profile = join(process.env.TMPDIR, 'functional-chrome-profile');
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || '/Users/usget/.npm/_npx/db89d7302a373f10/node_modules/playwright-core/index.mjs');
const started = await startGcspDemo({ runtime: { mode: 'memory', environmentId: 'fucq94-functional-browser',
  policyAsOf: '2026-11-05T12:00:00.000Z', commandId: 'functional-browser-bootstrap' } });
assert.equal(started.status, 'ok');
const app = started.value;
const results = []; const requests = []; const errors = []; const httpErrors = [];
let context;
const api = (page, path) => page.evaluate(async (url) => (await fetch(url, { credentials: 'same-origin' })).json(), path);
const comfort = (page) => page.getByRole('slider', { name: 'Comfort: what you prefer', exact: true });
const search = (page) => page.getByRole('checkbox', { name: 'Search for cars for me', exact: true });
const hold = (page) => page.getByRole('checkbox', { name: 'Hold a suitable car for me', exact: true });
const ready = (page) => page.waitForFunction(() => document.querySelector('.gcsp-brief-preview-status')?.textContent === '0 eligible cars.');
async function open(viewport) {
  const page = await context.newPage(); page.setDefaultTimeout(6000); await page.setViewportSize(viewport);
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path !== '/api/gcsp/brief/preview') return;
    const input = request.postDataJSON();
    requests.push({ path, baseBriefVersion: input.baseBriefVersion, draftVersion: input.draftVersion,
      comfort: input.brief.preferences.comfort.value, charging: input.brief.essentials.charging.value });
  });
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(`${app.origin}/`)) return route.continue();
    errors.push('Unexpected external browser request'); return route.abort();
  });
  await page.goto(`${app.origin}/gcsp-brief-live.html`); await ready(page); return page;
}
async function record(name, page, observations = {}, fullPage = false) {
  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflowPx, 0, `${name}: horizontal overflow`);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage, animations: 'disabled' });
  results.push({ name, file: `${name}.png`, viewport: page.viewportSize(), overflowPx, ...observations });
  console.log(`Captured ${name}`);
}
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
  const page = await open({ width: 1280, height: 900 });
  const initial = await api(page, '/api/gcsp/brief/editor');
  assert.equal(initial.value.initial.briefVersion, 0);
  assert.equal(initial.value.initial.brief.essentials.charging.value, null);
  assert.equal((await api(page, '/api/gcsp/activity')).value.state, 'no-brief');
  assert.equal(await page.locator('.gcsp-brief-cards > *').count(), 0);
  assert.match(await page.locator('.gcsp-brief-draft').innerText(), /Synthetic local demo/);
  assert.match(await page.locator('.gcsp-account-name').innerText(), /fictional/i);
  await record('functional-new-empty-desktop', page, { briefVersion: 0, eligibleCount: 0, stockSource: 'actual unreleased repository input; no vehicle facts', charging: null }, true);

  // A second actual client keeps version zero so its later save crosses the real conflict boundary.
  const competing = await open({ width: 1280, height: 900 });
  await comfort(competing).focus(); await competing.keyboard.press('Home'); await competing.keyboard.press('ArrowRight');
  await search(competing).click(); await ready(competing);
  const competingValue = await comfort(competing).inputValue();

  await comfort(page).focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await ready(page);
  await comfort(page).evaluate((node) => { window.functionalFocusedControl = node; });
  let failNext = true;
  await page.route('**/api/gcsp/brief/preview', async (route) => {
    if (!failNext) return route.continue();
    failNext = false;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'unavailable', retryable: true }) });
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.gcsp-brief-preview-status')?.textContent === 'Preview unavailable. Your edits are kept.');
  assert.equal(await comfort(page).inputValue(), '2');
  assert.equal(await page.evaluate(() => document.activeElement === window.functionalFocusedControl), true);
  await record('functional-unavailable-retained-desktop', page, { controlledInput: 'one HTTP 503; no product-source substitution', comfort: 2, focusedControlRetained: true }, true);
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click(); await ready(page);
  await hold(page).click();
  assert.equal(await hold(page).getAttribute('aria-checked'), 'true');
  assert.equal(await search(page).getAttribute('aria-checked'), 'false');
  await record('functional-independent-consent-desktop', page, { search: false, hold: true });
  await search(page).click();
  await page.getByRole('button', { name: 'Save this brief', exact: true }).click();
  await page.locator('.gcsp-brief-form').getByText('Brief version 1 saved. Your selected buddy permissions apply.', { exact: true }).waitFor();
  const activity = await api(page, '/api/gcsp/activity');
  assert.equal(activity.value.briefVersion, 1); assert.equal(activity.value.state, 'never-searched');
  assert.deepEqual([activity.value.permission.canSearch, activity.value.permission.canHold], [true, true]);
  assert.equal(activity.value.lastSuccessfulCheck, null); assert.equal(activity.value.offers.length, 0);
  await page.reload(); await ready(page);
  assert.equal(await comfort(page).inputValue(), '2');
  assert.equal(await search(page).getAttribute('aria-checked'), 'true'); assert.equal(await hold(page).getAttribute('aria-checked'), 'true');
  assert.match(await page.locator('.gcsp-brief-draft').innerText(), /Brief version 1/);
  await record('functional-reloaded-saved-desktop', page, { comfort: 2, briefVersion: 1, search: true, hold: true,
    activity: { briefVersion: activity.value.briefVersion, state: activity.value.state, lastSuccessfulCheck: null, offers: 0,
      canSearch: activity.value.permission.canSearch, canHold: activity.value.permission.canHold, evidence: activity.value.searchEvidence.reason } });

  await competing.getByRole('button', { name: 'Save this brief', exact: true }).click();
  await competing.locator('.gcsp-brief-form').getByText('A newer saved version needs review. Your edits and permissions are still here.', { exact: true }).waitFor();
  assert.equal(await comfort(competing).inputValue(), competingValue);
  assert.equal(await search(competing).getAttribute('aria-checked'), 'true'); assert.equal(await hold(competing).getAttribute('aria-checked'), 'false');
  await record('functional-conflict-retained-desktop', competing, { comfort: Number(competingValue), search: true, hold: false, savedVersionUnchanged: 1 });
  await competing.getByRole('button', { name: 'Refresh and review', exact: true }).click();
  assert.equal(await comfort(competing).inputValue(), competingValue);
  await competing.getByRole('button', { name: 'Replace draft with saved brief', exact: true }).click(); await ready(competing);
  assert.equal(await comfort(competing).inputValue(), '2'); assert.equal(await hold(competing).getAttribute('aria-checked'), 'true');
  const mobile = await open({ width: 375, height: 812 });
  assert.equal(await comfort(mobile).inputValue(), '2');
  const menu = mobile.locator('.gcsp-menu-toggle'); await menu.focus(); await mobile.keyboard.press('Enter');
  assert.equal(await menu.getAttribute('aria-expanded'), 'true');
  await record('functional-reloaded-mobile-375', mobile, { briefVersion: 1, menuExpanded: true }, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(httpErrors, [{ path: '/api/gcsp/brief/preview', status: 503 }, { path: '/api/gcsp/brief/draft', status: 409 }]);
  assert(requests.some((r) => r.comfort === 2 && r.baseBriefVersion === 0));
  assert(requests.some((r) => r.comfort === 2 && r.baseBriefVersion === 1));
} finally {
  await context?.close(); await app.close();
}
const sources = {};
for (const path of ['server/gcsp/runtime.js', 'server/gcsp/brief/activity.js', 'server/gcsp/brief/activity-http.js', 'server/index.js', 'scripts/gcsp-demo.mjs', 'gcsp-brief-live.html', 'blocks/gcsp/brief/runtime.js', 'blocks/gcsp/brief/brief-view.js', 'blocks/gcsp/brief/brief-controller.js', 'docs/gcsp/evidence/fucq94/capture-functional.mjs']) {
  sources[path] = createHash('sha256').update(await readFile(join(ROOT, path))).digest('hex');
}
await writeFile(join(OUT, 'functional-browser-matrix.json'), `${JSON.stringify({ story: 'FUCQ-94', capturedAt: new Date().toISOString(),
  browser: 'isolated headless system Chrome', repository: 'explicit process-lifetime memory proof',
  limits: ['No configured PostgreSQL capability', 'Real configuration/release producer absent; actual preview remains empty', 'Activity UI continuity is owned by FUCQ-95; this proof reads its actual HTTP projection'],
  activeProfileCompatibilityException: profile, sources, errors, httpErrors, previewInputs: requests, results }, null, 2)}\n`);
console.log(JSON.stringify({ captures: results.length, errors: errors.length, expectedHttpErrors: httpErrors.length, repository: 'explicit memory' }));
