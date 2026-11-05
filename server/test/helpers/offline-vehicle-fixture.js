import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { buildServer } from '../../index.js';
import { PolicyService } from '../../gcsp/policy/index.js';
import { createDemoRuntime } from '../../gcsp/clock/index.js';
import { createMemoryRepository, createMemoryStore, ok } from '../../gcsp/repository/index.js';
import { createSyntheticRegistry } from '../../gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../../gcsp/vehicle-evidence/vehicle-lookup.js';
import { writeCorpusCandidate, validateCorpusDirectory } from '../../gcsp/vehicle-evidence/corpus-publisher.js';
import { corpusInput, sourceBackedInput, options } from './vin-corpus-fixture.js';

export const unknownVin = 'ZZZZZZZZ0ZZ000000';
export const route = ({ kind, id }) => `/api/gcsp/vehicle-evidence/${{ configuration: 'configurations', stock: 'stock', vin: 'vins' }[kind]}/${encodeURIComponent(id)}`;
export function get(base, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { headers }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (part) => { text += part; });
      res.on('error', reject); res.on('end', () => {
        try { resolve({ code: res.statusCode, body: JSON.parse(text), headers: res.headers }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(3000, () => req.destroy(new Error('Offline fixture HTTP deadline')));
    req.on('error', reject); req.end();
  });
}

/** Actual FUCQ53 allocation -> immutable candidate -> publication -> independent load.
 * The injected scenario is a test fixture, never a production policy alteration. */
export async function offlineFixture(t, { runtime = true, imageContracts = false } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'fucq57-fixture-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const input = await corpusInput({ count: 5, datasetId: 'fucq57-five-wmi' });
  const gb = await sourceBackedInput();
  input.configurations.push(...gb.configurations);
  input.metadata.sourceContexts.push(...gb.metadata.sourceContexts);
  if (imageContracts) {
    input.images = ['representative-model', 'representative-configuration'].map((role, i) => ({ imageId: `fictional-image-contract-${i}`,
      configurationId: input.configurations[i].configurationId, asset: `fixture-only/no-runtime-asset-${i}.webp`,
      role, fidelity: role, sourceKind: 'dated-snapshot', observedDate: '2026-11-01' }));
    for (const image of input.images) input.configurations.find((row) => row.configurationId === image.configurationId).imageIds.push(image.imageId);
  }
  const fixtureOptions = { ...options, approvedImages: input.images };
  const candidate = join(scratch, 'candidate'); const root = join(scratch, 'store');
  const written = await writeCorpusCandidate(candidate, input, fixtureOptions);
  assert.equal(written.status, 'ok', JSON.stringify(written));
  const checked = await validateCorpusDirectory(candidate, fixtureOptions);
  assert.equal(checked.status, 'ok');
  const writer = createSyntheticRegistry({ root, ...fixtureOptions });
  assert.equal((await writer.publish(candidate)).status, 'ok');
  const registry = createSyntheticRegistry({ root, ...fixtureOptions });
  assert.equal((await registry.load()).status, 'ok');
  const receipt = { counts: checked.manifest.counts, coverage: checked.manifest.coverage,
    completeness: checked.manifest.completeness, qualification: checked.manifest.qualification,
    manifestDigest: checked.manifestDigest, checksums: checked.manifest.checksums,
    referenceBodyClasses: input.configurations.slice(0, 5).reduce((out, row) => ({ ...out, [row.configuration.body]: (out[row.configuration.body] || 0) + 1 }), {}),
    vinUsage: { 'current-car': checked.corpus.vins.length }, imageContractsOnly: imageContracts };
  const f = { scratch, candidate, root, input, registry, checked, receipt,
    vins: checked.corpus.vins, configurations: checked.corpus.configurations };
  if (!runtime) return f;
  const seed = JSON.parse(await readFile(new URL('../../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const scenario = seed.assumptions.find((row) => row.key === 'clock.scenario.v1').value;
  scenario.datasetId = input.metadata.datasetId;
  scenario.corpusVersion = 'reference-corpus.v1';
  scenario.vehicles = input.configurations.slice(0, 5).map((row, i) => ({ vehicleId: `offline-stock-${i + 1}`,
    configurationId: row.configurationId, snapshotVersion: row.snapshotVersion,
    configuration: row.configuration, usage: 'stock' }));
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const repository = createMemoryRepository({ store: createMemoryStore() }); await repository.open();
  t.after(() => repository.close());
  const boot = await createDemoRuntime({ repository, policy, environmentId: 'fucq57-offline', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'fucq57-bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(boot.status, 'ok', JSON.stringify(boot));
  const session = await boot.value.identity.createPresenterSession('fucq57-presenter');
  assert.equal(session.status, 'ok');
  const context = session.value.context;
  const stock = (await repository.query(context, 'stock')).value;
  assert.equal(stock.length, 5);
  return { ...f, ...boot.value, policy, repository, context, stock,
    lookup: createVehicleEvidenceLookup({ registry, repository }) };
}

export async function listenFixture(t, f, forbidden) {
  const server = buildServer({ fetchRetailerStock: forbidden, fetchNearbyStock: forbidden, enrichColours: forbidden,
    fetchDealerDirectory: forbidden, geocodePostcode: forbidden,
    gcspVehicleEvidence: { lookup: f.lookup, resolveContext: async () => ok(f.context) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

/** Explicitly fictional alternate wire format, populated from the tested local port. */
export function alternateDocument(w, context) {
  if (!['complete', 'partial'].includes(w.status)) return { edition: 'offline-cards/1',
    result: { 'not-found': 'missing', unsupported: 'unsupported', 'source-unavailable': 'unavailable',
      'identity-mismatch': 'mismatch', 'invalid-input': 'invalid' }[w.status] };
  const i = w.identity;
  return { edition: 'offline-cards/1', result: w.status, card: {
    query: w.requested, answer: w.resolved, scope: { run: context?.runId, environment: context?.environmentId },
    identifiers: { category: i.kind, flavour: i.identityKind, composition: i.configurationId, subject: i.vehicleId,
      collection: i.datasetId, origin: i.originatingDatasetId, order: i.orderUuid, displayOrder: i.orderNumber, chassis: i.vin, purpose: i.usage },
    revisions: w.versions, narrative: w.description,
    dimensions: Object.entries(w.technical).map(([name, { value, unit, definition, ...evidence }]) =>
      ({ name, reading: value, measure: unit, meaning: definition, ...evidence })),
    features: w.equipment, portraits: { knowledge: w.images.state, caption: w.images.label,
      pictures: w.images.items.map((x) => ({ reference: x.imageId, resource: x.asset, usage: x.role,
        accuracy: x.fidelity, origin: x.sourceKind, dated: x.observedDate, caption: x.label })) },
    evidence: w.source, coverage: w.completeness, labels: w.presentation,
  } };
}
