import { Component, computed, input } from '@angular/core';

export interface FactRow {
  readonly label: string;
  readonly value: string | number | boolean | null | undefined;
  readonly unit?: string;
  readonly missingLabel?: string;
}

@Component({
  selector: 'gcsp-fact-list',
  standalone: true,
  template: `
    @if (shownRows().length || !hasHiddenRows()) {
      <dl class="gcsp-facts">
        @for (row of shownRows(); track $index) {
          <div class="gcsp-fact">
            <dt>{{ row.label }}</dt>
            <dd [class.is-missing]="isMissing(row)">{{ displayValue(row) }}</dd>
          </div>
        }
      </dl>
    }
    @if (hasHiddenRows()) { <p class="gcsp-note gcsp-facts-more">{{ hideMissing() }}</p> }
  `,
  styleUrl: './fact-list.component.css',
})
export class FactListComponent {
  readonly rows = input<readonly FactRow[]>([]);
  readonly hideMissing = input('');
  readonly shownRows = computed(() => this.hideMissing() ? this.rows().filter(row => !this.isMissing(row)) : this.rows());
  readonly hasHiddenRows = computed(() => Boolean(this.hideMissing()) && this.shownRows().length < this.rows().length);

  isMissing(row: FactRow): boolean {
    return row.value === null || row.value === undefined || row.value === '';
  }

  displayValue(row: FactRow): string {
    if (this.isMissing(row)) return row.missingLabel || 'Not supplied';
    const value = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value.toLocaleString('en-GB') : String(row.value);
    return `${value}${row.unit ? ` ${row.unit}` : ''}`;
  }
}
