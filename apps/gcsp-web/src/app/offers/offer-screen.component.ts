import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, input, OnDestroy, output, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { MediaGalleryComponent } from '../kit/media-gallery.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { VehicleDetailsComponent } from '../kit/vehicle-details.component';
import { OfferStore, OfferStoreState } from './offer.store';
import { offerFailureView, offerViewModel } from './offer-view-model';
import { OfferInteractionStore } from './offer-interaction.store';
import { OfferDecisionComponent } from './offer-decision.component';
import { OfferFollowupComponent } from './offer-followup.component';

@Component({
  selector: 'gcsp-offer-screen', standalone: true,
  imports: [ButtonDirective, MediaGalleryComponent, ScreenIntroComponent, StatusScreenComponent, VehicleDetailsComponent, OfferDecisionComponent, OfferFollowupComponent],
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
  private pendingFocus: { readonly offerId: string; readonly scope: string | null } | null = null;
  readonly state = this.store.state;
  readonly view = computed(() => { const offer = this.interactions.offer(); return offer ? offerViewModel(offer) : null; });
  readonly failure = computed(() => { const state = this.state(); return state.status === 'failed' ? offerFailureView(state.failure) : null; });

  constructor() {
    effect(() => { const id = this.offerId(); untracked(() => { if (id.trim()) this.store.open(id); else this.store.clear(); }); });
    effect(() => {
      const decision = this.interactions.state().decision;
      if (this.wasSending && decision && decision !== 'sending') untracked(() => this.focusOutcome());
      this.wasSending = decision === 'sending';
    });
    effect(() => { const state = this.state(); untracked(() => this.settleFocus(state)); });
  }

  refresh(): void { this.store.refresh(); }
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
  ngOnDestroy(): void { this.pendingFocus = null; this.store.clear(); }
}
