import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { offlineEgressGuard } from './helpers/offline-egress-guard.js';

// A false-ready decision is the production regression these tests distinguish.
const api = await import('../../scripts/gcsp/demo-plan.mjs').catch((error) => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const available = typeof api.validateDemoPlan === 'function';
const matrixText = await readFile(new URL('../../docs/gcsp/sources/choices-eligibility-matrices-2024-10.md', import.meta.url), 'utf8');
const check = (name, run) => test(name, { skip: !available }, run);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const evidenceCheck = () => true; // Fixture evidence adapter; never a real source qualification.
const draft = () => api.createDemoPlan(matrixText, { asOfDate: '2026-11-06' });
function completeFixture() {
  const plan = draft();
  plan.modelLines.forEach((line, index) => {
    const model = `V${String(index).padStart(3, '0')}`;
    line.mapping = { status: 'mapped', modelRange: `R${index}`, vgModelCode: model, agModelCode: `A${index}`,
      evidence: { sourceRef: 'fixture-only.json', sha256: 'a'.repeat(64), locator: `models/${index}`,
        observedDate: '2026-11-06', kind: 'observed', market: 'GB', matrixModel: line.model,
        engine: line.engine, modelRange: `R${index}`, vgModelCode: model, agModelCode: `A${index}` } };
  });
  return plan;
}

test('offline demo plan API exists before readiness can be asserted', () => {
  assert.equal(typeof api.validateDemoPlan, 'function');
  assert.equal(typeof api.assertDemoPlanReady, 'function');
});

check('keeps all 132 matrix source rows and 74 atomic lines with exact provenance', () => {
  const plan = draft();
  assert.equal(plan.source.sha256, digest(matrixText));
  assert.equal(plan.sourceRows.length, 132);
  assert.equal(plan.modelLines.length, 74);
  for (const row of plan.sourceRows) assert.equal(matrixText.split('\n')[row.sourceLine - 1], row.sourceText);
  assert.equal(api.validateDemoPlan(plan, { matrixText }).valid, true);
});

check('preserves scheme-specific grades and the X6 M60i towbar disagreement', () => {
  const plan = draft();
  const x6 = plan.modelLines.find((line) => line.model === 'G06 X6' && line.engine === 'xDrive M60i');
  assert.deepEqual(x6.eligibility.map(({ scheme, towbar }) => [scheme, towbar]), [['fs-uk', true], ['rr-production', false]]);
  const m135 = plan.modelLines.find((line) => line.engine === 'M135');
  assert.equal(m135.eligibility[0].grades['G1-6'], false);
  assert.equal(m135.eligibility[1].grades.PG1, true);
  assert.ok(plan.modelLines.find((line) => line.model === 'U11 X1' && line.engine === '20d').eligibility.every((row) => row.scheme === 'rr-production'));
});

check('unknown mappings stay pending and prevent execution without source traffic', () => {
  const plan = draft();
  const report = api.validateDemoPlan(plan, { matrixText });
  assert.equal(report.ready, false);
  assert.equal(report.coverage.pending, 74);
  assert.equal(report.coverage.excluded, 0);
  assert.throws(() => api.assertDemoPlanReady(plan, { matrixText }), /not ready/);
});

check('offline plan validation attempts no source, key or browser boundary', (t) => {
  const guard = offlineEgressGuard(t);
  assert.equal(api.validateDemoPlan(draft(), { matrixText }).ready, false);
  guard.assertZero();
});

check('malformed plan containers produce invalid reports without trusting partial values', () => {
  for (const mutate of [(p) => { p.sourceRows = null; }, (p) => { p.source = undefined; },
    (p) => { p.requirements.variation = {}; }, (p) => { p.sourceBudget.stopOrBackoffStatuses = {}; },
    (p) => { p.modelLines = null; }]) {
    const plan = draft(); mutate(plan);
    assert.equal(api.validateDemoPlan(plan, { matrixText }).valid, false);
  }
});

check('invalid source identifiers are never echoed into a validation report', () => {
  const plan = draft();
  plan.modelLines[0].id = 'PRIVATE-DO-NOT-PRINT';
  const report = api.validateDemoPlan(plan, { matrixText });
  assert.equal(report.valid, false);
  assert.equal(JSON.stringify(report).includes('PRIVATE-DO-NOT-PRINT'), false);
});

check('removing a row, grade, towbar or atomic line cannot weaken coverage', () => {
  for (const mutate of [
    (p) => p.sourceRows.pop(), (p) => { delete p.sourceRows[0].grades['G7']; },
    (p) => { p.sourceRows[0].towbar = true; }, (p) => p.modelLines.pop(),
    (p) => { p.modelLines[0].eligibility[0].grades['G7'] = false; },
  ]) {
    const plan = draft(); mutate(plan);
    assert.equal(api.validateDemoPlan(plan, { matrixText }).valid, false);
  }
});

check('stale source content, duplicate lines and claiming ready with unknowns are rejected', () => {
  const plan = draft();
  assert.equal(api.validateDemoPlan(plan, { matrixText: `${matrixText}\nchanged` }).valid, false);
  plan.modelLines.push(structuredClone(plan.modelLines[0]));
  assert.equal(api.validateDemoPlan(plan, { matrixText }).valid, false);
  const claimed = draft(); claimed.status = 'ready';
  assert.equal(api.validateDemoPlan(claimed, { matrixText }).valid, false);
});

check('a complete exact fixture plan can pass only with a supplied source-evidence verifier', () => {
  const plan = completeFixture();
  assert.equal(api.validateDemoPlan(plan, { matrixText }).ready, false);
  assert.equal(api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck }).ready, true);
  assert.equal(api.assertDemoPlanReady(plan, { matrixText, verifyEvidence: evidenceCheck }).coverage.mapped, 74);
});

check('330e cannot silently map to evidence for 320i even when its range matches', () => {
  const plan = completeFixture();
  const line = plan.modelLines.find((row) => row.model === 'G21 Touring' && row.engine === '330e');
  line.mapping.evidence.engine = '320i';
  const report = api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.code === 'mapping-identity-mismatch'));
});

check('one exact current model cannot satisfy two different matrix engine entries', () => {
  const plan = completeFixture();
  const mapping = plan.modelLines[1].mapping;
  for (const field of ['modelRange', 'vgModelCode', 'agModelCode']) {
    mapping[field] = plan.modelLines[0].mapping[field];
    mapping.evidence[field] = mapping[field];
  }
  assert.equal(api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck }).valid, false);
});

check('historical observations cannot become a fresh current mapping', () => {
  const plan = completeFixture();
  plan.modelLines[0].mapping.evidence.observedDate = '2026-11-01';
  assert.equal(api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck }).ready, false);
});

check('exclusions require an exact, verified absence observation and reason', () => {
  const plan = completeFixture(); const line = plan.modelLines[0];
  const evidence = { ...line.mapping.evidence, finding: 'no-current-model', scope: 'complete-current-uk-model-range' };
  line.mapping = { status: 'excluded', reason: 'Fixture exhaustive exact engine observation', evidence };
  assert.equal(api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck }).ready, true);
  delete line.mapping.reason;
  assert.equal(api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck }).valid, false);
  line.mapping.reason = 'No match in a partial tree'; delete evidence.scope;
  assert.equal(api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck }).valid, false);
});

check('8 per line and 200 overall are simultaneous independent minima', () => {
  const plan = completeFixture();
  const report = api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck });
  assert.equal(report.requiredDistinct, 592);
  plan.requirements.minimumPerMappedLine = 7;
  assert.equal(api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck }).valid, false);
  plan.requirements.minimumPerMappedLine = 8; plan.requirements.minimumDistinct = 199;
  assert.equal(api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck }).valid, false);
});

check('source budget, stop codes, variation and exact verification gates cannot be loosened', () => {
  for (const mutate of [
    (p) => { p.sourceBudget.maximumRequests = 3001; },
    (p) => { p.sourceBudget.concurrency = 3; },
    (p) => { p.sourceBudget.stopOrBackoffStatuses = [429]; },
    (p) => { p.requirements.minimumDeepLinkChecks = 19; },
    (p) => { p.requirements.variation = ['paint']; },
    (p) => { p.identity.modelCodeField = 'agModelCode'; },
    (p) => { p.execution.defaultMode = 'execute'; },
  ]) {
    const plan = draft(); mutate(plan);
    assert.equal(api.validateDemoPlan(plan, { matrixText }).valid, false);
  }
});

check('committed proposal exactly reproduces archived coverage and remains pending', async () => {
  const plan = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/demo-plan.json', import.meta.url), 'utf8'));
  const report = api.validateDemoPlan(plan, { matrixText });
  assert.equal(report.valid, true, JSON.stringify(report.errors));
  assert.equal(report.ready, false);
  assert.equal(plan.execution.liveRequestsThisCheckpoint, 0);
  assert.equal(plan.retainedMeasurements.currentSelectedRecords, 2);
  assert.equal(plan.retainedMeasurements.historicalConstructibleObservations, 3);
  assert.equal(plan.retainedMeasurements.acceptedDemoConfigurations, 0);
});
