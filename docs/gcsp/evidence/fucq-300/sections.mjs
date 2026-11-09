// FUCQ-300: Paula accepts under "Uncertain handoff, rejected", one Tick refuses the handoff, then the offer is captured.
import { resetTo } from '../fucq-311/sections.mjs';

const h1 = (p) => p.locator('h1').first().innerText().catch(() => '');
const kb = async (H, loc) => { await loc.first().focus(); await H.page().keyboard.press('Enter'); await H.wait(1500); };
const btn = (p, name, exact = true) => p.getByRole('button', { name, exact });
const closeStrip = (p) => p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
const mainText = async (p) => (await p.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500);

export async function refused(H) {
  const p = H.page(); const J = 'refused';
  await H.signIn();
  await resetTo(H, 'Uncertain handoff, rejected', J, false, 'Paula'); await closeStrip(p);
  await H.openStrip(); if (await btn(p, 'Next release').isEnabled().catch(() => false)) await H.press('Next release'); await closeStrip(p);
  await H.go('/gcsp-activity-live.html'); await H.wait(1200);
  const open = p.getByRole('link', { name: /View offer|Open the offer/i }).first();
  if (!(await open.count())) throw new Error('no offer link on activity');
  await kb(H, open); await H.wait(2500);
  const boxes = p.locator('input[type="checkbox"]'); for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await p.keyboard.press('Space'); }
  await kb(H, btn(p, /^Accept/, false).first()); await H.wait(3000);
  H.note({ step: 'after-accept', h1: await h1(p), text: await mainText(p) }); await H.shot(J, 'after-accept');
  await H.press(/^Tick \(/); await closeStrip(p); await p.reload(); await H.wait(2500);
  const help = await p.getByRole('link', { name: 'Contact scheme support' }).getAttribute('href').catch(() => null);
  const tracker = await p.locator('.gcsp-offer-order').count();
  H.note({ step: 'after-tick', h1: await h1(p), help, tracker, text: await mainText(p),
    height: await p.evaluate(() => document.documentElement.scrollHeight) });
  await H.shot(J, 'after-tick');
}
