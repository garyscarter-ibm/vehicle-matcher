import { Component, computed, inject, input, output } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { StageListComponent } from '../kit/stage-list.component';
import { manualCountdown, manualReadbackCards, ManualReadbackSource, ManualEditIntent } from './manual.readback';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { MediaGalleryComponent } from '../kit/media-gallery.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { manualVehicle } from './manual-review.component';
import type { ManualEditableDetails, ManualProjection } from './manual.types';

@Component({
  selector: 'gcsp-manual-summary',
  imports: [ButtonDirective, FactListComponent, MediaGalleryComponent, ScreenIntroComponent, StageListComponent],
  templateUrl: './manual-summary.component.html', styleUrl: './manual-summary.component.css',
})
export class ManualSummaryComponent {
  readonly projection = input.required<ManualProjection>();
  readonly declarations = input<Readonly<Record<string, boolean>>>({});
  readonly busy = input(false);
  readonly resumeRequired = input(false);
  readonly detailsDraft = input<ManualEditableDetails | null>(null);
  readonly detailsDirty = input(false); readonly canSaveDetails = input(false);
  readonly readback = input<ManualReadbackSource | null>(null); readonly announcement = input('');
  readonly cards = computed(() => manualReadbackCards(this.projection(), this.readback()));
  readonly countdown = computed(() => manualCountdown(this.projection()));
  readonly editDetails = output<ManualEditIntent>(); readonly back = output<void>(); readonly cancel = output<void>();
  readonly finish = output<void>();
  private readonly document = inject(DOCUMENT);
  readonly stages = computed(() => this.projection().order?.progress.stages.map((stage) => ({ ...stage, name: this.stageLabel(stage.name) })) ?? []);
  printOrder(): void { if (this.projection().order) { try { this.document.defaultView?.print(); } catch { /* Printing cannot alter the saved order. */ } } }
  editCard(intent: ManualEditIntent): void {
    if (this.busy() || this.resumeRequired() || this.projection().order) return;
    if ((intent === 'car' || intent === 'choices') && !this.projection().canRelease
      || (intent === 'contact' || intent === 'return') && !this.projection().reviewDetails?.editable) return;
    if (intent === 'car') this.browse.emit();
    else if (intent === 'choices') this.edit.emit();
    else this.editDetails.emit(intent);
  }
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
  stageLabel(value: string): string { return ({ 'sales-manager approval': 'Sales manager approval', 'sent to ordering': 'Sent to ordering', 'selection received': 'Selection received' } as Record<string, string>)[value] ?? value; }
}
