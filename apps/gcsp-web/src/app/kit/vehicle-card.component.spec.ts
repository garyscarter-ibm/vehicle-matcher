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
  it('retains the frozen exact-stock card hierarchy consumed by the source stylesheet', async () => {
    const { fixture, root } = await card();
    const article = root.querySelector('article')!;
    expect(article.className).toBe('vm-card vm-card-explicit gcsp-card');
    expect(article.tabIndex).toBe(-1);
    expect(Array.from(article.children).map(child => child.className)).toEqual(['vm-card-media', 'vm-card-body']);
    const body = article.querySelector('.vm-card-body')!;
    expect(Array.from(body.children).map(child => child.className)).toEqual([
      'vm-card-head', 'gcsp-note', 'vm-card-terms', 'vm-card-facts', 'vm-card-decision', 'vm-pick', 'vm-card-actions',
    ]);
    expect(body.querySelector('h3.vm-card-name')?.textContent).toBe('BMW 320i Touring');
    expect(body.querySelector<HTMLElement>('.vm-score')?.hidden).toBe(true);
    expect(body.querySelector<HTMLDetailsElement>('.vm-card-facts > details.gcsp-gallery-fact-section')?.open).toBe(false);
    expect(body.querySelector('.vm-card-facts summary')?.textContent).toBe('Car facts');
    expect(body.querySelector<HTMLElement>('.vm-pick')?.hidden).toBe(true);
    expect(body.querySelector('.vm-pick')?.getAttribute('aria-label')).toBe('Exact cars');
    expect(body.querySelector('.vm-card-actions button')?.classList.contains('vm-btn-primary')).toBe(true);
    fixture.destroy();
  });
  it.each([
    ['Eligible', 'eligible'], ['Not eligible', 'ineligible'], ['Needs confirmation', 'needs-confirmation'], ['', 'unknown'],
  ])('shows the supplied %s eligibility in the source gate tag without changing action authority', async (label, gate) => {
    const { fixture, root } = await card();
    fixture.componentRef.setInput('eligibility', label);
    fixture.componentRef.setInput('reviewDisabled', false); fixture.detectChanges();
    expect(root.querySelector('article')?.getAttribute('data-gate')).toBe(gate);
    expect(root.querySelector('.vm-card-decision > .vm-card-gate')?.textContent).toBe(label || 'Decision not supplied');
    expect(root.querySelector<HTMLButtonElement>('.vm-card-actions button')?.disabled).toBe(false);
    fixture.destroy();
  });
  it('uses the source cost hierarchy with exact zero and over-allowance states', async () => {
    const { fixture, root } = await card();
    fixture.componentRef.setInput('points', 0); fixture.componentRef.setInput('allowance', 0); fixture.detectChanges();
    expect(root.querySelector('.vm-card-terms .gcsp-points-n')?.textContent).toBe('0');
    expect(root.querySelector('.vm-card-terms .gcsp-points-unit')?.textContent).toBe(' points a month');
    expect(root.querySelector('.vm-card-terms .gcsp-status.is-ok')?.textContent).toBe('Within your allowance, 0 points left');
    fixture.componentRef.setInput('points', 1000); fixture.detectChanges();
    expect(root.querySelector('.vm-card-terms .gcsp-status.is-over')?.textContent).toBe('1,000 points over your allowance');
    fixture.destroy();
  });
  it('uses one source primary media well and preserves identity when that image fails', async () => {
    const { fixture, root } = await card();
    fixture.componentRef.setInput('line', 'Touring');
    fixture.componentRef.setInput('images', [{ src: '/assets/brand-hero/bmw.jpg', alt: 'Exact blue car', caption: 'Front view' },
      { src: '/assets/brand-hero/bmw.jpg', alt: 'Second supplied view' }]); fixture.detectChanges();
    const image = root.querySelector<HTMLImageElement>('.vm-card-media > img.vm-card-photo')!;
    expect(image).not.toBeNull(); expect(root.querySelectorAll('.vm-card-media img')).toHaveLength(1);
    expect(image.alt).toBe('Exact blue car'); expect(image.getAttribute('loading')).toBe('lazy');
    expect(root.querySelector('.vm-card-line')?.textContent).toBe('Touring');
    expect(root.querySelector('.vm-media-caption')?.textContent).toBe('Front view');
    image.dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(root.querySelector('.vm-card-photo')).toBeNull(); expect(root.querySelector('.vm-media-caption')).toBeNull();
    expect(root.querySelector('.vm-card-soon')?.textContent).toBe('No image for this car yet');
    expect(root.querySelector('article')?.getAttribute('data-member-id')).toBe('exact-stock-2'); fixture.destroy();
  });
  it('presents caller identity, absent media and missing cost without inventing values', async () => {
    const { fixture, root } = await card();
    expect(root.querySelector('article')?.getAttribute('data-member-id')).toBe('exact-stock-2');
    expect(root.textContent).toContain('Order no. 0000002'); expect(root.textContent).toContain('No image for this car yet');
    expect(root.textContent).toContain('Monthly points not supplied'); expect(root.textContent).toContain('Allowance not supplied');
    expect(root.querySelector<HTMLButtonElement>('.vm-card-actions button')?.disabled).toBe(true);
    expect(root.querySelector('details')?.open).toBe(false); fixture.destroy();
  });
  it('keeps real zero, allowance and contribution and emits the exact member only on action', async () => {
    const { fixture, root } = await card(); const events: VehicleCardAction[] = [];
    fixture.componentInstance.action.subscribe(event => events.push(event));
    fixture.componentRef.setInput('points', 0); fixture.componentRef.setInput('allowance', 1000);
    fixture.componentRef.setInput('contribution', { amount: 0, currency: 'GBP', period: 'month' });
    fixture.componentRef.setInput('reviewDisabled', false); fixture.detectChanges();
    expect(events).toEqual([]); expect(root.textContent).toContain('1,000 points left'); expect(root.textContent).toContain('Contribution: 0 GBP/month');
    root.querySelector<HTMLButtonElement>('.vm-card-actions button')!.click(); root.querySelector<HTMLButtonElement>('[data-details-id]')!.click();
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
    expect(root.querySelectorAll('.vm-card-facts details .vm-facts > .vm-fact')).toHaveLength(3);
    expect(root.querySelector('.vm-card-facts .vm-facts-more')?.textContent).toBe('More details not supplied');
    expect(root.textContent).toContain('<img src=x>'); expect(root.querySelector('details img')).toBeNull(); fixture.destroy();
  });
  it('associates each disabled source action with its own supplied reason', async () => {
    const first = await card(); const second = await card();
    for (const { fixture } of [first, second]) {
      fixture.componentRef.setInput('disabledReason', 'Confirm this exact car.'); fixture.detectChanges();
    }
    const firstControl = first.root.querySelector<HTMLButtonElement>('.vm-card-actions [data-action-id="review-car"]')!;
    const secondControl = second.root.querySelector<HTMLButtonElement>('.vm-card-actions [data-action-id="review-car"]')!;
    expect(firstControl).not.toBeNull(); expect(secondControl).not.toBeNull();
    const firstReason = firstControl.getAttribute('aria-describedby')!;
    const secondReason = secondControl.getAttribute('aria-describedby')!;
    expect(firstReason).not.toBe(secondReason);
    expect(first.root.querySelector(`#${firstReason}`)?.classList.contains('vm-feedback-scope')).toBe(true);
    expect(first.root.querySelector(`#${firstReason}`)?.textContent).toBe('Confirm this exact car.');
    expect(firstControl.disabled).toBe(true); first.fixture.destroy(); second.fixture.destroy();
  });
});
