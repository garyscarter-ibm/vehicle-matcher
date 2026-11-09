// FUCQ-312 walk sections: Greg's learned plan at the start of a scenario (learned) and after Paula's order in
// Main successful journey (paula, reusing fucq-265's main). Each order-plan response's learned status is noted.
import * as earlier from '../fucq-265/sections.mjs';

const until = async (H, fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await H.wait(300); } throw new Error(`timed out: ${what}`); };
const btn = (p, name) => p.getByRole('button', { name, exact: true });
const idle = (H) => until(H, async () => !/Action in progress/.test(await H.page().locator('.gcsp-presenter-controls').innerText()), 'presenter action', 60000);
const closeStrip = (p) => p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});

function watchLearned(H) {
  H.page().on('response', async (r) => {
    if (!r.url().includes('/api/gcsp/greg/order-plan')) return;
    const body = await r.json().catch(() => null); const l = body?.value?.learned ?? body?.learned;
    if (!l) return;
    H.note({ api: `${r.request().method()} ${r.url().replace(H.origin, '')} ${r.status()}`, learned: { status: l.status, reason: l.reason, limitation: l.limitation,
      coverage: l.coverage, derivatives: l.differences?.derivatives?.map((d) => d.derivativeId) }, baseline: body?.value?.plan?.quantities?.map((q) => q.derivativeId) });
  });
}
async function switchTo(H, who) {
  const p = H.page(); await H.openStrip();
  await p.locator('.gcsp-presenter-controls button', { hasText: `${who} (fictional)` }).first().click();
  await btn(p, 'Switch principal').click(); await idle(H); await H.wait(2500);
  if (await btn(p, 'Reload').isVisible().catch(() => false)) { await p.reload(); await H.wait(2500); }
}
async function learnedView(H, J) {
  const p = H.page(); await closeStrip(p); await H.wait(2500);
  const sec = p.getByRole('region', { name: 'Synthetic-trained model' }).first();
  await until(H, async () => (await sec.innerText()).length > 40, 'learned section', 30000).catch(() => {});
  H.note({ step: J, learnedText: H.clip(await sec.innerText().catch(() => 'missing'), 1200) });
  await sec.scrollIntoViewIfNeeded().catch(() => {}); await H.wait(400); await p.evaluate(() => window.scrollBy(0, -80));
  await H.shot(J, 'learned-plan', { full: false });
}

export async function learned(H) {
  watchLearned(H); await H.signIn();
  const p = H.page(); const scenario = process.env.WALK_RESET;
  if (scenario) {
    await H.openStrip();
    await p.locator('.gcsp-presenter-controls button', { hasText: scenario }).first().click();
    await btn(p, 'Reset scenario').click(); await H.wait(600);
    await btn(p, 'Confirm reset').click(); await idle(H); await H.wait(1500);
    const cont = btn(p, 'Continue to workspace');
    if (await cont.isVisible().catch(() => false)) { await cont.click(); await H.wait(1500); }
  }
  await switchTo(H, 'Greg');
  await learnedView(H, process.env.WALK_JOURNEY || 'main');
}

export async function paula(H) {
  watchLearned(H);
  await earlier.main(H).catch((e) => H.note({ earlierMainError: H.clip(e.message, 300) }));
  await learnedView(H, 'main-after-paula');
}
