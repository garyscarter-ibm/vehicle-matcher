import { Component, computed, inject, input } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { StarRatingComponent } from '../kit/star-rating.component';
import { BriefEditorStore } from './brief-editor.store';
let sequence = 0;
@Component({ selector: 'gcsp-current-car-rating', imports: [StarRatingComponent, ButtonDirective], template: `
  @if (matching(); as rating) { <gcsp-star-rating [id]="id" [label]="'How do you rate ' + (carDescription() || 'your current car') + '?'" [value]="rating.value" [disabled]="store.locked() || store.fullBusy()" (rated)="store.rate($event, contractId())" /><p class="gcsp-note" role="status">{{ store.message() }}</p>@if (store.failure()) { <button gcspButton variant="ghost" type="button" (click)="store.reload()">Reload preferences</button>@if (!store.locked()) { <button gcspButton type="button" (click)="store.retry()">Try again</button> } } }
` })
export class CurrentCarRatingComponent {
  readonly store = inject(BriefEditorStore); readonly contractId = input.required<string>(); readonly carDescription = input(''); readonly id = `current-car-rating-${++sequence}`;
  readonly matching = computed(() => { const rating = this.store.rating(); return this.store.editor() && rating?.contractId === this.contractId() ? rating : null; });
}
