import { Component, input } from '@angular/core';

export interface StageListItem { readonly name: string; readonly state: string }
export type StageHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export const STAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  complete: 'Done', waiting: 'Waiting', 'not-started': 'Not started', pending: 'Sending', failed: 'Not accepted',
});
let sequence = 0;

/** Source stage names and order are supplied; this presenter infers no transition. */
@Component({ selector: 'gcsp-stage-list', host: { style: 'display: contents' }, template: `
  <section class="gcsp-stage-list" [attr.aria-labelledby]="headingId">
    @switch (level()) {
      @case (1) { <h1 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h1> }
      @case (2) { <h2 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h2> }
      @case (3) { <h3 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h3> }
      @case (4) { <h4 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h4> }
      @case (5) { <h5 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h5> }
      @case (6) { <h6 class="gcsp-stage-heading" [id]="headingId">{{ heading() }}</h6> }
    }
    <ol class="gcsp-stage-items">
      @for (stage of stages(); track $index) {
        <li [class]="'gcsp-stage-item is-' + stage.state"><span class="gcsp-stage-name">{{ stage.name }}</span><span class="gcsp-stage-state">{{ labels()[stage.state] ?? 'Unknown' }}</span></li>
      }
    </ol>
  </section>
` })
export class StageListComponent {
  readonly heading = input('Progress');
  readonly stages = input<readonly StageListItem[]>([]);
  readonly level = input<StageHeadingLevel>(2);
  readonly labels = input<Readonly<Record<string, string>>>(STAGE_LABELS);
  readonly headingId = `gcsp-stage-list-${++sequence}`;
}
