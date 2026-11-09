import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, result } from '../repository/core.js';

export const PER_COLOUR_LIMIT = 8;
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 512;
const unavailable = (code) => result('unavailable', { code, reason: 'The retained corpus or its policy inputs are unavailable.', retryable: true });
const invalid = (code) => result('invalid', { code, reasons: [{ field: 'stock-configuration-plan', reason: 'Supply a valid retained corpus and reviewed policy labels.' }] });
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function planRow(line) {
  const row = JSON.parse(line);
  const codes = row.canonicalIdentity?.factoryOptionCodes ?? [];
  return { configurationId: row.configurationId, generation: row.configuration?.generation ?? null,
    paint: codes.filter((code) => /^P[0-9A-Z]{4}$/.test(code)), upholstery: codes.filter((code) => /^F[0-9A-Z]{4}$/.test(code)) };
}

/** Reads the active retained corpus (pointer, manifest, checksummed rows) without the registry. */
export async function readRetainedCorpus(root) {
  const active = JSON.parse(await readFile(join(root, 'active.json'), 'utf8'));
  const directory = active?.selected?.directory;
  if (!/^[a-f0-9]{64}$/.test(directory ?? '') || directory !== active.selected.manifestDigest) throw new Error('active-pointer-invalid');
  const base = join(root, 'versions', directory);
  const manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'));
  // Streamed: the whole file plus its decoded copy cost ~370 MB at hosted start (FUCQ-190).
  const hash = createHash('sha256'); const rows = []; let pending = Buffer.alloc(0);
  const take = (bytes, start, end) => { if (end > start) rows.push(planRow(bytes.toString('utf8', start, end))); };
  for await (const chunk of createReadStream(join(base, 'configurations.jsonl'), { highWaterMark: 1 << 20 })) {
    hash.update(chunk); const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0; let end;
    while ((end = bytes.indexOf(10, start)) !== -1) { take(bytes, start, end); start = end + 1; }
    pending = Buffer.from(bytes.subarray(start));
  }
  take(pending, 0, pending.length);
  if (hash.digest('hex') !== manifest.checksums?.['configurations.jsonl']) throw new Error('configurations-checksum');
  return { datasetId: manifest.datasetId, corpusVersion: manifest.version, manifestDigest: directory, rows };
}

/** Counts usable rows per scheme model line by reviewed colour and upholstery label, naming every exclusion. */
export function classifyCorpus(rows, corpusModelLines, optionLabels) {
  const lines = {}; const excluded = { unmappedGeneration: {}, ambiguousPaint: 0, ambiguousUpholstery: 0, unlabelledPaint: 0, unlabelledUpholstery: 0 };
  for (const mapped of Object.values(corpusModelLines)) {
    lines[mapped.modelLineId] = { modelLineId: mapped.modelLineId, title: mapped.title, rows: 0, colourCounts: {}, upholsteryCounts: {}, configurations: [] };
  }
  for (const row of rows) {
    const mapped = corpusModelLines[row.generation];
    if (!mapped) { excluded.unmappedGeneration[row.generation] = (excluded.unmappedGeneration[row.generation] || 0) + 1; continue; }
    if (row.paint.length !== 1) { excluded.ambiguousPaint += 1; continue; }
    if (row.upholstery.length !== 1) { excluded.ambiguousUpholstery += 1; continue; }
    const colour = optionLabels.paint[row.paint[0]]; const upholstery = optionLabels.upholstery[row.upholstery[0]];
    if (!colour) { excluded.unlabelledPaint += 1; continue; }
    if (!upholstery) { excluded.unlabelledUpholstery += 1; continue; }
    const line = lines[mapped.modelLineId];
    line.rows += 1; line.colourCounts[colour] = (line.colourCounts[colour] || 0) + 1;
    line.upholsteryCounts[upholstery] = (line.upholsteryCounts[upholstery] || 0) + 1;
    line.configurations.push({ configurationId: row.configurationId, modelLineId: mapped.modelLineId, colour });
  }
  return { lines, excluded };
}

/** Shares to 4 decimals; the largest share absorbs rounding so they sum to exactly 1. */
export function roundedShares(counts) {
  const labels = Object.keys(counts).sort(byCode); const total = labels.reduce((sum, label) => sum + counts[label], 0);
  const units = Object.fromEntries(labels.map((label) => [label, Math.round(counts[label] / total * 10000)]));
  const largest = labels.reduce((best, label) => (counts[label] > counts[best] ? label : best), labels[0]);
  units[largest] += 10000 - labels.reduce((sum, label) => sum + units[label], 0);
  return Object.fromEntries(labels.map((label) => [label, units[label] / 10000]));
}

const validCorpusModelLines = (v) => object(v) && Object.keys(v).length > 0 && Object.values(v).every((row) => object(row) && text(row.modelLineId) && text(row.title));
const validLabels = (v) => object(v) && ['paint', 'upholstery'].every((kind) => object(v[kind]) && Object.values(v[kind]).every(text));

/** Builds the trusted generator plan from the retained corpus; every label comes through PolicyService. */
export async function buildRetainedCorpusPlan({ root, policyService, read, fleetPlanPath } = {}) {
  if (typeof root !== 'string' || typeof policyService?.getAssumption !== 'function' || !object(read)) return invalid('invalid-plan-input');
  try {
    const policy = {};
    for (const key of ['stock.corpusModelLines.v1', 'stock.optionLabels.v1']) {
      const response = await policyService.getAssumption(key, read);
      if (response?.status !== 'ok' || response.value?.key !== key) return unavailable('required-plan-policy-unavailable');
      policy[key] = response.value.value;
    }
    const corpusModelLines = policy['stock.corpusModelLines.v1']; const optionLabels = policy['stock.optionLabels.v1'];
    if (!validCorpusModelLines(corpusModelLines) || !validLabels(optionLabels)) return invalid('unsupported-plan-policy');
    root = resolve(root);
    const corpus = await readRetainedCorpus(root);
    const { lines, excluded } = classifyCorpus(corpus.rows, corpusModelLines, optionLabels);
    const configurations = []; const aggregateKeys = {}; const modelTitles = {};
    for (const line of Object.values(lines).sort((a, b) => byCode(a.modelLineId, b.modelLineId))) {
      if (!line.configurations.length) continue;
      aggregateKeys[line.modelLineId] = `stock.aggregate.${line.modelLineId}`;
      modelTitles[line.modelLineId] = line.title;
      const groups = new Map();
      for (const row of line.configurations) groups.set(row.colour, [...(groups.get(row.colour) || []), row]);
      for (const colour of [...groups.keys()].sort(byCode)) {
        configurations.push(...groups.get(colour).sort((a, b) => byCode(a.configurationId, b.configurationId)).slice(0, PER_COLOUR_LIMIT));
      }
    }
    const fleet = JSON.parse(await readFile(fleetPlanPath ?? join(dirname(root), 'fleet-plan.json'), 'utf8'));
    const titles = fleet.coverage.schemeModelLines;
    const covered = Object.values(lines).filter((line) => line.rows > 0);
    const rel = relative(REPO_ROOT, root);
    const location = rel.startsWith('..') ? basename(root) : rel;
    const coverage = { schemeModelLines: titles.map((title) => {
      const line = covered.find((row) => row.title === title);
      return { title, covered: Boolean(line), modelLineId: line?.modelLineId ?? null, corpusRows: line?.rows ?? 0,
        plannedConfigurations: line ? configurations.filter((row) => row.modelLineId === line.modelLineId).length : 0 };
    }), coveredCount: covered.length, totalCount: titles.length, excluded,
    note: 'Only the scheme lines with retained corpus rows are covered; the rest are the FUCQ-77 coverage gap.' };
    if (!configurations.length) return invalid('no-usable-corpus-rows');
    return ok({ plan: { kind: 'retained-corpus', source: `FUCQ-61 retained corpus ${location}`, datasetId: corpus.datasetId,
      corpusVersion: corpus.corpusVersion, configurations, aggregateKeys, titles: modelTitles }, coverage });
  } catch { return unavailable('retained-corpus-unavailable'); }
}
