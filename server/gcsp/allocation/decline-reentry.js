import { inputDigest } from '../repository/core.js';
import { validInstant } from '../policy/file-provider.js';
import { intentValue } from '../../scenarios/employee/index.js';

export const REENTRY_KEY = 'offer.declinedCar.reentry.v1';
const supported = {
  'body-style': ['preferences.body.value', 'body', 'known-value'],
  fuel: ['preferences.fuel.value', 'fuel', 'known-value'],
  size: ['preferences.size.value', 'size', 'closer-fit'],
  equipment: ['essentials.equipment', 'equipment', 'essential-met'],
};
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0;
const revision = (v) => Number.isSafeInteger(v) && v > 0;
const same = (a, b) => inputDigest(a) === inputDigest(b);
const valueAt = (brief, path) => path.split('.').reduce((value, key) => value?.[key], brief) ?? null;
const essentialValue = (v) => plain(v) ? { value: Array.isArray(v.value) ? [...new Set(v.value)].sort() : v.value,
  operator: v.operator, unit: v.unit } : v;
const semantic = (v, mapping) => mapping.match === 'essential-met' ? essentialValue(v) : intentValue(v);
const only = (v, keys) => plain(v) && Object.keys(v).length === keys.length && Object.keys(v).every((key) => keys.includes(key));

export function validDeclineReentryRule(value) {
  return only(value, ['schemaVersion', 'rule', 'reasons']) && value.schemaVersion === 1 && value.rule === 'confirmedDeclineAnswerMustFitCandidate'
    && Array.isArray(value.reasons) && value.reasons.length === Object.keys(supported).length
    && new Set(value.reasons.map((r) => r?.reasonCode)).size === value.reasons.length
    && value.reasons.every((r) => only(r, ['reasonCode', 'path', 'field', 'match'])
      && supported[r.reasonCode]?.every((v, i) => [r.path, r.field, r.match][i] === v));
}

const preferenceObserved = (decision, field) => {
  const evidence = [...(decision?.reasons ?? []), ...(decision?.tradeOffs ?? [])]
    .filter((r) => r.code === 'preference-fit' && r.field === field);
  return evidence.length === 1 && Number.isFinite(evidence[0].observed) && evidence[0].modelFactsIncomplete !== true
    ? evidence[0].observed : null;
};

// Build joins once, rather than scan whole offer/brief history for every candidate.
export function createDeclineReentry({ rows, rule }) {
  const offers = new Map(); const briefs = new Map(); const newest = new Map();
  for (const row of rows.offers) if (!offers.has(row.offerId)) offers.set(row.offerId, row);
  for (const row of rows.briefs) {
    if (!briefs.has(row.employeeId)) briefs.set(row.employeeId, new Map());
    const versions = briefs.get(row.employeeId);
    if (!versions.has(row.briefVersion)) versions.set(row.briefVersion, row);
  }
  for (const decision of rows.decisions) {
    const offer = offers.get(decision.offerId);
    if (decision.decision !== 'decline' || !offer || offer.employeeId !== decision.employeeId
      || offer.runId !== decision.runId || !text(offer.orderUuid)) continue;
    const previous = newest.get(decision.employeeId)?.decision;
    const key = [decision.createdAt ?? '', decision.decisionId ?? ''];
    const oldKey = [previous?.createdAt ?? '', previous?.decisionId ?? ''];
    if (!previous || key[0] > oldKey[0] || key[0] === oldKey[0] && key[1] > oldKey[1]) {
      newest.set(decision.employeeId, { decision, offer });
    }
  }
  const mappings = new Map(rule.reasons.map((r) => [r.reasonCode, r]));
  function forBrief(brief) {
    const latest = newest.get(brief.employeeId);
    if (!latest || latest.decision.runId !== brief.runId) return null;
    const { decision, offer } = latest; const change = brief.postDeclineChange;
    const mapping = mappings.get(decision.reason?.code);
    const state = { decision, offer, mapping, answered: false };
    if (!mapping || !plain(change) || change.decisionId !== decision.decisionId || change.offerId !== offer.offerId
      || change.path !== mapping.path || !revision(change.fromBriefVersion) || change.fromBriefVersion >= brief.briefVersion
      || !revision(decision.versions?.brief) || change.fromBriefVersion < decision.versions.brief
      || !Object.hasOwn(change, 'before') || !Object.hasOwn(change, 'after')
      || !text(change.confirmedBy) || !validInstant(change.confirmedAt) || brief.status !== 'confirmed'
      || decision.outcome?.status !== 'ok' || decision.outcome.value?.state !== 'declined'
      || decision.outcome.value.decisionId !== decision.decisionId || !text(decision.reason.policyVersion)) return state;
    const previous = briefs.get(brief.employeeId)?.get(change.fromBriefVersion);
    if (!previous || previous.status !== 'confirmed' || previous.runId !== brief.runId) return state;
    const saved = briefs.get(brief.employeeId)?.get(change.fromBriefVersion + 1);
    if (!saved || saved.status !== 'confirmed' || saved.confirmedBy !== change.confirmedBy
      || saved.confirmedAt !== change.confirmedAt || !plain(saved.postDeclineChange) || !same(saved.postDeclineChange, change)) return state;
    const answer = mapping.match === 'essential-met' ? brief.essentials?.[mapping.field] : brief.preferences?.[mapping.field];
    if (!answer || answer.source !== 'employee' || (mapping.match === 'essential-met'
      ? answer.state !== 'confirmed' || !plain(change.after) || change.after.state !== 'confirmed' || change.after.source !== 'employee'
      : answer.valueState !== 'confirmed' || answer.importanceState !== 'confirmed')) return state;
    const current = semantic(valueAt(brief, mapping.path), mapping);
    const before = semantic(change.before, mapping); const after = semantic(change.after, mapping);
    if (after === null || !same(current, after) || same(before, after)
      || !same(semantic(valueAt(previous, mapping.path), mapping), before)) return state;
    return { ...state, answered: true, before, after, brief };
  }
  function blocks(state, candidate, snapshot, rejectedQuote) {
    if (!state) return null;
    const { offer, mapping } = state;
    if (!state.answered) return candidate.orderUuid === offer.orderUuid ? { code: 'declined-unresolved' } : null;
    let resolved = false;
    if (mapping.match === 'known-value') {
      const fact = snapshot?.facts?.[mapping.field];
      const selected = Array.isArray(state.after) ? state.after : [state.after];
      resolved = fact?.status === 'known' && fact.value !== null && selected.includes(fact.value);
    } else if (mapping.match === 'essential-met') {
      resolved = candidate.reasons.some((r) => r.code === 'essential-met' && r.field === mapping.field
        && same(essentialValue(r.requirement), state.after));
    } else {
      const observed = preferenceObserved(candidate, mapping.field);
      const old = rejectedQuote;
      const linked = old?.quoteId === offer.quoteId && old.employeeId === state.brief.employeeId
        && old.runId === state.brief.runId && old.orderUuid === offer.orderUuid
        && old.briefVersion === offer.briefVersion && old.briefVersion === state.decision.versions?.pinnedBrief
        && old.policyVersion === state.decision.versions?.quotePolicy;
      const rejectedObserved = linked ? preferenceObserved(old.eligibility?.decision, mapping.field) : null;
      if (Number.isFinite(state.before) && Number.isFinite(state.after) && observed !== null && rejectedObserved !== null) {
        resolved = candidate.orderUuid === offer.orderUuid
          ? Math.abs(state.after - observed) < Math.abs(state.before - rejectedObserved)
          : Math.abs(state.after - observed) < Math.abs(state.after - rejectedObserved);
      }
    }
    return resolved ? null : { code: 'decline-answer-mismatch', reasonCode: state.decision.reason.code, path: mapping.path };
  }
  return { forBrief, blocks };
}
