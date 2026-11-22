import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BuddyTileComponent } from './buddy-tile.component';
import { ActivityProjection } from '../activity/activity.types';
const value = (patch: Partial<ActivityProjection> = {}): ActivityProjection => ({ runId: 'r', employeeId: 'e', asOf: '2026-11-22T09:00:00Z', clockVersion: '1', briefVersion: 4,
  permission: { searchConsent: true, holdConsent: true, paused: false, canSearch: true, canHold: true, permissionVersion: 1 }, state: 'searching', sourceStatus: 'ok', lastSuccessfulCheck: null,
  searchEvidence: { status: 'recorded', checks: 1 }, currentOffer: null, offers: [], stateChanges: [], stateChangesEvidence: { status: 'recorded', rejectedReceipts: 0 }, ...patch });
describe('source Buddy tile', () => {
  it('retains loading, active, paused, held, partial, recent/history and finished source structure/actions', async () => {
    const fixture = TestBed.createComponent(BuddyTileComponent); const root = fixture.nativeElement as HTMLElement; await fixture.whenStable(); expect(root.textContent).toContain('Loading Buddy activity.');
    fixture.componentRef.setInput('phase', 'ready'); fixture.componentRef.setInput('result', { status: 'ok', value: value() }); fixture.componentRef.setInput('canPause', true); fixture.componentRef.setInput('canHistory', true);
    fixture.componentRef.setInput('events', [1, 2, 3].map((n) => ({ label: `Event ${n}` }))); await fixture.whenStable(); const paused = vi.fn(); fixture.componentInstance.paused.subscribe(paused);
    root.querySelector<HTMLButtonElement>('[data-focus-key=buddy-search-action]')!.click(); expect(paused).toHaveBeenCalledOnce(); expect(root.querySelectorAll('.gcsp-timeline-event')).toHaveLength(2);
    fixture.componentRef.setInput('result', { status: 'ok', value: value({ permission: { ...value().permission!, paused: true }, currentOffer: { offerRef: { offerId: 'o' }, state: 'active', displayState: 'active', version: 1, briefVersion: 4 }, stateChangesEvidence: { status: 'incomplete', rejectedReceipts: 1 } }) });
    fixture.componentRef.setInput('offerTitle', 'BMW X2'); fixture.componentRef.setInput('deadline', 'Respond by 22 Nov 2026, 11:00'); fixture.componentRef.setInput('canResume', true); fixture.componentRef.setInput('canOffer', true); await fixture.whenStable();
    expect(root.querySelector('section')?.getAttribute('data-state')).toBe('paused'); expect(root.textContent).toContain('Paused'); expect(root.textContent).toContain('Pausing keeps this offer open.'); expect(root.textContent).toContain('BMW X2'); expect(root.textContent).toContain('Some activity could not be verified.');
    expect(root.querySelector('.gcsp-buddy-tile-offer .vm-btn-primary')?.textContent).toBe('View held offer');
    fixture.componentRef.setInput('result', { status: 'ok', value: value({ currentOffer: { offerRef: { offerId: 'o' }, state: 'accepted', displayState: 'accepted', version: 2, briefVersion: 4 } }) }); fixture.componentRef.setInput('orderHref', '/gcsp/orders'); await fixture.whenStable(); expect(root.querySelector('a')?.textContent).toBe('Track your order'); fixture.destroy();
  });
  it('restores the heading when a focused offer control disappears in the same active state without stealing retained focus', async () => {
    const fixture = TestBed.createComponent(BuddyTileComponent); const root = fixture.nativeElement as HTMLElement; document.body.append(root);
    fixture.componentRef.setInput('phase', 'ready'); fixture.componentRef.setInput('canOffer', true); fixture.componentRef.setInput('canHistory', true);
    fixture.componentRef.setInput('result', { status: 'ok', value: value({ currentOffer: { offerRef: { offerId: 'o' }, state: 'active', displayState: 'active', version: 1, briefVersion: 4 } }) });
    await fixture.whenStable(); root.querySelector<HTMLButtonElement>('[data-focus-key=buddy-offer]')!.focus();
    expect(document.activeElement?.textContent).toBe('View held offer');
    fixture.componentRef.setInput('result', { status: 'ok', value: value() }); await fixture.whenStable();
    expect(root.querySelector('section')?.getAttribute('data-state')).toBe('active'); expect(document.activeElement).toBe(root.querySelector('h2'));
    const history = root.querySelector<HTMLButtonElement>('[data-focus-key=buddy-history]')!; history.focus();
    fixture.componentRef.setInput('result', { status: 'ok', value: value({ sourceStatus: 'delayed' }) }); await fixture.whenStable();
    expect(document.activeElement).toBe(history); fixture.destroy(); root.remove();
  });
  it('keeps unavailable/retry and pending disabling separate from available held/history actions', async () => {
    const fixture = TestBed.createComponent(BuddyTileComponent); fixture.componentRef.setInput('phase', 'unavailable'); fixture.componentRef.setInput('canRetry', true); await fixture.whenStable();
    const retried = vi.fn(); fixture.componentInstance.retried.subscribe(retried); fixture.nativeElement.querySelector('button').click(); expect(retried).toHaveBeenCalledOnce(); expect(fixture.nativeElement.querySelector('.gcsp-activity-timeline')).toBeNull();
    fixture.componentRef.setInput('phase', 'ready'); fixture.componentRef.setInput('result', { status: 'ok', value: value() }); fixture.componentRef.setInput('canPause', true); fixture.componentRef.setInput('pending', true); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('section').getAttribute('aria-busy')).toBe('true'); expect(fixture.nativeElement.querySelector('[data-focus-key=buddy-search-action]').disabled).toBe(true); fixture.destroy();
  });
});
