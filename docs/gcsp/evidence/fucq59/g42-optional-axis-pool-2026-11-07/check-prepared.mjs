/** Reconstruct every optional-axis candidate from the actual48 G42 pilot cores. Zero HTTP. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { validatePublicBmwPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwBatchPlanRequestUrls, validateBmwModelAxisBatchCandidateDefinitions } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
globalThis.fetch = async () => { throw new Error('offline G42 optional pool forbids source traffic'); };
const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const pathFor = path => isAbsolute(path) ? path : join(root, path);
const read = path => JSON.parse(readFileSync(pathFor(path))); const sha = path => createHash('sha256').update(readFileSync(pathFor(path))).digest('hex');
const series = read(join(base, 'series-plan.json')); const manifest = read(join(base, 'candidate-manifest.json')); const need = read(join(base, 'observed-need.json'));
assert.equal(sha(join(base, 'candidate-manifest.json')), series.candidateManifestSha256); assert.equal(sha(join(base, 'observed-need.json')), series.observedNeedSha256);
for (const [path, expected] of Object.entries({ ...series.codePins, ...series.sourcePins })) assert.equal(sha(path), expected, path);
const indexes = {};
for (const [name, pin] of Object.entries(series.indexPins)) {
  assert.equal(sha(pin.path), pin.sha256); indexes[name] = read(pin.path); assert.equal(inputDigest(indexes[name]), pin.digest); assert.equal(indexes[name].entries.length, pin.entries);
}
assert.deepEqual(series.baseline, { canonical: 1974, admittedSource: 1971, spent: 2684 });
assert.equal(indexes.canonical.entries.filter(row => row.origins.some(origin => origin.kind === 'admitted-source')).length, 1971);
const spent = new Set(indexes.spent.entries.map(row => row.requestDigest)); assert.equal(spent.size, 2684);
const proof = read(need.sourceProof.path); assert.equal(sha(need.sourceProof.path), need.sourceProof.sha256);
assert.deepEqual(proof.retainedProof.tests, { fail: 0, pass: 58, skipped: 0, tests: 58 }); assert.equal(proof.retainedProof.identityUnchanged, true);
assert.equal(proof.cumulative.canonicalSha256, series.indexPins.canonical.sha256); assert.equal(proof.cumulative.spentSha256, series.indexPins.spent.sha256);
assert.deepEqual(manifest.fixedExcludedCodes, ['S01H0', 'S0337', 'S033B', 'S07MU']); assert.deepEqual(manifest.optionalPackageAllowlist, ['S07A2', 'S07VK']);
const expected = new Map(); const perModel = {}; let cores = 0;
for (const context of manifest.contexts) {
  const model = context.modelRegistration.modelCode; const options = read(context.typedBasis.path);
  assert.equal(sha(context.typedBasis.path), context.typedBasis.sha256); assert.equal(options.observation.transportKind, 'live');
  const definitions = options.report.candidates[0].definitions.filter(row => row.issues.length === 0 && row.option === row.code && row.pointer === '/' + row.code);
  assert.deepEqual(definitions, context.typedDefinitions); assert.equal(context.modelRegistration.catalogueRangeKey, 'G42');
  const query = context.lineRegistration.optionsQuery; const mandatory = query.kind === 'trim' ? [query.code] : []; assert.deepEqual(mandatory, context.mandatory);
  const urls = bmwBatchPlanRequestUrls({ source: { version: 'f59-model-axis-batch-20261107.v1' }, modelRegistration: context.modelRegistration, lineRegistration: context.lineRegistration });
  assert.deepEqual(options.observation.request, { method: 'GET', url: urls.options });
  const actualPlan = read(context.actualPlan.path); const primary = read(context.actualPrimary.path); const state = primary.content;
  assert.equal(primary.contentDigest, inputDigest(state)); assert.equal(sha(context.actualPrimary.path), read(context.actualReceipt.path).checkpointSha256);
  assert.deepEqual(actualPlan.modelRegistration, context.modelRegistration); assert.deepEqual(actualPlan.lineRegistration, context.lineRegistration);
  assert.equal(state.accepted.length, 8); assert.equal(state.duplicates.length, 0); assert.equal(state.rejected.length, 0);
  const accepted = readFileSync(pathFor(context.accepted.path), 'utf8').trim().split('\n').map(JSON.parse); assert.deepEqual(accepted, state.accepted);
  const defaults = new Set(); const coreDigests = new Set();
  for (const core of context.baseCores) {
    cores++; assert.equal(coreDigests.has(core.coreDigest), false); coreDigests.add(core.coreDigest);
    assert.equal(inputDigest({ modelRegistration: context.modelRegistration, baseCore: core.inputs }), core.coreDigest);
    const record = accepted.find(row => inputDigest(row.canonicalIdentity) === core.actualCanonicalDigest); assert.ok(record);
    assert.equal(record.configurationId, core.actualConfigurationId); assert.equal(record.admission, true); assert.equal(record.sourceKind, 'dated-snapshot');
    assert.equal(record.canonicalIdentity.vgModelCode, model); assert.equal(record.canonicalIdentity.agModelCode, context.modelRegistration.agModelCode);
    assert.equal(record.sourceEvidence.solver, core.sourceSelectionSha256); assert.equal(sha(core.sourceSolverPath), core.sourceSelectionSha256);
    const capture = state.sourceCaptures.find(row => row.solver.sha256 === core.sourceSelectionSha256); assert.ok(capture); assert.equal(capture.candidateId, core.actualCandidateId);
    assert.deepEqual(actualPlan.candidates.find(row => row.candidateId === core.actualCandidateId).request, core.actualCandidateRequest);
    const selected = record.canonicalIdentity.factoryOptionCodes;
    const inputs = ['paint', 'fabric', 'rim'].map(type => { const values = definitions.filter(row => row.optionType === type && selected.includes(row.code)); assert.equal(values.length, 1); return values[0].code; }).sort();
    assert.deepEqual(inputs, core.inputs); assert.equal(inputs.includes('S01H0'), false);
    assert.deepEqual(core.actualCandidateRequest, { includedElements: [...inputs, ...mandatory].sort(), mandatoryElements: mandatory });
    const axes = definitions.filter(row => ['trim', 'package'].includes(row.optionType) && selected.includes(row.code)).map(row => row.code).sort();
    assert.deepEqual(axes, core.observedAxisSelection); axes.forEach(code => defaults.add(code));
  }
  assert.equal(context.baseCores.length, 8); assert.deepEqual([...defaults].sort(), context.observedDefaultAxisCodes);
  const axes = Object.fromEntries(['trim', 'package'].map(type => [type, definitions.filter(row => row.optionType === type && !defaults.has(row.code) && !mandatory.includes(row.code)
    && !manifest.fixedExcludedCodes.includes(row.code) && (type !== 'package' || manifest.optionalPackageAllowlist.includes(row.code))).map(row => row.code).sort()]));
  assert.deepEqual(axes, context.additionalAxes); assert.deepEqual(axes.package, ['S07A2', 'S07VK']); let count = 0;
  for (const core of context.baseCores) for (const trim of [null, ...axes.trim]) for (const packageCode of [null, ...axes.package]) {
    const optionalInputs = [trim, packageCode].filter(Boolean).sort(); if (!optionalInputs.length) continue;
    const request = { includedElements: [...core.inputs, ...mandatory, ...optionalInputs].sort(), mandatoryElements: mandatory };
    const digest = inputDigest({ modelRegistration: context.modelRegistration, request }); assert.equal(spent.has(digest) || expected.has(digest), false);
    expected.set(digest, { coreDigest: core.coreDigest, optionalInputs }); count++;
  }
  perModel[model] = count; assert.equal(context.counts.unspent, count); assert.equal(context.counts.actualCores, 8);
}
assert.equal(cores, 48); assert.equal(expected.size, 768); assert.deepEqual(perModel, { '2PMA': 136, '2PMB': 136, '2PPA': 136, '2PPB': 136, '2PMC': 112, '2PBC': 112 });
assert.deepEqual(manifest.perModelCandidates, perModel);
const bases = new Map(manifest.requestBases.map(({ requestDigest, ...basis }) => [requestDigest, basis])); assert.equal(bases.size, 768);
const seen = new Set(); let gets = 0;
for (const [index, entry] of series.chunks.entries()) {
  assert.deepEqual(entry, manifest.chunks[index]); assert.equal(entry.number, index + 1);
  const plan = read(entry.templatePath); assert.equal(sha(entry.templatePath), entry.templateSha256); assert.equal(inputDigest(plan), entry.planDigest); validatePublicBmwPlan(plan);
  assert.equal(plan.source.version, 'f59-model-axis-batch-20261107.v1'); assert.equal(plan.qualificationDate, '2026-11-07');
  assert.ok(entry.candidates >= 1 && entry.candidates <= 8); assert.equal(plan.candidates.length, entry.candidates); assert.equal(entry.maximumGets, entry.candidates + 4); gets += entry.maximumGets;
  assert.equal(plan.limits.sourceAttempts, entry.maximumGets); const context = manifest.contexts.find(row => row.modelRegistration.modelCode === entry.modelCode);
  assert.deepEqual(plan.modelRegistration, context.modelRegistration); assert.deepEqual(plan.lineRegistration, context.lineRegistration); const digests = [];
  for (const candidate of plan.candidates) {
    const digest = inputDigest({ modelRegistration: plan.modelRegistration, request: candidate.request }); digests.push(digest); assert.equal(seen.has(digest) || spent.has(digest), false); seen.add(digest);
    assert.deepEqual(bases.get(digest), expected.get(digest));
    const optional = validateBmwModelAxisBatchCandidateDefinitions(candidate.request, { model: plan.modelRegistration, line: plan.lineRegistration }, context.typedDefinitions).sort(); assert.deepEqual(optional, expected.get(digest).optionalInputs);
    const url = new URL(bmwBatchPlanRequestUrls(plan, candidate.request).solve); assert.equal(url.searchParams.get('included-elements'), candidate.request.includedElements.join(',')); assert.equal(url.searchParams.has('mandatory-elements'), true); assert.equal(url.searchParams.get('mandatory-elements'), candidate.request.mandatoryElements.join(','));
  }
  assert.deepEqual(digests, entry.requestDigests);
}
assert.equal(seen.size, 768); assert.equal(series.candidateAllowance, 768); assert.equal(series.chunks.length, 96); assert.equal(gets, 1152); assert.equal(series.attemptAllowance, gets);
assert.deepEqual(need.illustrativeUnspentRequests.map(row => row.requestDigest), series.chunks.slice(0, 6).flatMap(entry => entry.requestDigests)); assert.equal(need.illustrativeUnspentRequests.length, 48);
assert.equal(series.sourceTrafficGranted, false); assert.equal(series.trafficExecuted, false); assert.equal(series.capacityCredit, 0); assert.equal(series.acceptance, false);
assert.equal(existsSync(series.outputRootForLaterRelease), false); assert.equal(existsSync(join(base, 'run-series.py')), false); assert.equal(existsSync(join(base, 'parent-release.json')), false);
console.log(JSON.stringify({ status: 'prepared-only', actualCores: cores, unspentPool: seen.size, perModel, sessions: 96, illustrativeRequests: 48, wholeGetCeiling: gets, sourceTraffic: 0, sourceOutputAbsent: true, sourceTrafficGranted: false, capacityCredit: 0, baseline: series.baseline }));
