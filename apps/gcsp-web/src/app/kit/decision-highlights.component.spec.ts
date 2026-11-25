import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { DecisionHighlightsComponent } from './decision-highlights.component';

describe('source decision highlights', () => {
  it('retains all supplied benefits and tradeoffs with their number emphasis and detail', async () => {
    const benefits = Object.freeze([
      Object.freeze({ number: 300, title: 'fewer points', detail: 'Every month, compared with your current car' }),
      Object.freeze({ number: 0, title: 'extra payment', detail: 'A supplied zero remains visible' }),
      Object.freeze({ title: 'A third benefit' }), Object.freeze({ title: 'A fourth benefit' }),
      Object.freeze({ title: 'A fifth benefit' }),
    ]);
    const fixture = TestBed.createComponent(DecisionHighlightsComponent);
    fixture.componentRef.setInput('benefits', benefits);
    fixture.componentRef.setInput('tradeoffs', [{ number: '30', title: 'litres less', detail: 'Boot space compared with your current car' }]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(Array.from(root.querySelectorAll('h3'), node => node.textContent)).toEqual(['Benefits', 'Tradeoffs']);
    expect(root.querySelectorAll('.gcsp-highlight-benefits .gcsp-highlight')).toHaveLength(5);
    expect(Array.from(root.querySelectorAll('.gcsp-highlight-number'), node => node.textContent)).toEqual(['300', '0', '30']);
    expect(root.querySelector('.gcsp-highlight-heading')?.textContent).toBe('300 fewer points');
    expect(root.querySelector('.gcsp-highlight-detail')?.textContent).toBe('Every month, compared with your current car');
    expect(root.querySelector('.gcsp-highlight-tradeoffs .gcsp-highlight-heading')?.textContent).toBe('30 litres less');
    expect(benefits).toHaveLength(5);
  });

  it('keeps each empty group visible without a fabricated highlight card', async () => {
    const fixture = TestBed.createComponent(DecisionHighlightsComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.gcsp-highlight-benefits .gcsp-highlight-empty')?.textContent).toBe('No benefits confirmed.');
    expect(root.querySelector('.gcsp-highlight-tradeoffs .gcsp-highlight-empty')?.textContent).toBe('No tradeoffs confirmed.');
    expect(root.querySelectorAll('.gcsp-highlight')).toHaveLength(0);
  });

  it('changes the source layout variant without truncating or changing the supplied entries', async () => {
    const fixture = TestBed.createComponent(DecisionHighlightsComponent);
    fixture.componentRef.setInput('benefits', [{ title: 'All supplied copy remains here' }]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.gcsp-decision-highlights.gcsp-decision-lists')).toBeNull();
    fixture.componentRef.setInput('layout', 'list'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.gcsp-decision-highlights.gcsp-decision-lists')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.gcsp-highlight-heading')?.textContent).toBe('All supplied copy remains here');
    expect(fixture.nativeElement.querySelector('.gcsp-highlight-detail')).toBeNull();
  });
});
