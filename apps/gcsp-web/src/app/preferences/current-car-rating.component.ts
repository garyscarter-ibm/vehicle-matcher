import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { RatingStatus, StarRatingComponent } from '../kit/star-rating.component';
import { BriefEditorStore } from './brief-editor.store';
import { BriefEditor, BriefFailure } from './brief.types';
let sequence = 0;
type RatingLane = {
  scope: string; contractId: string; value: number | null; context: BriefEditor['context']; initial: BriefEditor['initial'];
  sent: boolean; awaitingPrior: boolean; sawFailure: boolean; settled: boolean; status: Exclude<RatingStatus, 'idle'>;
};
@Component({ selector: 'gcsp-current-car-rating', imports: [StarRatingComponent, ButtonDirective], template: `
  @if (matching(); as rating) {
    <gcsp-star-rating [id]="id" [label]="question()" [help]="question()" [value]="rating.value" [status]="status()"
      [overlay]="overlay()" [pill]="pill()" [disabled]="store.locked() || store.fullBusy()" [retryable]="status() === 'failed' && !!store.failure() && !store.locked()"
      (rated)="rate($event)" (retried)="retry()">
      @if (store.failure()) { <div class="gcsp-star-failed"><span>{{ store.message() }}</span><button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" (click)="store.reload()">Reload preferences</button>
        @if (!store.locked() && status() !== 'failed') { <button gcspButton class="vm-btn vm-btn-primary" type="button" (click)="retry()">Try again</button> }
      </div> }
    </gcsp-star-rating>
  }
` })
export class CurrentCarRatingComponent {
  readonly store = inject(BriefEditorStore); readonly contractId = input.required<string>(); readonly carDescription = input(''); readonly id = `current-car-rating-${++sequence}`;
  readonly overlay = input(false); readonly pill = input(false); readonly status = signal<RatingStatus>('idle');
  readonly question = computed(() => `How highly do you rate your ${this.carDescription() || 'current car'}?`);
  readonly matching = computed(() => { const rating = this.store.rating(); return this.store.editor() && rating?.contractId === this.contractId() ? rating : null; });
  private lane: RatingLane | null = null;
  constructor() {
    effect(() => this.reconcile(this.store.scope(), this.contractId(), this.store.editor(), this.store.rating()?.contractId,
      this.store.loading(), this.store.saving(), this.store.queuePending(), this.store.failure()));
  }
  rate(value: number | null): void {
    const scope = this.store.scope(); const editor = this.store.editor();
    if (!scope || !editor || !this.matching() || this.store.locked() || this.store.fullBusy()) return;
    const wasSaving = this.store.saving();
    this.lane = { scope, contractId: this.contractId(), value, context: editor.context, initial: editor.initial,
      sent: false, awaitingPrior: wasSaving, sawFailure: !!this.store.failure(), settled: false, status: 'pending' };
    this.status.set('pending'); this.store.rate(value, this.contractId());
    this.lane.sent = !wasSaving && this.store.saving();
  }
  retry(): void {
    const wasSaving = this.store.saving(); this.store.retry();
    if (this.lane && !wasSaving && this.store.saving()) { this.lane.sent = true; this.lane.awaitingPrior = false; this.lane.status = 'pending'; this.status.set('pending'); }
  }
  private resetLane(): void { this.lane = null; this.status.set('idle'); }
  private reconcile(scope: string | null, contractId: string, editor: BriefEditor | null, matchingId: string | undefined,
    loading: boolean, saving: boolean, pending: boolean, failure: BriefFailure | null): void {
    const lane = this.lane;
    if (!lane) return;
    if (loading || !editor || scope !== lane.scope || contractId !== lane.contractId || matchingId !== lane.contractId || editor.context !== lane.context) { this.resetLane(); return; }
    if (lane.settled) {
      if (saving || pending || failure || editor.initial !== lane.initial) this.resetLane();
      return;
    }
    const advanced = editor.initial !== lane.initial; const saved = editor.initial.currentCarRating;
    const matches = saved?.contractId === lane.contractId && saved.value === lane.value;
    // A changed canonical initial snapshot acknowledges a save; optimistic store.rating is not evidence.
    if (advanced && matches && (lane.sent || !pending && !failure)) {
      lane.initial = editor.initial; lane.settled = true; lane.status = 'saved'; this.status.set('saved'); return;
    }
    if (advanced) { lane.initial = editor.initial; lane.awaitingPrior = false; if (saving || failure && pending) lane.sent = true; }
    if (!lane.sent && saving && (!lane.awaitingPrior || lane.sawFailure)) { lane.sent = true; lane.awaitingPrior = false; }
    if (failure) { lane.sawFailure = true; lane.status = lane.sent ? 'failed' : 'pending'; }
    else { lane.status = saving || pending ? 'pending' : 'failed'; lane.settled = !saving && !pending; }
    this.status.set(lane.status);
  }
}
