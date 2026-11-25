import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ButtonDirective } from './button.directive';
import { isDisplayImage } from './vehicle-image-assets';

export interface MediaGalleryImage {
  readonly src: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly fidelity?: string;
  readonly sourceRef?: string;
  readonly viewpoint?: string;
  readonly label?: string;
}

let mediaGallerySequence = 0;

const IMAGE_FIELDS: readonly (keyof MediaGalleryImage)[] = ['src', 'alt', 'caption', 'fidelity', 'sourceRef', 'viewpoint', 'label'];
function sameImages(left: readonly MediaGalleryImage[], right: readonly MediaGalleryImage[]): boolean {
  return left.length === right.length && left.every((image, index) =>
    IMAGE_FIELDS.every((field) => image[field] === right[index][field]));
}

@Component({
  selector: 'gcsp-media-gallery',
  standalone: true,
  imports: [ButtonDirective, NgTemplateOutlet],
  templateUrl: './media-gallery.component.html',
  styleUrl: './media-gallery.component.css',
  host: {
    class: 'gcsp-media-gallery',
    '[class.gcsp-media-gallery-picker]': 'presentation() === "picker"',
    '[class.gcsp-media-gallery-whole]': 'fit() === "contain"',
    '[class.is-compact]': 'compact()',
    role: 'group',
    '[attr.aria-label]': 'name() + " images"',
  },
})
export class MediaGalleryComponent implements OnDestroy {
  readonly name = input.required<string>();
  readonly images = input<readonly MediaGalleryImage[]>([]);
  readonly placeholder = input('No image for this car yet');
  readonly compact = input(false);
  readonly presentation = input<'default' | 'picker'>('default');
  readonly fit = input<'cover' | 'contain'>('cover');
  readonly displayImages = computed<readonly MediaGalleryImage[]>(() => {
    const source = Array.isArray(this.images()) ? this.images() : [];
    return source.filter((image, index) => image && typeof image.src === 'string'
      && (isDisplayImage(image.src, image.fidelity)
        || !image.fidelity && ['representative-configuration', 'representative-model'].some(fidelity => isDisplayImage(image.src, fidelity))
        || image.src === '/assets/brand-hero/bmw.jpg' && (!image.fidelity || image.fidelity === 'representative'))
      && source.findIndex(other => other?.src === image.src) === index)
      .map((image, index) => ({ ...image,
        label: image.label || (source.length === 1 ? 'Vehicle image' : `View ${index + 1}`),
        alt: image.alt || `${this.name()}, ${(image.label || `view ${index + 1}`).toLowerCase()}`,
      }));
  }, { equal: sameImages });
  readonly selectedIndex = signal(0);
  readonly currentImage = computed(() => this.displayImages()[this.selectedIndex()] ?? null);
  readonly failedIndices = signal<ReadonlySet<number>>(new Set());
  readonly healthyImageCount = computed(() => this.displayImages().filter((_, index) => !this.isFailed(index)).length);
  readonly featureLoading = signal(true);
  readonly viewerLoading = signal(false);
  readonly viewerOpen = signal(false);
  readonly viewerTitleId = `gcsp-media-viewer-title-${++mediaGallerySequence}`;

  @ViewChild('viewer', { static: true }) private viewerRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('enlargeButton', { static: false }) private enlargeButtonRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('viewerClose', { static: false }) private viewerCloseRef?: ElementRef<HTMLButtonElement>;
  private readonly document = inject(DOCUMENT);
  private previousImages: readonly MediaGalleryImage[] | null = null;
  private previousName: string | null = null;
  private opener: HTMLElement | null = null;
  private previousBodyOverflow: string | null = null;
  private destroyed = false;

  constructor() {
    effect(() => { if (this.compact()) untracked(() => { this.closeViewer(false); this.select(0); }); });
    effect(() => {
      const images = this.images();
      const name = this.name();
      if (!this.previousImages || this.previousName !== name || !sameImages(this.previousImages, images)) {
        untracked(() => {
          this.closeViewer();
          const displayed = this.displayImages();
          this.selectedIndex.set(displayed.length ? Math.min(this.selectedIndex(), displayed.length - 1) : 0);
          this.failedIndices.set(new Set());
          this.featureLoading.set(Boolean(displayed[this.selectedIndex()]));
          this.viewerLoading.set(false);
        });
      }
      this.previousImages = images.map((image) => ({ ...image }));
      this.previousName = name;
    });
  }

  select(index: number): void {
    const images = this.displayImages();
    if (this.destroyed || !Number.isInteger(index) || !images.length) return;
    const selected = (index % images.length + images.length) % images.length;
    if (this.selectedIndex() !== selected) {
      this.selectedIndex.set(selected);
      this.featureLoading.set(!this.isFailed(selected));
      this.viewerLoading.set(this.viewerOpen() && !this.isFailed(selected));
    }
  }

  viewLabel(image: MediaGalleryImage, index: number): string {
    return image.label || (this.images().length === 1 ? 'Vehicle image' : `View ${index + 1}`);
  }

  onFeatureLoad(image: MediaGalleryImage): void {
    if (this.currentImage() === image) this.featureLoading.set(false);
  }

  onViewerLoad(image: MediaGalleryImage): void {
    if (this.currentImage() === image) this.viewerLoading.set(false);
  }

  isFailed(index: number): boolean {
    return !this.displayImages()[index] || this.failedIndices().has(index);
  }

  markFailed(image: MediaGalleryImage): void {
    const displayed = this.displayImages();
    const index = displayed.indexOf(image) >= 0 ? displayed.indexOf(image)
      : this.images().includes(image) ? displayed.findIndex(view => view.src === image.src) : -1;
    if (index < 0) return;
    const failed = new Set(this.failedIndices());
    failed.add(index);
    this.failedIndices.set(failed);
    if (index === this.selectedIndex()) {
      this.featureLoading.set(false);
      this.viewerLoading.set(false);
    }
  }

  openViewer(): void {
    const image = this.currentImage();
    if (this.compact() || !image || this.isFailed(this.selectedIndex()) || this.viewerOpen() || this.destroyed) return;
    const dialog = this.viewerRef.nativeElement;
    this.opener = this.enlargeButtonRef?.nativeElement ?? null;
    this.previousBodyOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      this.viewerOpen.set(true);
      this.viewerLoading.set(true);
      this.document.addEventListener('keydown', this.onKey);
      this.document.addEventListener('focusin', this.containFocus);
      this.viewerCloseRef?.nativeElement.focus({ preventScroll: true });
    } catch (error) {
      this.document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
      this.opener = null;
      throw error;
    }
  }

  closeViewer(restoreFocus = true): void {
    if (!this.viewerOpen()) return;
    const dialog = this.viewerRef.nativeElement;
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    }
    this.finishViewerClose(restoreFocus);
  }

  onViewerClose(): void {
    // Native close events are queued; an old event must not close a reopened viewer.
    if (!this.viewerRef.nativeElement.open) this.finishViewerClose(true);
  }

  onCancel(event: Event): void {
    event.preventDefault();
    this.closeViewer();
  }

  onViewerKeydown(event: KeyboardEvent): void {
    if (!this.viewerOpen()) return;
    if (event.key === 'Escape') { this.onCancel(event); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); this.step(event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Tab') {
      const dialog = this.viewerRef.nativeElement;
      const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).filter(control => !control.disabled && !control.hidden);
      const active = this.document.activeElement;
      if (event.shiftKey && (!dialog.contains(active) || active === controls[0])) {
        event.preventDefault(); controls.at(-1)?.focus();
      } else if (!event.shiftKey && (!dialog.contains(active) || active === controls.at(-1))) {
        event.preventDefault(); controls[0]?.focus();
      }
    }
  }

  step(direction: -1 | 1): void {
    const length = this.displayImages().length;
    for (let distance = 1; distance <= length; distance += 1) {
      const index = (this.selectedIndex() + direction * distance + length) % length;
      if (!this.isFailed(index)) { this.select(index); return; }
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.closeViewer(false);
  }

  private readonly onKey = (event: KeyboardEvent): void => this.onViewerKeydown(event);
  private readonly containFocus = (event: FocusEvent): void => {
    if (this.viewerOpen() && !this.viewerRef.nativeElement.contains(event.target as Node)) this.viewerCloseRef?.nativeElement.focus({ preventScroll: true });
  };

  private finishViewerClose(restoreFocus: boolean): void {
    if (!this.viewerOpen()) return;
    this.viewerOpen.set(false);
    this.document.removeEventListener('keydown', this.onKey);
    this.document.removeEventListener('focusin', this.containFocus);
    this.document.body.style.overflow = this.previousBodyOverflow ?? '';
    this.previousBodyOverflow = null;
    const opener = this.opener;
    this.opener = null;
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  }
}
