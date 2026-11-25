import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CountBarsComponent } from './count-bars.component';

afterEach(() => TestBed.resetTestingModule());
describe('source countBars port', () => {
  it('keeps source figure semantics and folds the remaining positive counts into Other', async () => {
    const fixture = TestBed.createComponent(CountBarsComponent);
    fixture.componentRef.setInput('label', 'Colour');
    fixture.componentRef.setInput('rows', [{ label: 'Blue', count: 8 }, { label: 'Red', count: 4 }, { label: 'White', count: 2 }, { label: 'Empty', count: 0 }]);
    fixture.componentRef.setInput('limit', 2); await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const figure = root.querySelector('figure')!;
    expect(figure.getAttribute('aria-labelledby')).toBe(root.querySelector('h3')!.id);
    expect(Array.from(root.querySelectorAll('.gcsp-count-bars-row')).map(row => row.textContent)).toEqual(['Blue8', 'Other6']);
    expect(root.querySelector<HTMLElement>('.gcsp-count-bars-bar span')!.style.getPropertyValue('--gcsp-count-share')).toBe('100%');
    fixture.componentRef.setInput('rows', []); await fixture.whenStable();
    expect(root.querySelector('.gcsp-count-bars-empty')?.textContent).toBe('None');
  });
});
