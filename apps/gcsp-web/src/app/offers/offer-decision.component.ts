import { Component, computed, effect, inject, viewChild } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { SideDrawerComponent } from '../kit/side-drawer.component';
import { OfferInteractionStore } from './offer-interaction.store';
import { OfferDecisionKind } from './offer.types';

let sequence = 0;
@Component({
  selector: 'gcsp-offer-decision', standalone: true,
  imports: [ButtonDirective, LabelledFieldComponent, SideDrawerComponent],
  templateUrl: './offer-decision.component.html', styleUrl: './offer-decision.component.css',
})
export class OfferDecisionComponent {
  readonly store = inject(OfferInteractionStore);
  readonly state = this.store.state;
  readonly offer = this.store.offer;
  readonly prefix = `offer-decision-${++sequence}`;
  private readonly drawer = viewChild(SideDrawerComponent);
  readonly busy = computed(() => this.state().decision === 'sending');
  readonly feedback = computed(() => {
    const result = this.state().decision;
    if (!result) return '';
    if (result === 'sending') return 'Checking your decision. Please wait.';
    if (result.status === 'ok') return '';
    if (['unavailable', 'pending'].includes(result.status)) return 'Your decision could not be confirmed. Check the current state before trying again.';
    if (['stale-version', 'stale-run', 'conflict'].includes(result.status)) return 'The offer changed. Check the current state before deciding again.';
    if (['unauthenticated', 'denied', 'forbidden'].includes(result.status)) return 'Your decision was not confirmed. Open this offer from your signed-in account.';
    return 'Your decision was not confirmed. Check the current offer before deciding again.';
  });
  readonly acceptNote = computed(() => {
    const handoff = this.offer()?.handoff;
    if (handoff?.blocker) return ({ 'contact-required': 'Confirm your contact details with scheme support.',
      'driver-review-required': 'Confirm the driver and licence details with scheme support.',
      'return-data-required': 'Confirm your old contract details with scheme support.',
      'ordering-terms-unavailable': 'Scheme terms are unavailable. Check the offer again.' })[handoff.blocker];
    return !handoff?.driver?.name || !handoff.driver.licence?.displayNumber ? 'Confirm the driver and licence details before accepting.' : '';
  });
  constructor() { effect(() => { if (!this.state().review) this.drawer()?.close(false); }); }
  open(kind: OfferDecisionKind, event: MouseEvent): void {
    this.store.review(kind);
    if (this.state().review === kind) this.drawer()?.open(event.currentTarget as HTMLElement);
  }
  close(): void { if (!this.busy()) this.drawer()?.close(); }
  date(value: string | null | undefined): string {
    return value && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value))
      ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'To confirm';
  }
}
