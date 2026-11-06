// Dispatcher-reviewed offline entry point. The supervisor supplies a byte-exact
// finite source mirror and owned output root; this file opens no listener.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

const [mirrorArg, outputArg] = process.argv.slice(2);
assert.ok(mirrorArg && outputArg && process.argv.length === 4);
const mirror = resolve(mirrorArg); const output = resolve(outputArg);
const load = (path) => import(pathToFileURL(join(mirror, path)).href);
const good = (out) => { assert.equal(out?.status, 'ok', `Expected ok: ${out?.code ?? out?.reason ?? out?.status}`); return out.value; };
const bytesHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writeJson = async (name, value, limit = 16 * 1024 * 1024) => {
  const bytes = `${JSON.stringify(value)}\n`;
  assert.ok(Buffer.byteLength(bytes) <= limit, `Bounded output: ${name}`);
  await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  return { bytes: Buffer.byteLength(bytes), sha256: bytesHash(bytes) };
};
const report = { schemaVersion: 1, story: 'FUCQ-115', status: 'incomplete',
  configurationSource: 'reviewed-fixtures', label: 'Synthetic engineering trial; no BMW calibration or live producer proof', checks: [] };
let runtime; let readPolicy; let phase = 'canonical-bootstrap';
await mkdir(output, { recursive: false });
try {
  const [{ PolicyService, MemoryPolicyProvider, createMemoryPolicyStore }, { createGcspRuntime },
    { createGcspHandler }, records, model, { inputDigest }] = await Promise.all([
    load('server/gcsp/policy/index.js'), load('server/gcsp/runtime.js'), load('server/gcsp/identity/http.js'),
    load('server/gcsp/predict/records/index.js'), load('server/gcsp/predict/model/index.js'), load('server/gcsp/repository/index.js'),
  ]);
  const store = createMemoryPolicyStore();
  readPolicy = new PolicyService({ provider: new MemoryPolicyProvider({ store }) });
  const start = '2026-11-06T09:00:00.000Z';
  runtime = good(await createGcspRuntime({ mode: 'memory', policy: readPolicy, environmentId: 'fucq115-offline-80x4',
    commandId: 'fucq115-bootstrap', policyAsOf: start, sessionNow: () => start }));
  const session = good(await runtime.createLocalSession());
  const cookies = new Map();
  const updateCookies = (headers) => {
    for (const header of (Array.isArray(headers) ? headers : [headers]).filter(Boolean)) {
      const part = header.split(';', 1)[0]; const equals = part.indexOf('=');
      assert.ok(equals > 0); cookies.set(part.slice(0, equals), part.slice(equals + 1));
    }
  };
  updateCookies(session.setCookie);
  const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const handler = createGcspHandler({ identity: runtime.identity, allowedOrigins: ['http://localhost'] });
  async function request(pathname, body) {
    let result;
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = body === undefined ? 'GET' : 'POST';
    req.headers = { cookie: cookie(), ...(body === undefined ? {} : { origin: 'http://localhost' }) };
    const res = { setHeader(name, value) { if (name.toLowerCase() === 'set-cookie') updateCookies(value); } };
    await handler({ req, res, pathname, searchParams: new URLSearchParams(), corsHeaders: {}, gateAuthorized: true,
      sendJson(_res, statusCode, outcome) { result = { statusCode, outcome }; } });
    assert.equal(result?.statusCode, 200, `Ordinary handler: ${result?.outcome?.code ?? result?.outcome?.status}`);
    return good(result.outcome);
  }
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: cookie(), purpose: 'presenter-control' }));
  const initialClock = good(await runtime.clock.now(presenter));
  assert.ok(Date.parse(initialClock.now) < Date.parse(start));
  good(await runtime.clock.advance(presenter, { commandId: 'fucq115-prepare-dated-trial',
    expectedClockVersion: initialClock.clockVersion, to: start }));
  const greg = await request('/api/gcsp/session/switch', { principalId: 'demo-greg', commandId: 'fucq115-greg' });
  const read = async () => ({ runId: greg.runId, asOf: good(await runtime.clock.now(presenter)).now });
  const initialRead = await read();
  const original = good(await readPolicy.getPolicySnapshot(initialRead));
  const originalHistoryHash = inputDigest(store.runs.get(greg.runId));
  const nextSecond = async () => {
    const current = good(await runtime.clock.now(presenter));
    good(await runtime.clock.advance(presenter, { commandId: `fucq115-step:${current.clockVersion}`,
      expectedClockVersion: current.clockVersion, bySeconds: 1 }));
  };
  const adopt = async (definitionSetId, policyVersion, expectedActiveVersion) => {
    const pin = await read();
    const command = { commandId: `fucq115-adopt:${definitionSetId}`, expectedActiveVersion, policyVersion,
      effectiveFrom: pin.asOf, definitionSetId };
    good(await runtime.policy.adoptReviewedAssumptions(greg, command));
    assert.equal((await request('/api/gcsp/context')).policyVersion, policyVersion);
    good(await runtime.policy.adoptReviewedAssumptions(greg, command));
  };
  phase = 'canonical-adoption';
  await adopt('fucq113-learning-v1', 'fucq115-learning-v2', original.policyVersion);
  await nextSecond();
  await adopt('fucq115-choice-model-v1', 'fucq115-choice-model-v3', 'fucq115-learning-v2');
  await nextSecond();
  const commandBytes = await readFile(join(mirror, 'docs/gcsp/evidence/fucq103/fucq115-dated-policy-command.json'));
  assert.equal(bytesHash(commandBytes), 'f7424c94b73d6a027f89c6b794fe261ea81807469cfa9e0cfc36482bab35f579');
  const command = JSON.parse(commandBytes);
  assert.equal((await read()).asOf, command.effectiveFrom);
  phase = 'canonical-dated-publication';
  good(await runtime.policy.publishPolicyVersion(greg, command));
  const active = await request('/api/gcsp/context');
  assert.equal(active.policyVersion, command.policyVersion);
  const pin = { ...await read(), policyVersion: active.policyVersion };
  const snapshot = good(await readPolicy.getPolicySnapshot(pin));
  assert.equal(inputDigest(snapshot.pricePlans.map(({ policyVersion, effectiveFrom, ...row }) => row)),
    inputDigest(original.pricePlans.map(({ policyVersion, effectiveFrom, ...row }) => row)));
  assert.equal(inputDigest(good(await readPolicy.getPolicySnapshot({ ...initialRead, policyVersion: original.policyVersion }))), inputDigest(original));
  assert.equal(inputDigest(store.runs.get(greg.runId).slice(0, 1)), originalHistoryHash);
  good(await runtime.policy.publishPolicyVersion(greg, command));
  assert.equal(store.runs.get(greg.runId).length, 4);
  report.checks.push('canonical missing-only learning/choice adoption; same-cookie activation; dated publication retry append-once; historical price/policy pins');
  report.policyRead = pin;
  report.policyFile = await writeJson('training-policy.json', snapshot, 8 * 1024 * 1024);
  phase = 'actual-generator';
  const learningSnapshot = await records.loadLearningPolicy({ policyService: readPolicy, policyRead: pin });
  assert.equal(learningSnapshot.policyVersion, active.policyVersion);
  assert.equal(learningSnapshot.policyRead.asOf, command.effectiveFrom);
  assert.equal(learningSnapshot.assumptions['learning.cohortSize'].value, 80);
  assert.equal(learningSnapshot.assumptions['learning.cycles'].value, 4);
  assert.equal(learningSnapshot.comparison.assumptions['comparison.startsAt'].value, pin.asOf);
  await writeJson('learning-snapshot.json', learningSnapshot, 8 * 1024 * 1024);
  const generatorCli = await load('scripts/gcsp/generate-learning-records.mjs');
  let generatorOutput = ''; let generatorError = '';
  const seed = 'fucq115-canonical-80x4-v1';
  const generatorCode = await generatorCli.runCli({ argv: ['--snapshot', join(output, 'learning-snapshot.json'),
    '--seed', seed, '--output', join(output, 'generated'), '--allow-fixtures'],
    write: (s) => { generatorOutput += s; }, writeError: (s) => { generatorError += s; } });
  assert.equal(generatorCode, 0, generatorError);
  const generated = JSON.parse(generatorOutput);
  const dataset = { manifest: JSON.parse(await readFile(generated.manifestPath)), records: JSON.parse(await readFile(generated.recordsPath)) };
  assert.equal(dataset.records.length, 320); good(records.readLearningDataset(dataset));
  report.datasetFile = await writeJson('choice-training-dataset.json', dataset);
  report.dataset = { records: dataset.records.length, dataHash: dataset.manifest.dataHash, seed,
    counts: dataset.manifest.counts, snapshotHash: learningSnapshot.snapshotHash,
    configurationSource: learningSnapshot.comparison.configurationSource.kind };
  assert.equal(report.dataset.configurationSource, 'reviewed-fixtures');
  report.checks.push('actual113 canonical loadLearningPolicy and published generator CLI; manifest-backed 320-record structural-configuration synthetic dataset');
  phase = 'projection-and-partition';
  const settings = good(await model.loadChoiceTrainingPolicy({ policyService: readPolicy, policyRead: pin }));
  const projection = model.projectLearningChoices(dataset, { readLearningDataset: records.readLearningDataset,
    featureVersion: settings.featureVersion, cohortField: settings.split.cohortField });
  report.exclusions = projection.exclusions;
  const support = {};
  for (const example of projection.examples) {
    const key = JSON.stringify([example.cycle.index, example.cohort]); support[key] = (support[key] ?? 0) + 1;
  }
  report.usableChoiceSupport = support;
  const partition = model.splitChoiceExamples(projection.examples, settings.split);
  report.partition = partition.manifest;
  report.checks.push('actual choice projection; earlier-cycle training; later familiar and G8-10 unseen holdouts; leakage guards');
  phase = 'actual-baselines-and-training';
  const result = await model.trainChoiceDataset({ dataset, readLearningDataset: records.readLearningDataset,
    policyService: readPolicy, policyRead: pin,
    prepareBaselines: (input) => model.prepareActualChoiceBaselines({ ...input, policyService: readPolicy, policyRead: pin }) });
  const artifactDirectory = join(output, 'artifacts');
  const artifact = await model.writeModelArtifact(artifactDirectory, result.artifact);
  const repeated = await model.writeModelArtifact(artifactDirectory, result.artifact);
  assert.equal(repeated.reused, true);
  report.artifact = { artifactId: artifact.artifactId, filename: `${artifact.artifactId.slice(7)}.json`, bytes: (await stat(artifact.path)).size };
  report.evaluationFile = await writeJson('evaluation-summary.json', result.summary, 2 * 1024 * 1024);
  report.metrics = Object.fromEntries(Object.entries(result.summary.metrics).map(([key, value]) => [key, value.overall]));
  report.deltas = result.summary.deltas;
  report.checks.push('actual99 training-brief demand and actual29 deterministic scorer; learned held-out metrics; immutable content-addressed artifact');
  phase = 'training-cli';
  const trainingCli = await load('scripts/gcsp/train-choice-model.mjs');
  let cliOutput = ''; let cliError = '';
  const cliCode = await trainingCli.runCli({ argv: ['--dataset', join(output, 'choice-training-dataset.json'),
    '--policy-file', join(output, 'training-policy.json'), '--policy-version', pin.policyVersion,
    '--run-id', pin.runId, '--as-of', pin.asOf, '--output', artifactDirectory],
    write: (s) => { cliOutput += s; }, writeError: (s) => { cliError += s; } });
  assert.equal(cliCode, 0, cliError);
  assert.equal(JSON.parse(cliOutput).artifactId, artifact.artifactId);
  report.checks.push('actual training CLI on retained dataset/policy reproduces artifact');
  phase = 'isolated-model-activation';
  await nextSecond();
  const activationCommand = { commandId: 'fucq115-activate-trained-model', expectedActiveVersion: pin.policyVersion,
    policyVersion: 'fucq115-trained-choice-v5', effectiveFrom: (await read()).asOf,
    changes: [{ table: 'assumptions', key: 'choice.model.reference', patch: {
      value: { artifactId: artifact.artifactId, schemaVersion: 1, featureVersion: settings.featureVersion },
      status: 'assumed', basis: 'Isolated actual-generator synthetic-trained engineering trial; no BMW employee calibration.',
      source: 'docs/gcsp/models/fucq115-contract.md', sourceDate: '2026-11-06' } }] };
  good(await runtime.policy.publishPolicyVersion(greg, activationCommand));
  assert.equal((await request('/api/gcsp/context')).policyVersion, activationCommand.policyVersion);
  const activated = good(await model.readActiveChoiceModel({ policyService: readPolicy, policyRead: await read(), artifactDirectory }));
  assert.equal(activated.artifact.artifactId, artifact.artifactId);
  assert.equal(good(await readPolicy.getAssumption('choice.model.reference', pin)).value.artifactId, 'unavailable');
  const historyHash = inputDigest(store.runs.get(greg.runId));
  good(await runtime.policy.publishPolicyVersion(greg, activationCommand));
  assert.equal(inputDigest(store.runs.get(greg.runId)), historyHash);
  report.activationFile = await writeJson('activation-command.json', activationCommand, 16384);
  report.checks.push('isolated actual dated model-reference publication/activation; active artifact verified; historical reference unchanged; retry append-once');
  report.status = 'evaluated';
} catch (error) {
  report.status = 'unavailable';
  report.failure = { phase, name: error?.name ?? 'Error', code: error?.code ?? null, field: error?.field ?? null,
    message: String(error?.message ?? 'Unknown failure').slice(0, 1024) };
  process.exitCode = 2;
} finally {
  try { await runtime?.close(); } finally { await readPolicy?.close(); }
  await writeJson('run-summary.json', report, 2 * 1024 * 1024);
  console.log(JSON.stringify(report));
}
