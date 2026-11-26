import { Component, computed, input } from '@angular/core';
import { DataTableValue, readValue } from './data-table.component';

/** Frozen metricTile DOM and privacy-value semantics, using the shared source stylesheet. */
@Component({ selector: 'gcsp-metric-tile', template: `
  <div [class]="tileClass()" [attr.data-band]="figure().isBand ? 'true' : null">
    <p class="gcsp-tile-label">{{ label() }}</p>
    <p class="gcsp-tile-figure" [class.is-band]="figure().isBand" [class.is-missing]="figure().missing" [attr.data-band]="figure().isBand ? 'true' : null">@if (figure().isBand && figure().fewerThan !== null) {<span aria-hidden="true">{{ '<' + figure().fewerThan }}</span><span class="gcsp-vh">{{ figure().label }}</span>} @else {{{ figure().label }}}</p>
    @if (note()) {<p class="gcsp-tile-note">{{ note() }}</p>}
  </div>
` })
export class MetricTileComponent {
  readonly label = input('');
  readonly value = input<DataTableValue>(undefined);
  readonly size = input<'headline' | 'standard' | 'compact'>('standard');
  readonly note = input<string | undefined>(undefined);
  readonly figure = computed(() => readValue(this.value()));
  readonly tileClass = computed(() => this.size() === 'headline' ? 'gcsp-tile gcsp-tile-headline'
    : this.size() === 'compact' ? 'gcsp-tile gcsp-tile-compact' : 'gcsp-tile gcsp-tile-standard');
}
