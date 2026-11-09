// FUCQ-289 policy panel capture: Greg after Reset "Decline then change"; draft, sources open, preview.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetTo } from '../fucq-248/sections.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const RAW = /eligibilityModelKey|choices-fs-uk|choices-rr-production|relative-weight|points\/month|docs\/gcsp|gcsp-policy-v1|offer-journey-v1|—/g;

export async function policy(H) {
  const p = H.page(); const W = H.W; const out = { width: W };
  await H.signIn();
  await resetTo(H, 'Decline then change', 'fucq-289', false, 'Greg');
  await p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; });
  const pol = p.getByRole('region', { name: 'Preview and publish policy' }).first();
  await pol.getByRole('button', { name: 'Preview changes', exact: true }).waitFor({ timeout: 60000 });
  await H.wait(1500);
  const shot = async (n, state) => { await pol.scrollIntoViewIfNeeded(); await pol.screenshot({ path: join(HERE, `${W}-${n}-${state}.png`) }); };
  const sources = pol.locator('details.gcsp-publish-sources');
  const visible = async () => (await pol.innerText()).replace(/\s+/g, ' ');
  // Draft: sources closed, no raw keys in rendered text.
  let text = await visible();
  out.draft = { rawKeys: text.match(RAW) ?? [], sourcesOpen: await sources.evaluate((d) => d.open),
    optgroups: await pol.locator('optgroup').evaluateAll((g) => g.map((x) => `${x.label} (${x.children.length})`)),
    firstOptions: (await pol.locator('select option').allTextContents()).slice(0, 4),
    hints: (await pol.locator('.gcsp-field-hint').allTextContents()).slice(0, 8), text: text.slice(0, 900) };
  await shot('01', 'policy-draft');
  // Keyboard: open the disclosure from its summary.
  await sources.locator('summary').focus(); await p.keyboard.press('Enter'); await H.wait(500);
  text = await visible();
  out.sourcesOpen = { open: await sources.evaluate((d) => d.open), groups: await sources.locator('dl, .vm-facts, .gcsp-facts').count(),
    basisCount: (text.match(/Read-only employee composition/g) ?? []).length, text: (await sources.innerText()).replace(/\s+/g, ' ').slice(0, 1500) };
  await shot('02', 'policy-sources-open');
  await sources.locator('summary').focus(); await p.keyboard.press('Enter'); await H.wait(300);
  // Preview one weight change by keyboard.
  const body = pol.getByRole('spinbutton', { name: 'Body style weight' });
  await body.focus(); await body.fill('2');
  await pol.getByRole('button', { name: 'Preview changes', exact: true }).focus(); await p.keyboard.press('Enter');
  await pol.getByText('Compare with the active policy').waitFor({ timeout: 60000 }); await H.wait(800);
  text = await visible();
  out.preview = { rawKeys: text.match(RAW) ?? [], status: await pol.locator('[role=status]').first().innerText().catch(() => ''),
    order: await pol.evaluate((r) => { const a = r.querySelector('.gcsp-publish-actions'); const res = r.querySelector('.gcsp-publish-results');
      return a && res ? (a.compareDocumentPosition(res) & Node.DOCUMENT_POSITION_FOLLOWING ? 'actions before results' : 'results before actions') : 'missing'; }),
    gapPx: await pol.evaluate((r) => { const a = r.querySelector('.gcsp-publish-actions').getBoundingClientRect(); const res = r.querySelector('.gcsp-publish-results').getBoundingClientRect(); return Math.round(res.top - a.bottom); }),
    overflowX: await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), text: text.slice(-900) };
  await shot('03', 'policy-preview');
  H.note(out);
  await writeFile(join(HERE, `results-${W}.json`), `${JSON.stringify(out, null, 1)}\n`);
}
