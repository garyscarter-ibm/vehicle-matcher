#!/usr/bin/env node
// FUCQ-123 browser capture of the synthetic-trained model section on the Greg dashboard fixture harness (CDP). Keys are Input.* events; Runtime.evaluate only reads.
// Usage: SCRATCH=<absolute scratch dir> BASE=http://127.0.0.1:8951 node docs/gcsp/evidence/fucq123/capture.mjs (the static server is started by the caller).
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, stopChrome, Cdp, Page, sleep } from '../fucq104/integrated/lib.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
const SCRATCH = process.env.SCRATCH; const BASE = process.env.BASE || 'http://127.0.0.1:8951';
if (!SCRATCH || !SCRATCH.startsWith('/')) throw new Error('SCRATCH must be an absolute path');
const W = { 1280: [1280, 900], 375: [375, 812] };
const STATES = [['learned', 'learned plan beside the recommended plan', [/Synthetic-trained model/, /Recommended plan/, /Held-out log loss/, /Synthetic-trained; offline evaluation/]],
  ['ready', 'fallback, no active model', [/No learned model is active, so only the baseline plan from expressed demand is shown\./]],
  ['learned-coverage', 'fallback, outside training coverage', [/Outside training coverage:/, /Employee cohorts: G8-10/, /Vehicle classes: unknown/]]];
const report = { story: 'FUCQ-123', startedAt: new Date().toISOString(), widths: [1280, 375], captures: [], keyboard: {}, console: [], pageErrors: [], badResponses: [], cleanup: {} };
let stage = 'start'; let chrome; let p; let cdp;

const sectionSel = `section[aria-labelledby$="-learned"]`;
const metrics = () => p.read(`(() => {
  const vw = document.documentElement.clientWidth; const plan = document.querySelector('.gcsp-plan');
  const off = [...plan.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !e.parentElement.closest('.gcsp-table-wrap'); })
    .slice(0, 6).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40));
  const clipped = [...plan.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return /hidden|clip/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0; })
    .slice(0, 6).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40));
  const sec = document.querySelector('${sectionSel}');
  const wrap = sec?.querySelector('.gcsp-table-wrap');
  return { pageOverflowPx: document.documentElement.scrollWidth - vw, panelOverflowPx: plan.scrollWidth - plan.clientWidth, offscreen: off, clipped,
    tableScrolls: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : null, tableScrollWidth: wrap?.scrollWidth ?? null, tableClientWidth: wrap?.clientWidth ?? null };
})()`);
const labelled = () => p.read(`(() => { const a = document.activeElement; const id = a?.getAttribute?.('aria-labelledby'); return id ? (document.getElementById(id)?.textContent ?? '') : null; })()`);
const focusNow = async () => { const a = await p.active(); const by = await labelled(); return { tag: a.tag, role: a.role, name: by ?? a.name, focusVisible: a.focusVisible, outline: a.outline, inPlan: await p.read(`!!document.activeElement?.closest?.('.gcsp-plan')`) }; };

async function open(state, width) {
  stage = `${state}-${width}`;
  await p.setViewport(...W[width]);
  await cdp.send('Page.navigate', { url: `${BASE}/gcsp-greg.html?fixture=populated&plan=${state}` });
  await p.waitFor(`document.querySelector('.gcsp-plan')?.dataset.state === 'ready'`, 20000, 'plan ready');
  await sleep(400);
}
async function frameSection(top = 12) {
  await p.read(`(() => { const s = document.querySelector('${sectionSel}'); const y = s.getBoundingClientRect().top + scrollY - ${top}; scrollTo(0, y); return y; })()`);
  await sleep(300);
}

async function capture(state, label, expect, width) {
  await open(state, width); await frameSection();
  const path = join(OUT, `${state}-${width}.png`); await p.shot(path);
  const m = await metrics(); const text = await p.read(`document.querySelector('${sectionSel}').innerText`);
  const errs = report.console.filter((c) => c.stage === stage).length + report.pageErrors.filter((c) => c.stage === stage).length;
  const checks = [];
  const check = (n, ok, d = '') => checks.push({ check: n, ok: Boolean(ok), detail: d });
  for (const re of expect) check(`text ${re}`, re.test(text));
  check('heading is "Synthetic-trained model"', await p.read(`document.querySelector('${sectionSel} h3').textContent === 'Synthetic-trained model'`));
  check('no horizontal page overflow', m.pageOverflowPx <= 0, `${m.pageOverflowPx}px`);
  check('no overflow inside the panel', m.panelOverflowPx <= 0 && m.offscreen.length === 0, `${m.panelOverflowPx}px ${m.offscreen.join('; ')}`);
  check('no clipped text', m.clipped.length === 0, m.clipped.join('; '));
  check('no em dash on screen', !(await p.read(`document.body.innerText`)).includes('—'));
  check('no button in the section', await p.read(`!document.querySelector('${sectionSel}').querySelector('button')`));
  check('no console or page errors', errs === 0, `${errs}`);
  if (state === 'learned') {
    check('comparison table has 4 column headers', await p.read(`document.querySelectorAll('${sectionSel} thead th').length === 4`));
    check('changed rows are bold', await p.read(`document.querySelectorAll('${sectionSel} tbody strong').length >= 6`));
  } else check('no table and no figures', await p.read(`!document.querySelector('${sectionSel} table') && !document.querySelector('${sectionSel} .gcsp-tile')`));
  const row = { state, label, width, png: path.replace(`${ROOT}/`, ''), pass: checks.every((c) => c.ok), tableScrollsSideways: m.tableScrolls, tableScrollWidth: m.tableScrollWidth, tableClientWidth: m.tableClientWidth, checks };
  report.captures.push(row); console.log(row.pass ? 'PASS' : 'FAIL', `${state}-${width}`, checks.filter((c) => !c.ok).map((c) => `${c.check} (${c.detail})`).join(' | '));
}

// Tab from the top of the page through the panel; records only elements inside the panel, in order, until the limits editor starts.
async function keyboard(width) {
  await open('learned', width); stage = `keyboard-${width}`;
  const order = []; let tableShot = false; let scrolled = null; let requestAt = null;
  for (let i = 0; i < 120; i++) {
    await p.key('Tab'); const f = await focusNow(); if (!f.inPlan) continue;
    const entry = `${f.tag}${f.role ? `[${f.role}]` : ''}: ${f.name}`; order.push({ n: order.length + 1, focus: entry, focusVisible: f.focusVisible, outline: f.outline });
    if (f.role === 'region' && /Plan comparison/.test(f.name) && !tableShot) {
      tableShot = true; await p.read(`document.activeElement.scrollIntoView({ block: 'center' })`); await sleep(250);
      await p.shot(join(OUT, `keyboard-table-focus-${width}.png`));
    }
    if (/^button: Request /.test(entry)) requestAt = order.length;
    if (/^button: Preview with these limits/.test(entry)) break;
  }
  // The region was reached by Tab above (focus ring in keyboard-table-focus-*.png). Arrow keys scroll it once focused; headless Chrome needs the page's own focus call first.
  const region = `document.querySelector('${sectionSel} .gcsp-table-wrap')`;
  await open('learned', width); stage = `keyboard-${width}`;
  await p.read(`(() => { const w = ${region}; w.focus(); w.scrollIntoView(); return document.activeElement === w; })()`);
  const key = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 };
  for (let k = 0; k < 4; k++) { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key }); await sleep(250); }
  await sleep(500);
  scrolled = { scrollable: await p.read(`${region}.scrollWidth > ${region}.clientWidth + 1`), scrollLeftAfterFourArrowRight: await p.read(`${region}.scrollLeft`) };
  if (width === 375) { await p.read(`${region}.scrollIntoView({ block: 'center' })`); await sleep(300); await p.shot(join(OUT, 'keyboard-table-scrolled-375.png')); }
  const request = order.find((o) => /^button: Request /.test(o.focus));
  const requestInfo = await p.read(`(() => { const b = [...document.querySelectorAll('.gcsp-plan button')].find((x) => x.textContent.startsWith('Request ')); return { text: b?.textContent, described: document.getElementById(b?.getAttribute('aria-describedby') ?? '')?.textContent ?? null }; })()`);
  report.keyboard[width] = { order, requestPosition: requestAt, requestFocusVisible: request?.focusVisible ?? null, requestButton: requestInfo, tableKeyboardScroll: scrolled,
    everyStopVisible: order.every((o) => o.focusVisible) };
  console.log('keyboard', width, `${order.length} stops`, order.map((o) => o.focus).join(' > '));
}

try {
  chrome = await launchChrome(SCRATCH);
  cdp = new Cdp(chrome.wsUrl); await cdp.open(); p = new Page(cdp);
  cdp.on((m) => {
    const { method, params } = m;
    if (method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(params.type)) report.console.push({ stage, text: params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    if (method === 'Runtime.exceptionThrown') report.pageErrors.push({ stage, text: (params.exceptionDetails.exception?.description || params.exceptionDetails.text || '').slice(0, 300) });
    if (method === 'Network.responseReceived' && params.response.status >= 400) report.badResponses.push({ stage, url: new URL(params.response.url).pathname, status: params.response.status });
  });
  await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Page.enable'); await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const [state, label, expect] of STATES) for (const w of [1280, 375]) await capture(state, label, expect, w);
  for (const w of [1280, 375]) await keyboard(w);
  await p.setViewport(1280, 900);
} catch (e) { report.fatal = e.message; console.log('FATAL', e.message); }
finally {
  report.finishedAt = new Date().toISOString();
  try { cdp?.close(); await stopChrome(chrome); report.cleanup.chrome = 'stopped (process group), profile removed'; } catch (e) { report.cleanup.chromeError = e.message; }
  report.pass = !report.fatal && report.captures.length === 6 && report.captures.every((c) => c.pass);
  await writeFile(join(OUT, 'capture-report.json'), JSON.stringify(report, null, 2));
  console.log('report written; pass =', report.pass);
  process.exit(0);
}
