import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { OfferScreenComponent } from './offer-screen.component';

@Component({
  selector: 'gcsp-offer-route',
  imports: [OfferScreenComponent],
  template: '<gcsp-offer-screen [offerId]="offerId()" (offerOpened)="openOffer($event)" />',
})
export class OfferRouteComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly parameters = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  readonly offerId = computed(() => this.parameters().get('offerId') ?? '');

  openOffer(offerId: string): void { void this.router.navigate(['/offers', offerId]); }
}
