#!/usr/bin/env node
// FUCQ-235 browser capture of the stacked Plan comparison at 1280, 375 and 320 px (CDP). Keys are Input.* events; Runtime.evaluate only reads.
// Usage: SCRATCH=<absolute scratch dir> BASE=http://127.0.0.1:8930 node docs/gcsp/evidence/fucq235/capture.mjs (the static server is started by the caller).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, stopChrome, Cdp, Page, sleep } from '../fucq104/integrated/lib.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
const SCRATCH = process.env.SCRATCH; const BASE = process.env.BASE || 'http://127.0.0.1:8930';
if (!SCRATCH || !SCRATCH.startsWith('/')) throw new Error('SCRATCH must be an absolute path');
const W = { 1280: [1280, 900], 375: [375, 812], 320: [320, 700] };
const report = { story: 'FUCQ-235', startedAt: new Date().toISOString(), widths: [1280, 375, 320], captures: [], keyboard: {}, console: [], pageErrors: [], badResponses: [], cleanup: {} };
let stage = 'start'; let chrome; let p; let cdp;

const sectionSel = 'section[aria-labelledby$="-learned"]';
const metrics = (rootSel, wrapSel) => p.read(`(() => {
  const vw = document.documentElement.clientWidth; const root = document.querySelector('${rootSel}'); const wrap = document.querySelector('${wrapSel}');
  const inHead = (e) => !!e.closest('.is-stack thead');
  const off = [...root.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !inHead(e); })
    .slice(0, 6).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40));
  const clipped = [...root.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return /hidden|clip/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && !inHead(e); })
    .slice(0, 6).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40));
  const plan = document.querySelector('.gcsp-plan') || root;
  const thead = wrap.querySelector('thead'); const tr = wrap.querySelector('tbody tr'); const td = tr.querySelector('td'); const hr = thead.getBoundingClientRect();
  const lastTd = tr.querySelector('td:last-child');
  return { pageOverflowPx: document.documentElement.scrollWidth - vw, panelOverflowPx: plan.scrollWidth - plan.clientWidth, offscreen: off, clipped,
    tableScrollWidth: wrap.scrollWidth, tableClientWidth: wrap.clientWidth, tableScrolls: wrap.scrollWidth > wrap.clientWidth + 1,
    isStack: wrap.classList.contains('is-stack'), theadVisible: hr.width > 2 && hr.height > 2, theadDisplay: getComputedStyle(thead).display, trDisplay: getComputedStyle(tr).display,
    tdBefore: getComputedStyle(td, '::before').content, lastTdBefore: getComputedStyle(lastTd, '::before').content, lastTdLabel: lastTd.dataset.label,
    rowCount: wrap.querySelectorAll('tbody tr').length, captionText: wrap.querySelector('caption').textContent };
})()`);

async function frame(sel, top = 12) {
  await p.read(`(() => { const s = document.querySelector('${sel}'); scrollTo(0, s.getBoundingClientRect().top + scrollY - ${top}); return 1; })()`);
  await sleep(300);
}
async function openPlan(width) {
  stage = `plan-${width}`; await p.setViewport(...W[width]);
  await cdp.send('Page.navigate', { url: `${BASE}/gcsp-greg.html?fixture=populated&plan=learned` });
  await p.waitFor(`document.querySelector('.gcsp-plan')?.dataset.state === 'ready'`, 20000, 'plan ready'); await sleep(400);
}
async function openGallery(width) {
  stage = `gallery-${width}`; await p.setViewport(...W[width]);
  await cdp.send('Page.navigate', { url: `${BASE}/components.html` });
  await p.waitFor(`!!document.getElementById('gallery-greg-stack')`, 20000, 'gallery stack table'); await sleep(500);
}

async function capture(kind, width) {
  const gallery = kind === 'gallery';
  const wrapSel = gallery ? '#gallery-greg-stack' : `${sectionSel} .gcsp-table-wrap`;
  if (gallery) { await openGallery(width); await p.read(`(() => { const t = document.getElementById('gallery-greg-stack'); t.closest('.gcsp-table-wrap').setAttribute('data-evidence', 'stack'); return 1; })()`); }
  else await openPlan(width);
  const wrap = gallery ? '[data-evidence="stack"]' : wrapSel;
  const rootSel = gallery ? '[data-evidence="stack"]' : sectionSel;
  await frame(gallery ? '[data-evidence="stack"]' : sectionSel, gallery ? 60 : 12);
  const name = `${gallery ? 'gallery-stack' : 'learned'}-${width}`; const path = join(OUT, `${name}.png`); await p.shot(path);
  const m = await metrics(rootSel, wrap); const text = await p.read(`document.querySelector('${rootSel}').innerText`);
  const errs = report.console.filter((c) => c.stage === stage).length + report.pageErrors.filter((c) => c.stage === stage).length;
  const checks = []; const check = (n, ok, d = '') => checks.push({ check: n, ok: Boolean(ok), detail: String(d) });
  const narrow = width <= 375;
  check('wrapper has is-stack', m.isStack);
  check('no horizontal page overflow', m.pageOverflowPx <= 0, `${m.pageOverflowPx}px`);
  check('no overflow inside the panel', m.panelOverflowPx <= 0 && m.offscreen.length === 0, `${m.panelOverflowPx}px ${m.offscreen.join('; ')}`);
  check('no clipped text (visually hidden thead excluded)', m.clipped.length === 0, m.clipped.join('; '));
  check(narrow ? 'comparison region does not scroll sideways' : 'comparison region fits', !m.tableScrolls, `${m.tableScrollWidth} vs ${m.tableClientWidth}`);
  if (narrow) {
    check('thead visually hidden', !m.theadVisible, m.theadDisplay);
    check('tbody tr is display:block', m.trDisplay === 'block', m.trDisplay);
    check('each td shows its data-label via ::before', m.tdBefore.includes('Recommended plan') || m.tdBefore.includes('Other plan') || m.tdBefore.includes('Synthetic'), `${m.tdBefore} / ${m.lastTdBefore}`);
    check('last cell labelled Difference', m.lastTdLabel === 'Difference' && m.lastTdBefore.includes('Difference'), `${m.lastTdLabel} / ${m.lastTdBefore}`);
  } else {
    check('table layout: thead visible', m.theadVisible && m.theadDisplay === 'table-header-group', m.theadDisplay);
    check('table layout: tbody tr is table-row', m.trDisplay === 'table-row', m.trDisplay);
    check('no ::before label in table layout', m.tdBefore === 'none' || m.tdBefore === 'normal', m.tdBefore);
  }
  check('caption present', /Plan comparison/.test(m.captionText), m.captionText);
  check('no em dash in section text', !text.includes('—'));
  check('no em dash on screen', !(await p.read('document.body.innerText')).includes('—'));
  if (!gallery) check('heading is "Synthetic-trained model"', await p.read(`document.querySelector('${sectionSel} h3').textContent === 'Synthetic-trained model'`));
  check('no console or page errors', errs === 0, errs);
  const row = { kind, width, png: path.replace(`${ROOT}/`, ''), pass: checks.every((c) => c.ok), tableScrollWidth: m.tableScrollWidth, tableClientWidth: m.tableClientWidth, rows: m.rowCount, trDisplay: m.trDisplay, theadVisible: m.theadVisible, tdBefore: m.tdBefore, checks };
  report.captures.push(row); console.log(row.pass ? 'PASS' : 'FAIL', name, `scroll ${m.tableScrollWidth}/${m.tableClientWidth}`, checks.filter((c) => !c.ok).map((c) => `${c.check} (${c.detail})`).join(' | '));
}

const labelled = () => p.read(`(() => { const a = document.activeElement; const id = a?.getAttribute?.('aria-labelledby'); return id ? (document.getElementById(id)?.textContent ?? '') : null; })()`);
const focusNow = async () => { const a = await p.active(); const by = await labelled(); return { tag: a.tag, role: a.role, name: by ?? a.name, focusVisible: a.focusVisible, outline: a.outline, inPlan: await p.read(`!!document.activeElement?.closest?.('.gcsp-plan')`) }; };

// Tab from the top of the page; records the stops inside the panel, in order, until the limits editor ends.
async function keyboard(width) {
  await openPlan(width); stage = `keyboard-${width}`;
  const order = []; let shot = false;
  for (let i = 0; i < 120; i++) {
    await p.key('Tab'); const f = await focusNow(); if (!f.inPlan) continue;
    const entry = `${f.tag}${f.role ? `[${f.role}]` : ''}: ${f.name}`; order.push({ n: order.length + 1, focus: entry, focusVisible: f.focusVisible, outline: f.outline });
    if (f.role === 'region' && /Plan comparison/.test(f.name) && !shot) {
      shot = true; await p.read(`document.activeElement.scrollIntoView({ block: 'center' })`); await sleep(250); await p.shot(join(OUT, `keyboard-table-focus-${width}.png`));
    }
    if (/^button: Preview with these limits/.test(entry)) break;
  }
  const old = JSON.parse(await readFile(join(ROOT, 'docs/gcsp/evidence/fucq123/capture-report.json'), 'utf8')).keyboard['1280'].order.map((o) => o.focus);
  const now = order.map((o) => o.focus); const idx = now.findIndex((f) => /Plan comparison/.test(f));
  report.keyboard[width] = { stops: order.length, planComparisonStop: idx + 1, afterAlternativePlans: /Alternative plans/.test(now[idx - 1] || ''), beforeLimitsEditor: !/Plan comparison|Alternative/.test(now[idx + 1] || ''),
    matchesFucq123: JSON.stringify(old) === JSON.stringify(now), fucq123Stops: old.length, everyStopVisible: order.every((o) => o.focusVisible), order };
  console.log('keyboard', width, `${order.length} stops; matches fucq123 = ${report.keyboard[width].matchesFucq123}`, now.join(' > '));
}

try {
  chrome = await launchChrome(SCRATCH);
  report.chromeDebugPort = chrome.port;
  cdp = new Cdp(chrome.wsUrl); await cdp.open(); p = new Page(cdp);
  cdp.on((m) => {
    const { method, params } = m;
    if (method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(params.type)) report.console.push({ stage, text: params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    if (method === 'Runtime.exceptionThrown') report.pageErrors.push({ stage, text: (params.exceptionDetails.exception?.description || params.exceptionDetails.text || '').slice(0, 300) });
    if (method === 'Network.responseReceived' && params.response.status >= 400) report.badResponses.push({ stage, url: new URL(params.response.url).pathname, status: params.response.status });
  });
  await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Page.enable'); await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const w of [1280, 375, 320]) await capture('plan', w);
  for (const w of [1280, 320]) await capture('gallery', w);
  for (const w of [1280, 375, 320]) await keyboard(w);
  await p.setViewport(1280, 900);
} catch (e) { report.fatal = e.message; console.log('FATAL', e.message); }
finally {
  report.finishedAt = new Date().toISOString();
  try { cdp?.close(); await stopChrome(chrome); report.cleanup.chrome = 'stopped (process group), profile removed'; } catch (e) { report.cleanup.chromeError = e.message; }
  report.pass = !report.fatal && report.captures.length === 5 && report.captures.every((c) => c.pass) && Object.keys(report.keyboard).length === 3;
  await writeFile(join(OUT, 'capture-report.json'), JSON.stringify(report, null, 2));
  console.log('report written; pass =', report.pass);
  process.exit(0);
}
