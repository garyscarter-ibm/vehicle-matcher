import { Component, computed, input } from '@angular/core';
export interface DecisionHighlight { readonly number?: string | number; readonly title: string; readonly detail?: string }

/** Source groups retain every supplied entry; the caller owns comparison and priorities. */
@Component({ selector: 'gcsp-decision-highlights', host: { style: 'display: contents' }, template: `
  <div class="gcsp-decision-highlights" [class.gcsp-decision-lists]="layout() === 'list'">
    @for (group of groups(); track group.key) {
      <section [class]="'gcsp-highlight-group gcsp-highlight-' + group.key">
        <h3 class="gcsp-h3">{{ group.title }}</h3>
        <div class="gcsp-highlight-cards">
          @for (entry of group.entries; track $index) {
            <div class="gcsp-highlight">
              <p class="gcsp-highlight-heading">@if (entry.number !== undefined) {<strong class="gcsp-highlight-number">{{ entry.number }}</strong>{{ ' ' }}}{{ entry.title }}</p>
              @if (entry.detail) { <p class="gcsp-highlight-detail">{{ entry.detail }}</p> }
            </div>
          } @empty { <p class="gcsp-note gcsp-highlight-empty">No {{ group.key }} confirmed.</p> }
        </div>
      </section>
    }
  </div>
` })
export class DecisionHighlightsComponent {
  readonly benefits = input<readonly DecisionHighlight[]>([]);
  readonly tradeoffs = input<readonly DecisionHighlight[]>([]);
  readonly layout = input<'default' | 'list'>('default');
  readonly groups = computed(() => [
    { key: 'benefits', title: 'Benefits', entries: this.benefits() },
    { key: 'tradeoffs', title: 'Tradeoffs', entries: this.tradeoffs() },
  ]);
}
