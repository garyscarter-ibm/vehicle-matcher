import { Component, computed, input, signal } from '@angular/core';
import type { MediaGalleryImage } from './media-gallery.component';
import { isDisplayImage } from './vehicle-image-assets';

/** The frozen exact card's single primary image; gallery selection belongs to MediaGallery. */
@Component({ selector: 'gcsp-media-well', host: {
  class: 'vm-card-media', '[class.has-photo]': 'visibleImage() !== null',
}, template: `
  @for (photo of visibleImage() ? [visibleImage()!] : []; track imageKey(photo)) {
    <img class="vm-card-photo" [src]="photo.src" [alt]="photo.alt || name()" loading="lazy" (error)="failed(photo)" />
  }
  <span class="vm-card-soon">{{ placeholder() }}</span>
  <span class="vm-card-line">{{ line() }}</span>
  @if (visibleImage()?.caption; as caption) { <span class="vm-media-caption">{{ caption }}</span> }
` })
export class MediaWellComponent {
  readonly name = input.required<string>();
  readonly line = input('');
  readonly image = input<MediaGalleryImage | null>(null);
  readonly placeholder = input('No image for this car yet');
  private readonly failedImageKey = signal<string | null>(null);
  readonly visibleImage = computed(() => {
    const image = this.image();
    if (!image || this.imageKey(image) === this.failedImageKey()) return null;
    const allowed = isDisplayImage(image.src, image.fidelity)
      || !image.fidelity && ['representative-configuration', 'representative-model'].some(fidelity => isDisplayImage(image.src, fidelity))
      || image.src === '/assets/brand-hero/bmw.jpg' && (!image.fidelity || image.fidelity === 'representative');
    return allowed ? image : null;
  });
  readonly imageKey = (image: MediaGalleryImage): string => JSON.stringify([image.src, image.alt, image.caption, image.fidelity]);
  failed(image: MediaGalleryImage): void {
    const current = this.image();
    if (current && this.imageKey(current) === this.imageKey(image)) this.failedImageKey.set(this.imageKey(image));
  }
}
