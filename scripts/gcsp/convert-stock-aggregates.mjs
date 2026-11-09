#!/usr/bin/env node
// FUCQ-78: writes the observed stock aggregate report into the seed's stock.aggregate.* entries. Offline; no network.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { roundedShares } from '../../server/gcsp/vehicle-evidence/stock-configuration-plan.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SEED_PATH = 'server/gcsp/policy/seed-v1.json';
export const REPORT_PATH = 'docs/gcsp/evidence/fucq-20/stock-aggregates-2026-11-08.json';
const PREFIX = 'stock.aggregate.';
const RANGES = ['leadTimeWeeks', 'deliveryDateSpread', 'priceBand'];
const counts = (rows) => Object.fromEntries(rows.map((row) => [row.label, row.count]));

function basisFor(model) {
  const reach = model.complete ? 'complete to the end of the results' : 'capped at 40 pages before the end of the results';
  return `Observed BMW UK stock-locator aggregate, ${model.sampleDate}: national nearest-first sample, ${reach}, ${model.carCount} cars. `
    + 'Only label shares and ranges are kept; no car-level data.';
}

export function convertModel(model, report, template) {
  const unknown = [...Object.values(model.unknownCounts ?? {}), ...RANGES.map((name) => model[name]?.unknownCount ?? 1)];
  if (unknown.some((count) => count !== 0)) throw new Error(`${model.modelLineId}: nonzero unknown count`);
  if (RANGES.some((name) => Object.values(model[name]).some((value) => value === null))) throw new Error(`${model.modelLineId}: null range`);
  const { leadTimeWeeks: l, deliveryDateSpread: d, priceBand: p } = model;
  return { key: `${PREFIX}${model.modelLineId}`,
    value: { modelLineId: model.modelLineId, carCount: model.carCount,
      colourShares: roundedShares(counts(model.colourShares)), upholsteryShares: roundedShares(counts(model.upholsteryShares)),
      leadTimeWeeks: { min: l.min, max: l.max }, deliveryDateSpread: { min: d.min, max: d.max },
      priceBand: { min: p.min, max: p.max, currency: p.currency }, sampleDate: model.sampleDate, requestCount: model.requestCount,
      sourceKind: 'observed-aggregate' },
    unit: template.unit, status: 'observed aggregate', basis: basisFor(model), source: REPORT_PATH, sourceDate: report.sampleDate,
    policyVersion: template.policyVersion, effectiveFrom: template.effectiveFrom };
}

export function convertStockAggregates({ seedPath = ROOT + SEED_PATH, reportPath = ROOT + REPORT_PATH } = {}) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (report.evidenceKind !== 'observed aggregate') throw new Error('report is not an observed aggregate');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  const rows = seed.assumptions;
  const first = rows.findIndex((row) => row.key.startsWith(PREFIX));
  if (first < 0) throw new Error('seed has no stock.aggregate entry to follow');
  const template = Object.fromEntries(['unit', 'policyVersion', 'effectiveFrom'].map((name) => [name, rows[first][name]]));
  const converted = []; const skipped = [];
  for (const model of report.models) {
    if (model.carCount === 0) { skipped.push(model.modelLineId); continue; }
    const row = convertModel(model, report, template);
    const at = rows.findIndex((existing) => existing.key === row.key);
    if (at >= 0) rows[at] = row;
    else rows.splice(rows.reduce((best, existing, i) => (existing.key.startsWith(PREFIX) ? i : best), first) + 1, 0, row);
    converted.push(model.modelLineId);
  }
  // Escape non-ASCII to match the seed's existing encoding.
  const text = `${JSON.stringify(seed, null, 2).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
  return { text, converted, skipped };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { text, converted, skipped } = convertStockAggregates();
    writeFileSync(ROOT + SEED_PATH, text);
    console.log(`converted: ${converted.join(', ')}`);
    if (skipped.length) console.log(`skipped (no cars observed): ${skipped.join(', ')}`);
  } catch (error) { console.error(`refused: ${error.message}`); process.exit(1); }
}
