import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { ActivityClient } from './activity.client';
import { ActivityStore } from './activity.store';
import { ActivityFailure, ActivityOffer, ActivityProjection, ActivityResult } from './activity.types';

const employee: ApplicationContext & { readonly employeeId: string } = { subject: 'subject-one', roles: ['employee'], environmentId: 'env-one', runId: 'run-one',
  employeeId: 'employee-one', policyVersion: 'policy-one', capabilities: ['activity:read'] };
const offer = (state = 'active', offerId = 'offer-one'): ActivityOffer => ({ offerRef: { offerId }, state,
  displayState: state === 'awaiting-review' ? 'unavailable' : state as ActivityOffer['displayState'], version: 4,
  briefVersion: 8, expiresAt: '2026-11-14T09:00:00.000Z' });
const projection = (patch: Partial<ActivityProjection> = {}): ActivityProjection => ({
  runId: employee.runId, employeeId: employee.employeeId, asOf: '2026-11-14T08:00:00.000Z', clockVersion: 'clock-1',
  briefVersion: 8, permission: { searchConsent: true, holdConsent: true, paused: false, permissionVersion: 6, canSearch: true, canHold: true },
  state: 'searching', lastSuccessfulCheck: null, searchEvidence: { status: 'recorded', checks: 2 }, sourceStatus: 'ok',
  currentOffer: null, offers: [], stateChanges: [], stateChangesEvidence: { status: 'not-recorded', rejectedReceipts: 0 }, ...patch,
});
const ok = (value: ActivityProjection): ActivityResult<ActivityProjection> => ({ status: 'ok', value });
const failure = (status: ActivityFailure['status']): ActivityFailure => ({ status, code: 'internal-diagnostic-must-not-display' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('component-scoped activity store', () => {
  let state: WritableSignal<SessionState>;
  let client: {
    readActivity: ReturnType<typeof vi.fn>;
    readOfferDisplay: ReturnType<typeof vi.fn>;
    readControlVersions: ReturnType<typeof vi.fn>;
    command: ReturnType<typeof vi.fn>;
  };
  let auth: { state: WritableSignal<SessionState>; signIn: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
  let store: ActivityStore;

  beforeEach(() => {
    state = signal<SessionState>({ status: 'ready', context: employee });
    auth = { state, signIn: vi.fn(async () => {}), retry: vi.fn(async () => {}) };
    client = {
      readActivity: vi.fn(async () => ok(projection())),
      readOfferDisplay: vi.fn(async () => ({ status: 'unavailable', code: 'no-display' })),
      readControlVersions: vi.fn(async () => ({ status: 'ok', value: { briefVersion: 8, draftVersion: 5 } })),
      command: vi.fn(async () => ({ status: 'ok', value: {} })),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: AuthPort, useValue: auth }, { provide: ActivityClient, useValue: client }, ActivityStore,
    ] });
    store = TestBed.inject(ActivityStore);
    TestBed.flushEffects();
  });

  afterEach(() => {
    store?.dispose();
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  async function ready(): Promise<void> {
    await vi.waitFor(() => expect(store.view().phase).toBe('ready'));
  }

  it('loads once per scope and reads afresh when explicitly refreshed', async () => {
    await ready();
    expect(client.readActivity).toHaveBeenCalledOnce();
    expect(store.view().projection?.state).toBe('searching');
    await store.refresh();
    expect(client.readActivity).toHaveBeenCalledTimes(2);
    expect(store.view().projection?.state).toBe('searching');
  });

  it('gates an old projection immediately, aborts its read, and ignores its late result after a scope change', async () => {
    await ready();
    const first = deferred<ActivityResult<ActivityProjection>>();
    client.readActivity.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok(projection({
      runId: 'run-two', employeeId: 'employee-two', state: 'paused',
    })));
    const pending = store;
    void store.refresh();
    const oldSignal = client.readActivity.mock.calls[1][0].signal as AbortSignal;
    state.set({ status: 'ready', context: { ...employee, runId: 'run-two', employeeId: 'employee-two' } });
    expect(pending.view().projection).toBeNull();
    TestBed.flushEffects();
    expect(oldSignal.aborted).toBe(true);
    await vi.waitFor(() => expect(pending.view().projection?.employeeId).toBe('employee-two'));
    first.resolve(ok(projection()));
    await Promise.resolve();
    expect(pending.view().projection?.employeeId).toBe('employee-two');
  });

  it('clears a failed reload instead of presenting the previous projection as current', async () => {
    await ready();
    client.readActivity.mockResolvedValueOnce({ status: 'unavailable', code: 'network-detail' });
    await store.refresh();
    expect(store.view().phase).toBe('unavailable');
    expect(store.view().projection).toBeNull();
    expect(store.view().message).not.toContain('network-detail');
  });

  it('does not send a command when the editor brief version changed', async () => {
    await ready();
    client.readControlVersions.mockResolvedValueOnce({ status: 'ok', value: { briefVersion: 9, draftVersion: 6 } });
    await store.updateBuddy('disengage');
    expect(client.readControlVersions).toHaveBeenCalledOnce();
    expect(client.command).not.toHaveBeenCalled();
    expect(client.readActivity).toHaveBeenCalledTimes(2);
    expect(store.view().message).toBe('Buddy changed. Showing current status.');
  });

  it('uses exact current versions and leaves the displayed permission unchanged until readback', async () => {
    const result = deferred<ActivityResult<{ readonly version?: number }>>();
    await ready();
    client.command.mockReturnValueOnce(result.promise);
    const update = store.updateBuddy('disengage');
    await vi.waitFor(() => expect(client.command).toHaveBeenCalledOnce());
    expect(client.readControlVersions).toHaveBeenCalledOnce();
    expect(client.command).toHaveBeenCalledWith('disengage', expect.objectContaining({
      expectedBriefVersion: 8, expectedDraftVersion: 5, commandId: expect.any(String),
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(store.view().pending).toBe(true);
    expect(store.view().projection?.permission?.paused).toBe(false);
    result.resolve({ status: 'ok', value: {} });
    await update;
    expect(client.readActivity).toHaveBeenCalledTimes(2);
    expect(store.view().projection?.permission?.paused).toBe(false);
  });

  it('prevents a second control click while the first command is pending', async () => {
    await ready();
    const result = deferred<ActivityResult<{ readonly version?: number }>>();
    client.command.mockReturnValueOnce(result.promise);
    const first = store.updateBuddy('disengage');
    await vi.waitFor(() => expect(client.command).toHaveBeenCalledOnce());
    await store.updateBuddy('disengage');
    expect(client.readControlVersions).toHaveBeenCalledOnce();
    expect(client.command).toHaveBeenCalledOnce();
    result.resolve({ status: 'ok', value: {} });
    await first;
  });

  it('retains the same command for deliberate retry and never replays it during refresh', async () => {
    await ready();
    client.command.mockResolvedValueOnce({ status: 'uncertain', code: 'diagnostic-detail' });
    await store.updateBuddy('disengage');
    expect(store.view().phase).toBe('recovery');
    expect(store.view().retryAvailable).toBe(true);
    expect(store.view().projection).toBeNull();
    const input = client.command.mock.calls[0][1];
    await store.refresh();
    expect(client.command).toHaveBeenCalledOnce();
    expect(store.view().retryAvailable).toBe(true);
    client.command.mockResolvedValueOnce({ status: 'ok', value: {} });
    await store.retryUpdate();
    expect(client.command).toHaveBeenCalledTimes(2);
    expect(client.command.mock.calls[1][0]).toBe('disengage');
    expect(client.command.mock.calls[1][1]).toBe(input);
    expect(client.readControlVersions).toHaveBeenCalledOnce();
  });

  it('does not mistake paused search consent for a completed disengage command', async () => {
    await ready();
    client.command.mockResolvedValueOnce({ status: 'uncertain', code: 'diagnostic-detail' });
    await store.updateBuddy('disengage');
    const input = client.command.mock.calls[0][1];
    client.readActivity.mockResolvedValueOnce(ok(projection({ state: 'paused', permission: {
      searchConsent: true, holdConsent: true, paused: true, permissionVersion: 7, canSearch: false, canHold: false,
    } })));
    await store.refresh();
    expect(store.view().phase).toBe('recovery');
    expect(store.view().retryAvailable).toBe(true);
    expect(store.view().showControls).toBe(false);
    expect(client.command).toHaveBeenCalledOnce();
    await store.retryUpdate();
    expect(client.command.mock.calls[1][0]).toBe('disengage');
    expect(client.command.mock.calls[1][1]).toBe(input);
    expect(client.readControlVersions).toHaveBeenCalledOnce();
  });

  it('clears retained commands on sign-out and only signs in after a deliberate action', async () => {
    await ready();
    client.command.mockResolvedValueOnce({ status: 'pending', code: 'diagnostic-detail' });
    await store.updateBuddy('disengage');
    expect(store.view().retryAvailable).toBe(true);
    state.set({ status: 'signed-out' });
    expect(store.view().phase).toBe('signed-out');
    expect(store.view().projection).toBeNull();
    expect(store.view().retryAvailable).toBe(false);
    TestBed.flushEffects();
    await store.signIn();
    expect(auth.signIn).toHaveBeenCalledWith('/gcsp/activity');
    expect(client.command).toHaveBeenCalledOnce();
  });

  it('suppresses controls for a terminal accepted offer', async () => {
    await ready();
    client.readActivity.mockResolvedValueOnce(ok(projection({ currentOffer: offer('accepted'), state: 'offer-closed' })));
    await store.refresh();
    expect(store.view().projection?.currentOffer?.state).toBe('accepted');
    expect(store.view().showControls).toBe(false);
    expect(store.view().controlOperation).toBeNull();
    expect(store.view().retryAvailable).toBe(false);
  });

  it.each([
    ['authentication-required', 'auth-required'], ['forbidden', 'denied'], ['refused', 'refused'],
    ['stale-run', 'restarted'], ['conflict', 'conflict'], ['unavailable', 'unavailable'],
  ] as const)('maps %s read failures to a safe phase', async (status, expectedPhase) => {
    await ready();
    client.readActivity.mockResolvedValueOnce(failure(status) as ActivityResult<ActivityProjection>);
    await store.refresh();
    expect(store.view().phase).toBe(expectedPhase);
    expect(store.view().projection).toBeNull();
    expect(store.view().message).not.toContain('internal-diagnostic-must-not-display');
  });
});
