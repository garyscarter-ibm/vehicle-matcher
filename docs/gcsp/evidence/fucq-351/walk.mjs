import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { writeFileSync } from 'node:fs';
const B = 'http://localhost:9351'; const OUT = process.argv[2]; const notes = [];
const note = (k, v) => { notes.push({ [k]: v }); console.log(k, JSON.stringify(v)); };
const ctx = await chromium.launchPersistentContext('/tmp/fucq351-walk-profile-' + Date.now(), { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport: { width: 1280, height: 900 } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const focusNow = (p) => p.evaluate(() => { const e = document.activeElement; return `${e?.tagName}:${(e?.getAttribute('aria-label') || e?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)}`; });
const ring = (p) => p.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow.slice(0, 40)}`; });
const portal = ctx.pages()[0] || await ctx.newPage();
portal.on('framenavigated', (f) => { if (f === portal.mainFrame()) note('portalNavigated', f.url().replace(B, '')); });
// Paula signs in first, in the portal tab.
await portal.goto(B + '/gcsp/login'); await wait(1500);
await portal.getByLabel(/email/i).fill('paula.mason@gcsp-demo.com'); await portal.getByLabel(/password/i).fill('fucq');
await portal.keyboard.press('Enter'); await wait(4000);
note('portalStart', { url: portal.url().replace(B, ''), h1: await portal.locator('h1').first().innerText().catch(() => '') });
const p = await ctx.newPage();
const posts = []; p.on('response', async (r) => { if (r.url().includes('/api/gcsp/') && r.request().method() === 'POST') posts.push(`${r.url().replace(B, '')} ${r.status()} ${(await r.text().catch(() => '')).slice(0, 90)}`); });
await p.goto(B + '/gcsp-presenter.html'); await wait(4000);
// Keyboard only from here: Tab to Advanced, Enter.
let found = false;
for (let i = 0; i < 20 && !found; i++) { await p.keyboard.press('Tab'); found = /^BUTTON:Advanced/.test(await focusNow(p)); }
note('advancedReached', found); await p.keyboard.press('Enter'); await wait(2500);
// Tab to the Scenario radiogroup, arrow to Decline then change.
found = false;
for (let i = 0; i < 25 && !found; i++) { await p.keyboard.press('Tab'); found = await p.evaluate(() => !!document.activeElement.closest('[role="radiogroup"][aria-label="Scenario"]')); }
note('scenarioReached', found);
for (let i = 0; i < 12; i++) { if (/Decline then change$/.test(await focusNow(p))) break; await p.keyboard.press('ArrowDown'); await wait(100); }
note('scenarioFocus', await focusNow(p));
await p.screenshot({ path: `${OUT}/presenter-1280-01-scenario-chosen.png` });
// Tab on to the new action, with its ring.
const stops = [];
for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); const f = await focusNow(p); stops.push(f); if (/Reset and switch to Greg/.test(f)) break; }
note('tabStops', stops); note('shortcutRing', await ring(p));
await p.screenshot({ path: `${OUT}/presenter-1280-02-shortcut-focused.png` });
await p.keyboard.press('Enter'); await wait(500);
note('afterOpen', { focus: await focusNow(p), confirm: await p.locator('.gcsp-presenter-confirmation .gcsp-note').innerText() });
await p.keyboard.press('Escape'); await wait(300); note('afterEscape', await focusNow(p));
await p.keyboard.press('Enter'); await wait(500);
await p.screenshot({ path: `${OUT}/presenter-1280-03-confirm.png` });
await p.keyboard.press('Enter'); // Confirm reset
for (let i = 0; i < 40; i++) { await wait(500); if (portal.url().includes('gcsp-greg')) break; }
await wait(4000);
note('posts', posts.slice());
note('consoleAfter', { url: p.url().replace(B, ''), focus: await focusNow(p), status: await p.locator('[role="status"]').allInnerTexts() });
await p.screenshot({ path: `${OUT}/presenter-1280-04-console-after.png` });
const gregH1 = await portal.locator('h1').first().innerText().catch(() => '');
const portalText = await portal.locator('body').innerText();
note('portalAfter', { url: portal.url().replace(B, ''), h1: gregH1, reloadPrompt: /Reload to continue|Restarted/.test(portalText), account: (await portal.locator('.gcsp-account-name, summary').first().innerText().catch(() => '')).slice(0, 40), scenario: /Decline then change/.test(portalText) });
await portal.bringToFront(); await wait(1000);
await portal.screenshot({ path: `${OUT}/greg-1280-05-landed.png` });
// Gotcha check: the console's next presenter command works without a reload.
await p.bringToFront(); posts.length = 0;
const ctl = await p.evaluate(async () => (await (await fetch('/api/gcsp/presenter/controls', { credentials: 'include' })).json()).status);
note('controlsRead', ctl);
const tick = p.getByRole('button', { name: /^Tick \(/ });
await p.getByRole('tab', { name: 'Clock' }).focus(); await p.keyboard.press('Enter'); await wait(300);
await tick.focus(); await p.keyboard.press('Enter'); await wait(3000);
note('tickAfter', { posts: posts.slice(), status: (await p.locator('[role="status"]').allInnerTexts()).filter(Boolean) });
const ctx2 = await p.evaluate(async () => { const j = await (await fetch('/api/gcsp/context', { credentials: 'include' })).json(); return `${j.status} ${j.value?.name} ${j.value?.roles}`; });
note('actingContext', ctx2);
writeFileSync(`${OUT}/walk-notes.json`, JSON.stringify(notes, null, 1));
await ctx.close();
