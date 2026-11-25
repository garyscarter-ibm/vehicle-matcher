import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UnderstandingMeterComponent } from './understanding-meter.component';
describe('source understanding meter', () => {
  it('renders server input completeness as n/max equal segments and keeps geometry while unsaved', async () => {
    const fixture = TestBed.createComponent(UnderstandingMeterComponent); fixture.componentRef.setInput('id', 'meter'); fixture.componentRef.setInput('value', 3); fixture.componentRef.setInput('maximum', 11); await fixture.whenStable(); const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.gcsp-understanding-value')?.textContent).toBe('3 / 11'); expect(root.querySelectorAll('i')).toHaveLength(11); expect(root.querySelectorAll('i.is-filled')).toHaveLength(3);
    const segments = Array.from(root.querySelectorAll('i')); fixture.componentRef.setInput('pending', true); await fixture.whenStable(); expect(root.querySelector('strong')?.getAttribute('aria-label')).toBe('Buddy understanding 3 out of 11 (saving)');
    fixture.componentRef.setInput('failed', true); await fixture.whenStable(); expect(root.querySelector('strong')?.getAttribute('aria-label')).toBe('Buddy understanding 3 out of 11 (not saved)'); expect(Array.from(root.querySelectorAll('i'))).toEqual(segments);
    fixture.componentRef.setInput('pending', false); await fixture.whenStable(); expect(root.querySelector('strong')?.getAttribute('aria-label')).toBe('Buddy understanding 3 out of 11');
  });
  it('clamps and rounds presentation values using the source bounds', async () => {
    const fixture = TestBed.createComponent(UnderstandingMeterComponent); fixture.componentRef.setInput('id', 'clamp'); fixture.componentRef.setInput('value', 200); fixture.componentRef.setInput('maximum', 100); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('strong').textContent).toBe('99 / 99');
    fixture.componentRef.setInput('value', Number.NaN); fixture.componentRef.setInput('maximum', 0); await fixture.whenStable(); expect(fixture.nativeElement.querySelector('strong').textContent).toBe('0 / 1');
    fixture.componentRef.setInput('value', 2.6); fixture.componentRef.setInput('maximum', 10.6); await fixture.whenStable(); expect(fixture.nativeElement.querySelector('strong').textContent).toBe('3 / 11');
  });
});
