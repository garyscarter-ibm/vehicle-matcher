import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { LiveRefreshService } from '../live-refresh.service';
import { AuthPort } from '../auth/auth.port';
import { RouterLink } from '@angular/router';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { DataTableComponent } from '../kit/data-table.component';
import { DecisionHighlightsComponent } from '../kit/decision-highlights.component';
import { MediaWellComponent } from '../kit/media-well.component';
import { MediaGalleryComponent } from '../kit/media-gallery.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { LoadingSkeletonComponent } from '../kit/loading-skeleton.component';
import { StageListComponent } from '../kit/stage-list.component';
import { VehicleDetailsComponent } from '../kit/vehicle-details.component';
import { VehicleDecisionComponent } from '../kit/vehicle-decision.component';
import { OfferStore, OfferStoreState } from './offer.store';
import { offerCheckStructure, offerFailureView, offerPresentationState, offerViewModel } from './offer-view-model';
import { OfferInteractionStore } from './offer-interaction.store';
import { OfferDecisionComponent } from './offer-decision.component';
import { OfferFollowupComponent } from './offer-followup.component';

interface ManualCheck {
  readonly offerId: string;
  readonly scope: string;
  readonly authority: object;
  readonly identity: string | null;
  readonly structure: string | null;
  readonly ownsFocus: boolean;
  readonly result?: OfferStoreState;
  readonly message: string;
}

@Component({
  selector: 'gcsp-offer-screen', standalone: true,
  imports: [NgTemplateOutlet, MediaWellComponent, RouterLink, ButtonDirective, FactListComponent, DataTableComponent, DecisionHighlightsComponent, MediaGalleryComponent, ScreenIntroComponent, StatusScreenComponent, LoadingSkeletonComponent, StageListComponent, VehicleDetailsComponent, VehicleDecisionComponent, OfferDecisionComponent, OfferFollowupComponent],
  providers: [OfferStore, OfferInteractionStore], templateUrl: './offer-screen.component.html', styleUrl: './offer-screen.component.css',
})
export class OfferScreenComponent implements OnDestroy {
  readonly offerId = input('');
  readonly offerOpened = output<string>();
  private readonly store = inject(OfferStore);
  private readonly interactions = inject(OfferInteractionStore);
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthPort);
  private wasSending = false;
  private announcementScope: string | null = null;
  private announcedOffer: string | null = null;
  readonly announcement = signal('');
  private readonly manualCheck = signal<ManualCheck | null>(null);
  private pendingFocus: { readonly offerId: string; readonly scope: string | null } | null = null;
  readonly state = this.store.state;
  readonly view = computed(() => { const offer = this.interactions.offer(); return offer ? offerViewModel(offer) : null; });
  readonly failure = computed(() => { const state = this.state(); return state.status === 'failed' ? offerFailureView(state.failure) : null; });
  readonly checkFeedback = computed(() => {
    const check = this.manualCheck(); const state = this.state();
    return check && check.scope === this.employeeScope() && check.authority === this.store.readAuthority() && check.offerId === state.offerId
      && (!check.result || check.result === state) ? check.message : '';
  });

  private readonly stopLiveRefresh = inject(LiveRefreshService).subscribe(() => this.autoRefresh());

  constructor() {
    effect(() => { const id = this.offerId(); untracked(() => { if (id.trim()) this.store.open(id); else this.store.clear(); }); });
    effect(() => {
      const decision = this.interactions.state().decision;
      if (this.wasSending && decision && decision !== 'sending') untracked(() => this.focusOutcome());
      this.wasSending = decision === 'sending';
    });
    effect(() => { const state = this.state(); untracked(() => this.settleFocus(state)); });
    effect(() => {
      const vm = this.view(); const offer = this.interactions.offer(); const failure = this.failure(); const state = this.state();
      const scope = this.employeeScope();
      if (scope !== this.announcementScope || scope === null) {
        this.announcementScope = scope; this.announcedOffer = null; this.announcement.set('');
      }
      const check = this.manualCheck();
      if (check) {
        if (scope !== check.scope || check.authority !== this.store.readAuthority() || state.offerId !== check.offerId || check.result && check.result !== state) this.manualCheck.set(null);
        else if (!check.result) {
          if (state.status === 'loading' || this.store.reading()) {
            this.announcement.set(vm?.isPending && vm.remainingSeconds === 0
              ? 'The deadline has been reached. Checking the current offer state.' : '');
            return;
          }
          const hasCheck = state.status === 'failed' ? !!failure?.retry : !!vm
            && (!vm.isPending || !!this.interactions.state().decision) && !vm.showAcceptedIdentity && !vm.isExpired && !vm.isRefused;
          const identity = vm && offer ? `${vm.title}:${offer.offerId}` : null;
          const words = offer ? ({ pending: 'open for your decision', accepted: 'accepted', declined: 'declined', expired: 'expired',
            superseded: 'replaced by a newer offer', uncertain: 'waiting for your decision to be confirmed' })[offerPresentationState(offer)] : '';
          const message = !hasCheck ? '' : state.status === 'failed' ? 'Check not completed. Try again in a moment.'
            : check.identity !== identity ? `Check complete. Current state: ${words}.`
              : offer && check.structure !== offerCheckStructure(offer) ? 'Check complete. The offer details have been updated.'
                : offer && offerPresentationState(offer) === 'uncertain' ? 'Check complete. Your decision is still being confirmed.'
                  : 'Check complete. Nothing has changed.';
          const completed = { ...check, result: state, message }; this.manualCheck.set(completed);
          this.announcement.set(message || vm?.title || failure?.title || '');
          this.announcedOffer = identity ?? (failure ? `failure:${failure.title}` : null);
          if (check.ownsFocus) this.focusAfterCheck(completed);
          return;
        } else if (!vm || !offer || this.announcedOffer === `${vm.title}:${offer.offerId}`) return;
        else this.manualCheck.set(null);
      }
      if (!vm || !offer || scope === null) {
        if (failure && scope !== null && this.announcedOffer !== null) {
          this.announcement.set(failure.title); this.announcedOffer = `failure:${failure.title}`;
        }
        return;
      }
      const identity = `${vm.title}:${offer.offerId}`;
      if (vm.isPending && vm.remainingSeconds === 0) this.announcement.set('The deadline has been reached. Checking the current offer state.');
      else if (vm.isPending && vm.remainingSeconds !== null && vm.remainingSeconds <= 300) this.announcement.set('Less than five minutes remain on this offer.');
      else if (this.announcedOffer !== null && this.announcedOffer !== identity) this.announcement.set(vm.title);
      this.announcedOffer = identity;
    });
  }

  refresh(): void { this.store.refresh(); }
  beginCheck(): void {
    const state = this.state(); const scope = this.employeeScope(); const offer = this.interactions.offer(); const vm = this.view();
    if (!scope || state.status === 'idle' || state.status === 'loading' || this.interactions.state().decision === 'sending') return;
    const active = this.element.nativeElement.ownerDocument.activeElement;
    this.manualCheck.set({ offerId: state.offerId, scope, authority: this.store.readAuthority(), identity: offer && vm ? `${vm.title}:${offer.offerId}` : null,
      structure: offer ? offerCheckStructure(offer) : null,
      ownsFocus: !!active && this.element.nativeElement.contains(active) && active.matches('[data-offer-action="check"], [data-offer-action="refresh"]'),
      message: 'Checking the current offer state.' });
  }
  checkCurrent(): void { this.beginCheck(); this.interactions.checkCurrent(); }
  private autoRefresh(): void {
    const state = this.state(); const interaction = this.interactions.state();
    // The source dialog states also cover inspections inside the follow-up comparison view.
    if (this.destroyRef.destroyed || state.status === 'idle' || state.status === 'loading'
      || this.element.nativeElement.querySelector('gcsp-vehicle-details .gcsp-side-drawer:not([hidden]), gcsp-media-gallery dialog[open]')
      || state.status === 'failed' && !state.failure.retryable || interaction.review || interaction.mileage
      || interaction.reasons.selected || interaction.reasons.phase === 'loading' || Object.keys(interaction.declarations).length
      || interaction.decision === 'sending' || interaction.decision && interaction.decision.status !== 'ok'
      || ['loading', 'saving', 'uncertain', 'failed'].includes(interaction.followup.phase)
      || interaction.followup.value?.state === 'question') return;
    this.store.refresh();
  }
  openNextOffer(id: string): void {
    this.store.open(id); this.offerOpened.emit(id);
    this.pendingFocus = this.state().status === 'loading' ? { offerId: id, scope: this.scope() } : null;
    this.focusOutcome();
  }
  // The loading heading is replaced when the read settles; refocus only the same offer and account.
  private settleFocus(state: OfferStoreState): void {
    const pending = this.pendingFocus;
    if (!pending || state.status === 'loading' && state.offerId === pending.offerId) return;
    this.pendingFocus = null;
    if (state.offerId === pending.offerId && this.scope() === pending.scope) this.focusOutcome(true);
  }
  private scope(): string | null {
    const auth = this.auth.state();
    return auth.status === 'ready' ? JSON.stringify([auth.context.subject, auth.context.environmentId, auth.context.runId, auth.context.employeeId]) : null;
  }
  private employeeScope(): string | null {
    const auth = this.auth.state();
    return auth.status === 'ready' && auth.context.roles.includes('employee') && !auth.context.roles.includes('presenter') ? this.scope() : null;
  }
  private focusAfterCheck(check: ManualCheck): void {
    afterNextRender(() => {
      if (this.destroyRef.destroyed || this.manualCheck() !== check || check.scope !== this.employeeScope()
        || check.authority !== this.store.readAuthority() || this.state() !== check.result) return;
      const host = this.element.nativeElement; const document = host.ownerDocument; const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const target = host.querySelector<HTMLElement>('[data-offer-action="check"], [data-offer-action="refresh"]') ?? host.querySelector<HTMLElement>('h1');
      if (target) { if (target.tagName === 'H1') target.tabIndex = -1; target.focus(); target.scrollIntoView?.({ block: 'nearest' }); }
    }, { injector: this.injector });
  }
  private focusOutcome(onlyIfLost = false): void {
    afterNextRender(() => {
      if (this.destroyRef.destroyed) return;
      const host = this.element.nativeElement; const active = host.ownerDocument.activeElement;
      // Never take focus from a control the user moved to elsewhere on the page.
      if (onlyIfLost && active && active !== host.ownerDocument.body && active.isConnected && !host.contains(active)) return;
      const heading = host.querySelector<HTMLElement>('h1');
      if (heading) { heading.tabIndex = -1; heading.focus(); }
    }, { injector: this.injector });
  }
  ngOnDestroy(): void { this.stopLiveRefresh(); this.pendingFocus = null; this.manualCheck.set(null); this.store.clear(); }
}
