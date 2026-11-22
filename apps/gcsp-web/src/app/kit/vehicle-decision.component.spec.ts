import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { VehicleDecisionComponent } from './vehicle-decision.component';

@Component({ imports: [VehicleDecisionComponent], template: `
  <gcsp-vehicle-decision name="BMW iX1" kicker="Your buddy found a car for you" layout="focused"
    [finishes]="finishes" [points]="1100" [allowance]="1300" pointsDifference="300 fewer than your current car">
    <div decisionDeadline class="gcsp-decision-deadline">Held until 14:30</div>
    <div decisionActions class="gcsp-offer-actions"><button type="button">Review &amp; accept</button></div>
    <p decisionNote class="gcsp-note">Read the supplied decision facts</p>
    <div decisionMedia class="gcsp-media-gallery">Supplied media</div>
    <dl decisionOverview class="vm-facts vm-facts-pair gcsp-vehicle-overview"><dt>Boot</dt><dd>490 litres</dd></dl>
    <div decisionDetails><p>Every supplied specification</p><p>A supplied blocker</p><p>All 57 equipment items</p></div>
  </gcsp-vehicle-decision>
` })
class DecisionHost {
  readonly finishes = Object.freeze([Object.freeze({ label: 'Paint', value: 'Portimao Blue metallic' }),
    Object.freeze({ label: 'Upholstery', value: 'Black with blue stitching Vernasca leather' })]);
}

describe('source vehicle decision layout shell', () => {
  it('keeps the focused summary and actions before media and all supplied details in reading order', async () => {
    const fixture = TestBed.createComponent(DecisionHost); await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const article = root.querySelector('article.vm-card.vm-card-explicit.gcsp-vehicle-decision.gcsp-vehicle-focused')!;
    expect(article).not.toBeNull();
    expect(Array.from(article.children, node => node.className)).toEqual([
      'gcsp-vehicle-summary gcsp-vehicle-copy', 'gcsp-media-gallery', 'gcsp-vehicle-details',
    ]);
    expect(article.querySelector('.gcsp-vehicle-heading .gcsp-vehicle-context')?.textContent).toBe('Your buddy found a car for you');
    expect(article.querySelector('.vm-card-head h2.gcsp-vehicle-title')?.textContent).toBe('BMW iX1');
    expect(article.querySelector('.gcsp-points')?.textContent).toBe('1,100 points a month');
    expect(article.querySelector('.vm-card-terms .vm-specs')?.textContent).toBe('1,300 points a month allowance');
    expect(article.querySelector('.gcsp-vehicle-saving')?.textContent).toBe('300 fewer than your current car');
    expect(Array.from(article.querySelector('.gcsp-vehicle-summary')!.children).slice(-3).map(node => node.textContent)).toEqual([
      'Held until 14:30', 'Review & accept', 'Read the supplied decision facts',
    ]);
    const details = article.querySelector('.gcsp-vehicle-details')!;
    expect(details.querySelector('.gcsp-vehicle-details-title')?.textContent).toBe('Vehicle details');
    expect(details.querySelector('.gcsp-vehicle-overview')?.textContent).toBe('Boot490 litres');
    expect(details.textContent).toContain('Every supplied specification');
    expect(details.textContent).toContain('A supplied blocker');
    expect(details.textContent).toContain('All 57 equipment items');
  });

  it('labels focused finishes while retaining default finish copy in the details', async () => {
    const fixture = TestBed.createComponent(DecisionHost); await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(Array.from(root.querySelectorAll('.gcsp-vehicle-summary .gcsp-finish-label'), node => node.textContent)).toEqual(['Paint', 'Upholstery']);
    expect(root.querySelectorAll('.gcsp-vehicle-details .gcsp-finish-label')).toHaveLength(0);
    expect(Array.from(root.querySelectorAll('.gcsp-vehicle-details .gcsp-finish-value'), node => node.textContent)).toEqual([
      'Portimao Blue metallic', 'Black with blue stitching Vernasca leather',
    ]);
    expect(fixture.componentInstance.finishes).toEqual([
      { label: 'Paint', value: 'Portimao Blue metallic' }, { label: 'Upholstery', value: 'Black with blue stitching Vernasca leather' },
    ]);
  });

  it('preserves zero cost and allowance without inventing a saving or contribution', async () => {
    const fixture = TestBed.createComponent(VehicleDecisionComponent);
    fixture.componentRef.setInput('name', 'Supplied zero-point car');
    fixture.componentRef.setInput('points', 0); fixture.componentRef.setInput('allowance', 0);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.gcsp-points-n')?.textContent).toBe('0');
    expect(root.querySelector('.vm-card-terms .vm-specs')?.textContent).toBe('0 points a month allowance');
    expect(root.querySelector('.gcsp-vehicle-saving')).toBeNull();
    expect(root.querySelector('.gcsp-vehicle-contribution')).toBeNull();
    expect(root.querySelector('.gcsp-vehicle-focused')).toBeNull();
    expect(root.querySelector('.gcsp-vehicle-summary > .vm-card-head h2')?.textContent).toBe('Supplied zero-point car');
  });

  it('retains source missing-cost wording and any supplied allowance or contribution', async () => {
    const fixture = TestBed.createComponent(VehicleDecisionComponent);
    fixture.componentRef.setInput('allowance', 1300);
    fixture.componentRef.setInput('contribution', '£0 one-off');
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.vm-card-name')?.textContent).toBe('Car name not supplied');
    expect(root.querySelector('.gcsp-points')).toBeNull();
    expect(root.querySelector('.vm-card-terms .vm-specs')?.textContent).toBe('Monthly points cost not supplied · 1,300 points a month allowance');
    expect(root.querySelector('.gcsp-vehicle-contribution')?.textContent).toBe('£0 one-off');
    fixture.componentRef.setInput('allowance', null); await fixture.whenStable();
    expect(root.querySelector('.vm-card-terms .vm-specs')?.textContent).toBe('Monthly points cost not supplied · monthly points allowance not supplied');
  });
});
