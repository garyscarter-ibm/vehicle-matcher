// FUCQ-144 browser check: two invalid price rows in the composed Greg publish panel, keyboard Enter on each summary link.
// Serves the repo with scripts/serve.js on 127.0.0.1, mounts panel.js with a two-row synthetic policy; results land here.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.FUCQ144_PORT ?? 8984);
if (PORT < 8982 || PORT > 8989) throw new Error('Port must be 8982 to 8989');
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCRATCH = process.env.TMPDIR ?? '/tmp';

const server = spawn(process.execPath, ['scripts/serve.js'], { cwd: ROOT, env: { PATH: process.env.PATH, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error('static server not ready')), 20000);
  server.stdout.on('data', (chunk) => { if (String(chunk).includes('Serving')) { clearTimeout(timer); done(); } });
});

// Remounts the gallery's publish section with a second price row (as the render regression does) and a recording adapter.
async function mount(page) {
  await page.evaluate(async () => {
    const { mountGregPublish } = await import('/blocks/gcsp/greg/publish/panel.js');
    const { galleryPolicy, galleryPreview } = await import('/blocks/gcsp/greg/publish/gallery.js');
    const policy = galleryPolicy(); policy.fields.unshift({ ...policy.fields[0], id: 'price:second', key: 'second', configurationId: 'Second car' });
    window.calls = { preview: 0, publish: 0 };
    const section = [...document.querySelectorAll('section.gcsp')].find((node) => /Greg preview and publish/.test(node.textContent));
    const host = document.createElement('div'); section.lastElementChild.replaceWith(host); section.scrollIntoView();
    mountGregPublish(host, { commandId: () => 'check', adapter: {
      async readPolicy() { return { status: 'ready', value: policy }; },
      async preview(input) { window.calls.preview += 1; return { status: 'ready', value: galleryPreview(input, policy) }; },
      async publish() { window.calls.publish += 1; return { status: 'refused', reason: 'check' }; } } });
  });
  await page.locator('.gcsp-publish select').first().waitFor({ timeout: 15000 });
}
const box = (page) => page.evaluate(() => { const r = document.querySelector('.gcsp-publish').closest('section.gcsp').getBoundingClientRect();
  return { x: 0, y: r.top + window.scrollY, width: document.documentElement.clientWidth, height: Math.min(r.height, 2400) }; });
const state = (page) => page.evaluate(() => {
  const select = document.querySelector('.gcsp-publish select'); const active = document.activeElement;
  return { selected: select.value, activeId: active?.id ?? '', activeValue: active?.value ?? '', invalid: active?.getAttribute('aria-invalid'),
    calls: { ...window.calls }, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

const runs = [];
const profileRoot = await mkdtemp(join(SCRATCH, 'fucq144-chrome-'));
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const run = { viewport: viewport.width, steps: [] };
    const context = await chromium.launchPersistentContext(await mkdtemp(join(profileRoot, 'p-')), { executablePath: CHROME, headless: true, viewport });
    const page = context.pages()[0] ?? await context.newPage();
    try {
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${BASE}/components.html`, { waitUntil: 'networkidle' }); await mount(page);
      const input = page.locator('.gcsp-publish input').first();
      const select = page.locator('.gcsp-publish select').first();
      await input.fill('-1'); await select.selectOption('price:gallery-cost'); await input.fill('1.5');
      await page.locator('.gcsp-publish').getByRole('button', { name: 'Preview changes' }).click(); run.steps.push('two invalid rows, preview requested');
      const links = page.locator('.gcsp-publish .gcsp-error-summary a'); run.links = await links.count();
      run.summaryFocused = await page.evaluate(() => document.activeElement?.matches('.gcsp-error-summary h2'));
      await page.screenshot({ path: join(OUT, `${viewport.width}-summary.png`), fullPage: true, clip: await box(page) });
      // Keyboard: Tab from the focused summary heading to each link, then Enter.
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); run.first = await state(page);
      await page.screenshot({ path: join(OUT, `${viewport.width}-first-link.png`), fullPage: true, clip: await box(page) });
      await page.locator('.gcsp-publish .gcsp-error-summary h2').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
      await page.keyboard.press('Enter'); run.second = await state(page);
      await page.screenshot({ path: join(OUT, `${viewport.width}-second-link.png`), fullPage: true, clip: await box(page) });
      run.pageErrors = errors;
      run.passed = run.links === 2 && run.summaryFocused && run.first.selected === 'price:second' && run.first.activeValue === '-1'
        && run.first.invalid === 'true' && run.second.selected === 'price:gallery-cost' && run.second.activeValue === '1.5'
        && run.second.invalid === 'true' && run.second.calls.preview === 0 && run.second.calls.publish === 0
        && run.second.overflow <= 0 && !errors.length;
    } catch (error) { run.error = error.message.slice(0, 300); run.passed = false; }
    finally { await context.close(); }
    runs.push(run);
  }
} finally {
  const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited;
  await rm(profileRoot, { recursive: true, force: true });
}
const passed = runs.length === 2 && runs.every((run) => run.passed);
await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ passed, origin: BASE, page: 'components.html with panel.js remounted on a two-price-row synthetic policy', runs }, null, 2)}\n`);
console.log(passed ? 'PASSED' : 'FAILED');
process.exit(passed ? 0 : 1);
