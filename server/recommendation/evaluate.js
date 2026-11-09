// Pure candidate evaluation: weighted dimensions, evidence, blending. Core-only imports, no I/O.
import { compareBy, descending } from './order.js';

/** Sum of a weight table, in insertion order. */
export const weightTotal = (weights) => Object.values(weights).reduce((a, b) => a + b, 0);

/** Match percentage: fit and taste ratios mixed by `share`, rounded to a whole number. */
export const blendScore = (fitRatio, tasteRatio, share) => Math.round((fitRatio * (1 - share) + tasteRatio * share) * 100);

/** A 0..1 ratio as a whole percentage. */
export const percent = (ratio) => Math.round(ratio * 100);

/**
 * Score one candidate across `dimensions` (name -> scorer returning { score, reason?, stretch? }).
 * Zero-weight dimensions are skipped; the top `reasonLimit` reasons at or over `reasonFloor` win.
 * @returns {{ fitWeighted, tasteWeighted, stretch, reasons: string[], evidence: Array }}
 */
export function evaluateDimensions(candidate, {
  dimensions, fitWeights, tasteWeights, args = [], reasonFloor, reasonLimit,
}) {
  let fitWeighted = 0;
  let tasteWeighted = 0;
  let stretch = false;
  const evidence = [];
  const ranked = [];
  for (const [dimension, scorer] of Object.entries(dimensions)) {
    const weight = (fitWeights[dimension] ?? 0) + (tasteWeights[dimension] ?? 0);
    if (weight === 0) continue;
    const r = scorer(candidate, ...args);
    if (fitWeights[dimension]) fitWeighted += fitWeights[dimension] * r.score;
    if (tasteWeights[dimension]) tasteWeighted += tasteWeights[dimension] * r.score;
    if (r.stretch) stretch = true;
    evidence.push({ dimension, score: r.score, weight, reason: r.reason });
    if (r.reason && r.score >= reasonFloor) ranked.push({ reason: r.reason, rank: weight * r.score });
  }
  const reasons = ranked
    .sort(compareBy(descending((c) => c.rank)))
    .slice(0, reasonLimit)
    .map((c) => c.reason);
  return { fitWeighted, tasteWeighted, stretch, reasons, evidence };
}
