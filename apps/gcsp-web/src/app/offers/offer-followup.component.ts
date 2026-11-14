import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, output } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { MediaGalleryComponent } from '../kit/media-gallery.component';
import { VehicleDetailsComponent } from '../kit/vehicle-details.component';
import { OfferInteractionStore } from './offer-interaction.store';
import { offerDate, offerFieldLabel, offerViewModel } from './offer-view-model';
import { OfferFollowupRequirement, OfferFollowupRequirementFact, OfferJsonValue } from './offer.types';

let sequence = 0;
@Component({
  selector: 'gcsp-offer-followup', standalone: true,
  imports: [ButtonDirective, LabelledFieldComponent, MediaGalleryComponent, VehicleDetailsComponent],
  templateUrl: './offer-followup.component.html', styleUrl: './offer-followup.component.css',
})
export class OfferFollowupComponent {
  readonly store = inject(OfferInteractionStore);
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  readonly offerOpened = output<string>();
  readonly state = computed(() => this.store.state().followup);
  readonly question = computed(() => { const value = this.state().value; return value?.state === 'question' ? value : null; });
  readonly comparison = computed(() => { const value = this.state().value; return value?.state === 'ready' ? value.comparison : null; });
  readonly cards = computed(() => {
    const comparison = this.comparison();
    return comparison ? [{ label: 'Declined offer', offer: comparison.previous.offer }, { label: 'Next offer', offer: comparison.next.offer }]
      .map(({ label, offer }) => ({ label, offer, view: offerViewModel(offer) })) : [];
  });
  readonly prefix = `offer-followup-${++sequence}`;
  readonly busy = computed(() => ['loading', 'saving'].includes(this.state().phase));
  readonly headline = computed(() => {
    const state = this.state();
    if (state.phase === 'loading') return 'Checking your next offer';
    if (state.phase === 'uncertain') return 'Check your change';
    if (state.phase === 'failed') return ['stale-version', 'conflict'].includes(state.failure?.status ?? '')
      ? 'Your preferences have changed' : 'Next-offer status unavailable';
    return state.value ? ({ question: 'One change to your preferences', 'change-saved': 'Change saved', waiting: 'Waiting for the next release',
      'no-match': 'Nothing suitable yet', ready: 'Your next car offer' })[state.value.state] : 'Your next offer';
  });
  readonly message = computed(() => {
    const state = this.state();
    if (state.phase === 'uncertain') return 'The save could not be confirmed. Retry the same change or check its current status.';
    if (state.phase === 'failed') return state.value ? 'Your change is saved. The next-offer status could not be checked.'
      : 'The follow-up could not be loaded. Check its current state before choosing again.';
    if (state.value?.state === 'change-saved') return 'Saved. Your buddy will look again at the next check.';
    if (state.value?.state === 'waiting') return 'Your change is saved. Your next offer is checked when more cars are released.';
    if (state.value?.state === 'no-match') return `None of the ${state.value.evaluation.carsChecked} cars checked fit your updated preferences. We will check again at the next release.`;
    return '';
  });
  equipment(value: OfferJsonValue): string { return Array.isArray(value) ? value.join('\n') : ''; }
  chooseEquipment(value: string): void { this.store.chooseAnswer(value.split('\n').map((line) => line.trim()).filter(Boolean)); }
  text(value: OfferJsonValue): string { return value === null ? 'Not supplied' : Array.isArray(value) ? value.length ? value.map((item) => this.text(item)).join(', ') : 'None listed'
    : typeof value === 'object' ? JSON.stringify(value) : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value); }
  requirement(value: OfferFollowupRequirement): string {
    const prefix = value.kind === 'essential' ? value.operator === 'gte' ? 'At least ' : value.operator === 'includes' ? 'Includes ' : '' : '';
    return `${prefix}${this.text(value.value)}${value.kind === 'essential' && value.unit ? ' (' + value.unit + ')' : ''}`;
  }
  fact(value: OfferFollowupRequirementFact): string { return value.status === 'known' ? `${this.text(value.value)}${value.unit ? ' ' + value.unit : ''}` : 'Not supplied'; }
  readonly label = offerFieldLabel;
  readonly date = offerDate;
  entries(value: Readonly<Record<string, OfferFollowupRequirementFact>>) { return Object.entries(value); }
  async confirm(): Promise<void> {
    await this.store.confirmFollowup();
    if (this.destroyRef.destroyed) return;
    afterNextRender(() => { if (!this.element.nativeElement.isConnected) return;
      this.element.nativeElement.querySelector<HTMLElement>('h2')?.focus(); }, { injector: this.injector });
  }
}
