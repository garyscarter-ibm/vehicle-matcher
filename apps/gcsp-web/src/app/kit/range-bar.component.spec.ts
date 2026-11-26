import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RangeBarComponent, RangeBarRow } from './range-bar.component';

describe('frozen read-only range bar', () => {
  let fixture: ComponentFixture<RangeBarComponent>;
  beforeEach(() => { fixture = TestBed.createComponent(RangeBarComponent); });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });
  function render(rows: readonly RangeBarRow[], scale?: { min: number; max: number }) {
    fixture.componentRef.setInput('label', 'Mean and range across seeds'); fixture.componentRef.setInput('rows', rows);
    if (scale) fixture.componentRef.setInput('scale', scale); fixture.detectChanges(); return fixture.nativeElement as HTMLElement;
  }
  const row = (label: string, mean: number | null, min = mean, max = mean): RangeBarRow => ({ label, mean, min, max });
  it('labels its figure, escapes labels, and paints both routes on the same inferred scale', () => {
    const root = render([row('<script>bad</script>', 4, 2, 6), row('Buddy', 8, 4, 10)]);
    const figure = root.querySelector('figure')!; expect(root.querySelector('#' + figure.getAttribute('aria-labelledby'))?.textContent).toBe('Mean and range across seeds');
    expect(root.querySelector('script')).toBeNull(); expect(root.textContent).toContain('<script>bad</script>');
    const spans = root.querySelectorAll<HTMLElement>('.gcsp-range-bar-span'); const means = root.querySelectorAll<HTMLElement>('.gcsp-range-bar-mean');
    expect(spans[0].style.getPropertyValue('--gcsp-range-start')).toBe('0%'); expect(spans[0].style.getPropertyValue('--gcsp-range-end')).toBe('50%'); expect(means[0].style.getPropertyValue('--gcsp-range-mean')).toBe('25%');
    expect(means[1].style.getPropertyValue('--gcsp-range-mean')).toBe('75%'); expect(root.textContent).toContain('4 (2 to 6)');
    expect(Array.from(root.querySelectorAll('.gcsp-range-bar-track')).every(track => track.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(root.querySelector('[role=slider]')).toBeNull();
  });
  it('widens a flat scale, rounds and clamps positions, and omits a redundant flat text range', () => {
    let root = render([row('Flat', 4)]); expect(root.querySelector<HTMLElement>('.gcsp-range-bar-mean')!.style.getPropertyValue('--gcsp-range-mean')).toBe('50%'); expect(root.querySelector('.gcsp-range-bar-value')!.textContent).toBe('4');
    root = render([row('Outside', 1, -2, 6)], { min: 0, max: 3 }); expect(root.querySelector<HTMLElement>('.gcsp-range-bar-span')!.style.getPropertyValue('--gcsp-range-start')).toBe('0%'); expect(root.querySelector<HTMLElement>('.gcsp-range-bar-span')!.style.getPropertyValue('--gcsp-range-end')).toBe('100%'); expect(root.querySelector<HTMLElement>('.gcsp-range-bar-mean')!.style.getPropertyValue('--gcsp-range-mean')).toBe('33.33%');
  });
  it('handles empty, missing and non-finite observations without invalid CSS or lost exact text', () => {
    const root = render([row('Missing', null), row('Not finite', Infinity), row('No bounds', 2, NaN, Infinity)]);
    expect(root.querySelectorAll('.is-missing')).toHaveLength(2); expect(root.querySelectorAll('.gcsp-range-bar-mean')).toHaveLength(1); expect(root.querySelectorAll('.gcsp-range-bar-span')).toHaveLength(0); expect(root.textContent).toContain('Not observed'); expect(root.querySelector<HTMLElement>('.gcsp-range-bar-mean')!.style.getPropertyValue('--gcsp-range-mean')).toBe('100%');
    fixture.componentRef.setInput('rows', []); fixture.detectChanges(); expect(root.querySelectorAll('.gcsp-range-bar-row')).toHaveLength(0);
  });
  it('uses the supplied scale and formatter without changing the observations', () => {
    const rows = [row('Coverage', 0.5, 0.4, 0.6)]; fixture.componentRef.setInput('format', (value: number) => `${value * 100}%`);
    const root = render(rows, { min: 0, max: 1 }); expect(root.textContent).toContain('50% (40% to 60%)'); expect(rows).toEqual([row('Coverage', 0.5, 0.4, 0.6)]);
  });
});
