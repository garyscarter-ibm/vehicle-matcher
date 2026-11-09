// FUCQ-275: the pending offer as Paula first sees it, with page height and where the deadline and Accept sit.
import { resetTo } from '../fucq-311/sections.mjs';

const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1500); };
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
const closeStrip = (p) => p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
const top = (p, sel) => p.locator(sel).first().evaluate((e) => Math.round(e.getBoundingClientRect().top + window.scrollY)).catch(() => null);

export async function offer(H) {
  const p = H.page(); const J = process.env.WALK_LABEL || 'offer';
  await H.signIn();
  await resetTo(H, 'Decline then change', J, false, 'Paula'); await closeStrip(p);
  await H.openStrip(); if (await btn(p, 'Next release').isEnabled().catch(() => false)) await H.press('Next release'); await closeStrip(p);
  await H.go('/gcsp-activity-live.html'); await H.wait(1200);
  const open = p.getByRole('link', { name: /View offer|Open the offer/i }).first();
  if (!(await open.count())) throw new Error('no offer link on activity');
  await kb(H, open); await H.wait(2500); await closeStrip(p);
  const rows = await p.locator('main table tr, main .vm-facts .vm-fact').evaluateAll((r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).slice(0, 40));
  H.note({ step: 'offer', h1: await p.locator('h1').first().innerText().catch(() => ''),
    height: await p.evaluate(() => document.documentElement.scrollHeight),
    h1Top: await top(p, 'h1'), deadlineTop: await top(p, '.gcsp-countdown'), acceptTop: await top(p, '[data-offer-action="accept"]'), rows });
  await H.shot(J, 'offer');
}
