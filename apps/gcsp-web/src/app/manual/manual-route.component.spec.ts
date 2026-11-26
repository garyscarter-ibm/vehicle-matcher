import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import { ManualRouteComponent } from './manual-route.component';
import { ManualReviewComponent } from './manual-review.component';
import { ManualSummaryComponent } from './manual-summary.component';
import { ManualStore } from './manual.store';
import type { ManualClaim, ManualEditableDetails, ManualOrder, ManualProjection } from './manual.types';

const empty = (): ManualProjection => ({ state: 'no-claim', claim: null, order: null, terms: null, reviewDetails: null, declarations: [], wording: null, failure: null,
  canReview: false, canSubmit: false, canRelease: false, approved: false });

describe('manual route command and navigation boundary', () => {
  let fixture: ComponentFixture<ManualRouteComponent>; let navigate: ReturnType<typeof vi.spyOn>;
  const projection = signal(empty()); const loading = signal(false); const signIn = vi.fn(); const scope = signal<string | null>('employee-scope');
  const detailsDraft = signal<ManualEditableDetails | null>(null); const detailsDirty = signal(false); const canSaveReviewDetails = signal(false);
  const store = { projection, loading, scope, state: computed(() => projection().state), handoff: signal(null), declarations: signal({}), resumeRequired: signal(false), canClaim: signal(false),
    detailsDraft, detailsDirty, canSaveReviewDetails, readback: signal(null), announcement: signal(''), canDiscardLocalEdits: signal(false), discardLocalEdits: vi.fn(), beginDetailsEdit: vi.fn(), refresh: vi.fn(), setReviewDetails: vi.fn(), saveReviewDetails: vi.fn(),
    enter: vi.fn(), dispose: vi.fn(), release: vi.fn(), checkStatus: vi.fn(), claimSelection: vi.fn(), beginReview: vi.fn(), confirmResume: vi.fn(), setDeclaration: vi.fn(), submit: vi.fn() };
  beforeEach(async () => {
    projection.set(empty()); scope.set('employee-scope'); loading.set(false); detailsDraft.set(null); detailsDirty.set(false); canSaveReviewDetails.set(false); signIn.mockReset();
    Object.values(store).forEach((value) => { if (vi.isMockFunction(value)) value.mockReset(); }); store.enter.mockResolvedValue(undefined); store.release.mockResolvedValue(false);
    await TestBed.configureTestingModule({ imports: [ManualRouteComponent], providers: [provideRouter([]), { provide: ManualStore, useValue: store }, { provide: AuthPort, useValue: { signIn } }] }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(ManualRouteComponent); fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });
  it('checks actual state on direct entry and never claims, reviews or submits automatically', () => {
    expect(store.enter).toHaveBeenCalledExactlyOnceWith(); expect(store.claimSelection).not.toHaveBeenCalled(); expect(store.beginReview).not.toHaveBeenCalled(); expect(store.submit).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No car selected');
  });
  it.each(['preview', 'order-review'] as const)('binds controlled details and only explicit events in %s', (phase) => {
    const draft: ManualEditableDetails = { contact: { phone: '01632 960000', email: 'actual@example.test' }, expectedReturnMileage: null, specialRequirements: '' };
    detailsDraft.set(draft); detailsDirty.set(true); canSaveReviewDetails.set(true);
    projection.set({ ...empty(), state: phase === 'preview' ? 'preview' : 'review', claim: { state: 'quoted', hold: { phase, mode: 'new', expiresAt: '2026-11-17T18:00:00Z' },
      quote: { orderUuid: 'exact-car', facts: {}, terms: {}, validUntil: '2026-11-17T18:00:00Z' } } as ManualClaim }); fixture.detectChanges();
    const child = fixture.debugElement.query(By.directive(phase === 'preview' ? ManualReviewComponent : ManualSummaryComponent)).componentInstance as ManualReviewComponent | ManualSummaryComponent;
    expect(child.detailsDraft()).toBe(draft); expect(child.detailsDirty()).toBe(true); expect(child.canSaveDetails()).toBe(true);
    expect(store.setReviewDetails).not.toHaveBeenCalled(); expect(store.saveReviewDetails).not.toHaveBeenCalled(); expect(store.submit).not.toHaveBeenCalled();
    child.detailsChange.emit(draft); child.saveDetails.emit(); expect(store.setReviewDetails).toHaveBeenCalledExactlyOnceWith(draft); expect(store.saveReviewDetails).toHaveBeenCalledExactlyOnceWith();
    if (child instanceof ManualSummaryComponent) { child.submit.emit(); expect(store.submit).toHaveBeenCalledExactlyOnceWith(); }
  });
  it('maps back, change and cancel to distinct confirmed release intents', async () => {
    store.release.mockResolvedValue(true);
    await fixture.componentInstance.back(); await fixture.componentInstance.changeCar(); await fixture.componentInstance.cancel();
    expect(store.release.mock.calls).toEqual([['back'], ['change'], ['cancel']]);
    expect(navigate.mock.calls.map((args: unknown[]) => args[0])).toEqual(['/stock', '/stock', '/account']);
  });
  it('reopens details and returns to the same summary without releasing or restarting the review', () => {
    projection.set({ ...empty(), state: 'review', claim: { hold: { phase: 'order-review' } } as ManualClaim,
      reviewDetails: { editable: true, reviewDetailsVersion: 1 } as ManualProjection['reviewDetails'] });
    store.beginDetailsEdit.mockReturnValue(true); fixture.componentInstance.editDetails(); expect(fixture.componentInstance.showSummary()).toBe(false);
    fixture.componentInstance.continueReview(); expect(fixture.componentInstance.showSummary()).toBe(true);
    expect(store.release).not.toHaveBeenCalled(); expect(store.beginReview).not.toHaveBeenCalled(); expect(store.submit).not.toHaveBeenCalled();
  });
  it('waits for a successful release before edit or browse navigation', async () => {
    projection.set({ ...empty(), state: 'preview', claim: { state: 'quoted', hold: { phase: 'preview', mode: 'replacement', expiresAt: '2026-11-16T18:00:00Z' },
      quote: { orderUuid: 'exact-car', facts: {}, terms: {}, validUntil: '2026-11-16T18:00:00Z' } } as ManualClaim });
    await fixture.componentInstance.edit(); await fixture.componentInstance.browse(); expect(navigate).not.toHaveBeenCalled();
    store.release.mockResolvedValue(true); await fixture.componentInstance.edit(); expect(navigate).toHaveBeenCalledExactlyOnceWith('/account');
    expect(store.release.mock.calls[0]).toEqual(['change']);
  });
  it('keeps rail/back navigation inside unresolved custody until release is confirmed', async () => {
    projection.set({ ...empty(), state: 'pending' }); expect(await fixture.componentInstance.canLeave('/account')).toBe(false);
    expect(store.release).toHaveBeenCalledWith('back'); expect(await fixture.componentInstance.canLeave('/manual/summary')).toBe(true);
    store.release.mockResolvedValue(true); expect(await fixture.componentInstance.canLeave('/stock')).toBe(true);
    scope.set(null); expect(await fixture.componentInstance.canLeave('/sign-in')).toBe(true);
  });
  it('shows real failure reason and checks status without a new command', () => {
    projection.set({ ...empty(), state: 'uncertain', failure: { status: 'uncertain', code: 'manual-timeout', reason: 'The outcome is not known yet.', retryable: false } }); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('The outcome is not known yet.');
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')!.click(); expect(store.checkStatus).toHaveBeenCalledOnce(); expect(store.submit).not.toHaveBeenCalled();
  });
  it('signs in to the same authorized page without replaying a saved command', () => {
    projection.set({ ...empty(), state: 'authentication-required' }); fixture.detectChanges(); (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')!.click();
    expect(signIn).toHaveBeenCalledExactlyOnceWith('/gcsp/manual/review'); expect(store.submit).not.toHaveBeenCalled();
  });
  it('permits navigating to actual saved order progress and disposes route reads', async () => {
    projection.set({ ...empty(), state: 'pending', order: { operationId: 'actual', status: 'pending', orderReference: 'GCS-1',
      selection: { orderUuid: 'car', orderNumber: '1234567' }, progress: { stages: [] } } as unknown as ManualOrder });
    expect(await fixture.componentInstance.canLeave('/orders')).toBe(true); fixture.componentInstance.orders(); expect(navigate).toHaveBeenCalledExactlyOnceWith('/orders');
    fixture.destroy(); expect(store.dispose).toHaveBeenCalledOnce();
  });
});
