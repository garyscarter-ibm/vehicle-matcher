import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualReviewComponent, ManualReviewDetailsComponent, manualVehicle } from './manual-review.component';
import type { ManualClaim, ManualEditableDetails, ManualHandoff, ManualProjection, ManualQuote, ManualReviewDetails } from './manual.types';

const claim = { state: 'quoted', hold: { mode: 'replacement', expiresAt: '2026-11-16T18:00:00Z' }, quote: {
  orderUuid: 'exact-car', facts: { display: { name: 'Pinned BMW', photo: '/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp' }, facts: { model: { status: 'known', value: 'i4', unit: null } } },
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
  it('shows server-owned remaining time and distinct release intents without internal identifiers', () => {
    fixture.componentRef.setInput('projection', { ...projection(), claim: { ...claim, now: '2026-11-16T17:58:30Z',
      hold: { ...claim.hold, phase: 'preview', holdId: 'private-hold' },
      quote: { ...claim.quote, quoteId: 'private-quote', timing: { previewSeconds: 120, reviewSeconds: 600, transition: 'once-from-preview' } } } });
    fixture.detectChanges();
    expect(text()).toContain('Car reservation: 1:30 remaining');
    expect(text()).toContain('Continuing does not place an order.');
    expect(text()).not.toContain('Car ID'); expect(text()).not.toContain('Reserved until');
    for (const label of ['Back', 'Change car', 'Cancel review']) expect(button(label)).toBeDefined();
  });
  it('renders pinned exact-car facts and zero terms without substituting the navigation snapshot', () => {
    fixture.componentRef.setInput('selection', { orderUuid: 'other', snapshot: { display: { name: 'Wrong gallery car', photo: '/wrong.webp' } } } as unknown as ManualHandoff);
    fixture.detectChanges(); expect(text()).toContain('Pinned BMW'); expect(text()).not.toContain('Car ID'); expect(text()).not.toContain('Wrong gallery car');
    expect(text()).toContain('0 GBP / month'); expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('h1')).toHaveLength(1);
  });
  it.each([
    [{ kind: 'employee-scheme', contribution: null }, 'None'],
    [{ kind: 'employee-scheme', contribution: { amount: 0, currency: 'GBP', period: 'month' } }, 'None'],
    [{ kind: 'employee-scheme' }, null],
    [{ kind: 'employee-scheme', contribution: { status: 'unknown', amount: 0, currency: 'GBP' } }, null],
    [{ kind: 'employee-scheme', contribution: { amount: 25, currency: 'GBP', period: 'month' } }, '25 GBP / month'],
    [{ kind: 'employee-scheme', contribution: { amount: 25, currency: 'GBP' } }, '25 GBP'],
    [{ kind: 'employee-scheme', contribution: { amount: 25 } }, null],
  ] as const)('distinguishes no contribution from unknown and supplied monetary terms: %j', (terms, expected) => {
    const vehicle = manualVehicle({ ...claim.quote, terms });
    expect(vehicle.termRows.find((row) => row.label === 'Contribution')?.value).toBe(expected);
  });
  it('reads name, photo and facts from the Java quote envelope (FUCQ-520)', () => {
    const snapshot = { display: { name: 'BMW 3 Series Touring 320i', photo: '/java.webp' }, facts: { model: { status: 'known', value: '320i', unit: null } }, snapshotVersion: 1 };
    const vehicle = manualVehicle({ ...claim.quote, facts: { facts: snapshot } } as unknown as ManualQuote);
    expect(vehicle.name).toBe('BMW 3 Series Touring 320i'); expect(vehicle.images).toEqual([{ src: '/java.webp', alt: 'BMW 3 Series Touring 320i' }]);
    expect(vehicle.rows[0].value).toBe('320i'); expect(vehicle.identity).toBe('');
    expect(manualVehicle({ ...claim.quote, facts: { facts: {} } } as unknown as ManualQuote).name).toBe('Car name not supplied');
  });
  it('uses the shared missing-image frame when no image is supplied', () => {
    const p = projection(); fixture.componentRef.setInput('projection', { ...p, claim: { ...claim, quote: { ...claim.quote, facts: {} } } }); fixture.detectChanges();
    expect(text()).toContain('No image available for this car'); expect(text()).toContain('Car name not supplied');
    expect(manualVehicle(null).rows.every((row) => row.value === null)).toBe(true);
  });
  it('reviews the held car and never offers a second reservation', () => {
    const next = vi.fn(); fixture.componentInstance.continue.subscribe(next);
    expect(text()).not.toContain('Reserve this car to review'); expect(next).not.toHaveBeenCalled(); button('Continue to order review').click(); expect(next).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('projection', { ...projection(), claim: null, state: 'selection-ready', canReview: false });
    fixture.componentRef.setInput('selection', { orderUuid: 'selected', snapshot: { display: {} } } as unknown as ManualHandoff);
    fixture.detectChanges(); expect(text()).not.toContain('Reserve this car to review'); expect(button('Continue to order review').disabled).toBe(true);
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
  it('renders plain contract and collection context with zero saved mileage', () => {
    expect(root().textContent).not.toContain('actual-centre'); expect(root().textContent).toContain('Wednesday 2 December 2026'); expect(root().textContent).not.toContain('old-contract');
    expect(root().textContent).toContain('Current BMW'); expect(root().textContent).toContain('12 months'); expect(root().textContent).toContain('0 mi');
    expect(root().querySelector<HTMLInputElement>('#manual-return-mileage')!.value).toBe('0');
    expect(root().querySelector<HTMLInputElement>('#manual-return-mileage')!.max).toBe('250000'); expect(root().querySelector('textarea')!.maxLength).toBe(43);
    expect(root().textContent).toContain('43 characters');
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
