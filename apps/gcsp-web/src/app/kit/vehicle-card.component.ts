import { Component, input, output } from '@angular/core';
import { ButtonDirective } from './button.directive';
import { FactListComponent, FactRow } from './fact-list.component';
import { MediaGalleryComponent, MediaGalleryImage } from './media-gallery.component';

let vehicleCardSequence = 0;

export interface VehicleCardAction { readonly memberId: string; readonly action: 'review' | 'details' }

@Component({
  selector: 'gcsp-vehicle-card',
  imports: [ButtonDirective, FactListComponent, MediaGalleryComponent],
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
  readonly reviewDisabled = input(true);
  readonly disabledReason = input<string | null>(null);
  readonly facts = input<readonly FactRow[]>([]);
  readonly action = output<VehicleCardAction>();
  readonly number = (value: number): string => value.toLocaleString('en-GB');

  activate(action: VehicleCardAction['action']): void {
    if (action !== 'review' || !this.reviewDisabled()) this.action.emit({ memberId: this.memberId(), action });
  }
}
