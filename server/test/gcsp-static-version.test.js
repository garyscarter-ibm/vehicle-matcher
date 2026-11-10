// FUCQ-374: versioned static URLs are immutable, pages carry preload hints, and the version tracks file changes.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGcspFront, REPO_ROOT } from '../gcsp/host.js';

const services = { identity: { resolveSession: async () => ({ status: 'ok', value: { roles: ['employee', 'greg'] } }) },
  createPresenterControlSession: async () => ({ status: 'ok', value: { setCookie: 'p=1; Path=/' } }) };
const api = { emit: (_e, _req, res) => { res.writeHead(418).end('api'); } };
let server; let origin; let root;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'gcsp-v-'));
  for (const p of ['blocks', 'assets/brand-logos', 'gcsp-presenter.html', 'gcsp-offer.html', 'gcsp-employee.css']) await cp(join(REPO_ROOT, p), join(root, p), { recursive: true });
  server = createServer(); await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createGcspFront({ root, services, api, origin, fallThrough: true }));
});
after(async () => { server.closeAllConnections(); await new Promise((d) => server.close(d)); await rm(root, { recursive: true, force: true }); });
const get = async (path, headers = {}) => { const r = await fetch(origin + path, { redirect: 'manual', headers }); return { status: r.status, headers: r.headers, text: await r.text() }; };
const versionOf = (html) => /\/_v\/([A-Za-z0-9_-]+)\//.exec(html)?.[1];

test('pages reference static files under the version and preload their whole graph', async () => {
  const page = await get('/gcsp/offer');
  assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
  const v = versionOf(page.text); assert.ok(v);
  assert.doesNotMatch(page.text, /(src|href)="\.?\/(blocks|assets)\//);
  assert.match(page.text, new RegExp(`<script type="module" src="/_v/${v}/blocks/gcsp/offer/entry-harness.js">`));
  const preloads = [...page.text.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(preloads.length > 40, `${preloads.length} modulepreloads`);
  assert.ok(preloads.includes(`/_v/${v}/blocks/vehicle-matcher/ui.js`));
  assert.ok(/rel="preload" as="style" href="\/_v\/[^"]+\.css"/.test(page.text));
  const presenter = await get('/gcsp-presenter.html'); assert.equal(versionOf(presenter.text), v);
  assert.match(presenter.text, /rel="modulepreload" href="\/_v\/[^"]+\/presenter-controls\/console\.js"/);
});

test('current-version static files are immutable; other versions and plain paths revalidate', async () => {
  const v = versionOf((await get('/gcsp-presenter.html')).text);
  const hit = await get(`/_v/${v}/blocks/gcsp/shell/gcsp-shell.css`);
  assert.equal(hit.status, 200); assert.equal(hit.headers.get('cache-control'), 'private, max-age=31536000, immutable'); assert.ok(hit.headers.get('etag'));
  const plain = await get('/blocks/gcsp/shell/gcsp-shell.css');
  assert.equal(plain.headers.get('cache-control'), 'private, no-cache'); assert.equal(plain.text, hit.text);
  const old = await get('/_v/oldversion0/blocks/gcsp/shell/gcsp-shell.css');
  assert.equal(old.status, 200); assert.equal(old.headers.get('cache-control'), 'private, no-cache');
  assert.equal((await get(`/_v/${v}/blocks/gcsp/shell/gcsp-shell.css`, { 'If-None-Match': hit.headers.get('etag') })).status, 304);
});

test('pages under the prefix redirect to their gate, and nothing outside static paths is served', async () => {
  const v = versionOf((await get('/gcsp-presenter.html')).text);
  const page = await get(`/_v/${v}/gcsp-presenter.html?x=1`);
  assert.equal(page.status, 303); assert.equal(page.headers.get('location'), '/gcsp-presenter.html?x=1');
  for (const path of ['/server/index.js', '/blocks/%2f..%2fserver/index.js', '/../server/index.js', '/gcsp-login.html.bak'])
    assert.equal((await get(`/_v/${v}${path}`)).status, 404, path);
  assert.equal((await get('/_v/bad!/blocks/gcsp/shell/gcsp-shell.css')).status, 418);
});

test('the version changes when a static file changes, without a restart', async () => {
  const before = versionOf((await get('/gcsp-presenter.html')).text);
  const file = join(root, 'blocks/gcsp/shell/gcsp-shell.css');
  await writeFile(file, '/* changed */\n', { flag: 'a' }); const later = new Date(Date.now() + 5000); await utimes(file, later, later);
  await new Promise((d) => setTimeout(d, 1100));
  const after = versionOf((await get('/gcsp-presenter.html')).text);
  assert.notEqual(after, before);
  assert.equal((await get(`/_v/${before}/blocks/gcsp/shell/gcsp-shell.css`)).headers.get('cache-control'), 'private, no-cache');
});
