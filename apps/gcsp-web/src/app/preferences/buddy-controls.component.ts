import { Component, ElementRef, input, output, viewChild } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { BriefFailure, BuddyCommandAction, BuddyView } from './brief.types';

let sequence = 0;
@Component({ selector: 'gcsp-buddy-controls', imports: [ButtonDirective], styleUrl: './buddy-controls.component.css', template: `
  <section class="buddy-controls" [attr.aria-labelledby]="id() + '-title'">
    <h3 [id]="id() + '-title'">Buddy</h3>
    @if (buddy(); as view) {
      <p class="buddy-state">Saved status: {{ stateText(view) }}</p>
      @if (view.state === 'disengaged' && view.reason === 'paused') {
        <p class="gcsp-note">New searches and holds have stopped. Any held offer stays open until its deadline.</p>
      } @else if (view.state === 'disengaged' && view.remaining > 0) {
        <p class="gcsp-note">{{ minimumText(view.remaining) }}</p>
      }
    } @else { <p class="gcsp-note">Buddy status is unavailable. Reload to try again.</p> }
    @if (disabledReason()) { <p class="gcsp-note">{{ disabledReason() }}</p> }
    <p #status class="buddy-status" role="status" aria-live="polite" aria-atomic="true" tabindex="-1" [attr.aria-busy]="pendingAction() ? 'true' : null">{{ message() || defaultMessage() }}</p>
    <div class="gcsp-actions">
      @if (buddy()?.state === 'engaged') {
        <button gcspButton variant="ghost" type="button" [disabled]="!!disabledReason() || !!pendingAction()" (click)="run('pauseSearch')">Pause search</button>
        <button gcspButton variant="ghost" type="button" [disabled]="!!disabledReason() || !!pendingAction()" (click)="run('disengage')">Disengage Buddy</button>
      } @else if (buddy()?.state === 'disengaged' && buddy()?.reason === 'paused') {
        <button gcspButton type="button" [disabled]="!!disabledReason() || !!pendingAction()" (click)="run('resumeSearch')">Resume search</button>
        <button gcspButton variant="ghost" type="button" [disabled]="!!disabledReason() || !!pendingAction()" (click)="run('disengage')">Disengage Buddy</button>
      } @else if (buddy()?.state === 'disengaged') {
        <button gcspButton type="button" [disabled]="!!disabledReason() || !!pendingAction()" (click)="run('engage')">Engage Buddy</button>
      }
      @if (canRetry()) { <button gcspButton type="button" [disabled]="!!pendingAction()" (click)="retry()">Retry the same request</button> }
      <button gcspButton variant="ghost" type="button" [disabled]="!!pendingAction() || refreshing()" (click)="reload()">Reload Buddy status</button>
    </div>
  </section>
` })
export class BuddyControlsComponent {
  readonly id = input(`buddy-controls-${++sequence}`);
  readonly buddy = input<BuddyView | null>(null);
  readonly disabledReason = input('');
  readonly message = input('');
  readonly pendingAction = input<BuddyCommandAction | null>(null);
  readonly failure = input<BriefFailure | null>(null);
  readonly operationId = input<string | null>(null);
  readonly canRetry = input(false);
  readonly refreshing = input(false);
  readonly action = output<BuddyCommandAction>();
  readonly retryRequest = output<void>();
  readonly reloadStatus = output<void>();
  private readonly status = viewChild<ElementRef<HTMLElement>>('status');

  stateText(view: BuddyView): string {
    if (view.state === 'engaged') return 'Engaged';
    if (view.reason === 'paused') return 'Search paused';
    if (view.reason === 'minimum-lost') return 'Disengaged because the saved minimum was lost';
    return 'Disengaged';
  }
  minimumText(remaining: number): string { return `Choose ${remaining} more ${remaining === 1 ? 'category' : 'categories'} to engage Buddy.`; }
  defaultMessage(): string {
    if (this.pendingAction()) return ({ engage: 'Engaging Buddy.', pauseSearch: 'Pausing search.', resumeSearch: 'Resuming search.', disengage: 'Disengaging Buddy.' })[this.pendingAction()!];
    if (this.failure()?.status === 'pending' && this.operationId()) return `Request ${this.operationId()} is still pending. Reload saved status to check the result.`;
    const view = this.buddy();
    return !view ? 'Buddy status is unavailable. Reload to try again.' : view.reason === 'paused' ? 'Search is paused.' : view.state === 'engaged' ? 'Buddy is engaged.' : 'Buddy is disengaged.';
  }
  private focusStatus(): void { queueMicrotask(() => this.status()?.nativeElement.focus()); }
  run(action: BuddyCommandAction): void { this.action.emit(action); this.focusStatus(); }
  retry(): void { this.retryRequest.emit(); this.focusStatus(); }
  reload(): void { this.reloadStatus.emit(); this.focusStatus(); }
}
