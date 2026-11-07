/** Scoped reconstruction of the executable 5535-request suffix. No network. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { validatePublicBmwPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwBatchPlanRequestUrls, validateBmwModelAxisBatchCandidateDefinitions } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
globalThis.fetch = async () => { throw new Error('offline suffix forbids source traffic'); };
const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const pathFor = path => isAbsolute(path) ? path : join(root, path);
const read = path => JSON.parse(readFileSync(pathFor(path)));  const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const series = read(join(base, 'series-plan.json')); const manifest = read(join(root, series.candidateManifestPath));
assert.equal(sha(join(root, series.candidateManifestPath)), series.candidateManifestSha256);
for (const [path, expected] of Object.entries({ ...series.codePins, ...series.sourcePins })) assert.equal(sha(pathFor(path)), expected, path);
assert.equal(series.chunks.length, 693); assert.deepEqual(Object.keys(series.phases), ['suffix']);
const bases = new Map(manifest.requestBases.map(row => [row.requestDigest, row])); const seen = new Set(); let gets = 0;
for (const [index, entry] of series.chunks.entries()) {
  const original = manifest.chunks[entry.poolNumber - 1]; assert.equal(entry.poolNumber, index + 5); assert.equal(entry.number, index + 1);
  for (const key of Object.keys(original).filter(key => !['number', 'outputDirectory', 'supervisorOutput'].includes(key))) assert.deepEqual(entry[key], original[key]);
  const plan = read(join(root, entry.templatePath)); assert.equal(sha(join(root, entry.templatePath)), entry.templateSha256); assert.equal(inputDigest(plan), entry.planDigest);
  validatePublicBmwPlan(plan); assert.equal(plan.source.version, 'f59-model-axis-batch-20261107.v1'); assert.equal(plan.qualificationDate, '2026-11-07');
  const context = manifest.contexts.find(row => row.modelRegistration.modelCode === entry.modelCode);
  assert.deepEqual(plan.modelRegistration, context.modelRegistration); assert.deepEqual(plan.lineRegistration, context.lineRegistration);
  const options = read(context.typedBasis.path); assert.equal(sha(context.typedBasis.path), context.typedBasis.sha256);
  assert.equal(options.observation.transportKind, 'live'); assert.ok(plan.candidates.length >= 1 && plan.candidates.length <= 8); assert.equal(plan.candidates.length, entry.candidates); assert.equal(plan.limits.sourceAttempts, entry.maximumGets); assert.equal(entry.maximumGets, entry.candidates + 4); gets += entry.maximumGets;
  const digests = [];
  for (const candidate of plan.candidates) {
    const digest = inputDigest({ modelRegistration: plan.modelRegistration, request: candidate.request }); digests.push(digest);
    assert.equal(seen.has(digest), false); seen.add(digest); const basis = bases.get(digest); assert.ok(basis);
    const core = context.baseCores.find(row => row.coreDigest === basis.coreDigest); assert.ok(core);
    const optional = validateBmwModelAxisBatchCandidateDefinitions(candidate.request, { model: plan.modelRegistration, line: plan.lineRegistration }, context.typedDefinitions).sort();
    assert.deepEqual(optional, basis.optionalInputs); assert.deepEqual(candidate.request.includedElements, [...core.inputs, ...context.mandatory, ...optional].sort());
    const url = new URL(bmwBatchPlanRequestUrls(plan, candidate.request).solve);
    assert.equal(url.searchParams.get('included-elements'), candidate.request.includedElements.join(','));
    assert.equal(url.searchParams.has('mandatory-elements'), true); assert.equal(url.searchParams.get('mandatory-elements'), candidate.request.mandatoryElements.join(','));
  }
  assert.deepEqual(digests, entry.requestDigests); assert.equal(existsSync(entry.outputDirectory), false);
}
assert.equal(seen.size, 5535); assert.equal(gets, 8307); assert.equal(series.candidateAllowance, 5535); assert.equal(series.attemptAllowance, 8307);
const spent = read(series.preparedIndexPins.spent.path); const used = new Set(spent.entries.map(row => row.requestDigest));
for (const digest of seen) assert.equal(used.has(digest), false);
for (const entry of manifest.chunks.slice(0, 4)) for (const digest of entry.requestDigests) { assert.equal(seen.has(digest), false); assert.equal(used.has(digest), true); }
assert.equal(series.resources.workers, 1); assert.equal(series.resources.retainedBudgetBytes, 12 * 1024**3);
assert.equal(series.phases.suffix.maximumWallSeconds, 21600);
assert.equal(series.sourceTrafficGranted, false); assert.equal(series.trafficExecuted, false); assert.equal(series.capacityCredit, 0);
assert.equal(existsSync(series.outputRoot), false); assert.equal(existsSync(join(base, 'parent-release.json')), false);
console.log(JSON.stringify({ status: 'suffix-prepared-only', sessions: 693, candidates: 5535, maximumGets: 8307, sourceTraffic: 0, sourceOutputAbsent: true, capacityCredit: 0 }));
