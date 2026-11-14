import { Component, computed, effect, inject, input, OnDestroy } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { MediaGalleryComponent } from '../kit/media-gallery.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { VehicleDetailsComponent } from '../kit/vehicle-details.component';
import { OfferStore } from './offer.store';
import { offerFailureView, offerViewModel } from './offer-view-model';

@Component({
  selector: 'gcsp-offer-screen', standalone: true,
  imports: [ButtonDirective, MediaGalleryComponent, ScreenIntroComponent, StatusScreenComponent, VehicleDetailsComponent],
  providers: [OfferStore], templateUrl: './offer-screen.component.html', styleUrl: './offer-screen.component.css',
})
export class OfferScreenComponent implements OnDestroy {
  readonly offerId = input('');
  private readonly store = inject(OfferStore);
  readonly state = this.store.state;
  readonly view = computed(() => { const state = this.state(); return state.status === 'ready' ? offerViewModel(state.offer) : null; });
  readonly failure = computed(() => { const state = this.state(); return state.status === 'failed' ? offerFailureView(state.failure) : null; });

  constructor() {
    effect(() => { const id = this.offerId(); if (id.trim()) this.store.open(id); else this.store.clear(); });
  }

  refresh(): void { this.store.refresh(); }
  ngOnDestroy(): void { this.store.clear(); }
}
