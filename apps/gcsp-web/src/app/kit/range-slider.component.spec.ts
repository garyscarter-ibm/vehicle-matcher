import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { RangeSliderComponent } from './range-slider.component';

describe('source single range slider', () => {
  async function mount(value: number | null = 4) {
    await TestBed.configureTestingModule({ imports: [RangeSliderComponent] }).compileComponents();
    const fixture = TestBed.createComponent(RangeSliderComponent);
    fixture.componentRef.setInput('question', { id: 'limit', label: '320i maximum', min: 0, max: 10, step: 1, unit: ' vehicles' });
    fixture.componentRef.setInput('value', value);
    const changed = vi.fn(); fixture.componentInstance.valueChange.subscribe(changed); fixture.detectChanges();
    return { fixture, changed, root: fixture.nativeElement as HTMLElement, input: fixture.nativeElement.querySelector('input') as HTMLInputElement };
  }
  it('retains source siblings, classes, bounds and accessible value without emitting on mount', async () => {
    const { root, input, changed } = await mount();
    expect(Array.from(root.children).map(node => node.className)).toEqual(['vm-slider-value', 'vm-slider-input vm-slider-single', 'vm-slider-bounds']);
    expect(root.querySelector('.vm-slider-value')?.getAttribute('aria-hidden')).toBe('true');
    expect(input.type).toBe('range'); expect([input.min, input.max, input.step, input.value]).toEqual(['0', '10', '1', '4']);
    expect(input.getAttribute('aria-label')).toBe('320i maximum'); expect(input.getAttribute('aria-valuetext')).toBe('4 vehicles');
    expect(root.querySelector('.vm-slider-bounds')?.textContent).toBe('0 vehicles10 vehicles'); expect(changed).not.toHaveBeenCalled();
  });
  it('locally displays native input and emits only intentional scalar changes', async () => {
    const { fixture, root, input, changed } = await mount(); input.value = '7'; input.dispatchEvent(new Event('input')); fixture.detectChanges();
    expect(changed).toHaveBeenCalledExactlyOnceWith(7); expect(root.querySelector('.vm-slider-value')?.textContent).toBe('7 vehicles');
    expect(input.getAttribute('aria-valuetext')).toBe('7 vehicles');
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges(); input.value = '8'; input.dispatchEvent(new Event('input'));
    expect(input.disabled).toBe(true); expect(changed).toHaveBeenCalledTimes(1);
  });
  it('projects unknown without moving the thumb, and restores a confirmed zero silently', async () => {
    const { fixture, root, input, changed } = await mount(); fixture.componentRef.setInput('value', null); fixture.detectChanges();
    expect(input.value).toBe('4'); expect(input.getAttribute('aria-valuetext')).toBe('Not supplied');
    fixture.componentRef.setInput('value', 0); fixture.detectChanges(); expect(input.value).toBe('0');
    expect(root.querySelector('.vm-slider-value')?.textContent).toBe('0 vehicles'); expect(changed).not.toHaveBeenCalled();
  });
  it('uses the source default position for an initially unknown value and preserves format states', async () => {
    const { fixture, input } = await mount(null); expect(input.value).toBe('0');
    fixture.componentRef.setInput('question', { id: 'budget', min: 0, max: 1000, step: 1, format: 'gbp', plusAtMax: true });
    fixture.componentRef.setInput('value', 1000); fixture.componentRef.setInput('valueState', 'unconfirmed'); fixture.detectChanges();
    expect(input.getAttribute('aria-valuetext')).toBe('Not confirmed (£1,000+)');
    fixture.componentRef.setInput('unit', { kind: 'points-monthly' }); fixture.detectChanges(); expect(input.getAttribute('aria-valuetext')).toBe('Unit not supplied');
  });
});
