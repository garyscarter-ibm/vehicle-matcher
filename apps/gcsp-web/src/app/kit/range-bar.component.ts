import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';

export interface RangeBarRow { readonly label: string; readonly mean: number | null; readonly min: number | null; readonly max: number | null }
export interface RangeBarScale { readonly min: number; readonly max: number }
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
let sequence = 0;

/** Frozen read-only rangeBar port. Value text owns the meaning; the track is decorative. */
@Component({ selector: 'gcsp-range-bar', imports: [NgTemplateOutlet], styles: ':host { display: block; min-width: 0; }', template: `
  <figure class="gcsp-range-bar" [attr.aria-labelledby]="headingId()">
    <ng-template #title>{{ label() }}</ng-template>
    @switch (level()) {
      @case (1) { <h1 class="gcsp-range-bar-heading" [id]="headingId()"><ng-container [ngTemplateOutlet]="title" /></h1> }
      @case (2) { <h2 class="gcsp-range-bar-heading" [id]="headingId()"><ng-container [ngTemplateOutlet]="title" /></h2> }
      @case (4) { <h4 class="gcsp-range-bar-heading" [id]="headingId()"><ng-container [ngTemplateOutlet]="title" /></h4> }
      @case (5) { <h5 class="gcsp-range-bar-heading" [id]="headingId()"><ng-container [ngTemplateOutlet]="title" /></h5> }
      @case (6) { <h6 class="gcsp-range-bar-heading" [id]="headingId()"><ng-container [ngTemplateOutlet]="title" /></h6> }
      @default { <h3 class="gcsp-range-bar-heading" [id]="headingId()"><ng-container [ngTemplateOutlet]="title" /></h3> }
    }
    <ul class="gcsp-range-bar-rows">
      @for (row of paintedRows(); track $index) {
        <li class="gcsp-range-bar-row" [class.is-missing]="row.missing">
          <span class="gcsp-range-bar-label">{{ row.label }}</span>
          <span class="gcsp-range-bar-track" aria-hidden="true">
            @if (!row.missing) {
              @if (row.ranged) { <span class="gcsp-range-bar-span" [style.--gcsp-range-start]="row.start" [style.--gcsp-range-end]="row.end"></span> }
              <span class="gcsp-range-bar-mean" [style.--gcsp-range-mean]="row.mean"></span>
            }
          </span>
          <span class="gcsp-range-bar-value">{{ row.text }}</span>
        </li>
      }
    </ul>
  </figure>
` })
export class RangeBarComponent {
  readonly label = input(''); readonly rows = input<readonly RangeBarRow[]>([]);
  readonly scale = input<RangeBarScale>(); readonly format = input<(value: number) => string>(String);
  readonly level = input<1 | 2 | 3 | 4 | 5 | 6>(3); readonly id = input(`gcsp-range-bar-${++sequence}`);
  readonly headingId = computed(() => this.id());
  private readonly bounds = computed(() => {
    const scale = this.scale(); const values = (scale ? [scale.min, scale.max] : this.rows().flatMap(row => [row.min, row.max])).filter(finite);
    if (!values.length) return { min: 0, max: 1 };
    const min = Math.min(...values); const max = Math.max(...values);
    return min === max ? { min: min - 1, max: max + 1 } : { min, max };
  });
  readonly paintedRows = computed(() => this.rows().map(row => {
    const ranged = finite(row.min) && finite(row.max); const missing = !finite(row.mean); const format = this.format();
    return { label: row.label, ranged, missing, start: this.percent(row.min), end: this.percent(row.max), mean: this.percent(row.mean),
      text: missing ? 'Not observed' : ranged && row.min !== row.max ? `${format(row.mean!)} (${format(row.min!)} to ${format(row.max!)})` : String(format(row.mean!)) };
  }));
  private percent(value: number | null): string {
    if (!finite(value)) return '0%';
    const { min, max } = this.bounds();
    return `${Math.round(Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) * 100) / 100}%`;
  }
}
