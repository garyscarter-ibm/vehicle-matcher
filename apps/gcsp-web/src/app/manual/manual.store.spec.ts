import { effect, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountClient } from '../account/account.client';
import { AuthPort, RecoveryNotice, SessionState } from '../auth/auth.port';
import { ManualClient } from './manual.client';
import { ManualStore } from './manual.store';
import type { ManualClaim, ManualEditableDetails, ManualHandoff, ManualOrder, ManualReviewDetails, ManualScope, ManualTerms } from './manual.types';

const now = '2026-11-16T12:00:00Z'; const later = '2026-11-16T14:00:00Z';
const scope: ManualScope = { subject: 'subject', environmentId: 'dev', runId: 'run', employeeId: 'employee' };
const ready = (changes = {}): SessionState => ({ status: 'ready', context: { ...scope, roles: ['employee'], policyVersion: 'policy', capabilities: [], ...changes } });
const absent = { status: 'not-found', code: 'not-found', reason: 'No current selection.', retryable: false };
const ok = <T>(value: T) => ({ status: 'ok' as const, value });
const pending = { status: 'pending', code: 'operation-pending', reason: 'Check shortly.', retryable: false, operationId: 'operation' };
const claim = (phase: 'preview' | 'order-review' = 'order-review', version = 3): ManualClaim => ({ state: 'quoted', now, pendingOperation: null,
  hold: { holdId: 'hold', orderUuid: 'car', employeeId: 'employee', entitlementSlotId: 'slot', type: 'cart', state: 'active', phase, mode: 'replacement',
    version, expiresAt: later, reviewStartedAt: phase === 'preview' ? null : now, releaseReason: null },
  quote: { quoteId: 'quote', orderUuid: 'car', employeeId: 'employee', entitlementSlotId: 'slot', configurationId: 'configuration', facts: { points: 0 },
    terms: { points: { value: 0, unit: 'points' } }, termsDigest: 'claim-digest', policyVersion: 'policy', contextVersion: 'context', draftVersion: 7,
    stockVersion: 9, quotedAt: now, validUntil: later, driverId: null, timing: { previewSeconds: 120, reviewSeconds: 600, transition: 'once-from-preview' } },
  view: { state: 'quoted', editable: false, supportOwner: 'employee', action: phase === 'preview' ? 'review-or-cancel' : 'submit-or-cancel' } });
const terms = (): ManualTerms => ({ schemaVersion: 1, fictional: true, termsVersion: 'terms', wording: 'Read these terms.', validUntil: later,
  policyVersion: 'policy', termsDigest: 'ordering-digest', approvalStages: ['sales-manager approval', 'sent to ordering'], declarations: [
    { id: 'read', label: 'I have read the terms', appliesTo: 'all' }, { id: 'return', label: 'I will return my car', appliesTo: 'replacement' },
    { id: 'first', label: 'This is a new order', appliesTo: 'new' }] });
const order = (status: ManualOrder['status'] = 'acknowledged'): ManualOrder => ({ schemaVersion: 1, operationId: 'operation', status, orderReference: 'GCS-1',
  providerReference: 'provider', attempts: 1, selection: { sourceType: 'cart', holdId: 'hold', orderUuid: 'car', orderNumber: '123', configurationId: 'configuration',
    quoteId: 'quote', termsVersion: 'terms', policyVersion: 'policy', receivedAt: now },
  progress: { approved: false, current: status === 'acknowledged' ? 'sales-manager approval' : 'selection received', selectionState: status === 'acknowledged' ? 'acknowledged' : status === 'refused' ? 'handoff-failed' : 'handoff-pending',
    stages: [{ name: 'selection received', state: status === 'acknowledged' ? 'complete' : status === 'refused' ? 'failed' : 'pending' },
      { name: 'sales-manager approval', state: status === 'acknowledged' ? 'waiting' : 'not-started' }, { name: 'sent to ordering', state: 'not-started' }] },
  view: { state: status === 'acknowledged' ? 'awaiting-approval' : status === 'refused' ? 'handoff-failed' : 'handoff-pending',
    action: status === 'acknowledged' ? 'view-order' : status === 'refused' ? 'contact-support' : 'check-status' }, ...(status === 'refused' ? { failure: { reason: 'refused-by-provider' } } : {}) });
const handoff = (): ManualHandoff => ({ orderUuid: 'car', orderNumber: '123', configurationId: 'configuration', candidateKey: 'exact:car', facts: {},
  snapshot: { identityKind: 'exact-stock', candidateKey: 'exact:car', sourceNamespace: 'stock', sourceKeys: { stockId: 'car' }, snapshotVersion: 'snapshot', facts: {}, display: {} },
  terms: null, draftVersion: 2, versions: { brief: 2, facts: 'facts', policy: 'policy', stock: 'stock', clock: 'clock', draft: 2, context: 'context' },
  decisionVersions: { brief: 2, facts: 'facts', policy: 'policy', stock: 'stock', clock: 'clock', snapshot: 'snapshot', terms: null, availability: 'available' },
  claimInput: { orderUuid: 'car', expectedStockVersion: 5, expectedDraftVersion: 2, expectedContextVersion: 'context', expectedTermsDigest: 'claim-digest' } });
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
const details = (c = claim(), revision = 1): ManualReviewDetails => ({
  binding: { runId: 'run', employeeId: 'employee', entitlementSlotId: 'slot', holdId: c.hold.holdId, quoteId: c.quote.quoteId,
    expectedHoldVersion: c.hold.version, expectedDraftVersion: c.quote.draftVersion }, reviewDetailsVersion: revision,
  details: { contact: { phone: '01234 567890', email: 'employee@example.test' }, expectedReturnMileage: 12000, specialRequirements: '' },
  constraints: { maximumSpecialRequirements: 500, maximumReturnMileage: 200000, mileageUnit: 'mi', textLengthUnit: 'UTF-16 code units',
    provenance: { key: 'manual.context.v1', policyVersion: 'policy', status: 'assumed', source: 'policy', basis: 'Scheme limits', sourceDate: '2026-11-01',
      effectiveFrom: now, value: { maximumSpecialRequirements: 500, maximumReturnMileage: 200000 } } },
  mode: 'replacement', currentContract: { contractId: 'current' }, requestedCollection: { date: '2026-12-01', locationId: 'collection' },
  oldContractId: 'current', contract: { termMonths: 6 }, hold: { ...c.hold, runId: 'run', quoteId: c.quote.quoteId, policyVersion: 'policy' },
  quote: { ...c.quote, runId: 'run' }, orderNumber: '1234567', stockVersion: 11, now: '2026-11-16T12:00:01Z', clockVersion: '1',
  frozen: false, editable: true, canContinue: true, view: { state: 'review', editable: true, action: 'save-review-details', supportOwner: 'employee' } });
const changedDetails = (): ManualEditableDetails => ({ contact: { phone: '01234 567890', email: 'updated@example.test' },
  expectedReturnMileage: 14000, specialRequirements: 'Call before collection' });

describe('manual claim and ordering command lane', () => {
  let store: ManualStore; const auth = signal<SessionState>(ready()); const recovery = signal<RecoveryNotice | null>(null);
  const accountClient = { readAccount: vi.fn(), readDraft: vi.fn() };
  const client = { context: vi.fn(), readOrder: vi.fn(), readClaim: vi.fn(), readTerms: vi.fn(), readReviewDetails: vi.fn(), saveReviewDetails: vi.fn(),
    claim: vi.fn(), review: vi.fn(), release: vi.fn(), submit: vi.fn() };
  beforeEach(() => {
    accountClient.readAccount.mockReset().mockResolvedValue(absent); accountClient.readDraft.mockReset().mockResolvedValue(absent);
    auth.set(ready()); recovery.set(null); Object.values(client).forEach((fn) => fn.mockReset());
    client.context.mockImplementation(() => { const state = auth(); return state.status === 'ready'
      ? { subject: state.context.subject, environmentId: state.context.environmentId, runId: state.context.runId, employeeId: state.context.employeeId } : null; });
    client.readOrder.mockResolvedValue(absent); client.readClaim.mockResolvedValue(ok(claim())); client.readTerms.mockResolvedValue(ok(terms()));
    client.readReviewDetails.mockResolvedValue(ok(details()));
    client.saveReviewDetails.mockImplementation(async (command) => ok({ ...details(), reviewDetailsVersion: command.expectedReviewDetailsVersion + 1, details: command.details }));
    client.claim.mockResolvedValue(ok(claim('preview', 2))); client.review.mockResolvedValue(ok(claim())); client.submit.mockResolvedValue(ok(order()));
    const c = claim(); client.release.mockResolvedValue(ok({ ...c, state: 'released', hold: { ...c.hold, state: 'released', releaseReason: 'change' },
      view: { ...c.view, state: 'released', action: 'browse-stock' } }));
    TestBed.configureTestingModule({ providers: [ManualStore, { provide: AccountClient, useValue: accountClient }, { provide: AuthPort, useValue: { state: auth, recovery } }, { provide: ManualClient, useValue: client }] });
    store = TestBed.inject(ManualStore); TestBed.tick();
  });
  afterEach(() => TestBed.resetTestingModule());
  async function readyToSubmit(): Promise<void> { await store.enter(); store.confirmResume(); store.setDeclaration('read', true); store.setDeclaration('return', true); }
  it('loads exact account and saved choices readback and drops its private join on disposal or scope change', async () => {
    accountClient.readAccount.mockResolvedValue(ok({ state: 'ready', actions: [], account: { employeeId: 'employee', name: 'Avery' } }));
    accountClient.readDraft.mockResolvedValue(ok({ draftVersion: 7, contextVersion: 'context', choices: { mode: 'replacement', slotId: 'slot', oldContractId: 'current', schemeId: 'scheme' } }));
    await store.enter(); expect(store.readback()?.account.account?.name).toBe('Avery');
    store.dispose(); expect(store.readback()).toBeNull();
    await store.enter(); expect(store.readback()).not.toBeNull(); auth.set(ready({ runId: 'different' })); TestBed.tick(); expect(store.readback()).toBeNull();
  });
  it('preserves dirty same-binding fields through clock refresh and announces each deadline threshold once', async () => {
    const c = claim('preview', 2); const low = { ...c, now: '2026-11-16T13:59:30Z' };
    client.readClaim.mockResolvedValue(ok(low)); client.readReviewDetails.mockResolvedValue(ok({ ...details(low), now: low.now }));
    const spoken: string[] = []; TestBed.runInInjectionContext(() => effect(() => { spoken.push(store.announcement()); }));
    await store.enter(); store.confirmResume(); store.setReviewDetails(changedDetails()); TestBed.tick();
    expect(store.announcement()).toContain('nearly over');
    await store.refresh(); TestBed.tick(); expect(spoken.filter((value) => value.includes('nearly over'))).toHaveLength(1); expect(store.detailsDraft()).toEqual(changedDetails());
    const expired = { ...low, now: later }; client.readClaim.mockResolvedValue(ok(expired));
    client.readReviewDetails.mockResolvedValue(ok({ ...details(expired), now: later, editable: false, canContinue: false, view: { state: 'expired', editable: false, action: 'refresh-claim', supportOwner: 'employee' } }));
    await store.refresh(); TestBed.tick(); expect(store.announcement()).toContain('expired'); expect(store.projection().canSubmit).toBe(false);
  });
  it('never discards an unresolved save identity or enables another save after a local discard request', async () => {
    await readyToSubmit(); store.setReviewDetails(changedDetails());
    client.saveReviewDetails.mockResolvedValueOnce({ status: 'uncertain', code: 'manual-transport-unavailable', retryable: false });
    client.readReviewDetails.mockResolvedValueOnce(absent); await store.saveReviewDetails();
    expect(store.canDiscardLocalEdits()).toBe(false); store.discardLocalEdits();
    expect(store.detailsDraft()).toEqual(changedDetails()); await store.saveReviewDetails(); expect(client.saveReviewDetails).toHaveBeenCalledOnce();
    expect(store.state()).toBe('uncertain');
  });
  it('discards only local edits back to the latest saved review and clears declarations', async () => {
    await readyToSubmit(); store.setReviewDetails(changedDetails());
    expect(store.detailsDirty()).toBe(true);
    store.discardLocalEdits();
    expect(store.detailsDraft()?.contact.email).toBe('employee@example.test');
    expect(store.detailsDirty()).toBe(false); expect(store.declarations()).toEqual({});
    expect(client.saveReviewDetails).not.toHaveBeenCalled(); expect(client.release).not.toHaveBeenCalled();
  });
  it('keeps the review hold when details are reopened and continued', async () => {
    await readyToSubmit(); await store.beginReview();
    expect(client.review).not.toHaveBeenCalled(); expect(client.claim).not.toHaveBeenCalled();
    expect(store.projection().claim?.hold.phase).toBe('order-review');
  });
  it('reads existing order first on direct entry and never implicitly claims or submits', async () => {
    const response = deferred<unknown>(); client.readOrder.mockReturnValueOnce(response.promise);
    const entering = store.enter(handoff()); expect(client.readOrder).toHaveBeenCalledOnce(); expect(client.readClaim).not.toHaveBeenCalled();
    response.resolve(absent); await entering;
    expect(client.readClaim).toHaveBeenCalledOnce(); expect(client.readTerms).toHaveBeenCalledOnce(); expect(store.state()).toBe('resume-required');
    expect(client.claim).not.toHaveBeenCalled(); expect(client.submit).not.toHaveBeenCalled();
  });
  it.each(['pending', 'acknowledged', 'refused'] as const)('authoritative existing %s order wins over stock navigation', async (status) => {
    client.readOrder.mockResolvedValue(ok(order(status))); await store.enter(handoff()); await store.claimSelection(); await store.submit();
    expect(store.state()).toBe(status === 'acknowledged' ? 'awaiting-approval' : status === 'refused' ? 'refused' : 'pending');
    expect(store.projection().approved).toBe(false); expect(client.readClaim).not.toHaveBeenCalled(); expect(client.claim).not.toHaveBeenCalled(); expect(client.submit).not.toHaveBeenCalled();
  });
  it('stops entry on unavailable order reads instead of creating a fresh selection', async () => {
    client.readOrder.mockResolvedValue({ status: 'unavailable', code: 'database-unavailable', retryable: true });
    await store.enter(handoff()); await store.claimSelection(); expect(store.state()).toBe('unavailable'); expect(client.readClaim).not.toHaveBeenCalled(); expect(client.claim).not.toHaveBeenCalled();
  });
  it('claims with exact supplied pins then reviews with actual returned hold and draft versions', async () => {
    client.readClaim.mockResolvedValueOnce(absent); const source = handoff(); await store.enter(source);
    client.readReviewDetails.mockResolvedValueOnce(ok(details(claim('preview', 2))));
    expect(store.canClaim()).toBe(true); await store.claimSelection(); expect(store.state()).toBe('preview');
    expect(client.claim.mock.calls[0][0]).toEqual({ ...source.claimInput, commandId: expect.any(String) });
    await store.beginReview(); expect(client.review.mock.calls[0][0]).toEqual({ commandId: expect.any(String), holdId: 'hold', expectedHoldVersion: 2, expectedDraftVersion: 7 });
    expect(store.state()).toBe('review');
  });
  it('requires explicit recovered review confirmation and fresh declarations before submit', async () => {
    await store.enter(); store.setDeclaration('read', true); await store.submit(); expect(client.submit).not.toHaveBeenCalled();
    store.confirmResume(); store.setDeclaration('read', true); await store.submit(); expect(client.submit).not.toHaveBeenCalled();
    store.setDeclaration('first', true); expect(store.declarations()).not.toHaveProperty('first'); store.setDeclaration('return', true); await store.submit();
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.submit.mock.calls[0][0]).toEqual({ commandId: expect.any(String), source: {
      type: 'cart', holdId: 'hold', expectedHoldVersion: 3, expectedDraftVersion: 7 }, expectedQuoteId: 'quote', expectedStockVersion: 11, expectedReviewDetailsVersion: 1,
      termsDigest: 'ordering-digest', declarations: { read: true, return: true } }); expect(store.state()).toBe('awaiting-approval');
    await store.submit(); expect(client.submit).toHaveBeenCalledOnce();
  });
  it('coalesces double submit and checks a lost response by GET without another POST', async () => {
    await readyToSubmit(); const sent = deferred<unknown>(); client.submit.mockReturnValueOnce(sent.promise);
    const first = store.submit(); const second = store.submit(); expect(client.submit).toHaveBeenCalledOnce();
    client.readOrder.mockResolvedValueOnce(ok(order())); sent.resolve({ status: 'uncertain', code: 'manual-transport-unavailable', retryable: false });
    await Promise.all([first, second]); expect(client.readOrder).toHaveBeenCalledTimes(2); expect(store.state()).toBe('awaiting-approval');
    expect(client.submit).toHaveBeenCalledOnce();
  });
  it('retains an unknown attempted submit across a 404, status checks and route re-entry', async () => {
    await readyToSubmit(); client.submit.mockResolvedValueOnce({ status: 'uncertain', code: 'manual-transport-unavailable', retryable: false });
    await store.submit(); expect(store.state()).toBe('uncertain'); store.dispose(); await store.enter(handoff());
    store.confirmResume(); store.setDeclaration('read', true); store.setDeclaration('return', true); await store.submit(); await store.claimSelection(); await store.checkStatus();
    expect(store.state()).toBe('uncertain'); expect(client.submit).toHaveBeenCalledOnce(); expect(client.claim).not.toHaveBeenCalled();
  });
  it('retains command identity for an unchanged known unsuccessful submit after an explicit refresh and declaration review', async () => {
    await readyToSubmit(); client.submit.mockResolvedValue({ status: 'unavailable', code: 'ordering-provider-not-configured', retryable: false });
    await store.submit(); await store.refresh(); store.setDeclaration('read', true); store.setDeclaration('return', true); await store.submit();
    expect(client.submit).toHaveBeenCalledTimes(2); expect(client.submit.mock.calls[1][0]).toEqual(client.submit.mock.calls[0][0]);
  });
  it('pending status checks use GET only and never allow cancellation or a repeat submit', async () => {
    await readyToSubmit(); client.submit.mockResolvedValueOnce({ ...pending, code: 'handoff-pending' }); await store.submit();
    expect(store.state()).toBe('pending'); expect(await store.release('change')).toBe(false);
    client.readOrder.mockResolvedValue({ ...pending, code: 'handoff-pending' }); await store.checkStatus(); await store.submit();
    client.readOrder.mockResolvedValue(absent); await store.checkStatus(); store.confirmResume(); await store.submit();
    expect(store.state()).toBe('pending'); expect(client.submit).toHaveBeenCalledOnce(); expect(client.release).not.toHaveBeenCalled();
  });
  it('never grants edit/browse navigation for pending or failed release', async () => {
    await readyToSubmit(); client.release.mockResolvedValueOnce(pending);
    expect(await store.release('change')).toBe(false); expect(store.state()).toBe('pending'); expect(await store.release('back')).toBe(false);
    const c = claim(); client.readClaim.mockResolvedValue(ok({ ...c, state: 'released', hold: { ...c.hold, state: 'released', releaseReason: 'change' },
      view: { ...c.view, state: 'released', action: 'browse-stock' } }));
    await store.checkStatus(); expect(store.state()).toBe('released'); expect(await store.release('change')).toBe(true); expect(client.release).toHaveBeenCalledOnce();
  });
  it('returns navigation permission only for a completed release, with exact release reason', async () => {
    await readyToSubmit(); expect(await store.release('change')).toBe(true);
    expect(client.release.mock.calls[0][0]).toEqual({ commandId: expect.any(String), holdId: 'hold', expectedHoldVersion: 3, expectedDraftVersion: 7, reason: 'change' });
  });
  it('clears ticks on changed ordering terms and displays stale server failures', async () => {
    await readyToSubmit(); client.readTerms.mockResolvedValue(ok({ ...terms(), termsDigest: 'new-terms-digest' })); await store.refresh();
    expect(store.declarations()).toEqual({}); expect(store.projection().canSubmit).toBe(false);
    store.setDeclaration('read', true); store.setDeclaration('return', true); client.submit.mockResolvedValueOnce({ status: 'conflict', code: 'terms-changed', reason: 'Read the updated terms.', retryable: false });
    await store.submit(); expect(store.state()).toBe('stale'); expect(store.projection().failure?.code).toBe('terms-changed');
  });
  it('drops late reads after logout, scope change and disposal', async () => {
    const response = deferred<unknown>(); client.readClaim.mockReturnValueOnce(response.promise);
    const entering = store.enter(); await vi.waitFor(() => expect(client.readClaim).toHaveBeenCalledOnce());
    auth.set({ status: 'signed-out' }); TestBed.tick(); response.resolve(ok(claim())); await entering;
    expect(store.state()).toBe('authentication-required'); expect(store.projection().claim).toBeNull(); expect(store.handoff()).toBeNull();
    auth.set(ready({ runId: 'new-run' })); TestBed.tick(); const late = deferred<unknown>(); client.readOrder.mockReturnValueOnce(late.promise);
    const reentering = store.enter(); store.dispose(); late.resolve(ok(order())); await reentering;
    expect(store.projection().order).toBeNull();
  });
  it('keeps an in-flight submission unknown if the route disposes before its response arrives', async () => {
    await readyToSubmit(); const sent = deferred<unknown>(); client.submit.mockReturnValueOnce(sent.promise);
    const sending = store.submit(); store.dispose(); sent.resolve(ok(order())); await sending;
    await store.enter(); expect(store.state()).toBe('uncertain'); await store.submit(); expect(client.submit).toHaveBeenCalledOnce();
  });
  it('requires recovery confirmation again without replaying commands', async () => {
    await readyToSubmit(); recovery.set({ message: 'Sign-in restored.', requiresConfirmation: true }); TestBed.tick();
    expect(store.resumeRequired()).toBe(true); expect(store.declarations()).toEqual({}); await store.submit(); expect(client.submit).not.toHaveBeenCalled();
  });
  it('keeps revision-zero incomplete fields editable and requires an explicit successful save before submission', async () => {
    client.readReviewDetails.mockResolvedValueOnce(ok({ ...details(), reviewDetailsVersion: 0, details: { contact: {}, expectedReturnMileage: null } }));
    await store.enter(); store.confirmResume();
    expect(store.detailsDraft()).toEqual({ contact: { phone: '', email: '' }, expectedReturnMileage: null, specialRequirements: '' });
    expect(store.detailsDirty()).toBe(false); expect(store.canSaveReviewDetails()).toBe(false); expect(store.projection().canSubmit).toBe(false);
    store.setReviewDetails(changedDetails()); expect(store.canSaveReviewDetails()).toBe(true); await store.saveReviewDetails();
    expect(client.saveReviewDetails.mock.calls[0][0]).toEqual({ commandId: expect.any(String), holdId: 'hold', quoteId: 'quote',
      expectedHoldVersion: 3, expectedDraftVersion: 7, expectedReviewDetailsVersion: 0, details: changedDetails() });
    expect(store.detailsDirty()).toBe(false); expect(store.projection().reviewDetails?.reviewDetailsVersion).toBe(1);
    store.setDeclaration('read', true); store.setDeclaration('return', true); expect(store.projection().canSubmit).toBe(true);
    await store.submit(); expect(client.submit.mock.calls[0][0].expectedReviewDetailsVersion).toBe(1);
  });
  it.each([-1, 1.5, 200001])('retains invalid mileage edit %s, resets declarations and blocks saving/submission', async (mileage) => {
    await readyToSubmit(); expect(store.projection().canSubmit).toBe(true);
    store.setReviewDetails({ ...changedDetails(), expectedReturnMileage: mileage });
    expect(store.detailsDraft()?.expectedReturnMileage).toBe(mileage); expect(store.detailsDirty()).toBe(true);
    expect(store.declarations()).toEqual({}); expect(store.canSaveReviewDetails()).toBe(false); expect(store.projection().canSubmit).toBe(false);
    await store.submit(); expect(client.submit).not.toHaveBeenCalled();
  });
  it('serializes save against submit/release, then requires fresh declarations for the returned revision', async () => {
    await readyToSubmit(); store.setReviewDetails(changedDetails()); const sent = deferred<unknown>(); client.saveReviewDetails.mockReturnValueOnce(sent.promise);
    const saving = store.saveReviewDetails(); const duplicate = store.saveReviewDetails(); await store.submit();
    expect(await store.release('change')).toBe(false); expect(client.saveReviewDetails).toHaveBeenCalledOnce(); expect(client.submit).not.toHaveBeenCalled();
    sent.resolve(ok({ ...details(), reviewDetailsVersion: 2, details: changedDetails() })); await Promise.all([saving, duplicate]);
    expect(store.detailsDirty()).toBe(false); expect(store.declarations()).toEqual({}); expect(store.projection().canSubmit).toBe(false);
    store.setDeclaration('read', true); store.setDeclaration('return', true); await store.submit();
    expect(client.submit.mock.calls[0][0]).toMatchObject({ expectedReviewDetailsVersion: 2, expectedStockVersion: 11 });
  });
  it('retains a failed save draft and requires explicit refresh after a stale revision', async () => {
    await readyToSubmit(); store.setReviewDetails(changedDetails());
    client.saveReviewDetails.mockResolvedValueOnce({ status: 'conflict', code: 'stale-review-details', resource: 'review-details', expectedVersion: 1,
      currentVersion: 2, retryable: false }); await store.saveReviewDetails();
    expect(store.state()).toBe('stale'); expect(store.detailsDraft()).toEqual(changedDetails()); expect(store.detailsDirty()).toBe(true);
    expect(store.canSaveReviewDetails()).toBe(false); expect(store.projection().reviewDetails?.reviewDetailsVersion).toBe(1);
    client.readReviewDetails.mockResolvedValueOnce(ok({ ...details(), reviewDetailsVersion: 2 })); await store.checkStatus();
    expect(store.detailsDraft()).toEqual(changedDetails()); expect(store.detailsDirty()).toBe(true); expect(store.canSaveReviewDetails()).toBe(true);
    await store.saveReviewDetails(); expect(client.saveReviewDetails.mock.calls[1][0].expectedReviewDetailsVersion).toBe(2);
  });
  it('reconciles a lost save only by matching the returned revision, binding and actual edited values', async () => {
    await readyToSubmit(); store.setReviewDetails(changedDetails());
    client.saveReviewDetails.mockResolvedValueOnce({ status: 'uncertain', code: 'manual-transport-unavailable', retryable: false });
    client.readReviewDetails.mockResolvedValueOnce(ok({ ...details(), reviewDetailsVersion: 2, details: changedDetails() }));
    await store.saveReviewDetails(); expect(store.state()).toBe('review'); expect(store.detailsDirty()).toBe(false); expect(store.declarations()).toEqual({});
    await store.saveReviewDetails(); expect(client.saveReviewDetails).toHaveBeenCalledOnce();
  });
  it('retains an unknown save across missing or different reads and route re-entry without another POST', async () => {
    await readyToSubmit(); store.setReviewDetails(changedDetails());
    client.saveReviewDetails.mockResolvedValueOnce({ status: 'uncertain', code: 'manual-transport-unavailable', retryable: false });
    client.readReviewDetails.mockResolvedValueOnce(absent); await store.saveReviewDetails(); expect(store.state()).toBe('uncertain');
    store.dispose(); client.readReviewDetails.mockResolvedValue(ok({ ...details(), reviewDetailsVersion: 2 })); await store.enter();
    store.confirmResume(); await store.saveReviewDetails(); await store.submit(); expect(store.state()).toBe('uncertain');
    expect(client.saveReviewDetails).toHaveBeenCalledOnce(); expect(client.submit).not.toHaveBeenCalled();
  });
  it('resets declarations on an external saved revision change and never accepts a mismatched quote as editable', async () => {
    await readyToSubmit(); client.readReviewDetails.mockResolvedValueOnce(ok({ ...details(), reviewDetailsVersion: 2 })); await store.refresh();
    expect(store.declarations()).toEqual({});
    const d = details(); client.readReviewDetails.mockResolvedValueOnce(ok({ ...d, quote: { ...d.quote, facts: { points: 99 } } })); await store.refresh();
    expect(store.projection().reviewDetails).toBeNull(); expect(store.canSaveReviewDetails()).toBe(false); expect(store.projection().canSubmit).toBe(false);
  });
  it('discards a late save response after account scope changes', async () => {
    await readyToSubmit(); store.setReviewDetails(changedDetails()); const sent = deferred<unknown>(); client.saveReviewDetails.mockReturnValueOnce(sent.promise);
    const saving = store.saveReviewDetails(); auth.set(ready({ employeeId: 'other' })); TestBed.tick();
    sent.resolve(ok({ ...details(), reviewDetailsVersion: 2, details: changedDetails() })); await saving;
    expect(store.detailsDraft()).toBeNull(); expect(store.projection().reviewDetails).toBeNull(); expect(store.declarations()).toEqual({});
  });
});
