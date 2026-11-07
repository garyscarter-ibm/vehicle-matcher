import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { offlineEgressGuard } from './helpers/offline-egress-guard.js';

// A false-ready decision is the production regression these tests distinguish.
const api = await import('../../scripts/gcsp/demo-plan.mjs').catch((error) => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const builder = await import('../../scripts/gcsp/demo-plan-mappings.mjs');
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

check('evidence must be observed on or before the qualification date and at most 14 days earlier', () => {
  const at = (observedDate) => {
    const plan = completeFixture(); plan.modelLines[0].mapping.evidence.observedDate = observedDate;
    return api.validateDemoPlan(plan, { matrixText, verifyEvidence: evidenceCheck });
  };
  assert.equal(at('2026-11-06').ready, true); // The fixture qualification date is 2026-11-06.
  assert.equal(at('2026-10-23').ready, true); // Exactly 14 days earlier.
  assert.equal(at('2026-10-22').ready, false); // 15 days earlier is historical.
  assert.equal(at('2026-11-07').ready, false); // Observed after qualification.
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

const planOnDisk = async () => JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/demo-plan.json', import.meta.url), 'utf8'));
const lineOf = (plan, id) => plan.modelLines.find((line) => line.id === id);
const blockedLines = (report) => report.blockers.filter((item) => item.code === 'mapping-evidence-not-verified').map((item) => item.lineId);
const evidenceFile = (path) => new URL(`../../${path}`, import.meta.url);

check('committed plan is evidenced offline: 24 mapped, 4 excluded, 46 pending gaps', async (t) => {
  const guard = offlineEgressGuard(t);
  const plan = await planOnDisk();
  const report = api.validateDemoPlan(plan, { matrixText });
  assert.equal(report.valid, true, JSON.stringify(report.errors));
  assert.equal(report.mappedReady, true, JSON.stringify(report.blockers.filter((item) => item.code !== 'mapping-pending')));
  assert.equal(report.ready, false);
  assert.deepEqual(report.coverage, { sourceRows: 132, modelLines: 74, mapped: 24, excluded: 4, pending: 46 });
  assert.equal(report.gaps.length, 46);
  assert.ok(report.gaps.includes('line-g20-saloon-320i') && !report.gaps.includes('line-g21-touring-320i'));
  assert.equal(plan.qualificationDate, '2026-11-07');
  assert.equal(plan.execution.liveRequestsThisCheckpoint, 0);
  assert.equal(plan.retainedMeasurements.acceptedDemoConfigurations, 0);
  assert.throws(() => api.assertDemoPlanReady(plan, { matrixText }), /not ready/);
  guard.assertZero();
});

check('mapped lines keep exact codes and never substitute a similar model', async () => {
  const plan = await planOnDisk();
  const codes = Object.fromEntries(plan.modelLines.filter((line) => line.mapping.status === 'mapped')
    .map((line) => [line.id, `${line.mapping.modelRange}/${line.mapping.vgModelCode}/${line.mapping.agModelCode}`]));
  assert.equal(codes['line-g21-touring-m340i'], 'G21/T3PF/22GL');
  assert.equal(codes['line-g42-coupe-m240i'], 'G42/2PMC/52FA');
  assert.equal(lineOf(plan, 'line-g42-coupe-m240i').mapping.additionalModels[0].vgModelCode, '2PBC');
  assert.equal(codes['line-g26-i4-i4-40'], 'G26E/I4MG/62HD');
  assert.equal(codes['line-g61-i5-i5-40'], 'G61E/T5MJ/72HH');
  assert.equal(codes['line-u11-x1-20i'], 'U11/X1M0/32EE');
  for (const id of ['line-g20-saloon-320i', 'line-g26-gran-coupe-420i', 'line-g61-touring-530e', 'line-u11-x1-20d', 'line-i20-ix-ix-40']) {
    assert.equal(lineOf(plan, id).mapping.status, 'pending', id);
  }
  const m50 = lineOf(plan, 'line-g26-i4-i4-m50').mapping;
  assert.equal(m50.status, 'excluded');
  assert.match(m50.reason, /i4 M60 is not substituted/);
  assert.deepEqual(m50.evidence.listedDerivatives, ['I4 35', 'I4 40', 'I4 M60']);
  assert.match(lineOf(plan, 'line-f44-gran-coupe-220i').mapping.reason, /not a claim about global production/);
});

check('the committed plan is reproduced exactly by the offline builder', async () => {
  assert.deepEqual(builder.buildDemoPlan(), await planOnDisk());
});

check('a tampered evidence hash leaves the plan valid but not mapped-ready', async () => {
  const plan = await planOnDisk(); const mapping = lineOf(plan, 'line-g21-touring-m340i').mapping;
  mapping.evidence.sha256 = mapping.evidence.sha256.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
  const report = api.validateDemoPlan(plan, { matrixText });
  assert.equal(report.valid, true);
  assert.equal(report.mappedReady, false);
  assert.deepEqual(blockedLines(report), ['line-g21-touring-m340i']);
  const extra = await planOnDisk(); const second = lineOf(extra, 'line-g42-coupe-m240i').mapping.additionalModels[0];
  second.evidence.sha256 = '0'.repeat(64);
  assert.deepEqual(blockedLines(api.validateDemoPlan(extra, { matrixText })), ['line-g42-coupe-m240i']);
});

check('i4 M50 cannot map to I4PC, which the BMW tree calls I4 M60', async () => {
  const path = 'docs/gcsp/evidence/fucq59/scheme-breadth-remaining24-model-options-root-execution-2026-11-07/g26e-i4pc/collector-checkpoint.json';
  const base = { sourceRef: path, sha256: digest(await readFile(evidenceFile(path))), locator: '/content/contextObservation/document/report/nodes/0',
    observedDate: '2026-11-07', kind: 'observed', market: 'GB', modelRange: 'G26E', vgModelCode: 'I4PC', agModelCode: '72HD',
    rawModelRange: 'G26', derivative: 'I4 M60' };
  const mapping = { status: 'mapped', modelRange: 'G26E', vgModelCode: 'I4PC', agModelCode: '72HD' };
  const verify = (engine) => api.verifyMappingEvidence({ ...base, matrixModel: 'G26 i4', engine },
    { line: { model: 'G26 i4', engine }, mapping });
  assert.equal(verify('i4 M60'), true); // The retained evidence is genuine; only the M50 match is refused.
  assert.equal(verify('i4 M50'), false);
  const plan = await planOnDisk(); const line = lineOf(plan, 'line-g26-i4-i4-m50');
  line.mapping = { ...mapping, evidence: { ...base, matrixModel: 'G26 i4', engine: 'i4 M50' } };
  const report = api.validateDemoPlan(plan, { matrixText });
  assert.equal(report.mappedReady, false);
  assert.ok(blockedLines(report).includes('line-g26-i4-i4-m50'));
});

check('G20 Saloon 320i cannot map to the G21 Touring T3MK code', async () => {
  const plan = await planOnDisk();
  const touring = lineOf(plan, 'line-g21-touring-320i'); const saloon = lineOf(plan, 'line-g20-saloon-320i');
  saloon.mapping = structuredClone(touring.mapping); delete saloon.mapping.additionalModels;
  saloon.mapping.evidence.matrixModel = saloon.model;
  touring.mapping = { status: 'pending', reason: 'Isolated so the substitution is the only fault.' };
  const report = api.validateDemoPlan(plan, { matrixText });
  assert.equal(report.valid, true, JSON.stringify(report.errors));
  assert.equal(report.mappedReady, false);
  assert.deepEqual(blockedLines(report), ['line-g20-saloon-320i']);
});

check('anti-substitution rule requires the raw range prefix and the engine in the derivative', () => {
  const rule = api.derivativeMatchesEngine;
  assert.equal(rule('G21 Touring', '320i', '320I', 'G21'), true);
  assert.equal(rule('U11 X1', '20i', 'X1 20I', 'U11'), true);
  assert.equal(rule('U11 iX1', 'iX1 20', 'IX1 20', 'U11'), true);
  assert.equal(rule('G26 i4', 'i4 M50', 'I4 M60', 'G26'), false);
  assert.equal(rule('G20 Saloon', '320i', '320I', 'G21'), false);
  assert.equal(rule('G2 Saloon', '320i', '320I', 'G21'), false);
  assert.equal(rule('U11 X1', '20d', 'X1 20I', 'U11'), false);
  assert.equal(rule('G21 Touring', '330e', '320I', 'G21'), false);
});

check('an exclusion without evidence, or with a listing that disagrees, is rejected', async () => {
  const plan = await planOnDisk(); delete lineOf(plan, 'line-f44-gran-coupe-218i').mapping.evidence;
  const missing = api.validateDemoPlan(plan, { matrixText });
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.code === 'mapping-source-evidence'));
  const listed = await planOnDisk(); lineOf(listed, 'line-g26-i4-i4-m50').mapping.evidence.listedDerivatives = ['I4 35', 'I4 40'];
  assert.deepEqual(blockedLines(api.validateDemoPlan(listed, { matrixText })), ['line-g26-i4-i4-m50']);
  const wrongScope = await planOnDisk(); delete lineOf(wrongScope, 'line-f44-gran-coupe-218i').mapping.evidence.scope;
  assert.equal(api.validateDemoPlan(wrongScope, { matrixText }).valid, false);
});

check('one VG model code cannot satisfy two lines, or twice within one line', async () => {
  const plan = await planOnDisk();
  const source = lineOf(plan, 'line-f70-sports-hatch-120').mapping;
  const target = lineOf(plan, 'line-f70-sports-hatch-m135');
  target.mapping = structuredClone(source); target.mapping.evidence.engine = target.engine;
  const report = api.validateDemoPlan(plan, { matrixText });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.code === 'duplicate-model-mapping' && error.lineId === target.id));
  const twice = await planOnDisk(); const own = lineOf(twice, 'line-g42-coupe-m240i').mapping;
  own.additionalModels.push(structuredClone(own.additionalModels[0]));
  assert.ok(api.validateDemoPlan(twice, { matrixText }).errors.some((error) => error.code === 'duplicate-model-mapping'));
});

check('additional models must match their line and range, and are not allowed on exclusions', async () => {
  for (const change of [
    (m) => { m.additionalModels[0].evidence.modelRange = 'G43'; },
    (m) => { m.additionalModels[0].agModelCode = 'ZZZZ'; },
    (m) => { m.additionalModels = {}; },
  ]) {
    const plan = await planOnDisk(); change(lineOf(plan, 'line-g42-coupe-m240i').mapping);
    assert.equal(api.validateDemoPlan(plan, { matrixText }).valid, false);
  }
  const plan = await planOnDisk(); lineOf(plan, 'line-f44-gran-coupe-218i').mapping.additionalModels = [];
  assert.equal(api.validateDemoPlan(plan, { matrixText }).valid, false);
});

check('evidence dates are checked against the committed plan qualification date', async () => {
  const at = async (qualificationDate) => { const plan = await planOnDisk(); plan.qualificationDate = qualificationDate; return api.validateDemoPlan(plan, { matrixText }); };
  assert.equal((await at('2026-11-19')).mappedReady, true); // F44 was observed 14 days earlier.
  assert.equal((await at('2026-11-20')).valid, false);
  assert.equal((await at('2026-11-06')).valid, false); // Evidence observed after qualification.
});

check('evidence outside the retained-evidence tree, or reached through a symlink, is refused', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'f77-evidence-root-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs/gcsp/evidence/x'), { recursive: true });
  const body = JSON.stringify({ report: { nodes: [{ pointer: '/3/modelRanges/G21/models/T3MK', facts: { modelCode: 'T3MK', agModelCode: '22FY',
    modelRange: 'G21', derivative: '320I' } }] }, observation: { request: { url: 'https://example.invalid/?model-ranges=G21' }, observedAt: '2026-11-07T01:00:00Z' } });
  await writeFile(join(root, 'docs/gcsp/evidence/x/tree.json'), body);
  await writeFile(join(root, 'outside.json'), body);
  await symlink(join(root, 'outside.json'), join(root, 'docs/gcsp/evidence/x/link.json'));
  const line = { model: 'G21 Touring', engine: '320i' }; const mapping = { status: 'mapped', modelRange: 'G21', vgModelCode: 'T3MK', agModelCode: '22FY' };
  const evidence = (sourceRef, text = body) => ({ sourceRef, sha256: digest(text), locator: '/report/nodes/0', observedDate: '2026-11-07', modelRange: 'G21',
    vgModelCode: 'T3MK', agModelCode: '22FY', rawModelRange: 'G21', derivative: '320I' });
  assert.equal(api.verifyMappingEvidence(evidence('docs/gcsp/evidence/x/tree.json'), { line, mapping, root }), true);
  for (const ref of ['outside.json', 'docs/gcsp/evidence/x/link.json', 'docs/gcsp/evidence/../../outside.json', join(root, 'outside.json')]) {
    assert.equal(api.verifyMappingEvidence(evidence(ref), { line, mapping, root }), false, ref);
  }
  assert.equal(api.verifyMappingEvidence({ ...evidence('docs/gcsp/evidence/x/tree.json'), locator: '/report/nodes/9' }, { line, mapping, root }), false);
});
