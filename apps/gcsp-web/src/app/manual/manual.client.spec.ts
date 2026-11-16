import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { ManualClient } from './manual.client';
import type { ManualClaim, ManualClaimCommand, ManualOrder, ManualReviewCommand, ManualSubmitCommand } from './manual.types';

const context = { subject: 'subject', employeeId: 'employee', environmentId: 'dev', runId: 'run', roles: ['employee'] as const, policyVersion: 'policy', capabilities: [] };
const terms = { schemaVersion: 1, fictional: true, termsVersion: 'terms', wording: 'Read these terms', validUntil: '2026-11-16T18:00:00Z',
  policyVersion: 'policy', termsDigest: 'ordering-digest', approvalStages: ['sales-manager approval', 'sent to ordering'],
  declarations: [{ id: 'read', label: 'I have read these terms', appliesTo: 'all' }] };
const claim: ManualClaimCommand = { commandId: 'claim-command', orderUuid: 'exact-car', expectedStockVersion: 5, expectedDraftVersion: 7,
  expectedContextVersion: 'context-pin', expectedTermsDigest: 'claim-digest' };
const review: ManualReviewCommand = { commandId: 'review-command', holdId: 'exact-hold', expectedHoldVersion: 2, expectedDraftVersion: 7 };
const submit: ManualSubmitCommand = { commandId: 'submit-command', source: { type: 'cart', holdId: 'exact-hold', expectedHoldVersion: 3, expectedDraftVersion: 7 },
  expectedQuoteId: 'exact-quote', expectedStockVersion: 6, termsDigest: 'ordering-digest', declarations: { read: true } };
const claimed = (): ManualClaim => ({ state: 'quoted', now: '2026-11-16T12:00:00Z', pendingOperation: null,
  hold: { holdId: 'exact-hold', orderUuid: 'exact-car', employeeId: 'employee', entitlementSlotId: 'slot', type: 'cart', state: 'active',
    phase: 'preview', mode: 'new', version: 2, expiresAt: '2026-11-16T18:00:00Z', reviewStartedAt: null, releaseReason: null },
  quote: { quoteId: 'exact-quote', orderUuid: 'exact-car', employeeId: 'employee', entitlementSlotId: 'slot', configurationId: 'configuration',
    facts: {}, terms: {}, termsDigest: 'claim-digest', policyVersion: 'policy', contextVersion: 'context-pin', draftVersion: 7, stockVersion: 6,
    quotedAt: '2026-11-16T12:00:00Z', validUntil: '2026-11-16T18:00:00Z', driverId: null,
    timing: { previewSeconds: 120, reviewSeconds: 600, transition: 'once-from-preview' } },
  view: { state: 'quoted', editable: false, supportOwner: 'employee', action: 'review-or-cancel' } });
const acknowledged = (): ManualOrder => ({ schemaVersion: 1, operationId: 'operation', status: 'acknowledged', orderReference: 'GCS-1',
  providerReference: 'provider', attempts: 1, selection: { sourceType: 'cart', holdId: 'exact-hold', orderUuid: 'exact-car', orderNumber: '1234567',
    configurationId: 'configuration', quoteId: 'exact-quote', termsVersion: 'terms', policyVersion: 'policy', receivedAt: '2026-11-16T12:00:00Z' },
  progress: { approved: false, current: 'sales-manager approval', selectionState: 'acknowledged', stages: [
    { name: 'selection received', state: 'complete' }, { name: 'sales-manager approval', state: 'waiting' }, { name: 'sent to ordering', state: 'not-started' }] },
  view: { state: 'awaiting-approval', action: 'view-order' } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const refusal = (status = 'conflict', code = 'terms-changed', http = 409) => json({ status, code, reason: 'Read the current state.', retryable: false }, http);
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };

describe('manual principal-scoped Java transport', () => {
  let client: ManualClient; let state: ReturnType<typeof signal<SessionState>>;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>; let token: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    state = signal<SessionState>({ status: 'ready', context }); fetcher = vi.fn<typeof fetch>(); token = vi.fn(async () => 'access-token');
    TestBed.configureTestingModule({ providers: [ManualClient, { provide: AuthPort, useValue: { state, getAccessToken: token } },
      { provide: PORTAL_FETCH, useValue: fetcher }, { provide: RuntimeConfigService, useValue: {
        load: async () => ({ environmentId: 'dev', apiBaseUrl: 'https://api.test/api/gcsp/v1' }) } }] });
    client = TestBed.inject(ManualClient);
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });
  it('uses fixed GET routes without query strings, cookies, redirects or authority input', async () => {
    fetcher.mockResolvedValueOnce(refusal('not-found', 'not-found', 404)).mockResolvedValueOnce(refusal('not-found', 'not-found', 404))
      .mockResolvedValueOnce(json({ status: 'ok', value: terms }));
    expect((await client.readOrder()).status).toBe('not-found'); expect((await client.readClaim()).status).toBe('not-found');
    expect(await client.readTerms()).toEqual({ status: 'ok', value: terms });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['manual/order', 'manual/claim', 'manual/order/terms'].map((p) => 'https://api.test/api/gcsp/v1/' + p));
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Authorization: 'Bearer access-token' } });
  });
  it('sends only each exact versioned command and keeps claim and ordering digests separate', async () => {
    fetcher.mockImplementation(async () => refusal());
    await client.claim(claim); await client.review(review); await client.release({ ...review, reason: 'change' }); await client.submit(submit);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['manual/claim', 'manual/claim/review', 'manual/claim/release', 'manual/order']
      .map((p) => 'https://api.test/api/gcsp/v1/' + p));
    expect(fetcher.mock.calls.map(([, options]) => JSON.parse(options!.body as string))).toEqual([claim, review, { ...review, reason: 'change' }, submit]);
    expect(fetcher.mock.calls.every(([, options]) => options?.method === 'POST')).toBe(true);
  });
  it('rejects extra identity, invented details pins, zero versions and unchecked declarations before fetch', async () => {
    expect((await client.claim({ ...claim, employeeId: 'other' } as ManualClaimCommand)).status).toBe('invalid');
    expect((await client.review({ ...review, expectedHoldVersion: 0 })).status).toBe('invalid');
    expect((await client.submit({ ...submit, expectedReviewDetailsVersion: 1 } as ManualSubmitCommand)).status).toBe('invalid');
    expect((await client.submit({ ...submit, declarations: { read: false } })).status).toBe('invalid'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts exact command-bound claim and order results', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: claimed() })).mockResolvedValueOnce(json({ status: 'ok', value: acknowledged() }));
    expect(await client.claim(claim)).toMatchObject({ status: 'ok', value: { hold: { orderUuid: 'exact-car' } } });
    expect(await client.submit(submit)).toMatchObject({ status: 'ok', value: { selection: { holdId: 'exact-hold', quoteId: 'exact-quote' } } });
  });
  it.each(['car', 'draft', 'context', 'terms'])('rejects a valid claim result with different %s pins', async (changed) => {
    const value = claimed();
    const response = changed === 'car' ? { ...value, hold: { ...value.hold, orderUuid: 'other-car' }, quote: { ...value.quote, orderUuid: 'other-car' } }
      : { ...value, quote: { ...value.quote, ...(changed === 'draft' ? { draftVersion: 8 }
        : changed === 'context' ? { contextVersion: 'other-context' } : { termsDigest: 'other-digest' }) } };
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: response }));
    expect(await client.claim(claim)).toMatchObject({ status: 'uncertain', code: 'manual-response-invalid' });
  });
  it('binds review and release success to the requested hold and draft', async () => {
    const value = claimed(); fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...value, hold: { ...value.hold, holdId: 'other-hold' } } }))
      .mockResolvedValueOnce(json({ status: 'ok', value: { ...value, quote: { ...value.quote, draftVersion: 8 } } }));
    expect((await client.review(review)).status).toBe('uncertain');
    expect((await client.release({ ...review, reason: 'change' })).status).toBe('uncertain');
  });
  it.each(['hold', 'quote', 'source'])('rejects a valid order result with a different %s', async (changed) => {
    const value = acknowledged(); fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...value, selection: { ...value.selection,
      ...(changed === 'hold' ? { holdId: 'other-hold' } : changed === 'quote' ? { quoteId: 'other-quote' } : { sourceType: 'buddy-offer' }) } } }));
    expect((await client.submit(submit)).status).toBe('uncertain');
  });
  it.each(['presenter', 'greg', 'signed-out', 'employee-presenter'])('refuses business commands for %s', async (role) => {
    state.set(role === 'signed-out' ? { status: 'signed-out' } : { status: 'ready', context: { ...context,
      roles: role === 'employee-presenter' ? ['employee', 'presenter'] : [role as 'greg' | 'presenter'] } });
    expect((await client.submit(submit)).status).toBe('authentication-required'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('retains real reason codes, invalid field reasons and pending operation IDs', async () => {
    const pending = { status: 'pending', code: 'handoff-pending', reason: 'Check shortly.', retryable: false, operationId: 'operation' };
    fetcher.mockResolvedValueOnce(json(pending, 202)); expect(await client.submit(submit)).toMatchObject(pending);
    const invalid = { status: 'invalid', code: 'invalid', reason: 'Check the request.', retryable: false, reasons: [{ field: 'declarations', reason: 'Check these terms.' }] };
    fetcher.mockResolvedValueOnce(json(invalid, 400)); expect(await client.submit(submit)).toMatchObject(invalid);
    fetcher.mockResolvedValueOnce(refusal()); expect(await client.submit(submit)).toMatchObject({ status: 'conflict', code: 'terms-changed', httpStatus: 409 });
  });
  it('rejects malformed pending and successful bodies without inventing a successful selection', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { status: 'confirmed' } }));
    expect((await client.submit(submit)).status).toBe('uncertain');
    fetcher.mockResolvedValueOnce(json({ status: 'pending', code: 'handoff-pending', reason: 'Checking', retryable: false }, 202));
    expect((await client.submit(submit)).status).toBe('uncertain');
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...terms, declarations: [] } }));
    expect((await client.readTerms()).status).toBe('unavailable');
  });
  it('rejects nested foreign principal/run facts', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...terms, extra: { employeeId: 'foreign' } } }));
    expect(await client.readTerms()).toMatchObject({ status: 'unavailable', code: 'manual-response-scope-mismatch' });
  });
  it('drops late results after the run changes', async () => {
    const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const pending = client.readTerms(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    state.set({ status: 'ready', context: { ...context, runId: 'another-run' } }); response.resolve(json({ status: 'ok', value: terms }));
    expect((await pending).status).toBe('account-changed');
  });
  it('does not send after cancellation during token renewal', async () => {
    const access = deferred<string>(); token.mockReturnValueOnce(access.promise); const abort = new AbortController();
    const pending = client.submit(submit, { signal: abort.signal }); await vi.waitFor(() => expect(token).toHaveBeenCalled());
    abort.abort(); expect((await pending).status).toBe('aborted'); access.resolve('access-token'); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds an ignored fetch abort and never retries a lost submit', async () => {
    vi.useFakeTimers(); fetcher.mockReturnValueOnce(new Promise(() => {}));
    const pending = client.submit(submit); await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).status).toBe('uncertain'); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('reports a network-lost submit as uncertain', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('connection lost'));
    expect((await client.submit(submit)).status).toBe('uncertain'); expect(fetcher).toHaveBeenCalledOnce();
  });
});
