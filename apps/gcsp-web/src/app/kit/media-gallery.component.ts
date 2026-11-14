import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, input, signal } from '@angular/core';
import { ButtonDirective } from './button.directive';

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
  imports: [ButtonDirective],
  templateUrl: './media-gallery.component.html',
  styleUrl: './media-gallery.component.css',
})
export class MediaGalleryComponent implements OnDestroy {
  readonly name = input.required<string>();
  readonly images = input<readonly MediaGalleryImage[]>([]);
  readonly placeholder = input('Image not supplied');
  readonly selectedIndex = signal(0);
  readonly currentImage = computed(() => this.images()[this.selectedIndex()] ?? null);
  readonly failedIndices = signal<ReadonlySet<number>>(new Set());
  readonly featureLoading = signal(true);
  readonly viewerOpen = signal(false);
  readonly viewerTitleId = `gcsp-media-viewer-title-${++mediaGallerySequence}`;

  @ViewChild('viewer', { static: true }) private viewerRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('enlargeButton', { static: false }) private enlargeButtonRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('viewerClose', { static: false }) private viewerCloseRef?: ElementRef<HTMLButtonElement>;
  private readonly document = inject(DOCUMENT);
  private previousImages: readonly MediaGalleryImage[] | null = null;
  private opener: HTMLElement | null = null;
  private previousBodyOverflow: string | null = null;
  private destroyed = false;

  constructor() {
    effect(() => {
      const images = this.images();
      if (!this.previousImages || !sameImages(this.previousImages, images)) {
        this.selectedIndex.set(images.length ? Math.min(this.selectedIndex(), images.length - 1) : 0);
        this.failedIndices.set(new Set());
        this.featureLoading.set(Boolean(images[this.selectedIndex()]?.src.trim()));
      }
      this.previousImages = images.map((image) => ({ ...image }));
    });
  }

  select(index: number): void {
    const images = this.images();
    if (this.destroyed || !Number.isInteger(index) || index < 0 || index >= images.length) return;
    if (this.selectedIndex() !== index) {
      this.selectedIndex.set(index);
      this.featureLoading.set(!this.isFailed(index));
    }
  }

  viewLabel(image: MediaGalleryImage, index: number): string {
    return image.label || image.viewpoint || `View ${index + 1}`;
  }

  onFeatureLoad(image: MediaGalleryImage): void {
    if (this.currentImage() === image) this.featureLoading.set(false);
  }

  isFailed(index: number): boolean {
    const image = this.images()[index];
    return !image?.src.trim() || this.failedIndices().has(index);
  }

  markFailed(image: MediaGalleryImage): void {
    const index = this.images().indexOf(image);
    if (index < 0) return;
    const failed = new Set(this.failedIndices());
    failed.add(index);
    this.failedIndices.set(failed);
    if (index === this.selectedIndex()) this.featureLoading.set(false);
  }

  openViewer(): void {
    const image = this.currentImage();
    if (!image || this.isFailed(this.selectedIndex()) || this.viewerOpen() || this.destroyed) return;
    const dialog = this.viewerRef.nativeElement;
    this.opener = this.enlargeButtonRef?.nativeElement ?? null;
    this.previousBodyOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
    try {
      dialog.showModal();
      this.viewerOpen.set(true);
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
    if (dialog.open) dialog.close();
    this.finishViewerClose(restoreFocus);
  }

  onCancel(event: Event): void {
    event.preventDefault();
    this.closeViewer();
  }

  onViewerKeydown(event: KeyboardEvent): void {
    if (!this.viewerOpen() || this.images().length < 2) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(event.key === 'ArrowRight' ? 1 : -1);
    }
  }

  step(direction: -1 | 1): void {
    const length = this.images().length;
    if (length < 2) return;
    this.select((this.selectedIndex() + direction + length) % length);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.closeViewer(false);
  }

  private finishViewerClose(restoreFocus: boolean): void {
    if (!this.viewerOpen()) return;
    this.viewerOpen.set(false);
    this.document.body.style.overflow = this.previousBodyOverflow ?? '';
    this.previousBodyOverflow = null;
    const opener = this.opener;
    this.opener = null;
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  }
}
