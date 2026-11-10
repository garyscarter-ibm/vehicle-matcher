// GCSP UX revamp walk sections (Paula, 10 Nov). Run with walk-revamp.mjs and WALK_SECTIONS=sections-revamp.mjs.

const until = async (H, fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await H.wait(300); } throw new Error(`timed out: ${what}`); };
const h1 = (p) => p.locator('h1').first().textContent().then((s) => (s || '').trim()).catch(() => '');
const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1500); };
const focusNow = (p) => p.evaluate(() => { const e = document.activeElement; return `${e?.tagName}:${(e?.getAttribute('aria-label') || e?.textContent || '').trim().slice(0, 50)}`; });
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
let HH; const closeStrip = () => HH.closeStrip();
const busyWait = async (H) => { await until(H, async () => !/Action in progress/.test(await H.page().locator('.gcsp-presenter-controls').innerText()), 'presenter action', 60000); };
// Flyout-era copies of the run 1 resetTo/switchTo: principals are labelled by name and role.
export async function resetTo(H, scenario, journey, capture = false, principal = 'Paula') {
  const p = H.page(); HH = H;
  await H.openStrip();
  await p.locator('.gcsp-presenter-controls button[role=radio]', { hasText: scenario }).first().click();
  await btn(p, 'Reset scenario').click(); await H.wait(600);
  await btn(p, 'Confirm reset').click(); await busyWait(H); await H.wait(1500);
  const cont = btn(p, 'Continue to workspace');
  if (await cont.isVisible().catch(() => false)) { await cont.click(); await H.wait(1500); }
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { await p.reload(); await H.wait(2000); }
  if (principal) await switchTo(H, principal);
}
export async function switchTo(H, who) {
  const p = H.page(); HH = H;
  await H.openStrip();
  const opt = p.locator('.gcsp-presenter-controls button[role=radio]', { hasText: who }).filter({ hasNotText: 'presenter' }).first();
  H.note({ switchOption: await opt.innerText().catch(() => 'none') });
  await opt.click();
  const sw = btn(p, 'Switch principal');
  if (await sw.isEnabled().catch(() => false)) { await sw.click(); await busyWait(H); await H.wait(2500); }
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { await p.reload(); await H.wait(2500); }
}
let seq = 0;
// One state: screenshot (named paula-<screen>-<width>-<nn>-<state>), text dump, focus after arrival.
const cap = async (H, screen, state, { full = true } = {}) => {
  const p = H.page(); seq += 1;
  H.note({ at: `${screen}/${state}`, focus: await focusNow(p), h1: await h1(p), url: p.url().replace(H.origin, '') });
  await H.dump(`${screen}-${state}`);
  await H.shot(`paula-${screen}`, state, { full });
};
const go = async (H, path) => { await H.go(path); await H.wait(1200); };

export async function probe(H) {
  const p = H.page();
  await go(H, '/gcsp-login.html');
  await cap(H, 'signin', 'empty');
  await H.tabWalk('signin', 12);
  await p.locator('input[type=email], input[name=email]').first().fill('paula.mason@gcsp-demo.com');
  await p.locator('input[type=password]').first().fill('wrong');
  await kb(H, btn(p, 'Sign in'));
  await H.wait(1200);
  await cap(H, 'signin', 'error', { full: false });
  await p.locator('input[type=password]').first().fill('fucq');
  await kb(H, btn(p, 'Sign in'));
  await H.wait(3000);
  await cap(H, 'home', 'after-signin');
}

const menu = async (H, screen) => {
  const p = H.page(); const s = p.locator('.gcsp-account-summary').first();
  if (!(await s.count())) return H.note({ menu: 'none' });
  await s.focus(); await p.keyboard.press('Enter'); await H.wait(600);
  H.note({ menu: H.clip(await p.locator('.gcsp-account-panel').first().innerText().catch(() => ''), 300) });
  await cap(H, screen, 'account-menu', { full: false });
  await p.keyboard.press('Escape'); await s.evaluate((x) => { x.parentElement.open = false; }); await H.wait(300);
};
const offerLink = (p) => p.getByRole('link', { name: /View offer|Open the offer/i }).or(p.getByRole('button', { name: /View offer|Open the offer/i })).first();
const tick = async (H, n = 1) => { for (let i = 0; i < n; i += 1) await H.press(/^Tick \(/, { settle: 900 }); await closeStrip(H.page()); };
async function declareAndAccept(H, screen, label) {
  const p = H.page(); const boxes = p.locator('main input[type="checkbox"]');
  for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await p.keyboard.press('Space'); }
  await cap(H, screen, `${label}-declared`, { full: false });
  await kb(H, btn(p, /^Accept/, false).first()); await H.wait(2500);
  await cap(H, screen, `${label}-accepted`);
}

// Run sheet 0:00 to 8:30, plus renewal help: the buddy route through decline, change and acceptance.
export async function buddy(H) {
  const p = H.page(); HH = H;
  await H.signIn();
  await resetTo(H, process.env.WALK_RESET || 'Main successful journey', 'presenter', false, 'Paula');
  await closeStrip(p);
  await go(H, '/gcsp-account.html');
  await cap(H, 'home', 'start'); await menu(H, 'home'); await H.tabWalk('home-start', 30);
  const pref = p.getByRole('button', { name: /Set your preferences|Change your preferences|See buddy activity/ }).first();
  H.note({ homeBuddyAction: await pref.innerText().catch(() => 'none') });
  await go(H, '/gcsp-brief-live.html');
  await cap(H, 'brief', 'start'); await H.tabWalk('brief', 70);
  const save = p.getByRole('button', { name: /^Save/ }).first();
  H.note({ briefSave: await save.innerText().catch(() => 'none'), enabled: await save.isEnabled().catch(() => null) });
  if (await save.count() && await save.isEnabled()) { await kb(H, save); await H.wait(2000); await cap(H, 'brief', 'saved'); }
  await go(H, '/gcsp-activity-live.html');
  await cap(H, 'activity', 'before-release');
  await H.openStrip();
  if (await btn(p, 'Next release').isEnabled().catch(() => false)) { await H.press('Next release'); await closeStrip(p); await H.wait(1500); await cap(H, 'activity', 'after-release-live', { full: false }); }
  else { H.note({ nextReleaseDisabled: true }); await closeStrip(p); }
  await p.reload(); await H.wait(2500);
  await cap(H, 'activity', 'found');
  await go(H, '/gcsp-account.html'); await cap(H, 'home', 'offer-waiting');
  await go(H, '/gcsp-activity-live.html');
  await kb(H, offerLink(p)); await H.wait(2500);
  await cap(H, 'offer', 'first'); await H.tabWalk('offer-first', 50);
  if (process.env.WALK_STAGE === 'accept') { await declareAndAccept(H, 'offer', 'first'); return; }
  await kb(H, btn(p, /Decline/, false).first()); await H.wait(1500);
  await cap(H, 'offer', 'decline-form');
  await kb(H, btn(p, 'Confirm decline')); await H.wait(1200);
  await cap(H, 'offer', 'decline-no-reason', { full: false });
  const reason = p.getByRole('combobox', { name: 'Reason for declining' });
  await reason.selectOption({ label: 'Body style' }); await H.wait(800);
  await cap(H, 'offer', 'decline-reason-chosen', { full: false });
  await kb(H, btn(p, 'Confirm decline')); await H.wait(3000);
  await cap(H, 'offer', 'declined'); await H.tabWalk('declined', 40);
  const saloon = p.getByRole('radio', { name: 'Saloon' }).or(p.getByRole('button', { name: 'Saloon' })).first();
  if (!(await saloon.count())) { await go(H, '/gcsp-brief-live.html'); H.note({ changeVia: 'brief' }); }
  await saloon.focus(); await p.keyboard.press('Space'); await H.wait(800);
  await cap(H, 'offer', 'change-saloon-chosen', { full: false });
  const cs = p.getByRole('button', { name: /Save|Search again|Confirm|Update/ }).first();
  H.note({ changeSave: await cs.innerText().catch(() => 'none') });
  await kb(H, cs); await H.wait(2500);
  await cap(H, 'offer', 'change-saved');
  await tick(H, 1);
  await go(H, '/gcsp-activity-live.html'); await cap(H, 'activity', 'second-offer');
  await kb(H, offerLink(p)); await H.wait(2500);
  await cap(H, 'offer', 'second');
  await declareAndAccept(H, 'offer', 'second');
  await p.reload(); await H.wait(2500); await cap(H, 'offer', 'accepted-reload', { full: false });
  await go(H, '/gcsp-account.html'); await cap(H, 'home', 'accepted');
  await go(H, '/gcsp-order-progress-live.html'); await cap(H, 'order', 'accepted'); await H.tabWalk('order-accepted', 40);
  await tick(H, 6);
  await go(H, '/gcsp-order-progress-live.html'); await cap(H, 'order', 'approvals-done');
  const slot = p.getByRole('button', { name: /^Request \d/ }).first();
  if (await slot.count()) {
    await kb(H, slot); await H.wait(2000); await cap(H, 'order', 'slot-requested', { full: false });
    await H.openStrip(); const t = p.locator('.gcsp-presenter-controls input[type=text]').first();
    await t.fill('2026-11-05T10:07:00.000Z'); await H.press('Tick to target'); await closeStrip(p);
    await go(H, '/gcsp-order-progress-live.html'); await cap(H, 'order', 'handover-booked'); await H.tabWalk('order-booked', 50);
  }
  await go(H, '/gcsp-help.html'); await cap(H, 'help', 'start'); await H.tabWalk('help', 40);
  const sum = p.locator('main summary', { hasText: /help/i }).first();
  if (await sum.count()) { await kb(H, sum); await H.wait(600); await cap(H, 'help', 'form-open'); }
}

// Manual route: Your cars, setup, gallery, review, summary, outcome. Reuses the run 1 steps with revamp captures.
export async function manual(H) {
  const p = H.page(); HH = H;
  await H.signIn();
  await resetTo(H, process.env.WALK_RESET || 'Main successful journey', 'presenter', false, 'Paula');
  await closeStrip(p);
  await go(H, '/gcsp-account.html');
  await kb(H, btn(p, 'Choose a replacement'));
  await until(H, async () => (await h1(p)) === 'Your order choices', 'setup'); await H.wait(1500);
  await cap(H, 'manual', 'setup-empty'); await H.tabWalk('setup', 40);
  await kb(H, btn(p, 'Save choices'));
  await cap(H, 'manual', 'setup-validation', { full: false });
  const pick = async (name) => { const s = p.locator(`select[name="${name}"]`); if (!(await s.count())) return null;
    await until(H, async () => (await s.locator('option:not([disabled])').count()) > 1, `${name} options`);
    const v = await s.locator('option:not([disabled])').evaluateAll((o) => o.find((x) => x.value)?.value); await s.selectOption(v); return v; };
  await pick('driverId'); await pick('contractOptionId');
  const date = p.locator('input[name="requestedCollectionDate"]'); await date.fill(await date.getAttribute('min'));
  await pick('collectionLocationId');
  const fill = async (sel, v) => { const c = p.locator(sel); if (await c.count() && await c.isVisible() && !(await c.inputValue())) await c.fill(v); };
  await fill('input[name="phone"]', '07700900123'); await fill('input[name="email"]', 'paula.mason@gcsp-demo.com'); await fill('input[name="expectedReturnMileage"]', '24000');
  await kb(H, btn(p, 'Save choices'));
  await until(H, async () => /Your choices are saved/i.test(await H.text()), 'saved');
  await cap(H, 'manual', 'setup-saved');
  await until(H, async () => btn(p, 'Continue').isEnabled(), 'continue enabled');
  await kb(H, btn(p, 'Continue'));
  await until(H, async () => /Released cars/i.test(await H.text()), 'gallery'); await H.wait(2500);
  await cap(H, 'manual', 'gallery-before-release');
  await H.press('Next release'); await closeStrip(p);
  const refresh = btn(p, 'Refresh availability'); if (await refresh.count()) await kb(H, refresh);
  await H.wait(2500);
  if (!(await p.getByRole('button', { name: 'Review this car' }).count())) {
    await cap(H, 'manual', 'gallery-date-outside');
    await kb(H, btn(p, 'Back to your choices'));
    await until(H, async () => (await h1(p)) === 'Your order choices', 'setup again');
    await until(H, async () => (await date.getAttribute('min')) && !(await date.isDisabled()), 'window');
    await date.fill(await date.getAttribute('min'));
    await kb(H, btn(p, 'Save choices')); await until(H, async () => btn(p, 'Continue').isEnabled(), 'continue');
    await kb(H, btn(p, 'Continue'));
  }
  await until(H, async () => (await p.getByRole('button', { name: 'Review this car' }).count()) > 0, 'cards', 30000); await H.wait(1500);
  await cap(H, 'manual', 'gallery-released'); await H.tabWalk('gallery', 50);
  for (let tries = 0; tries < 4 && (await h1(p)) !== 'Review your car'; tries += 1) {
    const enabled = p.locator('button:enabled', { hasText: 'Review this car' });
    await kb(H, enabled.nth(Math.min(tries, (await enabled.count()) - 1)));
    await until(H, async () => (await h1(p)) === 'Review your car' || /no longer available/i.test(await H.text()), 'review or conflict');
    if ((await h1(p)) !== 'Review your car') { if (tries === 0) await cap(H, 'manual', 'gallery-conflict'); await kb(H, btn(p, 'Refresh availability').first()); await H.wait(2500); }
  }
  await H.wait(2000);
  await cap(H, 'manual', 'review'); await H.tabWalk('review', 40);
  await kb(H, btn(p, 'Continue to order review'));
  await until(H, async () => (await h1(p)) === 'Review your order', 'summary'); await H.wait(1500);
  await cap(H, 'manual', 'summary'); await H.tabWalk('summary', 40);
  const boxes = p.locator('input[type="checkbox"][data-declaration]');
  for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await p.keyboard.press('Space'); }
  await kb(H, btn(p, 'Submit order'));
  await until(H, async () => /^(Order received|Order saved|Order not sent)$/.test((await h1(p)).trim()), 'outcome', 60000); await H.wait(1500);
  await cap(H, 'manual', 'outcome');
  await kb(H, btn(p, 'Finish'));
  await until(H, async () => (await h1(p)) === 'Your cars', 'account after order'); await H.wait(2000);
  await cap(H, 'home', 'manual-ordered');
}

// States the demo order does not pass through: expired offer, no match, fixtures for loading and errors.
export async function states(H) {
  const p = H.page(); HH = H;
  await H.signIn();
  const release = async () => { await H.openStrip(); if (await btn(p, 'Next release').isEnabled().catch(() => false)) await H.press('Next release'); await closeStrip(p); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { H.note({ stateError: name, msg: H.clip(e.message, 300) }); } };
  await step('no-match', async () => {
    await resetTo(H, 'No suitable match', 'presenter', false, 'Paula'); await closeStrip(p); await release();
    await go(H, '/gcsp-activity-live.html'); await cap(H, 'activity', 'no-match');
    await go(H, '/gcsp-account.html'); await cap(H, 'home', 'no-match');
  });
  await step('expired', async () => {
    await resetTo(H, 'Offer expires', 'presenter', false, 'Paula'); await closeStrip(p); await release();
    await H.openStrip(); await p.locator('.gcsp-presenter-controls input[type=text]').first().fill('2026-11-05T11:31:00.000Z'); await H.press('Tick to target'); await closeStrip(p);
    await go(H, '/gcsp-activity-live.html'); await cap(H, 'activity', 'expired');
    const l = offerLink(p); if (await l.count()) { await kb(H, l); await H.wait(2500); await cap(H, 'offer', 'expired'); }
  });
  for (const f of ['representative-loading', 'representative-unavailable']) { await go(H, `/gcsp-employee.html?fixture=${f}`); await cap(H, 'employee-fixture', f); }
  for (const f of ['source-failure', 'not-yet-eligible']) { await go(H, `/gcsp-account.html?fixture=${f}`); await cap(H, 'home-fixture', f, { full: false }); }
}
