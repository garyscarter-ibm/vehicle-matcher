import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ButtonDirective } from './button.directive';

@Component({
  imports: [ButtonDirective],
  template: `<button gcspButton [presentation]="presentation()" [variant]="variant()" type="button" disabled aria-describedby="reason">Continue</button>
    <a gcspButton [presentation]="presentation()" variant="ghost" href="/gcsp/orders">Order progress</a>`,
})
class ButtonHarness {
  readonly presentation = input<'legacy' | 'source'>('legacy');
  readonly variant = input<'primary' | 'ghost'>('primary');
}

describe('ButtonDirective presentation contract', () => {
  it('preserves the existing default classes and native control attributes', async () => {
    const fixture = TestBed.createComponent(ButtonHarness);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('button')?.className).toBe('gcsp-button');
    expect(root.querySelector('a')?.className).toBe('gcsp-button gcsp-button-ghost');
    expect(root.querySelector('button')?.disabled).toBe(true);
    expect(root.querySelector('button')?.getAttribute('aria-describedby')).toBe('reason');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/gcsp/orders');
  });

  it('uses the exact frozen source classes only when requested, including later variant changes', async () => {
    const fixture = TestBed.createComponent(ButtonHarness);
    fixture.componentRef.setInput('presentation', 'source');
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('button')?.className).toBe('vm-btn vm-btn-primary');
    expect(root.querySelector('a')?.className).toBe('vm-btn vm-btn-ghost');
    fixture.componentRef.setInput('variant', 'ghost');
    await fixture.whenStable();
    expect(root.querySelector('button')?.className).toBe('vm-btn vm-btn-ghost');
    expect(root.querySelector('button')?.disabled).toBe(true);
    expect(root.querySelector('button')?.textContent).toBe('Continue');
    fixture.componentRef.setInput('presentation', 'legacy');
    await fixture.whenStable();
    expect(root.querySelector('button')?.className).toBe('gcsp-button gcsp-button-ghost');
    expect(root.querySelector('a')?.className).toBe('gcsp-button gcsp-button-ghost');
  });
});
