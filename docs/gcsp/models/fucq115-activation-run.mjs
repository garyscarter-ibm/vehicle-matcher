// Proposed finite activation proof. Execute only after exact dispatcher review.
// Existing artifact only: no generator, baseline, training or settings change.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
const report = { schemaVersion: 1, story: 'FUCQ-115', variant: 'retained-artifact-activation-v1', status: 'incomplete',
  unreached: ['Fresh scoped/full integration', 'Live/native/corpus/calibration proof'],
  configurationSource: 'reviewed-fixtures', label: 'Synthetic engineering trial; no BMW calibration or live producer proof', checks: [] };
let runtime; let readPolicy; let phase = 'canonical-bootstrap';
await mkdir(output, { recursive: false });
try {
  const [{ PolicyService, MemoryPolicyProvider, createMemoryPolicyStore }, { createGcspRuntime },
    { createGcspHandler }, model, { inputDigest }] = await Promise.all([
    load('server/gcsp/policy/index.js'), load('server/gcsp/runtime.js'), load('server/gcsp/identity/http.js'),
    load('server/gcsp/predict/model/index.js'), load('server/gcsp/repository/index.js'),
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
  phase = 'retained-artifact-readback';
  const capturedBytes = await readFile(join(mirror, 'docs/gcsp/models/choice-training-policy.json'));
  assert.equal(bytesHash(capturedBytes), 'c2079525f409b0b8b94e23d2fbd0b0b8cba0dfe54bc22d46476ae3ec8a3b0f85');
  const captured = JSON.parse(capturedBytes);
  assert.equal(inputDigest(snapshot), inputDigest(captured));
  assert.equal(pin.asOf, '2026-11-06T09:00:02.000Z');
  const artifactId = 'sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d';
  const artifactDirectory = join(mirror, 'docs/gcsp/models/artifacts');
  const artifactPath = join(artifactDirectory, `${artifactId.slice(7)}.json`);
  const artifactBytes = await readFile(artifactPath);
  const artifactSHA256 = 'a2ee4271a91a2a02182fa9d5797acd7723a9bc776207aad19f5190cb223ddd86';
  assert.equal(bytesHash(artifactBytes), artifactSHA256);
  const artifact = model.verifyModelArtifact(JSON.parse(artifactBytes));
  assert.equal(artifact.artifactId, artifactId);
  assert.equal(artifact.payload.policyVersion, pin.policyVersion);
  assert.equal(artifact.payload.provenance.label, 'synthetic-trained');
  assert.equal(artifact.payload.trainingManifest.dataHash, '93a5146fcfe3c242ca713dd8964a8a56f8408c406daa708faeb223ca010bdf59');
  assert.equal(artifact.payload.trainingSettings.regularization, 0.001);
  const settings = good(await model.loadChoiceTrainingPolicy({ policyService: readPolicy, policyRead: pin }));
  assert.equal(settings.regularization, 0.001);
  assert.equal(artifact.payload.featureVersion, settings.featureVersion);
  assert.equal(good(await readPolicy.getAssumption('choice.model.reference', pin)).value.artifactId, 'unavailable');
  assert.equal((await model.readActiveChoiceModel({ policyService: readPolicy, policyRead: pin, artifactDirectory })).status, 'unavailable');
  report.artifact = { artifactId, fileSHA256: artifactSHA256, bytes: artifactBytes.length,
    trainingPolicyVersion: artifact.payload.policyVersion, optimizer: artifact.payload.optimizer };
  report.checks.push('Re-established actual v4 snapshot matches captured training policy; existing artifact content/provenance/settings verified; unavailable v4 reference retained');
  phase = 'scheduled-model-reference-publication';
  const activationCommand = { commandId: 'fucq115-activate-retained-model', expectedActiveVersion: pin.policyVersion,
    policyVersion: 'fucq115-trained-choice-v5', effectiveFrom: '2026-11-06T09:00:03.000Z',
    changes: [{ table: 'assumptions', key: 'choice.model.reference', patch: {
      value: { artifactId, schemaVersion: 1, featureVersion: settings.featureVersion },
      status: 'assumed', basis: 'Synthetic-trained engineering artifact; thin vehicle choices, worse Brier than both baselines, optimizer iteration-limit. No BMW calibration.',
      source: 'docs/gcsp/models/fucq115-evaluation-result.md', sourceDate: '2026-11-06' } }] };
  report.activationFile = await writeJson('activation-command.json', activationCommand, 16384);
  const published = good(await runtime.policy.publishPolicyVersion(greg, activationCommand));
  assert.equal(published.policyVersion, activationCommand.policyVersion);
  assert.equal((await request('/api/gcsp/context')).policyVersion, pin.policyVersion);
  const historyHash = inputDigest(store.runs.get(greg.runId));
  good(await runtime.policy.publishPolicyVersion(greg, activationCommand));
  assert.equal(store.runs.get(greg.runId).length, 5);
  assert.equal(inputDigest(store.runs.get(greg.runId)), historyHash);
  assert.equal((await model.readActiveChoiceModel({ policyService: readPolicy, policyRead: await read(), artifactDirectory })).status, 'unavailable');
  report.checks.push('Actual publishPolicyVersion schedules only the model reference at09:00:03; same-cookie09:00:02 context remains v4; retry append-once');
  phase = 'dated-model-reference-activation';
  await nextSecond();
  assert.equal((await read()).asOf, activationCommand.effectiveFrom);
  assert.equal((await request('/api/gcsp/context')).policyVersion, activationCommand.policyVersion);
  const activatedRead = { ...await read(), policyVersion: activationCommand.policyVersion };
  const activeResult = await model.readActiveChoiceModel({ policyService: readPolicy, policyRead: activatedRead, artifactDirectory });
  const activated = good(activeResult);
  assert.equal(activeResult.policyVersion, activationCommand.policyVersion);
  assert.equal(activated.artifact.artifactId, artifactId);
  assert.deepEqual(activated.artifact, artifact);
  assert.equal(activated.activation.status, 'assumed');
  assert.equal(activated.activation.sourceDate, activationCommand.changes[0].patch.sourceDate);
  const latest = good(await readPolicy.getPolicySnapshot(activatedRead));
  const normalizeRows = (rows) => rows.map(({ policyVersion, ...row }) => row);
  for (const table of Object.keys(snapshot).filter((key) => Array.isArray(snapshot[key]))) {
    const previous = table === 'assumptions' ? snapshot[table].filter((row) => row.key !== 'choice.model.reference') : snapshot[table];
    const next = table === 'assumptions' ? latest[table].filter((row) => row.key !== 'choice.model.reference') : latest[table];
    assert.equal(inputDigest(normalizeRows(previous)), inputDigest(normalizeRows(next)), `Only model reference changes: ${table}`);
  }
  assert.equal(inputDigest(good(await readPolicy.getPolicySnapshot(pin))), inputDigest(captured));
  assert.equal(good(await readPolicy.getActiveVersion({ runId: pin.runId, asOf: pin.asOf })).policyVersion, pin.policyVersion);
  assert.equal(good(await readPolicy.getAssumption('choice.model.reference', pin)).value.artifactId, 'unavailable');
  assert.equal((await model.readActiveChoiceModel({ policyService: readPolicy, policyRead: pin, artifactDirectory })).status, 'unavailable');
  good(await runtime.policy.publishPolicyVersion(greg, activationCommand));
  assert.equal(inputDigest(store.runs.get(greg.runId)), historyHash);
  assert.equal(bytesHash(await readFile(artifactPath)), artifactSHA256);
  report.activation = { policyVersion: activeResult.policyVersion, effectiveFrom: activatedRead.asOf,
    reference: activated.activation, historicalPolicyVersion: pin.policyVersion, historicalReference: 'unavailable' };
  report.checks.push('Same-cookie clock transition activates retained content-addressed artifact through actual PolicyService; historical v4 and all unrelated rows unchanged; artifact bytes unchanged; retry append-once');
  report.status = 'activated';
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
