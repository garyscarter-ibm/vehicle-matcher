import { Component, computed, effect, input, output, signal } from '@angular/core';
export type SliderUnit = string | { readonly kind: 'points-monthly' | 'percent' | 'purchase-money'; readonly currency?: string };
export interface SliderQuestion { readonly id: string; readonly label?: string; readonly min: number; readonly max: number; readonly step: number; readonly default?: number; readonly unit?: SliderUnit; readonly format?: string; readonly plusAtMax?: boolean }
@Component({ selector: 'gcsp-range-slider', host: { style: 'display: contents' }, template: `
  <span class="vm-slider-value" aria-hidden="true">{{ readout() }}</span>
  <input class="vm-slider-input vm-slider-single" type="range" [min]="question().min" [max]="question().max" [step]="question().step" [value]="position()" [disabled]="disabled()" [attr.aria-label]="ariaLabel() || question().label || question().id" [attr.aria-valuetext]="readout()" (input)="slide($event)" />
  <div class="vm-slider-bounds"><span class="vm-slider-min">{{ format(question().min, 'confirmed') }}</span><span class="vm-slider-max">{{ format(question().max, 'confirmed') }}</span></div>
` })
export class RangeSliderComponent {
  readonly question = input.required<SliderQuestion>(); readonly value = input<number | null>(null);
  readonly valueState = input<'confirmed' | 'unconfirmed' | 'unknown'>('confirmed'); readonly unknownText = input('Not supplied');
  readonly unit = input<SliderUnit | undefined>(undefined); readonly disabled = input(false); readonly ariaLabel = input(''); readonly valueChange = output<number>();
  readonly position = signal(0); private readonly displayed = signal<number | null>(null);
  private readonly state = signal<'confirmed' | 'unconfirmed' | 'unknown'>('confirmed'); private initialized = false;
  readonly readout = computed(() => this.format(this.displayed(), this.state()));
  constructor() {
    effect(() => {
      const question = this.question(); const value = this.value(); const state = this.valueState();
      if (!this.initialized) { this.position.set(Number.isFinite(question.default) ? question.default! : question.min); this.initialized = true; }
      if (Number.isFinite(value) && state !== 'unknown') this.position.set(value!);
      this.displayed.set(value); this.state.set(state);
    });
  }
  format(value: number | null, state: 'confirmed' | 'unconfirmed' | 'unknown'): string {
    if (!Number.isFinite(value) || state === 'unknown') return this.unknownText();
    const q = this.question(); const unit = this.unit() ?? q.unit; const number = value!; const digits = number.toLocaleString('en-GB');
    let base: string;
    if (unit && typeof unit === 'object') {
      if (q.format === 'gbp' && unit.kind !== 'purchase-money') return 'Unit not supplied';
      if (unit.kind === 'purchase-money' && unit.currency === 'GBP') base = `£${digits}`;
      else if (unit.kind === 'points-monthly') base = `${digits} points a month`;
      else if (unit.kind === 'percent') base = `${digits}%`;
      else return 'Unit not supplied';
    } else base = q.format === 'gbp' ? `£${digits}` : `${digits}${unit || ''}`;
    const shown = q.plusAtMax && number >= q.max ? `${base}+` : base;
    return state === 'unconfirmed' ? `Not confirmed (${shown})` : shown;
  }
  slide(event: Event): void {
    if (this.disabled()) return;
    const value = Number((event.target as HTMLInputElement).value);
    this.position.set(value); this.displayed.set(value); this.state.set('confirmed'); this.valueChange.emit(value);
  }
}
