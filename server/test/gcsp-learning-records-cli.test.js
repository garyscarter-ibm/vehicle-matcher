import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runCli } from '../../scripts/gcsp/generate-learning-records.mjs';
import { readLearningDataset } from '../gcsp/predict/records/index.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/gcsp-learning-dataset.json', import.meta.url), 'utf8'));
const cli = fileURLToPath(new URL('../../scripts/gcsp/generate-learning-records.mjs', import.meta.url));
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'learning-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const snapshot = join(root, 'snapshot.json');
  await writeFile(snapshot, JSON.stringify(fixture.manifest.snapshot));
  const output = join(root, 'dataset');
  return { root, snapshot, output };
}
async function invoke(argv) {
  const stdout = []; const stderr = [];
  const rc = await runCli({ argv, write: (line) => stdout.push(line), writeError: (line) => stderr.push(line) });
  return { rc, stdout: stdout.join(''), stderr: stderr.join('') };
}
async function datasetAt(output) {
  return { manifest: JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')),
    records: JSON.parse(await readFile(join(output, 'records.json'), 'utf8')) };
}
const args = (f) => ['--seed', fixture.manifest.seed, '--snapshot', f.snapshot, '--allow-fixtures', '--output', f.output];

test('CLI writes a complete labelled dataset and manifest that reproduce the training sample', async (t) => {
  const f = await setup(t);
  const child = spawnSync(process.execPath, [cli, ...args(f)],
    { cwd: f.root, encoding: 'utf8', timeout: 15000, maxBuffer: 65536, env: process.env });
  const out = { rc: child.status, stdout: child.stdout, stderr: child.stderr };
  assert.equal(out.rc, 0, out.stderr); assert.equal(out.stderr, '');
  const summary = JSON.parse(out.stdout); assert.equal(summary.status, 'ok');
  assert.equal(summary.configurationSource, 'reviewed-fixtures'); assert.equal(summary.datasetKind, 'synthetic');
  assert.equal(summary.counts.records, 6); assert.equal(summary.counts.cycles, 2);
  const dataset = await datasetAt(f.output); assert.deepEqual(dataset, fixture);
  assert.equal(readLearningDataset(dataset).status, 'ok');
  assert.equal(summary.manifestPath, join(f.output, 'manifest.json'));
});

test('CLI refuses existing output paths and leaves their complete contents unchanged', async (t) => {
  const f = await setup(t); await mkdir(f.output); await writeFile(join(f.output, 'keep.txt'), 'keep exactly');
  const out = await invoke(args(f)); assert.equal(out.rc, 2);
  assert.deepEqual(JSON.parse(out.stderr), { status: 'unavailable', code: 'output-exists', field: 'output' });
  assert.equal(await readFile(join(f.output, 'keep.txt'), 'utf8'), 'keep exactly');
  await assert.rejects(stat(join(f.output, 'manifest.json')), { code: 'ENOENT' });
});

test('CLI requires explicit fixture permission and refuses malformed or incompatible input before output', async (t) => {
  const f = await setup(t);
  const noPermission = args(f).filter((a) => a !== '--allow-fixtures');
  assert.equal(JSON.parse((await invoke(noPermission)).stderr).code, 'real-corpus-required');
  await writeFile(f.snapshot, '{private broken document');
  const malformed = await invoke(args(f)); assert.equal(malformed.rc, 2);
  assert.equal(JSON.parse(malformed.stderr).code, 'snapshot-unavailable'); assert.ok(!malformed.stderr.includes('private'));
  const incompatible = await invoke([...args(f), '--policy-file', 'not-used']);
  assert.equal(JSON.parse(incompatible.stderr).code, 'incompatible-options');
  await assert.rejects(stat(f.output), { code: 'ENOENT' });
});

test('CLI reads a complete successor through FilePolicyProvider and produces identical reruns', async (t) => {
  const f = await setup(t); const source = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  source.policyVersion = fixture.manifest.policyVersion;
  for (const rows of Object.values(source).filter(Array.isArray))
    for (const row of rows) if (row.policyVersion) row.policyVersion = source.policyVersion;
  source.assumptions = Object.values({ ...Object.fromEntries(source.assumptions.map((row) => [row.key, row])),
    ...fixture.manifest.snapshot.comparison.assumptions, ...fixture.manifest.snapshot.assumptions });
  const policyFile = join(f.root, 'fictional-policy.json'); await writeFile(policyFile, JSON.stringify(source));
  const argv = ['--seed', fixture.manifest.seed, '--policy-file', policyFile, '--as-of', fixture.manifest.snapshot.policyRead.asOf,
    '--run-id', fixture.manifest.snapshot.policyRead.runId, '--allow-fixtures', '--output', f.output];
  const first = await invoke(argv); assert.equal(first.rc, 0, first.stderr);
  assert.deepEqual(await datasetAt(f.output), fixture);
  const secondOutput = join(f.root, 'second'); argv[argv.length - 1] = secondOutput;
  const second = await invoke(argv); assert.equal(second.rc, 0, second.stderr);
  assert.deepEqual(await datasetAt(secondOutput), await datasetAt(f.output));
});

test('actual CLI process refuses missing canonical learning adoption without creating output', async (t) => {
  const f = await setup(t);
  const child = spawnSync(process.execPath, [cli, '--seed', '1', '--output', f.output],
    { cwd: f.root, encoding: 'utf8', timeout: 15000, maxBuffer: 65536, env: process.env });
  assert.equal(child.status, 2); assert.equal(child.stdout, '');
  assert.deepEqual(JSON.parse(child.stderr), { status: 'unavailable', code: 'policy-unavailable', field: 'learning.cohortSize' });
  await assert.rejects(stat(f.output), { code: 'ENOENT' });
});

test('CLI argument and corpus-store refusals remain typed and help performs no generation', async (t) => {
  const f = await setup(t);
  for (const argv of [[], ['--seed'], ['--seed', '1', '--seed', '2'], ['--seed', '1', '--unsupported'], ['--seed', '1', '--as-of', 'not-a-date']]) {
    const out = await invoke(argv); assert.equal(out.rc, 2); assert.equal(JSON.parse(out.stderr).code, 'invalid-arguments');
  }
  const corpus = await invoke(['--seed', '1', '--corpus-store', join(f.root, 'absent-corpus'), '--output', f.output]);
  assert.equal(JSON.parse(corpus.stderr).code, 'corpus-unavailable');
  const help = await invoke(['--help']); assert.equal(help.rc, 0); assert.match(help.stdout, /--allow-fixtures/);
  await assert.rejects(stat(f.output), { code: 'ENOENT' });
});
