import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { buildServer } from '../index.js';
import { createGcspFront, REPO_ROOT } from '../gcsp/host.js';
import { modelDisplayImage } from '../gcsp/vehicle-evidence/display-images.js';
import { createLiveDisplayImageHandler } from '../gcsp/vehicle-evidence/live-display-images.js';

test('vehicle image delivery passes the shared gate before invoking the server-owned image adapter', async () => {
  let calls = 0;
  const image = Buffer.from('server-owned-image');
  const handler = async ({ res }) => { calls += 1; res.writeHead(200, { 'Content-Type': 'image/webp' }); res.end(image); return true; };
  const server = buildServer({ gcspVehicleImages: handler,
    gcspVehicleEvidence: { lookup: { resolve: async () => ({ status: 'unavailable' }) } } });
  const previous = process.env.DEMO_ACCESS_KEY; process.env.DEMO_ACCESS_KEY = 'test-image-gate';
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/gcsp/vehicle-images/bmw-display-${'a'.repeat(20)}.webp`;
    const denied = await fetch(url); assert.equal(denied.status, 401); await denied.arrayBuffer(); assert.equal(calls, 0);
    const allowed = await fetch(url, { headers: { 'X-Access-Key': 'test-image-gate' } });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), image); assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = previous;
    server.closeAllConnections(); await new Promise(done => server.close(done));
  }
});

test('hosted browser images pass the cookie gate without a custom image header and retain fallback bytes', async () => {
  const image = await modelDisplayImage('G21 Touring|320i');
  assert.ok(image);
  const api = buildServer({ gcspVehicleImages: createLiveDisplayImageHandler({ fetchImpl: async () => { throw Error('source-unavailable'); } }),
    gcspVehicleEvidence: { lookup: { resolve: async () => ({ status: 'unavailable' }) } } });
  const server = createServer();
  const previous = process.env.DEMO_ACCESS_KEY; process.env.DEMO_ACCESS_KEY = 'test-hosted-image-gate';
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    server.on('request', createGcspFront({ root: REPO_ROOT, api, origin, accessKey: 'test-hosted-image-gate', accessGate: true }));
    const path = `/api/gcsp/vehicle-images/${image.imageId}.webp`;
    const denied = await fetch(origin + path); assert.equal(denied.status, 401); await denied.arrayBuffer();
    const login = await fetch(`${origin}/gcsp/access`, { method: 'POST', redirect: 'manual',
      body: new URLSearchParams({ key: 'test-hosted-image-gate', next: '/gcsp-account.html' }) });
    assert.equal(login.status, 303); await login.arrayBuffer();
    const cookie = login.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
    const shown = await fetch(origin + path, { headers: { Cookie: cookie } });
    assert.equal(shown.status, 200); assert.equal(shown.headers.get('content-type'), 'image/webp');
    assert.equal(createHash('sha256').update(Buffer.from(await shown.arrayBuffer())).digest('hex'), image.sha256);
    const retained = await fetch(`${origin}/${image.asset}`);
    assert.equal(retained.status, 200); assert.equal(retained.headers.get('content-type'), 'image/webp');
    assert.equal(createHash('sha256').update(Buffer.from(await retained.arrayBuffer())).digest('hex'), image.sha256);
  } finally {
    if (previous === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = previous;
    server.closeAllConnections(); await new Promise(done => server.close(done)); api.closeAllConnections();
  }
});
