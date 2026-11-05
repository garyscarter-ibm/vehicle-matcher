import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildServer } from '../index.js';
import { createLocalVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { createConfiguredVehicleDetails } from '../gcsp/vehicle-evidence/application-vehicle-details.js';
import { vehicleEvidenceFailure, vehicleEvidenceHttpStatus } from '../gcsp/vehicle-evidence/vehicle-details-contract.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { inputDigest, ok } from '../gcsp/repository/core.js';

// Historical filename retained from the story. The application uses the port in process (Q7).
const data = JSON.parse(await readFile(new URL('./fixtures/gcsp/vehicle-evidence/alternate-provider.json', import.meta.url)));
const context = data.context;
const [vin] = (await readFile(new URL('../data/gcsp/vehicle-evidence/publication-reference.v1/vins.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
const orderUuid = data.entries.find((entry) => entry.key.category === 'order').key.token;
const collections = { configuration: 'configurations', stock: 'stock', vin: 'vins' };
function get(base, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { headers }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; });
      res.on('error', reject); res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body), headers: res.headers }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(3000, () => req.destroy(new Error('Ephemeral HTTP deadline')));
    req.on('error', reject); req.end();
  });
}
const route = (request) => `/api/gcsp/vehicle-evidence/${collections[request.kind]}/${encodeURIComponent(request.id)}`;
async function setup(t, replacement) {
  const repository = createMemoryRepository({ store: createMemoryStore() }); await repository.open();
  t.after(() => repository.close());
  const stock = { runId: context.runId, orderUuid, orderNumber: '0000123', configurationId: vin.configurationId,
    facts: { syntheticIdentity: { identityKind: 'synthetic', vehicleId: 'fictional-stock-car', originatingDatasetId: 'consumer-fixture',
      snapshotVersion: vin.snapshotVersion, configurationHash: vin.configurationHash } } };
  assert.equal((await repository.transaction(context, { commandId: 'consumer-http-seed', inputDigest: inputDigest(stock) }, async (tx) => {
    const run = await tx.insert('runs', { runId: context.runId, environmentId: context.environmentId, status: 'active', current: true });
    if (run.status !== 'ok') return run;
    const inserted = await tx.insert('stock', stock); return inserted.status === 'ok' ? ok(true) : inserted;
  })).status, 'ok');
  const lookup = replacement || createLocalVehicleEvidenceLookup({ repository, asOf: '2026-11-05T00:00:00.000Z' });
  let external = 0; const forbidden = async () => { external++; throw new Error('Unexpected outbound call'); };
  const server = buildServer({ fetchRetailerStock: forbidden, fetchNearbyStock: forbidden, enrichColours: forbidden,
    fetchDealerDirectory: forbidden, geocodePostcode: forbidden,
    gcspVehicleEvidence: { lookup, resolveContext: async () => ok(context) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { lookup, consumer: createConfiguredVehicleDetails({ lookup, identityLookup: { classifyRequest: async (request) => {
      const card = data.entries.find((e) => e.document.card.query.kind === request.kind && e.document.card.query.id === request.id)?.document.card;
      return card ? { status: 'ok', identityKind: 'synthetic', liveEligible: false, configurationId: card.identifiers.composition,
        ...(card.identifiers.subject ? { vehicleId: card.identifiers.subject } : {}) } : { status: 'not-found', identityKind: 'unknown', liveEligible: false };
    } } }), base: `http://127.0.0.1:${server.address().port}`,
    external: () => external };
}

test('actual ephemeral FUCQ-55 HTTP route equals the same-process port and application facts for configuration, stock and current VIN', async (t) => {
  const f = await setup(t);
  for (const entry of data.entries) {
    const request = entry.document.card.query;
    const direct = await f.lookup.resolve(request, { context });
    const response = await get(f.base, route(request));
    assert.equal(response.status, vehicleEvidenceHttpStatus(direct)); assert.deepEqual(response.body, direct);
    assert.equal(response.headers['cache-control'], 'no-store');
    const consumed = await f.consumer.resolve(request, { context });
    assert.equal(consumed.status, direct.status);
    assert.deepEqual(consumed.vehicle, Object.fromEntries(Object.keys(consumed.vehicle).map((key) => [key, response.body[key]])));
    assert.equal(consumed.transport.protocol, 'in-process'); assert.equal(consumed.transport.status, null);
    assert.equal(consumed.vehicle.identity.vin, request.kind === 'vin' ? vin.vin17 : null);
  }
  assert.equal(f.external(), 0);
});

test('actual HTTP failures preserve the port outcome and usable action without substituted facts', async (t) => {
  const f = await setup(t);
  for (const request of [{ kind: 'vin', id: 'invalid' }, { kind: 'vin', id: 'ZZZZZZZZ0ZZ000000' },
    { kind: 'configuration', id: Buffer.from('UNKNOWN:CODE').toString('base64') },
    { kind: 'stock', id: '6ff0feca-90cd-4e6f-903c-41fad1ef9b91' }]) {
    const direct = await f.lookup.resolve(request, { context }); const response = await get(f.base, route(request));
    assert.equal(response.status, vehicleEvidenceHttpStatus(direct)); assert.deepEqual(response.body, direct);
    assert.equal(response.body.identity, null); assert.ok(response.body.failure.action);
    assert.equal((await f.consumer.resolve(request, { context })).status, direct.status);
  }
  for (const status of ['unsupported', 'source-unavailable', 'identity-mismatch']) {
    const port = { resolve: () => vehicleEvidenceFailure(status, 'vin') }; const alternative = await setup(t, port);
    const request = { kind: 'vin', id: vin.vin17 };
    const response = await get(alternative.base, route(request));
    assert.equal(response.status, vehicleEvidenceHttpStatus({ status })); assert.deepEqual(response.body, port.resolve());
    assert.equal((await alternative.consumer.resolve(request)).status, status);
    assert.equal(alternative.external(), 0);
  }
  assert.equal(f.external(), 0);
});

test('the real shared HTTP gate, raw canonical routing and trusted stock context remain in force', async (t) => {
  const previous = process.env.DEMO_ACCESS_KEY; process.env.DEMO_ACCESS_KEY = 'fictional-consumer-parity-gate';
  t.after(() => { if (previous === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = previous; });
  const f = await setup(t); const headers = { 'X-Access-Key': process.env.DEMO_ACCESS_KEY };
  const request = { kind: 'vin', id: vin.vin17 };
  assert.equal((await get(f.base, route(request))).status, 401);
  const normalised = { kind: 'vin', id: ` ${vin.vin17.toLowerCase()} ` };
  assert.deepEqual((await get(f.base, route(normalised), headers)).body, await f.lookup.resolve(normalised));
  const stock = { kind: 'stock', id: orderUuid };
  assert.deepEqual((await get(f.base, route(stock), headers)).body, await f.lookup.resolve(stock, { context }));
  assert.equal((await get(f.base, `${route(stock)}?runId=another&provider=live`, headers)).status, 400);
  assert.equal((await get(f.base, '/api/gcsp/vehicle-evidence/configurations/A%2FB%2BC%3D', headers)).status, 400);
  for (const entry of data.entries.filter((e) => e.key.category === 'composition')) {
    assert.equal((await get(f.base, route(entry.document.card.query), headers)).status, 200);
  }
  assert.equal(f.external(), 0);
});
