#!/usr/bin/env node
// FUCQ-121 keyboard-only browser capture of Greg's order plan panel (CDP). Interaction is Input.* key events; Runtime.evaluate only reads;
// scroll gestures frame screenshots. Usage: SCRATCH=<absolute scratch dir> node docs/gcsp/evidence/fucq121/capture.mjs (starts and stops its own server).
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { launchChrome, stopChrome, Cdp, Page, sleep, freePort } from '../fucq104/integrated/lib.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
const SCRATCH = process.env.SCRATCH;
if (!SCRATCH || !SCRATCH.startsWith('/')) throw new Error('SCRATCH must be an absolute path');
const W = { 1280: [1280, 900], 375: [375, 812] };
const report = { story: 'FUCQ-121', startedAt: new Date().toISOString(), commit: null, base: null, widths: [1280, 375], captures: [], steps: {}, focusTrail: [],
  console: [], pageErrors: [], logErrors: [], failedRequests: [], badResponses: [], planApi: [], notes: [], cleanup: {} };
let stage = 'start'; let chrome; let p; let cdp; let server; let base;
const note = (s) => { report.notes.push(s); console.log('NOTE', s); };

async function step(name, fn) {
  stage = name; const t = Date.now();
  try { const r = await fn(); report.steps[name] = { ok: true, ms: Date.now() - t, ...(r || {}) }; console.log('OK  ', name); return true; }
  catch (e) { report.steps[name] = { ok: false, error: e.message, ms: Date.now() - t }; console.log('FAIL', name, e.message); return false; }
}

// Own server: hosted entry, memory repository, throwaway access key that is only ever typed by key events.
async function startServer() {
  const port = await freePort(); const key = randomBytes(16).toString('hex');
  const fd = openSync(join(SCRATCH, 'server.log'), 'w');
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd],
    env: { ...process.env, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', DEMO_ACCESS_KEY: key, PORT: String(port), GCSP_PUBLIC_ORIGIN: `http://localhost:${port}`, GCSP_OFFLINE: '1', TMPDIR: SCRATCH } });
  child.unref(); closeSync(fd);
  for (let i = 0; i < 180; i++) {
    await sleep(500);
    try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); if (r.status === 200) return { pid: child.pid, port, key }; } catch { /* not up yet */ }
  }
  throw new Error('server did not answer /health within 90 s');
}
async function stopServer() {
  if (!server) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  await sleep(1500);
  try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ }
  const out = await promisify(execFile)('lsof', ['-nP', `-iTCP:${server.port}`]).then((r) => r.stdout.trim(), () => '');
  report.cleanup.serverPortListeners = out || 'none';
}

// ---- Reads and framing ----
async function scrollBy(dy) { await cdp.send('Input.synthesizeScrollGesture', { x: 200, y: 400, yDistance: -dy, gestureSourceType: 'mouse', speed: 4000 }); }
async function frame(sel, top = 70) {
  for (let i = 0; i < 8; i++) {
    const cur = await p.read(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.getBoundingClientRect().top : null; })()`);
    if (cur === null) return false;
    if (Math.abs(cur - top) < 8) return true;
    await scrollBy(cur - top); await sleep(300);
  }
  return true;
}
const viewport = async (w) => p.setViewport(...W[w]);
const planText = () => p.read(`document.querySelector('.gcsp-plan')?.innerText ?? ''`);
const planState = () => p.read(`document.querySelector('.gcsp-plan')?.dataset.state ?? null`);
const pageMetrics = () => p.read(`(() => {
  const vw = document.documentElement.clientWidth; const plan = document.querySelector('.gcsp-plan');
  const over = plan ? [...plan.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !e.parentElement.closest('.gcsp-table-wrap'); })
    .slice(0, 6).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40) + ' ' + Math.round(e.getBoundingClientRect().right)) : [];
  const clipped = plan ? [...plan.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return /hidden|clip/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0; })
    .slice(0, 6).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40) + ' ' + e.scrollWidth + '>' + e.clientWidth) : [];
  return { pageOverflowPx: document.documentElement.scrollWidth - vw, panelOverflowPx: plan ? plan.scrollWidth - plan.clientWidth : null, offscreen: over, clipped, viewportWidth: vw };
})()`);
const focusNow = async () => {
  const a = await p.active();
  return { tag: a.tag, type: a.type, name: a.name, role: a.role, focusVisible: a.focusVisible, outline: a.outline, boxShadow: a.boxShadow };
};
async function trail(action) { await sleep(500); const f = await focusNow(); report.focusTrail.push({ stage, action, focus: `${f.tag}${f.role ? '[' + f.role + ']' : ''}: ${f.name}`, focusVisible: f.focusVisible, outline: f.outline }); return f; }

// Records one framed capture: PNG, overflow, focus, console errors and failed requests seen in the current stage.
async function capture(name, width, { selector = '.gcsp-plan', file = name, expectState, expectText = [], note: why = '' } = {}) {
  if (await p.read(`document.querySelector('.gcsp-presenter-controls')?.open ?? false`)) await closePresenter();
  await viewport(width); await sleep(300);
  const framed = await frame(selector, 70);
  const path = join(OUT, `${file}-${width}.png`); await p.shot(path);
  const m = await pageMetrics(); const text = await planText(); const focus = await focusNow(); const state = await planState();
  const checks = [];
  const check = (n, ok, detail = '') => checks.push({ check: n, ok: Boolean(ok), detail });
  check('panel in view', framed);
  if (expectState) check(`data-state is ${expectState}`, state === expectState, `state=${state}`);
  for (const re of expectText) check(`text ${re}`, re.test(text));
  check('no horizontal page overflow', m.pageOverflowPx <= 0, `${m.pageOverflowPx}px`);
  check('no overflow inside the panel', (m.panelOverflowPx ?? 0) <= 0 && m.offscreen.length === 0, `${m.panelOverflowPx}px ${m.offscreen.join('; ')}`);
  check('no clipped text', m.clipped.length === 0, m.clipped.join('; '));
  check('no em dash on screen', !text.includes('—'));
  const ring = focus.outline && !/^none/.test(focus.outline) || focus.boxShadow;
  if (focus.tag !== 'body') check('keyboard focus is visible', focus.focusVisible && (ring || focus.role === 'slider' || focus.type === 'range'), focus.type === 'range' ? 'range thumb ring (pseudo-element), see PNG' : `${focus.outline} ${focus.boxShadow}`);
  const errs = report.console.filter((c) => c.stage === stage).length + report.pageErrors.filter((c) => c.stage === stage).length + report.logErrors.filter((c) => c.stage === stage && !/status of 40[134]/.test(c.text || '')).length;
  const failed = report.failedRequests.filter((c) => c.stage === stage).length;
  check('no console errors', errs === 0, `${errs}`); check('no failed requests', failed === 0, `${failed}`);
  const row = { state: name, width, png: path.replace(`${ROOT}/`, ''), pass: checks.every((c) => c.ok), pageOverflowPx: m.pageOverflowPx, panelOverflowPx: m.panelOverflowPx,
    focusedElement: `${focus.tag}${focus.role ? '[' + focus.role + ']' : ''}: ${focus.name}`, focusVisible: focus.focusVisible, outline: focus.outline, consoleErrors: errs, failedRequests: failed, checks, note: why };
  report.captures.push(row); console.log(row.pass ? 'PASS' : 'FAIL', `${file}-${width}`, checks.filter((c) => !c.ok).map((c) => c.check + ' (' + c.detail + ')').join(' | '));
  return row;
}
async function bothWidths(name, opts) { for (const w of [1280, 375]) await capture(name, w, opts); await viewport(1280); }

// Scratch-only review shots down the panel (not committed): scrolls in steps and saves PNGs under SCRATCH.
async function peeks(label, steps = 4) {
  for (const w of [1280, 375]) {
    await viewport(w); await sleep(300); await frame('.gcsp-plan', 70);
    for (let k = 1; k <= steps; k++) { await scrollBy(Math.round(W[w][1] * 0.85)); await sleep(350); await p.shot(join(SCRATCH, `peek-${label}-${w}-${k}.png`)); }
  }
  await viewport(1280);
}

// ---- Keyboard helpers ----
const waitText = (re, ms = 20000, sel = '.gcsp-plan') => p.waitFor(`/${re.source}/${re.flags}.test(document.querySelector('${sel}')?.innerText || '')`, ms, String(re));
async function tabUntil(expr, { max = 400, shift = false } = {}) {
  for (let i = 0; i <= max; i++) { if (await p.read(expr)) return p.active(); if (i < max) await p.key('Tab', { shift }); }
  throw new Error('tabUntil: not reached: ' + expr.slice(0, 120) + ' last=' + JSON.stringify(await focusNow()));
}
const buttonText = (re) => `(() => { const a = document.activeElement; return a && a.tagName === 'BUTTON' && ${re}.test(a.textContent.trim()) && !a.disabled; })()`;
const limitField = (row, edge) => `(() => { const a = document.activeElement; const l = a?.closest?.('.gcsp-plan-limit'); return a?.tagName === 'INPUT' && !!l && l.querySelector('.gcsp-plan-limit-name').textContent === ${JSON.stringify(row)} && a.id.endsWith('-${edge}'); })()`;
const sliderFor = (row) => `document.activeElement?.type === 'range' && document.activeElement.getAttribute('aria-label') === ${JSON.stringify(`${row} maximum slider`)}`;
async function setLimit(row, edge, value) {
  await tabUntil(limitField(row, edge));
  await p.key('End'); for (let i = 0; i < 4; i++) await p.key('Backspace'); await p.type(String(value));
  const v = (await p.active()).value; if (String(v) !== String(value)) throw new Error(`${row} ${edge} shows ${v}, wanted ${value}`);
  await trail(`typed ${value} into ${row} ${edge}`); return v;
}
async function pressButton(re, label) { await tabUntil(buttonText(re)); await p.key('Enter'); await trail(`Enter on ${label}`); }
async function closePresenter() {
  const open = await p.read(`document.querySelector('.gcsp-presenter-controls')?.open ?? false`);
  if (!open) return;
  await tabUntil(`document.activeElement?.tagName === 'SUMMARY' && /Presenter controls/.test(document.activeElement.textContent)`); await p.key('Enter');
  await p.waitFor(`!document.querySelector('.gcsp-presenter-controls').open`, 5000, 'presenter closed');
}
async function openPresenter() {
  const open = await p.read(`document.querySelector('.gcsp-presenter-controls').open`);
  await tabUntil(`document.activeElement?.tagName === 'SUMMARY' && /Presenter controls/.test(document.activeElement.textContent)`);
  if (!open) { await p.key('Enter'); await p.waitFor(`document.querySelector('.gcsp-presenter-controls').open`, 5000, 'presenter open'); }
}
async function chooseRadio(legend, re) {
  await p.tabTo((d) => d.legend === legend && d.role === 'radio');
  for (let i = 0; i < 8 && !re.test((await p.active()).name); i++) await p.key('ArrowDown');
  const sel = await p.active(); if (!re.test(sel.name)) throw new Error(`${legend} radio not selected: ${sel.name}`);
  await trail(`arrow keys chose ${sel.name}`); return sel.name;
}
const presenterReady = (ms = 90000) => p.waitFor(`/Presenter controls ready/.test(document.querySelector('.gcsp-presenter-controls .gcsp-note[role=status]')?.textContent || '')`, ms, 'presenter ready');
async function switchTo(re) {
  await openPresenter(); await chooseRadio('Acting principal', re);
  await p.tabTo((d) => /Switch principal/.test(d.name)); await p.key('Enter'); await trail('Enter on Switch principal');
}
async function pickOption(labelRe, wanted) {
  await p.tabTo((d) => d.tag === 'select' && labelRe.test(d.name), { max: 400 });
  await p.type(wanted); await sleep(200);
  const t = await p.read(`document.activeElement.selectedOptions?.[0]?.textContent ?? null`); if (!t || !t.startsWith(wanted)) throw new Error(`could not select ${wanted}; got ${t}`);
  return t;
}
async function setNumber(labelRe, value) {
  await p.tabTo((d) => d.tag === 'input' && d.type === 'number' && labelRe.test(d.name), { max: 400 });
  await p.key('End'); for (let i = 0; i < 4; i++) await p.key('Backspace'); await p.type(String(value));
  const v = (await p.active()).value; if (String(v) !== String(value)) throw new Error(`number field shows ${v}, wanted ${value}`);
}
const ordersRows = () => p.read(`[...document.querySelectorAll('.gcsp-orders table tbody tr')].map((r) => [...r.children].map((c) => c.textContent.trim()).join(' | '))`);
const clockNow = () => p.read(`(document.querySelector('.gcsp-presenter-controls')?.textContent.match(/DemoClock \\(UTC\\)(\\d{4}-[\\d:TZ.-]+)/) || [])[1] ?? null`);

// Second window on the same session, used only to move the clock while the first window holds a plan.
async function secondWindow(fn) {
  const r = await fetch(`http://127.0.0.1:${chrome.port}/json/new?about:blank`, { method: 'PUT' }); const tab = await r.json();
  const cdp2 = new Cdp(tab.webSocketDebuggerUrl); await cdp2.open();
  const saved = { p, cdp }; cdp = cdp2; p = new Page(cdp2);
  try {
    for (const d of ['Page', 'Runtime']) await cdp2.send(`${d}.enable`);
    await p.setViewport(...W[1280]);
    await cdp2.send('Page.navigate', { url: `${base}/gcsp-presenter.html` });
    await p.waitFor(`!!document.querySelector('.gcsp-plan') && !!document.querySelector('.gcsp-presenter-controls') && !document.querySelector('.gcsp-presenter-controls').hidden`, 30000, 'second window dashboard');
    return await fn();
  } finally { cdp2.close(); p = saved.p; cdp = saved.cdp; await fetch(`http://127.0.0.1:${chrome.port}/json/close/${tab.id}`).catch(() => {}); }
}

try {
  await mkdir(SCRATCH, { recursive: true });
  report.commit = await promisify(execFile)('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).then((r) => r.stdout.trim(), () => null);
  report.dirtyFiles = await promisify(execFile)('git', ['status', '--short', '--', 'blocks', 'server'], { cwd: ROOT }).then((r) => r.stdout.trim().split('\n').filter(Boolean), () => []);
  server = await startServer(); base = `http://localhost:${server.port}`; report.base = base.replace(/:\d+$/, ':<port>');
  chrome = await launchChrome(SCRATCH);
  cdp = new Cdp(chrome.wsUrl); await cdp.open(); p = new Page(cdp);
  const reqs = new Map();
  cdp.on((m) => {
    const { method, params } = m;
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(params.type)) report.console.push({ stage, type: params.type, text: params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    if (method === 'Runtime.exceptionThrown') report.pageErrors.push({ stage, text: (params.exceptionDetails.exception?.description || params.exceptionDetails.text || '').slice(0, 300) });
    if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) report.logErrors.push({ stage, level: params.entry.level, text: params.entry.text?.slice(0, 200), url: params.entry.url });
    if (method === 'Network.requestWillBeSent') { const u = new URL(params.request.url); reqs.set(params.requestId, { stage, method: params.request.method, path: u.pathname, status: null }); }
    if (method === 'Network.responseReceived') {
      const row = reqs.get(params.requestId); if (row) { row.status = params.response.status; if (/order-plan/.test(row.path)) report.planApi.push(row); }
      if (params.response.status >= 400) report.badResponses.push({ stage, url: new URL(params.response.url).pathname, status: params.response.status });
    }
    if (method === 'Network.loadingFailed') { const row = reqs.get(params.requestId); if (!params.canceled) report.failedRequests.push({ stage, url: row?.path, error: params.errorText }); }
  });
  for (const d of ['Page', 'Runtime', 'Network', 'Log']) await cdp.send(`${d}.enable`);
  await viewport(1280);

  await step('open-with-demo-key', async () => {
    await cdp.send('Page.navigate', { url: `${base}/gcsp-presenter.html` });
    await p.waitFor(`!!document.querySelector('#key')`, 20000, 'access form');
    await p.tabTo((d) => d.id === 'key'); await p.type(server.key); await p.key('Enter'); await trail('Enter on the demo key form');
    await p.waitFor(`document.body.innerText.includes('Presenter controls')`, 30000, 'presenter bar');
  });
  await step('reset-to-decline-then-change', async () => {
    await openPresenter(); await chooseRadio('Scenario', /Decline then change/);
    await p.tabTo((d) => /Reset scenario/.test(d.name)); await p.key('Enter'); await trail('Enter on Reset scenario');
    await p.tabTo((d) => /Confirm reset/.test(d.name)); await p.key('Enter'); await trail('Enter on Confirm reset');
    await p.waitFor(`document.body.innerText.includes('Presenter workspace')`, 120000, 'workspace remounted after reset');
    await presenterReady(); return { clock: await clockNow() };
  });
  await step('switch-to-greg', async () => {
    await switchTo(/Greg/);
    await p.waitFor(`!!document.querySelector('.gcsp-plan') && document.querySelector('.gcsp-plan').dataset.state !== 'loading' && !!document.querySelector('.gcsp-orders')`, 60000, 'greg plan + orders');
    const runId = await p.read(`(document.querySelector('.gcsp-presenter-controls')?.textContent.match(/Run(demo-[0-9a-f]+)/) || [])[1] ?? null`);
    await closePresenter();
    return { planState: await planState(), clock: await clockNow(), runId };
  });

  await step('capture-ready', async () => { await bothWidths('ready', { expectState: 'ready', expectText: [/Next order/i, /Forecast source/, /Expressed demand/, /Policy version/, /Plan for/, /Proposed order/, /Unmet needs/, /Binding constraints/, /Alternative plans/], note: 'Live plan after reset to Decline then change.' }); });

  // Edit a bound by typing and by slider, then preview.
  const TOURING = '3 Series Touring 320i';
  await step('peek-ready', () => peeks('ready'));
  await step('edit-and-preview', async () => {
    await setLimit(TOURING, 'min', 2);
    await tabUntil(sliderFor(TOURING)); const before = await p.read('document.activeElement.value'); await p.key('ArrowRight'); const after = await p.read('document.activeElement.value');
    await trail(`ArrowRight on ${TOURING} maximum slider (${before} to ${after})`);
    if (String(before) === String(after)) throw new Error('slider did not move');
    for (const w of [1280, 375]) await capture('limits editor after a typed minimum and a slider move', w, { selector: '.gcsp-plan-group:has(.gcsp-plan-slider) .gcsp-plan-limit:nth-of-type(3)', file: 'limits-editor', expectText: [/Change limits/],
      note: 'Focus is on the slider; the typed minimum 2 is in the field above it.' });
    await viewport(1280);
    await pressButton(/^Preview with these limits$/, 'Preview with these limits');
    await waitText(/Back to current plan|Limits that conflict/, 30000);
    return { slider: `${before} to ${after}`, heading: (await focusNow()).name };
  });
  await step('capture-preview', async () => { await bothWidths('preview', { expectText: [/Preview/, /Back to current plan/, /Differences from the current plan/, /Previewing saves and orders nothing|Nothing is saved or ordered/], note: 'Minimum raised to 2 and maximum slider moved on 3 Series Touring 320i.' }); });

  await step('infeasible', async () => {
    await pressButton(/^Back to current plan$/, 'Back to current plan');
    await pressButton(/^Reset limits$/, 'Reset limits');
    await setLimit(TOURING, 'min', 2); await setLimit('3 Series Touring', 'max', 0);
    await pressButton(/^Preview with these limits$/, 'Preview with these limits');
    await waitText(/Limits that conflict/, 30000);
  });
  await step('capture-infeasible', async () => { await bothWidths('infeasible', { expectText: [/Limits that conflict/, /Back to current plan/], note: 'Derivative minimum 2 under a model maximum of 0.' }); });

  await step('prepare-stale-preview', async () => {
    await pressButton(/^Back to current plan$/, 'Back to current plan');
    await pressButton(/^Reset limits$/, 'Reset limits');
    await setLimit(TOURING, 'min', 2);
    await pressButton(/^Preview with these limits$/, 'Preview with these limits');
    await waitText(/Back to current plan/, 30000);
    const submit = await p.read(`[...document.querySelectorAll('.gcsp-plan button')].find((b) => /^Request /.test(b.textContent))?.disabled`);
    if (submit !== false) throw new Error('Request button is not enabled for the previewed plan');
  });
  await step('move-clock-in-second-window', async () => secondWindow(async () => {
    await openPresenter(); const before = await clockNow();
    await p.tabTo((d) => d.tag === 'button' && d.name.startsWith('Tick (') && !d.disabled); await p.key('Enter');
    await p.waitFor(`document.querySelector('.gcsp-presenter-controls').innerText.includes('Last tick')`, 15000, 'tick result');
    await p.waitFor(`!/in progress/.test(document.querySelector('.gcsp-presenter-controls .gcsp-note[role=status]')?.textContent || '')`, 30000, 'tick finished');
    const after = await clockNow(); if (after === before) throw new Error('clock did not move');
    return { clockBefore: before, clockAfter: after };
  }));
  await step('request-from-stale-plan', async () => {
    await tabUntil(buttonText(/^Request \d+ vehicle/)); const label = await p.read('document.activeElement.textContent.trim()');
    await p.key('Enter'); await trail(`Enter on ${label}`);
    await waitText(/Replan needed/, 30000); return { requestButton: label, focus: (await focusNow()).name };
  });
  await step('capture-stale', async () => { await bothWidths('stale', { expectText: [/Replan needed/, /Replan with the latest inputs/], note: 'Clock moved from a second window; Request pressed from the older plan.' }); });
  await step('replan', async () => {
    await pressButton(/^Replan with the latest inputs$/, 'Replan with the latest inputs');
    await p.waitFor(`!/Replan needed/.test(document.querySelector('.gcsp-plan').innerText) && /Back to current plan/.test(document.querySelector('.gcsp-plan').innerText)`, 30000, 'stale banner gone');
    const state = await p.read(`document.querySelector('.gcsp-plan').dataset.state`); return { stateAfterReplan: state };
  });

  await step('submit-plan', async () => {
    await tabUntil(buttonText(/^Request \d+ vehicle/)); const label = await p.read('document.activeElement.textContent.trim()');
    await p.key('Enter'); await trail(`Enter on ${label}`);
    await waitText(/Requested from Production/, 30000);
    await p.waitFor(`document.querySelectorAll('.gcsp-orders table tbody tr').length >= 1 && !document.querySelector('.gcsp-orders table').textContent.includes('No requests yet')`, 15000, 'request row in Order tracking with no Refresh press');
    return { requestButton: label, orders: await ordersRows() };
  });
  await step('capture-submitted', async () => {
    await bothWidths('submitted', { expectText: [/Requested from Production/, /Production has not confirmed anything yet/], note: 'Submitted from the previewed plan.' });
    await capture('order tracking after submit', 1280, { selector: '.gcsp-orders', file: 'order-tracking-after-submit', note: 'The request row appears without pressing Refresh orders.' });
  });

  await step('confirm-through-production-adapter', async () => {
    await closePresenter();
    await tabUntil(`document.activeElement?.tagName === 'SUMMARY' && /Synthetic production controls/.test(document.activeElement.textContent)`);
    if (!(await p.read(`document.querySelector('.gcsp-orders-production').open`))) { await p.key('Enter'); await p.waitFor(`document.querySelector('.gcsp-orders-production').open`, 5000, 'production controls open'); }
    await trail('opened Synthetic production controls');
    const rows = await ordersRows(); const requested = Number((rows[0].split(' | ')[2] || '').replace(/\D/g, '')) || 2;
    await p.tabTo((d) => d.tag === 'select' && /^Request/.test(d.name), { max: 400 });
    const first = await p.read(`document.activeElement.options[0]?.textContent ?? ''`); await p.type(first.slice(0, 8)); await trail(`chose request ${first}`);
    await pickOption(/^Production response/, 'Confirm now');
    await setNumber(/^Quantity to confirm/, requested);
    await p.tabTo((d) => d.tag === 'button' && /Save production response/.test(d.name)); await p.key('Enter'); await trail('Enter on Save production response');
    await p.waitFor(`/Production confirmed|Confirmation saved|confirmed/i.test(document.querySelector('.gcsp-orders-status')?.textContent || '')`, 20000, 'orders notice');
    const t0 = Date.now();
    await waitText(/Replanned after a Production response/, 25000);
    return { confirmedQuantity: requested, planRefreshedWithoutPress: true, planRefreshMs: Date.now() - t0, orders: await ordersRows() };
  });
  await step('capture-replanned', async () => { await bothWidths('replanned', { expectText: [/Replanned after a Production response/], note: 'Plan refreshed by itself after the Production confirmation.' }); });

  await step('tick-in-same-window-reloads-plan', async () => {
    const label = async () => ((await planText()).match(/Plan for\n(.*)/) || [])[1] ?? null;
    const before = await label(); await openPresenter();
    // This window's clock readback is behind the second window's Tick, so refresh it first (as Russell would).
    await p.tabTo((d) => d.tag === 'button' && /Refresh readback/.test(d.name) && !d.disabled); await p.key('Enter'); await trail('Enter on Refresh readback'); await sleep(1500);
    await p.tabTo((d) => d.tag === 'button' && d.name.startsWith('Tick (') && !d.disabled); await p.key('Enter'); await trail('Enter on Tick');
    await p.waitFor(`/Plan for\\n(.*)/.exec(document.querySelector('.gcsp-plan').innerText)?.[1] !== ${JSON.stringify(before)}`, 30000, 'plan reloaded after Tick with no Refresh press');
    const after = await label(); await closePresenter(); return { planForBefore: before, planForAfter: after, stale: /Replan needed/.test(await planText()) };
  });
  await step('employee-refused-live', async () => {
    await switchTo(/Paula/);
    await p.waitFor(`document.body.innerText.includes('Your cars') && !document.querySelector('.gcsp-plan')`, 40000, 'employee workspace');
    const panelMounted = await p.read(`!!document.querySelector('.gcsp-plan')`);
    stage = 'employee-api-probe';
    await cdp.send('Page.navigate', { url: `${base}/api/gcsp/greg/order-plan` });
    await p.waitFor(`document.body && document.body.innerText.length > 0`, 10000, 'api body');
    const body = await p.read(`document.body.innerText.slice(0, 200)`);
    const probe = report.badResponses.filter((b) => b.stage === 'employee-api-probe');
    report.employeeApiProbe = { panelMountedForEmployee: panelMounted, status: probe.find((b) => /order-plan/.test(b.url))?.status ?? null, body };
    if (report.employeeApiProbe.status !== 403) throw new Error('expected 403, got ' + JSON.stringify(report.employeeApiProbe));
    report.badResponses = report.badResponses.filter((b) => b.stage !== 'employee-api-probe');
    report.expected403 = report.employeeApiProbe;
    return report.employeeApiProbe;
  });

  // Fixture states from the harness, plus long derivative names.
  const fixture = async (plan, label) => {
    stage = `fixture-${label}`;
    await cdp.send('Page.navigate', { url: `${base}/gcsp-greg.html?fixture=populated&plan=${plan}` });
    await p.waitFor(`!!document.querySelector('.gcsp-plan')`, 20000, 'fixture panel');
  };
  await step('fixture-loading', async () => { await fixture('loading', 'loading'); await p.waitFor(`document.querySelector('.gcsp-plan').dataset.state === 'loading'`, 5000); await bothWidths('loading', { file: 'fixture-loading', expectState: 'loading', expectText: [/Loading the next order/] }); });
  await step('fixture-no-demand', async () => { await fixture('no-demand', 'no-demand'); await p.waitFor(`document.querySelector('.gcsp-plan').dataset.state === 'no-demand'`, 15000); await bothWidths('empty (no demand)', { file: 'fixture-no-demand', expectState: 'no-demand', expectText: [/No saved demand to plan for yet/] }); });
  await step('fixture-unavailable', async () => {
    await fixture('unavailable', 'unavailable'); await p.waitFor(`document.querySelector('.gcsp-plan').dataset.state === 'unavailable'`, 15000);
    await tabUntil(buttonText(/^Retry$/)); await trail('Tab reached Retry');
    await bothWidths('unavailable', { file: 'fixture-unavailable', expectState: 'unavailable', expectText: [/The order plan is unavailable/, /Retry/] });
  });
  await step('fixture-refused', async () => { await fixture('refused', 'refused'); await p.waitFor(`document.querySelector('.gcsp-plan').dataset.state === 'refused'`, 15000); await bothWidths('refused (non-Greg)', { file: 'fixture-refused', expectState: 'refused', expectText: [/You cannot open this plan/] }); });
  await step('fixture-long-names', async () => {
    await fixture('ready', 'long-names'); await p.waitFor(`document.querySelector('.gcsp-plan').dataset.state === 'ready'`, 15000);
    await bothWidths('plan ready with long derivative names', { file: 'fixture-long-names', expectState: 'ready', expectText: [/eDrive40 M Sport Pro with Technology Plus and Comfort Packs/] });
    await trail('long-names fixture captured');
  });
} catch (e) { report.fatal = e.message; console.log('FATAL', e.message); }
finally {
  report.finishedAt = new Date().toISOString();
  try { cdp?.close(); await stopChrome(chrome); report.cleanup.chrome = 'stopped (process group), profile removed'; } catch (e) { report.cleanup.chromeError = e.message; }
  try { await stopServer(); } catch (e) { report.cleanup.serverError = e.message; }
  try { report.serverLogTail = readFileSync(join(SCRATCH, 'server.log'), 'utf8').trim().split('\n').slice(-8); await rm(join(SCRATCH, 'server.log'), { force: true }); } catch { /* no log */ }
  report.pass = !report.fatal && report.captures.length > 0 && report.captures.every((c) => c.pass) && Object.values(report.steps).every((s) => s.ok);
  await writeFile(join(OUT, 'capture-report.json'), JSON.stringify(report, null, 2));
  console.log('report written', Object.entries(report.steps).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'FAIL'}`).join(' '));
  process.exit(0);
}
