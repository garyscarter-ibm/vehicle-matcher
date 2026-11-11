import { chromium } from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = resolve('docs/gcsp/evidence/fucq383');
const server = spawn(process.execPath, ['scripts/serve.js'], { env: { ...process.env, PORT: '3883' }, stdio: 'ignore' });
let browser;
const report = { captures: [], errors: [], scope: 'Synthetic composition and responsive browser evidence; live producer authority is validated separately.' };
try {
  await new Promise((done, fail) => { server.once('error', fail); setTimeout(done, 250); });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:3883/blocks/gcsp/offer/preview.html?fixture=handoff-replacement');
  await page.locator('.gcsp-vehicle-summary').waitFor();
  const setCase = async (kind) => page.evaluate(async (kind) => {
    const { offerFixture } = await import('/blocks/gcsp/offer/fixtures.js');
    const data = offerFixture('handoff-replacement'); const value = data.value; const member = value.card.members[0];
    member.display.name = kind === 'long' ? 'BMW 320i M Sport Touring with Individual extended leather and comfort specification and a long supplied equipment description' : 'BMW 320i M Sport Touring';
    member.media = { src: '/assets/gcsp-vehicle-evidence/07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', alt: member.display.name };
    member.facts = member.facts.filter((row) => !['Interior', 'Colour'].includes(row.label));
    member.facts.push({ label: 'Interior', value: kind === 'unknown' ? null : 'Black upholstery with extended trim' }, { label: 'Colour', value: kind === 'unknown' ? null : 'Alpine White' });
    member.terms[0].value = 295; member.terms[0].allowance = null;
    value.currentCar.facts.find((row) => row.key === 'points').value = '320 points';
    value.currentCar.facts.find((row) => row.key === 'boot').value = '590 litres';
    const reasons = ['Available by your required date.', 'Matches your stated body preference.', 'Supplied head-up display preference.', 'Supplied panoramic roof preference.'];
    member.decision.reasons = (kind === 'five' || kind === 'long' ? reasons : kind === 'empty' || kind === 'unknown' ? [] : reasons.slice(0, 1)).map((text) => ({ text }));
    member.decision.tradeOffs = [];
    if (kind === 'empty' || kind === 'unknown') {
      value.currentCar.facts.forEach((row) => { row.value = null; });
      member.facts.forEach((row) => { if (kind === 'unknown') row.value = null; });
    }
    document.querySelector('gcsp-offer').adapter = { read: async () => data,
      account: { status: 'ready', name: 'Paula Mason', scheme: 'Choices' }, signOut: false,
      decide: async () => ({ status: 'unavailable' }), readReasons: async () => ({ status: 'unavailable' }) };
  }, kind);
  for (const kind of ['two', 'five', 'empty', 'unknown', 'long']) {
    await setCase(kind); await page.locator('.gcsp-vehicle-summary').waitFor();
    for (const width of (kind === 'two' || kind === 'five' ? [1440, 375, 320] : kind === 'long' ? [320] : [375])) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 812 });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode().catch(() => {}))); });
      const file = `${kind}-${width}.png`;
      await page.screenshot({ path: `${destination}/${file}`, fullPage: true });
      const measurements = await page.evaluate(() => {
        const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
        return { viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
          actions: [...document.querySelectorAll('[data-offer-decision-actions] button')].map((node) => ({ label: node.textContent, ...box(node) })),
          media: box(document.querySelector('.vm-card-media')), benefits: [...document.querySelectorAll('.gcsp-highlight-benefits .gcsp-highlight')].map(box),
          tradeoff: [...document.querySelectorAll('.gcsp-highlight-tradeoffs .gcsp-highlight')].map(box),
          columns: [...document.querySelectorAll('thead th')].map(box), clock: document.querySelector('.gcsp-countdown').textContent };
      });
      report.captures.push({ file, kind, ...measurements });
    }
  }
  await writeFile(`${destination}/browser-receipt.json`, JSON.stringify(report, null, 2) + '\n');
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  if (report.captures.some((capture) => capture.overflow)) throw new Error('Horizontal page overflow');
  console.log(JSON.stringify({ captures: report.captures.length, errors: report.errors.length, overflow: false }));
} finally {
  await browser?.close(); server.kill('SIGTERM'); await new Promise((done) => server.once('exit', done));
}
