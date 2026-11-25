import { Component, computed, input } from '@angular/core';

export interface CountBarRow { readonly label: string; readonly count: number }
let sequence = 0;
@Component({ selector: 'gcsp-count-bars', host: { style: 'display: contents' }, template: `
  <figure class="gcsp-count-bars" [attr.aria-labelledby]="id()">
    @switch (level()) {
      @case (1) { <h1 class="gcsp-count-bars-heading" [id]="id()">{{ label() }}</h1> }
      @case (2) { <h2 class="gcsp-count-bars-heading" [id]="id()">{{ label() }}</h2> }
      @case (4) { <h4 class="gcsp-count-bars-heading" [id]="id()">{{ label() }}</h4> }
      @case (5) { <h5 class="gcsp-count-bars-heading" [id]="id()">{{ label() }}</h5> }
      @case (6) { <h6 class="gcsp-count-bars-heading" [id]="id()">{{ label() }}</h6> }
      @default { <h3 class="gcsp-count-bars-heading" [id]="id()">{{ label() }}</h3> }
    }
    <ul class="gcsp-count-bars-rows">@for (row of shown(); track $index) {
      <li class="gcsp-count-bars-row"><span class="gcsp-count-bars-label" [title]="row.label">{{ row.label }}</span><span class="gcsp-count-bars-bar" aria-hidden="true"><span [style.--gcsp-count-share]="share(row.count)"></span></span><span class="gcsp-count-bars-n">{{ row.count }}</span></li>
    } @empty { <li class="gcsp-count-bars-empty">None</li> }</ul>
  </figure>
` })
export class CountBarsComponent {
  readonly label = input(''); readonly rows = input<readonly CountBarRow[]>([]);
  readonly limit = input(Infinity); readonly otherLabel = input('Other'); readonly level = input(3);
  readonly id = input(`gcsp-count-bars-${++sequence}`);
  readonly shown = computed(() => {
    let rows = this.rows().map(row => ({ label: String(row.label ?? ''), count: Number.isFinite(row.count) && row.count > 0 ? Math.floor(row.count) : 0 })).filter(row => row.label && row.count);
    const limit = Math.max(1, this.limit());
    if (rows.length > limit) rows = [...rows.slice(0, limit - 1), { label: this.otherLabel(), count: rows.slice(limit - 1).reduce((total, row) => total + row.count, 0) }];
    return rows;
  });
  share(count: number): string { return `${Math.round(count / Math.max(1, ...this.shown().map(row => row.count)) * 10000) / 100}%`; }
}
