import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertImageParity } from './node-replay.mjs';

// Actual first presenter image observed in both engines in the retained e3a9664e0 run.
const asset = 'assets/gcsp-vehicle-evidence/972803f389c742c7ac6841d5e8e7209f82562039f8fa05f5806538c2eeb5a356.webp';
const catalogue = JSON.parse(readFileSync(new URL('../../../server/data/gcsp/vehicle-evidence/display-images.v1.json', import.meta.url)));
const registration = [...catalogue.configurations.map((row) => row.image), ...Object.values(catalogue.variants),
  ...Object.values(catalogue.models)].find((image) => image.asset === asset);
assert.ok(registration);
const image = (origin, route) => ({ actualUrl: origin + route, complete: true,
  naturalWidth: 1200, naturalHeight: 675, renderedWidth: 50, renderedHeight: 29, objectFit: 'cover',
  response: { status: 200, sha256: '972803f389c742c7ac6841d5e8e7209f82562039f8fa05f5806538c2eeb5a356',
    bytes: 41336, mime: 'image/webp' } });
const angular = image('https://gcsp-web.example.test:7548', `/${asset}`);
const nodeAsset = image('https://127.0.0.1:51642', `/${asset}`);
const retained = { dimensions: null, nodeRoute: 'retained-asset' };

test('default image API mode still requires the registered Node API route', () => {
  const node = image('https://127.0.0.1:51642', `/api/gcsp/vehicle-images/${registration.imageId}.webp`);
  assert.equal(assertImageParity(node, angular, { dimensions: null }).registration.asset, asset);
  assert.throws(() => assertImageParity(nodeAsset, angular, { dimensions: null }), /same reviewed image registration/);
});

test('explicit presenter mode maps the actual retained asset pair to one reviewed registration', () => {
  assert.equal(assertImageParity(nodeAsset, angular, retained).registration.asset, asset);
});

test('presenter mode refuses a different asset route', () => {
  assert.throws(() => assertImageParity({ ...nodeAsset, actualUrl: 'https://127.0.0.1:51642/assets/wrong.webp' },
    angular, retained), /same reviewed image registration/);
});

test('presenter mode refuses corrupted response bytes and natural dimensions', () => {
  for (const [changed, reason] of [[{ ...nodeAsset, response: { ...nodeAsset.response, sha256: '0'.repeat(64) } }, /Actual Node bytes/],
    [{ ...nodeAsset, response: { ...nodeAsset.response, bytes: 1 } }, /Actual Node byte count/],
    [{ ...nodeAsset, naturalWidth: 1 }, /Actual Node natural width/],
    [{ ...nodeAsset, naturalHeight: 1 }, /Actual Node natural height/]]) {
    assert.throws(() => assertImageParity(changed, angular, retained), reason);
  }
});
