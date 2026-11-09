// FUCQ-313: Greg's comparison with reruns off. Hold duration shows no form; Order mix shows the prepared-offline copy.
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resetTo } from '../fucq-248/sections.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BANNED = /demo|demonstration|synthetic|fictional|example/i;

export async function greg(H) {
  const p = H.page();
  await H.signIn();
  await resetTo(H, 'Main successful journey', 'fucq-313', false, 'Greg');
  await p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
  const cmp = p.getByRole('region', { name: 'Route comparison' }).first();
  await cmp.waitFor({ state: 'visible', timeout: 30000 });
  await H.wait(2000);
  const results = [];
  for (const [file, label] of [['hold-duration', 'Hold duration'], ['order-mix', 'Order mix']]) {
    await cmp.locator('.gcsp-comparison-picker [role="option"], .gcsp-comparison-picker button').filter({ hasText: label }).first().click();
    await H.wait(800);
    await cmp.scrollIntoViewIfNeeded();
    const shown = (await cmp.innerText()).replace(/\s+/g, ' ');
    // The panel's own text (not the page chrome or the stored result's fixture data) is what the banned-word rule covers.
    const stage = (await cmp.locator('.gcsp-comparison-stage').innerText()).replace(/\s+/g, ' ');
    results.push({ shot: `greg-${H.W}-${file}.png`, url: p.url().replace(H.origin, ''), width: H.W, experiment: label,
      rerunForm: await cmp.locator('.gcsp-comparison-form').count() > 0, runButton: await cmp.getByRole('button', { name: /Run the hold comparison/ }).count() > 0,
      stageText: stage.slice(0, 400), bannedInStage: stage.match(BANNED)?.[0] ?? null, bannedInRegion: shown.match(BANNED)?.[0] ?? null, emDash: shown.includes('—') });
    await cmp.screenshot({ path: join(HERE, `greg-${H.W}-${file}.png`) });
  }
  H.note({ results });
  await writeFile(join(HERE, `results-${H.W}.json`), JSON.stringify(results, null, 2));
}
