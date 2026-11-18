import { describe, expect, it } from 'vitest';
import { isManualClaim, isManualOrder, isManualReviewDetails, isManualTerms, projectManual } from './manual.projection';
import type { ManualClaim, ManualOrder, ManualReviewDetails, ManualTerms } from './manual.types';

const now = '2026-11-16T12:00:00Z'; const later = '2026-11-16T14:00:00Z';
const claim = (): ManualClaim => ({ state: 'quoted', now, pendingOperation: null,
  hold: { holdId: 'hold', orderUuid: 'car', employeeId: 'employee', entitlementSlotId: 'slot', type: 'cart', state: 'active',
    phase: 'order-review', mode: 'replacement', version: 3, expiresAt: later, reviewStartedAt: now, releaseReason: null },
  quote: { quoteId: 'quote', orderUuid: 'car', employeeId: 'employee', entitlementSlotId: 'slot', configurationId: 'configuration', facts: { points: 0 },
    terms: { points: { value: 0, unit: 'points' } }, termsDigest: 'claim-digest', policyVersion: 'policy', contextVersion: 'context',
    draftVersion: 7, stockVersion: 9, quotedAt: now, validUntil: later, driverId: null,
    timing: { previewSeconds: 120, reviewSeconds: 600, transition: 'once-from-preview' } },
  view: { state: 'quoted', editable: false, supportOwner: 'employee', action: 'submit-or-cancel' } });
const terms = (): ManualTerms => ({ schemaVersion: 1, fictional: true, termsVersion: 'terms', wording: 'Please read.',
  wordingByMode: { replacement: 'Your replacement terms.' }, validUntil: later, policyVersion: 'policy', termsDigest: 'order-digest',
  approvalStages: ['sales-manager approval', 'sent to ordering'], declarations: [
    { id: 'read', label: 'I have read these terms', appliesTo: 'all' }, { id: 'return', label: 'I will return my car', appliesTo: 'replacement' },
    { id: 'first', label: 'This is a new car', appliesTo: 'new' }] });
const order = (status: ManualOrder['status']): ManualOrder => ({ schemaVersion: 1, operationId: 'operation', status, orderReference: 'GCS-1', attempts: 1,
  ...(status === 'acknowledged' ? { providerReference: 'provider' } : {}), ...(status === 'refused' ? { failure: { reason: 'provider-refused' } } : {}),
  selection: { sourceType: 'cart', holdId: 'hold', orderUuid: 'car', orderNumber: '123', configurationId: 'configuration', quoteId: 'quote',
    termsVersion: 'terms', policyVersion: 'policy', receivedAt: now },
  progress: { selectionState: status === 'acknowledged' ? 'acknowledged' : status === 'refused' ? 'handoff-failed' : 'handoff-pending', approved: false,
    current: status === 'acknowledged' ? 'sales-manager approval' : 'selection received', stages: [
      { name: 'selection received', state: status === 'acknowledged' ? 'complete' : status === 'refused' ? 'failed' : 'pending' },
      { name: 'sales-manager approval', state: status === 'acknowledged' ? 'waiting' : 'not-started' }, { name: 'sent to ordering', state: 'not-started' }] },
  view: { state: status === 'acknowledged' ? 'awaiting-approval' : status === 'refused' ? 'handoff-failed' : 'handoff-pending',
    action: status === 'acknowledged' ? 'view-order' : status === 'refused' ? 'contact-support' : 'check-status' } });
const ok = <T>(value: T) => ({ status: 'ok' as const, value });
const details = (c = claim(), revision = 1): ManualReviewDetails => ({
  binding: { runId: 'run', employeeId: 'employee', entitlementSlotId: 'slot', holdId: c.hold.holdId, quoteId: c.quote.quoteId,
    expectedHoldVersion: c.hold.version, expectedDraftVersion: c.quote.draftVersion }, reviewDetailsVersion: revision,
  details: { contact: { phone: '01234 567890', email: 'employee@example.test' }, expectedReturnMileage: c.hold.mode === 'replacement' ? 12000 : null,
    specialRequirements: '' }, constraints: { maximumSpecialRequirements: 500, maximumReturnMileage: 200000, mileageUnit: 'mi',
    textLengthUnit: 'UTF-16 code units', provenance: { key: 'manual.context.v1', policyVersion: 'policy', status: 'assumed', source: 'policy',
      basis: 'Scheme limits', sourceDate: '2026-11-01', effectiveFrom: now, value: { maximumSpecialRequirements: 500, maximumReturnMileage: 200000 } } },
  mode: c.hold.mode, currentContract: { contractId: 'current' }, requestedCollection: { date: '2026-12-01', locationId: 'collection' },
  oldContractId: c.hold.mode === 'replacement' ? 'current' : null, contract: { termMonths: 6 },
  hold: { ...c.hold, runId: 'run', quoteId: c.quote.quoteId, policyVersion: c.quote.policyVersion }, quote: { ...c.quote, runId: 'run' },
  orderNumber: '1234567', stockVersion: 11, now: '2026-11-16T12:00:01Z', clockVersion: '1', frozen: false, editable: true, canContinue: true,
  view: { state: 'review', editable: true, action: 'save-review-details', supportOwner: 'employee' } });

describe('manual Java projection', () => {
  it('accepts the actual flat Java quote without invented snapshot or review-details fields', () => {
    expect(isManualClaim(claim())).toBe(true); expect(isManualTerms(terms())).toBe(true);
    const p = projectManual({ claim: ok(claim()), terms: ok(terms()), reviewDetails: ok(details()), declarations: { read: true, return: true } });
    expect(p.canSubmit).toBe(true); expect(p.claim?.quote.stockVersion).toBe(9); expect(p.claim?.quote.draftVersion).toBe(7);
    expect(p.claim?.quote.facts['points']).toBe(0); expect(p.claim?.quote.termsDigest).toBe('claim-digest');
    expect(p.terms?.termsDigest).toBe('order-digest'); expect(p.wording).toBe('Your replacement terms.');
    expect(p.declarations.map((d) => d.id)).toEqual(['read', 'return']);
  });
  it('requires only the server declarations applicable to the exact hold mode', () => {
    const c = claim(); const t = terms();
    expect(projectManual({ claim: ok(c), terms: ok(t), declarations: { read: true, first: true } }).canSubmit).toBe(false);
    const first = { ...c, hold: { ...c.hold, mode: 'new' as const } };
    expect(projectManual({ claim: ok(first), terms: ok(t), reviewDetails: ok(details(first)), declarations: { read: true, first: true } }).canSubmit).toBe(true);
  });
  it.each(['pending', 'acknowledged', 'refused'] as const)('keeps actual %s state and never grants approval or submit', (status) => {
    expect(isManualOrder(order(status))).toBe(true);
    const p = projectManual({ order: ok(order(status)), claim: ok(claim()), terms: ok(terms()), declarations: { read: true, return: true } });
    expect(p.state).toBe(status === 'acknowledged' ? 'awaiting-approval' : status === 'refused' ? 'refused' : 'pending');
    expect(p.approved).toBe(false); expect(p.canSubmit).toBe(false); expect(p.canRelease).toBe(false);
  });
  it('preserves typed pending operation even without a value', () => {
    const p = projectManual({ order: { status: 'pending', code: 'handoff-pending', operationId: 'operation', reason: 'Checking', retryable: false } });
    expect(p.state).toBe('pending'); expect(p.order).toBeNull(); expect(p.failure?.operationId).toBe('operation');
  });
  it('rejects foreign internal identity, missing quote pins and invented approved states', () => {
    const c = claim(); expect(isManualClaim({ ...c, quote: { ...c.quote, orderUuid: 'other' } })).toBe(false);
    expect(isManualClaim({ ...c, quote: { ...c.quote, stockVersion: undefined } })).toBe(false);
    const o = order('acknowledged'); expect(isManualOrder({ ...o, progress: { ...o.progress, approved: true } })).toBe(false);
    expect(isManualOrder({ ...o, status: 'confirmed' })).toBe(false);
  });
  it('blocks recovered, expired, different-policy and unknown claims', () => {
    const input = { claim: ok(claim()), terms: ok(terms()), declarations: { read: true, return: true } };
    for (const patch of [{ resumeRequired: true }, { uncertain: true }, { pending: true },
      { terms: ok({ ...terms(), policyVersion: 'changed' }) }, { claim: ok({ ...claim(), now: later }) }]) {
      expect(projectManual({ ...input, ...patch }).canSubmit).toBe(false);
    }
    expect(projectManual({ ...input, resumeRequired: true }).state).toBe('resume-required');
    expect(projectManual({ ...input, claim: ok({ ...claim(), now: later }) }).state).toBe('expired');
  });
  it('keeps stale refusals and unavailable responses distinct without enabling submit', () => {
    const c = ok(claim()); const t = ok(terms());
    expect(projectManual({ claim: c, terms: t, failure: { status: 'conflict', code: 'terms-changed', retryable: false } }).state).toBe('stale');
    expect(projectManual({ claim: c, terms: t, failure: { status: 'unavailable', code: 'database-unavailable', retryable: true } }).state).toBe('unavailable');
  });
  it('rejects malformed policy declarations, dates and unsupported approval stages', () => {
    const t = terms(); expect(isManualTerms({ ...t, declarations: [...t.declarations, t.declarations[0]] })).toBe(false);
    expect(isManualTerms({ ...t, validUntil: 'tomorrow' })).toBe(false);
    expect(isManualTerms({ ...t, approvalStages: ['approved'] })).toBe(false);
  });
  it('accepts incomplete revision zero while requiring a clean confirmed saved revision to submit', () => {
    const d = details(); const input = { claim: ok(claim()), terms: ok(terms()), declarations: { read: true, return: true } };
    const initial = { ...d, reviewDetailsVersion: 0, details: { contact: {}, expectedReturnMileage: null } };
    expect(isManualReviewDetails(initial)).toBe(true);
    expect(isManualReviewDetails({ ...initial, reviewDetailsVersion: 1 })).toBe(false);
    expect(projectManual(input).canSubmit).toBe(false);
    expect(projectManual({ ...input, reviewDetails: ok(initial) }).canSubmit).toBe(false);
    expect(projectManual({ ...input, reviewDetails: ok(d), detailsDirty: true }).canSubmit).toBe(false);
    expect(projectManual({ ...input, reviewDetails: ok(d) }).canSubmit).toBe(true);
    expect(projectManual({ ...input, reviewDetails: ok(d) }).reviewDetails?.stockVersion).toBe(11);
  });
  it.each(['hold', 'draft', 'quote', 'facts', 'mode', 'constraints'])('rejects mismatched details %s without relying on wall-clock equality', (part) => {
    const d = details(); const changed = part === 'hold' ? { ...d, binding: { ...d.binding, expectedHoldVersion: 4 } }
      : part === 'draft' ? { ...d, binding: { ...d.binding, expectedDraftVersion: 8 } }
      : part === 'quote' ? { ...d, binding: { ...d.binding, quoteId: 'different' } }
      : part === 'facts' ? { ...d, quote: { ...d.quote, facts: { points: 99 } } }
      : part === 'mode' ? { ...d, mode: 'new' } : { ...d, constraints: { ...d.constraints, maximumReturnMileage: 0 } };
    expect(projectManual({ claim: ok(claim()), terms: ok(terms()), reviewDetails: ok(changed as ManualReviewDetails),
      declarations: { read: true, return: true } }).canSubmit).toBe(false);
    expect(projectManual({ claim: ok(claim()), terms: ok(terms()), reviewDetails: ok(d), declarations: { read: true, return: true } }).canSubmit).toBe(true);
  });
  it('keeps order readback separate because its public projection has no saved details revision pin', () => {
    const d = details(); const frozen = { ...d, frozen: true, editable: false, canContinue: false,
      view: { ...d.view, state: 'locked', editable: false, action: 'check-status' } };
    const o = { ...order('acknowledged'), selection: { ...order('acknowledged').selection, orderNumber: '1234567' } };
    expect(projectManual({ order: ok(o), reviewDetails: ok(d) }).reviewDetails).toBeNull();
    expect(projectManual({ order: ok(o), reviewDetails: ok(frozen) }).reviewDetails).toBeNull();
    expect(projectManual({ order: ok({ ...o, selection: { ...o.selection, quoteId: 'other' } }), reviewDetails: ok(frozen) }).reviewDetails).toBeNull();
    expect(projectManual({ order: ok(o), reviewDetails: ok(frozen) }).approved).toBe(false);
  });
  it('uses the later details clock when checking ordering terms expiry', () => {
    const d = details(); const t = { ...terms(), validUntil: '2026-11-16T12:00:00.500Z' };
    expect(projectManual({ claim: ok(claim()), terms: ok(t), reviewDetails: ok(d), declarations: { read: true, return: true } }).canSubmit).toBe(false);
  });
  it('blocks every write if the later details read is pending or frozen before an order is readable', () => {
    const d = details();
    for (const value of [{ ...d, editable: false, canContinue: false, view: { ...d.view, state: 'pending', editable: false, action: 'check-status' } },
      { ...d, frozen: true, editable: false, canContinue: false, view: { ...d.view, state: 'locked', editable: false, action: 'check-status' } }]) {
      expect(isManualReviewDetails(value)).toBe(true);
      const p = projectManual({ claim: ok(claim()), terms: ok(terms()), reviewDetails: ok(value), declarations: { read: true, return: true } });
      expect(p.state).toBe('pending'); expect(p.canRelease).toBe(false); expect(p.canReview).toBe(false); expect(p.canSubmit).toBe(false);
    }
  });
});
