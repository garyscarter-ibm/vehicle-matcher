// FUCQ-265 walk section: run-sheet 10:00 beat. Reset Decline then change, Greg, Next order: Min 2, Preview, Request, Replanned.
// Helpers follow docs/gcsp/evidence/fucq-248 sections.mjs and sections-run2.mjs.
const until = async (H, fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await H.wait(300); } throw new Error(`timed out: ${what}`); };
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1500); };
const closeStrip = (p) => p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
const region = (p, name) => p.getByRole('region', { name }).first();
const regionText = async (loc, n = 1500) => (await loc.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, n);
async function view(H, J, state, loc) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await H.wait(400); await H.page().evaluate(() => window.scrollBy(0, -80)); await H.shot(J, state, { full: false }); }
const idle = (H) => until(H, async () => !/Action in progress/.test(await H.page().locator('.gcsp-presenter-controls').innerText()), 'presenter action', 60000);

async function resetTo(H, scenario) {
  const p = H.page();
  await H.openStrip();
  await p.locator('.gcsp-presenter-controls button', { hasText: scenario }).first().click();
  await btn(p, 'Reset scenario').click(); await H.wait(600);
  await btn(p, 'Confirm reset').click(); await idle(H); await H.wait(1500);
  const cont = btn(p, 'Continue to workspace');
  if (await cont.isVisible().catch(() => false)) { await cont.click(); await H.wait(1500); }
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { await p.reload(); await H.wait(2000); }
  await H.openStrip();
  await p.locator('.gcsp-presenter-controls button', { hasText: 'Greg (fictional)' }).first().click();
  await btn(p, 'Switch principal').click(); await idle(H); await H.wait(2500);
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { await p.reload(); await H.wait(2500); }
}

export async function greg(H) {
  const p = H.page(); const J = 'greg';
  const api = [];
  p.on('response', (r) => { if (r.url().includes('/api/gcsp/greg/order-plan')) api.push(`${r.request().method()} ${r.url().replace(H.origin, '')} ${r.status()}`); });
  await H.signIn();
  await resetTo(H, process.env.WALK_RESET || 'Decline then change');
  await closeStrip(p); await H.wait(2000);
  const plan = region(p, 'Next order plan');
  await until(H, async () => /Min/.test(await regionText(plan, 4000)) || /unavailable/i.test(await regionText(plan, 4000)), 'plan loaded', 30000).catch(() => {});
  H.note({ step: 'plan', text: await regionText(plan, 800) });
  await view(H, J, 'next-order', plan);
  const min = plan.getByRole('spinbutton', { name: /Min/ }).first();
  if (!(await min.count())) throw new Error('No Min field: plan did not load');
  await min.focus(); await min.fill('2');
  await kb(H, plan.getByRole('button', { name: 'Preview with these limits' })); await H.wait(3000);
  H.note({ step: 'plan-preview', text: await regionText(plan, 2500) });
  await view(H, J, 'next-order-preview', plan);
  const req = plan.getByRole('button', { name: /from Production/ }).first();
  H.note({ submit: await req.innerText().catch(() => 'none'), enabled: await req.isEnabled().catch(() => null) });
  if (!(await req.isEnabled().catch(() => false))) throw new Error('Request from Production not enabled');
  await kb(H, req); await H.wait(3000);
  H.note({ step: 'plan-submitted', text: await regionText(plan, 1500) });
  await view(H, J, 'next-order-submitted', plan);
  const orders = p.locator('.gcsp-orders-host').first();
  const sum = p.locator('summary', { hasText: 'Synthetic production controls' }).first();
  await kb(H, sum); await H.wait(800);
  const reqSel = p.getByRole('combobox', { name: 'Request' });
  const opts = await reqSel.locator('option').allInnerTexts().catch(() => []);
  H.note({ productionRequestOptions: opts });
  if (!opts.length) throw new Error('No production request to confirm');
  await reqSel.selectOption({ index: opts.length > 1 ? 1 : 0 }).catch(() => {});
  H.note({ responseOptions: await p.getByRole('combobox', { name: 'Production response' }).locator('option').allInnerTexts().catch(() => []) });
  await kb(H, btn(p, 'Save production response')); await H.wait(3500);
  H.note({ step: 'production-saved', orders: await regionText(orders, 1500), plan: await regionText(plan, 1200) });
  await view(H, J, 'production-saved', orders);
  await view(H, J, 'next-order-replanned', plan);
  H.note({ replanned: /Replanned/.test(await regionText(plan, 6000)), api });
  await H.shot(J, 'dashboard-end');
}
