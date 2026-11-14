import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { OfferClient } from './offer.client';
import { OfferFailure, OfferProjection, OfferProvenance, OfferRequestOptions, OfferResult, OfferVehicleSnapshot } from './offer.types';
import { OfferStore } from './offer.store';

const observedAt = '2026-11-14T09:00:00.000Z';
const provenance: OfferProvenance = { sourceRef: 'fixture:offer', observedAt, version: 'source-v1', assurance: 'synthetic-scenario' };
const vehicle: OfferVehicleSnapshot = {
  contractVersion: 'vehicle-snapshot-v1', identityKind: 'exact-stock', candidateKey: 'source:stock-1',
  sourceNamespace: 'fixture:employee', snapshotVersion: 'snapshot-v1', observedAt, sourceKeys: { stockId: 'stock-1' },
  display: { name: 'BMW 3 Series', photo: '/assets/car.webp', images: [] },
  facts: { mileage: { status: 'unknown', value: null, unit: 'mi', provenance } },
};

function projection(state: OfferProjection['state'], expiresAt = '2026-11-14T11:00:00.000Z'): OfferProjection {
  const accepted = state === 'accepted';
  const declined = state === 'declined';
  return {
    schemaVersion: 1, offerId: 'offer-1', runId: 'run-1', state, reason: `server-${state}`,
    serverNow: '2026-11-14T12:00:00.000Z', clockVersion: 'clock-v3', expiresAt, offerVersion: 2, holdVersion: 4,
    offerState: accepted ? 'accepted' : declined ? 'rejected' : state === 'expired' ? 'expired' : state === 'superseded' ? 'superseded' : 'active',
    holdState: accepted ? 'allocated' : state === 'pending' ? 'active' : 'released',
    availableActions: state === 'pending' ? ['accept', 'decline'] : [],
    followup: declined ? { decisionId: `offer-decision:${'a'.repeat(64)}` } : null,
    handoff: state === 'pending' ? {
      termsVersion: 'terms-v1', termsDigest: 'terms-digest', wording: 'Terms apply.', fictional: true,
      mode: 'replacement', blocker: null, driver: null, returnMileage: { maximum: 500000, unit: 'mi' },
      documentSource: { terms: 'ordering.terms.v1', termsVersion: 'terms-v1', recordSource: 'employee-contract' },
      declarations: [{ id: 'terms', label: 'I accept the terms.' }], contact: null, returnCar: null,
    } : null,
    selection: accepted ? {
      schemaVersion: 1, selectionState: 'handoff-pending', approved: false, current: 'selection received', orderReference: null,
      orderNumber: null, stages: [{ name: 'selection received', state: 'pending' }],
    } : null,
    quote: {
      quoteId: 'quote-1', configurationId: 'configuration-1', orderUuid: 'stock-1', orderNumber: '0123456',
      briefVersion: 5, policyVersion: 'policy-v2', quotedAt: observedAt, validUntil: '2026-11-14T12:00:00.000Z',
      revisions: { quote: 3, brief: 5, facts: 'facts-v1', policy: 'policy-v2', stock: 4 }, facts: vehicle,
      decision: { gateStatus: 'eligible', score: null, reasons: ['Matches the recorded brief.'], tradeOffs: [], blockers: [], unknowns: [] },
      terms: { kind: 'employee-scheme', termsVersion: 'terms-v1', validFrom: observedAt, validUntil: '2026-11-14T12:00:00.000Z',
        points: { value: 0, unit: 'points' }, allowanceInputs: { allowance: { value: 0, unit: 'points' } }, provenance },
      allowance: { allowance: { value: 0, unit: 'points' } },
    },
    comparison: { status: 'partial', reason: 'current-car-data-incomplete', comparisonAvailable: false,
      currentCar: null, unknowns: ['configuration', 'body', 'fuel'] },
  };
}

const employee: ApplicationContext = {
  subject: 'employee-subject', roles: ['employee'], environmentId: 'dev', runId: 'run-1', employeeId: 'employee-1',
  policyVersion: 'policy-v2', capabilities: [],
};
const ready = (context: ApplicationContext = employee): SessionState => ({ status: 'ready', context });
const key = (context: ApplicationContext = employee) => JSON.stringify([context.subject, context.environmentId, context.runId, context.employeeId]);

interface Deferred<T> { readonly promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

interface PendingRead { readonly offerId: string; readonly options: OfferRequestOptions; readonly result: Deferred<OfferResult<OfferProjection>> }
const failure = (details: Partial<OfferFailure> = {}): OfferFailure => ({ status: 'conflict', code: 'quote-changed', retryable: false,
  currentVersions: { offer: 3, hold: 5, quote: 6 }, reason: 'The quoted terms changed.', ...details });

describe('Angular offer read state', () => {
  let authState: ReturnType<typeof signal<SessionState>>;
  let reads: PendingRead[];
  let client: {
    readOffer: ReturnType<typeof vi.fn<OfferClient['readOffer']>>;
    readDecisionReasons: ReturnType<typeof vi.fn<OfferClient['readDecisionReasons']>>;
    decide: ReturnType<typeof vi.fn<OfferClient['decide']>>;
    readFollowup: ReturnType<typeof vi.fn<OfferClient['readFollowup']>>;
    confirmFollowup: ReturnType<typeof vi.fn<OfferClient['confirmFollowup']>>;
  };
  let store: OfferStore;

  beforeEach(() => {
    TestBed.resetTestingModule();
    authState = signal<SessionState>(ready());
    reads = [];
    client = {
      readOffer: vi.fn<OfferClient['readOffer']>(),
      readDecisionReasons: vi.fn<OfferClient['readDecisionReasons']>(),
      decide: vi.fn<OfferClient['decide']>(),
      readFollowup: vi.fn<OfferClient['readFollowup']>(),
      confirmFollowup: vi.fn<OfferClient['confirmFollowup']>(),
    };
    client.readOffer.mockImplementation((offerId, options = {}) => {
      const result = deferred<OfferResult<OfferProjection>>();
      reads.push({ offerId, options, result });
      return result.promise;
    });
    TestBed.configureTestingModule({ providers: [
      { provide: AuthPort, useValue: { state: authState } },
      { provide: OfferClient, useValue: client },
    ] });
    store = TestBed.inject(OfferStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  const flushEffects = () => TestBed.flushEffects();
  const result = (value: OfferProjection): OfferResult<OfferProjection> => ({ status: 'ok', value });

  it('stays idle without a selector, never reads on construction, and performs no offer action', () => {
    authState.set({ status: 'signed-out' }); flushEffects();
    expect(store.state()).toEqual({ status: 'idle', offerId: null });
    store.refresh(); store.clear();
    authState.set(ready()); flushEffects();
    expect(store.state()).toEqual({ status: 'idle', offerId: null });
    expect(client.readOffer).not.toHaveBeenCalled();
    expect([client.readDecisionReasons, client.decide, client.readFollowup, client.confirmFollowup].every((call) => call.mock.calls.length === 0)).toBe(true);
  });

  it('opens once with the client authority key, coalesces the same read, and refreshes only on request', async () => {
    store.open('opaque-offer-id');
    expect(store.state()).toEqual({ status: 'loading', offerId: 'opaque-offer-id' });
    expect(client.readOffer).toHaveBeenCalledOnce();
    expect(client.readOffer.mock.calls[0]).toEqual(['opaque-offer-id', { signal: expect.any(AbortSignal), expectedContextKey: key() }]);
    const readSignal = reads[0].options.signal!;
    store.open('opaque-offer-id'); store.refresh(); flushEffects();
    expect(client.readOffer).toHaveBeenCalledOnce();
    reads[0].result.resolve(result(projection('pending'))); await settle();
    const loaded = store.state();
    expect(loaded).toMatchObject({ status: 'ready', offerId: 'opaque-offer-id' });
    if (loaded.status !== 'ready') return;
    expect(loaded.offer.reason).toBe('server-pending');
    expect(readSignal.aborted).toBe(false);
    store.open('opaque-offer-id');
    expect(client.readOffer).toHaveBeenCalledOnce();
    store.refresh();
    expect(store.state()).toEqual({ status: 'loading', offerId: 'opaque-offer-id' });
    expect(client.readOffer).toHaveBeenCalledTimes(2);
  });

  it('preserves structured failures and lets an explicit refresh retry an unavailable read', async () => {
    store.open('offer-1');
    const authoritative = failure({ status: 'stale-version', code: 'quote-stale', expectedVersion: 4, currentVersion: 5 });
    reads[0].result.resolve(authoritative); await settle();
    const stale = store.state();
    expect(stale).toEqual({ status: 'failed', offerId: 'offer-1', failure: authoritative });
    if (stale.status !== 'failed') return;
    expect(stale.failure).toBe(authoritative);
    store.refresh();
    reads[1].result.resolve({ status: 'unavailable', code: 'network-timeout', retryable: true, operationId: 'read-1' }); await settle();
    expect(store.state()).toMatchObject({ status: 'failed', failure: { status: 'unavailable', code: 'network-timeout', operationId: 'read-1' } });
    store.refresh();
    expect(client.readOffer).toHaveBeenCalledTimes(3);
    expect(store.state()).toEqual({ status: 'loading', offerId: 'offer-1' });
    reads[2].result.resolve(result(projection('pending'))); await settle();
    expect(store.state().status).toBe('ready');
  });

  it('turns an unexpected rejected read into a safe unavailable failure', async () => {
    store.open('offer-1');
    reads[0].result.reject(new Error('private token detail')); await settle();
    expect(store.state()).toEqual({ status: 'failed', offerId: 'offer-1', failure: {
      status: 'unavailable', code: 'offer-unavailable', retryable: true,
    } });
  });

  it.each(['accepted', 'declined', 'expired', 'superseded'] as const)('keeps the server projection and actions unchanged when reopening a %s offer', async (state) => {
    store.open('offer-1');
    const authoritative = projection(state, '2026-11-14T08:00:00.000Z');
    reads[0].result.resolve(result(authoritative)); await settle();
    const loaded = store.state();
    expect(loaded).toEqual({ status: 'ready', offerId: 'offer-1', offer: authoritative });
    if (loaded.status !== 'ready') return;
    expect(loaded.offer).toBe(authoritative);
    expect(loaded.offer.state).toBe(state);
    expect(loaded.offer.availableActions).toEqual([]);
    expect(loaded.offer.serverNow).toBe('2026-11-14T12:00:00.000Z');
    expect(loaded.offer.expiresAt).toBe('2026-11-14T08:00:00.000Z');
  });

  it.each([
    ['subject', { subject: 'other-subject' }],
    ['environmentId', { environmentId: 'other-environment' }],
    ['runId', { runId: 'other-run' }],
    ['employeeId', { employeeId: 'other-employee' }],
  ] as const)('redacts a ready offer synchronously when %s changes and ignores the previous scope', async (_field, patch) => {
    store.open('offer-1');
    reads[0].result.resolve(result(projection('pending'))); await settle();
    expect(store.state().status).toBe('ready');
    authState.set(ready({ ...employee, ...patch }));
    expect(store.state()).toEqual({ status: 'loading', offerId: 'offer-1' });
    flushEffects();
    expect(client.readOffer).toHaveBeenCalledTimes(2);
    expect(reads[0].options.signal?.aborted).toBe(false);
    reads[1].result.resolve(result(projection('declined'))); await settle();
    expect(store.state().status).toBe('ready');
  });

  it.each([
    ['subject', { subject: 'other-subject' }],
    ['environmentId', { environmentId: 'other-environment' }],
    ['runId', { runId: 'other-run' }],
    ['employeeId', { employeeId: 'other-employee' }],
    ['sign-out', null],
  ] as const)('ignores an in-flight result after %s changes', async (_field, patch) => {
    store.open('offer-1');
    const before = reads[0];
    authState.set(patch === null ? { status: 'signed-out' } : ready({ ...employee, ...patch }));
    expect(store.state()).toEqual(patch === null
      ? { status: 'failed', offerId: 'offer-1', failure: { status: 'unauthenticated', code: 'authentication-required', retryable: false } }
      : { status: 'loading', offerId: 'offer-1' });
    before.result.resolve(result(projection('accepted'))); await settle();
    expect(store.state().status).not.toBe('ready');
    flushEffects();
    expect(before.options.signal?.aborted).toBe(true);
    if (patch !== null) {
      expect(client.readOffer).toHaveBeenCalledTimes(2);
      expect(store.state()).toEqual({ status: 'loading', offerId: 'offer-1' });
    } else {
      expect(client.readOffer).toHaveBeenCalledOnce();
    }
  });

  it('coalesces equivalent cloned employee contexts and rereads once after a signed-out recovery', () => {
    store.open('offer-1');
    const sameAuthority = { ...employee, capabilities: ['changed'], policyVersion: 'policy-v3' };
    authState.set(ready(sameAuthority)); flushEffects();
    expect(client.readOffer).toHaveBeenCalledOnce();
    authState.set({ status: 'signed-out' });
    expect(store.state()).toMatchObject({ status: 'failed', failure: { status: 'unauthenticated' } });
    flushEffects();
    authState.set(ready({ ...employee })); flushEffects();
    expect(client.readOffer).toHaveBeenCalledTimes(2);
  });

  const interruptedAuthority: SessionState[] = [
    { status: 'signed-out' }, { status: 'loading' },
    { status: 'denied', message: 'Access denied.' },
    { status: 'unavailable', message: 'Try again.', retryable: true },
    ready({ ...employee, roles: ['presenter'] }),
    ready({ ...employee, employeeId: undefined }),
    ready({ ...employee, runId: 'other-run' }),
  ];

  it.each(interruptedAuthority)('does not resurrect a ready snapshot after an observed $status authority interruption before effects', async (interruption) => {
    store.open('offer-1');
    reads[0].result.resolve(result(projection('accepted'))); await settle();
    expect(store.state().status).toBe('ready');
    authState.set(interruption);
    expect(store.state().status).not.toBe('ready');
    authState.set(ready({ ...employee }));
    expect(store.state()).toEqual({ status: 'loading', offerId: 'offer-1' });
    flushEffects();
    expect(client.readOffer).toHaveBeenCalledTimes(2);
    reads[1].result.resolve(result(projection('declined'))); await settle();
    expect(store.state()).toMatchObject({ status: 'ready', offer: { state: 'declined' } });
  });

  it.each(interruptedAuthority)('rejects an old pending result after an observed $status authority interruption before effects', async (interruption) => {
    store.open('offer-1');
    const old = reads[0];
    authState.set(interruption);
    store.state();
    authState.set(ready({ ...employee }));
    old.result.resolve(result(projection('accepted'))); await settle();
    expect(store.state()).toEqual({ status: 'loading', offerId: 'offer-1' });
    flushEffects();
    expect(old.options.signal?.aborted).toBe(true);
    expect(client.readOffer).toHaveBeenCalledTimes(2);
    reads[1].result.resolve(result(projection('declined'))); await settle();
    expect(store.state()).toMatchObject({ status: 'ready', offer: { state: 'declined' } });
  });

  it('keeps the ready snapshot for equivalent authority clones with changed policy and capabilities', async () => {
    store.open('offer-1');
    const offer = projection('pending');
    reads[0].result.resolve(result(offer)); await settle();
    expect(store.state()).toMatchObject({ status: 'ready', offer });
    authState.set(ready({ ...employee, policyVersion: 'another-policy', capabilities: ['another-capability'] }));
    expect(store.state()).toEqual({ status: 'ready', offerId: 'offer-1', offer });
    flushEffects();
    expect(client.readOffer).toHaveBeenCalledOnce();
  });

  it('waits through auth loading and denies presenter, Greg, or incomplete employee authority without a read', () => {
    authState.set({ status: 'loading' });
    store.open('offer-1');
    expect(store.state()).toEqual({ status: 'loading', offerId: 'offer-1' });
    expect(client.readOffer).not.toHaveBeenCalled();
    authState.set(ready()); flushEffects();
    expect(client.readOffer).toHaveBeenCalledOnce();

    store.clear();
    const invalidContexts: ApplicationContext[] = [
      { ...employee, roles: ['presenter'] },
      { ...employee, roles: ['greg'] },
      { ...employee, employeeId: undefined },
      { ...employee, subject: ' ' },
      { ...employee, environmentId: '' },
      { ...employee, runId: '' },
    ];
    for (const context of invalidContexts) {
      authState.set(ready(context)); store.open('offer-1'); flushEffects();
      expect(store.state()).toEqual({ status: 'failed', offerId: 'offer-1', failure: {
        status: 'denied', code: 'employee-role-required', retryable: false,
      } });
      expect(client.readOffer).toHaveBeenCalledOnce();
      store.clear();
    }
  });

  it('maps unavailable and denied authentication without exposing thrown details', () => {
    authState.set({ status: 'unavailable', message: 'Sign-in service is unavailable. Try again.', retryable: true });
    store.open('offer-1');
    expect(store.state()).toEqual({ status: 'failed', offerId: 'offer-1', failure: {
      status: 'unavailable', code: 'offer-context-unavailable', retryable: true, reason: 'Sign-in service is unavailable. Try again.',
    } });
    authState.set({ status: 'denied', message: 'Your session cannot access this page.' });
    expect(store.state()).toEqual({ status: 'failed', offerId: 'offer-1', failure: {
      status: 'denied', code: 'offer-context-denied', retryable: false, reason: 'Your session cannot access this page.',
    } });
    expect(client.readOffer).not.toHaveBeenCalled();
  });

  it('aborts and ignores a selector race, and clear stays idle across later auth changes', async () => {
    store.open('offer-one');
    const old = reads[0];
    store.open('offer-two');
    expect(old.options.signal?.aborted).toBe(true);
    reads[1].result.resolve(result(projection('declined'))); await settle();
    old.result.resolve(result(projection('accepted'))); await settle();
    expect(store.state()).toMatchObject({ status: 'ready', offerId: 'offer-two', offer: { state: 'declined' } });
    store.clear();
    expect(store.state()).toEqual({ status: 'idle', offerId: null });
    authState.set({ status: 'signed-out' }); flushEffects();
    authState.set(ready({ ...employee, runId: 'run-2' })); flushEffects();
    expect(store.state()).toEqual({ status: 'idle', offerId: null });
    expect(client.readOffer).toHaveBeenCalledTimes(2);
  });

  it('aborts the owned request on destruction and ignores a late client result', async () => {
    store.open('offer-1');
    const pending = reads[0];
    TestBed.resetTestingModule();
    expect(pending.options.signal?.aborted).toBe(true);
    pending.result.resolve(result(projection('accepted'))); await settle();
    expect(store.state()).toEqual({ status: 'loading', offerId: 'offer-1' });
    store.open('offer-2');
    expect(client.readOffer).toHaveBeenCalledOnce();
  });
});
