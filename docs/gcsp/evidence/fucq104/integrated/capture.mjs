#!/usr/bin/env node
// FUCQ-104 integrated keyboard-only browser capture (CDP). Reads state via Runtime.evaluate; all interaction is Input.* key events
// (plus mouse-wheel scrolling to frame screenshots). Usage: BASE=http://localhost:3017 SCRATCH=<dir> node capture.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, stopChrome, Cdp, Page, sleep } from './lib.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:3017';
const SCRATCH = process.env.SCRATCH;
if (!SCRATCH || !SCRATCH.startsWith('/')) throw new Error('SCRATCH must be an absolute path');
const W = { desktop: [1280, 900], narrow: [375, 812] };
const report = { story: 'FUCQ-104', base: BASE, startedAt: new Date().toISOString(), widths: { desktop: 1280, narrow: 375 }, screenshots: [], steps: {}, tabOrder: {},
  snapshots: {}, console: [], pageErrors: [], logErrors: [], failedRequests: [], badResponses: [], api: [], notes: [] };
let stage = 'start';
let chrome; let p; let cdp;
const note = (s) => { report.notes.push(s); console.log('NOTE', s); };

async function step(name, fn) {
  stage = name; const t = Date.now();
  try { const r = await fn(); report.steps[name] = { ok: true, ms: Date.now() - t, ...(r || {}) }; console.log('OK  ', name); }
  catch (e) { report.steps[name] = { ok: false, error: e.message, ms: Date.now() - t }; console.log('FAIL', name, e.message); }
}
async function shot(name) { const path = join(OUT, `${name}.png`); await p.shot(path); report.screenshots.push(path); }
// Vertical scroll gesture (framing only); mouseWheel hangs after keyboard scrolling of a region in headless Chrome.
async function scrollBy(dy) { await cdp.send('Input.synthesizeScrollGesture', { x: 200, y: 400, yDistance: -dy, gestureSourceType: 'mouse', speed: 4000 }); }
async function ordersTop() { return p.read(`Math.round(document.querySelector('.gcsp-orders').getBoundingClientRect().top)`); }
async function wheelTo(top = 70) {
  for (let i = 0; i < 8; i++) {
    const cur = await p.read(`document.querySelector('.gcsp-orders').getBoundingClientRect().top`);
    if (Math.abs(cur - top) < 8) break;
    await scrollBy(cur - top);
    await sleep(350);
  }
}
async function wheelToText(re, top = 70) {
  for (let i = 0; i < 8; i++) {
    const cur = await p.read(`(() => { const e = [...document.querySelectorAll('h2,h3,caption,p,dt')].find((n) => /${re}/.test(n.textContent)); return e ? e.getBoundingClientRect().top : null; })()`);
    if (cur === null || Math.abs(cur - top) < 8) return cur !== null;
    await scrollBy(cur - top); await sleep(350);
  }
  return true;
}
async function viewport(which) { await p.setViewport(...W[which]); }
// Framed captures of the current state at both widths: dashboard and order panel.
async function closePresenter() {
  if (!(await p.read(`document.querySelector('.gcsp-presenter-controls').open`))) return;
  await p.tabTo((x) => x.tag === 'summary' && /Presenter controls/.test(x.name)); await p.key('Enter');
  await p.waitFor(`!document.querySelector('.gcsp-presenter-controls').open`, 5000, 'presenter closed');
}
async function states(label, { dashboard = false } = {}) {
  await closePresenter();
  for (const w of ['desktop', 'narrow']) {
    await viewport(w); const n = W[w][0];
    if (dashboard) { await wheelToText('Figures for|Demand and supply', 40); await shot(`${label}-${n}-dashboard`); }
    await wheelTo(60); report.framing = { ...(report.framing || {}), [`${label}-${n}-panel`]: await ordersTop() }; await shot(`${label}-${n}-panel`);
  }
  await viewport('desktop');
}
const snapshot = () => p.read(`(() => {
  const o = document.querySelector('.gcsp-orders'); const txt = document.body.innerText;
  const dStart = txt.indexOf('DEMAND'); const dEnd = txt.indexOf('POLICY', dStart);
  const rows = [...o.querySelectorAll('table tbody tr')].map((r) => [...r.children].map((c) => c.textContent.trim()).join(' | '));
  return { orders: rows, ordersEmpty: o.querySelector('table')?.textContent.includes('No requests yet') ?? null, notice: o.querySelector('.gcsp-orders-status')?.textContent,
    queue: [...o.querySelectorAll('.gcsp-orders-queue p')].map((n) => n.textContent), requestOptions: [...o.querySelectorAll('select')].filter((s) => /-request$/.test(s.id)).flatMap((s) => [...s.options].map((x) => x.textContent)),
    source: o.querySelector('.gcsp-note')?.textContent, dashboard: dStart >= 0 ? txt.slice(dStart, dEnd > 0 ? dEnd : dStart + 1500).replace(/\\s+/g, ' ') : null,
    figuresVersion: (txt.match(/Figures version\\s+(\\S+)/) || [])[1], presenterMsg: document.querySelector('.gcsp-presenter-controls .gcsp-note[role=status]')?.textContent };
})()`);
const apiSince = (t) => report.api.filter((a) => a.t >= t && /greg\/(orders|demand)/.test(a.path)).map((a) => `${a.method} ${a.path} ${a.status ?? '?'}`);
const selectedText = () => p.read(`document.activeElement.selectedOptions?.[0]?.textContent ?? null`);
async function pickOption(labelRe, wanted) {
  await p.tabTo((d) => d.tag === 'select' && labelRe.test(d.name));
  await p.type(wanted); await sleep(200);
  const t = await selectedText(); if (!t || !t.startsWith(wanted)) throw new Error(`could not select ${wanted} by type-ahead; got ${t}`);
  return t;
}
async function setNumber(labelRe, value) {
  await p.tabTo((d) => d.tag === 'input' && d.type === 'number' && labelRe.test(d.name));
  await p.key('End'); for (let i = 0; i < 4; i++) await p.key('Backspace'); await p.type(String(value));
  const v = (await p.active()).value; if (String(v) !== String(value)) throw new Error(`number field shows ${v}, wanted ${value}`);
}
const waitNotice = (re, ms = 12000) => p.waitFor(`/${re}/.test(document.querySelector('.gcsp-orders-status')?.textContent || '')`, ms, `notice ${re}`);
async function activate(matchFn, key = 'Enter') { const d = await p.tabTo(matchFn); await p.key(key); return d; }
async function openPresenter() {
  const open = await p.read(`document.querySelector('.gcsp-presenter-controls').open`);
  const d = await p.tabTo((x) => x.tag === 'summary' && /Presenter controls/.test(x.name), { max: 200 });
  if (!open) { await p.key('Enter'); await p.waitFor(`document.querySelector('.gcsp-presenter-controls').open`, 5000, 'presenter open'); }
  return d;
}
async function openProduction() {
  const open = await p.read(`document.querySelector('.gcsp-orders-production').open`);
  await p.tabTo((x) => x.tag === 'summary' && /Synthetic production controls/.test(x.name), { max: 400 });
  if (!open) { await p.key('Enter'); await p.waitFor(`document.querySelector('.gcsp-orders-production').open`, 5000, 'production open'); }
}
async function tabOrderPass(label) {
  await p.tabTo((d) => d.tag === 'button' && /Refresh orders/.test(d.name), { max: 400 });
  const seq = []; const mouseOnly = [];
  for (let i = 0; i < 40; i++) {
    const a = await p.active(); const inPanel = await p.read(`!!document.activeElement.closest('.gcsp-orders')`);
    if (!inPanel) break;
    seq.push(`${a.tag}${a.type && a.type !== a.tag ? '[' + a.type + ']' : ''}: ${a.name}${a.focusVisible ? '' : ' (NOT focus-visible)'}`);
    await p.key('Tab');
  }
  // Every visible control inside the panel must be reachable by keyboard: compare against enabled focusable controls.
  const unreachable = await p.read(`[...document.querySelectorAll('.gcsp-orders button,.gcsp-orders input,.gcsp-orders select,.gcsp-orders summary')]
    .filter((e) => !e.disabled && e.offsetParent !== null && e.tabIndex < 0).map((e) => e.tagName + ':' + e.textContent.trim().slice(0, 30))`);
  report.tabOrder[label] = { sequence: seq, enabledVisibleControlsWithNegativeTabindex: unreachable };
  return { stops: seq.length };
}

try {
  await mkdir(SCRATCH, { recursive: true });
  chrome = await launchChrome(SCRATCH);
  cdp = new Cdp(chrome.wsUrl); await cdp.open(); p = new Page(cdp);
  const reqs = new Map();
  cdp.on((m) => {
    const { method, params } = m;
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(params.type)) report.console.push({ stage, type: params.type, text: params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    if (method === 'Runtime.exceptionThrown') report.pageErrors.push({ stage, text: (params.exceptionDetails.exception?.description || params.exceptionDetails.text || '').slice(0, 300) });
    if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) report.logErrors.push({ stage, level: params.entry.level, text: params.entry.text?.slice(0, 200), url: params.entry.url });
    if (method === 'Network.requestWillBeSent') { const u = new URL(params.request.url); const row = { t: Date.now(), stage, method: params.request.method, path: u.pathname, status: null }; reqs.set(params.requestId, row); report.api.push(row); }
    if (method === 'Network.responseReceived') { const row = reqs.get(params.requestId); if (row) row.status = params.response.status; if (params.response.status >= 400) report.badResponses.push({ stage, url: params.response.url, status: params.response.status }); }
    if (method === 'Network.loadingFailed') report.failedRequests.push({ stage, url: reqs.get(params.requestId)?.path, error: params.errorText, canceled: params.canceled });
  });
  for (const d of ['Page', 'Runtime', 'Network', 'Log']) await cdp.send(`${d}.enable`);
  await p.setViewport(...W.desktop);

  await step('open-workspace', async () => {
    await cdp.send('Page.navigate', { url: `${BASE}/gcsp-presenter.html` });
    await p.waitFor(`document.body.innerText.includes('Presenter controls') && !document.querySelector('.gcsp-presenter-controls').hidden`, 20000, 'presenter bar');
  });

  await step('switch-to-greg', async () => {
    await openPresenter();
    await p.tabTo((d) => d.legend === 'Acting principal' && d.role === 'radio');
    for (let i = 0; i < 5 && !/Greg/.test((await p.active()).name); i++) await p.key('ArrowDown');
    const sel = await p.active(); if (!/Greg/.test(sel.name)) throw new Error('Greg radio not selected: ' + sel.name);
    await p.tabTo((d) => /Switch principal/.test(d.name)); await p.key('Enter');
    await p.waitFor(`document.body.innerText.includes('Demand and supply') && !!document.querySelector('.gcsp-orders') && /up to date|unavailable/.test(document.querySelector('.gcsp-orders-status')?.textContent||'')`, 25000, 'greg dashboard + orders');
    return { actingPrincipalConfirmedBy: await p.read(`document.querySelector('.gcsp-presenter-controls').innerText.match(/Acting principal[^\\n]*\\n?[^\\n]*/)?.[0]`) };
  });

  report.snapshots.empty = await snapshot();
  await step('capture-empty', async () => { await states('empty', { dashboard: true }); });

  await step('submit-request-1', async () => {
    await p.tabTo((d) => d.tag === 'button' && /Refresh orders/.test(d.name), { max: 400 });
    await pickOption(/^Model/, '3 Series Touring');
    await pickOption(/^Derivative/, '320i');
    await setNumber(/^Quantity$/, 3);
    await activate((d) => d.tag === 'button' && /Submit request/.test(d.name));
    await waitNotice('Request submitted');
    report.snapshots.requested = await snapshot();
    if (!report.snapshots.requested.orders.length) throw new Error('no order row after submit');
  });
  await step('capture-requested', async () => { await states('requested'); });

  await step('confirm-2', async () => {
    await openProduction();
    await pickOption(/^Request/, '3 Series Touring');
    await pickOption(/^Production response/, 'Confirm now');
    await setNumber(/^Quantity to confirm/, 2);
    await activate((d) => d.tag === 'button' && /Save production response/.test(d.name));
    await waitNotice('Production confirmed|Confirmation saved|unavailable|could not');
    await sleep(800);
    report.snapshots.partlyConfirmed = await snapshot();
    return { queueStepOnScreen: report.snapshots.partlyConfirmed.queue };
  });
  await step('capture-partly-confirmed', async () => { await states('partly-confirmed'); });

  await step('delay-second', async () => {
    await p.tabTo((d) => d.tag === 'button' && /Refresh orders/.test(d.name), { max: 400 });
    await pickOption(/^Model/, 'i5 Touring');
    await p.tabTo((d) => d.tag === 'select' && /^Derivative/.test(d.name));
    const wantedDer = await p.read(`[...document.activeElement.options].map((o) => o.textContent)`);
    note('i5 Touring derivatives offered: ' + wantedDer.join(', '));
    await pickOption(/^Derivative/, wantedDer.find((x) => /eDrive40/.test(x)) || wantedDer[0]);
    await setNumber(/^Quantity$/, 1);
    await activate((d) => d.tag === 'button' && /Submit request/.test(d.name));
    await p.waitFor(`document.querySelectorAll('.gcsp-orders table tbody tr').length >= 2`, 12000, 'second row');
    await openProduction();
    await pickOption(/^Request/, 'i5 Touring');
    await pickOption(/^Production response/, 'Delay outstanding');
    await p.tabTo((d) => d.tag === 'input' && d.type === 'date');
    await p.type('20112026');
    const dv = (await p.active()).value; if (dv !== '2026-11-20') throw new Error('date field shows ' + dv);
    await p.tabTo((d) => d.tag === 'input' && d.type === 'text' && /Delay reason/.test(d.name));
    await p.type('Supplier slot moved');
    await activate((d) => d.tag === 'button' && /Save production response/.test(d.name));
    await waitNotice('Production delay saved|could not|unavailable');
    report.snapshots.delayed = await snapshot();
  });
  await step('capture-delayed', async () => { await states('delayed'); });

  // Release phase: read the expected instant from the presenter bar, then Tick to target.
  let cue;
  await step('read-release-cue', async () => {
    report.snapshots.beforeRelease = await snapshot();
    await openPresenter();
    const cueText = await p.read(`[...document.querySelectorAll('.gcsp-presenter-controls p')].map((n) => n.textContent).find((t) => /Release cue|Next release/.test(t))`);
    cue = (cueText.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/) || [])[0];
    report.cueText = cueText; report.tablePartlyConfirmedTiming = report.snapshots.partlyConfirmed.orders;
    if (!cue) throw new Error('no release instant on screen: ' + cueText);
    return { cueText };
  });
  await step('dashboard-before-release', async () => { await closePresenter(); await wheelToText('Figures for', 30); await shot('dashboard-before-release-1280'); });

  const resultText = `/Action recorded|Action /.test(document.querySelector('.gcsp-presenter-controls .gcsp-note[role=status]')?.textContent||'')`;
  // Types an instant into the presenter target field and presses "Tick to target"; reports what refreshed with no Refresh press.
  async function tickTo(value, before) {
    await openPresenter();
    await p.tabTo((d) => d.tag === 'input' && /Named time or UTC target/.test(d.name));
    await p.key('End'); for (let i = 0; i < 40; i++) await p.key('Backspace');
    await p.type(value);
    const typed = (await p.active()).value; if (typed !== value) throw new Error(`target field shows ${typed}, wanted ${value}`);
    const t0 = Date.now();
    await p.tabTo((d) => d.tag === 'button' && /Tick to target/.test(d.name)); await p.key('Enter');
    await p.waitFor(resultText, 12000, 'presenter action result');
    let after; for (let i = 0; i < 16; i++) { await sleep(500); after = await snapshot(); if (after.orders.join() !== before.orders.join()) break; }
    return { after, target: value, presenterMessage: after.presenterMsg, ordersChangedWithoutRefresh: after.orders.join() !== before.orders.join(),
      dashboardChangedWithoutRefresh: after.dashboard !== before.dashboard, requestsSinceAction: apiSince(t0),
      releasedCountText: await p.read(`[...document.querySelectorAll('.gcsp-presenter-results p')].map((n) => n.textContent).find((t) => /cars released|Release unavailable/.test(t))`),
      lastTickRelease: await p.read(`[...document.querySelectorAll('.gcsp-presenter-handlers li')].map((n) => n.textContent).find((t) => /stock-release/.test(t))?.slice(0, 420)`) };
  }
  await step('tick-to-presenter-release-cue', async () => {
    if (!cue) throw new Error('no cue');
    const r = await tickTo(cue, report.snapshots.beforeRelease); report.snapshots.afterCueTick = r.after; delete r.after; return r;
  });
  await step('dashboard-after-cue-tick', async () => { await closePresenter(); await wheelToText('Figures for', 30); await shot('dashboard-after-cue-tick-1280'); });
  let supplyTarget; 
  await step('read-supply-instant', async () => {
    await openPresenter();
    const cueText2 = await p.read(`[...document.querySelectorAll('.gcsp-presenter-controls p')].map((n) => n.textContent).find((t) => /Release cue|Next release/.test(t))`);
    const row = report.snapshots.afterCueTick.orders.find((r) => /3 Series Touring/.test(r)) || '';
    const due = row.match(/due (\d{1,2}) (\w{3}) (\d{4})/);
    const cue2 = (cueText2.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/) || [])[0];
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const endOfDue = due ? `${due[3]}-${months[due[2]]}-${String(due[1]).padStart(2, '0')}T23:59:59.000Z` : null;
    supplyTarget = cue2 && cue2 !== cue ? cue2 : endOfDue;
    return { cueTextAfterFirstTick: cueText2, tableRow: row, dueDateShown: due?.[0], endOfDueDateUtc: endOfDue, chosenTarget: supplyTarget, chosenFrom: cue2 && cue2 !== cue ? 'presenter release cue' : 'end of the due date shown in the table (instant itself is not shown)' };
  });
  await step('tick-to-supply-date', async () => {
    if (!supplyTarget) throw new Error('no supply target');
    report.snapshots.beforeSupplyRelease = await snapshot();
    const r = await tickTo(supplyTarget, report.snapshots.beforeSupplyRelease); report.snapshots.afterSupplyTick = r.after; delete r.after; return r;
  });
  await step('settle-release', async () => {
    const releasedNow = async () => (await snapshot()).orders.find((r) => /3 Series Touring/.test(r))?.split(' | ')[4];
    let released = await releasedNow(); const extra = [];
    for (const label of ['Next release', 'Tick (']) {
      for (let i = 0; i < 2 && released !== '2'; i++) {
        await openPresenter(); await p.tabTo((d) => d.tag === 'button' && d.name.startsWith(label) && !d.disabled); await p.key('Enter');
        await p.waitFor(resultText, 12000, 'extra action'); await sleep(1500); released = await releasedNow(); extra.push(`${label} -> released ${released}`);
      }
    }
    report.snapshots.released = await snapshot();
    return { extraActions: extra, releasedForRow: released };
  });
  await step('capture-released', async () => { await states('released'); await viewport('desktop'); await wheelToText('Figures for', 30); await shot('dashboard-after-release-1280'); });

  // Keyboard evidence at both widths.
  await step('tab-order-1280', () => tabOrderPass('desktop-1280'));
  await step('tab-order-and-focus-375', async () => {
    await viewport('narrow'); const r = await tabOrderPass('narrow-375');
    await p.tabTo((d) => d.tag === 'button' && /Submit request/.test(d.name), { max: 400 });
    // Scroll so the focused control and its neighbours are in the viewport using keyboard-driven focus then frame it.
    const rect = (await p.active()).rect; if (rect[1] < 0 || rect[1] > 700) { await scrollBy(rect[1] - 400); await sleep(350); }
    const a = await p.active(); report.focusAt375 = { name: a.name, focusVisible: a.focusVisible, outline: a.outline, rect: a.rect };
    await shot('focus-visible-375'); await viewport('desktop'); return r;
  });

  report.snapshots.final = await snapshot();
  await step('em-dash-check', async () => {
    const r = await p.read(`(() => { const o = document.querySelector('.gcsp-orders'); const t = o.innerText + ' ' + [...o.querySelectorAll('[aria-label],[placeholder],[title],option')].map((e) => (e.getAttribute('aria-label')||'') + (e.placeholder||'') + (e.title||'') + (e.tagName==='OPTION'?e.textContent:'')).join(' ');
      const page = document.body.innerText; return { panelHasEmDash: t.includes('\\u2014'), pageHasEmDash: page.includes('\\u2014'), panelChars: t.length }; })()`);
    return r;
  });
  // Last, because keyboard scrolling of the table region leaves later framing gestures unreliable in headless Chrome.
  await step('table-scrolled-375', async () => {
    await viewport('narrow'); await closePresenter(); await wheelTo(60);
    await p.tabTo((d) => d.tag === 'button' && /Refresh orders/.test(d.name)); await p.key('Tab');
    const region = await p.active(); for (let i = 0; i < 15; i++) await p.key('ArrowRight');
    const sl = await p.read(`document.activeElement.scrollLeft`);
    await shot('released-375-table-scrolled');
    return { focusedRegion: region.tag + ':' + region.role, scrollLeft: sl, scrollWidth: await p.read(`document.activeElement.scrollWidth`), clientWidth: await p.read(`document.activeElement.clientWidth`), ordersTop: await ordersTop() };
  });
} catch (e) { report.fatal = e.message; console.log('FATAL', e.message); }
finally {
  try { report.finishedAt = new Date().toISOString(); report.chromeProfileDeleted = false; cdp?.close(); await stopChrome(chrome); report.chromeProfileDeleted = true; } catch (e) { report.cleanupError = e.message; }
  report.api = report.api.filter((a) => /^\/api\//.test(a.path)).map(({ t, ...r }) => r);
  await writeFile(join(OUT, 'capture-report.json'), JSON.stringify(report, null, 2));
  console.log('report written', Object.entries(report.steps).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'FAIL'}`).join(' '));
}
