// Additional immutable-source integration proof; never adds a later feature to this branch.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assembleSite, discoverManifest, verifySite } from '../../../../scripts/assemble-site.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const EVIDENCE = fileURLToPath(new URL('./fucq36-offer-browser/', import.meta.url));
const PIN = '65f4a911285161b7fc9d3ec303ecfea2175df2d4';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const report = { pin: PIN, proof: 'public offer source from immutable GC FUCQ-105 branch, over current package inputs in isolated scratch; direct route/module proof only; visual issues recorded separately; fixture/default-unavailable page, no live/access/decision claim', rows: [], errors: [], failedRequests: [], assetResponses: [], visualIssues: [], inputs: [] };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
let browser, server;
try {
  await mkdir(EVIDENCE, { recursive: true });
  const publicFiles = JSON.parse(execFileSync('/usr/bin/python3', ['-I', '-B', '-c', `
import importlib.util,sys,json
s=importlib.util.spec_from_file_location('scaffold_git','/Users/usget/Claude/vehicle-matcher/_tools/scaffold_git.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
root=${JSON.stringify(ROOT)};pin=${JSON.stringify(PIN)}
rc,out,err=m.git(root,['ls-tree','-r','--name-only',pin,'--','blocks/gcsp/offer']);assert rc==0
result={}
for p in out.splitlines():
 assert p.startswith('blocks/gcsp/offer/') and '..' not in p.split('/')
 rc,text,err=m.git(root,['show',pin+':'+p]);assert rc==0
 result[p]=text
print(json.dumps(result))
`], { encoding: 'utf8', timeout: 20000 }));
  const sourceRoot = path.join(process.env.TMPDIR, 'offer-source'), output = path.join(process.env.TMPDIR, 'offer-site');
  const { pages } = await discoverManifest(ROOT);
  for (const file of [...pages, 'gcsp-employee.css', 'blocks', 'assets']) {
    await mkdir(path.dirname(path.join(sourceRoot, file)), { recursive: true });
    await cp(path.join(ROOT, file), path.join(sourceRoot, file), { recursive: true });
  }
  for (const [file, text] of Object.entries(publicFiles)) {
    await mkdir(path.dirname(path.join(sourceRoot, file)), { recursive: true }); await writeFile(path.join(sourceRoot, file), text);
    report.inputs.push({ path: file, sha256: createHash('sha256').update(text).digest('hex') });
  }
  const manifest = await assembleSite({ sourceRoot, output, environment: 'deployed', apiUrl: 'https://gcsp-api.example.test', revision: `FUCQ36-package + public-offer-${PIN}` });
  await verifySite({ output, requireDemoPages: true });
  report.manifest = { blocks: manifest.blocks.map((b) => b.name), demoPages: manifest.demoPages, files: manifest.files.length };
  server = createServer(async (req, res) => {
    const rel = new URL(req.url, 'http://local').pathname.replace(/^\/vehicle-matcher\//, '/').slice(1);
    try {
      const file = path.resolve(output, rel); if (!file.startsWith(`${output}${path.sep}`)) throw Error('outside');
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage(); page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 400) report.assetResponses.push({ path: new URL(response.url()).pathname, status: response.status(), type: response.request().resourceType() }); });
  page.on('requestfailed', (request) => { if (new URL(request.url()).origin === origin) report.failedRequests.push(new URL(request.url()).pathname); });
  for (const prefix of ['/', '/vehicle-matcher/']) for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const fixture of ['pending', '']) {
      const url = `${origin}${prefix}blocks/gcsp/offer/preview.html${fixture ? '?fixture=pending' : ''}`;
      assert.equal((await page.goto(url, { waitUntil: 'networkidle' })).status(), 200);
      await page.locator('h1').first().waitFor();
      if (fixture) await page.getByText('Synthetic presentation example.', { exact: false }).first().waitFor();
      else await page.getByText('Offer not found', { exact: false }).first().waitFor();
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => ({ heading: document.querySelector('h1')?.textContent,
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        focus: { tag: document.activeElement.tagName, text: document.activeElement.textContent?.trim().slice(0, 80), outline: getComputedStyle(document.activeElement).outlineStyle },
        missingImages: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')) }));
      const name = `offer-${prefix === '/' ? 'root' : 'prefix'}-${width}-${fixture || 'unavailable'}`;
      if (state.scrollWidth > width + 1 || state.missingImages.length) report.visualIssues.push({ name, overflow: state.scrollWidth > width + 1, missingImages: state.missingImages });
      await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), fullPage: true });
      assert.equal((await page.reload({ waitUntil: 'networkidle' })).status(), 200);
      report.rows.push({ name, path: new URL(url).pathname, fixture: fixture || 'actual unconfigured adapter, no locator/token', ...state });
    }
  }
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  assert.equal(report.failedRequests.length, 0, JSON.stringify(report.failedRequests));
  await rm(path.join(output, 'blocks/gcsp/offer/offer-view.js'));
  await assert.rejects(verifySite({ output, requireDemoPages: true }), /GCSP block "offer": missing packaged file .*offer-view\.js/);
  report.missingModuleNamed = true; report.routeSmokePassed = true;
  report.visualPassed = report.visualIssues.length === 0 && report.assetResponses.length === 0;
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.message; process.exitCode = 1;
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: path.join(EVIDENCE, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  await writeFile(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, routeSmokePassed: report.routeSmokePassed, visualPassed: report.visualPassed,
    rows: report.rows.length, visualIssues: report.visualIssues, assetResponses: report.assetResponses, pin: PIN, failure: report.failure, report: path.join(EVIDENCE, 'report.json') }));
}
