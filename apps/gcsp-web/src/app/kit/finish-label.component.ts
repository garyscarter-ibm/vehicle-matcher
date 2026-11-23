import { Component, computed, input } from '@angular/core';
import { finishShade, NEUTRAL_SWATCH, SWATCH_HEX } from './finish-shades';

/** Readable source finish copy with a purely decorative, broadly mapped swatch. */
@Component({ selector: 'gcsp-finish-label', host: { style: 'display: contents' }, template: `
  <p class="gcsp-finish">
    <span class="gcsp-finish-swatch" aria-hidden="true" [class.is-unknown]="!colour()" [style.backgroundColor]="colour() || neutral"></span>
    <span [class.gcsp-finish-copy]="labelled()">
      @if (labelled()) { <span class="gcsp-finish-label">{{ label() }}</span> }
      <span class="gcsp-finish-value">{{ value() || label() + ' not supplied' }}</span>
    </span>
  </p>
` })
export class FinishLabelComponent {
  readonly label = input.required<string>();
  readonly value = input<string | null>(null);
  readonly shade = input<unknown>(null);
  readonly labelled = input(false);
  readonly neutral = NEUTRAL_SWATCH;
  readonly colour = computed(() => SWATCH_HEX[finishShade({ label: this.label(), value: this.value(), shade: this.shade() }) ?? ''] ?? null);
}
