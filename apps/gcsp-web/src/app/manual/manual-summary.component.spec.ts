import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualSummaryComponent } from './manual-summary.component';
import type { ManualClaim, ManualOrder, ManualProjection } from './manual.types';

const claim = { hold: { mode: 'replacement' }, quote: { orderUuid: 'exact-car', facts: { display: { name: 'Pinned BMW' } }, terms: {} } } as unknown as ManualClaim;
const projection = (): ManualProjection => ({ state: 'review', claim, order: null, terms: { termsVersion: 'dated-terms', validUntil: '2026-11-16T18:00:00Z' } as ManualProjection['terms'],
  declarations: [{ id: 'required', label: 'I confirm the required declaration', appliesTo: 'all' }], wording: 'Actual supplied scheme wording.',
  failure: null, canReview: false, canSubmit: true, canRelease: true, approved: false });
const order = (status: ManualOrder['status']): ManualOrder => ({ schemaVersion: 1, operationId: 'operation', status, orderReference: 'GCS-123', attempts: 1,
  selection: { sourceType: 'cart', holdId: 'hold', orderUuid: 'exact-car', orderNumber: '1234567', configurationId: 'configuration', quoteId: 'quote',
    termsVersion: 'dated-terms', policyVersion: 'policy', receivedAt: '2026-11-16T12:00:00Z' },
  progress: { approved: false, current: status === 'acknowledged' ? 'HR approval' : 'selection received',
    selectionState: status === 'acknowledged' ? 'acknowledged' : status === 'refused' ? 'handoff-failed' : 'handoff-pending',
    stages: [{ name: 'selection received', state: status === 'acknowledged' ? 'complete' : status === 'refused' ? 'failed' : 'pending' },
      { name: 'HR approval', state: status === 'acknowledged' ? 'waiting' : 'not-started' }] },
  view: { state: status === 'acknowledged' ? 'awaiting-approval' : status === 'refused' ? 'handoff-failed' : 'handoff-pending',
    action: status === 'acknowledged' ? 'view-order' : status === 'refused' ? 'contact-support' : 'check-status' },
});

describe('manual final review and actual outcome composition', () => {
  let fixture: ComponentFixture<ManualSummaryComponent>;
  beforeEach(async () => { await TestBed.configureTestingModule({ imports: [ManualSummaryComponent] }).compileComponents(); fixture = TestBed.createComponent(ManualSummaryComponent);
    fixture.componentRef.setInput('projection', projection()); fixture.detectChanges(); });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  it('retains supplied terms and declarations but blocks final submit without frozen review-detail authority', () => {
    fixture.componentRef.setInput('declarations', { required: true }); fixture.detectChanges();
    expect(text()).toContain('Pinned BMW'); expect(text()).toContain('Actual supplied scheme wording.'); expect(text()).toContain('dated-terms');
    const submit = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true); expect(submit.getAttribute('aria-describedby')).toBe('manual-review-unavailable'); expect(text()).toContain('contact and return details are unavailable');
    const event = new Event('submit', { cancelable: true }); (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  });
  it('associates each native checkbox and emits only its actual declaration ID', () => {
    const changed = vi.fn(); fixture.componentInstance.declarationChange.subscribe(changed);
    const checkbox = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect((fixture.nativeElement as HTMLElement).querySelector(`label[for="${checkbox.id}"]`)?.textContent).toContain('I confirm the required declaration');
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change')); expect(changed).toHaveBeenCalledExactlyOnceWith({ id: 'required', checked: true });
    fixture.componentRef.setInput('resumeRequired', true); fixture.detectChanges(); expect(checkbox.closest('fieldset')!.disabled).toBe(true);
    checkbox.dispatchEvent(new Event('change')); expect(changed).toHaveBeenCalledOnce();
  });
  it.each(['pending', 'acknowledged', 'refused'] as const)('shows actual %s state and no repeated submit form', (status) => {
    fixture.componentRef.setInput('projection', { ...projection(), order: order(status), claim: null }); fixture.detectChanges();
    expect(text()).toContain('GCS-123'); expect(text()).toContain('1234567'); expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
    expect(text()).toContain(status === 'acknowledged' ? 'Awaiting approval' : status === 'refused' ? 'Handoff failed' : 'Handoff pending');
    expect(text()).not.toContain('Order approved'); expect((fixture.nativeElement as HTMLElement).querySelectorAll('.is-complete')).toHaveLength(status === 'acknowledged' ? 1 : 0);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('h1')).toHaveLength(1);
  });
  it('offers only a status read for a pending handoff', () => {
    fixture.componentRef.setInput('projection', { ...projection(), order: order('pending'), claim: null }); fixture.detectChanges();
    const checked = vi.fn(); fixture.componentInstance.check.subscribe(checked);
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')); expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('Check order status'); buttons[0].click(); expect(checked).toHaveBeenCalledOnce();
  });
});
