import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { OfferClient } from './offer.client';
import { offerScreenEmployee, offerScreenFixture } from './offer-screen.fixture';
import { OfferStore, OfferStoreState } from './offer.store';
import { followupError, followupStart, OFFER_COMMAND_ID, OfferInteractionStore } from './offer-interaction.store';
import { actionableOffer, decisionReceipt, followupQuestion, savedFollowup } from './offer-interaction.fixture';
import { offerCommandProducerFixtures } from './offer-command-producer.fixture';
import { OfferDecisionInput, OfferDecisionReceipt, OfferFollowupValue, OfferResult } from './offer.types';

function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }

describe('offer decision and follow-up command boundary', () => {
  let auth: ReturnType<typeof signal<SessionState>>;
  let source: ReturnType<typeof signal<OfferStoreState>>;
  let store: OfferInteractionStore;
  let client: { decide: ReturnType<typeof vi.fn<OfferClient['decide']>>; readDecisionReasons: ReturnType<typeof vi.fn<OfferClient['readDecisionReasons']>>;
    readFollowup: ReturnType<typeof vi.fn<OfferClient['readFollowup']>>; confirmFollowup: ReturnType<typeof vi.fn<OfferClient['confirmFollowup']>> };
  let refresh: ReturnType<typeof vi.fn>;
  let counter: number;
  const load = (offer = actionableOffer()) => { source.set({ status: 'ready', offerId: offer.offerId, offer }); TestBed.tick(); };
  const accept = () => { store.review('accept'); store.setMileage('6100');
    for (const row of actionableOffer().handoff!.declarations) store.tick(row.id, true); };
  const declined = async () => { load(offerScreenFixture('declined')); await Promise.resolve(); };

  beforeEach(() => {
    TestBed.resetTestingModule(); counter = 0;
    auth = signal<SessionState>({ status: 'ready', context: offerScreenEmployee }); source = signal<OfferStoreState>({ status: 'idle', offerId: null });
    refresh = vi.fn();
    client = { decide: vi.fn(), readDecisionReasons: vi.fn(), readFollowup: vi.fn(), confirmFollowup: vi.fn() };
    client.decide.mockImplementation(async (input) => ({ status: 'ok', value: decisionReceipt(input) }));
    client.readDecisionReasons.mockResolvedValue({ status: 'ok', value: { schemaVersion: 1, key: 'offer.declineReasons.v1', policyVersion: 'policy-v2',
      reasons: [{ code: 'body', label: 'Body style', attribute: 'body' }], provenance: { status: 'assumed', basis: 'fixture', source: 'fixture', sourceDate: '2026-11-14' } } });
    client.readFollowup.mockResolvedValue({ status: 'ok', value: followupQuestion() });
    client.confirmFollowup.mockResolvedValue({ status: 'ok', value: savedFollowup() });
    TestBed.configureTestingModule({ providers: [OfferInteractionStore, { provide: OfferStore, useValue: { state: source, refresh } },
      { provide: AuthPort, useValue: { state: auth } }, { provide: OfferClient, useValue: client }, { provide: OFFER_COMMAND_ID, useValue: () => `command-${++counter}` }] });
    store = TestBed.inject(OfferInteractionStore); TestBed.tick();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('never submits on initial read, refresh, equivalent auth renewal, terminal reopen or idle', () => {
    load(); store.checkCurrent();
    auth.set({ status: 'ready', context: { ...offerScreenEmployee, policyVersion: 'new-policy' } }); TestBed.tick();
    load(offerScreenFixture('expired')); load(offerScreenFixture('accepted'));
    expect(client.decide).not.toHaveBeenCalled(); expect(client.confirmFollowup).not.toHaveBeenCalled();
    expect(client.readDecisionReasons).not.toHaveBeenCalled(); expect(client.readFollowup).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('requires server actions, an unexpired server snapshot, driver record, declarations and bounded mileage', async () => {
    load(); store.review('accept'); await store.submitDecision(); expect(client.decide).not.toHaveBeenCalled();
    store.setMileage('500001'); for (const row of actionableOffer().handoff!.declarations) store.tick(row.id, true);
    expect(store.canAccept()).toBe(false); store.setMileage('-1'); expect(store.canAccept()).toBe(false);
    store.setMileage('6100'); expect(Object.keys(store.state().declarations)).toHaveLength(0);
    for (const row of actionableOffer().handoff!.declarations) store.tick(row.id, true);
    expect(store.canAccept()).toBe(true);
    const offer = actionableOffer(); load({ ...offer, handoff: { ...offer.handoff!, driver: null } }); accept(); expect(store.canAccept()).toBe(false);
    load({ ...offer, availableActions: ['decline'] }); expect(store.canReviewAccept()).toBe(false);
    load({ ...offer, expiresAt: offer.serverNow }); expect(store.canDecline()).toBe(false);
    load({ ...offer, reason: 'decision-pending' }); expect(store.canReviewAccept()).toBe(false);
  });
  it('captures the exact versioned acceptance once, freezes declarations and blocks double submission', async () => {
    const pending = deferred<OfferResult<OfferDecisionReceipt>>(); client.decide.mockReturnValue(pending.promise);
    load(); accept(); const completion = store.submitDecision(); await store.submitDecision();
    expect(client.decide).toHaveBeenCalledTimes(1);
    const [input, options] = client.decide.mock.calls[0]!;
    expect(input).toEqual({ commandId: 'command-1', offerId: 'offer-1', runId: 'run-1', decision: 'accept', expectedOfferVersion: 2,
      expectedHoldVersion: 4, expectedQuoteVersion: 3, termsDigest: 'digest-v1', declarations: { terms: true, driver: true, return: true }, expectedReturnMileage: 6100 });
    expect(Object.isFrozen(input)).toBe(true); expect(Object.isFrozen(input.decision === 'accept' && input.declarations)).toBe(true);
    expect(options?.expectedContextKey).toBe(JSON.stringify(['employee-subject', 'dev', 'run-1', 'employee-1']));
    store.setMileage('9999'); store.tick('terms', false); store.closeReview(); expect(store.state().decision).toBe('sending');
    pending.resolve({ status: 'ok', value: decisionReceipt(input) }); await completion;
    expect(store.offer()?.state).toBe('accepted'); expect(store.canDecline()).toBe(false); expect(store.state().mileage).toBe('');
    store.checkCurrent(); expect(client.decide).toHaveBeenCalledTimes(1);
  });
  it('uses only the loaded reason registry and submits no acceptance fields for decline', async () => {
    load(); store.review('decline'); await Promise.resolve(); store.selectReason('invented'); await store.submitDecision();
    expect(client.decide).not.toHaveBeenCalled(); store.selectReason('body'); await store.submitDecision();
    expect(client.decide.mock.calls[0]![0]).toEqual({ commandId: 'command-1', offerId: 'offer-1', runId: 'run-1', decision: 'decline',
      reasonCode: 'body', expectedOfferVersion: 2, expectedHoldVersion: 4, expectedQuoteVersion: 3 });
    expect(store.offer()?.state).toBe('declined'); expect(client.readFollowup).toHaveBeenCalledTimes(1);
    expect(store.state().followup.value?.state).toBe('question'); expect(client.confirmFollowup).not.toHaveBeenCalled();
  });
  it.each(offerCommandProducerFixtures)('preserves the source ordering $state receipt without claiming approval', async (capture) => {
    client.decide.mockImplementation(async (input) => ({ status: 'ok', value: { ...decisionReceipt(input), selection: capture.receipt.selection } }));
    load(); accept(); await store.submitDecision();
    expect(store.offer()?.selection?.selectionState).toBe(capture.state);
    expect(store.offer()?.selection?.approved).toBe(false);
    expect(store.offer()?.selection?.stages).toEqual(capture.receipt.selection.progress.stages);
    expect(store.offer()?.selection?.orderNumber).toBe(capture.receipt.selection.order?.orderNumber ?? null);
    expect(store.canReviewAccept()).toBe(false);
  });
  it('keeps reasons unavailable and aborts obsolete reads on close', async () => {
    client.readDecisionReasons.mockResolvedValueOnce({ status: 'unavailable' }); load(); store.review('decline'); await Promise.resolve(); await Promise.resolve();
    expect(store.state().reasons.phase).toBe('failed'); await store.submitDecision(); expect(client.decide).not.toHaveBeenCalled();
    const pending = deferred<Awaited<ReturnType<OfferClient['readDecisionReasons']>>>(); client.readDecisionReasons.mockReturnValue(pending.promise);
    const result = store.refreshReasons(); const options = client.readDecisionReasons.mock.calls.at(-1)![2]!;
    store.closeReview(); expect(options.signal?.aborted).toBe(true); pending.resolve({ status: 'unavailable' }); await result;
    expect(store.state().reasons.phase).toBe('idle');
  });
  it.each(['unavailable', 'pending', 'invalid', 'stale-version', 'stale-run', 'conflict', 'forbidden', 'denied', 'not-found', 'unauthenticated', 'unsupported'] as const)
    ('preserves a %s decision result and never turns a read or retry into another POST', async (status) => {
      client.decide.mockResolvedValue({ status }); load(); accept(); await store.submitDecision();
      expect(store.state().decision).toEqual({ status }); expect(store.offer()?.state).toBe('pending');
      expect(store.canReviewAccept()).toBe(false); store.checkCurrent(); await store.submitDecision();
      expect(client.decide).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalledTimes(1);
    });
  it.each(['sign-out', 'other-employee', 'presenter', 'selector', 'clear'] as const)('redacts and aborts a pending command after observed %s', async (kind) => {
    const pending = deferred<OfferResult<OfferDecisionReceipt>>(); client.decide.mockReturnValue(pending.promise); load(); accept();
    const completed = store.submitDecision(); const [input, options] = client.decide.mock.calls[0]!;
    if (kind === 'sign-out') auth.set({ status: 'signed-out' });
    else if (kind === 'other-employee') auth.set({ status: 'ready', context: { ...offerScreenEmployee, employeeId: 'employee-2' } });
    else if (kind === 'presenter') auth.set({ status: 'ready', context: { ...offerScreenEmployee, roles: ['employee', 'presenter'] } });
    else if (kind === 'selector') source.set({ status: 'loading', offerId: 'offer-2' });
    else source.set({ status: 'idle', offerId: null });
    expect(store.state().decision).toBeNull(); expect(store.state().mileage).toBe(''); TestBed.tick();
    expect(options?.signal?.aborted).toBe(true);
    pending.resolve({ status: 'ok', value: decisionReceipt(input) }); await completed;
    auth.set({ status: 'ready', context: offerScreenEmployee }); load(); expect(store.state().decision).toBeNull();
  });
  it('aborts owned work on injector destruction and refuses run-mismatched commands', async () => {
    load({ ...actionableOffer(), runId: 'other-run' }); accept(); await store.submitDecision(); expect(client.decide).not.toHaveBeenCalled();
    const pending = deferred<OfferResult<OfferDecisionReceipt>>(); client.decide.mockReturnValue(pending.promise); load(); accept();
    const result = store.submitDecision(); const [input, options] = client.decide.mock.calls[0]!;
    TestBed.resetTestingModule(); expect(options?.signal?.aborted).toBe(true);
    pending.resolve({ status: 'ok', value: decisionReceipt(input) }); await result; expect(store.state().decision).toBeNull();
  });
  it('keeps observable authority interruptions distinct from equivalent ready context clones', () => {
    load(); accept(); const original = store.state();
    auth.set({ status: 'ready', context: { ...offerScreenEmployee } }); expect(store.state()).toBe(original);
    auth.set({ status: 'signed-out' }); expect(store.state().review).toBeNull();
    auth.set({ status: 'ready', context: offerScreenEmployee }); expect(store.state().review).toBeNull(); TestBed.tick();
    expect(store.state().declarations).toEqual({});
  });
  it('captures a follow-up change only on confirmation and keeps the same command across uncertain retry and GET', async () => {
    await declined(); expect(store.canConfirmFollowup()).toBe(false); store.chooseAnswer('suv'); expect(store.canConfirmFollowup()).toBe(true);
    client.confirmFollowup.mockResolvedValueOnce({ status: 'unavailable' }); await store.confirmFollowup();
    const first = structuredClone(client.confirmFollowup.mock.calls[0]![0]); expect(first).toEqual({ commandId: 'command-1', decisionId: 'decision-1',
      expectedBriefVersion: 7, questionVersion: 'question-v2', value: 'suv' });
    expect(store.state().followup.phase).toBe('uncertain'); store.chooseAnswer('estate'); await store.refreshFollowup();
    expect(client.confirmFollowup).toHaveBeenCalledTimes(1); expect(store.state().followup.phase).toBe('uncertain');
    await store.confirmFollowup(); expect(client.confirmFollowup.mock.calls[1]![0]).toEqual(first);
    expect(store.state().followup.value?.state).toBe('change-saved'); expect(store.canConfirmFollowup()).toBe(false);
  });
  it.each(['change-saved', 'waiting', 'no-match', 'ready'] as const)('retains authoritative follow-up %s and never calculates a replacement match', async (state) => {
    const savedChange = savedFollowup();
    const value: OfferFollowupValue = state === 'change-saved' ? savedChange : state === 'waiting' ? { schemaVersion: 1, state, decisionId: 'decision-1', savedChange }
      : state === 'no-match' ? { schemaVersion: 1, state, decisionId: 'decision-1', savedChange, evaluation: { evaluatedAt: '2026-11-14T12:36:00.000Z', carsChecked: 12, suitable: 0 } }
        : { schemaVersion: 1, state, decisionId: 'decision-1', savedChange, comparison: { schemaVersion: 1, currentBriefVersion: 8, requirements: [],
          previous: { offer: offerScreenFixture('declined'), scoreBasis: { kind: 'historical-quote', briefVersion: 5, policyVersion: 'policy-v2', quotedAt: '2026-11-14T09:00:00.000Z' } },
          next: { offer: { ...actionableOffer(), offerId: 'offer-2' }, scoreBasis: { kind: 'historical-quote', briefVersion: 8, policyVersion: 'policy-v2', quotedAt: '2026-11-14T12:36:00.000Z' } } } };
    client.readFollowup.mockResolvedValue({ status: 'ok', value }); await declined();
    expect(store.state().followup.value).toBe(value); expect(client.confirmFollowup).not.toHaveBeenCalled();
  });
  it('preserves confirmed saved-change evidence on later failure but redacts it on denied access', async () => {
    await declined(); client.readFollowup.mockResolvedValue({ status: 'unavailable', savedChange: savedFollowup() }); await store.refreshFollowup();
    expect(store.state().followup.value?.state).toBe('change-saved');
    client.readFollowup.mockResolvedValue({ status: 'forbidden' }); await store.refreshFollowup(); expect(store.state().followup.value).toBeNull();
  });
  it('requires a fresh question after an uncertain retry is rejected and never invents a waiting result', async () => {
    await declined(); store.chooseAnswer('suv'); client.confirmFollowup.mockResolvedValueOnce({ status: 'unavailable' });
    await store.confirmFollowup(); client.confirmFollowup.mockResolvedValueOnce({ status: 'invalid' }); await store.confirmFollowup();
    expect(store.state().followup.phase).toBe('failed'); expect(store.state().followup.value).toBeNull(); expect(store.canConfirmFollowup()).toBe(false);
    await store.refreshFollowup(); expect(store.state().followup.value?.state).toBe('question'); expect(client.confirmFollowup).toHaveBeenCalledTimes(2);
  });
  it('aborts a follow-up save on observed account change and drops its immutable retry body', async () => {
    await declined(); store.chooseAnswer('suv'); const pending = deferred<OfferResult<OfferFollowupValue>>(); client.confirmFollowup.mockReturnValue(pending.promise);
    const result = store.confirmFollowup(); const options = client.confirmFollowup.mock.calls[0]![1]!;
    auth.set({ status: 'signed-out' }); expect(store.state().followup.value).toBeNull(); TestBed.tick(); expect(options.signal?.aborted).toBe(true);
    pending.resolve({ status: 'ok', value: savedFollowup() }); await result; expect(store.state().followup.value).toBeNull();
  });
  it('validates server question choices, range bounds, equipment limits and a real change', () => {
    const options = followupQuestion().question; expect(followupError(options, 'estate')).toContain('different'); expect(followupError(options, 'invented')).toContain('options');
    expect(followupStart({ ...options, currentValue: ['estate', 'suv'] })).toBeNull();
    const slider = followupQuestion({ kind: 'slider', minimum: 20, maximum: 80, unit: 'percent' }, null).question;
    expect(followupStart(slider)).toBe(50); expect(followupError(slider, 81)).toContain('20 to 80'); expect(followupError(slider, 50.5)).not.toBe('');
    const equipment = followupQuestion({ kind: 'equipment', maximumItems: 2, maximumItemLength: 8 }, null).question;
    expect(followupError(equipment, [])).toContain('at least one'); expect(followupError(equipment, ['A', 'A'])).not.toBe('');
    expect(followupError(equipment, ['Long equipment'])).not.toBe(''); expect(followupError(equipment, ['A', 'B', 'C'])).not.toBe('');
    expect(followupError({ ...equipment, currentValue: ['A'] }, [])).toBe('');
  });
});
