// Static GCSP files revalidate by content hash; pages, redirects and the access gate stay uncached.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createGcspFront, REPO_ROOT } from '../gcsp/host.js';

const KEY = `test-${randomBytes(9).toString('hex')}`;
const CSS = '/blocks/gcsp/shell/gcsp-shell.css';
const SCRIPT = '/blocks/gcsp/shell/portal-shell.js';
const services = { identity: { resolveSession: async () => ({ status: 'ok' }) }, createLocalSession: async () => ({ status: 'unavailable' }) };
const api = { emit: (_event, _req, res) => { res.writeHead(418, { 'Cache-Control': 'no-store' }).end('api'); } };

let server; let origin; let cookie;
before(async () => {
  server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createGcspFront({ root: REPO_ROOT, services, api, origin, accessKey: KEY, accessGate: true, fallThrough: true }));
  const signed = await fetch(`${origin}/gcsp/access`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ key: KEY, next: '/gcsp-presenter.html' }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(signed.status, 303); await signed.text();
  cookie = signed.headers.getSetCookie().find((line) => line.startsWith('GCSP_HOST_ACCESS=')).split(';')[0];
});
after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });

const get = async (path, headers = {}) => {
  const response = await fetch(origin + path, { redirect: 'manual', headers });
  return { status: response.status, headers: response.headers, text: await response.text() };
};
// Gated pages answer 303 before any validator is checked, so no 304 can leak a page.
const gatedRedirect = async (path, validator) => {
  const reply = await get(path, { 'If-None-Match': validator });
  assert.equal(reply.status, 303); assert.notEqual(reply.status, 304);
  assert.equal(reply.headers.get('location'), `/gcsp/access?next=${encodeURIComponent(path)}`);
  assert.equal(reply.headers.get('etag'), null); assert.equal(reply.text, '');
};

test('static files carry a strong content ETag and revalidate with a 304', async () => {
  const first = await get(CSS);
  const etag = first.headers.get('etag');
  assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'private, no-cache');
  assert.match(etag, /^"[A-Za-z0-9_-]{27}"$/); assert.ok(first.text.length > 0); assert.equal(first.headers.get('content-type'), 'text/css');

  const revalidated = await get(CSS, { 'If-None-Match': etag });
  assert.equal(revalidated.status, 304); assert.equal(revalidated.headers.get('etag'), etag);
  assert.equal(revalidated.headers.get('cache-control'), 'private, no-cache'); assert.equal(revalidated.text, '');
  assert.equal((await get(CSS, { 'If-None-Match': `W/${etag}` })).status, 304);
  const stale = await get(CSS, { 'If-None-Match': '"something-else"' });
  assert.equal(stale.status, 200); assert.equal(stale.text, first.text);

  const script = await get(SCRIPT);
  assert.equal(script.status, 200); assert.equal(script.headers.get('cache-control'), 'private, no-cache');
  assert.notEqual(script.headers.get('etag'), etag);
});

test('pages, the access page and redirects stay no-store with no ETag', async () => {
  const page = await get('/gcsp-presenter.html', { Cookie: cookie, 'If-None-Match': '*' });
  assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store'); assert.equal(page.headers.get('etag'), null);
  assert.match(page.text, /<html/i);

  const offer = await get('/gcsp/offer');
  assert.equal(offer.status, 200); assert.equal(offer.headers.get('cache-control'), 'no-store'); assert.equal(offer.headers.get('etag'), null);

  const access = await get('/gcsp/access');
  assert.equal(access.status, 200); assert.equal(access.headers.get('cache-control'), 'no-store'); assert.equal(access.headers.get('etag'), null);

  const root = await get('/', { Cookie: cookie });
  assert.equal(root.status, 303); assert.equal(root.headers.get('cache-control'), 'no-store'); assert.equal(root.headers.get('etag'), null);

  const context = await get('/api/gcsp/context');
  assert.equal(context.status, 418); assert.equal(context.headers.get('etag'), null);
});

test('the access gate runs before any 304, so no access means no page and no 304', async () => {
  const etag = (await get(CSS)).headers.get('etag');
  await gatedRedirect('/gcsp-presenter.html', '*');
  await gatedRedirect('/gcsp-presenter.html', etag);
  await gatedRedirect('/gcsp-account.html', '*');
});
