import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { buildServer } from '../index.js';
import { createGcspFront, REPO_ROOT } from '../gcsp/host.js';
import { modelDisplayImage } from '../gcsp/vehicle-evidence/display-images.js';
import { createLiveDisplayImageHandler } from '../gcsp/vehicle-evidence/live-display-images.js';

test('vehicle image delivery reaches the server-owned image adapter', async () => {
  let calls = 0;
  const image = Buffer.from('server-owned-image');
  const handler = async ({ res }) => { calls += 1; res.writeHead(200, { 'Content-Type': 'image/webp' }); res.end(image); return true; };
  const server = buildServer({ gcspVehicleImages: handler,
    gcspVehicleEvidence: { lookup: { resolve: async () => ({ status: 'unavailable' }) } } });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/gcsp/vehicle-images/bmw-display-${'a'.repeat(20)}.webp`;
    const allowed = await fetch(url);
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), image); assert.equal(calls, 1);
  } finally {
    server.closeAllConnections(); await new Promise(done => server.close(done));
  }
});

test('hosted browser images load with no key or custom header and retain fallback bytes', async () => {
  const image = await modelDisplayImage('G21 Touring|320i');
  assert.ok(image);
  const api = buildServer({ gcspVehicleImages: createLiveDisplayImageHandler({ fetchImpl: async () => { throw Error('source-unavailable'); } }),
    gcspVehicleEvidence: { lookup: { resolve: async () => ({ status: 'unavailable' }) } } });
  const server = createServer();
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    server.on('request', createGcspFront({ root: REPO_ROOT, api, origin }));
    const path = `/api/gcsp/vehicle-images/${image.imageId}.webp`;
    const shown = await fetch(origin + path);
    assert.equal(shown.status, 200); assert.equal(shown.headers.get('content-type'), 'image/webp');
    assert.equal(createHash('sha256').update(Buffer.from(await shown.arrayBuffer())).digest('hex'), image.sha256);
    const retained = await fetch(`${origin}/${image.asset}`);
    assert.equal(retained.status, 200); assert.equal(retained.headers.get('content-type'), 'image/webp');
    assert.equal(createHash('sha256').update(Buffer.from(await retained.arrayBuffer())).digest('hex'), image.sha256);
  } finally {
    server.closeAllConnections(); await new Promise(done => server.close(done)); api.closeAllConnections();
  }
});
