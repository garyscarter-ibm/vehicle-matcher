// FUCQ-278 walk: Main successful journey after Next release; held-offer gallery, one taken car, account.
import { resetTo } from '../fucq-248/sections.mjs';

const until = async (H, fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await H.wait(300); } throw new Error(`timed out: ${what}`); };
const h1 = (p) => p.locator('h1').first().innerText().catch(() => '');
const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1200); };
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
const closeStrip = (p) => p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});

async function choices(H) {
  const p = H.page();
  await until(H, async () => (await h1(p)) === 'Your order choices', 'setup');
  await H.wait(1500);
  const pick = async (name) => { const s = p.locator(`select[name="${name}"]`); if (!(await s.count())) return;
    await until(H, async () => (await s.locator('option:not([disabled])').count()) > 1, `${name} options`);
    await s.selectOption(await s.locator('option:not([disabled])').evaluateAll((o) => o.find((x) => x.value)?.value)); };
  await p.locator('select[name="driverId"]').selectOption({ label: 'You: Paula (fictional)' }).catch(() => pick('driverId'));
  await pick('contractOptionId');
  const date = p.locator('input[name="requestedCollectionDate"]');
  await until(H, async () => (await date.getAttribute('min')) && !(await date.isDisabled()), 'date window');
  await date.fill(await date.getAttribute('min'));
  await pick('collectionLocationId');
  const fill = async (sel, v) => { const c = p.locator(sel); if (await c.count() && await c.isVisible() && !(await c.inputValue())) await c.fill(v); };
  await fill('input[name="phone"]', '07700900123'); await fill('input[name="email"]', 'paula.test@example.test'); await fill('input[name="expectedReturnMileage"]', '24000');
  await kb(H, btn(p, 'Save choices'));
  await until(H, async () => btn(p, 'Continue').isEnabled(), 'continue enabled');
  await kb(H, btn(p, 'Continue'));
  await until(H, async () => /Released cars/.test(await H.text()), 'gallery');
  await H.wait(2500);
}

export async function heldOffer(H) {
  const p = H.page();
  await H.signIn();
  await resetTo(H, 'Main successful journey', 'paula-held', false);
  await H.press('Next release'); await closeStrip(p);
  await p.reload(); await H.wait(3000); await closeStrip(p);
  await until(H, async () => (await p.getByRole('button', { name: 'View your offer' }).count()) > 0, 'offer card');
  H.note({ step: 'account', h1: await h1(p), text: H.clip(await H.text(), 900) });
  await H.dump('account'); await H.shot('paula-held', 'account-offer-held');

  await kb(H, btn(p, 'Choose a replacement'));
  await choices(H);
  await until(H, async () => /You already have a car offer/.test(await H.text()), 'held-offer notice');
  H.note({ step: 'gallery-held', text: H.clip(await H.text(), 1200),
    link: await p.getByRole('link', { name: 'View your offer' }).first().getAttribute('href').catch(() => null),
    enabledReview: await p.locator('button:enabled', { hasText: 'Review this car' }).count() });
  await H.dump('gallery-held'); await H.shot('paula-held', 'gallery-offer-held');

  // One taken car: the browser hides the held offer and the server's claim answer is replaced by a stock conflict.
  await p.route('**/api/gcsp/manual/stock', async (route) => { const res = await route.fetch(); const json = await res.json();
    if (json?.value) json.value.heldOffer = null; await route.fulfill({ response: res, json }); });
  await p.route('**/api/gcsp/manual/claim', async (route) => { if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ status: 'conflict', reason: 'stock-unavailable',
      view: { state: 'conflict', editable: false, supportOwner: 'employee', action: 'refresh-review' }, contractVersion: '1.0.0' }) }); });
  await kb(H, btn(p, 'Back to your choices'));
  await until(H, async () => btn(p, 'Continue').isEnabled(), 'continue again');
  await kb(H, btn(p, 'Continue'));
  await until(H, async () => (await p.locator('button:enabled', { hasText: 'Review this car' }).count()) > 0, 'reviewable cars');
  await kb(H, p.locator('button:enabled', { hasText: 'Review this car' }));
  await until(H, async () => /This car is no longer available/.test(await H.text()), 'car-taken notice');
  await H.wait(1500);
  H.note({ step: 'gallery-taken', text: H.clip(await H.text(), 1200) });
  await H.dump('gallery-taken'); await H.shot('paula-held', 'gallery-one-car-taken');
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // The account with both the offer and the saved journey: one primary action.
  const yours = p.getByRole('link', { name: 'Your cars' }).first();
  if (await yours.count()) await kb(H, yours); else await H.go('/gcsp-presenter.html');
  await until(H, async () => (await p.getByRole('button', { name: /Resume saved journey/ }).count()) > 0, 'resume button');
  await H.wait(1500);
  H.note({ step: 'account-saved', text: H.clip(await H.text(), 900),
    primary: await p.locator('main .vm-btn-primary:visible').evaluateAll((b) => b.map((x) => x.textContent.trim())) });
  await H.dump('account-saved'); await H.shot('paula-held', 'account-offer-and-saved-journey');
}
