import { Component, computed, input, output } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { MediaGalleryComponent } from '../kit/media-gallery.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { ManualReviewDetailsComponent, manualVehicle } from './manual-review.component';
import type { ManualEditableDetails, ManualProjection } from './manual.types';

@Component({
  selector: 'gcsp-manual-summary',
  imports: [ButtonDirective, FactListComponent, MediaGalleryComponent, ScreenIntroComponent, ManualReviewDetailsComponent],
  templateUrl: './manual-summary.component.html', styleUrl: './manual-summary.component.css',
})
export class ManualSummaryComponent {
  readonly projection = input.required<ManualProjection>();
  readonly declarations = input<Readonly<Record<string, boolean>>>({});
  readonly busy = input(false);
  readonly resumeRequired = input(false);
  readonly detailsDraft = input<ManualEditableDetails | null>(null);
  readonly detailsDirty = input(false); readonly canSaveDetails = input(false);
  readonly detailsChange = output<ManualEditableDetails>(); readonly saveDetails = output<void>(); readonly submit = output<void>();
  readonly declarationChange = output<{ readonly id: string; readonly checked: boolean }>();
  readonly resume = output<void>(); readonly edit = output<void>(); readonly browse = output<void>();
  readonly check = output<void>(); readonly orders = output<void>(); readonly help = output<void>();
  readonly vehicle = computed(() => manualVehicle(this.projection().claim?.quote ?? null));
  readonly title = computed(() => {
    const order = this.projection().order;
    return !order ? 'Review your order' : order.status === 'acknowledged' ? 'Order received' : order.status === 'refused' ? 'Order not sent' : 'Order saved';
  });
  readonly outcome = computed(() => this.projection().order?.status === 'acknowledged'
    ? 'Your order has reached ordering and is awaiting approval.' : this.projection().order?.status === 'refused'
      ? 'Your order is saved, but it could not be sent to ordering. Contact scheme support.'
      : 'Your order is saved and is being sent to ordering. Check again shortly.');
  submitOrder(event: Event): void {
    event.preventDefault();
    if (!this.busy() && !this.resumeRequired() && !this.projection().order && this.projection().canSubmit
      && (event.target as HTMLFormElement).reportValidity()) this.submit.emit();
  }
  changeDeclaration(id: string, event: Event): void {
    if (!this.busy() && !this.resumeRequired() && !this.projection().order && this.projection().state === 'review') {
      this.declarationChange.emit({ id, checked: (event.target as HTMLInputElement).checked });
    }
  }
  stageLabel(value: string): string { return value ? value[0].toUpperCase() + value.slice(1) : value; }
}
