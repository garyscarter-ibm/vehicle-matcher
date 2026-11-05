import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeCorpusCandidate, validateCorpusDirectory, canonicalContent } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { corpusInput, options } from './helpers/vin-corpus-fixture.js';

const temporary = async (t) => { const root = await mkdtemp(join(tmpdir(), 'corpus-publication-')); t.after(() => rm(root, { recursive: true, force: true })); return root; };
async function editArtifact(directory, name, change) {
  const file = join(directory, name); const content = change(await readFile(file, 'utf8')); await writeFile(file, content);
  const manifestPath = join(directory, 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.checksums[name] = createHash('sha256').update(content).digest('hex');
  await writeFile(manifestPath, canonicalContent(manifest));
}

test('deterministic candidate separates source facts from delivered/current VINs, excludes stock orders and reconciles manifest', async (t) => {
  const root = await temporary(t); const input = await corpusInput({ count: 2 });
  const before = structuredClone(input);
  const a = await writeCorpusCandidate(join(root, 'a'), input, options);
  const b = await writeCorpusCandidate(join(root, 'b'), input, options);
  assert.equal(a.status, 'ok'); assert.equal(b.status, 'ok'); assert.deepEqual(input, before);
  assert.deepEqual(a.manifest, b.manifest);
  assert.deepEqual(a.manifest.counts, { configurations: 2, distinctConfigurations: 2, vinMappings: 2, images: 0 });
  assert.equal(a.manifest.qualification, 'bounded-fixture-or-partial-corpus');
  const valid = await validateCorpusDirectory(join(root, 'a'), options); assert.equal(valid.status, 'ok');
  assert.equal(valid.corpus.configurations[0].configuration.vgModelCode, null);
  assert.equal(valid.corpus.configurations[0].canonicalIdentity.provenance.kind, 'synthetic');
  const vins = await readFile(join(root, 'a', 'vins.jsonl'), 'utf8');
  for (const row of vins.trim().split('\n').map(JSON.parse)) for (const excluded of ['orderUuid', 'orderNumber', 'wholesalerOrderId', 'runId']) assert.equal(Object.hasOwn(row, excluded), false);
  const stock = await writeCorpusCandidate(join(root, 'stock'), await corpusInput({ usage: 'stock' }), options);
  assert.equal(stock.status, 'ok'); assert.equal(stock.manifest.counts.vinMappings, 0);
});

test('whole-candidate validation rejects checksum, truncation, missing files, counts, duplicate IDs, signatures and mutable state', async (t) => {
  const root = await temporary(t);
  for (const [name, mutate, expected] of [
    ['checksum', async (dir) => writeFile(join(dir, 'vins.jsonl'), '\n'), 'checksum-mismatch'],
    ['truncated', async (dir) => editArtifact(dir, 'configurations.jsonl', (v) => v.trimEnd()), 'truncated-jsonl'],
    ['missing', async (dir) => rm(join(dir, 'images.jsonl')), 'artifact-unavailable'],
    ['counts', async (dir) => { const p = join(dir, 'manifest.json'); const m = JSON.parse(await readFile(p, 'utf8')); m.counts.configurations++; await writeFile(p, canonicalContent(m)); }, 'count-mismatch'],
    ['duplicate', async (dir) => editArtifact(dir, 'configurations.jsonl', (v) => v + v), 'duplicate-configuration'],
    ['signature', async (dir) => editArtifact(dir, 'configurations.jsonl', (v) => { const r = JSON.parse(v); r.canonicalSignature = 'wrong'; return canonicalContent(r); }), 'configuration-signature'],
    ['mutable', async (dir) => editArtifact(dir, 'configurations.jsonl', (v) => { const r = JSON.parse(v); r.available = true; return canonicalContent(r); }), 'configuration-schema'],
  ]) {
    const dir = join(root, name); assert.equal((await writeCorpusCandidate(dir, await corpusInput(), options)).status, 'ok');
    await mutate(dir); const result = await validateCorpusDirectory(dir, options);
    assert.equal(result.status, 'invalid-corpus', name); assert.equal(result.failure.code, expected, name);
  }
});

test('reference, profile, generator, provenance and option-completeness drift reject without regeneration', async (t) => {
  const root = await temporary(t);
  for (const [name, artifact, change, expected] of [
    ['dangling-vin', 'vins.jsonl', (r) => { r.configurationId = Buffer.from('OTHER:REFERENCE').toString('base64'); }, 'dangling-configuration'],
    ['image', 'configurations.jsonl', (r) => { r.imageIds = ['unpublished-image']; }, 'dangling-image'],
    ['profile', 'vins.jsonl', (r) => { r.profile.profileId = 'UK-OBS-001'; }, 'unsupported-profile'],
    ['profile-version', 'vins.jsonl', (r) => { r.profile.profileVersion = '2'; }, 'unsupported-profile'],
    ['generator', 'vins.jsonl', (r) => { r.generatorVersion = 'future-generator'; }, 'generator-version'],
    ['provenance', 'configurations.jsonl', (r) => { r.sourceContext.sourceRefs = []; }, 'configuration-provenance'],
    ['completeness', 'configurations.jsonl', (r) => { r.sourceContext.selectedOptionCompleteness = 'complete'; }, 'configuration-provenance'],
    ['duplicate-vin', 'vins.jsonl', () => {}, 'duplicate-vin'],
  ]) {
    const dir = join(root, name); await writeCorpusCandidate(dir, await corpusInput(), options);
    await editArtifact(dir, artifact, (content) => { const row = JSON.parse(content); change(row); return canonicalContent(row) + (name === 'duplicate-vin' ? canonicalContent(row) : ''); });
    const result = await validateCorpusDirectory(dir, options);
    assert.equal(result.status, 'invalid-corpus', name); assert.equal(result.failure.code, expected, name);
  }
});

test('canonical signature uses canonical PolicyService rules and rejects unavailable or unsupported policy', async (t) => {
  const root = await temporary(t); const input = await corpusInput();
  const unavailable = { getAssumption: async () => ({ status: 'unavailable' }) };
  assert.equal((await writeCorpusCandidate(join(root, 'bad'), input, { ...options, policyService: unavailable })).failure.code, 'signature-policy-unavailable');
  const changed = { getAssumption: async (key, read) => { const value = await options.policyService.getAssumption(key, read); return key.endsWith('modelCodeField') ? { ...value, value: { ...value.value, value: 'agModelCode' } } : value; } };
  assert.equal((await writeCorpusCandidate(join(root, 'changed'), input, { ...options, policyService: changed })).status, 'invalid-corpus');
});
