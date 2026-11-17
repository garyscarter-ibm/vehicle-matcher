import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualReviewComponent, ManualReviewDetailsComponent, manualVehicle } from './manual-review.component';
import type { ManualClaim, ManualEditableDetails, ManualHandoff, ManualProjection, ManualReviewDetails } from './manual.types';

const claim = { state: 'quoted', hold: { mode: 'replacement', expiresAt: '2026-11-16T18:00:00Z' }, quote: {
  orderUuid: 'exact-car', facts: { display: { name: 'Pinned BMW', photo: '/pinned.webp' }, facts: { model: { status: 'known', value: 'i4', unit: null } } },
  terms: { points: { value: 0, unit: 'points' }, allowanceInputs: { allowance: { value: 100, unit: 'points' } }, contribution: { amount: 0, currency: 'GBP', period: 'month' } },
  validUntil: '2026-11-16T18:00:00Z',
} } as unknown as ManualClaim;
const projection = (): ManualProjection => ({ state: 'preview', claim, order: null, terms: null, declarations: [], wording: null,
  reviewDetails: null, failure: null, canReview: true, canSubmit: false, canRelease: true, approved: false });

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

const draft = (): ManualEditableDetails => ({ contact: { phone: '01632 960000', email: 'saved@example.test' }, expectedReturnMileage: 0, specialRequirements: '' });
const details = (): ManualReviewDetails => ({ binding: { runId: 'run', employeeId: 'employee', entitlementSlotId: 'slot', holdId: 'hold', quoteId: 'quote', expectedHoldVersion: 2, expectedDraftVersion: 3 },
  reviewDetailsVersion: 1, details: draft(), constraints: { maximumSpecialRequirements: 43, maximumReturnMileage: 250000, mileageUnit: 'mi', textLengthUnit: 'UTF-16 code units', provenance: { status: 'assumed' } },
  mode: 'replacement', currentContract: { model: 'Current BMW', registration: 'AB12 CDE', contractEndDate: '2026-12-01' }, requestedCollection: { date: '2026-12-02', locationId: 'actual-centre' },
  oldContractId: 'old-contract', contract: { contractOptionId: 'twelve-month', months: 12, annualMileage: 12000 }, hold: { ...claim.hold, holdId: 'hold' }, quote: { ...claim.quote, quoteId: 'quote' },
  orderNumber: '1234567', stockVersion: 4, now: '2026-11-17T00:00:00Z', clockVersion: '1', frozen: false, editable: true, canContinue: true,
  view: { state: 'review', editable: true, action: 'save-review-details', supportOwner: 'employee' } });

describe('manual controlled review details composition', () => {
  let fixture: ComponentFixture<ManualReviewDetailsComponent>;
  const root = () => fixture.nativeElement as HTMLElement;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ManualReviewDetailsComponent] }).compileComponents(); fixture = TestBed.createComponent(ManualReviewDetailsComponent);
    fixture.componentRef.setInput('projection', { ...projection(), reviewDetails: details() }); fixture.componentRef.setInput('detailsDraft', draft());
    fixture.componentRef.setInput('canSaveDetails', true); fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });
  it('renders actual contract collection and saved review pins with zero mileage', () => {
    expect(root().textContent).toContain('actual-centre'); expect(root().textContent).toContain('2026-12-02'); expect(root().textContent).toContain('old-contract');
    expect(root().textContent).toContain('Current BMW'); expect(root().textContent).toContain('twelve-month'); expect(root().textContent).toContain('0 mi');
    expect(root().querySelector<HTMLInputElement>('#manual-return-mileage')!.value).toBe('0');
    expect(root().querySelector<HTMLInputElement>('#manual-return-mileage')!.max).toBe('250000'); expect(root().querySelector('textarea')!.maxLength).toBe(43);
    expect(root().textContent).toContain('43 UTF-16 code units');
  });
  it('emits controlled edits without mutating the saved values and saves only intentionally', () => {
    const changed = vi.fn(); const saved = vi.fn(); fixture.componentInstance.detailsChange.subscribe(changed); fixture.componentInstance.saveDetails.subscribe(saved);
    const email = root().querySelector<HTMLInputElement>('#manual-contact-email')!; email.value = 'new@example.test'; email.dispatchEvent(new Event('input'));
    expect(changed).toHaveBeenCalledExactlyOnceWith({ ...draft(), contact: { ...draft().contact, email: 'new@example.test' } });
    expect(fixture.componentInstance.projection().reviewDetails!.details.contact.email).toBe('saved@example.test'); expect(saved).not.toHaveBeenCalled();
    const event = new Event('submit', { cancelable: true }); root().querySelector('form')!.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); expect(saved).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('canSaveDetails', false); fixture.detectChanges(); root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); expect(saved).toHaveBeenCalledOnce();
  });
  it('keeps incomplete revision zero editable without describing it as saved authority', () => {
    fixture.componentRef.setInput('projection', { ...projection(), reviewDetails: { ...details(), reviewDetailsVersion: 0, details: { contact: {}, expectedReturnMileage: null } } });
    fixture.componentRef.setInput('detailsDraft', { contact: { phone: '', email: '' }, expectedReturnMileage: null, specialRequirements: '' }); fixture.detectChanges();
    expect(root().querySelector('fieldset')!.disabled).toBe(false); expect(root().querySelector<HTMLInputElement>('#manual-contact-email')!.required).toBe(true);
    expect(root().textContent).toContain('Complete and save'); expect(root().textContent).not.toContain('Saved review details');
    const saved = vi.fn(); fixture.componentInstance.saveDetails.subscribe(saved); root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); expect(saved).not.toHaveBeenCalled();
  });
  it('distinguishes dirty inputs from saved readback and freezes only the actual saved snapshot', () => {
    fixture.componentRef.setInput('detailsDraft', { ...draft(), contact: { ...draft().contact, email: 'unsaved@example.test' } }); fixture.componentRef.setInput('detailsDirty', true); fixture.detectChanges();
    expect(root().textContent).toContain('unsaved changes'); expect(root().textContent).toContain('saved@example.test');
    fixture.componentRef.setInput('projection', { ...projection(), reviewDetails: { ...details(), frozen: true, editable: false } }); fixture.detectChanges();
    expect(root().querySelector('form')).toBeNull(); expect(root().textContent).toContain('Frozen review details'); expect(root().textContent).not.toContain('unsaved@example.test');
  });
  it('hides replacement mileage and returning contract for a new order', () => {
    fixture.componentRef.setInput('projection', { ...projection(), reviewDetails: { ...details(), mode: 'new', oldContractId: null, currentContract: null } }); fixture.detectChanges();
    expect(root().querySelector('#manual-return-mileage')).toBeNull(); expect(root().textContent).not.toContain('Returning contract'); expect(root().textContent).toContain('New order');
  });
  it('associates server field errors with native controls and summary links focus them', async () => {
    document.body.append(root());
    fixture.componentRef.setInput('projection', { ...projection(), reviewDetails: details(), failure: { status: 'invalid', code: 'review-details-invalid', retryable: false,
      reasons: [{ field: 'contact.email', reason: 'Supply a contact email address.' }, { field: 'expectedReturnMileage', reason: 'Supply returning-car mileage.' }] } });
    fixture.detectChanges(); await fixture.whenStable(); const email = root().querySelector<HTMLInputElement>('#manual-contact-email')!;
    expect(email.getAttribute('aria-invalid')).toBe('true'); expect(email.getAttribute('aria-describedby')).toBe('manual-contact-email-error');
    expect(document.activeElement).toBe(root().querySelector('.gcsp-error-summary'));
    root().querySelector<HTMLAnchorElement>('.gcsp-error-summary a')!.click(); expect(document.activeElement).toBe(email); root().remove();
    expect(root().querySelector('#manual-contact-email-error')!.textContent).toContain('Supply a contact email address.');
  });
  it.each(['busy', 'resumeRequired'] as const)('blocks edit and save events while %s', (flag) => {
    fixture.componentRef.setInput(flag, true); fixture.detectChanges(); const changed = vi.fn(); const saved = vi.fn();
    fixture.componentInstance.detailsChange.subscribe(changed); fixture.componentInstance.saveDetails.subscribe(saved);
    root().querySelector('input')!.dispatchEvent(new Event('input')); root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(root().querySelector('fieldset')!.disabled).toBe(true); expect(changed).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  });
});
