// FUCQ-288: after a presenter Reset to Main successful journey, Greg's route comparison with assumptions expanded (the 12:00 beat).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetTo } from '../fucq-248/sections.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

export async function greg(H) {
  const p = H.page();
  await H.signIn();
  await resetTo(H, 'Main successful journey', 'fucq-288', false, 'Greg');
  await p.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
  const cmp = p.getByRole('region', { name: 'Route comparison' }).first();
  await cmp.waitFor({ state: 'visible', timeout: 30000 });
  await H.wait(2000);
  for (const summary of await cmp.locator('summary').all()) {
    if (!(await summary.evaluate((s) => s.parentElement.open))) await summary.click();
  }
  await H.wait(600);
  const text = (await cmp.innerText()).replace(/\s+/g, ' ');
  H.note({ comparisonText: text.slice(0, 2500), emDash: text.includes('—'), command: /gcsp-comparison\.mjs/.test(text) });
  await cmp.scrollIntoViewIfNeeded();
  await cmp.screenshot({ path: join(HERE, `greg-${H.W}-comparison.png`) });
}
