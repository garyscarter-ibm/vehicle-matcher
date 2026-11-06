import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MATRIX_PATH = 'docs/gcsp/sources/choices-eligibility-matrices-2024-10.md';
export const DEMO_PLAN_SCHEMA = 'gcsp-demo-plan.v1';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.length > 0 && value.length < 2048 && !/[\u0000-\u001f]/.test(value);
const code = (value) => typeof value === 'string' && /^[A-Z0-9]{2,16}$/.test(value);
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const sorted = (value) => Array.isArray(value) ? value.map(sorted)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
const canonical = (value) => JSON.stringify(sorted(value));
const same = (left, right) => canonical(left) === canonical(right);
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** An archived policy transcription, not the active PolicyService or a current catalogue. */
export function parseEligibilityMatrices(matrixText) {
  if (typeof matrixText !== 'string') throw new TypeError('Supply the archived eligibility matrix text.');
  const sourceRows = []; const lines = new Map();
  let scheme; let grades; let ordinal = 0;
  for (const [index, sourceText] of matrixText.split('\n').entries()) {
    if (sourceText.startsWith('## FS&UK ')) { scheme = 'fs-uk'; ordinal = 0; }
    if (sourceText.startsWith('## RR&Production ')) { scheme = 'rr-production'; ordinal = 0; }
    if (sourceText.startsWith('| Range |')) grades = sourceText.split('|').slice(6, -1).map((s) => s.trim());
    if (!sourceText.startsWith('| ') || !sourceText.includes('✓')) continue;
    const cells = sourceText.split('|').slice(1, -1).map((s) => s.trim());
    if (!scheme || !grades || cells.length !== 5 + grades.length || !cells.slice(5).every((c) => ['✓', '✗'].includes(c))
      || !['', 'T'].includes(cells[4])) throw new Error(`Malformed archived matrix row at line ${index + 1}.`);
    const [range, model, vehicleClass, engineLabel] = cells;
    const row = { id: `${scheme}-${String(++ordinal).padStart(3, '0')}`, scheme, range, model, vehicleClass,
      engineLabel, towbar: cells[4] === 'T', grades: Object.fromEntries(grades.map((g, i) => [g, cells[i + 5] === '✓'])),
      sourceLine: index + 1, sourceText };
    sourceRows.push(row);
    // Split only explicit list punctuation. Do not infer a successor, engine prefix or body variant.
    for (const engine of engineLabel.split(/[,/]/).map((s) => s.trim())) {
      if (!engine) throw new Error(`Empty engine token at line ${index + 1}.`);
      const id = `line-${slug(model)}-${slug(engine)}`;
      if (!lines.has(id)) lines.set(id, { id, range, model, vehicleClass, engine, eligibility: [] });
      const line = lines.get(id);
      if (line.range !== range || line.vehicleClass !== vehicleClass) throw new Error('Ambiguous archived model identity.');
      line.eligibility.push({ sourceRowId: row.id, scheme, grades: { ...row.grades }, towbar: row.towbar, sourceLine: row.sourceLine });
    }
  }
  if (sourceRows.length !== 132 || sourceRows.filter((row) => row.scheme === 'fs-uk').length !== 66
    || sourceRows.filter((row) => row.scheme === 'rr-production').length !== 66 || lines.size !== 74) {
    throw new Error('The October 2024 archive must contain both complete 66-row matrices and 74 explicit engine entries.');
  }
  return { sourceRows, modelLines: [...lines.values()] };
}

export function createDemoPlan(matrixText, { asOfDate } = {}) {
  if (!date(asOfDate)) throw new TypeError('A valid explicit current qualification date is required.');
  const coverage = parseEligibilityMatrices(matrixText);
  return {
    schemaVersion: DEMO_PLAN_SCHEMA, status: 'pending', qualificationDate: asOfDate,
    source: { path: MATRIX_PATH, sha256: hash(matrixText), effectiveDate: '2024-10-01' },
    sourceRows: coverage.sourceRows,
    modelLines: coverage.modelLines.map((line) => ({ ...line, mapping: { status: 'pending',
      reason: 'Exact current UK model range, VG/AG codes and engine/body evidence have not been qualified.' } })),
    requirements: { minimumPerMappedLine: 8, minimumDistinct: 200, minimumDeepLinkChecks: 20,
      variation: ['paint', 'upholstery', 'wheels', 'pack'], completeSolverOptions: true,
      rejectChangedModelCode: true, exactDeepLinkSelections: true, realEnrichment: true,
      versionedF54Publication: true, lookupCountAndHashReconciliation: true },
    identity: { modelCodeField: 'vgModelCode', normalisation: 'uppercase', separator: ',', encoding: 'base64-padded',
      includePaintAndUpholstery: true, completeFactoryOptions: true, excludeDealerAccessories: true },
    sourceBudget: { maximumRequests: 3000, concurrency: 2, stopOrBackoffStatuses: [401, 403, 429],
      resumableCheckpoints: true, requireFiniteLiveChunkPlan: true },
    execution: { defaultMode: 'offline', allowCI: false, allowDemoStartup: false, allowRuntimeBMWCalls: false,
      liveRequestsThisCheckpoint: 0, liveChunkPlan: null },
    retainedMeasurements: { currentSelectedRecords: 2, historicalConstructibleObservations: 3, acceptedDemoConfigurations: 0,
      note: 'Separate historical measurements from FUCQ-58; neither establishes demo acceptance or fresh mapping.' },
    publication: { boundary: 'FUCQ-54', files: ['manifest.json', 'configurations.jsonl'],
      reportPath: 'docs/gcsp/evidence/fucq-20/demo-collection-report.json' },
  };
}

/** verifyEvidence must check retained bytes/hash/locator and source claims, not just trust this JSON. */
export function validateDemoPlan(plan, { matrixText, verifyEvidence } = {}) {
  const errors = []; const blockers = []; const coverage = { sourceRows: 0, modelLines: 0, mapped: 0, excluded: 0, pending: 0 };
  const error = (code, lineId) => errors.push({ code, ...(lineId ? { lineId } : {}) });
  if (!object(plan) || plan.schemaVersion !== DEMO_PLAN_SCHEMA) return { valid: false, ready: false, errors: [{ code: 'plan-schema' }], blockers, coverage };
  let expected;
  try { expected = parseEligibilityMatrices(matrixText); } catch { error('matrix-source-unavailable'); }
  if (expected && (!same(plan.source, { path: MATRIX_PATH, sha256: hash(matrixText), effectiveDate: '2024-10-01' })
    || !same(plan.sourceRows, expected.sourceRows))) error('matrix-source-mismatch');
  if (!date(plan.qualificationDate) || !['pending', 'ready'].includes(plan.status)) error('qualification-context');
  const requirements = plan.requirements || {};
  if (!Number.isSafeInteger(requirements.minimumPerMappedLine) || requirements.minimumPerMappedLine < 8
    || !Number.isSafeInteger(requirements.minimumDistinct) || requirements.minimumDistinct < 200
    || !Number.isSafeInteger(requirements.minimumDeepLinkChecks) || requirements.minimumDeepLinkChecks < 20
    || !Array.isArray(requirements.variation) || !same([...requirements.variation].sort(), ['pack', 'paint', 'upholstery', 'wheels'])
    || ['completeSolverOptions', 'rejectChangedModelCode', 'exactDeepLinkSelections', 'realEnrichment',
      'versionedF54Publication', 'lookupCountAndHashReconciliation'].some((field) => requirements[field] !== true)) error('acceptance-minima');
  if (!same(plan.identity, { modelCodeField: 'vgModelCode', normalisation: 'uppercase', separator: ',', encoding: 'base64-padded',
    includePaintAndUpholstery: true, completeFactoryOptions: true, excludeDealerAccessories: true })) error('identity-contract');
  const budget = plan.sourceBudget || {};
  if (!Number.isSafeInteger(budget.maximumRequests) || budget.maximumRequests < 1 || budget.maximumRequests > 3000
    || !Number.isSafeInteger(budget.concurrency) || budget.concurrency < 1 || budget.concurrency > 2
    || !Array.isArray(budget.stopOrBackoffStatuses) || !same([...budget.stopOrBackoffStatuses].sort(), [401, 403, 429])
    || budget.resumableCheckpoints !== true || budget.requireFiniteLiveChunkPlan !== true) error('source-budget');
  if (plan.execution?.defaultMode !== 'offline' || plan.execution?.allowCI !== false
    || plan.execution?.allowDemoStartup !== false || plan.execution?.allowRuntimeBMWCalls !== false) error('offline-default');
  const expectedLines = new Map(expected?.modelLines.map((line) => [line.id, line]) || []);
  const seen = new Set(); const mappedModels = new Set();
  if (!Array.isArray(plan.modelLines) || plan.modelLines.length !== expectedLines.size) error('model-line-coverage');
  for (const line of Array.isArray(plan.modelLines) ? plan.modelLines : []) {
    if (!object(line)) { error('model-line-schema'); continue; }
    const { mapping, ...sourceLine } = line;
    const expectedLine = expectedLines.get(line.id);
    if (!expectedLine || seen.has(line.id) || !same(sourceLine, expectedLine)) error('model-line-coverage', line.id);
    seen.add(line.id);
    if (!object(mapping) || !['mapped', 'excluded', 'pending'].includes(mapping.status)) { error('mapping-status', line.id); continue; }
    coverage[mapping.status]++;
    if (mapping.status === 'pending') {
      if (!text(mapping.reason)) error('pending-reason', line.id);
      blockers.push({ code: 'mapping-pending', lineId: line.id });
      continue;
    }
    const evidence = mapping.evidence;
    if (!object(evidence) || !text(evidence.sourceRef) || !/^[a-f0-9]{64}$/.test(evidence.sha256 || '')
      || !text(evidence.locator) || evidence.kind !== 'observed' || evidence.market !== 'GB'
      || evidence.observedDate !== plan.qualificationDate || !date(evidence.observedDate)) {
      error('mapping-source-evidence', line.id); continue;
    }
    if (evidence.matrixModel !== line.model || evidence.engine !== line.engine) error('mapping-identity-mismatch', line.id);
    if (mapping.status === 'mapped') {
      if (!code(mapping.modelRange) || !code(mapping.vgModelCode) || !code(mapping.agModelCode)
        || ['modelRange', 'vgModelCode', 'agModelCode'].some((field) => evidence[field] !== mapping[field])) error('mapping-code-evidence', line.id);
      const modelKey = `${mapping.modelRange}:${mapping.vgModelCode}`;
      if (mappedModels.has(modelKey)) error('duplicate-model-mapping', line.id);
      mappedModels.add(modelKey);
    } else if (!text(mapping.reason) || evidence.finding !== 'no-current-model'
      || evidence.scope !== 'complete-current-uk-model-range') error('exclusion-evidence', line.id);
    let verified = false;
    try { verified = typeof verifyEvidence === 'function' && verifyEvidence(evidence, { line, mapping }) === true; } catch { /* Unavailable source proof stays blocked. */ }
    if (!verified) blockers.push({ code: 'mapping-evidence-not-verified', lineId: line.id });
  }
  coverage.sourceRows = plan.sourceRows?.length || 0; coverage.modelLines = seen.size;
  if (seen.size !== expectedLines.size) error('model-line-coverage');
  if (!coverage.mapped && !coverage.pending) error('no-mapped-models');
  const ready = errors.length === 0 && blockers.length === 0 && coverage.mapped > 0;
  if (plan.status === 'ready' && !ready) error('premature-ready-status');
  return { valid: errors.length === 0, ready: ready && errors.length === 0, errors, blockers, coverage,
    requiredDistinct: Math.max(requirements.minimumDistinct || 200, coverage.mapped * (requirements.minimumPerMappedLine || 8)) };
}

export function assertDemoPlanReady(plan, options) {
  const report = validateDemoPlan(plan, options);
  if (!report.ready) { const failure = new Error('Demo plan is not ready; resolve exact mapping and evidence blockers before collection.'); failure.report = report; throw failure; }
  return report;
}

async function main(args) {
  // There is deliberately no credential, transport or collection capability in this command.
  if (args.length !== 2 || args[0] !== '--config') throw new Error('Usage: node scripts/gcsp/demo-plan.mjs --config <plan.json> (offline only)');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const plan = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
  const matrixText = await readFile(resolve(root, MATRIX_PATH), 'utf8');
  const report = validateDemoPlan(plan, { matrixText });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.valid ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { process.stderr.write('Demo plan unavailable or invalid; use the explicit offline --config command.\n'); process.exitCode = 1; });
}
