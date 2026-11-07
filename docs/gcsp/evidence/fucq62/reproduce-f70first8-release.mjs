// Actual retained sources only. Run through the declared resource supervisor.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { indexJsonl } from '../../../../server/gcsp/vehicle-evidence/indexed-jsonl.js';
import { canonicalContent, validateCorpusDirectory } from '../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createPolicyService } from '../../../../server/gcsp/policy/index.js';
import { installFleetOfflineGuard } from '../../../../scripts/gcsp/fleet-offline-guard.mjs';
import { verifyActiveFleet } from '../../../../scripts/gcsp/verify-fleet.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const plan = JSON.parse(await readFile(new URL('./f70first8-release-plan.json', import.meta.url), 'utf8'));
assert.deepEqual(process.argv.slice(2, 3), ['--receipt']);
const preparationOnly = process.argv[4] === '--prepare-only';
const receiptPath = process.argv[3]; assert.ok(receiptPath?.startsWith('/Users/usget/Claude/vehicle-matcher/.claude/'));
const scratch = process.env.TMPDIR;
assert.ok(scratch === plan.scratchRoot || scratch?.startsWith(plan.scratchRoot + '/'));
const hashFile = async (path) => { const hash = createHash('sha256'); for await (const bytes of createReadStream(path)) hash.update(bytes); return hash.digest('hex'); };
const options = { indexed: true, policyService: createPolicyService(),
  policyRead: { runId: plan.runId, asOf: '2026-11-07T00:00:00.000Z', policyVersion: 'gcsp-policy-v1' } };
const guard = installFleetOfflineGuard(); const control = guard.control();
const store = join(root, plan.publicationStore);
const pointer = JSON.parse(await readFile(join(store, 'active.json'), 'utf8'));
assert.deepEqual(pointer.selected, plan.previousActive);
const previous = join(store, 'versions', pointer.selected.directory);
const oldVersions = {};
for (const version of await readdir(join(store, 'versions'))) for (const file of await readdir(join(store, 'versions', version))) {
  const path = join('versions', version, file); oldVersions[path] = await hashFile(join(store, path));
}
const inputs = []; const accepted = new Set(); let total = 0;
for (const input of plan.files) {
  const indexed = await indexJsonl(join(root, input.path), { key: (row) => row.configurationId,
    onRow(row) {
      assert.equal(row.admission, true); assert.equal(row.sourceKind, 'dated-snapshot');
      assert.equal(row.catalogue.schemaVersion, '2'); assert.equal(accepted.has(row.configurationId), false);
      accepted.add(row.configurationId); total++;
    } });
  assert.equal(indexed.checksum, input.sha256); assert.equal(indexed.length, input.records);
  assert.equal((await stat(join(root, input.path))).size, input.bytes); inputs.push({ ...input, indexed });
}
assert.equal(total, 8); assert.equal(accepted.size, 8);
const additions = inputs;
assert.equal(await hashFile(join(root, plan.registeredNovel.path)), plan.registeredNovel.sha256);
assert.equal((await stat(join(root, plan.registeredNovel.path))).size, plan.registeredNovel.bytes);
const old = await validateCorpusDirectory(previous, options); assert.equal(old.status, 'ok', JSON.stringify(old));
const oldRows = new Map([...old.corpus.configurations.metadataEntries()].map((entry) => [entry.key, entry.recordDigest]));
const oldVinBytes = await readFile(join(previous, 'vins.jsonl'));
assert.equal(oldRows.size, 342);
assert.equal(old.manifest.counts.sourceConfigurations, 341);

const fields = ['model', 'derivative', 'generation', 'body', 'powertrain', 'drive', 'transmission', 'engineCode',
  'agModelCode', 'vgModelCode', 'market', 'region', 'steering', 'modelYear', 'productionEra', 'productionDate', 'plant'];
const configurationsFile = join(scratch, 'configurations-input.jsonl'); const rows = await open(configurationsFile, 'wx', 0o600);
try {
  for (const entry of additions) for (const record of entry.indexed) {
    assert.equal(oldRows.has(record.configurationId), false);
    const c = record.catalogue; const b = c.sourceBinding;
    const configuration = Object.fromEntries(fields.map((field) => [field, null]));
    Object.assign(configuration, { model: b.optionalFacts.modelName.value, generation: b.confirmedContext.rawModelRange.value,
      agModelCode: b.canonicalIdentity.agModelCode, vgModelCode: b.canonicalIdentity.vgModelCode, market: b.requestScope.market });
    const projected = { configurationId: record.configurationId, snapshotVersion: c.snapshotVersion,
      canonicalIdentity: { ...b.canonicalIdentity, provenance: c.identityProvenance }, configuration,
      sourceContext: { sourceRefs: [...new Set(b.evidence.map((e) => e.request.url))].sort(), observedDate: c.observedDate,
        catalogueDate: c.observedDate, confidence: 'Complete source factory selection; physical build unknown',
        unresolvedFacts: fields.filter((field) => configuration[field] === null), sourceKind: 'dated-snapshot',
        selectedOptionCompleteness: c.completeness.factorySelection }, catalogue: c, imageIds: [] };
    await rows.writeFile(canonicalContent(projected));
  }
  await rows.sync();
} finally { await rows.close(); }
const metadata = { ...structuredClone(old.manifest), version: plan.version };
for (const field of ['signaturePolicy', 'qualification', 'counts', 'coverage', 'completeness', 'checksums']) delete metadata[field];
for (const context of metadata.sourceContexts) if (context.observedDate === '2026-11-07' && context.market === 'GB') {
  context.note = '349 actual admitted v2 factory selections; physical build, technical measurements, imagery and scheme model breadth remain unknown';
}
const inputPath = join(scratch, 'input.json'); const candidate = join(scratch, 'candidate');
await writeFile(inputPath, JSON.stringify({ metadata, retainedCorpusDirectory: previous, configurationsFile, images: [] }) + '\n');
const preload = join(scratch, 'offline-preload.mjs');
await writeFile(preload, `import {writeFileSync} from 'node:fs';
import {installFleetOfflineGuard} from ${JSON.stringify(new URL('../../../../scripts/gcsp/fleet-offline-guard.mjs', import.meta.url).href)};
const guard=installFleetOfflineGuard();const control=guard.control();
process.on('exit',()=>writeFileSync(process.env.F62_GUARD_RECEIPT,JSON.stringify({externalCalls:guard.calls.length,control})+'\\n'));
`);
const cli = join(root, 'server/scripts/publish-synthetic-vin-dataset.mjs');
const common = ['--run-id', plan.runId, '--as-of', options.policyRead.asOf, '--policy-version', 'gcsp-policy-v1'];
const steps = []; let childExternalCalls = 0;
async function command(name, args) {
  const guardReceipt = join(scratch, `${name}-egress.json`); const start = performance.now();
  const { stdout } = await run(process.execPath, ['--max-old-space-size=256', '--import', preload, cli, ...args, ...common],
    { cwd: root, maxBuffer: 1024 * 1024, env: { ...process.env, F62_GUARD_RECEIPT: guardReceipt } });
  const result = JSON.parse(stdout); const egress = JSON.parse(await readFile(guardReceipt, 'utf8'));
  assert.equal(egress.control, 'blocked'); assert.equal(egress.externalCalls, 0); childExternalCalls += egress.externalCalls;
  steps.push({ name, status: result.status, idempotent: result.idempotent ?? null, wallMs: performance.now() - start, egress });
  assert.equal(result.status, 'ok', JSON.stringify(result)); return result;
}
let directExternalCalls;
try {
  const prepared = await command('prepare', ['prepare', '--input', inputPath, '--artifacts', candidate]);
  assert.equal(prepared.manifest.counts.configurations, 350);
  assert.equal(prepared.manifest.counts.qualifyingCompleteDistinctSourceConfigurations, 349);
  const ownership = JSON.parse(await readFile(process.env.F62_RETAINED_OWNERSHIP, 'utf8'));
  ownership.newVersionDirectory = join(store, 'versions', await hashFile(join(candidate, 'manifest.json')));
  await writeFile(process.env.F62_RETAINED_OWNERSHIP, JSON.stringify(ownership, null, 2) + '\n');
  if (preparationOnly) {
    await command('preparation-validate', ['validate', '--artifacts', candidate]);
    assert.deepEqual(prepared.manifest.counts, plan.expected);
    assert.deepEqual(JSON.parse(await readFile(join(store, 'active.json'), 'utf8')).selected, plan.previousActive);
    for (const [path, digest] of Object.entries(oldVersions)) assert.equal(await hashFile(join(store, path)), digest);
    assert.equal(guard.calls.length + childExternalCalls, 0);
    await writeFile(receiptPath, JSON.stringify({ status: 'prepared-only-active-unchanged', version: plan.version,
      counts: prepared.manifest.counts, newSourceRows: 8, sourceInputFilesUnchanged: true,
      oldVersionFilesRehashedUnchanged: Object.keys(oldVersions).length, previousActive: pointer.selected,
      candidateManifestDigest: await hashFile(join(candidate, 'manifest.json')), steps,
      egress: { externalCalls: guard.calls.length + childExternalCalls, control }, publicationExecuted: false, acceptance: false }, null, 2) + '\n');
  } else {
  const published = await command('publish', ['publish', '--artifacts', candidate, '--store', store]);
  await command('validate', ['validate', '--artifacts', candidate]);
  await command('fresh-process-load', ['load', '--store', store]);
  const repeated = await command('idempotent-publish', ['publish', '--artifacts', candidate, '--store', store]);
  assert.equal(repeated.idempotent, true);
  const active = join(store, 'versions', published.active.manifestDigest);
  const validated = await validateCorpusDirectory(active, options); assert.equal(validated.status, 'ok');
  assert.deepEqual(validated.manifest.counts, { configurations: 350, distinctConfigurations: 350,
    vinMappings: 1, images: 0, sourceConfigurations: 349, qualifyingCompleteDistinctSourceConfigurations: 349 });
  assert.deepEqual(await readFile(join(active, 'vins.jsonl')), oldVinBytes);
  for (const [id, digest] of oldRows) assert.equal(validated.corpus.configurations.metadata(id).recordDigest, digest);
  const registry = createSyntheticRegistry({ root: store, ...options }); let start = performance.now();
  assert.equal((await registry.load()).status, 'ok'); const coldLoadMs = performance.now() - start;
  const lookupRuns = [];
  for (const name of ['first-pass', 'repeated-pass']) {
    start = performance.now(); let read = 0;
    for (const entry of validated.corpus.configurations.metadataEntries()) {
      assert.ok(registry.getConfiguration(entry.key).record); read++;
    }
    for (const entry of validated.corpus.vins.metadataEntries()) assert.equal(registry.getVin(entry.vin17).vehicle.vin17, entry.vin17);
    lookupRuns.push({ name, configurations: read, vinMappings: 1, totalMs: performance.now() - start });
  }
  for (const input of plan.files) assert.equal(await hashFile(join(root, input.path)), input.sha256);
  for (const [path, digest] of Object.entries(oldVersions)) assert.equal(await hashFile(join(store, path)), digest);
  directExternalCalls = guard.calls.length; assert.equal(directExternalCalls, 0);
  const receipt = { status: 'published-actual-partial', output: plan.publicationStore, version: plan.version,
    manifestDigest: published.active.manifestDigest, counts: validated.manifest.counts, acceptedSourceConfigurations: 349,
    continuationRowsAdded: 8, retainedConfigurationRowsUnchanged: oldRows.size, source1V1CollisionPreserved: true,
    previousVersion: pointer.selected, oldVersionFilesRehashedUnchanged: Object.keys(oldVersions).length,
    previousVinBytesIdentical: true, newVinAllocations: 0, sourceRequests: 0, f60EnrichmentExecuted: false,
    registeredNovel: plan.registeredNovel, sourceInputFilesRehashedUnchanged: plan.files.length,
    sourceInputBytes: plan.files.reduce((sum, entry) => sum + entry.bytes, 0), steps,
    measured: { node: process.version, platform: process.platform, arch: process.arch,
      configurationBytes: (await stat(join(active, 'configurations.jsonl'))).size, coldLoadMs, lookupRuns },
    egress: { externalCalls: directExternalCalls + childExternalCalls, control },
    streamingLimitBytes: 64 * 1024 * 1024, acceptance: 'not-established', limitations: plan.limitations };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
} finally { guard.restore(); }
// The verifier installs its own scoped guard and exercises every retained record.
if (!preparationOnly) {
const audit = await verifyActiveFleet({ root: store, ...options, requiredDistinct: 200, offline: true,
  http: true, endpoint: 'http://127.0.0.1:0', concurrency: 1, sampleSize: 351 });
await writeFile(join(receiptPath, '..', 'active-audit.json'), JSON.stringify(audit, null, 2) + '\n');
assert.equal(audit.status, 'verified-active', JSON.stringify(audit)); assert.equal(audit.actual.completeResolvedDistinct, 349);
assert.equal(audit.audit.checked, 351); assert.equal(audit.audit.errors, 0);
assert.equal(audit.http.requests, 351); assert.equal(audit.http.errors, 0); assert.equal(audit.http.serverClosed, true);
assert.equal(audit.egress.externalCalls, 0); assert.equal(audit.egress.sourceCalls, 0);
assert.deepEqual((await readdir(store)).filter((name) => name.startsWith('.stage-') || name.startsWith('.publisher-') || name.startsWith('.write-')), []);
process.stdout.write(JSON.stringify({ status: 'published-actual-partial', accepted: 349,
  configurations: 350, vinMappings: 1, httpRequests: 351, receipt: receiptPath }) + '\n');
}
