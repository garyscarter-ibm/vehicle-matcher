import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, RecoveryNotice, SessionState } from '../auth/auth.port';
import { ManualClient } from './manual.client';
import { ManualStore } from './manual.store';
import type { ManualClaim, ManualHandoff, ManualOrder, ManualScope, ManualTerms } from './manual.types';

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

describe('manual claim and ordering command lane', () => {
  let store: ManualStore; const auth = signal<SessionState>(ready()); const recovery = signal<RecoveryNotice | null>(null);
  const client = { context: vi.fn(), readOrder: vi.fn(), readClaim: vi.fn(), readTerms: vi.fn(), claim: vi.fn(), review: vi.fn(), release: vi.fn(), submit: vi.fn() };
  beforeEach(() => {
    auth.set(ready()); recovery.set(null); Object.values(client).forEach((fn) => fn.mockReset());
    client.context.mockImplementation(() => { const state = auth(); return state.status === 'ready'
      ? { subject: state.context.subject, environmentId: state.context.environmentId, runId: state.context.runId, employeeId: state.context.employeeId } : null; });
    client.readOrder.mockResolvedValue(absent); client.readClaim.mockResolvedValue(ok(claim())); client.readTerms.mockResolvedValue(ok(terms()));
    client.claim.mockResolvedValue(ok(claim('preview', 2))); client.review.mockResolvedValue(ok(claim())); client.submit.mockResolvedValue(ok(order()));
    const c = claim(); client.release.mockResolvedValue(ok({ ...c, state: 'released', hold: { ...c.hold, state: 'released', releaseReason: 'change' },
      view: { ...c.view, state: 'released', action: 'browse-stock' } }));
    TestBed.configureTestingModule({ providers: [ManualStore, { provide: AuthPort, useValue: { state: auth, recovery } }, { provide: ManualClient, useValue: client }] });
    store = TestBed.inject(ManualStore); TestBed.tick();
  });
  afterEach(() => TestBed.resetTestingModule());
  async function readyToSubmit(): Promise<void> { await store.enter(); store.confirmResume(); store.setDeclaration('read', true); store.setDeclaration('return', true); }
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
      type: 'cart', holdId: 'hold', expectedHoldVersion: 3, expectedDraftVersion: 7 }, expectedQuoteId: 'quote', expectedStockVersion: 9,
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
});
