import { Component, computed, input, output } from '@angular/core';
import { ButtonDirective } from './button.directive';
import { FactListComponent, FactRow } from './fact-list.component';
import { MediaGalleryImage } from './media-gallery.component';
import { MediaWellComponent } from './media-well.component';

let vehicleCardSequence = 0;

export interface VehicleCardAction { readonly memberId: string; readonly action: 'review' | 'details' }

@Component({
  selector: 'gcsp-vehicle-card',
  imports: [ButtonDirective, FactListComponent, MediaWellComponent],
  templateUrl: './vehicle-card.component.html',
  styleUrl: './vehicle-card.component.css',
})
export class VehicleCardComponent {
  readonly reasonId = `gcsp-vehicle-card-reason-${++vehicleCardSequence}`;
  readonly memberId = input.required<string>();
  readonly name = input.required<string>();
  readonly line = input('');
  readonly orderNumber = input('');
  readonly images = input<readonly MediaGalleryImage[]>([]);
  readonly placeholder = input('No image for this car yet');
  readonly points = input<number | null>(null);
  readonly allowance = input<number | null>(null);
  readonly contribution = input<{ readonly amount: number; readonly currency: string; readonly period: string } | null>(null);
  readonly eligibility = input('');
  readonly gate = computed(() => {
    switch (this.eligibility()) {
      case 'Eligible': return 'eligible';
      case 'Not eligible': return 'ineligible';
      case 'Needs confirmation': return 'needs-confirmation';
      default: return 'unknown';
    }
  });
  readonly reviewDisabled = input(true);
  readonly disabledReason = input<string | null>(null);
  readonly reviewReason = computed(() => this.reviewDisabled() ? this.disabledReason() || 'This action is not available.' : null);
  readonly facts = input<readonly FactRow[]>([]);
  readonly action = output<VehicleCardAction>();
  readonly number = (value: number): string => value.toLocaleString('en-GB');

  activate(action: VehicleCardAction['action']): void {
    if (action !== 'review' || !this.reviewDisabled()) this.action.emit({ memberId: this.memberId(), action });
  }
}
