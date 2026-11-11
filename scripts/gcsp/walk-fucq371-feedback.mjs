// FUCQ-371 integrated walkthrough of current-car feedback in recommendations: real host, memory repository, real login, real presenter routes. Nothing is stubbed.
// Run through _tools/test_stamp.py with command: SCRATCH="$TMPDIR" node scripts/gcsp/walk-fucq371-feedback.mjs
// Supply WALK_PASSWORD privately in the environment and OUT as the run-owned retained evidence directory.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.env.OUT;
const scratch = process.env.SCRATCH;
if (!OUT || !scratch) throw new Error('OUT and supervised SCRATCH are required');
const PORT = Number(process.env.WALK_PORT || 8809); const ORIGIN = `http://127.0.0.1:${PORT}`;
const EMAIL = process.env.WALK_EMAIL || 'paula.mason@gcsp-demo.com'; const PASSWORD = process.env.WALK_PASSWORD;
if (!PASSWORD) throw new Error('WALK_PASSWORD is required (the demo login password)');
const THIRD = process.env.WALK_THIRD || 'sportiness';
const VIEWPORTS = [[1440, 1100], [375, 1000]];
const report = { run: 'fucq371-live-walkthrough', commit: null, viewports: {}, findings: [] };
const stoppers = [];
process.on('SIGALRM', async () => { for (const stop of stoppers) await stop().catch(() => {}); process.exit(124); });
process.on('SIGTERM', async () => { for (const stop of stoppers) await stop().catch(() => {}); process.exit(143); });

async function startHost() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, TMP: scratch, TEMP: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_PUBLIC_ORIGIN: ORIGIN, PORT: String(PORT), DEMO_ACCESS_KEY: `walk-${randomBytes(9).toString('hex')}` };
  const child = spawn(process.execPath, ['index.js'], { cwd: `${root}server`, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = new Promise((done) => child.once('exit', done));
    try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
    const killed = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
    await ended; clearTimeout(killed);
  };
  stoppers.push(stop);
  let output = '';
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`host not ready: ${output.slice(-300)}`)), 90000);
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { output += d; if (output.includes('GCSP hosted demo')) { clearTimeout(timer); done(); } });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`host exited ${code}: ${output.slice(-300)}`)); });
  });
  return { stop };
}

const carText = (o) => o && ({ offerId: o.offerId, runId: o.runId, vehicle: o.vehicle ?? o.car ?? o.title ?? null });

/** One fresh host + browser session: login, then helpers. Returns what the steps need. */
async function session([width, height], tag, rows, errors, label) {
  const step = (name, pass, detail) => { rows.push({ step: name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) }); console.log(`${pass ? 'ok  ' : 'FAIL'} ${tag} ${name}`); };
  const host = await startHost();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB' });
  await context.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  const page = await context.newPage();
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of 401|status of 40[34]/.test(m.text())) errors.push(`console: ${m.text()}`); else if (m.type() === 'error') errors.push(`console(expected-http): ${m.text()}`); });
    p.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.request().method()} ${r.url().replace(ORIGIN, '')}`); });
  };
  watch(page);
  const stop = async () => { try { await browser.close(); } catch {} await host.stop(); };
  const shot = async (name) => { await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${label}${tag}-${name}.jpg`, type: 'jpeg', quality: 85, fullPage: true }); };
  const call = (p, path, body) => p.evaluate(async ([path, body]) => {
    const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [path, body]);
  const api = (path, body) => call(page, path, body);
  const val = (r) => r.body?.value ?? r.body;
  const editor = async () => val(await api('/api/gcsp/brief/editor'));
  const lamp = () => page.locator('.gcsp-buddy-status.is-prominent').evaluate((n) => ({ text: n.textContent.trim(), state: n.dataset.state })).catch(() => null);
  const action = () => page.locator('.gcsp-prefs-action button');
  const considered = () => page.locator('.gcsp-prefs-tile.is-considered').count();
  const settle = async () => {
    await page.locator('.gcsp-prefs-tile').first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.gcsp-buddy-status.is-prominent')?.dataset.state && document.querySelector('.gcsp-buddy-status.is-prominent').dataset.state !== 'unknown', null, { timeout: 15000 }).catch(() => {});
    await page.locator('.gcsp-star-rating input').first().waitFor({ timeout: 15000, state: 'attached' }).catch(() => {});
    await page.waitForTimeout(500);
  };
  const reload = async () => { await page.reload(); await settle(); };
  const uiStars = () => page.locator('.gcsp-star-rating input:checked').evaluate((n) => Number(n.value)).catch(() => null);
  const idle = () => page.waitForFunction(() => !document.querySelector('.gcsp-star-rating[data-status="pending"]') && /Saved|saved|categories considered/.test(document.querySelector('.gcsp-prefs-status')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  const setStars = async (n) => { await page.locator('.gcsp-star-rating label.gcsp-star').nth(n - 1).click(); await page.waitForTimeout(300); await idle(); await page.waitForTimeout(500); };
  const cats = async () => { const e = (await editor())?.initial; return { rating: e?.currentCarRating ?? null, sameAgain: e?.sameAgain ?? null, categories: Object.fromEntries(Object.entries(e?.accountPreferences?.categories ?? {}).filter(([, v]) => v.state === 'considered').map(([k, v]) => [k, { value: v.value, importance: v.importance }])), buddy: e?.buddy?.state ?? null }; };
  const domCats = () => page.locator('.gcsp-prefs-tile.is-considered').evaluateAll((nodes) => nodes.map((n) => ({ id: n.querySelector('.gcsp-prefs-open')?.id.replace(/^.*-tile-/, ''), text: n.innerText.replace(/\s+/g, ' ').trim() })));
  const pickTile = async (key, label, important) => {
    const tile = page.locator(`.gcsp-prefs-open[id$="-tile-${key}"]`);
    if (await tile.evaluate((n) => n.closest('.gcsp-prefs-tile').classList.contains('is-considered'))) return;
    await tile.click();
    if (label) await page.locator('.gcsp-prefs-panel .vm-option', { hasText: label }).first().click();
    else { const slider = page.locator('.gcsp-prefs-panel input[type=range]').first(); await slider.focus(); await page.keyboard.press('ArrowRight'); }
    if (important) await page.locator('.gcsp-prefs-panel').getByLabel('This is really important').check({ force: true });
    await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(700); await idle();
  };
  // v2: set a category whether or not it is already considered; labels may be several (multi choice) and 'End' pushes a slider to its last stop.
  const editTile = async (key, labels, important, exact = false) => {
    await page.locator(`.gcsp-prefs-open[id$="-tile-${key}"]`).click();
    if (exact) {
      const all = page.locator('.gcsp-prefs-panel .vm-option');
      for (let i = 0; i < await all.count(); i++) {
        const o = all.nth(i);
        const text = (await o.innerText()).trim(); const should = labels.includes(text);
        const on = await o.evaluate((n) => n.getAttribute('aria-checked') === 'true' || n.getAttribute('aria-pressed') === 'true' || n.classList.contains('is-selected') || n.classList.contains('selected') || Boolean(n.querySelector('input:checked')));
        if (on !== should) await o.click();
      }
      labels = [];
    }
    for (const label of labels) {
      if (label === 'End') { const slider = page.locator('.gcsp-prefs-panel input[type=range]').first(); await slider.focus(); await page.keyboard.press('End'); continue; }
      const opt = page.locator('.gcsp-prefs-panel .vm-option', { hasText: label }).first();
      const on = await opt.evaluate((n) => n.getAttribute('aria-checked') === 'true' || n.getAttribute('aria-pressed') === 'true' || n.classList.contains('is-selected') || n.classList.contains('selected') || Boolean(n.querySelector('input:checked')));
      if (!on) await opt.click();
    }
    if (important) await page.locator('.gcsp-prefs-panel').getByLabel('This is really important').check({ force: true });
    await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(700); await idle();
  };
  const signIn = async () => {
    await page.goto(`${ORIGIN}/gcsp/login`, { waitUntil: 'load', timeout: 120000 });
    await page.getByLabel('Email address').fill(EMAIL); await page.getByLabel('Password').fill(PASSWORD); await page.keyboard.press('Enter');
    await page.waitForURL(/gcsp-account|gcsp\/account|\/gcsp-/, { timeout: 60000 }).catch(() => {});
    await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load', timeout: 60000 }); await settle();
  };
  const engage = async () => {
    if ((await lamp())?.state !== 'engaged') { await action().click(); await page.waitForFunction(() => document.querySelector('.gcsp-buddy-status.is-prominent')?.dataset.state === 'engaged', null, { timeout: 20000 }).catch(() => {}); }
    return lamp();
  };
  // Presenter in a second page of the same context (its own cookie), then back to Paula.
  const release = async (commandId) => {
    const pp = await context.newPage(); watch(pp);
    await pp.goto(`${ORIGIN}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 60000 });
    const state = val(await call(pp, '/api/gcsp/presenter/controls'));
    const tick = await call(pp, '/api/gcsp/presenter/controls/tick', { commandId, expectedClockVersion: state?.clockVersion, mode: 'next-release' });
    await pp.close();
    const sw = await api('/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: `${commandId}-paula` });
    const outcomes = (val(tick)?.tick?.outcomes ?? []).map((o) => ({ handler: o.handlerId, status: o.outcome?.status, ...(o.outcome?.status === 'ok' ? { released: o.outcome.value?.orderUuids?.length } : { reason: o.outcome?.reason }) }));
    return { tickStatus: tick.status, tick: tick.body?.status ?? null, outcomes, tickDetail: tick.status === 200 ? undefined : tick.body, switchStatus: sw.status };
  };
  // Presenter reset into the demo journey: Paula's confirmed brief (estate, seats 5, charging not-ready), generated stock not yet released.
  const resetJourney = async (commandId) => {
    const pp = await context.newPage(); watch(pp);
    await pp.goto(`${ORIGIN}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 60000 });
    const cat = val(await call(pp, '/api/gcsp/presenter/scenarios')); const entry = cat?.scenarios?.find((r) => r.scenarioId === 'main-successful-journey');
    const cur = val(await call(pp, '/api/gcsp/presenter/scenarios/current'));
    const reset = await call(pp, '/api/gcsp/presenter/scenarios/reset', { commandId, expectedRunId: cur?.runId, expectedRunVersion: cur?.runVersion, scenarioId: entry?.scenarioId,
      scenarioVersion: entry?.scenarioVersion, fixtureVersion: entry?.fixtureVersion, policyVersion: entry?.policyVersion });
    await pp.close();
    const sw = await api('/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: `${commandId}-paula` });
    return { resetStatus: reset.status, startState: val(reset)?.startState ?? reset.body, switchStatus: sw.status };
  };
  // Importance on a category that is already considered (the seeded Body brief): open it, tick important, Done.
  const makeImportant = async (key) => {
    await page.locator(`.gcsp-prefs-open[id$="-tile-${key}"]`).click();
    await page.locator('.gcsp-prefs-panel').getByLabel('This is really important').check({ force: true });
    await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(700); await idle();
  };
  const offers = async () => {
    const cur = val(await api('/api/gcsp/offers/current')); const list = cur?.offers ?? [];
    const full = [];
    for (const o of list) { const r = val(await api(`/api/gcsp/offers/${encodeURIComponent(o.offerId)}?runId=${encodeURIComponent(o.runId)}`)); full.push({ summary: o, read: r }); }
    return full;
  };
  const factOf = (facts, k) => { const f = facts?.[k]; return f && typeof f === 'object' && 'value' in f ? f.value : f ?? null; };
  const describe = (o) => { const snap = o.read?.quote?.facts ?? {}; const f = snap.facts ?? {};
    return { car: { name: snap.display?.name ?? null, modelLine: factOf(f, 'modelLine'), body: factOf(f, 'body'), fuel: factOf(f, 'fuel'), sizeClass: factOf(f, 'sizeClass') } }; };
  const brief = (o) => ({ ...describe(o), state: o.read?.state, reason: o.read?.reason, offerId: o.read?.offerId ?? o.summary.offerId, runId: o.summary.runId, reasons: (o.read?.quote?.decision?.reasons ?? []).map((r) => r.code ?? r), feedback: o.read?.quote?.decision?.feedback ?? null, feedbackRevision: o.read?.quote?.revisions?.feedback ?? null });
  return { page, context, step, shot, api, call, val, editor, lamp, action, considered, settle, reload, uiStars, setStars, cats, domCats, pickTile, editTile, signIn, engage, release, resetJourney, makeImportant, offers, brief, stop, idle };
}

async function walk(vp) {
  const tag = String(vp[0]); const rows = []; const errors = []; const extra = {};
  let s;
  try {
    // ---- Positive run ----
    s = await session(vp, tag, rows, errors, 'pos-');
    const { page, step, shot, val } = s;
    await s.signIn(); await shot('01-account');
    const car = await page.locator('.gcsp-feature[data-contract-id]').first().evaluate((n) => ({ id: n.dataset.contractId, text: n.innerText.replace(/\s+/g, ' ').trim().slice(0, 240) })).catch(() => null);
    const lamp0 = await s.lamp(); const c0 = await s.cats();
    extra.currentCar = car;
    step('1 sign in, Account shows the current car and the lamp "Buddy disengaged"', car && lamp0?.text === 'Buddy disengaged', { car, lamp: lamp0, editor: c0 });

    // A fresh run has no confirmed brief or essentials, so Buddy could never qualify a car; the presenter resets into the demo journey (Paula's confirmed estate brief, essentials, consent).
    const rs = await s.resetJourney('walk371-pos-reset'); extra.reset = rs;
    await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle();
    const cr = await s.cats(); const lr = await s.lamp();
    step('1b presenter reset into main-successful-journey: Paula has a confirmed brief and Buddy is engaged', rs.resetStatus === 200 && lr?.text === 'Buddy engaged', { reset: rs, lamp: lr, editor: cr });
    report.findings.push(`${tag}: a fresh memory run has no confirmed brief or essentials for Paula, so Buddy cannot qualify any car (preview: essential-unconfirmed); the presenter reset into main-successful-journey is the way to reach the released-stock state.`);

    // 2 rating select and clear
    await s.setStars(2); await shot('02a-rated-2');
    await s.reload(); let c = await s.cats(); let ui = await s.uiStars();
    step('2a rating 2 persists after reload (editor and DOM)', c.rating?.value === 2 && ui === 2, { editor: c.rating, dom: ui });
    await s.setStars(2); await shot('02b-cleared'); // choosing the selected star clears it
    await s.reload(); c = await s.cats(); ui = await s.uiStars();
    step('2b clearing the rating persists after reload', c.rating?.value === null && ui === null, { editor: c.rating, dom: ui });
    await s.setStars(5); await s.reload(); c = await s.cats(); ui = await s.uiStars(); await shot('02c-rated-5');
    step('2c rating 5 persists after reload', c.rating?.value === 5 && ui === 5, { editor: c.rating, dom: ui });

    // 3 three categories with importance
    await s.editTile('body', ['Hatchback'], true, true); await s.editTile('fuel', ['Petrol'], false);
    await s.reload(); c = await s.cats(); const dom3 = await s.domCats(); await shot('03-categories');
    const body = c.categories.body; const fuel = c.categories.fuel;
    step('3 Body Hatchback only (high) and Fuel Petrol (medium), nothing else, persist after reload', JSON.stringify(body?.value) === '["hatchback"]' && body?.importance === 'high' && JSON.stringify(fuel?.value) === '["petrol"]' && fuel?.importance === 'medium' && Object.keys(c.categories).length === 2, { editor: c.categories, dom: dom3 });
    // Exercise the repaired generated performance facts through the real persisted brief.
    const a5 = await s.cats(); const engageTry = await s.engage();
    step('3b two categories only: Engage Buddy is refused (minimum 3), recorded', engageTry?.state === 'disengaged', { lamp: engageTry, status: (await page.locator('.gcsp-prefs-status').innerText().catch(() => '')).trim(), editor: a5.categories });
    await shot('03b-engagement-validation');
    await s.editTile(THIRD, ['End'], false); await s.reload(); const c3 = await s.cats(); await shot('03c-three-categories');
    step(`3c third category ${THIRD} (medium) added so Buddy can engage; brief is Body Hatchback (high), Fuel Petrol, ${THIRD}`, Object.keys(c3.categories).length === 3 && c3.categories[THIRD]?.importance === 'medium', c3.categories);
    c = c3; dom3.length = 0; dom3.push(...await s.domCats());

    // 4 same again on then off
    const same = page.getByRole('switch', { name: 'Same again, please!' });
    await same.check({ force: true }).catch(async () => { await page.locator('.gcsp-prefs-mode .vm-switch, .gcsp-prefs-mode label').first().click(); });
    await page.waitForTimeout(1200); await s.idle(); await shot('04a-same-again-on'); await s.reload();
    const on = await s.cats(); const onDom = await s.domCats(); const onChecked = await page.getByRole('switch', { name: 'Same again, please!' }).isChecked().catch(() => null);
    step('4a Same again on persists; categories are retained (editor and DOM)', on.sameAgain?.on === true && onChecked === true && Object.keys(on.categories).length === Object.keys(c.categories).length, { editor: { sameAgain: on.sameAgain, categories: on.categories }, domCount: onDom.length, checked: onChecked });
    await page.getByRole('switch', { name: 'Same again, please!' }).uncheck({ force: true }); await page.waitForTimeout(1200); await s.idle(); await s.reload(); await shot('04b-same-again-off');
    const off = await s.cats(); const offDom = await s.domCats(); const offChecked = await page.getByRole('switch', { name: 'Same again, please!' }).isChecked().catch(() => null);
    step('4b Same again off persists; categories and importance restored', off.sameAgain?.on === false && offChecked === false && JSON.stringify(off.categories) === JSON.stringify(c.categories) && offDom.length === dom3.length, { editor: { sameAgain: off.sameAgain, categories: off.categories }, domCount: offDom.length, checked: offChecked });

    // 5 engage, disengage, engage
    let l = await s.engage(); await shot('05a-engaged');
    step('5a Engage Buddy shows "Buddy engaged"', l?.text === 'Buddy engaged', l);
    await s.action().click(); await page.waitForFunction(() => document.querySelector('.gcsp-buddy-status.is-prominent')?.dataset.state === 'disengaged', null, { timeout: 15000 }).catch(() => {});
    const dis = await s.lamp(); await shot('05a-disengaged'); l = await s.engage(); await shot('05b-engaged-again');
    step('5b Disengage then Engage again', dis?.text === 'Buddy disengaged' && l?.text === 'Buddy engaged', { disengaged: dis, engaged: l });

    // Both screens use the same binary authority and gated editor operation.
    await page.goto(`${ORIGIN}/gcsp-activity-live.html`, { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Disengage Buddy', exact: true }).waitFor(); await shot('05c-activity-engaged');
    await page.getByRole('button', { name: 'Disengage Buddy', exact: true }).click();
    await page.getByRole('button', { name: 'Engage Buddy', exact: true }).waitFor(); await shot('05d-activity-disengaged');
    await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle();
    step('5c Activity Disengage is off on Account after reload', (await s.lamp())?.state === 'disengaged');
    await page.goto(`${ORIGIN}/gcsp-activity-live.html`, { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Engage Buddy', exact: true }).click();
    await page.getByRole('button', { name: 'Disengage Buddy', exact: true }).waitFor();
    await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle();
    step('5d Activity Engage is on on Account after reload', (await s.lamp())?.state === 'engaged');

    // The original Account stays mounted while another tab changes only feedback.
    const remote = await s.context.newPage();
    await remote.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' });
    await remote.locator('.gcsp-star-rating label.gcsp-star').nth(3).click();
    await page.waitForTimeout(700);
    const syncAccount = () => page.locator('gcsp-account').evaluate((n) => n.dispatchEvent(new CustomEvent('gcsp:presenter-action')));
    await syncAccount();
    await page.waitForFunction(() => document.querySelector('.gcsp-star-rating input:checked')?.value === '4');
    step('5e existing Account adopts a remote rating-only edit on refresh', (await s.uiStars()) === 4);
    await remote.getByRole('switch', { name: 'Same again, please!' }).check({ force: true });
    await page.waitForTimeout(700); await syncAccount();
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.checked === true);
    step('5f existing Account adopts a remote Same-again-only edit', await page.getByRole('switch', { name: 'Same again, please!' }).isChecked());
    await remote.getByRole('switch', { name: 'Same again, please!' }).uncheck({ force: true });
    await page.waitForTimeout(700); await syncAccount();
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.checked === false);
    await remote.close();
    step('5g remote Same again off restores saved categories in the existing Account', JSON.stringify((await s.cats()).categories) === JSON.stringify(c3.categories));

    // 9 retained Account parts (after step 5)
    const order = await page.evaluate(() => {
      const q = (sel) => document.querySelector(sel); const els = [q('h1'), q('#gcsp-account-preferences'), q('#gcsp-account-history-title'), q('#gcsp-account-details-title')];
      const names = ['Your cars', 'Your preferences', 'Order history', 'Your details'];
      const pos = els.map((e) => e && [...document.querySelectorAll('*')].indexOf(e));
      const replace = [...document.querySelectorAll('button, a')].filter((b) => /Choose a replacement/.test(b.textContent));
      const prefs = q('#gcsp-account-preferences');
      return { found: els.map(Boolean), ordered: pos.every((p, i) => p !== null && (i === 0 || p > pos[i - 1])), names, replaceCount: replace.length, replaceBeforePrefs: replace.some((b) => prefs && (b.compareDocumentPosition(prefs) & Node.DOCUMENT_POSITION_FOLLOWING)), h1: q('h1')?.textContent.trim() };
    });
    step('9a DOM order Your cars, Your preferences, Order history, Your details; "Choose a replacement" in Your cars', order.ordered && order.replaceCount >= 1 && order.replaceBeforePrefs, order);
    const opener = page.getByRole('button', { name: /View record/ }).first();
    const hasOpener = await opener.count();
    if (hasOpener) {
      await opener.click(); await page.waitForTimeout(700);
      const inside = await page.evaluate(() => { const a = document.activeElement; const d = a?.closest('[role=dialog], aside, .gcsp-drawer, [class*=drawer]'); return { inDrawer: Boolean(d), active: `${a?.tagName}.${a?.className}`.slice(0, 80) }; });
      await shot('09-record-drawer'); await page.keyboard.press('Escape'); await page.waitForTimeout(700);
      const back = await opener.evaluate((n) => n === document.activeElement);
      step('9b record drawer takes focus on open and Escape returns focus to the opener', inside.inDrawer && back, { ...inside, focusReturned: back });
    } else step('9b record drawer takes focus on open and Escape returns focus to the opener', false, 'no "View record" button in Order history for this account');

    { const eb = (await s.editor())?.initial; extra.positiveBrief = { preferences: eb?.brief?.preferences, essentials: eb?.brief?.essentials, currentCarRating: eb?.brief?.currentCarRating, sameAgain: eb?.brief?.sameAgain, buddy: eb?.buddy?.state }; }
    // 6 release and evaluation, positive
    const rel = await s.release('walk371-pos-tick'); extra.release = rel;
    await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle();
    const list = await s.offers(); const brs = list.map(s.brief); extra.positiveOffers = brs;
    await shot('06a-account-after-release');
    // 8 preview gate evidence (after release, from the engaged positive brief)
    const e0 = await s.editor(); const bf = e0?.initial?.brief;
    const bodyPreview = async (extraEss) => s.api('/api/gcsp/brief/preview', { kind: 'unsaved-draft', baseBriefVersion: e0.initial.briefVersion, draftVersion: e0.initial.draftVersion, brief: { ...bf, essentials: { ...(bf.essentials ?? {}), ...extraEss } } });
    let pv = await bodyPreview({}); extra.previewAttempt = { status: pv.status, body: pv.body?.status };
    if (pv.body?.status !== 'ok') pv = await bodyPreview({ charging: { value: 'home', operator: 'equals', unit: null, state: 'draft', source: 'employee' } });
    const decisions = val(pv)?.decisions ?? [];
    const row = (d) => ({ id: d.orderUuid ?? d.stockId ?? d.id, gateStatus: d.gateStatus, blockers: (d.blockers ?? []).map((b) => b.code ?? b), similarity: d.feedback?.similarity, effect: d.feedback?.effect, reasonCode: d.feedback?.reasonCode });
    const similar = decisions.filter((d) => d.feedback?.similarity === 'similar').map(row);
    const gateCodes = {}; for (const d of decisions) for (const b of (d.blockers ?? [])) gateCodes[b.code ?? b] = (gateCodes[b.code ?? b] ?? 0) + 1;
    const gating = ['allowance-exceeded', 'essential-unmet', 'charging-unavailable', 'not-available'];
    const conflicts = similar.filter((d) => d.blockers.some((b) => gating.includes(b)));
    const tally = (fn) => decisions.reduce((a, d) => { const k = fn(d); a[k] = (a[k] ?? 0) + 1; return a; }, {});
    const sf = (d, k) => { const f = d.snapshot?.facts?.[k]; return String(f && typeof f === 'object' && 'value' in f ? JSON.stringify(f.value) : f ?? '?'); };
    const spec = (d) => `${sf(d, 'modelLine')}|${sf(d, 'body')}|${sf(d, 'fuel')}`;
    const lookalikes = decisions.filter((d) => /G21 Touring/.test(sf(d, 'modelLine')) && /estate/.test(sf(d, 'body')) && /petrol/.test(sf(d, 'fuel')))
      .map((d) => ({ gateStatus: d.gateStatus, blockers: (d.blockers ?? []).map((b) => b.code ?? b), blockerDetail: (d.blockers ?? []).map((b) => b.reason ?? b.text ?? b.field ?? null), feedbackReason: d.feedback?.reasonCode ?? null, similarity: d.feedback?.similarity ?? null, effect: d.feedback?.effect ?? null }));
    extra.lookalikeGateEvidence = lookalikes;
    const hatch = decisions.find((d) => d.feedback?.reasonCode === 'feedback-not-similar-or-better' && /hatchback/.test(sf(d, 'body')));
    extra.improvementDiag = { candidate: hatch ? { spec: spec(hatch), zeroTo62: hatch.snapshot?.facts?.zeroTo62 ?? 'absent', sportinessFacts: Object.keys(hatch.snapshot?.facts ?? {}),
      components: (hatch.components ?? []).map((c) => ({ field: c.field, score: c.score, importance: c.importance, modelFactsIncomplete: c.modelFactsIncomplete ?? false, status: c.status ?? c.state ?? null })) } : null,
      baselineFactKeysSeen: (e0?.context?.knownFacts?.currentContract?.value && Object.keys(e0.context.knownFacts.currentContract.value)) || null };
    extra.previewStock = { sampleFeedback: decisions.find((d) => d.feedback?.reasonCode === 'feedback-not-similar-or-better')?.feedback ?? null,
      allBySpec: decisions.reduce((a, d) => { const k = spec(d); a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      gatePassedBySpec: decisions.filter((d) => d.feedback?.reasonCode !== 'gate-not-passed').reduce((a, d) => { const k = spec(d); a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      improvement: tally((d) => JSON.stringify(d.feedback?.improvement ?? null)) };
    extra.previewSummary = { gateStatus: tally((d) => d.gateStatus), feedbackReason: tally((d) => d.feedback?.reasonCode ?? 'no-feedback-record'), similarity: tally((d) => d.feedback?.similarity ?? 'none'),
      baseline: decisions[0]?.feedback?.baseline ?? null, rating: decisions[0]?.feedback?.rating ?? null, topLevelKeys: Object.keys(val(pv) ?? {}), sampleDecisionKeys: Object.keys(decisions[0] ?? {}),
      unknownCodes: decisions.reduce((a, d) => { for (const u of (d.unknowns ?? [])) { const k = u.code ?? u; a[k] = (a[k] ?? 0) + 1; } return a; }, {}) };
    extra.preview = { status: pv.body?.status, total: decisions.length, similarCount: similar.length, similar: similar.slice(0, 12), conflicts: conflicts.slice(0, 8), gateCodesSeen: gateCodes, feedbackVersion: val(pv)?.versions?.feedback ?? null,
      feedbackEffects: decisions.reduce((a, d) => { const k = d.feedback?.effect ?? 'none'; a[k] = (a[k] ?? 0) + 1; return a; }, {}) };
    step('8 preview: every similar car with a gate blocker stays ineligible (gates first)', pv.body?.status === 'ok' && conflicts.every((d) => d.gateStatus === 'ineligible') && lookalikes.filter((d) => d.blockers.some((b) => gating.includes(b))).every((d) => d.gateStatus === 'ineligible' && d.effect !== 'kept'), { ...extra.preview, lookalikes });
    if (!conflicts.length) report.findings.push(`${tag}: no similar car met an essentials/affordability gate in the released stock; gate codes seen: ${Object.keys(gateCodes).join(', ') || 'none'}.`);

    extra.activityAfterRelease = s.val(await s.api('/api/gcsp/activity'));
    if (!list.length) {
      step('6 release: positive case offers a similar or improved car', false, { release: rel, offers: 'none', note: 'No offer exists after the release; see step 8 for the brief preview evidence.' });
      report.findings.push(`${tag}: positive run produced no offer after next-release.`);
      // Fallback asked for: Same again on (continuity), then a second release; G21 is policy-excluded so no offer is expected.
      await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle();
      await page.getByRole('switch', { name: 'Same again, please!' }).check({ force: true }); await page.waitForTimeout(1200); await s.idle(); await s.reload(); await shot('06c-same-again-on');
      const sa = await s.cats(); const rel2 = await s.release('walk371-pos-tick-2');
      await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle();
      const l2 = (await s.offers()).map(s.brief); await shot('06d-account-same-again-after-release');
      const act2 = s.val(await s.api('/api/gcsp/activity'));
      extra.sameAgainAttempt = { sameAgain: sa.sameAgain, release: rel2, offers: l2, lastCheck: act2?.lastSuccessfulCheck ?? null };
      step('6c Same again on, second release: result recorded (an offer, if any, is the same model as the current car)', rel2.tickStatus === 200 && l2.every((o) => o.reasons.includes('same-again-match')), extra.sameAgainAttempt);
    } else {
      const o = brs[0];
      const ok = rel.tickStatus === 200 && o.reasons.some((r) => ['feedback-similar', 'feedback-improvement'].includes(r)) && Boolean(o.feedbackRevision);
      step('6a Offer read: reasons include feedback-similar or feedback-improvement and quote.revisions.feedback is set', ok, { release: rel, offer: o });
      // Open the Offer page by the account link when present, else by the coordinates.
      const href = await page.locator('a[href*="/gcsp/offer"]').first().getAttribute('href').catch(() => null);
      await page.goto(href ? new URL(href, ORIGIN).href : `${ORIGIN}/gcsp/offer?offerId=${encodeURIComponent(o.offerId)}&runId=${encodeURIComponent(o.runId)}`, { waitUntil: 'load', timeout: 60000 });
      await page.getByText('Benefits', { exact: true }).first().waitFor({ timeout: 10000 }); await page.waitForTimeout(300);
      const text = await page.locator('body').innerText();
      const sentence = ['Similar to your current car, which you rated highly.', 'Better than your current car for sportiness.', 'Better than your current car for'].find((t) => text.includes(t));
      await shot('06b-offer-page');
      if (vp[0] === 375) { await page.setViewportSize({ width: 320, height: 1000 }); await shot('06b-offer-page-320'); await page.setViewportSize({ width: vp[0], height: vp[1] }); }
      step('6b live Offer page shows the feedback reason in Benefits', Boolean(sentence) && text.includes('Benefits'), { linkFromAccount: href, sentence: sentence ?? null, title: await page.locator('h1').first().innerText().catch(() => null), offerRead: o });
    }
    if (list.length) {
      await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle();
      await page.getByRole('switch', { name: 'Same again, please!' }).check({ force: true }); await page.waitForTimeout(1200); await s.idle(); await s.reload(); await shot('06c-same-again-on');
      if (vp[0] === 375) { await page.setViewportSize({ width: 320, height: 1000 }); await shot('06c-account-320'); await page.setViewportSize({ width: vp[0], height: vp[1] }); }
      const sa = await s.cats(); const rel2 = await s.release('walk371-pos-tick-2');
      await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle();
      const l2 = (await s.offers()).map(s.brief); await shot('06d-account-same-again-after-release');
      const act2 = s.val(await s.api('/api/gcsp/activity'));
      extra.sameAgainAttempt = { sameAgain: sa.sameAgain, release: rel2.outcomes?.find((o) => o.handler === 'stock-release'), offers: l2.map((o) => ({ car: o.car, reasons: o.reasons })), lastCheck: act2?.lastSuccessfulCheck ?? null, note: 'G21 is policy-excluded; with the offer already held the check may differ' };
      step('6c Same again on, second release: result recorded', rel2.tickStatus === 200, extra.sameAgainAttempt);
    }
    const errsPos = errors.length;
    await s.stop(); s = null;

    // ---- Negative run: a fresh host (reset into the same fresh state is not offered by the scenarios, so the host is restarted) ----
    s = await session(vp, tag, rows, errors, 'neg-');
    const { page: np, step: nstep, shot: nshot } = s;
    await s.signIn(); const nrs = await s.resetJourney('walk371-neg-reset'); extra.negativeReset = nrs;
    await np.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle(); await s.setStars(1); await s.reload();
    await s.pickTile('body', 'Touring / Estate', true); await s.pickTile('fuel', 'Petrol', false); await s.pickTile('size', null, false);
    if ((await s.cats()).categories.body?.importance !== 'high') await s.makeImportant('body');
    const nl = await s.engage(); const nc = await s.cats(); await nshot('07a-negative-engaged');
    nstep('7a negative run set up: rating 1, three categories, Buddy engaged', nc.rating?.value === 1 && Object.keys(nc.categories).length >= 3 && nl?.text === 'Buddy engaged', { editor: nc, lamp: nl });
    const nrel = await s.release('walk371-neg-tick');
    await np.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load' }); await s.settle();
    const nlist = await s.offers(); const nbr = nlist.map(s.brief); extra.negativeOffers = nbr; await nshot('07b-negative-after-release');
    const similarOffered = nbr.filter((o) => o.reasons.some((r) => ['feedback-similar'].includes(r)) || (/G21/i.test(JSON.stringify(o.car.modelLine)) && /estate/i.test(JSON.stringify(o.car.body)) && /petrol/i.test(JSON.stringify(o.car.fuel))));
    nstep('7b negative case: no offered car is similar to the current car (G21 Touring, estate, petrol)', nrel.tickStatus === 200 && similarOffered.length === 0, { release: nrel, offers: nbr.length ? nbr : 'none' });
    if (nlist.length) {
      const href = `${ORIGIN}/gcsp/offer?offerId=${encodeURIComponent(nbr[0].offerId)}&runId=${encodeURIComponent(nbr[0].runId)}`;
      await np.goto(href, { waitUntil: 'load' }); await np.getByText('Benefits', { exact: true }).first().waitFor({ timeout: 10000 }); await nshot('07c-negative-offer');
      nstep('7c live Offer explains the negative-rating influence', (await np.locator('body').innerText()).includes('Different from the current car you rated poorly.'));
    } else nstep('7c live Offer explains the negative-rating influence', false, 'No negative-case offer was produced.');
    const hold = Math.min(Number(process.env.WALK_REVIEW_HOLD_MS) || 0, 180000);
    if (vp[0] === VIEWPORTS.at(-1)[0] && hold > 0) {
      await writeFile(`${OUT}/review-ready.json`, JSON.stringify({ origin: ORIGIN, page: np.url(), viewport: vp }));
      console.log('Independent browser review ready.');
      const until = Date.now() + hold;
      while (Date.now() < until) {
        if (await access(`${OUT}/review-continue`).then(() => true, () => false)) break;
        await np.waitForTimeout(500);
      }
    }
    extra.errorsPositive = errors.slice(0, errsPos);
  } catch (error) {
    rows.push({ step: 'walkthrough completed without throwing', pass: false, detail: String(error.stack).slice(0, 700) }); console.log(`FAIL ${tag} threw ${error.message}`);
    try { if (s) await s.shot('zz-failure'); } catch {}
  } finally {
    if (s) await s.stop();
  }
  const bad = errors.filter((e) => !/^http 401: (GET|POST) /.test(e) && !/expected-http/.test(e));
  rows.push({ step: 'no page or console errors, no HTTP >= 400 other than the expected 401 before login', pass: bad.length === 0, detail: errors.length ? errors : undefined });
  return { rows, errors, ...extra };
}

try {
  await mkdir(scratch, { recursive: true }); await mkdir(OUT, { recursive: true });
  report.commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  for (const vp of VIEWPORTS) {
    report.viewports[vp[0]] = await walk(vp);
    await writeFile(`${OUT}/walkthrough.json`, JSON.stringify(report, null, 2));
  }
  const all = Object.values(report.viewports).flatMap((v) => v.rows);
  report.summary = { steps: all.length, passed: all.filter((r) => r.pass).length, failed: all.filter((r) => !r.pass).map((r) => r.step) };
  if (report.summary.failed.length) process.exitCode = 1;
  const left = spawnSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim();
  report.listenersAfter = left || 'none';
  await writeFile(`${OUT}/walkthrough.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 1), report.listenersAfter);
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
} finally {
  for (const stop of stoppers) await stop().catch(() => {});
}
