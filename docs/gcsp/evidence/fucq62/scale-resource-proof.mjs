// PREPARED ONLY. Synthetic byte-volume proof; never an admitted source package.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { indexJsonl, JSONL_MAX_BYTES } from '../../../../server/gcsp/vehicle-evidence/indexed-jsonl.js';
import { canonicalContent, contentChecksum, readCorpusFile, validateCorpusDirectory,
  writeCorpusCandidate } from '../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createPolicyService } from '../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../server/gcsp/repository/core.js';
import { installFleetOfflineGuard } from '../../../../scripts/gcsp/fleet-offline-guard.mjs';

const run = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const plan = JSON.parse(await readFile(new URL('./scale-proof-plan-2026-11-07.json', import.meta.url), 'utf8'));
const fixtureBytes = await readFile(join(root, plan.fixture.path));
assert.equal(contentChecksum(fixtureBytes), plan.fixture.sha256);
const fixture = JSON.parse(fixtureBytes); assert.equal(fixture.authority.admission, false);
assert.equal(fixture.authority.liveSourceCoverageCredit, 0);
assert.equal(JSONL_MAX_BYTES, plan.limits.productionDefaultBytesUnchanged);
const scratch = resolve(process.env.TMPDIR || '');
assert.ok(scratch.startsWith(plan.resources.oneDriveBase + '/test-stamp-shard-'));
assert.equal(await realpath(scratch), scratch);
const store = join(scratch, 'store');
const options = { indexed: true, sourceRegistrations: [],
  policyService: createPolicyService({ filePath: join(root, 'server/gcsp/policy/seed-v1.json') }),
  policyRead: { runId: 'f62-resource-beyond64-v1', asOf: '2026-11-07T00:00:00.000Z', policyVersion: 'gcsp-policy-v1' } };
const bounded = { ...options, jsonlLimits: { maxBytes: plan.limits.explicitProofMaxBytes,
  maxRowBytes: plan.limits.maxRowBytes, maxRows: plan.limits.maxRows } };
const guard = installFleetOfflineGuard(); const control = guard.control();
const refs = Array.from({ length: fixture.payload.referenceCount }, (_, index) => {
  const prefix = fixture.payload.prefix + String(index).padStart(2, '0') + '/';
  return (prefix + fixture.payload.pattern.repeat(fixture.payload.referenceBytes)).slice(0, fixture.payload.referenceBytes);
});
function rowAt(index) {
  const code = fixture.identity.varyingOptionPrefix + String(index).padStart(fixture.identity.varyingOptionDigits, '0');
  const codes = [code, fixture.identity.fixedOptionCode].sort();
  const signature = fixture.identity.modelCode + ':' + codes.join(',');
  return { configurationId: Buffer.from(signature).toString('base64'), snapshotVersion: fixture.identity.snapshotVersion,
    canonicalSignature: signature, canonicalIdentity: { vgModelCode: fixture.identity.modelCode, agModelCode: null,
      factoryOptionCodes: codes, provenance: fixture.provenance }, configuration: fixture.configuration,
    sourceContext: { ...fixture.sourceContext, sourceRefs: refs }, catalogue: null, imageIds: [] };
}
const first = rowAt(1);
assert.equal(Buffer.byteLength(canonicalContent(first)), plan.fixture.serializedBytesPerRow);
assert.equal(contentChecksum(canonicalContent(first)), plan.fixture.firstRowCanonicalSha256);
const selected = Array.from({ length: plan.limits.selectedLookupSamples }, (_, index) =>
  1 + Math.floor((plan.fixture.rows - 1) * index / (plan.limits.selectedLookupSamples - 1)));
const hashFile = async (path) => { const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes); return hash.digest('hex'); };
const latency = (values) => { const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, min: sorted[0], p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) }; };

if (process.argv[2] === '--cold-load' || process.argv[2] === '--cold-recovery') {
  const recover = process.argv[2] === '--cold-recovery'; const registry = createSyntheticRegistry({ root: store, ...bounded });
  const start = performance.now(); const loaded = await registry.load(); const loadMs = performance.now() - start;
  const passes = [];
  if (recover) {
    assert.equal(loaded.recovered, true); assert.ok(registry.getConfiguration(first.configurationId).record);
    assert.equal(registry.getConfiguration(rowAt(plan.fixture.rows).configurationId).status, 'not-found');
    assert.equal(registry.status().active.counts.configurations, 1);
  } else {
    assert.equal(loaded.status, 'ok'); assert.equal(registry.status().active.counts.configurations, plan.fixture.rows);
    for (const name of ['first-selected-pass', 'repeated-selected-pass']) {
      const times = []; const begin = performance.now();
      for (const index of selected) {
        const expected = rowAt(index); const before = performance.now(); const value = registry.getConfiguration(expected.configurationId);
        times.push(performance.now() - before); assert.deepEqual(value.record, expected);
        assert.deepEqual(value.images, []);
      }
      passes.push({ name, scope: '128-deterministic-selected-configurations', elapsedMs: performance.now() - begin, latencyMs: latency(times) });
    }
  }
  assert.equal(guard.calls.length, 0); guard.restore();
  process.stdout.write(JSON.stringify({ status: 'ok', freshProcess: true, recovered: recover, loadMs,
    active: registry.status().active, passes, egress: { externalCalls: 0, control } }) + '\n');
} else {
  assert.deepEqual(process.argv.slice(2, 3), ['--receipt']);
  const receiptPath = process.argv[3]; const controlRoot = process.env.F62_SCALE_CONTROL;
  assert.ok(controlRoot?.startsWith(plan.resources.controlBase + '/'));
  assert.equal(await realpath(controlRoot), controlRoot);
  assert.equal(dirname(receiptPath), controlRoot);
  const checkpointPath = join(controlRoot, 'phase-checkpoint.json'); const phases = [];
  const checkpoint = async (phase, detail = {}, status = 'running') => { const value = { phase, ...detail, at: new Date().toISOString() };
    phases.push(value); const temporary = checkpointPath + '.writing';
    await writeFile(temporary, JSON.stringify({ status, completed: phases }, null, 2) + '\n');
    await rename(temporary, checkpointPath); };
  const timings = {}; const defaultRefusals = [];
  const packageRoot = join(root, 'server/data/gcsp/vehicle-evidence/fleet-source.v1');
  const protectedFiles = {};
  async function protect(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name); if (entry.isDirectory()) await protect(path);
    else if (entry.isFile()) protectedFiles[path] = await hashFile(path);
  } }
  try {
    await protect(packageRoot);
    const baselineCandidate = join(scratch, 'baseline-candidate');
    const baseline = await writeCorpusCandidate(baselineCandidate,
      { metadata: { ...fixture.metadata, version: 'baseline.v1' }, configurations: [first], images: [] }, options);
    assert.equal(baseline.status, 'ok', JSON.stringify(baseline));
    const registry = createSyntheticRegistry({ root: store, ...bounded });
    const initial = await registry.publish(baselineCandidate); assert.equal(initial.status, 'ok');
    const oldDirectory = join(store, 'versions', initial.active.manifestDigest); const baselineFiles = {};
    for (const name of await readdir(oldDirectory)) baselineFiles[name] = await hashFile(join(oldDirectory, name));
    await rm(baselineCandidate, { recursive: true });
    await checkpoint('baseline-published', { manifestDigest: initial.active.manifestDigest, configurations: 1, vins: 0 });
    const inputPath = join(scratch, 'configurations-input.jsonl'); const input = await open(inputPath, 'wx', 0o600);
    const generatedHash = createHash('sha256'); let bytes = 0; let start = performance.now();
    try {
      for (let index = 1; index <= plan.fixture.rows; index++) {
        const line = canonicalContent(rowAt(index)); bytes += Buffer.byteLength(line); generatedHash.update(line); await input.writeFile(line);
        if (index % 256 === 0) await checkpoint('generation-progress', { rows: index, bytes });
      }
      await input.sync();
    } finally { await input.close(); }
    timings.generationMs = performance.now() - start; const generatedSha256 = generatedHash.digest('hex');
    assert.equal(bytes, plan.fixture.expectedConfigurationBytes); assert.ok(bytes > JSONL_MAX_BYTES);
    assert.equal(generatedSha256, plan.fixture.generatedFileSha256);
    assert.ok(bytes - plan.fixture.serializedBytesPerRow <= JSONL_MAX_BYTES);
    assert.equal((await stat(inputPath)).size, bytes); assert.equal(await hashFile(inputPath), generatedSha256);
    await checkpoint('generated-input-pinned', { rows: plan.fixture.rows, bytes, sha256: generatedSha256 });
    await assert.rejects(readCorpusFile(scratch, 'configurations-input.jsonl'), { code: 'artifact-size' });
    defaultRefusals.push('legacy-eager-file-reader');
    await assert.rejects(indexJsonl(inputPath), { code: 'artifact-size' }); defaultRefusals.push('default-index-scanner');
    const inputValue = { metadata: { ...fixture.metadata, version: 'beyond64.v1' }, configurationsFile: inputPath, images: [] };
    const refused = await writeCorpusCandidate(join(scratch, 'default-rejected'), inputValue, options);
    assert.equal(refused.failure?.code, 'artifact-size'); defaultRefusals.push('default-file-input-preparation');
    await checkpoint('default-input-boundaries-confirmed', { defaultRefusals, inputSha256: generatedSha256 });
    const candidate = join(scratch, 'candidate'); start = performance.now();
    const prepared = await writeCorpusCandidate(candidate, inputValue, bounded);
    timings.preparationMs = performance.now() - start; assert.equal(prepared.status, 'ok', JSON.stringify(prepared));
    assert.equal(prepared.manifest.counts.configurations, plan.fixture.rows);
    assert.equal(prepared.manifest.counts.vinMappings, 0); assert.equal(prepared.manifest.counts.images, 0);
    for (const indexed of [false, true]) {
      const denied = await validateCorpusDirectory(candidate, { ...options, indexed });
      assert.equal(denied.failure?.code, 'artifact-size'); defaultRefusals.push(indexed ? 'default-indexed-validation' : 'legacy-materialized-validation');
    }
    start = performance.now(); const checked = await validateCorpusDirectory(candidate, bounded);
    timings.validationMs = performance.now() - start; assert.equal(checked.status, 'ok', JSON.stringify(checked));
    assert.equal(Array.isArray(checked.corpus.configurations), false);
    assert.equal(checked.corpus.configurations.length, plan.fixture.rows);
    assert.equal(checked.corpus.configurations.metadata(first.configurationId).recordDigest, inputDigest(first));
    await checkpoint('prepared-and-validated', { manifestDigest: checked.manifestDigest,
      configurations: plan.fixture.rows, configurationBytes: (await stat(join(candidate, 'configurations.jsonl'))).size,
      defaultRefusals, inputSha256: generatedSha256 });
    await rm(inputPath);
    start = performance.now(); const published = await registry.publish(candidate);
    timings.publicationMs = performance.now() - start; assert.equal(published.status, 'ok', JSON.stringify(published));
    assert.equal(published.active.manifestDigest, checked.manifestDigest);
    start = performance.now(); const repeated = await registry.publish(candidate);
    timings.idempotentPublicationMs = performance.now() - start; assert.equal(repeated.idempotent, true);
    assert.equal(registry.status().active.counts.configurations, plan.fixture.rows);
    assert.deepEqual(registry.getConfiguration(first.configurationId).record, first);
    await checkpoint('published-and-idempotent', { manifestDigest: published.active.manifestDigest, retainedBaselineRows: 1, vins: 0, images: 0 });
    // Candidate bytes are disposable after validated publication and before further phases.
    await rm(candidate, { recursive: true });
    const fresh = await run(process.execPath, ['--max-old-space-size=256', script, '--cold-load'],
      { cwd: root, env: process.env, maxBuffer: 128 * 1024 });
    const cold = JSON.parse(fresh.stdout); assert.equal(cold.status, 'ok'); assert.equal(cold.egress.externalCalls, 0);
    await checkpoint('fresh-process-selected-lookups', { loadMs: cold.loadMs, passes: cold.passes });
    const selectedDirectory = join(store, 'versions', published.active.manifestDigest);
    const corrupt = await open(join(selectedDirectory, 'configurations.jsonl'), 'r+');
    try { await corrupt.write(Buffer.from('!'), 0, 1, 0); await corrupt.sync(); } finally { await corrupt.close(); }
    assert.equal(registry.getConfiguration(first.configurationId).failure?.code, 'indexed-corpus-changed');
    const recovered = JSON.parse((await run(process.execPath, ['--max-old-space-size=256', script, '--cold-recovery'],
      { cwd: root, env: process.env, maxBuffer: 128 * 1024 })).stdout);
    assert.equal(recovered.recovered, true); assert.equal(recovered.active.manifestDigest, initial.active.manifestDigest);
    for (const [name, digest] of Object.entries(baselineFiles)) assert.equal(await hashFile(join(oldDirectory, name)), digest);
    for (const [path, digest] of Object.entries(protectedFiles)) assert.equal(await hashFile(path), digest);
    assert.equal(guard.calls.length, 0);
    await checkpoint('owned-corruption-recovered', { baselineManifest: initial.active.manifestDigest,
      baselineFilesUnchanged: Object.keys(baselineFiles).length, shippedPackageFilesUnchanged: Object.keys(protectedFiles).length });
    await checkpoint('completed', { acceptance: 'not-established', sourceCoverageCredit: 0 }, 'passed');
    const receipt = { status: 'resource-proof-passing', scope: 'synthetic-byte-volume-only',
      sourceCoverageCredit: 0, vinMappings: 0, stockOrModelCoverageCredit: 0, fixtureSha256: plan.fixture.sha256,
      generatedInput: { rows: plan.fixture.rows, bytes, sha256: generatedSha256 }, explicitProofMaxBytes: plan.limits.explicitProofMaxBytes,
      unchangedProductionMaxBytes: JSONL_MAX_BYTES, defaultRefusals, timings, cold, recovery: recovered,
      baselineFilesUnchanged: Object.keys(baselineFiles).length, shippedPackageFilesUnchanged: Object.keys(protectedFiles).length,
      egress: { externalCalls: 0, sourceCalls: 0, control }, acceptance: 'not-established',
      limits: ['Not a v2 source-authority workload or 10000-record capacity proof',
        'No production cap change is made by this proof', '128 deterministic lookups per pass; validation covers the full synthetic corpus'],
      phases, environment: { node: process.version, platform: process.platform, arch: process.arch } };
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ status: receipt.status, rows: plan.fixture.rows, bytes, receipt: receiptPath }) + '\n');
  } catch (error) {
    await checkpoint('failed', { name: error.name, code: error.code || null,
      message: String(error.message).slice(0, 2000) }, 'failed');
    throw error;
  } finally { guard.restore(); }
}
