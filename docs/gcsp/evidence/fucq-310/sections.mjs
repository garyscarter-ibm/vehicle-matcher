// FUCQ-310 walk sections: Greg's Next order (Min 2, Preview, Request, Replanned) after Reset Decline then change (greg)
// and after Paula's manual order in Main successful journey (main), which also checks the left-out cars notice. Helpers follow docs/gcsp/evidence/fucq-248.
const until = async (H, fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await H.wait(300); } throw new Error(`timed out: ${what}`); };
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1500); };
const closeStrip = (p) => p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
const region = (p, name) => p.getByRole('region', { name }).first();
const regionText = async (loc, n = 1500) => (await loc.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, n);
async function view(H, J, state, loc) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await H.wait(400); await H.page().evaluate(() => window.scrollBy(0, -80)); await H.shot(J, state, { full: false }); }
const idle = (H) => until(H, async () => !/Action in progress/.test(await H.page().locator('.gcsp-presenter-controls').innerText()), 'presenter action', 60000);

async function resetTo(H, scenario, who = 'Greg') {
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
async function switchTo(H, who) {
  const p = H.page();
  await H.openStrip();
  await p.locator('.gcsp-presenter-controls button', { hasText: `${who} (fictional)` }).first().click();
  await btn(p, 'Switch principal').click(); await idle(H); await H.wait(2500);
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { await p.reload(); await H.wait(2500); }
}
const watchPlan = (H, api) => H.page().on('response', async (r) => { if (!r.url().includes('/api/gcsp/greg/order-plan')) return;
  const body = await r.json().catch(() => ({})); api.push(`${r.request().method()} ${r.url().replace(H.origin, '')} ${r.status()} ${body.code ?? body.status ?? ''}`); });

export async function greg(H) {
  const api = []; watchPlan(H, api);
  await H.signIn();
  await resetTo(H, process.env.WALK_RESET || 'Decline then change');
  await gregBeat(H, 'greg', api);
}

async function gregBeat(H, J, api, { notice = false } = {}) {
  const p = H.page();
  await closeStrip(p); await H.wait(2000);
  const plan = region(p, 'Next order plan');
  await until(H, async () => /Min/.test(await regionText(plan, 4000)) || /unavailable/i.test(await regionText(plan, 4000)), 'plan loaded', 30000).catch(() => {});
  H.note({ step: 'plan', text: await regionText(plan, 800) });
  await view(H, J, 'next-order', plan);
  if (notice) await leftOutNotice(H, J, plan);
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

// The server-owned notice for released cars that no catalogue entry lists: record its text and capture it in view.
async function leftOutNotice(H, J, plan) {
  const box = plan.locator('.gcsp-plan-banner', { hasText: 'Cars left out of this plan' }).first();
  const found = (await box.count()) > 0;
  H.note({ leftOutNotice: found ? await regionText(box, 600) : null, found });
  if (!found) throw new Error('No left-out cars notice: the plan did not report unbound stock');
  await view(H, J, 'left-out-notice', box);
  H.note({ leftOutNoticeEmDash: (await regionText(box, 600)).includes('\u2014') });
}

const h1 = (p) => p.locator('h1').first().innerText().catch(() => '');
// Main successful journey on a cold host: Paula's manual order (fucq-248 manual, without audits), then Greg's beat.
export async function main(H) {
  const p = H.page(); const api = []; watchPlan(H, api);
  p.on('response', async (r) => { if (r.status() >= 400 && r.url().includes('/api/')) H.note({ failed: `${r.request().method()} ${r.url().replace(H.origin, '')} ${r.status()}`, body: H.clip(await r.text().catch(() => ''), 300) }); });
  await H.signIn();
  // A cold host opens on Main successful journey as Paula, as in the fucq-248 and performance-review runs.
  await closeStrip(p);
  await kb(H, btn(p, 'Choose a replacement'));
  await until(H, async () => (await h1(p)) === 'Your order choices', 'setup'); await H.wait(1500);
  const pick = async (name) => { const s = p.locator(`select[name="${name}"]`); if (!(await s.count())) return null;
    await until(H, async () => (await s.locator('option:not([disabled])').count()) > 1, `${name} options`);
    const v = await s.locator('option:not([disabled])').evaluateAll((o) => o.find((x) => x.value)?.value); await s.selectOption(v); return v; };
  await p.locator('select[name="driverId"]').selectOption({ label: 'You: Paula (fictional)' }).catch(() => pick('driverId'));
  await pick('contractOptionId');
  const date = p.locator('input[name="requestedCollectionDate"]'); await date.fill(await date.getAttribute('min'));
  await pick('collectionLocationId');
  const fill = async (sel, v) => { const c = p.locator(sel); if (await c.count() && await c.isVisible() && !(await c.inputValue())) await c.fill(v); };
  await fill('input[name="phone"]', '07700900123'); await fill('input[name="email"]', 'paula.test@example.test'); await fill('input[name="expectedReturnMileage"]', '24000');
  await kb(H, btn(p, 'Save choices'));
  await until(H, async () => /Your choices are saved/.test(await H.text()), 'saved');
  await until(H, async () => btn(p, 'Continue').isEnabled(), 'continue enabled');
  await kb(H, btn(p, 'Continue'));
  await until(H, async () => /Released cars/.test(await H.text()), 'gallery'); await H.wait(2500);
  await H.press('Next release'); await closeStrip(p);
  const refresh = btn(p, 'Refresh availability'); if (await refresh.count()) await kb(H, refresh);
  await H.wait(2500);
  if (!(await p.getByRole('button', { name: 'Review this car' }).count())) {
    await kb(H, btn(p, 'Back to your choices'));
    await until(H, async () => (await h1(p)) === 'Your order choices', 'setup again');
    await until(H, async () => (await date.getAttribute('min')) && !(await date.isDisabled()), 'window');
    await date.fill(await date.getAttribute('min'));
    await kb(H, btn(p, 'Save choices')); await until(H, async () => btn(p, 'Continue').isEnabled(), 'continue');
    await kb(H, btn(p, 'Continue'));
  }
  await until(H, async () => (await p.getByRole('button', { name: 'Review this car' }).count()) > 0, 'cards', 30000); await H.wait(1500);
  for (let tries = 0; tries < 4 && (await h1(p)) !== 'Review your car'; tries += 1) {
    const enabled = p.locator('button:enabled', { hasText: 'Review this car' });
    await kb(H, enabled.nth(Math.min(tries, (await enabled.count()) - 1)));
    await until(H, async () => (await h1(p)) === 'Review your car' || /no longer available/.test(await H.text()), 'review or conflict');
    if ((await h1(p)) !== 'Review your car') { await kb(H, btn(p, 'Refresh availability').first()); await H.wait(2500); }
  }
  await H.wait(1500);
  await kb(H, btn(p, 'Continue to order review'));
  await until(H, async () => (await h1(p)) === 'Review your order', 'summary'); await H.wait(1500);
  const boxes = p.locator('input[type="checkbox"][data-declaration]');
  for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await p.keyboard.press('Space'); }
  await kb(H, btn(p, 'Submit order'));
  await until(H, async () => /^(Order received|Order saved|Order not sent)$/.test((await h1(p)).trim()), 'outcome', 60000);
  H.note({ step: 'paula-ordered', h1: await h1(p) });
  await H.shot('main', 'paula-order-outcome', { full: false });
  await switchTo(H, 'Greg');
  await gregBeat(H, 'main', api, { notice: true });
}
