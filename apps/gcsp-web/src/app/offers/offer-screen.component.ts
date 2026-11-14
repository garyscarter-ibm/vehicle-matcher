import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, input, OnDestroy, output, untracked } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { MediaGalleryComponent } from '../kit/media-gallery.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { VehicleDetailsComponent } from '../kit/vehicle-details.component';
import { OfferStore } from './offer.store';
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
  private wasSending = false;
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
  }

  refresh(): void { this.store.refresh(); }
  openNextOffer(id: string): void { this.store.open(id); this.offerOpened.emit(id); this.focusOutcome(); }
  private focusOutcome(): void {
    afterNextRender(() => {
      if (!this.destroyRef.destroyed) { const heading = this.element.nativeElement.querySelector<HTMLElement>('h1');
        if (heading) { heading.tabIndex = -1; heading.focus(); } }
    }, { injector: this.injector });
  }
  ngOnDestroy(): void { this.store.clear(); }
}
