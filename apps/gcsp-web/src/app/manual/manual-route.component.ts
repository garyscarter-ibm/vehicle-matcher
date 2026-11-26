import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, signal, untracked } from '@angular/core';
import { CanDeactivateFn, Router } from '@angular/router';
import { LiveRefreshService } from '../live-refresh.service';
import { AuthPort } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { ManualReviewComponent } from './manual-review.component';
import { ManualSummaryComponent } from './manual-summary.component';
import { ManualStore } from './manual.store';
import type { ManualState } from './manual.types';

const copy: Partial<Record<ManualState, readonly [string, string]>> = {
  idle: ['Checking your selection', 'Checking your current claim and order.'],
  loading: ['Checking your selection', 'Checking your current claim and order.'],
  'no-claim': ['No car selected', 'Choose a car to review it.'],
  pending: ['Still checking your selection', 'The outcome is being checked. Check its status before continuing.'],
  uncertain: ['Outcome not confirmed', 'We could not confirm the outcome. Check its status before continuing.'],
  stale: ['Your selection has changed', 'Check the current claim and terms before continuing.'],
  refused: ['Selection not accepted', 'Your selection could not be accepted. Check its current status.'],
  released: ['Car released', 'Choose a car to start a new review.'],
  expired: ['Reservation expired', 'Refresh stock to choose again.'],
  unavailable: ['Review unavailable', 'Your current selection could not be confirmed. Check again.'],
  invalid: ['Check your selection', 'Some details could not be accepted. Check the current claim.'],
  denied: ['Selection unavailable to this account', 'Use your employee account to review your selection.'],
  'authentication-required': ['Sign in to review your selection', 'Your selection will be checked after sign-in.'],
};

@Component({
  selector: 'gcsp-manual-route',
  imports: [ButtonDirective, StatusScreenComponent, ManualReviewComponent, ManualSummaryComponent],
  template: `
    @if (notice(); as message) {
      <gcsp-status-screen [title]="message[0]" [message]="failureReason() || message[1]" [level]="hasBody() ? 2 : 1"
        [busy]="store.loading()" [announcement]="store.state() === 'invalid' || store.state() === 'stale' ? 'alert' : 'status'">
        @if (store.state() === 'authentication-required') { <button gcspButton type="button" (click)="signIn()">Sign in</button> }
        @else if (['released', 'expired', 'no-claim'].includes(store.state())) { <button gcspButton type="button" (click)="browse()">Refresh stock</button> }
        @else if (store.state() !== 'denied') { <button gcspButton type="button" [disabled]="store.loading()" (click)="store.checkStatus()">Check status</button> }
      </gcsp-status-screen>
    }
    @if (showSummary()) {
      <gcsp-manual-summary [readback]="store.readback()" [announcement]="store.announcement()" [projection]="store.projection()" [declarations]="store.declarations()" [busy]="store.loading()" [resumeRequired]="store.resumeRequired()"
        [detailsDraft]="store.detailsDraft()" [detailsDirty]="store.detailsDirty()" [canSaveDetails]="store.canSaveReviewDetails()"
        (detailsChange)="store.setReviewDetails($event)" (saveDetails)="store.saveReviewDetails()" (submit)="store.submit()"
        (declarationChange)="store.setDeclaration($event.id, $event.checked)" (resume)="store.confirmResume()"
        (edit)="edit()" (browse)="changeCar()" (back)="back()" (cancel)="cancel()" (editDetails)="editDetails()" (finish)="finish()" (check)="store.checkStatus()" (orders)="orders()" (help)="help()" />
    } @else if (hasBody()) {
      <gcsp-manual-review [readback]="store.readback()" [announcement]="store.announcement()" [canDiscard]="store.canDiscardLocalEdits()" [editingSummary]="detailsEditing()" (discard)="store.discardLocalEdits()" [projection]="store.projection()" [selection]="store.handoff()" [busy]="store.loading()"
        [detailsDraft]="store.detailsDraft()" [detailsDirty]="store.detailsDirty()" [canSaveDetails]="store.canSaveReviewDetails()"
        (detailsChange)="store.setReviewDetails($event)" (saveDetails)="store.saveReviewDetails()"
        (continue)="continueReview()" (resume)="store.confirmResume()" (edit)="edit()" (browse)="changeCar()" (back)="back()" (cancel)="cancel()" (check)="store.checkStatus()" />
    }
  `,
})
export class ManualRouteComponent {
  readonly store = inject(ManualStore);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthPort);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private destroyed = false;
  readonly detailsEditing = signal(false);
  readonly showSummary = computed(() => !!this.store.projection().order || !this.detailsEditing() && this.store.projection().claim?.hold.phase === 'order-review');
  readonly hasBody = computed(() => !!this.store.projection().claim || !!this.store.projection().order || this.store.state() === 'selection-ready');
  readonly notice = computed(() => this.store.projection().order ? null : copy[this.store.state()] ?? null);
  readonly failureReason = computed(() => this.store.projection().failure?.reason ?? null);

  constructor() {
    void this.store.enter();
    const stopRefresh = inject(LiveRefreshService).subscribe(() => this.store.refresh());
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; stopRefresh(); this.store.dispose(); });
    effect(() => { this.store.scope(); untracked(() => this.detailsEditing.set(false)); });
    effect(() => {
      const key = `${this.store.state()}:${this.showSummary()}`;
      untracked(() => afterNextRender(() => {
        if (this.destroyed || key !== `${this.store.state()}:${this.showSummary()}`) return;
        this.host.nativeElement.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
      }, { injector: this.injector }));
    });
  }
  signIn(): void { void this.auth.signIn('/gcsp/manual/review'); }
  async edit(): Promise<void> { if (await this.store.release('change')) await this.router.navigateByUrl('/account'); }
  async browse(): Promise<void> {
    const state = this.store.state();
    if (['selection-ready', 'no-claim', 'released', 'expired'].includes(state) || await this.store.release('back')) await this.router.navigateByUrl('/stock');
  }
  async changeCar(): Promise<void> { if (await this.store.release('change')) await this.router.navigateByUrl('/stock'); }
  async back(): Promise<void> { if (await this.store.release('back')) await this.router.navigateByUrl('/stock'); }
  async cancel(): Promise<void> { if (await this.store.release('cancel')) await this.router.navigateByUrl('/account'); }
  editDetails(): void { if (this.store.beginDetailsEdit()) this.detailsEditing.set(true); }
  continueReview(): void {
    if (this.detailsEditing()) {
      const details = this.store.projection().reviewDetails;
      if (!this.store.loading() && !this.store.resumeRequired() && !this.store.detailsDirty() && details?.editable && details.reviewDetailsVersion > 0) this.detailsEditing.set(false);
    } else void this.store.beginReview();
  }
  finish(): void { if (this.store.projection().order) void this.router.navigateByUrl('/account'); }
  orders(): void { if (this.store.projection().order) void this.router.navigateByUrl('/orders'); }
  help(): void { if (this.store.projection().order) void this.router.navigateByUrl('/help'); }
  /** Rail and browser navigation must not leave an unresolved reservation behind. */
  async canLeave(nextUrl: string): Promise<boolean> {
    if (this.destroyed || !this.store.scope() || /^\/(?:gcsp\/)?manual\/(?:review|summary)(?:[?#]|$)/.test(nextUrl)) return true;
    if (this.store.projection().order || ['idle', 'selection-ready', 'no-claim', 'released', 'expired', 'denied', 'authentication-required'].includes(this.store.state())) return true;
    return this.store.release('back');
  }
}
export const manualCanDeactivate: CanDeactivateFn<ManualRouteComponent> = (component, _current, _state, next) => component.canLeave(next.url);
