/** Complete frozen pool and exact operational boundaries. Network is forbidden. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { validatePublicBmwPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwBatchPlanRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';

globalThis.fetch = async () => { throw new Error('forbidden-offline-model-axis-traffic'); };
const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = p => JSON.parse(readFileSync(p)); const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const series = read(join(base, 'series-plan.json')); const manifest = read(join(base, 'candidate-manifest.json'));
for (const [p, expected] of Object.entries(series.codePins)) assert.equal(sha(join(root, p)), expected, p);
for (const [p, expected] of Object.entries(series.sourcePins)) assert.equal(sha(join(root, p)), expected, p);
assert.equal(sha(join(base, 'candidate-manifest.json')), series.candidateManifestSha256);
assert.equal(sha(join(base, 'scheme-context-gaps.json')), series.schemeContextGapsSha256);
const indexes = {};
for (const [name, pin] of Object.entries(series.indexPins)) {
  assert.equal(sha(pin.path), pin.sha256); indexes[name] = read(pin.path);
  assert.equal(inputDigest(indexes[name]), pin.digest); assert.equal(indexes[name].entries.length, pin.entries);
}
assert.equal(indexes.canonical.entries.length, 1136);
assert.equal(indexes.canonical.entries.filter(r => r.origins.some(o => o.kind === 'admitted-source')).length, 1133);
assert.equal(indexes.spent.entries.length, 1846);
const spent = new Set(indexes.spent.entries.map(r => r.requestDigest)); assert.equal(spent.size, 1846);
const expected = new Set(); const excluded = new Map(); let cartesian = 0; let deferred = 0; let previouslySpent = 0;
assert.deepEqual(manifest.contexts.map(c => c.modelRegistration.modelCode), ['1F7A', '1F7C', '1F7D', '1F7F']);
for (const context of manifest.contexts) {
  const observed = read(join(root, context.typedBasisPath)); assert.equal(sha(join(root, context.typedBasisPath)), context.typedBasisSha256);
  assert.equal(observed.observation.transportKind, 'live'); assert.equal(observed.report.status, 'typed-definitions-observed');
  const qualified = read(join(root, context.typedBasisPath.replace('options.json', 'qualification-plan.json')));
  assert.deepEqual(context.modelRegistration, qualified.modelRegistration); assert.deepEqual(context.lineRegistration, qualified.lineRegistration);
  assert.equal(context.modelRegistration.catalogueRangeKey, 'F70'); assert.equal(context.modelRegistration.rawModelRange, 'F70');
  assert.deepEqual(context.modelRegistration.aliases, ['1']); assert.equal(context.modelRegistration.steering, 'RL');
  assert.equal(context.modelRegistration.orderDate, '2026-11-01'); assert.equal(context.modelRegistration.effectDate, '2027-01-05');
  const definitions = observed.report.candidates[0].definitions;
  const axes = Object.fromEntries(['paint', 'fabric', 'rim'].map(type => [type, definitions.filter(r => r.optionType === type && r.issues.length === 0 && r.option === r.code).map(r => r.code).sort()]));
  assert.deepEqual(context.axes, axes);
  const query = context.lineRegistration.optionsQuery; const mandatory = query.kind === 'trim' ? [query.code] : [];
  for (const paint of axes.paint) for (const fabric of axes.fabric) for (const rim of axes.rim) {
    cartesian++; const request = { includedElements: [paint, fabric, rim, ...mandatory].sort(), mandatoryElements: mandatory };
    const digest = inputDigest({ modelRegistration: context.modelRegistration, request });
    if (rim === 'S01H0') { deferred++; excluded.set(digest, 'S01H0-explicit-deferral'); }
    else if (spent.has(digest)) { previouslySpent++; excluded.set(digest, 'already-spent-cumulative-index'); }
    else { assert.equal(expected.has(digest), false); expected.add(digest); }
  }
}
assert.deepEqual([cartesian, deferred, previouslySpent, expected.size], [996, 202, 4, 790]);
assert.equal(manifest.excludedRequests.length, 206);
for (const row of manifest.excludedRequests) {
  const context = manifest.contexts.find(c => c.modelRegistration.modelCode === row.modelCode);
  assert.equal(inputDigest({ modelRegistration: context.modelRegistration, request: row.request }), row.requestDigest);
  assert.equal(excluded.get(row.requestDigest), row.reason); excluded.delete(row.requestDigest);
}
assert.equal(excluded.size, 0);
const seen = new Set(); const perModel = {}; let gets = 0;
for (const [index, entry] of series.chunks.entries()) {
  assert.equal(entry.number, index + 1); assert.deepEqual(entry, manifest.chunks[index]);
  const template = join(root, entry.templatePath); const plan = read(template);
  assert.equal(sha(template), entry.templateSha256); assert.equal(inputDigest(plan), entry.planDigest);
  validatePublicBmwPlan(plan);
  assert.equal(plan.qualificationDate, new Date().toISOString().slice(0, 10));
  assert.equal(plan.source.version, 'f59-model-batch-20261107.v1'); assert.ok(plan.candidateCount >= 1 && plan.candidateCount <= 8);
  assert.equal(plan.candidateCount, entry.candidates); assert.equal(plan.limits.sourceAttempts, entry.maximumGets); assert.equal(plan.limits.maxAttempts, 1);
  const context = manifest.contexts.find(c => c.modelRegistration.modelCode === entry.modelCode);
  assert.deepEqual(plan.modelRegistration, context.modelRegistration); assert.deepEqual(plan.lineRegistration, context.lineRegistration);
  const digests = [];
  for (const candidate of plan.candidates) {
    assert.equal(candidate.request.includedElements.includes('S01H0'), false);
    const digest = inputDigest({ modelRegistration: plan.modelRegistration, request: candidate.request }); digests.push(digest);
    assert.equal(spent.has(digest) || seen.has(digest), false); assert.equal(expected.has(digest), true); seen.add(digest);
    const actualUrls = bmwBatchPlanRequestUrls(plan, candidate.request);
    const solve = new URL(actualUrls.solve); const options = new URL(actualUrls.options);
    assert.equal(solve.searchParams.get('included-elements'), candidate.request.includedElements.join(','));
    assert.equal(solve.searchParams.get('mandatory-elements'), candidate.request.mandatoryElements.join(','));
    assert.equal(options.searchParams.get('trim'), context.lineRegistration.optionsQuery.kind === 'trim' ? context.lineRegistration.optionsQuery.code : null);
  }
  assert.deepEqual(digests, entry.requestDigests); assert.equal(existsSync(entry.outputDirectory), false);
  perModel[entry.modelCode] = (perModel[entry.modelCode] || 0) + entry.candidates; gets += entry.maximumGets;
}
assert.deepEqual(perModel, { '1F7A': 143, '1F7C': 324, '1F7D': 194, '1F7F': 129 });
assert.equal(seen.size, expected.size); assert.deepEqual([...seen], manifest.requestDigests);
assert.equal(series.chunks.length, 101); assert.equal(gets, 1194);
for (const cohort of series.cohorts) {
  const entries = series.chunks.filter(e => e.cohort === cohort.number);
  assert.deepEqual(entries.map(e => e.number), cohort.sessions); assert.ok(entries.length <= 4);
  assert.equal(entries.reduce((n, e) => n + e.candidates, 0), cohort.solverCeiling); assert.ok(cohort.solverCeiling <= 32);
  assert.equal(entries.reduce((n, e) => n + e.maximumGets, 0), cohort.getCeiling); assert.ok(cohort.getCeiling <= 48);
}
for (const [name, count, attempts] of [['pilot', 32, 48], ['suffix', 758, 1146]]) {
  const entries = series.chunks.filter(e => e.phase === name); const phase = series.phases[name];
  assert.equal(entries.reduce((n, e) => n + e.candidates, 0), count); assert.equal(phase.solverCeiling, count);
  assert.equal(entries.reduce((n, e) => n + e.maximumGets, 0), attempts); assert.equal(phase.getCeiling, attempts);
  assert.deepEqual(entries.map(e => e.number), phase.sessions); assert.equal(phase.separateExactParentReleaseRequired, true);
  assert.equal(phase.clockStartsAtConsumedMarkerAfterRelease, true);
}
assert.equal(existsSync(series.outputRoot), false); assert.equal(series.trafficExecuted, false); assert.equal(series.capacityCredit, 0);
assert.equal(series.acceptance, false); assert.equal(series.noAutomaticContinuation, true);
for (const path of ['supervise.py', 'verify-retained.py']) assert.equal(readFileSync(join(base, path), 'utf8').includes('scratch.root ='), false);
for (const phase of ['pilot', 'suffix']) {
  const refused = spawnSync('/usr/bin/python3', ['-I', '-B', join(base, 'run-series.py'), phase], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP },
  });
  assert.equal(refused.status, 1); assert.match(refused.stderr, /separate exact parent phase traffic grant required/);
  assert.equal(existsSync(series.outputRoot), false);
}
console.log(JSON.stringify({ status: 'prepared-only', sourceTraffic: 0, baseline: series.baseline,
  trueUnspentPool: 790, explicitS01H0Exclusions: 202, alreadySpentExclusions: 4, models: perModel,
  sessions: 101, cohorts: series.cohorts.length, pilot: { solverCeiling: 32, getCeiling: 48 },
  suffix: { solverCeiling: 758, getCeiling: 1146 }, wholeGetCeiling: gets, sourceOutputAbsent: true, bothMissingGrantsRefused: true, capacityCredit: 0 }));
