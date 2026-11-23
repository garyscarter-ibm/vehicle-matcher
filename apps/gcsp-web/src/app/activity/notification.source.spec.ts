import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { NotificationModel } from '../kit/notification-bell.types';
import { ActivityClient } from './activity.client';
import { ActivityOffer, ActivityOfferDisplay, ActivityProjection, ActivityResult } from './activity.types';
import { createNotificationSource, NotificationSource } from './notification.source';

const offer = (id: string): ActivityOffer => ({ offerRef: { offerId: id }, state: 'active', displayState: 'active', version: 1,
  briefVersion: 1, expiresAt: '2026-11-22T14:00:00Z', href: `/gcsp/offers/${id}` });
const projection = (id?: string): ActivityProjection => ({ runId: 'run', employeeId: 'paula', asOf: '2026-11-22T12:00:00Z',
  clockVersion: '1', briefVersion: null, permission: null, state: 'never-searched', lastSuccessfulCheck: null,
  searchEvidence: { status: 'not-recorded', reason: 'no-search-check-yet' }, sourceStatus: 'not-checked', currentOffer: id ? offer(id) : null,
  offers: [], stateChanges: [], stateChangesEvidence: { status: 'not-recorded', rejectedReceipts: 0 } });
const ok = (id?: string): ActivityResult<ActivityProjection> => ({ status: 'ok', value: projection(id) });
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
const ready = (runId = 'run', employeeId = 'paula'): SessionState => ({ status: 'ready', context: { subject: employeeId, employeeId,
  roles: ['employee'], environmentId: 'env', runId, policyVersion: 'p', capabilities: [] } });

describe('notification source', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('reads immediately, coalesces triggers, retains later successful state and reuses display', async () => {
    let finish!: (out: ActivityResult<ActivityProjection>) => void;
    const readActivity = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(ok('one'));
    const readOfferDisplay = vi.fn(async (): Promise<ActivityResult<ActivityOfferDisplay>> => ({ status: 'ok', value: {
      offerRef: { offerId: 'one' }, state: 'active', version: 1, title: 'BMW X2', images: [] } }));
    let trigger = () => {}; const stopActions = vi.fn();
    const source = createNotificationSource({ adapter: { readActivity, readOfferDisplay }, document,
      subscribe: (next) => { trigger = next; return stopActions; } });
    const models: NotificationModel[] = []; const stop = source.connect((model) => models.push(model));
    trigger(); trigger(); expect(readActivity).toHaveBeenCalledTimes(1);
    finish(ok('one')); await flush(); expect(readActivity).toHaveBeenCalledTimes(2); expect(readOfferDisplay).toHaveBeenCalledOnce();
    expect(source.getModel().waiting).toBe(1); expect(models.some((model) => model.note)).toBe(false);
    readActivity.mockResolvedValue({ status: 'unavailable' }); await source.refresh();
    expect(source.getModel().waiting).toBe(1); expect(source.getModel().status).toBe('ok');
    stop(); expect(stopActions).toHaveBeenCalledOnce();
  });
  it('announces only a newly arriving active id, never first read or remount', async () => {
    const readActivity = vi.fn().mockResolvedValue(ok());
    const source = createNotificationSource({ adapter: { readActivity }, document });
    const update = vi.fn(); let stop = source.connect(update); await flush();
    readActivity.mockResolvedValue(ok('new')); await source.refresh();
    expect(update.mock.calls.at(-1)?.[0].note).toMatchObject({ id: 'new', title: 'Your buddy found a car' });
    expect(source.getModel().note).toBeNull(); stop();
    const remount = vi.fn(); stop = source.connect(remount); await flush();
    expect(remount.mock.calls.every(([model]) => model.note === null)).toBe(true); stop();
  });
  it('refreshes on visible return, persisted pageshow and each 30 seconds; removes listeners/timer and aborts on disconnect', async () => {
    vi.useFakeTimers(); let visibility = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState);
    const readActivity = vi.fn().mockResolvedValue(ok());
    const source = createNotificationSource({ adapter: { readActivity }, document }); const stop = source.connect(() => {}); await flush();
    await vi.advanceTimersByTimeAsync(30_000); expect(readActivity).toHaveBeenCalledTimes(2);
    visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(60_000); expect(readActivity).toHaveBeenCalledTimes(2);
    visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); await flush(); expect(readActivity).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })); await flush(); expect(readActivity).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await flush(); expect(readActivity).toHaveBeenCalledTimes(4);
    readActivity.mockImplementation(() => new Promise(() => {})); void source.refresh(); const pending = readActivity.mock.calls.at(-1)?.[0].signal;
    stop(); expect(pending.aborted).toBe(true); await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); document.dispatchEvent(new Event('visibilitychange'));
    expect(readActivity).toHaveBeenCalledTimes(5); expect(vi.getTimerCount()).toBe(0);
  });
  it('shows unavailable before first success and ignores a late disconnected read', async () => {
    let resolve!: (out: ActivityResult<ActivityProjection>) => void;
    const readActivity = vi.fn().mockResolvedValueOnce({ status: 'unavailable' }).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const source = createNotificationSource({ adapter: { readActivity }, document }); const update = vi.fn(); const stop = source.connect(update); await flush();
    expect(source.getModel().status).toBe('unavailable'); void source.refresh(); stop(); const count = update.mock.calls.length;
    resolve(ok('late')); await flush(); expect(update).toHaveBeenCalledTimes(count); expect(source.getModel().waiting).toBe(0);
  });
  it('resets and aborts on account/environment/run/sign-out changes and never reads as presenter', async () => {
    const state = signal<SessionState>(ready()); let finish!: (out: ActivityResult<ActivityProjection>) => void;
    const readActivity = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state } }, { provide: ActivityClient, useValue: { readActivity } }] });
    const source = TestBed.inject(NotificationSource); const update = vi.fn(); const stop = source.connect(update); TestBed.tick(); await flush();
    const oldSignal = readActivity.mock.calls[0][0].signal; const oldFinish = finish;
    state.set(ready('next')); TestBed.tick(); await flush(); expect(oldSignal.aborted).toBe(true);
    oldFinish(ok('old')); await flush(); expect(update.mock.calls.at(-1)?.[0].waiting).toBe(0);
    state.set(ready('next', 'other')); TestBed.tick(); await flush(); expect(readActivity).toHaveBeenCalledTimes(3);
    const current = state(); if (current.status !== 'ready') throw new Error('test setup');
    state.set({ ...current, context: { ...current.context, environmentId: 'another-env' } }); TestBed.tick(); await flush(); expect(readActivity).toHaveBeenCalledTimes(4);
    state.set({ status: 'signed-out' }); TestBed.tick(); await flush(); expect(update.mock.calls.at(-1)?.[0].status).toBe('unavailable');
    state.set({ ...current, context: { ...current.context, roles: ['presenter'] } }); TestBed.tick(); await flush(); expect(readActivity).toHaveBeenCalledTimes(4); stop();
  });
  it('shares the root scope across shell remounts without replaying a delivered note', async () => {
    const state = signal<SessionState>(ready()); const readActivity = vi.fn().mockResolvedValue(ok());
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state } }, { provide: ActivityClient, useValue: { readActivity } }] });
    const source = TestBed.inject(NotificationSource); const first = vi.fn(); let stop = source.connect(first); TestBed.tick(); await flush();
    readActivity.mockResolvedValue(ok('new')); document.dispatchEvent(new Event('gcsp:presenter-action')); await flush();
    expect(first.mock.calls.at(-1)?.[0].note?.id).toBe('new'); stop();
    const remount = vi.fn(); stop = source.connect(remount); await flush();
    expect(remount.mock.calls[0][0].waiting).toBe(1);
    expect(remount.mock.calls.every(([model]) => model.note === null)).toBe(true); stop();
  });
});
