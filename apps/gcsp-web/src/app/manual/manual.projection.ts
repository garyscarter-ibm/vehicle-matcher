import type { ManualClaim, ManualFailure, ManualOrder, ManualProjection, ManualRecord, ManualResult, ManualState, ManualTerms } from './manual.types';

export const manualObject = (v: unknown): v is ManualRecord => v !== null && typeof v === 'object' && !Array.isArray(v);
export const manualText = (v: unknown, max = 2048): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
export const manualPositive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const instant = (v: unknown): v is string => manualText(v) && Number.isFinite(Date.parse(v)) && /(?:Z|[+-]\d\d:\d\d)$/.test(v);
const nullableText = (v: unknown): boolean => v === null || manualText(v);
const fields = (v: ManualRecord, keys: readonly string[]): boolean => keys.every((k) => manualText(v[k]));
const states = ['active', 'released', 'expired', 'allocated', 'claim-pending', 'release-pending', 'selection-pending'];
const approvalStages = (v: unknown): boolean => JSON.stringify(v) === JSON.stringify(['sales-manager approval', 'sent to ordering'])
  || JSON.stringify(v) === JSON.stringify(['HR approval', 'sales-manager approval', 'sent to ordering']);
export function isManualClaim(v: unknown): v is ManualClaim {
  if (!manualObject(v) || !manualObject(v['hold']) || !manualObject(v['quote']) || !manualObject(v['view']) || !instant(v['now'])) return false;
  const h = v['hold']; const q = v['quote']; const view = v['view']; const timing = q['timing']; const pending = v['pendingOperation'];
  return fields(h, ['holdId', 'orderUuid', 'employeeId', 'entitlementSlotId', 'type']) && h['type'] === 'cart'
    && states.includes(h['state'] as string) && ['preview', 'order-review'].includes(h['phase'] as string)
    && ['new', 'replacement'].includes(h['mode'] as string) && manualPositive(h['version']) && instant(h['expiresAt'])
    && (h['reviewStartedAt'] === null || instant(h['reviewStartedAt'])) && nullableText(h['releaseReason'])
    && v['state'] === (h['state'] === 'active' ? 'quoted' : h['state'])
    && fields(q, ['quoteId', 'orderUuid', 'employeeId', 'entitlementSlotId', 'configurationId', 'termsDigest', 'policyVersion', 'contextVersion'])
    && ['orderUuid', 'employeeId', 'entitlementSlotId'].every((k) => q[k] === h[k])
    && manualPositive(q['draftVersion']) && manualPositive(q['stockVersion']) && manualObject(q['facts']) && manualObject(q['terms'])
    && instant(q['quotedAt']) && instant(q['validUntil']) && nullableText(q['driverId'])
    && manualObject(timing) && manualPositive(timing['previewSeconds']) && manualPositive(timing['reviewSeconds']) && timing['transition'] === 'once-from-preview'
    && (pending === null || manualObject(pending) && fields(pending, ['operationId', 'operationType', 'lastKnownState']))
    && (String(h['state']).endsWith('-pending') ? pending !== null : pending === null)
    && fields(view, ['state', 'supportOwner', 'action']) && view['editable'] === false && view['supportOwner'] === 'employee'
    && view['state'] === (String(h['state']).endsWith('-pending') ? 'pending' : v['state'])
    && view['action'] === (String(h['state']).endsWith('-pending') ? 'check-status' : h['state'] === 'active'
      ? h['phase'] === 'order-review' ? 'submit-or-cancel' : 'review-or-cancel' : h['state'] === 'allocated' ? 'continue-order-handoff' : 'browse-stock');
}
export function isManualTerms(v: unknown): v is ManualTerms {
  if (!manualObject(v) || v['schemaVersion'] !== 1 || v['fictional'] !== true
    || !fields(v, ['termsVersion', 'wording', 'policyVersion', 'termsDigest']) || !instant(v['validUntil'])
    || !Array.isArray(v['declarations']) || !v['declarations'].length || !v['declarations'].every((d) => manualObject(d)
      && fields(d, ['id', 'label']) && ['all', 'new', 'replacement'].includes(d['appliesTo'] as string))) return false;
  const declarations = v['declarations'] as ManualRecord[];
  const stages = v['approvalStages']; const w = v['wordingByMode'];
  return new Set(declarations.map((d) => d['id'])).size === declarations.length
    && approvalStages(stages)
    && (w === undefined || manualObject(w) && Object.entries(w).every(([k, text]) => ['new', 'replacement'].includes(k) && manualText(text)));
}
export function isManualOrder(v: unknown): v is ManualOrder {
  if (!manualObject(v) || v['schemaVersion'] !== 1 || !fields(v, ['operationId', 'orderReference'])
    || !['pending', 'acknowledged', 'refused'].includes(v['status'] as string) || !Number.isSafeInteger(v['attempts']) || (v['attempts'] as number) < 0
    || !manualObject(v['selection']) || !manualObject(v['progress']) || !manualObject(v['view'])) return false;
  const s = v['selection']; const p = v['progress']; const view = v['view']; const state = v['status'];
  const selectionState = state === 'acknowledged' ? 'acknowledged' : state === 'refused' ? 'handoff-failed' : 'handoff-pending';
  return fields(s, ['holdId', 'orderUuid', 'policyVersion']) && ['cart', 'buddy-offer'].includes(s['sourceType'] as string)
    && ['orderNumber', 'configurationId', 'quoteId', 'termsVersion'].every((k) => nullableText(s[k]))
    && (s['receivedAt'] === null || instant(s['receivedAt'])) && p['approved'] === false && p['selectionState'] === selectionState
    && manualText(p['current']) && Array.isArray(p['stages'])
    && p['stages'].every((stage) => manualObject(stage) && fields(stage, ['name', 'state']))
    && approvalStages(p['stages'].slice(1).map((stage: ManualRecord) => stage['name']))
    && p['stages'].every((stage: ManualRecord, index: number) => stage['state'] === (index === 0
      ? state === 'acknowledged' ? 'complete' : state === 'refused' ? 'failed' : 'pending'
      : index === 1 && state === 'acknowledged' ? 'waiting' : 'not-started'))
    && (p['stages'][0] as ManualRecord)['name'] === 'selection received'
    && p['current'] === (state === 'acknowledged' ? (p['stages'][1] as ManualRecord)['name'] : 'selection received')
    && view['state'] === (state === 'acknowledged' ? 'awaiting-approval' : selectionState)
    && view['action'] === (state === 'acknowledged' ? 'view-order' : state === 'refused' ? 'contact-support' : 'check-status')
    && (state !== 'acknowledged' || manualText(v['providerReference']))
    && (state !== 'refused' || manualObject(v['failure']) && nullableText(v['failure']['reason']));
}
export function manualFailureState(failure: ManualFailure): ManualState {
  if (failure.status === 'authentication-required' || failure.status === 'unauthenticated') return 'authentication-required';
  if (failure.status === 'forbidden') return 'denied';
  if (failure.status === 'pending' || failure.status === 'uncertain' || failure.status === 'invalid') return failure.status;
  if (failure.status === 'conflict') return /changed|expired|stale|release-required/.test(failure.code) ? 'stale' : 'refused';
  if (failure.status === 'refused') return 'refused';
  return 'unavailable';
}
export interface ManualProjectionInput {
  readonly claim?: ManualResult<ManualClaim> | null; readonly order?: ManualResult<ManualOrder> | null;
  readonly terms?: ManualResult<ManualTerms> | null; readonly failure?: ManualFailure | null;
  readonly loading?: boolean; readonly hasHandoff?: boolean; readonly resumeRequired?: boolean;
  readonly uncertain?: boolean; readonly pending?: boolean; readonly declarations?: Readonly<Record<string, boolean>>;
}
export function projectManual(input: ManualProjectionInput): ManualProjection {
  const claim = input.claim?.status === 'ok' && isManualClaim(input.claim.value) ? input.claim.value : null;
  const terms = input.terms?.status === 'ok' && isManualTerms(input.terms.value) ? input.terms.value : null;
  const orderResult = input.order;
  const order = orderResult && 'value' in orderResult && isManualOrder(orderResult.value) ? orderResult.value : null;
  const declarations = claim && terms ? terms.declarations.filter((d) => d.appliesTo === 'all' || d.appliesTo === claim.hold.mode) : [];
  let failure = input.failure ?? null; let state: ManualState = 'idle';
  if (!failure) {
    for (const result of [input.order, input.claim, input.terms]) {
      if (result && result.status !== 'ok' && result.status !== 'not-found') { failure = result; break; }
    }
  }
  if (order) state = order.status === 'acknowledged' ? 'awaiting-approval' : order.status === 'refused' ? 'refused' : 'pending';
  else if (input.uncertain) state = 'uncertain';
  else if (input.pending) state = 'pending';
  else if (input.loading) state = 'loading';
  else if (failure) state = manualFailureState(failure);
  else if (claim) {
    if (claim.pendingOperation) state = 'pending';
    else if (claim.state === 'released') state = 'released';
    else if (claim.state === 'expired') state = 'expired';
    else if (claim.state !== 'quoted') state = 'stale';
    else if (Date.parse(claim.hold.expiresAt) <= Date.parse(claim.now) || Date.parse(claim.quote.validUntil) <= Date.parse(claim.now)) state = 'expired';
    else if (terms && (terms.policyVersion !== claim.quote.policyVersion || Date.parse(terms.validUntil) <= Date.parse(claim.now))) state = 'stale';
    else if (input.resumeRequired) state = 'resume-required';
    else state = claim.hold.phase === 'order-review' ? 'review' : 'preview';
  } else if (input.claim?.status === 'not-found') state = input.hasHandoff ? 'selection-ready' : 'no-claim';
  const active = !!claim && claim.state === 'quoted' && !claim.pendingOperation && !order
    && (!orderResult || orderResult.status === 'not-found') && failure?.status !== 'pending' && failure?.status !== 'uncertain'
    && !input.uncertain && !input.pending && !input.loading;
  const fresh = !!claim && Date.parse(claim.hold.expiresAt) > Date.parse(claim.now) && Date.parse(claim.quote.validUntil) > Date.parse(claim.now);
  return { state, claim, order, terms, declarations, failure, approved: false,
    wording: claim && terms ? terms.wordingByMode?.[claim.hold.mode] ?? terms.wording : null,
    canReview: active && fresh && !failure && state === 'preview' && !input.resumeRequired && claim?.hold.phase === 'preview',
    canSubmit: active && fresh && !failure && !input.resumeRequired && claim?.hold.phase === 'order-review' && !!terms
      && Date.parse(terms.validUntil) > Date.parse(claim.now) && terms.policyVersion === claim.quote.policyVersion
      && declarations.every((d) => input.declarations?.[d.id] === true),
    canRelease: active && fresh };
}
