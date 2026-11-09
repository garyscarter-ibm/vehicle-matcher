// Pure view model for the stored process comparison. Formatting only: every figure comes from the stored result. Throws on a malformed shape.
import { BASELINE, BUDDY, VERDICTS, BETTER_WHEN, FALLBACK_CAVEAT, measureLabel, measureKind, formatMeasure, differenceText, statusLabel,
  formatDemoTime, oldPolicyText } from './comparison-copy.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const nullable = (v) => v === null || finite(v);
const fail = (what) => { throw new TypeError(`Malformed stored comparison: ${what}`); };

const readStats = (stats, what) => {
  if (!object(stats) || !['mean', 'min', 'max'].every((k) => nullable(stats[k]))) fail(what);
  return stats;
};
const compactValue = (v) => (typeof v === 'string' ? v : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

// Shares sit on 0..1 and fit on 0..100; the rest on 0..the largest value either route reaches.
function scaleFor(kind, rows) {
  if (kind === 'share') return { min: 0, max: 1 };
  if (kind === 'fit') return { min: 0, max: 100 };
  const top = Math.max(0, ...rows.flatMap((r) => [r.mean, r.min, r.max]).filter(finite));
  return { min: 0, max: top > 0 ? top : 1 };
}

function toMeasure(entry) {
  if (!object(entry) || !text(entry.measure) || !BETTER_WHEN[entry.betterWhen] || !VERDICTS[entry.verdict]) fail('difference entry');
  const kind = measureKind(entry.measure);
  const current = readStats(entry.current, 'current'); const buddy = readStats(entry.buddy, 'buddy'); const diff = readStats(entry.difference, 'difference');
  const rows = [{ label: BASELINE, ...pick(current) }, { label: BUDDY, ...pick(buddy) }];
  return { key: entry.measure, label: measureLabel(entry.measure), kind, betterWhen: entry.betterWhen, hint: BETTER_WHEN[entry.betterWhen],
    verdict: entry.verdict, verdictText: VERDICTS[entry.verdict], differenceText: differenceText(kind, diff), rows, scale: scaleFor(kind, rows),
    format: (v) => formatMeasure(kind, v) };
}
const pick = ({ mean, min, max }) => ({ mean, min, max });

function toAssumption(row) {
  if (!object(row) || !text(row.key) || !('value' in row)) fail('assumption');
  return { key: row.key, value: compactValue(row.value), unit: row.unit ?? '', status: statusLabel(row.status), basis: row.basis ?? '' };
}

/** stored = the read route's value -> { meta, oldPolicy, caveat, measures, limitations, assumptions, provenance }. */
export function toComparisonView(stored) {
  if (!object(stored) || !object(stored.result) || stored.result.kind !== 'process-comparison') fail('result');
  const { result } = stored; const { manifest } = result;
  if (!Array.isArray(result.differences) || !Array.isArray(result.assumptions) || !object(manifest) || !Array.isArray(manifest.seeds)) fail('sections');
  if (!text(stored.policyVersion)) fail('policy version');
  const measures = result.differences.map(toMeasure);
  const assumptions = result.assumptions.map(toAssumption);
  const caveat = text(result.caveat) ? result.caveat : FALLBACK_CAVEAT;
  const limitations = (Array.isArray(result.limitations) ? result.limitations : []).filter((l) => text(l) && l !== caveat);
  const size = manifest.overlays?.['comparison.cohortSize'] ?? result.assumptions.find((a) => a.key === 'comparison.cohortSize')?.value;
  const made = formatDemoTime(result.completedAt); const stamped = formatDemoTime(stored.storedAt);
  const policyCurrent = stored.policyCurrent !== false;
  return {
    meta: { seeds: manifest.seeds.length, policyVersion: stored.policyVersion, made, employees: finite(size) ? size : null, codeRevision: text(manifest.codeRevision) ? manifest.codeRevision : null },
    oldPolicy: policyCurrent ? null : oldPolicyText(stored.policyVersion, text(stored.activePolicyVersion) ? stored.activePolicyVersion : 'unknown'),
    caveat, measures, limitations, assumptions,
    provenance: { seeds: manifest.seeds.join(', '), policyVersion: stored.policyVersion, policyHash: text(manifest.policyHash) ? manifest.policyHash.slice(0, 12) : null,
      generatorVersion: manifest.generatorVersion ?? null, codeRevision: text(manifest.codeRevision) ? manifest.codeRevision : null, resultId: stored.resultId ?? null, made, stored: stamped },
  };
}
