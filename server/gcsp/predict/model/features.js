import { requireChoice } from './optimizer.js';

// Scaling/encoding defines the statistical feature version, not eligibility or price policy.
const vehicle = ['wait.intercept', 'vehicle.ev', 'vehicle.estate', 'vehicle.seats/7', 'vehicle.boot/700',
  'vehicle.points/allowance', 'missing.seats', 'missing.boot', 'missing.points'];
const interactions = ['preference.body.match', 'preference.fuel.match', 'importance.body.match',
  'importance.fuel.match', 'essential.seats.capacity', 'essential.boot.capacity'];
export const FEATURE_SETS = Object.freeze({
  'vehicle-only-v1': Object.freeze([...vehicle]),
  'vehicle-preference-v1': Object.freeze([...vehicle, ...interactions]),
});
const validNumber = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const confirmed = (entry) => entry?.valueState === 'confirmed' && entry?.importanceState === 'confirmed';

export function featureVector({ attributes = {}, isWait = false }, brief, featureVersion) {
  const names = FEATURE_SETS[featureVersion];
  requireChoice(names !== undefined, 'featureVersion');
  if (isWait) return names.map((name) => Number(name === 'wait.intercept'));
  const a = attributes;
  for (const key of ['seats', 'boot', 'monthlyPoints', 'allowance'])
    requireChoice(a[key] == null || validNumber(a[key]), `attributes.${key}`);
  const preferences = brief?.preferences ?? {}; const essentials = brief?.essentials ?? {};
  const match = (key) => {
    const p = preferences[key];
    if (!confirmed(p)) return 0;
    requireChoice(typeof p.value === 'string' && validNumber(p.importance) && p.importance <= 100, `preferences.${key}`);
    return Number(a[key] === p.value);
  };
  const importanceMatch = (key) => match(key) * (preferences[key]?.importance ?? 0) / 100;
  const capacity = (key, scale) => {
    const e = essentials[key];
    if (e?.state !== 'confirmed' || a[key] == null) return 0;
    requireChoice(e.operator === 'gte' && validNumber(e.value), `essentials.${key}`);
    // Spare capacity relative to the employee's stated essential, not a new hard gate.
    return (a[key] - e.value) / scale;
  };
  const hasPoints = validNumber(a.monthlyPoints) && validNumber(a.allowance) && a.allowance > 0;
  const values = {
    'wait.intercept': 0, 'vehicle.ev': Number(a.fuel === 'ev'), 'vehicle.estate': Number(a.body === 'estate'),
    'vehicle.seats/7': a.seats == null ? 0 : a.seats / 7, 'vehicle.boot/700': a.boot == null ? 0 : a.boot / 700,
    'vehicle.points/allowance': hasPoints ? a.monthlyPoints / a.allowance : 0,
    'missing.seats': Number(a.seats == null), 'missing.boot': Number(a.boot == null), 'missing.points': Number(!hasPoints),
    'preference.body.match': match('body'), 'preference.fuel.match': match('fuel'),
    'importance.body.match': importanceMatch('body'), 'importance.fuel.match': importanceMatch('fuel'),
    'essential.seats.capacity': capacity('seats', 7), 'essential.boot.capacity': capacity('boot', 700),
  };
  return names.map((name) => values[name]);
}

export function buildChoiceFeatures(example, featureVersion) {
  requireChoice(Array.isArray(example?.alternatives), 'alternatives');
  return { ...example, alternatives: example.alternatives.map((a) => ({ ...a,
    features: featureVector(a, example.brief, featureVersion) })) };
}
