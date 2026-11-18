import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { ActivityClient } from './activity.client';
import { ActivityStore } from './activity.store';
import { ActivityFailure, ActivityOffer, ActivityOfferDisplay, ActivityOfferState, ActivityProjection, ActivityResult } from './activity.types';

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

  describe('actual backend disengaged projection (FUCQ-495)', () => {
    // Mirrors server/gcsp/brief/index.js disengaged(): both consents revoked and not paused.
    const revoked = { searchConsent: false, holdConsent: false, paused: false, permissionVersion: 9, canSearch: false, canHold: false };
    const disengaged = (patch: Partial<ActivityProjection> = {}) => projection({ state: 'paused', permission: revoked, ...patch });

    it('offers only Engage Buddy and ignores a stale disengage click', async () => {
      client.readActivity.mockResolvedValueOnce(ok(disengaged()));
      await store.refresh();
      await ready();
      expect(store.view().showControls).toBe(true);
      expect(store.view().controlOperation).toBe('engage');
      await store.updateBuddy('disengage');
      expect(client.readControlVersions).not.toHaveBeenCalled();
      expect(client.command).not.toHaveBeenCalled();
    });

    it('keeps the terminal accepted-offer guard when disengaged', async () => {
      client.readActivity.mockResolvedValueOnce(ok(disengaged({ currentOffer: offer('accepted'), state: 'offer-closed' })));
      await store.refresh();
      await ready();
      expect(store.view().showControls).toBe(false);
      expect(store.view().controlOperation).toBeNull();
      await store.updateBuddy('engage');
      expect(client.command).not.toHaveBeenCalled();
    });

    it('confirms an uncertain disengage from readback without a retry and then offers Engage', async () => {
      await ready();
      client.command.mockResolvedValueOnce({ status: 'uncertain', code: 'diagnostic-detail' });
      await store.updateBuddy('disengage');
      expect(store.view().retryAvailable).toBe(true);
      client.readActivity.mockResolvedValueOnce(ok(disengaged()));
      await store.refresh();
      expect(store.view().phase).toBe('ready');
      expect(store.view().retryAvailable).toBe(false);
      expect(store.view().controlOperation).toBe('engage');
      await store.retryUpdate();
      expect(client.command).toHaveBeenCalledOnce();
    });

    it('does not offer a retry or controls when the readback shows an accepted offer', async () => {
      await ready();
      client.command.mockResolvedValueOnce({ status: 'pending', code: 'diagnostic-detail' });
      await store.updateBuddy('disengage');
      client.readActivity.mockResolvedValueOnce(ok(disengaged({ currentOffer: offer('accepted'), state: 'offer-closed' })));
      await store.refresh();
      expect(store.view().retryAvailable).toBe(false);
      expect(store.view().showControls).toBe(false);
      await store.retryUpdate();
      expect(client.command).toHaveBeenCalledOnce();
    });

    it('keeps a pending engage retryable while readback still shows disengaged', async () => {
      client.readActivity.mockResolvedValueOnce(ok(disengaged()));
      await store.refresh();
      await ready();
      client.command.mockResolvedValueOnce({ status: 'pending', code: 'diagnostic-detail' });
      await store.updateBuddy('engage');
      const input = client.command.mock.calls[0][1];
      client.readActivity.mockResolvedValueOnce(ok(disengaged()));
      await store.refresh();
      expect(store.view().phase).toBe('recovery');
      expect(store.view().showControls).toBe(false);
      await store.retryUpdate();
      expect(client.command.mock.calls[1][0]).toBe('engage');
      expect(client.command.mock.calls[1][1]).toBe(input);
    });

    it('shows denial without controls or retry when an engage is forbidden', async () => {
      client.readActivity.mockResolvedValueOnce(ok(disengaged()));
      await store.refresh();
      await ready();
      client.command.mockResolvedValueOnce(failure('forbidden'));
      await store.updateBuddy('engage');
      expect(store.view().phase).toBe('denied');
      expect(store.view().showControls).toBe(false);
      expect(store.view().retryAvailable).toBe(false);
    });

    it('drops an uncertain disengage when the scope changes, even if the new scope reads disengaged', async () => {
      await ready();
      client.command.mockResolvedValueOnce({ status: 'uncertain', code: 'diagnostic-detail' });
      await store.updateBuddy('disengage');
      client.readActivity.mockResolvedValueOnce(ok(disengaged({ runId: 'run-two', employeeId: 'employee-two' })));
      state.set({ status: 'ready', context: { ...employee, runId: 'run-two', employeeId: 'employee-two' } });
      TestBed.flushEffects();
      await vi.waitFor(() => expect(store.view().projection?.employeeId).toBe('employee-two'));
      expect(store.view().retryAvailable).toBe(false);
      expect(store.view().controlOperation).toBe('engage');
      await store.retryUpdate();
      expect(client.command).toHaveBeenCalledOnce();
    });
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

  it('uses the backend offer read to show expiry before the stored activity row changes', async () => {
    await ready();
    const row = offer();
    client.readActivity.mockResolvedValueOnce(ok(projection({ state: 'offer', currentOffer: row, offers: [row] })));
    client.readOfferDisplay.mockResolvedValueOnce({ status: 'ok', value: {
      offerRef: row.offerRef, state: 'expired', version: row.version, title: 'BMW X3', images: [],
    } });
    await store.refresh();
    expect(store.view().projection).toMatchObject({ state: 'offer-closed', asOf: '2026-11-14T08:00:00.000Z',
      currentOffer: { state: 'expired', displayState: 'expired', version: 4 }, offers: [{ state: 'expired' }] });
    expect(client.command).not.toHaveBeenCalled();
  });

  it('suppresses Buddy controls when the newer owned offer read confirms acceptance', async () => {
    await ready();
    const row = offer();
    client.readActivity.mockResolvedValueOnce(ok(projection({ state: 'offer', currentOffer: row, offers: [row] })));
    client.readOfferDisplay.mockResolvedValueOnce({ status: 'ok', value: {
      offerRef: row.offerRef, state: 'accepted', version: row.version + 1, title: 'BMW X3', images: [],
    } });
    await store.refresh();
    expect(store.view().projection?.currentOffer).toMatchObject({ state: 'accepted', version: 5 });
    expect(store.view().showControls).toBe(false);
    expect(store.view().retryAvailable).toBe(false);
    expect(client.command).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'declined', 'expired', 'superseded', 'released'] as const)(
    'does not revive a terminal %s activity offer from an open display read', async (state) => {
      await ready();
      const row = offer(state);
      client.readActivity.mockResolvedValueOnce(ok(projection({ state: 'offer-closed', currentOffer: row, offers: [row] })));
      client.readOfferDisplay.mockResolvedValueOnce({ status: 'ok', value: {
        offerRef: row.offerRef, state: 'active', version: row.version + 1, title: 'BMW X3', images: [],
      } });
      await store.refresh();
      expect(store.view().projection?.state).toBe('offer-closed');
      expect(store.view().projection?.currentOffer?.state).toBe(state);
      expect(client.command).not.toHaveBeenCalled();
    });

  it('ignores a display state with an older version or a different offer reference', async () => {
    await ready();
    const row = offer();
    for (const patch of [{ version: row.version - 1 }, { offerRef: { offerId: 'other-offer' } }]) {
      client.readActivity.mockResolvedValueOnce(ok(projection({ state: 'offer', currentOffer: row, offers: [row] })));
      client.readOfferDisplay.mockResolvedValueOnce({ status: 'ok', value: {
        offerRef: row.offerRef, state: 'expired', version: row.version, title: 'BMW X3', images: [], ...patch,
      } });
      await store.refresh();
      expect(store.view().projection?.currentOffer).toMatchObject({ state: 'active', version: 4 });
    }
    expect(client.command).not.toHaveBeenCalled();
  });

  it('ignores a late offer display after the authenticated run changes', async () => {
    await ready();
    const row = offer();
    const display = deferred<ActivityResult<ActivityOfferDisplay>>();
    client.readActivity.mockResolvedValueOnce(ok(projection({ state: 'offer', currentOffer: row, offers: [row] })))
      .mockResolvedValueOnce(ok(projection({ runId: 'run-two', currentOffer: null })));
    client.readOfferDisplay.mockReturnValueOnce(display.promise);
    const refresh = store.refresh();
    await vi.waitFor(() => expect(client.readOfferDisplay).toHaveBeenCalledOnce());
    state.set({ status: 'ready', context: { ...employee, runId: 'run-two' } });
    TestBed.flushEffects();
    await ready();
    display.resolve({ status: 'ok', value: { offerRef: row.offerRef, state: 'accepted' as ActivityOfferState,
      version: 5, title: 'BMW X3', images: [] } });
    await refresh;
    expect(store.view().projection).toMatchObject({ runId: 'run-two', currentOffer: null });
    expect(store.view().showControls).toBe(true);
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
