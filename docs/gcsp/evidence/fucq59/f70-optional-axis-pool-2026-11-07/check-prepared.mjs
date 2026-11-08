/** Independent reconstruction of the finite actual-core pool. No source traffic. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { validatePublicBmwPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwBatchPlanRequestUrls, validateBmwModelAxisBatchCandidateDefinitions } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';

globalThis.fetch = async () => { throw new Error('forbidden-offline-optional-axis-traffic'); };
const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const pathFor = path => isAbsolute(path) ? path : join(root, path);
const read = path => JSON.parse(readFileSync(pathFor(path))); const sha = path => createHash('sha256').update(readFileSync(pathFor(path))).digest('hex');
const series = read(join(base, 'series-plan.json')); const manifest = read(join(base, 'candidate-manifest.json'));
assert.equal(sha(join(base, 'candidate-manifest.json')), series.candidateManifestSha256);
for (const [path, expected] of Object.entries(series.codePins)) assert.equal(sha(path), expected, path);
for (const [path, expected] of Object.entries(series.sourcePins)) assert.equal(sha(path), expected, path);
const indexes = {};
for (const [name, pin] of Object.entries(series.indexPins)) {
  assert.equal(sha(pin.path), pin.sha256); indexes[name] = read(pin.path);
  assert.equal(inputDigest(indexes[name]), pin.digest); assert.equal(indexes[name].entries.length, pin.entries);
}
assert.deepEqual(series.baseline, { canonical: 1974, admittedSource: 1971, spent: 2684 });
assert.equal(indexes.canonical.entries.filter(row => row.origins.some(origin => origin.kind === 'admitted-source')).length, 1971);
const spent = new Set(indexes.spent.entries.map(row => row.requestDigest)); assert.equal(spent.size, 2684);
const cached = new Map();
const loaded = path => { if (!cached.has(path)) cached.set(path, read(path)); return cached.get(path); };
const expected = new Map(); const byModel = {}; let actualCores = 0;
for (const context of manifest.contexts) {
  const model = context.modelRegistration.modelCode; const options = loaded(context.typedBasis.path);
  assert.equal(sha(context.typedBasis.path), context.typedBasis.sha256); assert.equal(options.observation.transportKind, 'live');
  const definitions = options.report.candidates[0].definitions.filter(row => row.issues.length === 0 && row.option === row.code && row.pointer === '/' + row.code);
  assert.deepEqual(definitions, context.typedDefinitions);
  const query = context.lineRegistration.optionsQuery; const mandatory = query.kind === 'trim' ? [query.code] : [];
  assert.deepEqual(context.mandatory, mandatory);
  const urls = bmwBatchPlanRequestUrls({ source: { version: 'f59-model-axis-batch-20261107.v1' }, modelRegistration: context.modelRegistration, lineRegistration: context.lineRegistration });
  assert.deepEqual(options.observation.request, { method: 'GET', url: urls.options });
  const defaults = new Set(); const coreDigests = new Set();
  for (const core of context.baseCores) {
    actualCores++; assert.equal(coreDigests.has(core.coreDigest), false); coreDigests.add(core.coreDigest);
    assert.equal(inputDigest({ modelRegistration: context.modelRegistration, baseCore: core.inputs }), core.coreDigest);
    assert.equal(sha(core.accepted.path), core.accepted.sha256); assert.equal(sha(core.retainedProof.path), core.retainedProof.sha256);
    const proof = loaded(core.retainedProof.path); assert.deepEqual(proof.retainedChecks.summary, { tests: 5, pass: 5, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
    assert.equal(sha(proof.cleanup.retainedPrimary), proof.primarySha256);
    assert.equal(proof.retainedChecks.identity[core.accepted.path], core.accepted.sha256);
    const recordsKey = core.accepted.path + ':records';
    if (!cached.has(recordsKey)) cached.set(recordsKey, readFileSync(pathFor(core.accepted.path), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
    const records = cached.get(recordsKey); const record = records.find(row => inputDigest(row.canonicalIdentity) === core.actualCanonicalDigest);
    assert.ok(record); assert.equal(record.admission, true); assert.equal(record.sourceKind, 'dated-snapshot');
    assert.equal(record.canonicalIdentity.vgModelCode, model); assert.equal(record.canonicalIdentity.agModelCode, context.modelRegistration.agModelCode);
    assert.equal(sha(core.sourceSolverPath), core.sourceSelectionSha256); assert.equal(record.sourceEvidence.solver, core.sourceSelectionSha256);
    const selected = record.canonicalIdentity.factoryOptionCodes;
    const observedCore = ['paint', 'fabric', 'rim'].map(type => {
      const matches = definitions.filter(row => row.optionType === type && selected.includes(row.code)); assert.equal(matches.length, 1); return matches[0].code;
    }).sort(); assert.deepEqual(observedCore, core.inputs); assert.equal(core.inputs.includes('S01H0'), false);
    const axes = definitions.filter(row => ['trim', 'package'].includes(row.optionType) && selected.includes(row.code)).map(row => row.code).sort();
    assert.deepEqual(axes, core.observedAxisSelection); axes.forEach(code => defaults.add(code));
    const actualPlan = loaded(core.actualPlan.path); assert.equal(sha(core.actualPlan.path), core.actualPlan.sha256);
    assert.deepEqual(actualPlan.modelRegistration, context.modelRegistration); assert.deepEqual(actualPlan.lineRegistration, context.lineRegistration);
    assert.deepEqual(actualPlan.candidates.find(row => row.candidateId === core.actualCandidateId).request, core.actualCandidateRequest);
    assert.deepEqual(core.actualCandidateRequest, { includedElements: [...core.inputs, ...mandatory].sort(), mandatoryElements: mandatory });
  }
  assert.deepEqual([...defaults].sort(), context.observedDefaultAxisCodes);
  const axes = Object.fromEntries(['trim', 'package'].map(type => [type, definitions.filter(row => row.optionType === type
    && !defaults.has(row.code) && !mandatory.includes(row.code) && !manifest.fixedExcludedCodes.includes(row.code)).map(row => row.code).sort()]));
  assert.deepEqual(axes, context.additionalAxes); let count = 0;
  for (const core of context.baseCores) for (const trim of [null, ...axes.trim]) for (const packageCode of [null, ...axes.package]) {
    const optional = [trim, packageCode].filter(Boolean).sort(); if (!optional.length) continue;
    const request = { includedElements: [...core.inputs, ...mandatory, ...optional].sort(), mandatoryElements: mandatory };
    const digest = inputDigest({ modelRegistration: context.modelRegistration, request });
    assert.equal(spent.has(digest) || expected.has(digest), false); expected.set(digest, { coreDigest: core.coreDigest, optionalInputs: optional }); count++;
  }
  byModel[model] = count; assert.equal(context.counts.actualCores, context.baseCores.length); assert.equal(context.counts.unspent, count);
}
assert.equal(actualCores, 790); assert.equal(expected.size, 5567);
assert.deepEqual(byModel, { '1F7A': 715, '1F7C': 2268, '1F7D': 1552, '1F7F': 1032 });
assert.deepEqual(manifest.perModelCandidates, byModel);
const requestBases = new Map(manifest.requestBases.map(({ requestDigest, ...basis }) => [requestDigest, basis])); assert.equal(requestBases.size, expected.size);
const seen = new Set(); let gets = 0;
for (const [index, entry] of series.chunks.entries()) {
  assert.deepEqual(entry, manifest.chunks[index]); assert.equal(entry.number, index + 1);
  const plan = read(entry.templatePath); assert.equal(sha(entry.templatePath), entry.templateSha256); assert.equal(inputDigest(plan), entry.planDigest);
  validatePublicBmwPlan(plan); assert.equal(plan.source.version, 'f59-model-axis-batch-20261107.v1'); assert.equal(plan.qualificationDate, '2026-11-07');
  assert.ok(entry.candidates >= 1 && entry.candidates <= 8); assert.equal(plan.candidates.length, entry.candidates);
  assert.equal(entry.maximumGets, entry.candidates + 4); assert.equal(plan.limits.sourceAttempts, entry.maximumGets); gets += entry.maximumGets;
  const context = manifest.contexts.find(row => row.modelRegistration.modelCode === entry.modelCode);
  assert.deepEqual(plan.modelRegistration, context.modelRegistration); assert.deepEqual(plan.lineRegistration, context.lineRegistration);
  const digests = [];
  for (const candidate of plan.candidates) {
    const digest = inputDigest({ modelRegistration: plan.modelRegistration, request: candidate.request }); digests.push(digest);
    assert.equal(seen.has(digest) || spent.has(digest), false); seen.add(digest); assert.deepEqual(requestBases.get(digest), expected.get(digest));
    const optional = validateBmwModelAxisBatchCandidateDefinitions(candidate.request,
      { model: plan.modelRegistration, line: plan.lineRegistration }, context.typedDefinitions).sort();
    assert.deepEqual(optional, expected.get(digest).optionalInputs);
    const actual = bmwBatchPlanRequestUrls(plan, candidate.request); const solve = new URL(actual.solve);
    assert.equal(solve.searchParams.get('included-elements'), candidate.request.includedElements.join(','));
    assert.equal(solve.searchParams.has('mandatory-elements'), true); assert.equal(solve.searchParams.get('mandatory-elements'), candidate.request.mandatoryElements.join(','));
  }
  assert.deepEqual(digests, entry.requestDigests); assert.equal(existsSync(entry.outputDirectory), false);
}
assert.equal(seen.size, expected.size); assert.equal(series.candidateAllowance, 5567); assert.equal(series.attemptAllowance, gets);
const need = read('docs/gcsp/evidence/fucq59/f70-optional-axis-need-2026-11-07/observed-need.json');
const pilot = series.chunks.filter(entry => entry.phase === 'pilot'); assert.equal(pilot.length, 4);
assert.deepEqual(pilot.flatMap(entry => entry.requestDigests), need.illustrativeUnspentRequests.map(row => row.requestDigest));
for (const [name, count] of [['pilot', 32], ['suffix', 5535]]) {
  const entries = series.chunks.filter(entry => entry.phase === name); const phase = series.phases[name];
  assert.equal(entries.reduce((n, entry) => n + entry.candidates, 0), count); assert.equal(phase.solverCeiling, count);
  assert.equal(entries.reduce((n, entry) => n + entry.maximumGets, 0), phase.getCeiling); assert.equal(phase.separateExactParentReleaseRequired, true);
}
for (const cohort of series.cohorts) {
  const entries = series.chunks.filter(entry => entry.cohort === cohort.number);
  assert.deepEqual(entries.map(entry => entry.number), cohort.sessions); assert.ok(cohort.solverCeiling <= 32 && cohort.getCeiling <= 48);
}
assert.equal(series.sourceTrafficGranted, false); assert.equal(series.trafficExecuted, false); assert.equal(series.capacityCredit, 0); assert.equal(series.acceptance, false);
assert.equal(existsSync(series.outputRoot), false); assert.equal(existsSync(join(base, 'run-series.py')), false);
console.log(JSON.stringify({ status: 'prepared-only', actualCores, unspentPool: seen.size, perModel: byModel,
  sessions: series.chunks.length, cohorts: series.cohorts.length, pilot: { solver: 32, gets: 48 },
  suffix: { solver: 5535, gets: series.phases.suffix.getCeiling }, wholeGetCeiling: gets, sourceTraffic: 0,
  baseline: series.baseline, sourceOutputAbsent: true, sourceTrafficGranted: false, capacityCredit: 0 }));
