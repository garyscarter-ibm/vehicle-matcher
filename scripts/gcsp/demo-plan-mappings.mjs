import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATRIX_PATH, createDemoPlan, derivativeMatchesEngine } from './demo-plan.mjs';

// Offline builder: derives plan mappings from retained BMW UK model-tree observations, with no source traffic.
export const QUALIFICATION_DATE = '2026-11-07';
export const PLAN_PATH = 'server/data/gcsp/vehicle-evidence/demo-plan.json';
const E = 'docs/gcsp/evidence/';
const COVERAGE = `${E}fucq61/exact10000-closeout-2026-11-07/coverage.json`;
const F59 = `${E}fucq59/`;
// Observation roots holding one model per file; document paths are tried in order.
const TREE_ROOTS = [`${F59}scheme-breadth-remaining24-model-options-root-execution-2026-11-07`,
  `${F59}scheme-breadth-six-model-options-root-execution-2026-11-07`, `${F59}f70-context-qualification-2026-11-07`,
  `${F59}g42-typed-pilot48-2026-11-07`];
const TREE_FILES = [`${E}fucq-58/complete-selection-2026-11-07/tree.json`];
const DOCUMENT_POINTERS = ['/content/contextObservation/document', '/content/batchEvidence/tree/document', ''];
const F44 = { file: `${E}fucq-58/scheme-catalogue-2026-11-05/observation.json`, lineIds: ['line-f44-gran-coupe-218i', 'line-f44-gran-coupe-220i', 'line-f44-gran-coupe-m235i'] };
const G26E = { file: `${F59}scheme-line-breadth15-2026-11-07/actual/g26e/collector-checkpoint.json`, lineIds: ['line-g26-i4-i4-m50'] };
const HEX = (bytes) => createHash('sha256').update(bytes).digest('hex');

const get = (document, pointer) => pointer.split('/').slice(1).reduce((node, key) => node?.[key], document);
const read = (root, path) => { const bytes = readFileSync(join(root, path)); return { bytes, document: JSON.parse(bytes.toString('utf8')) }; };

function treeNodes(root) {
  const files = [...TREE_FILES];
  for (const base of TREE_ROOTS) {
    for (const entry of readdirSync(join(root, base), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) { try { readFileSync(join(root, base, entry.name, 'collector-checkpoint.json')); files.push(`${base}/${entry.name}/collector-checkpoint.json`); } catch { /* not a model directory */ } }
    }
  }
  const found = [];
  for (const sourceRef of files) {
    const { bytes, document } = read(root, sourceRef);
    const prefix = DOCUMENT_POINTERS.find((pointer) => get(document, `${pointer}/report/nodes`) !== undefined && Array.isArray(get(document, `${pointer}/report/nodes`)));
    if (prefix === undefined) continue;
    const owner = prefix === '' ? document : get(document, prefix);
    const url = new URL(owner.observation.request.url);
    owner.report.nodes.forEach((node, index) => {
      if (node.facts?.modelCode && node.facts.agModelCode && node.facts.modelRange && node.facts.derivative) {
        found.push({ sourceRef, sha256: HEX(bytes), locator: `${prefix}/report/nodes/${index}`, facts: node.facts, pointer: node.pointer,
          route: url.searchParams.get('model-ranges'), observedDate: owner.observation.observedAt.slice(0, 10) });
      }
    });
  }
  return found;
}

/** The primary VG code is the one with most FUCQ-61 corpus records; ties fall to the lower code. */
function corpusCounts(root) {
  const counts = new Map(read(root, COVERAGE).document.final10351Dimensions.vgModelCode.map(({ value, count }) => [value, count]));
  return (vg) => counts.get(vg) || 0;
}

const evidenceFor = (line, found, extra = {}) => ({ sourceRef: found.sourceRef, sha256: found.sha256, locator: found.locator,
  observedDate: found.observedDate, kind: 'observed', market: 'GB', matrixModel: line.model, engine: line.engine, ...extra });

function mapLine(line, nodes, count) {
  const matches = new Map();
  for (const found of nodes) {
    const { facts } = found;
    if (!derivativeMatchesEngine(line.model, line.engine, facts.derivative, facts.modelRange)) continue;
    const key = `${found.route}:${facts.modelCode}`;
    if (!matches.has(key)) matches.set(key, found); // First deterministic alias of one model code.
  }
  if (!matches.size) return null;
  const all = [...matches.values()];
  const one = (field) => { const values = new Set(all.map((found) => field(found))); if (values.size !== 1) throw new Error(`Ambiguous ${line.id}`); return [...values][0]; };
  const modelRange = one((found) => found.route); const agModelCode = one((found) => found.facts.agModelCode);
  const rawModelRange = one((found) => found.facts.modelRange);
  all.sort((a, b) => count(b.facts.modelCode) - count(a.facts.modelCode) || a.facts.modelCode.localeCompare(b.facts.modelCode));
  const asEvidence = (found) => evidenceFor(line, found, { modelRange, vgModelCode: found.facts.modelCode, agModelCode, rawModelRange,
    derivative: found.facts.derivative });
  const [primary, ...rest] = all;
  return { status: 'mapped', modelRange, vgModelCode: primary.facts.modelCode, agModelCode, evidence: asEvidence(primary),
    ...(rest.length ? { additionalModels: rest.map((found) => ({ vgModelCode: found.facts.modelCode, agModelCode, evidence: asEvidence(found) })) } : {}) };
}

function emptyRangeExclusions(root, plan) {
  const { bytes, document } = read(root, F44.file); const sha256 = HEX(bytes);
  const index = document.observations.findIndex((item) => item.schemeModelLine === 'F44 Gran Coupe');
  const item = document.observations[index];
  if (item.requestedRangeFound !== false || item.models.length || item.returnedRangeKeys.length) throw new Error('F44 observation is not an empty range.');
  const reason = 'No F44 models in the current UK model tree: the range-wide F44 request (order and effect dates 2026-11-01, future models and closest fallback on) '
    + 'returned an empty object on 2026-11-05. This is that bounded response only, not a claim about global production or other dates.';
  for (const line of plan.modelLines.filter((entry) => F44.lineIds.includes(entry.id))) {
    line.mapping = { status: 'excluded', reason, evidence: evidenceFor(line, { sourceRef: F44.file, sha256, locator: `/observations/${index}`,
      observedDate: document.observedAt.slice(0, 10) }, { modelRange: item.requestedRange, rawModelRange: item.requestedRange, listing: 'empty',
      finding: 'no-current-model', scope: 'complete-current-uk-model-range' }) };
  }
}

function listedRangeExclusions(root, plan) {
  const { bytes, document } = read(root, G26E.file); const sha256 = HEX(bytes); const prefix = '/content/diagnosticObservation/document';
  const owner = get(document, prefix); const report = owner.report; const range = report.requestScope.catalogueRangeKey;
  const raw = [...new Set(report.modelNodes.map((node) => node.facts.modelRange))];
  const listed = [...new Set(report.modelNodes.map((node) => node.facts.derivative))].sort();
  if (raw.length !== 1 || new URL(owner.observation.request.url).searchParams.get('model-ranges') !== range) throw new Error('G26E listing is not range-wide.');
  const names = listed.map((derivative) => derivative.replace(/^I4/, 'i4'));
  for (const line of plan.modelLines.filter((entry) => G26E.lineIds.includes(entry.id))) {
    if (listed.some((derivative) => derivativeMatchesEngine(line.model, line.engine, derivative, raw[0]))) throw new Error(`${line.id} is listed.`);
    const reason = `Current UK ${range} tree lists ${names.slice(0, -1).join(', ')} and ${names.at(-1)}; ${names.at(-1)} is not substituted for the scheme's ${line.engine}.`;
    line.mapping = { status: 'excluded', reason, evidence: evidenceFor(line, { sourceRef: G26E.file, sha256, locator: `${prefix}/report`,
      observedDate: owner.observation.observedAt.slice(0, 10) }, { modelRange: range, rawModelRange: raw[0], listing: 'models',
      listedDerivatives: listed, finding: 'no-current-model', scope: 'complete-current-uk-model-range' }) };
  }
}

const NOTES = {
  'line-u11-x1-20d': 'The retained range-wide U11 tree lists X1 18D, 20I, 23D, 23I, 25E, 30E and M35I but no 20D; no exclusion has been qualified and no other X1 is substituted.',
  'line-g61-touring-530e': 'Retained G61E evidence covers only the i5 40 selection (T5MJ); no retained UK model-tree observation lists a 530e Touring; needs live discovery.',
  'line-g61-i5-i5-m60': 'Retained G61E evidence covers only the i5 40 selection (T5MJ); no retained UK model-tree observation lists an i5 M60; needs live discovery.',
};

function pendingReason(line) {
  if (NOTES[line.id]) return NOTES[line.id];
  if (line.model.startsWith('G20 ')) return 'No retained UK model-tree observation for G20; G21 Touring codes are a different body and are not substituted; needs live discovery.';
  if (line.model.startsWith('G26 Gran')) return 'No retained UK model-tree observation for the G26 Gran Coupe; the retained G26E tree lists only i4 derivatives; needs live discovery.';
  if (line.range === 'M') return `No retained UK model-tree observation for ${line.model} ${line.engine}; needs live discovery.`;
  const range = line.model.split(' ')[0];
  if (range === 'i20') return 'The retained I20 model-tree response was an empty object and collection stopped; no exclusion is claimed (global availability unknown); needs live discovery.';
  return `No retained UK model-tree observation for ${range}; needs live discovery.`;
}

export function buildDemoPlan({ root = fileURLToPath(new URL('../../', import.meta.url)) } = {}) {
  const matrixText = readFileSync(join(root, MATRIX_PATH), 'utf8');
  const plan = createDemoPlan(matrixText, { asOfDate: QUALIFICATION_DATE });
  const nodes = treeNodes(root); const count = corpusCounts(root);
  for (const line of plan.modelLines) {
    const mapping = mapLine(line, nodes, count);
    if (mapping) line.mapping = mapping;
    else line.mapping = { status: 'pending', reason: pendingReason(line) };
  }
  emptyRangeExclusions(root, plan);
  listedRangeExclusions(root, plan);
  // demo-selection.mjs owns this pointer to the published demo store; a rebuild keeps it.
  try {
    const staged = JSON.parse(readFileSync(join(root, PLAN_PATH), 'utf8')).publication?.stagedDirectory;
    if (typeof staged === 'string') plan.publication = { boundary: plan.publication.boundary, stagedDirectory: staged,
      files: plan.publication.files, reportPath: plan.publication.reportPath };
  } catch { /* A first build has no plan on disk yet. */ }
  return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const plan = buildDemoPlan({ root });
  const text = `${JSON.stringify(plan, null, 2)}\n`;
  if (process.argv[2] === '--write') writeFileSync(join(root, PLAN_PATH), text);
  else if (process.argv.length > 2) throw new Error('Usage: node scripts/gcsp/demo-plan-mappings.mjs [--write]');
  const counts = { mapped: 0, excluded: 0, pending: 0 };
  plan.modelLines.forEach((line) => { counts[line.mapping.status]++; });
  process.stdout.write(`${JSON.stringify(counts)}\n`);
}
