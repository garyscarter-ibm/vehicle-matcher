import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../index.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/vehicle-lookup.js';
import { parseVehicleEvidencePath } from '../gcsp/vehicle-evidence/vehicle-evidence-handler.js';
import { options } from './helpers/vin-corpus-fixture.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';

const candidate = fileURLToPath(new URL('../data/gcsp/vehicle-evidence/publication-reference.v1', import.meta.url));
const context = { runId: 'http-lookup-run', environmentId: 'http-lookup-test', principalId: 'fictional-http-reader', roles: ['employee'] };
const orderUuid = '1d736acd-674c-4bb1-8b6b-45dc56906442';
function request(base, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method, headers }, (res) => {
      let data = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { data += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ code: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Local HTTP test request timed out')));
    req.on('error', reject); req.end();
  });
}
async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vehicle-http-')); t.after(() => rm(root, { recursive: true, force: true }));
  const registry = createSyntheticRegistry({ root, ...options });
  assert.equal((await registry.publish(candidate)).status, 'ok');
  const configurations = (await readFile(join(candidate, 'configurations.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const [vehicle] = (await readFile(join(candidate, 'vins.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const repository = createMemoryRepository({ store: createMemoryStore() }); await repository.open(); t.after(() => repository.close());
  const stock = { runId: context.runId, orderUuid, orderNumber: '0000123', configurationId: vehicle.configurationId,
    corpusVersion: vehicle.corpusVersion, facts: { syntheticIdentity: { vehicleId: 'fictional-exact-stock', identityKind: 'synthetic',
      originatingDatasetId: 'http-lookup-fixture', configurationHash: vehicle.configurationHash, snapshotVersion: vehicle.snapshotVersion } } };
  assert.equal((await repository.transaction(context, { commandId: 'http-seed', inputDigest: inputDigest(stock) }, async (tx) => {
    const run = await tx.insert('runs', { runId: context.runId, environmentId: context.environmentId, status: 'active', current: true });
    if (run.status !== 'ok') return run;
    const seeded = await tx.insert('stock', stock); return seeded.status === 'ok' ? ok(true) : seeded;
  })).status, 'ok');
  const lookup = createVehicleEvidenceLookup({ registry, repository });
  let external = 0;
  const forbidden = async () => { external++; throw new Error('External transport must remain unused'); };
  const server = buildServer({ fetchRetailerStock: forbidden, fetchNearbyStock: forbidden, enrichColours: forbidden,
    fetchDealerDirectory: forbidden, geocodePostcode: forbidden,
    gcspVehicleEvidence: { lookup, resolveContext: async () => ok(context) }, ...extra });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  return { server, lookup, registry, configurations, vehicle, base: `http://127.0.0.1:${server.address().port}`,
    externalCalls: () => external };
}

test('actual buildServer HTTP responses equal the in-process port for configuration, exact stock and current-car VIN', async (t) => {
  const f = await fixture(t);
  for (const [collection, kind, id] of [['configurations', 'configuration', f.vehicle.configurationId],
    ['stock', 'stock', orderUuid], ['vins', 'vin', f.vehicle.vin17]]) {
    const direct = await f.lookup.resolve({ kind, id }, { context });
    const response = await request(f.base, `/api/gcsp/vehicle-evidence/${collection}/${encodeURIComponent(id)}`);
    assert.equal(response.code, 200); assert.deepEqual(response.body, direct);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(f.externalCalls(), 0);
});

test('real HTTP validation applies VIN canonicalisation only to VINs and preserves canonical Base64 routing', async (t) => {
  const f = await fixture(t);
  const prefix = '/api/gcsp/vehicle-evidence';
  const vin = await request(f.base, `${prefix}/vins/${encodeURIComponent(` ${f.vehicle.vin17.toLowerCase()} `)}`);
  assert.equal(vin.code, 200); assert.equal(vin.body.identity.vin, f.vehicle.vin17);
  for (const path of [`${prefix}/vins/invalid`, `${prefix}/vins/%E0%A4%A`, `${prefix}/vins/%2520${f.vehicle.vin17}`,
    `${prefix}/vins/${f.vehicle.vin17}/extra`, `${prefix}/vins/`, `${prefix}/stock/0000123`,
    `${prefix}/stock/%20${orderUuid}`, `${prefix}/configurations/${encodeURIComponent(Buffer.from('T5MJ:S0337,P0300').toString('base64'))}`,
    `${prefix}/configurations/${encodeURIComponent(f.vehicle.configurationId.replace(/=+$/, ''))}`]) {
    assert.equal((await request(f.base, path)).code, 400, path);
  }
  const parsed = parseVehicleEvidencePath(`${prefix}/configurations/A%2FB%2BC%3D`);
  assert.equal(parsed.id, 'A/B+C=');
  assert.equal(parseVehicleEvidencePath(`${prefix}/configurations/A/B+C=`).status, 'invalid-input');
  assert.equal(f.externalCalls(), 0);
});

test('unknown VINs without an inferred US checksum/year, config IDs and stock UUIDs return 404; missing input returns 503', async (t) => {
  const f = await fixture(t);
  for (const [kind, id] of [['vins', 'ZZZZZZZZ0ZZ000000'], ['stock', '6ff0feca-90cd-4e6f-903c-41fad1ef9b91'],
    ['configurations', Buffer.from('UNKNOWN:CODE').toString('base64')]]) {
    const response = await request(f.base, `/api/gcsp/vehicle-evidence/${kind}/${encodeURIComponent(id)}`);
    assert.equal(response.code, 404); assert.equal(response.body.status, 'not-found'); assert.equal(response.body.requested.id, null);
  }
  const missing = await fixture(t, { gcspVehicleEvidence: { lookup: createVehicleEvidenceLookup() } });
  for (const [kind, id] of [['vins', f.vehicle.vin17], ['configurations', f.vehicle.configurationId], ['stock', orderUuid]]) {
    assert.equal((await request(missing.base, `/api/gcsp/vehicle-evidence/${kind}/${encodeURIComponent(id)}`)).code, 503);
  }
  assert.equal(f.externalCalls(), 0); assert.equal(missing.externalCalls(), 0);
});

test('configured gate, wrong methods, legacy and writable routes, origins and browser routing overrides are enforced', async (t) => {
  const previous = process.env.DEMO_ACCESS_KEY; process.env.DEMO_ACCESS_KEY = 'fictional-gate-for-lookup-tests';
  t.after(() => { if (previous === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = previous; });
  const f = await fixture(t);
  const path = `/api/gcsp/vehicle-evidence/vins/${f.vehicle.vin17}`;
  const headers = { Authorization: 'Bearer fictional-gate-for-lookup-tests' };
  assert.equal((await request(f.base, path)).code, 401);
  assert.equal((await request(f.base, path, { headers })).code, 200);
  assert.equal((await request(f.base, '/health')).code, 200);
  assert.equal((await request(f.base, '/api/questions')).code, 401);
  assert.equal((await request(f.base, '/api/questions', { headers })).code, 200);
  const wrong = await request(f.base, path, { method: 'POST', headers });
  assert.equal(wrong.code, 405); assert.equal(wrong.headers.allow, 'GET');
  for (const suffix of ['?provider=live', '?identityKind=real', '?dataset=other', '?runId=next-run']) {
    assert.equal((await request(f.base, `${path}${suffix}`, { headers })).code, 400);
  }
  for (const segment of ['synthetic-vins', 'publish', 'load', 'generate']) {
    assert.equal((await request(f.base, `/api/gcsp/vehicle-evidence/${segment}/${f.vehicle.vin17}`, { headers })).code, 404);
  }
  assert.equal((await request(f.base, path, { headers: { ...headers, Origin: 'https://untrusted.example' } })).code, 403);
  assert.equal(f.externalCalls(), 0);
});

test('HTTP complete/partial presentation preserves units, unknowns, source dates, image fidelity and actionable errors', async (t) => {
  const f = await fixture(t); const catalogue = f.configurations.find((r) => r.catalogue);
  const response = await request(f.base, `/api/gcsp/vehicle-evidence/configurations/${encodeURIComponent(catalogue.configurationId)}`);
  assert.equal(response.code, 200); assert.equal(response.body.status, 'complete');
  assert.equal(response.body.technical.luggageExpanded.unit, 'LITRES');
  assert.equal(response.body.technical.bodyLength.state, 'unknown');
  assert.equal(response.body.source.observedDate, '2026-11-01');
  assert.equal(response.body.source.catalogueValidity.effectDate, '2027-01-05');
  assert.equal(response.body.images.label, 'Images unavailable');
  assert.equal(response.body.presentation.syntheticLabel, 'Synthetic identity');
  for (const status of ['unsupported', 'identity-mismatch']) {
    const isolated = await fixture(t, { gcspVehicleEvidence: { lookup: createVehicleEvidenceLookup({ registry: {
      getVin: () => ({ status, failure: { message: 'untrusted source details' } }),
    } }) } });
    const failed = await request(isolated.base, `/api/gcsp/vehicle-evidence/vins/${f.vehicle.vin17}`);
    assert.equal(failed.code, status === 'unsupported' ? 422 : 409);
    assert.equal(failed.body.status, status); assert.equal(typeof failed.body.failure.action, 'string');
    assert.equal(JSON.stringify(failed.body).includes('untrusted source details'), false);
  }
  // The transport maps approved image evidence without loading remote assets or presenting it as an exact-car photo.
  const read = f.registry.getConfiguration(catalogue.configurationId);
  const illustrated = await fixture(t, { gcspVehicleEvidence: { lookup: createVehicleEvidenceLookup({ registry: {
    getConfiguration: () => ({ ...read, images: [{ imageId: 'approved-contract-fixture', configurationId: catalogue.configurationId,
      asset: '/approved-fixture.webp', role: 'representative-configuration', fidelity: 'representative-configuration',
      sourceKind: 'dated-snapshot', observedDate: '2026-11-01' }] }),
  } }) } });
  const image = await request(illustrated.base, `/api/gcsp/vehicle-evidence/configurations/${encodeURIComponent(catalogue.configurationId)}`);
  assert.equal(image.body.images.items[0].label, 'Representative configuration image');
  assert.equal(image.body.images.items[0].fidelity, 'representative-configuration');
  assert.equal(f.externalCalls(), 0);
});
