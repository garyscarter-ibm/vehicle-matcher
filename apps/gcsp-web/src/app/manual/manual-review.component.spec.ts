import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualReviewComponent, manualVehicle } from './manual-review.component';
import type { ManualClaim, ManualHandoff, ManualProjection } from './manual.types';

const claim = { state: 'quoted', hold: { mode: 'replacement', expiresAt: '2026-11-16T18:00:00Z' }, quote: {
  orderUuid: 'exact-car', facts: { display: { name: 'Pinned BMW', photo: '/pinned.webp' }, facts: { model: { status: 'known', value: 'i4', unit: null } } },
  terms: { points: { value: 0, unit: 'points' }, allowanceInputs: { allowance: { value: 100, unit: 'points' } }, contribution: { amount: 0, currency: 'GBP', period: 'month' } },
  validUntil: '2026-11-16T18:00:00Z',
} } as unknown as ManualClaim;
const projection = (): ManualProjection => ({ state: 'preview', claim, order: null, terms: null, declarations: [], wording: null,
  failure: null, canReview: true, canSubmit: false, canRelease: true, approved: false });

describe('manual selected-car review composition', () => {
  let fixture: ComponentFixture<ManualReviewComponent>;
  beforeEach(async () => { await TestBed.configureTestingModule({ imports: [ManualReviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(ManualReviewComponent); fixture.componentRef.setInput('projection', projection()); fixture.detectChanges(); });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const button = (label: string) => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;
  it('renders pinned exact-car facts and zero terms without substituting the navigation snapshot', () => {
    fixture.componentRef.setInput('selection', { orderUuid: 'other', snapshot: { display: { name: 'Wrong gallery car', photo: '/wrong.webp' } } } as unknown as ManualHandoff);
    fixture.detectChanges(); expect(text()).toContain('Pinned BMW'); expect(text()).toContain('Car ID exact-car'); expect(text()).not.toContain('Wrong gallery car');
    expect(text()).toContain('0 GBP / month'); expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('/pinned.webp');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('h1')).toHaveLength(1);
  });
  it('uses the shared missing-image frame when no image is supplied', () => {
    const p = projection(); fixture.componentRef.setInput('projection', { ...p, claim: { ...claim, quote: { ...claim.quote, facts: {} } } }); fixture.detectChanges();
    expect(text()).toContain('No image available for this car'); expect(text()).toContain('Car name not supplied');
    expect(manualVehicle(null).rows.every((row) => row.value === null)).toBe(true);
  });
  it('emits only an intentional reservation or review action', () => {
    const reserve = vi.fn(); const next = vi.fn(); fixture.componentInstance.claim.subscribe(reserve); fixture.componentInstance.continue.subscribe(next);
    expect(reserve).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled(); button('Continue to order review').click(); expect(next).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('projection', { ...projection(), claim: null, state: 'selection-ready', canReview: false });
    fixture.componentRef.setInput('selection', { orderUuid: 'selected', snapshot: { display: {} } } as unknown as ManualHandoff);
    fixture.componentRef.setInput('canClaim', true); fixture.detectChanges(); button('Reserve this car to review').click(); expect(reserve).toHaveBeenCalledOnce();
  });
  it('requires a deliberate recovery action and blocks review/release while unresolved', () => {
    const resume = vi.fn(); fixture.componentInstance.resume.subscribe(resume);
    fixture.componentRef.setInput('projection', { ...projection(), state: 'resume-required', canReview: false }); fixture.detectChanges();
    button('Continue reviewing this selection').click(); expect(resume).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('projection', { ...projection(), state: 'pending', canReview: false, canRelease: false }); fixture.detectChanges();
    expect(button('Continue to order review').disabled).toBe(true); expect(button('Edit choices').disabled).toBe(true); expect(button('Change car').disabled).toBe(true);
  });
});
