import { Component, computed, input, signal } from '@angular/core';
import { ActivityOffer, ActivityOfferDisplay } from '../activity/activity.types';
import { approvedActivityImages } from '../activity/activity-image-registry';
import { offerStateLabel, respondBy } from '../activity/activity.copy';
import { vehicleImageUrl } from './vehicle-image-url';
import { ButtonDirective } from './button.directive';
@Component({ selector: 'gcsp-activity-offer', imports: [ButtonDirective], template: `
  @if (offer(); as offer) { <section class="gcsp-activity-offer">
    @switch (level()) {
      @case (1) { <h1 class="gcsp-activity-section-title">{{ heading() }}</h1> } @case (3) { <h3 class="gcsp-activity-section-title">{{ heading() }}</h3> }
      @case (4) { <h4 class="gcsp-activity-section-title">{{ heading() }}</h4> } @case (5) { <h5 class="gcsp-activity-section-title">{{ heading() }}</h5> }
      @case (6) { <h6 class="gcsp-activity-section-title">{{ heading() }}</h6> } @default { <h2 class="gcsp-activity-section-title">{{ heading() }}</h2> }
    }
    <div class="gcsp-activity-offer-grid"><div class="gcsp-activity-offer-visual"><div class="vm-card-media gcsp-activity-offer-media" [class.has-photo]="!!image() && !imageState().failed">
      @if (!imageState().failed && image(); as image) { @for (selected of [image]; track selected.src) { <img class="vm-card-photo" [src]="renderUrl(selected.src)" [alt]="selected.alt" (error)="failed($event)" /> }
        @if (caption()) { <span class="vm-media-caption">{{ caption() }}</span> }
      }
      <span class="vm-card-soon">No image for this car yet</span><span class="vm-card-line"></span>
    </div>
    @if (images().length > 1) { <div class="gcsp-activity-image-controls" role="group" aria-label="Vehicle images">@for (image of images(); track $index) { <button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" [attr.data-image]="$index" [attr.aria-pressed]="imageState().index === $index" (click)="select($index)">Image {{ $index + 1 }}</button> }</div> }
    </div><div class="gcsp-activity-offer-details">
      @if (display()?.title; as title) { @switch (nameLevel()) {
        @case (2) { <h2 class="gcsp-activity-offer-name">{{ title }}</h2> } @case (3) { <h3 class="gcsp-activity-offer-name">{{ title }}</h3> }
        @case (4) { <h4 class="gcsp-activity-offer-name">{{ title }}</h4> } @case (5) { <h5 class="gcsp-activity-offer-name">{{ title }}</h5> } @default { <h6 class="gcsp-activity-offer-name">{{ title }}</h6> }
      } }
      @if (stateText()) { <p class="gcsp-activity-offer-state">{{ stateText() }}</p> }
      @if (offer.href) { <a gcspButton class="vm-btn" [class.vm-btn-primary]="offer.state === 'active'" [class.vm-btn-ghost]="offer.state !== 'active'" [variant]="offer.state === 'active' ? 'primary' : 'ghost'" [href]="offer.href">View offer</a> }
    </div></div>
  </section> }
` })
export class ActivityOfferComponent {
  readonly offer = input<ActivityOffer | null>(null); readonly display = input<ActivityOfferDisplay | null>(null); readonly level = input(2);
  readonly images = computed(() => approvedActivityImages(this.display()?.images));
  private readonly selected = signal<{ key: string; index: number; failed: boolean } | null>(null);
  private readonly key = computed(() => JSON.stringify([this.offer()?.offerRef.offerId, this.images().map((image) => image.src)]));
  readonly imageState = computed(() => { const state = this.selected(); return state?.key === this.key() ? state : { key: this.key(), index: 0, failed: false }; });
  readonly image = computed(() => this.images()[this.imageState().index] ?? null); readonly caption = computed(() => { const caption = this.image()?.caption; return typeof caption === 'string' && caption.trim() ? caption : null; });
  readonly heading = computed(() => this.offer()?.state === 'active' ? 'Your buddy found a car' : 'Your offer'); readonly nameLevel = computed(() => Math.min(6, this.level() + 1));
  readonly stateText = computed(() => this.offer()?.state === 'active' ? respondBy(this.offer()) : this.offer() ? offerStateLabel(this.offer()!.state) : null);
  readonly renderUrl = vehicleImageUrl;
  select(index: number): void { if (this.images()[index]) this.selected.set({ key: this.key(), index, failed: false }); }
  failed(event: Event): void { if ((event.target as HTMLImageElement).parentElement) this.selected.set({ ...this.imageState(), failed: true }); }
}
