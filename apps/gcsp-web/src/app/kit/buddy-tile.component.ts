import { Component, ElementRef, afterRenderEffect, computed, inject, input, output } from '@angular/core';
import { ActivityProjection, ActivityResult } from '../activity/activity.types';
import { ButtonDirective } from './button.directive';
import { BuddyStatusComponent, buddyState } from './buddy-status.component';
import { ActivityTimelineComponent, TimelineEvent } from './activity-timeline.component';
const descriptions: Readonly<Record<string, string>> = { paused: 'New searches and holds have stopped.', unset: 'Choose your preferences, then engage Buddy.', finished: 'You accepted a car. Your search is finished.', inactive: 'Search permission is off. Engage Buddy in your preferences to search again.', unavailable: 'Search status is unavailable. Try again.' };
let sequence = 0;
@Component({ selector: 'gcsp-buddy-tile', imports: [ButtonDirective, BuddyStatusComponent, ActivityTimelineComponent], template: `
  <section class="gcsp-buddy-tile" [attr.aria-labelledby]="id() + '-title'" [attr.data-state]="state()" [attr.aria-busy]="pending() || state() === 'loading'" (focusin)="rememberFocus($event)">
    <div class="gcsp-buddy-tile-head"><div class="gcsp-buddy-tile-identity"><h2 class="gcsp-h2" [id]="id() + '-title'" tabindex="-1">Your buddy</h2>
      <p class="gcsp-buddy-tile-status" [id]="id()">@if (state() === 'loading') { Loading Buddy activity. } @else { <gcsp-buddy-status [state]="state()" [label]="state() === 'paused' ? 'Paused' : null" /> }</p>
    </div>
    @if (state() !== 'loading') { <div class="gcsp-buddy-tile-actions">
      @if (state() === 'active' || state() === 'paused') { <button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" data-focus-key="buddy-search-action" [disabled]="pending() || (state() === 'paused' ? !canResume() : !canPause())" (click)="state() === 'paused' ? resumed.emit() : paused.emit()">{{ state() === 'paused' ? 'Resume search' : 'Pause search' }}</button> }
      @else if (state() === 'unavailable') { <button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" data-focus-key="buddy-retry" [disabled]="pending() || !canRetry()" (click)="retried.emit()">Try again</button> }
      @else if (state() === 'finished' && orderHref()) { <a gcspButton class="vm-btn vm-btn-ghost" variant="ghost" [href]="orderHref()" data-focus-key="buddy-order">Track your order</a> }
    </div> }
    </div>
    @if (state() !== 'loading') {
      @if (detail()) { <p class="gcsp-note">{{ detail() }}</p> }
      @if (held() && state() !== 'unavailable') { <div class="gcsp-buddy-tile-offer"><h3 class="gcsp-buddy-tile-offer-title">A car is held for you</h3>
        @if (offerTitle()) { <p>{{ offerTitle() }}</p> } @if (deadline()) { <p class="gcsp-note">{{ deadline() }}</p> }
        @if (state() === 'paused') { <p class="gcsp-note">Pausing keeps this offer open.</p> }
        <button gcspButton class="vm-btn vm-btn-primary" type="button" data-focus-key="buddy-offer" [disabled]="!canOffer()" (click)="openOffer($event)">View held offer</button>
      </div> }
      @if (state() !== 'unavailable') {
        <gcsp-activity-timeline [events]="recent()" heading="Recent activity" emptyText="No activity is recorded yet." [level]="3" />
        <div class="gcsp-buddy-tile-links"><button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" data-focus-key="buddy-history" [disabled]="!canHistory()" (click)="openHistory($event)">Buddy history</button></div>
        @if (value()?.stateChangesEvidence?.status === 'incomplete') { <p class="gcsp-note">Some activity could not be verified.</p> }
      }
    }
  </section>` })
export class BuddyTileComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef); private focusKey: string | null = null;
  readonly id = input(`gcsp-buddy-tile-${++sequence}`); readonly phase = input('loading'); readonly result = input<ActivityResult<ActivityProjection> | null>(null); readonly pending = input(false);
  readonly events = input<readonly TimelineEvent[]>([]); readonly offerTitle = input<string | null>(null); readonly deadline = input<string | null>(null); readonly orderHref = input<string | null>(null);
  readonly canPause = input(false); readonly canResume = input(false); readonly canRetry = input(false); readonly canHistory = input(false); readonly canOffer = input(false);
  readonly paused = output<void>(); readonly resumed = output<void>(); readonly retried = output<void>(); readonly historyRequested = output<HTMLElement>(); readonly offerRequested = output<HTMLElement>();
  readonly value = computed(() => { const result = this.result(); return result?.status === 'ok' ? result.value : null; });
  readonly state = computed(() => {
    let state = this.phase() === 'ready' ? buddyState(this.result()) : this.phase() === 'loading' ? 'loading' : 'unavailable';
    const permission = this.value()?.permission;
    if (state === 'inactive' && permission?.paused === true && permission.searchConsent && permission.holdConsent) state = 'paused';
    return state;
  });
  readonly held = computed(() => this.value()?.currentOffer?.state === 'active'); readonly recent = computed(() => this.events().slice(0, 2));
  readonly detail = computed(() => this.state() === 'active' && this.value()?.sourceStatus === 'unavailable' ? 'Cars could not be checked. See Buddy history for the latest check.' : this.state() === 'active' && this.value()?.sourceStatus === 'delayed' ? 'Waiting for stock data. See Buddy history for the latest check.' : descriptions[this.state()]);
  constructor() { afterRenderEffect(() => {
    this.result(); this.orderHref(); const state = this.state(); const pending = this.pending(); const root = this.host.nativeElement; const doc = root.ownerDocument;
    if (!this.focusKey || state === 'loading' || root.contains(doc.activeElement) || doc.activeElement !== doc.body) return;
    const next = Array.from(root.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>('[data-focus-key]')).find((node) => node.dataset['focusKey'] === this.focusKey && !('disabled' in node && node.disabled));
    if (next) { next.focus(); this.focusKey = null; } else if (!pending) { root.querySelector<HTMLElement>('h2')?.focus(); this.focusKey = null; }
  }); }
  rememberFocus(event: FocusEvent): void { this.focusKey = (event.target as HTMLElement).dataset['focusKey'] ?? this.focusKey; }
  openOffer(event: MouseEvent): void { this.offerRequested.emit(event.currentTarget as HTMLElement); }
  openHistory(event: MouseEvent): void { this.historyRequested.emit(event.currentTarget as HTMLElement); }
}
