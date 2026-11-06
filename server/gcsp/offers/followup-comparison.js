import { ok, result } from '../repository/core.js';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const confirmed = (v) => v?.valueState === 'confirmed' && v.importanceState === 'confirmed';
const unavailable = () => result('unavailable', { code: 'followup-comparison-unavailable',
  reason: 'The stored offer comparison is unavailable.', retryable: true });
const unknown = () => ({ status: 'unknown', value: null, unit: null, provenance: null });
const factsFor = (quote, keys) => Object.fromEntries(keys.map((key) => [key,
  quote.facts?.facts?.[key] ? structuredClone(quote.facts.facts[key]) : unknown()]));

// Facts retain their quoted units and provenance. Scores remain historical; this is no new scorer.
export function buildFollowupComparison({ previousOffer, nextOffer, brief, config } = {}) {
  const previous = previousOffer?.quote; const next = nextOffer?.quote;
  if (!plain(previous) || !plain(next) || !plain(config?.preferences) || !plain(config.essentials)
    || brief?.status !== 'confirmed' || next.briefVersion !== brief.briefVersion
    || previousOffer.offerId === nextOffer.offerId || previous.quoteId === next.quoteId) return unavailable();
  const requirements = [];
  for (const [key, preference] of Object.entries(brief.preferences ?? {})) {
    const definition = config.preferences[key];
    if (!definition || !confirmed(preference)) continue;
    const fields = Array.isArray(definition.facts) ? definition.facts : [];
    requirements.push({ kind: 'preference', key, value: structuredClone(preference.value), importance: preference.importance,
      previousFacts: factsFor(previous, fields), nextFacts: factsFor(next, fields) });
  }
  for (const [key, essential] of Object.entries(brief.essentials ?? {})) {
    const definition = config.essentials[key];
    if (!definition || essential.state !== 'confirmed' || essential.value === null) continue;
    requirements.push({ kind: 'essential', key, value: structuredClone(essential.value), operator: essential.operator,
      unit: essential.unit, previousFacts: factsFor(previous, [key]), nextFacts: factsFor(next, [key]) });
  }
  return ok({ schemaVersion: 1, currentBriefVersion: brief.briefVersion, requirements,
    previous: { offer: previousOffer, scoreBasis: { kind: 'historical-quote', briefVersion: previous.briefVersion,
      policyVersion: previous.policyVersion, quotedAt: previous.quotedAt } },
    next: { offer: nextOffer, scoreBasis: { kind: 'historical-quote', briefVersion: next.briefVersion,
      policyVersion: next.policyVersion, quotedAt: next.quotedAt } } });
}
