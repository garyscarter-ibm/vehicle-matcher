import { validInstant } from '../policy/file-provider.js';
import { confirmedFact, scorePreferences } from '../../scenarios/employee/index.js';
import { canonicalVehicleIdentifier } from '../vehicle-evidence/vehicle-lookup.js';

export const FEEDBACK_KEY = 'employee.currentCarFeedback.v1';
// The evaluator implements exactly this order, so a policy naming another one fails closed.
const PRECEDENCE = ['gates', 'sameAgain', 'rating', 'preferences'];
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 256;
const strings = ['configuration', 'body', 'fuel', 'modelLine', 'eligibilityModelKey'];
const numbers = { seats: 'count', boot: 'L', mpg: 'mpg-imperial', zeroTo62: 's', points: 'points-per-month', sizeClass: 'ordinal-1-5' };
const assurance = { synthetic: 'synthetic-scenario' };
const validSource = (s, now) => s && ['synthetic', 'dated-snapshot', 'authorised-live'].includes(s.mode)
  && ['sourceRef', 'sourceVersion', 'schemaVersion'].every((k) => text(s[k]))
  && ['effectiveFrom', 'observedAt'].every((k) => validInstant(s[k]) && Date.parse(s[k]) <= Date.parse(now));

// Pure provider-side projection of the employee's current contract; anything missing or ambiguous gives null.
export function projectCurrentCarBaseline({ manualContext, contractId, context, now } = {}) {
  if (!text(contractId) || !validInstant(now) || !Array.isArray(manualContext?.contracts) || !validSource(manualContext.source, now)) return null;
  const matches = manualContext.contracts.filter((row) => row?.contractId === contractId);
  if (matches.length !== 1) return null;
  const [contract] = matches;
  if (!context || contract.employeeId !== context.employeeId || contract.schemeId !== context.schemeId || contract.status !== 'current'
    || (context.entitlementSlotId !== undefined && contract.slotId !== context.entitlementSlotId) || !validSource(contract.source, now)) return null;
  const { source, vehicle } = contract;
  const provenance = { sourceRef: source.sourceRef, version: source.sourceVersion, observedAt: source.observedAt,
    assurance: assurance[source.mode] ?? 'derived' };
  const facts = {};
  const put = (key, value, unit) => { facts[key] = { status: 'known', value, unit, provenance: { ...provenance } }; };
  if (plain(vehicle)) {
    for (const key of strings) if (text(vehicle[key])) put(key, vehicle[key], null);
    if (canonicalVehicleIdentifier('configuration', vehicle.configurationId)) put('configurationId', vehicle.configurationId, null);
    for (const [key, unit] of Object.entries(numbers)) if (Number.isFinite(vehicle[key]) && vehicle[key] > 0) put(key, vehicle[key], unit);
    if (Array.isArray(vehicle.tags) && vehicle.tags.length && vehicle.tags.every(text)) put('tags', [...vehicle.tags], null);
  }
  return { contractId, source: { mode: source.mode, sourceVersion: source.sourceVersion, observedAt: source.observedAt }, facts };
}

// The saved typed feedback of a stored brief, in the stored shapes; empty for an old brief.
export const storedFeedback = (brief) => Object.fromEntries(['currentCarRating', 'sameAgain']
  .filter((key) => brief?.[key] !== undefined).map((key) => [key, structuredClone(brief[key])]));

// The provider baseline is trusted only in this shape; anything else is no baseline.
export const baselineOf = (value) => plain(value) && text(value.contractId) && plain(value.source) && text(value.source.sourceVersion)
  && plain(value.facts) ? value : null;

const names = (list) => Array.isArray(list) && list.length > 0 && new Set(list).size === list.length && list.every(text);
const scale = (list) => Array.isArray(list) && list.every((n) => Number.isInteger(n) && n >= 1 && n <= 5);
export const feedbackPolicyValid = (v) => plain(v) && v.schemaVersion === 1 && plain(v.rating)
  && ['positive', 'negative', 'neutral'].every((k) => scale(v.rating[k]))
  && new Set(['positive', 'negative', 'neutral'].flatMap((k) => v.rating[k])).size === ['positive', 'negative', 'neutral'].reduce((n, k) => n + v.rating[k].length, 0)
  && plain(v.similarity) && names(v.similarity.dimensions) && plain(v.sameAgain) && names(v.sameAgain.dimensions)
  && plain(v.improvement) && typeof v.improvement.requireNoWorseOnAll === 'boolean'
  && Number.isSafeInteger(v.improvement.requireBetterOnAtLeast) && v.improvement.requireBetterOnAtLeast >= 1
  && JSON.stringify(v.precedence) === JSON.stringify(PRECEDENCE);

export const ratingClass = (value, rating) => ['positive', 'negative'].find((k) => rating[k].includes(value)) ?? 'neutral';

// similar/same only when every dimension is confirmed equal on both sides; one confirmed difference is different.
export function matchDimensions(baselineFacts, facts, dimensions, config, equal, configurationId) {
  let unknown = false;
  for (const key of dimensions) {
    const a = baselineFacts[key]; const b = facts[key];
    if (key === 'configurationId') {
      if (!confirmedFact(a, config) || !canonicalVehicleIdentifier('configuration', a.value)
        || !canonicalVehicleIdentifier('configuration', configurationId)) { unknown = true; continue; }
      if (a.value !== configurationId) return 'different';
      continue;
    }
    if (!confirmedFact(a, config) || !confirmedFact(b, config)) { unknown = true; continue; }
    if (a.value !== b.value) return 'different';
  }
  return unknown ? 'unknown' : equal;
}

// Same shared utility on both sides; only confirmed expressed preferences count, never price, speed, trim or age.
export function compareImprovement({ snapshot, scored, baseline, brief, employeeFacts, config, slider, rule }) {
  const expressed = Object.entries(brief.preferences).filter(([, p]) => p.importance > slider.minimum
    && p.valueState === 'confirmed' && p.importanceState === 'confirmed').map(([key]) => key);
  if (!expressed.length) return { result: 'not-proven', keys: [] };
  const facts = Object.fromEntries(Object.entries(baseline.facts).filter(([, fact]) => confirmedFact(fact, config)));
  const base = scorePreferences({ display: { name: 'current car' }, facts }, brief, employeeFacts, config, slider).components;
  // An anchored score for a missing model fact (ac6bccdc) is not evidence, so it stays unknown.
  const at = (rows, key) => {
    const row = rows.find((r) => r.field === key);
    return row?.modelFactsIncomplete || !Object.values(row?.facts ?? {}).every((f) => confirmedFact(f, config)) ? undefined : row?.score;
  };
  const scores = expressed.map((key) => [key, at(scored.components, key), at(base, key)]);
  if (scores.some(([, c, b]) => !Number.isFinite(c) || !Number.isFinite(b))) return { result: 'unknown', keys: [] };
  const better = scores.filter(([, c, b]) => c > b).map(([key]) => key);
  const worse = scores.some(([, c, b]) => c < b);
  return { result: (!rule.requireNoWorseOnAll || !worse) && better.length >= rule.requireBetterOnAtLeast ? 'proven' : 'not-proven', keys: better };
}
