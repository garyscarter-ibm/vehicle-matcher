import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { ActivityClient } from '../activity/activity.client';
import { ActivityOffer, ActivityProjection, ActivityResult } from '../activity/activity.types';
import { BriefClient } from '../preferences/brief.client';
import { BriefEditorStore } from '../preferences/brief-editor.store';
import { briefEditorFixture, preferenceSaveFixture } from '../preferences/brief.fixtures';
import { BriefEditor, BriefEngagementValue, BriefPreferenceSaveValue, BriefResult, BuddyView } from '../preferences/brief.types';
import { AccountBuddyComponent } from './account-buddy.component';

const ready = (employeeId = 'employee-one', runId = 'run-one'): SessionState => ({ status: 'ready', context: { subject: 'subject', employeeId, environmentId: 'isolated', runId, roles: ['employee'], policyVersion: 'policy', capabilities: ['activity:read'] } });
const buddy = (paused = false): BuddyView => ({ state: paused ? 'disengaged' : 'engaged', reason: paused ? 'paused' : null, permissionVersion: 3, minimumCategories: 2, considered: 2, remaining: 0, sameAgain: false, canEngage: false });
const held = (): ActivityOffer => ({ offerRef: { offerId: 'offer-one' }, state: 'active', displayState: 'active', version: 2, briefVersion: 4, createdAt: '2026-11-22T08:00:00Z', expiresAt: '2026-11-23T12:00:00Z', href: '/gcsp/offers/offer-one' });
const projection = (patch: Partial<ActivityProjection> = {}): ActivityProjection => ({ runId: 'run-one', employeeId: 'employee-one', asOf: '2026-11-22T10:00:00Z', clockVersion: '1', briefVersion: 4,
  permission: { searchConsent: true, holdConsent: true, paused: false, permissionVersion: 3, canSearch: true, canHold: true }, state: 'searching', sourceStatus: 'ok', lastSuccessfulCheck: null,
  searchEvidence: { status: 'recorded', checks: 1 }, currentOffer: null, offers: [], stateChanges: [], stateChangesEvidence: { status: 'recorded', rejectedReceipts: 0 }, ...patch });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const ok = (value: ActivityProjection): ActivityResult<ActivityProjection> => ({ status: 'ok', value });

describe('Account Buddy source composition with real stores', () => {
  let fixture: ComponentFixture<AccountBuddyComponent>; let editor: BriefEditor; let value: ActivityProjection;
  let state: ReturnType<typeof signal<SessionState>>;
  let activity: { readActivity: ReturnType<typeof vi.fn>; readOfferDisplay: ReturnType<typeof vi.fn>; readControlVersions: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn> };
  let client: { readEditor: ReturnType<typeof vi.fn>; pauseSearch: ReturnType<typeof vi.fn>; resumeSearch: ReturnType<typeof vi.fn>; savePreferences: ReturnType<typeof vi.fn>; engage: ReturnType<typeof vi.fn>; disengage: ReturnType<typeof vi.fn> };
  const root = (): HTMLElement => fixture.nativeElement;
  const button = (label: string) => Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find((node) => node.textContent?.trim() === label)!;
  const settle = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); await fixture.whenStable(); fixture.detectChanges(); };
  const mount = async () => { fixture = TestBed.createComponent(AccountBuddyComponent); document.body.append(root()); fixture.detectChanges(); await settle(); return fixture.componentInstance; };
  beforeEach(() => {
    const base = briefEditorFixture(); editor = { ...base, initial: { ...base.initial, buddy: buddy(), consent: { search: true, hold: true } } }; value = projection(); state = signal(ready());
    activity = { readActivity: vi.fn(async () => ok(value)), readOfferDisplay: vi.fn(async () => ({ status: 'ok', value: { offerRef: { offerId: 'offer-one' }, state: 'active', version: 2, title: 'BMW i4', images: [] } })), readControlVersions: vi.fn(), command: vi.fn() };
    client = { readEditor: vi.fn(async () => ({ status: 'ok', value: editor })), pauseSearch: vi.fn(), resumeSearch: vi.fn(), savePreferences: vi.fn(), engage: vi.fn(), disengage: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state } }, { provide: BriefClient, useValue: client }, { provide: ActivityClient, useValue: activity }] });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  });
  afterEach(() => { fixture?.destroy(); vi.restoreAllMocks(); });

  it('shares the root editor, opens source history/check/exclusions, and returns exact drawer focus after Escape', async () => {
    value = projection({ lastSuccessfulCheck: { checkedAt: '2026-11-22T09:30:00Z', carsChecked: 3, suitableCars: 0, exclusions: [{ essential: 'seats', requirement: { value: 5 }, cars: 3 }], outcome: 'no-match' }, stateChangesEvidence: { status: 'incomplete', rejectedReceipts: 1 } });
    const component = await mount(); expect(component.brief).toBe(TestBed.inject(BriefEditorStore)); expect(activity.readActivity).toHaveBeenCalledOnce();
    const opener = button('Buddy history'); opener.focus(); opener.click(); await settle();
    const dialog = root().querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.open).toBe(true); expect(document.activeElement).toBe(dialog.querySelector('h2')); expect(dialog.textContent).toContain('Buddy history');
    expect(dialog.textContent).toContain('Cars checked'); expect(dialog.textContent).toContain('3 cars checked, 0 suitable.'); expect(dialog.textContent).toContain('No released car has 5 seats.'); expect(dialog.textContent).toContain('Some activity could not be verified.');
    const cancel = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(cancel); await settle(); expect(cancel.defaultPrevented).toBe(true); expect(dialog.open).toBe(false); expect(document.activeElement).toBe(opener);
  });
  it('shows supplied held offer media fallback in the existing drawer and refocuses its heading on refreshed content', async () => {
    value = projection({ currentOffer: held() }); const component = await mount();
    const opener = button('View held offer'); opener.focus(); opener.click(); await settle(); const dialog = root().querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('Your held offer'); expect(dialog.textContent).toContain('BMW i4'); expect(dialog.querySelector('a')?.getAttribute('href')).toBe('/gcsp/offers/offer-one'); expect(dialog.textContent).toContain('No image for this car yet');
    dialog.querySelector<HTMLAnchorElement>('a')!.focus(); value = projection({ currentOffer: { ...held(), state: 'accepted', displayState: 'accepted' } });
    await component.activity.refresh(); await settle(); expect(document.activeElement).toBe(dialog.querySelector('h2')); expect(dialog.textContent).toContain('Accepted');
    button('Close').click(); await settle(); expect(root().querySelector('[data-focus-key=buddy-order]')?.textContent).toBe('Track your order');
  });
  it('uses only exact editor pause/resume commands, retains held readback during refresh and refreshes activity after an actual command', async () => {
    value = projection({ currentOffer: held() }); const component = await mount();
    const pause = deferred<BriefResult<BriefEngagementValue>>(); const refresh = deferred<ActivityResult<ActivityProjection>>(); client.pauseSearch.mockReturnValueOnce(pause.promise); activity.readActivity.mockReturnValueOnce(refresh.promise);
    button('Pause search').click(); button('Pause search').click(); await settle(); expect(client.pauseSearch).toHaveBeenCalledOnce(); expect(activity.command).not.toHaveBeenCalled(); expect(activity.readControlVersions).not.toHaveBeenCalled(); expect(activity.readActivity).toHaveBeenCalledOnce();
    expect(client.pauseSearch.mock.calls[0][0]).toEqual({ commandId: expect.any(String), expectedBriefVersion: 4, expectedDraftVersion: 2 });
    expect(client.pauseSearch.mock.calls[0][1]).toMatchObject({ expectedContextKey: component.brief.scope(), signal: expect.any(AbortSignal) });
    pause.resolve({ status: 'ok', value: { briefVersion: 5, draftVersion: 2, buddy: buddy(true) } }); await settle(); expect(activity.readActivity).toHaveBeenCalledTimes(2); expect(root().textContent).toContain('A car is held for you'); expect(button('Pause search').disabled).toBe(true);
    value = projection({ currentOffer: held(), permission: { ...value.permission!, paused: true, canSearch: false, canHold: false } }); refresh.resolve(ok(value)); await settle(); expect(button('Resume search').disabled).toBe(false); expect(root().textContent).toContain('Pausing keeps this offer open.');
    client.resumeSearch.mockResolvedValueOnce({ status: 'ok', value: { briefVersion: 6, draftVersion: 2, buddy: buddy() } }); value = projection({ currentOffer: held(), briefVersion: 6 }); button('Resume search').click(); await settle(); expect(client.resumeSearch.mock.calls[0][0]).toMatchObject({ expectedBriefVersion: 5, expectedDraftVersion: 2 }); expect(activity.readActivity).toHaveBeenCalledTimes(3); expect(button('Pause search').disabled).toBe(false);
  });
  it('syncs authoritative adjacent preference engagement once after the root editor settles without duplicating initial reads', async () => {
    editor = briefEditorFixture(); editor = { ...editor, initial: { ...editor.initial, buddy: { ...editor.initial.buddy, remaining: 0, considered: 2, canEngage: true } } };
    value = projection({ permission: { searchConsent: false, holdConsent: false, paused: false, permissionVersion: 2, canSearch: false, canHold: false } });
    const component = await mount(); expect(activity.readActivity).toHaveBeenCalledOnce(); expect(root().querySelector('section')?.getAttribute('data-state')).toBe('inactive');
    const engagement = deferred<BriefResult<BriefEngagementValue>>(); client.engage.mockReturnValueOnce(engagement.promise);
    const request = component.brief.runBuddyCommand('engage'); await settle(); expect(activity.readActivity).toHaveBeenCalledOnce();
    value = projection({ briefVersion: 5 }); engagement.resolve({ status: 'ok', value: { briefVersion: 5, draftVersion: 2, buddy: buddy() } }); await request; await settle();
    expect(activity.readActivity).toHaveBeenCalledTimes(2); expect(root().querySelector('section')?.getAttribute('data-state')).toBe('active'); expect(button('Pause search').disabled).toBe(false);
    await settle(); expect(activity.readActivity).toHaveBeenCalledTimes(2); expect(activity.command).not.toHaveBeenCalled();
  });
  it('keeps the exact failed command identity for deliberate retry and never replays during reload', async () => {
    const component = await mount(); client.pauseSearch.mockResolvedValueOnce({ status: 'unavailable', retryable: true });
    button('Pause search').click(); await settle(); const command = client.pauseSearch.mock.calls[0][0]; expect(button('Retry the same request')).toBeDefined();
    await component.activity.refresh(); await settle(); expect(client.pauseSearch).toHaveBeenCalledOnce();
    client.pauseSearch.mockResolvedValueOnce({ status: 'ok', value: { briefVersion: 5, draftVersion: 2, buddy: buddy(true) } }); value = projection({ permission: { ...value.permission!, paused: true, canSearch: false, canHold: false } });
    button('Retry the same request').click(); await settle(); expect(client.pauseSearch).toHaveBeenCalledTimes(2); expect(client.pauseSearch.mock.calls[1][0]).toEqual(command); expect(button('Resume search')).toBeDefined(); expect(activity.command).not.toHaveBeenCalled();
  });
  it('respects a real queued preference save and never refreshes activity for a blocked command', async () => {
    const component = await mount(); const save = deferred<BriefResult<BriefPreferenceSaveValue>>(); client.savePreferences.mockReturnValueOnce(save.promise);
    component.brief.rate(4, 'contract-1'); await settle(); expect(button('Pause search').disabled).toBe(true); component.run('pauseSearch'); await settle();
    expect(client.pauseSearch).not.toHaveBeenCalled(); expect(activity.readActivity).toHaveBeenCalledOnce(); expect(root().textContent).toContain('Wait for your preference changes to save before changing Buddy.');
    save.resolve({ status: 'ok', value: { ...preferenceSaveFixture(), buddy: buddy() } }); await settle();
  });
  it.each(['signout', 'scope', 'restart'] as const)('closes a private drawer on %s and rejects old activity readback', async (change) => {
    value = projection({ currentOffer: held() }); const component = await mount(); button('View held offer').click(); await settle();
    const late = deferred<ActivityResult<ActivityProjection>>(); activity.readActivity.mockReturnValueOnce(late.promise); const loading = component.activity.refresh(); const signal = activity.readActivity.mock.calls[1][0].signal as AbortSignal;
    if (change === 'signout') state.set({ status: 'signed-out' });
    else if (change === 'scope') { value = projection({ employeeId: 'employee-two', runId: 'run-two' }); state.set(ready('employee-two', 'run-two')); }
    else late.resolve({ status: 'stale-run' });
    await settle(); expect(root().querySelector<HTMLDialogElement>('dialog')!.open).toBe(false); expect(root().querySelector('dialog')!.textContent).not.toContain('BMW i4');
    if (change !== 'restart') { expect(signal.aborted).toBe(true); late.resolve(ok(projection({ currentOffer: held() }))); }
    await loading; await settle(); expect(root().querySelector('dialog')!.textContent).not.toContain('BMW i4'); expect(component.drawerKind()).toBeNull();
    if (change === 'restart') expect(root().textContent).toContain('This page was restarted.');
  });
  it('aborts the component activity read on teardown and ignores late data', async () => {
    const late = deferred<ActivityResult<ActivityProjection>>(); activity.readActivity.mockReturnValueOnce(late.promise); const component = await mount(); const signal = activity.readActivity.mock.calls[0][0].signal as AbortSignal;
    fixture.destroy(); expect(signal.aborted).toBe(true); late.resolve(ok(projection({ currentOffer: held() }))); await Promise.resolve(); expect(component.activity.view().projection).toBeNull();
  });
});
