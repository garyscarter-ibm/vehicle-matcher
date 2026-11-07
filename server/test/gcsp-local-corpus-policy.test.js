import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { buildServer } from '../index.js';
import { createLocalVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { writeCorpusCandidate } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { sourceBackedInput, options } from './helpers/vin-corpus-fixture.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'local-corpus-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = await sourceBackedInput(); const candidate = join(root, 'candidate'); const store = join(root, 'store');
  assert.equal((await writeCorpusCandidate(candidate, input, options)).status, 'ok');
  assert.equal((await createSyntheticRegistry({ root: store, ...options }).publish(candidate)).status, 'ok');
  return { store, configurationId: input.configurations[0].configurationId };
}

function blockExternal(t) {
  const original = process.env.GCSP_DATABASE_URL;
  process.env.GCSP_DATABASE_URL = 'postgresql://offline-test@policy-network.invalid/offline-test';
  t.after(() => { if (original === undefined) delete process.env.GCSP_DATABASE_URL; else process.env.GCSP_DATABASE_URL = original; });
  let attempts = 0;
  const denied = () => { attempts++; throw new Error('External transport forbidden in local corpus lookup'); };
  const connect = net.Socket.prototype.connect;
  t.mock.method(net.Socket.prototype, 'connect', function (...args) {
    const value = args[0]; const target = Array.isArray(value) ? value[0] : value;
    if (target?.host === '127.0.0.1' || target?.hostname === '127.0.0.1') return connect.apply(this, args);
    return denied();
  });
  t.mock.method(https, 'request', denied); t.mock.method(https, 'get', denied);
  t.mock.method(globalThis, 'fetch', denied);
  return () => attempts;
}

test('default immutable local lookup ignores host database selection and retains the canonical policy pin', async (t) => {
  const f = await fixture(t); const attempts = blockExternal(t);
  const lookup = createLocalVehicleEvidenceLookup({ root: f.store, asOf: options.policyRead.asOf });
  const result = await lookup.resolve({ kind: 'configuration', id: f.configurationId });
  assert.equal(result.status, 'complete', JSON.stringify(result));
  assert.equal(result.resolved.configurationId, f.configurationId);
  assert.equal(attempts(), 0);
});

test('actual server default corpus HTTP path stays offline with a host database setting', async (t) => {
  const f = await fixture(t); const attempts = blockExternal(t);
  const server = buildServer({ gcspVehicleEvidence: { root: f.store } });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const result = await new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: server.address().port,
      path: `/api/gcsp/vehicle-evidence/configurations/${encodeURIComponent(f.configurationId)}` }, (response) => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (part) => { body += part; });
      response.on('end', () => resolve({ code: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject); request.setTimeout(2000, () => request.destroy(new Error('Local HTTP timeout')));
  });
  assert.equal(result.code, 200, JSON.stringify(result)); assert.equal(result.body.status, 'complete');
  assert.equal(result.body.resolved.configurationId, f.configurationId); assert.equal(attempts(), 0);
});

test('explicit injected policy remains authoritative and an unavailable signature policy refuses the corpus', async (t) => {
  const f = await fixture(t); const attempts = blockExternal(t); const reads = [];
  const policyService = { async getAssumption(key, read) { reads.push({ key, read }); return { status: 'unavailable' }; } };
  const lookup = createLocalVehicleEvidenceLookup({ root: f.store, policyService, asOf: options.policyRead.asOf });
  assert.equal((await lookup.resolve({ kind: 'configuration', id: f.configurationId })).status, 'source-unavailable');
  assert.equal(reads.length, 4); assert.ok(reads.every(({ read }) => read.policyVersion === 'gcsp-policy-v1'));
  assert.equal(attempts(), 0);
});
