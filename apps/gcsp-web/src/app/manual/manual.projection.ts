import type { ManualClaim, ManualEditableDetails, ManualFailure, ManualOrder, ManualProjection, ManualRecord, ManualResult, ManualReviewDetails, ManualState, ManualTerms } from './manual.types';

export const manualObject = (v: unknown): v is ManualRecord => v !== null && typeof v === 'object' && !Array.isArray(v);
export const manualText = (v: unknown, max = 2048): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
export const manualPositive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const instant = (v: unknown): v is string => manualText(v) && Number.isFinite(Date.parse(v)) && /(?:Z|[+-]\d\d:\d\d)$/.test(v);
const nullableText = (v: unknown): boolean => v === null || manualText(v);
const fields = (v: ManualRecord, keys: readonly string[]): boolean => keys.every((k) => manualText(v[k]));
const states = ['active', 'released', 'expired', 'allocated', 'claim-pending', 'release-pending', 'selection-pending'];
const approvalStages = (v: unknown): boolean => JSON.stringify(v) === JSON.stringify(['sales-manager approval', 'sent to ordering'])
  || JSON.stringify(v) === JSON.stringify(['HR approval', 'sales-manager approval', 'sent to ordering']);
function manualSelection(h: ManualRecord, q: ManualRecord): boolean {
  const timing = q['timing'];
  return fields(h, ['holdId', 'orderUuid', 'employeeId', 'entitlementSlotId', 'type']) && h['type'] === 'cart'
    && states.includes(h['state'] as string) && ['preview', 'order-review'].includes(h['phase'] as string)
    && ['new', 'replacement'].includes(h['mode'] as string) && manualPositive(h['version']) && instant(h['expiresAt'])
    && (h['reviewStartedAt'] === null || instant(h['reviewStartedAt'])) && nullableText(h['releaseReason'])
    && fields(q, ['quoteId', 'orderUuid', 'employeeId', 'entitlementSlotId', 'configurationId', 'termsDigest', 'policyVersion', 'contextVersion'])
    && ['orderUuid', 'employeeId', 'entitlementSlotId'].every((k) => q[k] === h[k])
    && manualPositive(q['draftVersion']) && manualPositive(q['stockVersion']) && manualObject(q['facts']) && manualObject(q['terms'])
    && instant(q['quotedAt']) && instant(q['validUntil']) && nullableText(q['driverId'])
    && manualObject(timing) && manualPositive(timing['previewSeconds']) && manualPositive(timing['reviewSeconds']) && timing['transition'] === 'once-from-preview';
}
export const manualRevision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const onlyKeys = (v: ManualRecord, keys: readonly string[]): boolean => Object.keys(v).every((key) => keys.includes(key));
const canonical = (v: unknown): string => JSON.stringify(v, (_key, value: unknown) => manualObject(value)
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value) ?? 'undefined';
export const sameManualDetails = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
export function editableManualDetails(value: ManualReviewDetails): ManualEditableDetails {
  return { contact: { phone: value.details.contact.phone ?? '', email: value.details.contact.email ?? '' },
    expectedReturnMileage: value.details.expectedReturnMileage, specialRequirements: value.details.specialRequirements ?? '' };
}
export function validManualEditableDetails(v: unknown): v is ManualEditableDetails {
  return manualObject(v) && onlyKeys(v, ['contact', 'expectedReturnMileage', 'specialRequirements'])
    && manualObject(v['contact']) && onlyKeys(v['contact'], ['phone', 'email'])
    && typeof v['contact']['phone'] === 'string' && typeof v['contact']['email'] === 'string'
    && (v['expectedReturnMileage'] === null || typeof v['expectedReturnMileage'] === 'number' && Number.isFinite(v['expectedReturnMileage']))
    && typeof v['specialRequirements'] === 'string';
}
export function completeManualDetails(v: unknown, mode: ManualReviewDetails['mode'], limits: ManualReviewDetails['constraints']): boolean {
  if (!validManualEditableDetails(v)) return false;
  return /^\+?[0-9 ()-]{7,30}$/.test(v.contact.phone) && v.contact.email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contact.email)
    && (mode === 'new' ? v.expectedReturnMileage === null : manualRevision(v.expectedReturnMileage) && v.expectedReturnMileage <= limits.maximumReturnMileage)
    && v.specialRequirements.length <= limits.maximumSpecialRequirements && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v.specialRequirements);
}
export function isManualReviewDetails(v: unknown): v is ManualReviewDetails {
  if (!manualObject(v) || !manualObject(v['binding']) || !manualObject(v['hold']) || !manualObject(v['quote'])
    || !manualObject(v['details']) || !manualObject(v['details']['contact']) || !manualObject(v['constraints'])
    || !manualObject(v['requestedCollection']) || !manualObject(v['view']) || !instant(v['now'])
    || !manualRevision(v['reviewDetailsVersion']) || !manualPositive(v['stockVersion'])
    || typeof v['clockVersion'] !== 'string' || !/^[0-9]+$/.test(v['clockVersion'])
    || typeof v['orderNumber'] !== 'string' || !/^[0-9]{7}$/.test(v['orderNumber'])) return false;
  const b = v['binding']; const h = v['hold']; const q = v['quote']; const d = v['details']; const c = v['constraints']; const view = v['view'];
  const contact = d['contact'] as ManualRecord;
  const state = h['state']; const pending = String(state).endsWith('-pending') || view['state'] === 'pending';
  const editable = state === 'active' && v['frozen'] === false && !pending
    && Date.parse(h['expiresAt'] as string) > Date.parse(v['now']) && Date.parse(q['validUntil'] as string) > Date.parse(v['now']);
  const provenance = c['provenance']; const collection = v['requestedCollection'];
  return manualSelection(h, q) && fields(b, ['runId', 'employeeId', 'entitlementSlotId', 'holdId', 'quoteId'])
    && manualPositive(b['expectedHoldVersion']) && manualPositive(b['expectedDraftVersion'])
    && b['runId'] === h['runId'] && b['runId'] === q['runId'] && b['employeeId'] === h['employeeId']
    && b['entitlementSlotId'] === h['entitlementSlotId'] && b['holdId'] === h['holdId'] && b['quoteId'] === q['quoteId']
    && h['quoteId'] === q['quoteId'] && h['policyVersion'] === q['policyVersion']
    && b['expectedHoldVersion'] === h['version'] && b['expectedDraftVersion'] === q['draftVersion']
    && ['new', 'replacement'].includes(v['mode'] as string) && v['mode'] === h['mode']
    && (v['currentContract'] === null || manualObject(v['currentContract'])) && (v['contract'] === null || manualObject(v['contract']))
    && nullableText(v['oldContractId']) && (collection['date'] === null || typeof collection['date'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(collection['date']))
    && nullableText(collection['locationId']) && onlyKeys(d, ['contact', 'expectedReturnMileage', 'specialRequirements'])
    && onlyKeys(contact, ['phone', 'email'])
    && ['phone', 'email'].every((key) => contact[key] === undefined || typeof contact[key] === 'string')
    && (d['expectedReturnMileage'] === null || manualRevision(d['expectedReturnMileage']))
    && (d['specialRequirements'] === undefined || typeof d['specialRequirements'] === 'string')
    && manualPositive(c['maximumSpecialRequirements']) && manualPositive(c['maximumReturnMileage'])
    && c['mileageUnit'] === 'mi' && c['textLengthUnit'] === 'UTF-16 code units'
    && manualObject(provenance) && provenance['key'] === 'manual.context.v1' && provenance['policyVersion'] === q['policyVersion']
    && ['assumed', 'verified'].includes(provenance['status'] as string) && fields(provenance, ['source', 'basis', 'sourceDate'])
    && /^\d{4}-\d{2}-\d{2}$/.test(provenance['sourceDate'] as string)
    && instant(provenance['effectiveFrom']) && manualObject(provenance['value'])
    && provenance['value']['maximumSpecialRequirements'] === c['maximumSpecialRequirements']
    && provenance['value']['maximumReturnMileage'] === c['maximumReturnMileage']
    && typeof v['frozen'] === 'boolean' && v['editable'] === editable && v['canContinue'] === editable
    && view['editable'] === editable && view['supportOwner'] === 'employee'
    && view['state'] === (v['frozen'] ? 'locked' : pending ? 'pending' : editable ? 'review' : state === 'active' ? 'expired' : state)
    && view['action'] === (editable ? 'save-review-details' : v['frozen'] || pending ? 'check-status' : 'refresh-claim')
    && (v['reviewDetailsVersion'] === 0 || completeManualDetails(d, v['mode'] as ManualReviewDetails['mode'], c as ManualReviewDetails['constraints']));
}
export function manualDetailsMatchClaim(details: ManualReviewDetails, claim: ManualClaim): boolean {
  const h = details.hold; const q = details.quote; const b = details.binding;
  return b.holdId === claim.hold.holdId && b.quoteId === claim.quote.quoteId && b.expectedHoldVersion === claim.hold.version
    && b.expectedDraftVersion === claim.quote.draftVersion && details.mode === claim.hold.mode
    && ['holdId', 'orderUuid', 'employeeId', 'entitlementSlotId', 'type', 'state', 'phase', 'mode', 'version', 'releaseReason']
      .every((key) => h[key] === claim.hold[key])
    && ['expiresAt', 'reviewStartedAt'].every((key) => h[key] === claim.hold[key]
      || typeof h[key] === 'string' && typeof claim.hold[key] === 'string' && Date.parse(h[key] as string) === Date.parse(claim.hold[key] as string))
    && ['quoteId', 'orderUuid', 'employeeId', 'entitlementSlotId', 'configurationId', 'termsDigest', 'policyVersion', 'contextVersion',
      'draftVersion', 'stockVersion', 'driverId', 'facts', 'terms', 'timing'].every((key) => sameManualDetails(q[key], claim.quote[key]))
    && ['quotedAt', 'validUntil'].every((key) => Date.parse(q[key] as string) === Date.parse(claim.quote[key] as string));
}
export function isManualClaim(v: unknown): v is ManualClaim {
  if (!manualObject(v) || !manualObject(v['hold']) || !manualObject(v['quote']) || !manualObject(v['view']) || !instant(v['now'])) return false;
  const h = v['hold']; const q = v['quote']; const view = v['view']; const pending = v['pendingOperation'];
  return manualSelection(h, q)
    && v['state'] === (h['state'] === 'active' ? 'quoted' : h['state'])
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
  readonly reviewDetails?: ManualResult<ManualReviewDetails> | null; readonly detailsDirty?: boolean;
  readonly loading?: boolean; readonly hasHandoff?: boolean; readonly resumeRequired?: boolean;
  readonly uncertain?: boolean; readonly pending?: boolean; readonly declarations?: Readonly<Record<string, boolean>>;
}
export function projectManual(input: ManualProjectionInput): ManualProjection {
  const claim = input.claim?.status === 'ok' && isManualClaim(input.claim.value) ? input.claim.value : null;
  const terms = input.terms?.status === 'ok' && isManualTerms(input.terms.value) ? input.terms.value : null;
  const orderResult = input.order;
  const order = orderResult && 'value' in orderResult && isManualOrder(orderResult.value) ? orderResult.value : null;
  const candidate = input.reviewDetails?.status === 'ok' && isManualReviewDetails(input.reviewDetails.value) ? input.reviewDetails.value : null;
  const reviewDetails = !order && candidate && claim && manualDetailsMatchClaim(candidate, claim) ? candidate : null;
  const detailsLocked = !!reviewDetails && (reviewDetails.frozen || reviewDetails.view.state === 'pending');
  const declarations = claim && terms ? terms.declarations.filter((d) => d.appliesTo === 'all' || d.appliesTo === claim.hold.mode) : [];
  let failure = input.failure ?? null; let state: ManualState = 'idle';
  if (!failure) {
    for (const result of [input.order, input.claim, input.terms, input.reviewDetails]) {
      if (result && result.status !== 'ok' && result.status !== 'not-found') { failure = result; break; }
    }
  }
  if (!order && candidate && !reviewDetails && !failure) failure = { status: 'conflict', code: 'review-binding-changed', retryable: false };
  if (order) state = order.status === 'acknowledged' ? 'awaiting-approval' : order.status === 'refused' ? 'refused' : 'pending';
  else if (input.uncertain) state = 'uncertain';
  else if (input.pending) state = 'pending';
  else if (detailsLocked) state = 'pending';
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
    && !input.uncertain && !input.pending && !input.loading && !detailsLocked;
  const fresh = !!claim && Date.parse(claim.hold.expiresAt) > Date.parse(claim.now) && Date.parse(claim.quote.validUntil) > Date.parse(claim.now);
  return { state, claim, order, terms, reviewDetails, declarations, failure, approved: false,
    wording: claim && terms ? terms.wordingByMode?.[claim.hold.mode] ?? terms.wording : null,
    canReview: active && fresh && !failure && state === 'preview' && !input.resumeRequired && claim?.hold.phase === 'preview',
    canSubmit: active && fresh && !failure && !input.resumeRequired && claim?.hold.phase === 'order-review' && !!terms
      && !!reviewDetails && reviewDetails.editable && reviewDetails.canContinue && reviewDetails.reviewDetailsVersion > 0 && !input.detailsDirty
      && Date.parse(terms.validUntil) > Math.max(Date.parse(claim.now), Date.parse(reviewDetails.now)) && terms.policyVersion === claim.quote.policyVersion
      && declarations.every((d) => input.declarations?.[d.id] === true),
    canRelease: active && fresh };
}
