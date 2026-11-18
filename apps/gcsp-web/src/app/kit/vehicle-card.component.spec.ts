import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { VehicleCardAction, VehicleCardComponent } from './vehicle-card.component';

async function card() {
  const fixture = TestBed.createComponent(VehicleCardComponent);
  fixture.componentRef.setInput('memberId', 'exact-stock-2'); fixture.componentRef.setInput('name', 'BMW 320i Touring');
  fixture.componentRef.setInput('orderNumber', '0000002'); await fixture.whenStable(); fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe('VehicleCardComponent', () => {
  it('presents caller identity, absent media and missing cost without inventing values', async () => {
    const { fixture, root } = await card();
    expect(root.querySelector('article')?.getAttribute('data-member-id')).toBe('exact-stock-2');
    expect(root.textContent).toContain('Order no. 0000002'); expect(root.textContent).toContain('No image for this car yet');
    expect(root.textContent).toContain('Monthly points not supplied'); expect(root.textContent).toContain('Allowance not supplied');
    expect(root.querySelector<HTMLButtonElement>('.gcsp-actions button')?.disabled).toBe(true);
    expect(root.querySelector('details')?.open).toBe(false); fixture.destroy();
  });
  it('keeps real zero, allowance and contribution and emits the exact member only on action', async () => {
    const { fixture, root } = await card(); const events: VehicleCardAction[] = [];
    fixture.componentInstance.action.subscribe(event => events.push(event));
    fixture.componentRef.setInput('points', 0); fixture.componentRef.setInput('allowance', 1000);
    fixture.componentRef.setInput('contribution', { amount: 0, currency: 'GBP', period: 'month' });
    fixture.componentRef.setInput('reviewDisabled', false); fixture.detectChanges();
    expect(events).toEqual([]); expect(root.textContent).toContain('1,000 points left'); expect(root.textContent).toContain('Contribution: 0 GBP/month');
    root.querySelector<HTMLButtonElement>('.gcsp-actions button')!.click(); root.querySelector<HTMLButtonElement>('[data-details-id]')!.click();
    expect(events).toEqual([{ memberId: 'exact-stock-2', action: 'review' }, { memberId: 'exact-stock-2', action: 'details' }]); fixture.destroy();
  });
  it('honours supplied eligibility and review-disabled authority even through direct activation', async () => {
    const { fixture, root } = await card(); const events: VehicleCardAction[] = [];
    fixture.componentInstance.action.subscribe(event => events.push(event));
    fixture.componentRef.setInput('eligibility', 'Needs confirmation'); fixture.componentRef.setInput('disabledReason', 'Confirm the missing information.');
    fixture.componentRef.setInput('points', 1500); fixture.componentRef.setInput('allowance', 1000); fixture.detectChanges();
    expect(root.textContent).toContain('500 points over your allowance'); expect(root.textContent).toContain('Needs confirmation');
    expect(root.textContent).toContain('Confirm the missing information.'); fixture.componentInstance.activate('review');
    fixture.componentInstance.activate('details'); expect(events).toEqual([{ memberId: 'exact-stock-2', action: 'details' }]); fixture.destroy();
  });
  it('uses shared facts with false/zero and missing summary and renders supplied text as text', async () => {
    const { fixture, root } = await card();
    fixture.componentRef.setInput('facts', [{ label: 'CO2', value: 0, unit: 'g/km' }, { label: 'Test', value: false },
      { label: 'Missing', value: null }, { label: 'Source text', value: '<img src=x>' }]); fixture.detectChanges();
    expect(root.textContent).toContain('0 g/km'); expect(root.textContent).toContain('false'); expect(root.textContent).toContain('More details not supplied');
    expect(root.textContent).toContain('<img src=x>'); expect(root.querySelector('details img')).toBeNull(); fixture.destroy();
  });
});
