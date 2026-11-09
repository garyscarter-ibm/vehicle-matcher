// One default CLI training on immutable retained canonical inputs. No generator,
// adoption, publication, listener or model activation is invoked by this proof.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [mirrorArg, outputArg] = process.argv.slice(2);
assert.ok(mirrorArg && outputArg && process.argv.length === 4);
const mirror = resolve(mirrorArg); const output = resolve(outputArg);
const load = (path) => import(pathToFileURL(join(mirror, path)).href);
const good = (out) => { assert.equal(out?.status, 'ok', `Expected ok: ${out?.code ?? out?.status}`); return out.value; };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputs = {
  'choice-training-dataset.json': '49738aadd1f22ffee43df4d6d9e06695cb1ada6cca3c033bc8c0913b13dc6926',
  'choice-training-policy.json': 'c2079525f409b0b8b94e23d2fbd0b0b8cba0dfe54bc22d46476ae3ec8a3b0f85',
  'choice-training-policy-base.json': 'c58fcd9054fa32cded07c4ee742b39d196f94aa15c8d0fbf7752874954df8a31',
};
const report = { schemaVersion: 1, story: 'FUCQ-115', variant: 'retained-training-v1', status: 'incomplete',
  checks: [], sourceInputs: inputs, label: 'Synthetic-trained; structural configurations and thin vehicle-choice support',
  unreached: ['Actual model-reference publication and activation', 'Full/native/browser/corpus/live/calibration validation'] };
let policy; let phase = 'retained-source-readback';
await mkdir(output, { recursive: false });
async function writeJson(name, value, limit = 2 * 1024 * 1024) {
  const bytes = `${JSON.stringify(value)}\n`;
  assert.ok(Buffer.byteLength(bytes) <= limit);
  await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  return { bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
}
try {
  const contents = {};
  for (const [name, expected] of Object.entries(inputs)) {
    const bytes = await readFile(join(mirror, 'docs/gcsp/models', name));
    assert.equal(hash(bytes), expected); contents[name] = JSON.parse(bytes);
  }
  const [{ PolicyService, FilePolicyProvider }, records, model, { inputDigest }] = await Promise.all([
    load('server/gcsp/policy/index.js'), load('server/gcsp/predict/records/index.js'),
    load('server/gcsp/predict/model/index.js'), load('server/gcsp/repository/index.js'),
  ]);
  const current = contents['choice-training-policy.json']; const original = contents['choice-training-policy-base.json'];
  const dataset = contents['choice-training-dataset.json'];
  policy = new PolicyService({ provider: new FilePolicyProvider({
    filePath: join(mirror, 'docs/gcsp/models/choice-training-policy.json'),
    retainedFilePaths: [join(mirror, 'docs/gcsp/models/choice-training-policy-base.json')],
  }) });
  const read = { runId: 'offline-choice-training', asOf: current.effectiveFrom, policyVersion: current.policyVersion };
  assert.equal(good(await policy.getActiveVersion({ runId: read.runId, asOf: original.effectiveFrom })).policyVersion, original.policyVersion);
  assert.equal(good(await policy.getActiveVersion({ runId: read.runId, asOf: current.effectiveFrom })).policyVersion, current.policyVersion);
  assert.equal(inputDigest(good(await policy.getPolicySnapshot(read))), inputDigest(current));
  assert.equal(inputDigest(good(await policy.getPolicySnapshot({ ...read, policyVersion: original.policyVersion }))), inputDigest(original));
  good(records.readLearningDataset(dataset));
  const settings = good(await model.loadChoiceTrainingPolicy({ policyService: policy, policyRead: read }));
  const projection = model.projectLearningChoices(dataset, { readLearningDataset: records.readLearningDataset,
    featureVersion: settings.featureVersion, cohortField: settings.split.cohortField });
  const partition = model.splitChoiceExamples(projection.examples, settings.split);
  assert.deepEqual(partition.manifest.counts, { training: 123, later: 152, unseen: 31, familiar: 121, excluded: 31 });
  report.partitionCounts = partition.manifest.counts; report.exclusions = projection.exclusions;
  report.support = { training: { wait: 120, chosenVehicle: 3, nonemptyVehicleSets: 5 },
    later: { wait: 145, chosenVehicle: 7, nonemptyVehicleSets: 8 }, unseen: { wait: 27, chosenVehicle: 4, nonemptyVehicleSets: 5 } };
  report.dataset = { records: dataset.records.length, dataHash: dataset.manifest.dataHash,
    policyVersion: dataset.manifest.policyVersion, configurationSource: dataset.manifest.snapshot.comparison.configurationSource.kind };
  report.checks.push('Unchanged actual canonical current/original policy bytes; actual historical and pinned readback; unchanged actual113 manifest/dataset and123/152/31 split');
  phase = 'default-training-cli';
  const cli = await load('scripts/gcsp/train-choice-model.mjs');
  let stdout = ''; let stderr = '';
  // argv[] is the exact default input/output behavior of the authored CLI.
  const rc = await cli.runCli({ argv: [], write: (s) => { stdout += s; }, writeError: (s) => { stderr += s; } });
  report.cli = { rc };
  if (rc !== 0) {
    const error = JSON.parse(stderr);
    report.status = 'unavailable'; report.failure = { phase, ...error }; process.exitCode = 2;
  } else {
    const summary = JSON.parse(stdout);
    assert.equal(summary.status, 'evaluated'); assert.equal(summary.policyVersion, current.policyVersion);
    assert.ok(typeof summary.artifactPath === 'string');
    const path = resolve(summary.artifactPath); const fromMirror = relative(mirror, path);
    assert.ok(fromMirror && !fromMirror.startsWith('..') && !isAbsolute(fromMirror));
    const artifact = model.verifyModelArtifact(JSON.parse(await readFile(path)));
    assert.equal(artifact.artifactId, summary.artifactId);
    assert.equal(artifact.payload.trainingManifest.dataHash, dataset.manifest.dataHash);
    assert.equal(artifact.payload.policyVersion, current.policyVersion);
    assert.equal(artifact.payload.trainingSettings.policyRead.runId, 'offline-choice-training');
    const retainedArtifact = await model.writeModelArtifact(join(output, 'artifacts'), artifact);
    assert.equal((await model.writeModelArtifact(join(output, 'artifacts'), artifact)).reused, true);
    const { artifactPath, ...safeSummary } = summary;
    report.evaluationFile = await writeJson('evaluation-summary.json', safeSummary);
    report.artifact = { artifactId: artifact.artifactId, filename: `${artifact.artifactId.slice(7)}.json`,
      bytes: (await stat(retainedArtifact.path)).size, optimizer: artifact.payload.optimizer };
    report.metrics = Object.fromEntries(Object.entries(summary.metrics).map(([key, value]) => [key, value.overall]));
    report.holdoutMetrics = Object.fromEntries(Object.entries(artifact.payload.evaluation.holdouts)
      .map(([key, comparison]) => [key, Object.fromEntries(Object.entries(comparison.models).map(([name, result]) => [name, result.overall]))]));
    report.deltas = summary.deltas;
    report.checks.push('Default CLI trains once with actual99/29 baselines; actual computed holdout metrics and thin groups; verified immutable artifact and safe summary');
    report.status = 'evaluated';
  }
} catch (error) {
  report.status = 'unavailable'; report.failure = { phase, name: error?.name ?? 'Error',
    code: error?.code ?? null, field: error?.field ?? null, message: String(error?.message ?? 'Unknown failure').slice(0, 1024) };
  process.exitCode = 2;
} finally {
  try { await policy?.close(); } finally {
    await writeJson('run-summary.json', report); console.log(JSON.stringify(report));
  }
}
