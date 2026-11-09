import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inputDigest } from '../gcsp/repository/core.js';
import { boundDiagnostic, canonicalContent, writeCorpusCandidate, validateCorpusDirectory } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { corpusInput, options } from './helpers/vin-corpus-fixture.js';

const temporary = async (t) => { const root = await mkdtemp(join(tmpdir(), 'corpus-indexed-'));
  t.after(() => rm(root, { recursive: true, force: true })); return root; };
test('indexed validation preserves rows, summaries and digest metadata while legacy arrays remain available', async (t) => {
  const root = await temporary(t); const directory = join(root, 'candidate');
  assert.equal((await writeCorpusCandidate(directory, await corpusInput({ count: 2 }), options)).status, 'ok');
  const legacy = await validateCorpusDirectory(directory, options);
  const indexed = await validateCorpusDirectory(directory, { ...options, indexed: true });
  assert.equal(indexed.status, 'ok', JSON.stringify(indexed)); assert.equal(Array.isArray(legacy.corpus.configurations), true);
  assert.equal(Array.isArray(indexed.corpus.configurations), false);
  for (const name of ['configurations', 'vins', 'images']) assert.deepEqual([...indexed.corpus[name]], legacy.corpus[name]);
  const first = legacy.corpus.configurations[0];
  assert.equal(indexed.corpus.configurations.metadata(first.configurationId).recordDigest, inputDigest(first));
  assert.deepEqual(indexed.corpus.configurations.get(first.configurationId), first);
});
test('array, iterable and explicit same-format JSONL preparation emit identical bytes', async (t) => {
  const root = await temporary(t); const input = await corpusInput({ count: 2 }); const before = structuredClone(input);
  const configurationsFile = join(root, 'input.jsonl');
  await writeFile(configurationsFile, input.configurations.map(canonicalContent).join(''));
  function* rows() { yield* input.configurations; }
  for (const [name, value] of [['array', input], ['iterable', { ...input, configurations: rows() }],
    ['file', { ...input, configurations: undefined, configurationsFile }]]) {
    const result = await writeCorpusCandidate(join(root, name), value, options);
    assert.equal(result.status, 'ok', `${name}: ${JSON.stringify(result)}`);
  }
  for (const file of ['manifest.json', 'configurations.jsonl', 'vins.jsonl', 'images.jsonl']) {
    const expected = await readFile(join(root, 'array', file));
    for (const variant of ['iterable', 'file']) assert.deepEqual(await readFile(join(root, variant, file)), expected);
  }
  assert.deepEqual(input, before);
});
test('explicit JSONL preparation retains old immutable rows and refuses conflicts or interrupted input', async (t) => {
  const root = await temporary(t); const input = await corpusInput(); const retainedCorpusDirectory = join(root, 'old');
  assert.equal((await writeCorpusCandidate(retainedCorpusDirectory, input, options)).status, 'ok');
  const configurationsFile = join(root, 'input.jsonl'); await writeFile(configurationsFile, '');
  const retained = await writeCorpusCandidate(join(root, 'new'), { ...input, configurations: undefined,
    configurationsFile, retainedCorpusDirectory }, options);
  assert.equal(retained.status, 'ok', JSON.stringify(retained)); assert.equal(retained.manifest.counts.configurations, 1);
  const altered = structuredClone(input.configurations[0]); altered.configuration.model = 'changed';
  await writeFile(configurationsFile, canonicalContent(altered));
  assert.equal((await writeCorpusCandidate(join(root, 'conflict'), { ...input, configurations: undefined,
    configurationsFile, retainedCorpusDirectory }, options)).failure.code, 'historical-configuration-conflict');
  await writeFile(configurationsFile, JSON.stringify(input.configurations[0]));
  assert.equal((await writeCorpusCandidate(join(root, 'truncated'), { ...input, configurations: undefined,
    configurationsFile }, options)).failure.code, 'truncated-jsonl');
});
test('runtime lazy reads survive publication rename and fail closed after active bytes change', async (t) => {
  const root = await temporary(t); const input = await corpusInput(); const directory = join(root, 'candidate');
  assert.equal((await writeCorpusCandidate(directory, input, options)).status, 'ok');
  const registry = createSyntheticRegistry({ root: join(root, 'store'), ...options });
  assert.equal((await registry.publish(directory)).status, 'ok');
  const id = input.configurations[0].configurationId; const first = registry.getConfiguration(id);
  assert.equal(first.status, 'partial'); first.record.configuration.model = 'changed';
  assert.notEqual(registry.getConfiguration(id).record.configuration.model, 'changed');
  const active = registry.status().active;
  const artifact = join(root, 'store', 'versions', active.manifestDigest, 'configurations.jsonl');
  const content = JSON.parse(await readFile(artifact, 'utf8')); content.configuration.model = 'corrupted after selection';
  await writeFile(artifact, canonicalContent(content));
  const result = registry.getConfiguration(id);
  assert.equal(result.status, 'source-unavailable'); assert.equal(result.failure.code, 'indexed-corpus-changed');
  assert.equal(Object.hasOwn(result, 'record'), false);
});
test('published lazy reads stay available after ctime-only drift on the active artifact', async (t) => {
  const root = await temporary(t); const input = await corpusInput(); const directory = join(root, 'candidate');
  assert.equal((await writeCorpusCandidate(directory, input, options)).status, 'ok');
  const registry = createSyntheticRegistry({ root: join(root, 'store'), ...options });
  assert.equal((await registry.publish(directory)).status, 'ok');
  const id = input.configurations[0].configurationId; const expected = registry.getConfiguration(id).record;
  const active = registry.status().active;
  const artifact = join(root, 'store', 'versions', active.manifestDigest, 'configurations.jsonl');
  const before = await stat(artifact, { bigint: true }); await chmod(artifact, Number(before.mode & 0o777n) ^ 0o040);
  const after = await stat(artifact, { bigint: true });
  assert.equal(after.mtimeNs, before.mtimeNs); assert.notEqual(after.ctimeNs, before.ctimeNs);
  const result = registry.getConfiguration(id);
  assert.equal(result.status, 'partial', JSON.stringify(result)); assert.deepEqual(result.record, expected);
});
test('a rejected corpus keeps its phase, file, check and record in a bounded diagnostic beside the unchanged failure', async (t) => {
  const root = await temporary(t); const directory = join(root, 'candidate');
  assert.equal((await writeCorpusCandidate(directory, await corpusInput({ count: 2 }), options)).status, 'ok');
  const indexedOptions = { ...options, indexed: true };
  assert.equal(Object.hasOwn(await validateCorpusDirectory(directory, indexedOptions), 'diagnostic'), false);
  const vins = await readFile(join(directory, 'vins.jsonl'), 'utf8'); const configurations = await readFile(join(directory, 'configurations.jsonl'), 'utf8');
  await writeFile(join(directory, 'vins.jsonl'), vins + '{}\n');
  const mismatch = await validateCorpusDirectory(directory, indexedOptions);
  assert.deepEqual(Object.keys(mismatch.failure), ['code', 'message']); assert.equal(mismatch.failure.code, 'checksum-mismatch');
  assert.deepEqual(mismatch.diagnostic, { phase: 'index:vins.jsonl' });
  await writeFile(join(directory, 'vins.jsonl'), vins); await writeFile(join(directory, 'configurations.jsonl'), '{"a":1}\nbroken\n');
  const parsed = await validateCorpusDirectory(directory, indexedOptions);
  assert.equal(parsed.failure.code, 'malformed-jsonl');
  assert.deepEqual(parsed.diagnostic, { phase: 'index:configurations.jsonl', file: 'configurations.jsonl', check: 'parse', record: 2, offset: 8 });
  await writeFile(join(directory, 'configurations.jsonl'), configurations); await rm(join(directory, 'images.jsonl'));
  const missing = await validateCorpusDirectory(directory, indexedOptions);
  assert.equal(missing.failure.code, 'artifact-unavailable');
  assert.deepEqual(missing.diagnostic, { phase: 'index:images.jsonl', errorName: 'Error', errno: 'ENOENT', syscall: 'open' });
  assert.equal(JSON.stringify(missing).includes(root), false);
});
test('diagnostics are clamped to bounded depth, size and URL-free strings', () => {
  const bounded = boundDiagnostic({ long: 'x'.repeat(500), url: 'see https://example.org/a', list: Array.from({ length: 30 }, (_, i) => i),
    deep: { a: { b: { c: 'too deep' } } }, kept: { a: { b: 'ok' } }, nothing: undefined, bad: Infinity });
  assert.equal(bounded.long.length, 200); assert.equal(Object.hasOwn(bounded, 'url'), false); assert.equal(bounded.list.length, 10);
  assert.deepEqual(bounded.deep, { a: {} }); assert.deepEqual(bounded.kept, { a: { b: 'ok' } });
  assert.equal(Object.hasOwn(bounded, 'nothing'), false); assert.equal(Object.hasOwn(bounded, 'bad'), false);
});
