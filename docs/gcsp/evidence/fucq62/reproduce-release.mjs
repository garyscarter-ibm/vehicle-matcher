// Reproduce the bounded release through F54's existing publisher CLI. No HTTP.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const data = join(root, 'server/data/gcsp/vehicle-evidence');
const output = resolve(process.argv[2] || join(data, 'fleet-source.v1'));
const scratch = process.env.TMPDIR;
assert.ok(scratch === '/tmp/vehicle-matcher-f58-63-20261106/f62-publisher'
  || scratch?.startsWith('/tmp/vehicle-matcher-f58-63-20261106/f62-publisher/'));
const previousStore = join(data, 'lookup-reference.v1');
const pointer = JSON.parse(await readFile(join(previousStore, 'active.json'), 'utf8'));
const previous = join(previousStore, 'versions', pointer.selected.directory);
const oldManifest = JSON.parse(await readFile(join(previous, 'manifest.json'), 'utf8'));
const source = join(data, 'registered-sources/batch32-2026-11-07.jsonl');
const records = (await readFile(source, 'utf8')).trim().split('\n').map(JSON.parse);
const fields = ['model', 'derivative', 'generation', 'body', 'powertrain', 'drive', 'transmission', 'engineCode',
  'agModelCode', 'vgModelCode', 'market', 'region', 'steering', 'modelYear', 'productionEra', 'productionDate', 'plant'];
const configurations = records.map((record) => {
  assert.equal(record.admission, true);
  const c = record.catalogue; const b = c.sourceBinding;
  const configuration = Object.fromEntries(fields.map((field) => [field, null]));
  Object.assign(configuration, { model: b.optionalFacts.modelName.value, generation: b.confirmedContext.rawModelRange.value,
    agModelCode: b.canonicalIdentity.agModelCode, vgModelCode: b.canonicalIdentity.vgModelCode, market: b.requestScope.market });
  return { configurationId: record.configurationId, snapshotVersion: c.snapshotVersion,
    canonicalIdentity: { ...b.canonicalIdentity, provenance: c.identityProvenance }, configuration,
    sourceContext: { sourceRefs: [...new Set(b.evidence.map((e) => e.request.url))].sort(), observedDate: c.observedDate,
      catalogueDate: c.observedDate, confidence: 'Complete source factory selection; physical build unknown',
      unresolvedFacts: fields.filter((field) => configuration[field] === null), sourceKind: 'dated-snapshot', selectedOptionCompleteness: c.completeness.factorySelection },
    catalogue: c, imageIds: [] };
});
const metadata = { datasetId: 'gcsp-source-fleet', version: '2026-11-07.1', schemaVersion: oldManifest.schemaVersion,
  profileRegistryVersion: oldManifest.profileRegistryVersion, generatorVersion: oldManifest.generatorVersion,
  seed: { value: 'retained-synthetic-identities-no-new-allocation', kind: 'synthetic' },
  sourceContexts: [...oldManifest.sourceContexts, { sourceKind: 'dated-snapshot', observedDate: '2026-11-07',
    catalogueDate: '2026-11-07', market: 'GB', steering: null, note: '28 actual admitted source selections; physical build, technical values and images remain unknown' }] };
const input = join(scratch, 'input.json'); const candidate = join(scratch, 'candidate');
await writeFile(input, JSON.stringify({ metadata, retainedCorpusDirectory: previous, configurations, images: [] }) + '\n');
const cli = join(root, 'server/scripts/publish-synthetic-vin-dataset.mjs');
const common = ['--run-id', 'f62-source-publication-20261107', '--as-of', '2026-11-07T00:00:00.000Z', '--policy-version', 'gcsp-policy-v1'];
const command = async (args) => {
  const { stdout } = await run(process.execPath, [cli, ...args, ...common], { cwd: root, maxBuffer: 1024 * 1024, env: process.env });
  return JSON.parse(stdout);
};
const prepared = await command(['prepare', '--input', input, '--artifacts', candidate]);
assert.equal(prepared.status, 'ok');
await mkdir(resolve(output, '..'), { recursive: true });
await cp(previousStore, output, { recursive: true, force: false, errorOnExist: true });
const published = await command(['publish', '--artifacts', candidate, '--store', output]);
const validated = await command(['validate', '--artifacts', candidate]);
const reopened = await command(['load', '--store', output]);
const idempotent = await command(['publish', '--artifacts', candidate, '--store', output]);
assert.equal(published.status, 'ok'); assert.equal(reopened.status, 'ok'); assert.equal(idempotent.idempotent, true);
const active = join(output, 'versions', published.active.manifestDigest);
assert.equal(await readFile(join(active, 'vins.jsonl'), 'utf8'), await readFile(join(previous, 'vins.jsonl'), 'utf8'));
const serializedBytes = Buffer.byteLength(await readFile(join(active, 'configurations.jsonl'), 'utf8'));
const receipt = { status: 'published-partial', output: 'server/data/gcsp/vehicle-evidence/fleet-source.v1',
  manifestDigest: validated.manifestDigest, counts: prepared.manifest.counts,
  sourceRowsAdded: records.length, newVinAllocations: 0, sourceRequests: 0,
  directProjection: true, f60EnrichmentExecuted: false, previousVersion: pointer.selected,
  idempotent: idempotent.idempotent, freshProcessLoad: reopened.status, previousVinBytesIdentical: true,
  serializedConfigurationBytes: serializedBytes, serializedBytesPerRow: serializedBytes / prepared.manifest.counts.configurations,
  forecast10000ConfigurationBytes: Math.ceil(serializedBytes / prepared.manifest.counts.configurations * 10000),
  loaderPerFileLimitBytes: 64 * 1024 * 1024,
  limitations: ['29 complete distinct source configurations; 200 and 10000 targets remain unmet',
    'One model code T5MJ only; full scheme model coverage not established',
    'No new VINs, stock, image assets or physical build facts',
    'Forecast is serialized data only; runtime peak must be measured before increasing bounds'] };
await writeFile(new URL('./publication-receipt.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify(receipt) + '\n');
