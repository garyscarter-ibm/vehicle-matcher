import { ok, result } from '../../repository/index.js';
import { validInstant } from '../../policy/file-provider.js';

export const LEARNING_RECORD_VERSION = 1;
export const DECLINE_TYPES = Object.freeze(['body', 'fuel', 'sportiness', 'comfort', 'economy', 'size', 'seats', 'boot',
  'equipment', 'frontIsofix', 'rearIsofix', 'modelLine', 'charging', 'other', 'timing', 'points', 'no-longer-needed',
  'just-not-this-one', 'unclassified']);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 512;
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const nonnegative = (v) => Number.isFinite(v) && v >= 0;
const instant = (v) => v === null || validInstant(v);
const category = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9 .+/_=-]{0,127}$/.test(v);
const preferenceKeys = ['body', 'fuel', 'sportiness', 'comfort', 'economy', 'size'];
const essentialKeys = ['seats', 'boot', 'equipment', 'body', 'fuel', 'frontIsofix', 'rearIsofix', 'modelLine', 'charging'];
const states = ['draft', 'inferred', 'confirmed'];
const bodies = ['hatchback', 'saloon', 'estate', 'suv', 'coupe', 'convertible', 'mpv'];
const fuels = ['petrol', 'diesel', 'phev', 'ev'];
const slider = (v) => Number.isInteger(v) && v >= 0 && v <= 100;
export const unknown = (reason = 'not-captured') => ({ status: 'unknown', reason });
const known = (v, check) => exact(v, ['status', 'value']) && v.status === 'known' && check(v.value);
const unknownValue = (v) => exact(v, ['status', 'reason']) && v.status === 'unknown'
  && ['not-captured', 'missing-quote', 'missing-context', 'not-applicable'].includes(v.reason);
const evidence = (v, check) => unknownValue(v) || known(v, check);
const preferences = (v) => object(v) && Object.entries(v).every(([key, p]) => preferenceKeys.includes(key)
  && exact(p, ['value', 'importance', 'valueState', 'importanceState']) && slider(p.importance)
  && states.includes(p.valueState) && states.includes(p.importanceState)
  && (key === 'body' ? bodies.includes(p.value) : key === 'fuel' ? fuels.includes(p.value) : slider(p.value)));
const essentials = (v) => object(v) && Object.entries(v).every(([key, e]) => {
  if (!essentialKeys.includes(key) || !exact(e, ['value', 'operator', 'unit', 'state'])
    || ![...states, 'needs-confirmation'].includes(e.state)) return false;
  const operator = ['seats', 'boot'].includes(key) ? 'gte' : key === 'equipment' ? 'includes' : 'equals';
  const unit = key === 'seats' ? 'count' : key === 'boot' ? 'L' : key === 'equipment' ? 'equipment-key' : null;
  if (e.operator !== operator || e.unit !== unit) return false;
  if (e.value === null) return e.state === 'needs-confirmation';
  if (['seats', 'boot'].includes(key)) return nonnegative(e.value);
  if (key === 'equipment') return Array.isArray(e.value) && e.value.every(category);
  if (['frontIsofix', 'rearIsofix'].includes(key)) return typeof e.value === 'boolean';
  if (key === 'body') return bodies.includes(e.value);
  if (key === 'fuel') return fuels.includes(e.value);
  if (key === 'charging') return ['home', 'work', 'either', 'not-ready'].includes(e.value);
  return category(e.value);
});
const exposure = (v) => evidence(v, (x) => exact(x, ['from', 'until', 'seconds']) && validInstant(x.from)
  && validInstant(x.until) && Date.parse(x.until) >= Date.parse(x.from)
  && nonnegative(x.seconds) && x.seconds === (Date.parse(x.until) - Date.parse(x.from)) / 1000);
const terms = (v) => evidence(v, (x) => exact(x, ['quoteRef', 'configurationId', 'monthlyPoints', 'allowance', 'unit', 'quotedAt', 'validUntil', 'policyVersion'])
  && text(x.quoteRef) && text(x.configurationId) && nonnegative(x.monthlyPoints) && nonnegative(x.allowance)
  && x.unit === 'points/month' && validInstant(x.quotedAt) && validInstant(x.validUntil)
  && Date.parse(x.validUntil) >= Date.parse(x.quotedAt) && text(x.policyVersion));
const event = (v, allowed) => exact(v, ['state', 'at']) && allowed.includes(v.state) && instant(v.at)
  && (v.state !== 'unknown' || v.at === null);

// This closed envelope is also the synthetic generator's boundary. Extra fields are rejected
// recursively rather than allowing source documents or personal free text into training input.
export function validateLearningRecord(record) {
  const errors = [];
  const check = (field, valid) => { if (!valid) errors.push({ field, reason: 'Invalid learning-record field.' }); };
  const r = record;
  check('record', exact(r, ['schemaVersion', 'recordId', 'runId', 'subject', 'target', 'renewal', 'entitlement', 'brief', 'choiceSet', 'terms', 'outcomes', 'timestamps', 'provenance']));
  if (!object(r)) return result('invalid', { code: 'invalid-learning-record', reasons: errors });
  check('schemaVersion', r.schemaVersion === LEARNING_RECORD_VERSION);
  check('identity', text(r.recordId) && text(r.runId) && exact(r.subject, ['employeeRef', 'entitlementSlotRef', 'renewalRef'])
    && text(r.subject.employeeRef) && [r.subject.entitlementSlotRef, r.subject.renewalRef].every((v) => v === null || text(v)));
  check('target', exact(r.target, ['offerRef', 'holdRef', 'quoteRef', 'orderRef', 'configurationId'])
    && [r.target.offerRef, r.target.holdRef, r.target.quoteRef, r.target.orderRef].every((v) => v === null || text(v))
    && evidence(r.target.configurationId, text));
  check('renewal', exact(r.renewal, ['cohort', 'period']) && evidence(r.renewal.cohort, text)
    && evidence(r.renewal.period, (v) => exact(v, ['from', 'until']) && validInstant(v.from) && validInstant(v.until) && Date.parse(v.until) >= Date.parse(v.from)));
  check('entitlement', exact(r.entitlement, ['schemeId', 'gradeId', 'allowanceBand'])
    && Object.values(r.entitlement).every((v) => evidence(v, category)));
  check('brief', exact(r.brief, ['briefVersion', 'policyVersion', 'confirmedAt', 'preferences', 'essentials'])
    && positive(r.brief.briefVersion) && text(r.brief.policyVersion) && validInstant(r.brief.confirmedAt)
    && preferences(r.brief.preferences) && essentials(r.brief.essentials));
  check('choiceSet', evidence(r.choiceSet, (v) => Array.isArray(v) && v.every((a) => exact(a, ['configurationId', 'eligible', 'available', 'exposure', 'terms'])
    && text(a.configurationId) && [a.eligible, a.available].every((x) => x === null || typeof x === 'boolean') && exposure(a.exposure) && terms(a.terms))));
  check('terms', terms(r.terms));
  const o = r.outcomes;
  check('outcomes', exact(o, ['offered', 'selection', 'acceptance', 'decline', 'expiry', 'wait', 'satisfaction'])
    && event(o.offered, ['offered', 'unknown']) && event(o.selection, ['selected', 'pending', 'unknown'])
    && event(o.acceptance, ['accepted', 'pending', 'unknown']) && event(o.expiry, ['expired', 'unknown'])
    && exact(o.decline, ['state', 'at', 'reasonType']) && event({ state: o.decline.state, at: o.decline.at }, ['declined', 'unknown'])
    && (o.decline.state === 'declined' ? DECLINE_TYPES.includes(o.decline.reasonType) : o.decline.reasonType === null)
    && exact(o.wait, ['state', 'at', 'reasonType']) && event({ state: o.wait.state, at: o.wait.at }, ['waited', 'unknown'])
    && (o.wait.state === 'waited' ? o.wait.reasonType === 'no-acceptable-choice' : o.wait.reasonType === null)
    && event(o.satisfaction, ['satisfied', 'dissatisfied', 'unknown']));
  if (object(o)) {
    const has = (key, state) => o[key]?.state === state;
    check('outcomes.wait', !has('wait', 'waited') || ['offered', 'selection', 'acceptance', 'decline', 'expiry'].every((key) => o[key]?.state === 'unknown'));
    check('outcomes.consistency', !(has('decline', 'declined') && (has('acceptance', 'accepted') || has('selection', 'selected') || has('expiry', 'expired')))
      && !(has('expiry', 'expired') && (has('acceptance', 'accepted') || has('selection', 'selected')))
      && !((has('selection', 'pending') || has('acceptance', 'pending'))
        && (has('acceptance', 'accepted') || has('selection', 'selected') || has('decline', 'declined') || has('expiry', 'expired'))));
  }
  check('timestamps', exact(r.timestamps, ['projectedAt', 'clockVersion']) && validInstant(r.timestamps.projectedAt)
    && (text(r.timestamps.clockVersion) || positive(r.timestamps.clockVersion)));
  const asOf = Date.parse(r.timestamps?.projectedAt);
  const capturedByProjection = (at) => validInstant(at) && Date.parse(at) <= asOf;
  check('timestamps.business', capturedByProjection(r.brief?.confirmedAt)
    && (!object(o) || Object.values(o).every((value) => value?.at == null || capturedByProjection(value.at)))
    && (r.terms?.status !== 'known' || capturedByProjection(r.terms.value?.quotedAt))
    && (r.choiceSet?.status !== 'known' || !Array.isArray(r.choiceSet.value) || r.choiceSet.value.every((alternative) =>
      alternative?.terms?.status !== 'known' || capturedByProjection(alternative.terms.value?.quotedAt))));
  check('provenance', exact(r.provenance, r.provenance?.kind === 'synthetic' ? ['kind', 'generatorVersion', 'seed'] : ['kind'])
    && (r.provenance.kind === 'observed' || r.provenance.kind === 'synthetic' && text(r.provenance.generatorVersion)
      && (text(r.provenance.seed) || Number.isSafeInteger(r.provenance.seed))));
  return errors.length ? result('invalid', { code: 'invalid-learning-record', reasons: errors }) : ok(structuredClone(r));
}

export function projectBriefIntent(brief) {
  return {
    preferences: Object.fromEntries(Object.entries(brief.preferences ?? {}).filter(([key]) => preferenceKeys.includes(key))
      .map(([key, p]) => [key, { value: p.value, importance: p.importance, valueState: p.valueState, importanceState: p.importanceState }])),
    essentials: Object.fromEntries(Object.entries(brief.essentials ?? {}).filter(([key]) => essentialKeys.includes(key))
      .map(([key, e]) => [key, { value: e.value, operator: e.operator, unit: e.unit, state: e.state }])),
  };
}
