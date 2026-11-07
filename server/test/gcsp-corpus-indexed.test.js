import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inputDigest } from '../gcsp/repository/core.js';
import { canonicalContent, writeCorpusCandidate, validateCorpusDirectory } from '../gcsp/vehicle-evidence/corpus-publisher.js';
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
