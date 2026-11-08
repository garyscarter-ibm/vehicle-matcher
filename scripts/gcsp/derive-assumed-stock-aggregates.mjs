#!/usr/bin/env node
// Derives the assumed colour/upholstery mix for stock.aggregate.* from the retained corpus. Offline; no network.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyCorpus, readRetainedCorpus, roundedShares } from '../../server/gcsp/vehicle-evidence/stock-configuration-plan.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SEED = 'server/gcsp/policy/seed-v1.json';
const CORPUS = 'server/data/gcsp/vehicle-evidence/fleet-source.v1';

export async function deriveAssumedAggregates({ seedPath = ROOT + SEED, corpusRoot = ROOT + CORPUS } = {}) {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  const value = (key) => seed.assumptions.find((row) => row.key === key)?.value;
  const corpusModelLines = value('stock.corpusModelLines.v1'); const optionLabels = value('stock.optionLabels.v1');
  const corpus = await readRetainedCorpus(corpusRoot);
  const { lines, excluded } = classifyCorpus(corpus.rows, corpusModelLines, optionLabels);
  const models = {};
  for (const line of Object.values(lines)) {
    const shares = { colourShares: roundedShares(line.colourCounts), upholsteryShares: roundedShares(line.upholsteryCounts) };
    const entry = value(`stock.aggregate.${line.modelLineId}`);
    models[line.modelLineId] = { title: line.title, usableRows: line.rows, colourCounts: line.colourCounts, upholsteryCounts: line.upholsteryCounts, ...shares,
      seedMatches: entry ? JSON.stringify(entry.colourShares) === JSON.stringify(shares.colourShares)
        && JSON.stringify(entry.upholsteryShares) === JSON.stringify(shares.upholsteryShares) : null };
  }
  return { schemaVersion: 1, kind: 'assumed-stock-aggregate-derivation', derivedFrom: SEED,
    corpus: { path: CORPUS, datasetId: corpus.datasetId, version: corpus.corpusVersion, manifestDigest: corpus.manifestDigest, rows: corpus.rows.length },
    method: 'Configuration mix of retained rows by reviewed display label, rounded to 4 decimals with the largest share absorbing rounding. Not observed stock.',
    excluded, excludedReasons: { unmappedGeneration: 'Generation has no scheme line in stock.corpusModelLines.v1; G23 is the single north-american-reference (REF1) row.',
      ambiguousPaint: 'Not exactly one paint code.', ambiguousUpholstery: 'Not exactly one upholstery code.',
      unlabelledPaint: 'Paint code absent from stock.optionLabels.v1.', unlabelledUpholstery: 'Upholstery code absent from stock.optionLabels.v1.' },
    models };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] === '--out' ? process.argv[3] : null;
  const json = JSON.stringify(await deriveAssumedAggregates(), null, 2) + '\n';
  if (out) writeFileSync(out, json); else process.stdout.write(json);
}
