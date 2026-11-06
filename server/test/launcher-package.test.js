import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import { assembleSite, discoverManifest, verifySite } from '../../scripts/assemble-site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEPLOYED = 'https://gcsp-api.example.test/service';
async function owned(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'launcher-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function sourceCopy(root) {
  const source = path.join(root, 'source');
  await mkdir(source);
  const { pages } = await discoverManifest(ROOT);
  for (const file of [...pages, 'gcsp-employee.css', 'blocks', 'assets']) await cp(path.join(ROOT, file), path.join(source, file), { recursive: true });
  return source;
}
const content = (output, file) => readFile(path.join(output, file), 'utf8');

test('assembly is deterministic and discovers every GCSP directory, including a newly added block', async (t) => {
  const root = await owned(t), source = await sourceCopy(root);
  await mkdir(path.join(source, 'blocks/gcsp/new-capability'));
  await writeFile(path.join(source, 'blocks/gcsp/new-capability/register.js'), 'export const ready = true;\n');
  const opts = { sourceRoot: source, apiUrl: DEPLOYED, environment: 'deployed', revision: 'test-revision' };
  const first = await assembleSite({ ...opts, output: path.join(root, 'first') });
  const second = await assembleSite({ ...opts, output: path.join(root, 'second') });
  assert.deepEqual(first, second);
  const names = (await readdir(path.join(source, 'blocks/gcsp'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(first.blocks.map((b) => b.name).sort(), names);
  assert.ok(first.blocks.find((b) => b.name === 'new-capability').files.includes('blocks/gcsp/new-capability/register.js'));
  assert.ok(first.files.some((f) => f.path === 'components.html'));
  assert.ok(first.files.some((f) => f.path.endsWith('BMWGroupTNCondensedPro-Medium.woff2')));
  assert.ok(first.files.every((f) => !/^(?:server|config|scripts|\.github)\//.test(f.path)));
  assert.ok(first.files.every((f) => !/(?:stock-fixtures|\.sdg$|\.env$|package-lock)/.test(f.path)));
});

test('every literal dynamic import, lazy employee stylesheet and CSS asset is in the dependency graph', async (t) => {
  const output = path.join(await owned(t), 'site');
  const manifest = await assembleSite({ output });
  for (const target of ['blocks/gcsp/manual-setup/journey.js', 'blocks/gcsp/account/http-adapter.js',
    'blocks/gcsp/shell/gcsp-shell.css', 'blocks/gcsp/account/gcsp-account.css', 'blocks/gcsp/manual-setup/gcsp-manual-setup.css']) {
    assert.ok(manifest.dependencies.some((e) => e.to === target), target);
  }
  for (const block of manifest.blocks) for (const file of block.files) assert.ok(manifest.files.some((f) => f.path === file), file);
  await rm(path.join(output, 'blocks/gcsp/manual-setup/journey.js'));
  await assert.rejects(verifySite({ output }), /GCSP block "manual-setup": missing packaged file .*journey\.js/);
});

test('missing required import fails assembly with the block and importer named', async (t) => {
  const root = await owned(t), sourceRoot = await sourceCopy(root);
  await writeFile(path.join(sourceRoot, 'blocks/gcsp/employee/missing-test.js'), "import './required-not-shipped.js';\n");
  await assert.rejects(assembleSite({ sourceRoot, output: path.join(root, 'site') }), /GCSP block "employee": missing required .*required-not-shipped\.js, referenced by .*missing-test\.js/);
});

test('new computed imports and relative page assets cannot silently escape package checks', async (t) => {
  const root = await owned(t), sourceRoot = await sourceCopy(root);
  const module = path.join(sourceRoot, 'blocks/gcsp/employee/missing-test.js');
  await writeFile(module, 'export const load = (name) => import(`./${name}.js`);\n');
  await assert.rejects(assembleSite({ sourceRoot, output: path.join(root, 'computed') }), /GCSP block "employee": unresolved dynamic import/);
  await rm(module);
  await writeFile(path.join(sourceRoot, 'gcsp-new.html'), '<!doctype html><html><head></head><body><img src="assets/missing.jpg"></body></html>');
  await assert.rejects(assembleSite({ sourceRoot, output: path.join(root, 'relative') }), /missing required assets\/missing\.jpg, referenced by gcsp-new\.html/);
});

test('required template logo and image fallback assets fail before publication', async (t) => {
  const root = await owned(t), sourceRoot = await sourceCopy(root);
  await rm(path.join(sourceRoot, 'assets/brand-logos/mini.svg'));
  await assert.rejects(assembleSite({ sourceRoot, output: path.join(root, 'logo') }), /Missing required brand\/image fallback asset: assets\/brand-logos\/mini\.svg/);
  await cp(path.join(ROOT, 'assets/brand-logos/mini.svg'), path.join(sourceRoot, 'assets/brand-logos/mini.svg'));
  await rm(path.join(sourceRoot, 'assets/brand-hero/bmw.jpg'));
  await assert.rejects(assembleSite({ sourceRoot, output: path.join(root, 'image') }), /Missing required brand\/image fallback asset: assets\/brand-hero\/bmw\.jpg/);
});

test('local and deployed settings cover launcher and standalone defaults without changing source', async (t) => {
  const root = await owned(t);
  for (const [name, apiUrl, environment] of [['local', 'http://localhost:8787', 'local'], ['deployed', DEPLOYED, 'deployed']]) {
    const output = path.join(root, name);
    const manifest = await assembleSite({ output, apiUrl, environment });
    const boot = await content(output, 'blocks/demo-launcher/boot.js');
    assert.ok(boot.includes(`const LOCAL_API = ${JSON.stringify(apiUrl)};`));
    assert.ok(boot.includes(`const REMOTE_API = ${JSON.stringify(apiUrl)};`));
    const block = new JSDOM(await content(output, 'block.html'));
    assert.equal(block.window.document.querySelector('.vehicle-matcher').dataset.api, apiUrl);
    block.window.close();
    assert.equal(manifest.apiUrl, apiUrl);
    if (environment === 'deployed') assert.doesNotMatch(boot, /http:\/\/localhost:8787|https:\/\/bmw-matcher-api\.onrender\.com/);
  }
  assert.match(await content(ROOT, 'block.html'), /data-api="http:\/\/localhost:8787"/);
  assert.match(await content(ROOT, 'blocks/demo-launcher/boot.js'), /const REMOTE_API = 'https:\/\/bmw-matcher-api\.onrender\.com'/);
});

test('invalid deployed API and incompatible frontend defaults fail actionably', async (t) => {
  const root = await owned(t);
  for (const apiUrl of ['http://localhost:8787', 'https://127.0.0.1', 'https://user:secret@api.example.test', 'javascript:alert(1)', 'https://api.example.test/?key=secret']) {
    await assert.rejects(assembleSite({ output: path.join(root, 'invalid'), apiUrl, environment: 'deployed' }), /API setting/);
  }
  const sourceRoot = await sourceCopy(root);
  const file = path.join(sourceRoot, 'blocks/demo-launcher/boot.js');
  await writeFile(file, (await readFile(file, 'utf8')).replace("const LOCAL_API = 'http://localhost:8787';", 'const LOCAL_API = unknown;'));
  await assert.rejects(assembleSite({ sourceRoot, output: path.join(root, 'incompatible') }), /boot\.js: incompatible frontend revision/);
});

test('employee availability switch keeps the complete retail brand and mode registry', async (t) => {
  const root = await owned(t);
  for (const employeeEnabled of [true, false]) {
    const output = path.join(root, String(employeeEnabled));
    const manifest = await assembleSite({ output, employeeEnabled });
    assert.equal(manifest.employeeEnabled, employeeEnabled);
    assert.match(await content(output, 'blocks/demo-launcher/demo-launcher.js'), new RegExp(`createEmployeeCapability\\(\\{ enabled: ${employeeEnabled} \\}\\)`));
    const { ENTRY_REGISTRY, resolveEntryContext } = await import(`file://${output}/blocks/demo-launcher/entry-context.js`);
    for (const brand of ENTRY_REGISTRY.retailBrands) for (const mode of ENTRY_REGISTRY.retailModes) {
      for (const prefix of ['/', '/vehicle-matcher/']) {
        const context = resolveEntryContext(`https://static.example.test${prefix}index.html?experience=used-cars&brand=${brand}&mode=${mode}`, { employeeAvailable: employeeEnabled });
        assert.equal(context.state, 'retail');
        assert.equal(context.brand, brand);
        assert.ok(context.links.launcher.startsWith(prefix));
      }
    }
    assert.equal(resolveEntryContext('https://static.example.test/?experience=employee-cars&brand=bmw', { employeeAvailable: employeeEnabled }).state,
      employeeEnabled ? 'employee' : 'employee-unavailable');
  }
});

test('assembled repository-hosted pages use external scripts and a self-only script CSP', async (t) => {
  const output = path.join(await owned(t), 'site');
  const manifest = await assembleSite({ output });
  for (const file of manifest.files.filter((f) => f.path.endsWith('.html'))) {
    const dom = new JSDOM(await content(output, file.path));
    try {
      for (const script of dom.window.document.scripts) {
        assert.ok(script.getAttribute('src'), `${file.path}: script must be external`);
        assert.equal(script.textContent.trim(), '');
      }
      for (const el of dom.window.document.querySelectorAll('*')) for (const attr of el.attributes) assert.ok(!/^on/i.test(attr.name), `${file.path}: ${attr.name}`);
      assert.match(dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /script-src 'self';/);
    } finally { dom.window.close(); }
  }
});

test('direct pages, refreshes and dependencies serve at root and repository prefix without rewrites', async (t) => {
  const output = path.join(await owned(t), 'site');
  const manifest = await assembleSite({ output });
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://local').pathname.replace(/^\/vehicle-matcher\//, '/');
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    try { response.end(await readFile(path.join(output, file))); }
    catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const prefix of ['/', '/vehicle-matcher/']) {
    for (const file of manifest.pages) for (let refresh = 0; refresh < 2; refresh += 1) {
      const response = await fetch(`${origin}${prefix}${file}`);
      assert.equal(response.status, 200, `${prefix}${file}`);
      assert.match(await response.text(), /<!doctype html>/i);
    }
    for (const file of new Set(manifest.dependencies.map((e) => e.to))) assert.equal((await fetch(`${origin}${prefix}${file}`)).status, 200, file);
    assert.equal((await fetch(`${origin}${prefix}no-page.html`)).status, 404, 'server must not rewrite missing pages to index');
  }
});

test('release direct-page gate names an unavailable offer block rather than treating it as a passing smoke', async (t) => {
  const output = path.join(await owned(t), 'site');
  const manifest = await assembleSite({ output, revision: 'current-test-base' });
  if (manifest.demoPages.every((p) => p.available)) await verifySite({ output, requireDemoPages: true });
  else await assert.rejects(verifySite({ output, requireDemoPages: true }), /GCSP block "[a-z-]+": required direct .* page .* is unavailable in revision current-test-base/);
});

test('changed packaged API/module bytes require reassembly and output must be empty', async (t) => {
  const output = path.join(await owned(t), 'site');
  await assembleSite({ output });
  await writeFile(path.join(output, 'blocks/demo-launcher/boot.js'), 'const API = "https://wrong.example.test";');
  await assert.rejects(verifySite({ output }), /packaged file changed: .*boot\.js; reassemble with the intended API setting\/revision/);
  await assert.rejects(assembleSite({ output }), /Output must be empty/);
});
