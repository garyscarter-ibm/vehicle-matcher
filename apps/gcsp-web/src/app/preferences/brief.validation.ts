import { AccountPreferencesProjection, AccountPreferencesState, BriefPreview, BuddyView, EditableBrief } from './brief.types';
export const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const jsonValue = (v: unknown): boolean => v === null || typeof v === 'string' || typeof v === 'boolean' || finite(v) || Array.isArray(v) && v.every(jsonValue) || record(v) && Object.values(v).every(jsonValue);
const preferenceValue = (v: unknown): boolean => typeof v === 'string' || typeof v === 'boolean' || finite(v) || Array.isArray(v) && v.every((part) => typeof part === 'string' || typeof part === 'boolean' || finite(part));
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(string);
const states = ['draft', 'inferred', 'confirmed'];
export const ratingView = (v: unknown): boolean => v === null || record(v) && string(v['contractId']) && (v['value'] === null || count(v['value']) && Number(v['value']) >= 1 && Number(v['value']) <= 5);
export const sameView = (v: unknown): boolean => record(v) && typeof v['available'] === 'boolean' && typeof v['on'] === 'boolean'
  && (v['available'] ? string(v['contractId']) : v['contractId'] === null && v['on'] === false);
export function buddyView(v: unknown): v is BuddyView {
  return record(v) && ['engaged', 'disengaged'].includes(String(v['state'])) && [null, 'paused', 'minimum-lost'].includes(v['reason'] as null)
    && (v['permissionVersion'] === null || count(v['permissionVersion'])) && ['minimumCategories', 'considered', 'remaining'].every((k) => count(v[k]))
    && typeof v['sameAgain'] === 'boolean' && typeof v['canEngage'] === 'boolean';
}
export function briefShape(v: unknown): v is EditableBrief {
  if (!record(v) || v['schemaVersion'] !== 1 || !record(v['preferences']) || !record(v['essentials'])) return false;
  if (!Object.values(v['preferences']).every((p) => record(p) && preferenceValue(p['value']) && finite(p['importance'])
    && states.includes(String(p['valueState'])) && states.includes(String(p['importanceState'])) && string(p['source']))) return false;
  if (!Object.values(v['essentials']).every((e) => record(e) && Object.hasOwn(e, 'value') && jsonValue(e['value']) && string(e['operator'])
    && (e['unit'] === null || string(e['unit'])) && [...states, 'needs-confirmation'].includes(String(e['state'])) && string(e['source']))) return false;
  const feedback = v['currentCarFeedback']; const rating = v['currentCarRating']; const same = v['sameAgain'];
  return (feedback === undefined || record(feedback) && strings(feedback['preserve']) && strings(feedback['change']) && states.includes(String(feedback['state'])) && string(feedback['source']))
    && (rating === undefined || ratingView(rating) && record(rating) && rating['source'] === 'employee' && string(rating['ratedAt']))
    && (same === undefined || record(same) && typeof same['on'] === 'boolean' && string(same['contractId']) && same['source'] === 'employee' && string(same['setAt']));
}
export function accountProjection(v: unknown): v is AccountPreferencesProjection {
  if (!record(v) || v['schemaVersion'] !== 1 || !string(v['policyVersion']) || !strings(v['order']) || new Set(v['order']).size !== v['order'].length
    || !count(v['minimumCategories']) || !record(v['importance']) || !finite(v['importance']['medium']) || !finite(v['importance']['high']) || !record(v['categories'])) return false;
  const categories = v['categories'];
  if (!v['order'].every((key) => {
    const c = categories[key];
    return record(c) && string(c['label']) && string(c['question']) && (c['kind'] === 'multi'
      ? Array.isArray(c['options']) && c['options'].length > 0 && c['options'].every((o) => record(o) && Object.hasOwn(o, 'value') && preferenceValue(o['value']) && string(o['label']))
      : c['kind'] === 'stops' && finite(c['openDefault']) && Array.isArray(c['stops']) && c['stops'].length > 0 && c['stops'].every((s) => record(s) && finite(s['value']) && string(s['label'])));
  })) return false;
  const u = v['understanding'];
  return record(u) && u['kind'] === 'input-completeness' && count(u['maximum']) && u['maximum'] > 0 && string(u['policyKey']) && count(u['sameAgain'])
    && Array.isArray(u['byConsidered']) && u['byConsidered'].length === v['order'].length + 1 && u['byConsidered'].every((n) => count(n) && n <= Number(u['maximum']));
}
export function accountState(v: unknown): v is AccountPreferencesState {
  if (!record(v) || !count(v['considered']) || typeof v['sameAgain'] !== 'boolean' || !record(v['categories'])) return false;
  if (!Object.values(v['categories']).every((c) => record(c) && (c['state'] === 'unset' || c['state'] === 'considered'
    && preferenceValue(c['value']) && ['medium', 'high'].includes(String(c['importance'])) && typeof c['exact'] === 'boolean'))) return false;
  const u = v['understanding'];
  return record(u) && u['kind'] === 'input-completeness' && count(u['value']) && count(u['maximum']) && u['value'] <= u['maximum']
    && count(u['considered']) && string(u['basis']) && string(u['policyKey']) && string(u['policyVersion']);
}
export function previewShape(v: unknown): v is BriefPreview {
  if (!record(v) || !['recommendations', 'no-stock', 'no-viable-stock'].includes(String(v['state'])) || !count(v['eligibleCount'])
    || !record(v['versions']) || !Array.isArray(v['decisions']) || !Array.isArray(v['recommendations'])) return false;
  const valid = (d: unknown) => record(d) && string(d['orderUuid']) && ['eligible', 'ineligible', 'needs-confirmation'].includes(String(d['gateStatus']))
    && ['unknowns', 'reasons', 'tradeOffs', 'blockers'].every((key) => Array.isArray(d[key]) && d[key].every(record)) && record(d['versions']);
  const decisions = v['decisions'];
  return decisions.every(valid) && v['recommendations'].every((d) => record(d) && string(d['orderUuid']) && Array.isArray(d['reasons']) && d['reasons'].every(record)
    && Array.isArray(d['tradeOffs']) && d['tradeOffs'].every(record) && record(d['versions']) && d['gateStatus'] === 'eligible'
    && decisions.some((e) => e['orderUuid'] === d['orderUuid'] && e['gateStatus'] === 'eligible'))
    && v['eligibleCount'] === decisions.filter((d) => d['gateStatus'] === 'eligible').length
    && (v['state'] === 'recommendations') === (v['recommendations'].length > 0) && (v['state'] === 'no-stock') === (decisions.length === 0);
}
