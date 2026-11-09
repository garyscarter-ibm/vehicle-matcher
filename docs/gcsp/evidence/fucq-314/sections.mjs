// FUCQ-314 walk section: Greg's Next order (Min 2, Preview, Request), then Change limits, then Production confirms and the plan replans.
// Helpers follow docs/gcsp/evidence/fucq-310.
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BANNED = /demo|demonstration|synthetic|fictional|example/i;
const until = async (H, fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await H.wait(300); } throw new Error(`timed out: ${what}`); };
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1500); };
const closeStrip = (p) => p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
const region = (p, name) => p.getByRole('region', { name }).first();
const regionText = async (loc, n = 1500) => (await loc.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, n);
async function view(H, state, loc) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await H.wait(400); await H.page().evaluate(() => window.scrollBy(0, -80)); await H.shot('greg', state, { full: false }); }
const idle = (H) => until(H, async () => !/Action in progress/.test(await H.page().locator('.gcsp-presenter-controls').innerText()), 'presenter action', 60000);

async function switchTo(H, who) {
  const p = H.page();
  await H.openStrip();
  await p.locator('.gcsp-presenter-controls button', { hasText: `${who} (fictional)` }).first().click();
  await btn(p, 'Switch principal').click(); await idle(H); await H.wait(2500);
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { await p.reload(); await H.wait(2500); }
}
async function resetTo(H, scenario, who) {
  const p = H.page();
  await H.openStrip();
  await p.locator('.gcsp-presenter-controls button', { hasText: scenario }).first().click();
  await btn(p, 'Reset scenario').click(); await H.wait(600);
  await btn(p, 'Confirm reset').click(); await idle(H); await H.wait(1500);
  const cont = btn(p, 'Continue to workspace');
  if (await cont.isVisible().catch(() => false)) { await cont.click(); await H.wait(1500); }
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { await p.reload(); await H.wait(2000); }
  await switchTo(H, who);
}

export async function greg(H) {
  const p = H.page();
  await H.signIn();
  await resetTo(H, process.env.WALK_RESET || 'Decline then change', 'Greg');
  await closeStrip(p); await H.wait(2000);
  const plan = region(p, 'Next order plan');
  const limits = plan.locator('details.gcsp-plan-limits').first();
  await until(H, async () => (await limits.count()) > 0, 'plan loaded', 30000);
  const group = plan.getByRole('group', { name: 'Derivative limits' });
  const min = group.getByRole('spinbutton', { name: /Min/ }).nth(Number(process.env.WALK_ROW || 1));
  await kb(H, limits.locator('summary'));
  await until(H, async () => (await min.count()) > 0, 'limits editor', 10000);
  const before = await min.inputValue();
  await min.focus(); await min.fill('2');
  await kb(H, plan.getByRole('button', { name: 'Preview with these limits' })); await H.wait(3000);
  const req = plan.getByRole('button', { name: /from Production/ }).first();
  if (!(await req.isEnabled().catch(() => false))) throw new Error(`Request from Production not enabled: ${await regionText(plan, 800)}`);
  await kb(H, req); await H.wait(3500);
  await until(H, async () => /Requested at/.test(await regionText(plan, 3000)), 'request recorded', 20000);
  if (!(await limits.evaluate((d) => d.open))) await kb(H, limits.locator('summary'));
  await H.wait(500);
  const body = limits.locator('.gcsp-plan-editor-body').first();
  const noteText = await regionText(body.locator('.gcsp-note').first(), 400);
  const minAfter = await min.inputValue();
  const visible = await regionText(limits, 4000); const planText = await regionText(plan, 8000);
  await limits.scrollIntoViewIfNeeded(); await H.wait(400); await p.evaluate(() => window.scrollBy(0, -80));
  await H.shot('greg', 'change-limits-note', { full: false });
  const result = { shot: `greg-${H.W}-change-limits-note.png`, url: p.url().replace(H.origin, ''), width: H.W, minBefore: before, minAfterRequest: minAfter, note: noteText,
    noteNamesRequest: /minimum 2 is with Production/.test(noteText), bannedInDisclosure: visible.match(BANNED)?.[0] ?? null,
    bannedInNote: noteText.match(BANNED)?.[0] ?? null, bannedInPlanExceptLearnedLabel: planText.replace(/Synthetic-trained model/g, '').match(BANNED)?.[0] ?? null, emDash: planText.includes('—') || visible.includes('—') };
  // Beat 10:00: confirm the request under the production controls and see the plan replan.
  const sum = p.locator('summary', { hasText: 'Production controls' }).first();
  await kb(H, sum); await H.wait(800);
  const reqSel = p.getByRole('combobox', { name: 'Request' });
  const opts = await reqSel.locator('option').allInnerTexts().catch(() => []);
  if (!opts.length) throw new Error('No production request to confirm');
  await reqSel.selectOption({ index: opts.length > 1 ? 1 : 0 }).catch(() => {});
  await kb(H, btn(p, 'Save production response')); await H.wait(3500);
  result.replanned = /Replanned/.test(await regionText(plan, 6000));
  result.noteAfterReplan = (await limits.locator('.gcsp-plan-editor-body').first().innerText()).includes('is with Production');
  H.note({ result });
  await writeFile(join(HERE, `results-${H.W}.json`), `${JSON.stringify(result, null, 2)}\n`);
}
