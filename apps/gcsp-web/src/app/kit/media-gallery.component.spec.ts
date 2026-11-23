import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaGalleryComponent, MediaGalleryImage } from './media-gallery.component';
import { VehicleDecisionComponent } from './vehicle-decision.component';

const imageA: MediaGalleryImage = { src: '/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp', label: 'Front view' };
const imageB: MediaGalleryImage = { src: '/api/gcsp/vehicle-images/bmw-display-07c269dd7f55fad0a56b.webp', alt: 'Rear of the supplied car', caption: 'Rear view', viewpoint: 'Rear' };
const imageC: MediaGalleryImage = { src: '/assets/gcsp-vehicle-evidence/01af2978ba13fd99e11d6477eb706e0648f67d5602bc72e8e20217908b235748.webp', label: 'Interior' };

@Component({
  imports: [MediaGalleryComponent],
  template: '<gcsp-media-gallery [name]="name()" [images]="images()" [placeholder]="placeholder" [compact]="compact()" />',
})
class GalleryHost {
  readonly name = signal('BMW X2 M35i');
  readonly images = signal<readonly MediaGalleryImage[]>([]);
  placeholder = 'No image is available';
  readonly compact = signal(false);
}

function stubDialog(dialog: HTMLDialogElement): void {
  Object.defineProperty(dialog, 'showModal', { configurable: true, value: () => dialog.setAttribute('open', '') });
  Object.defineProperty(dialog, 'close', { configurable: true, value: () => dialog.removeAttribute('open') });
}


const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((finish) => finish());
  vi.restoreAllMocks();
});

async function openedGallery() {
  const fixture = TestBed.createComponent(GalleryHost);
  fixture.componentInstance.images.set([imageA, imageB, imageC]);
  await fixture.whenStable();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  document.body.append(root);
  const priorOverflow = document.body.style.overflow;
  document.body.style.overflow = 'scroll';
  cleanup.push(() => {
    fixture.destroy();
    root.remove();
    document.body.style.overflow = priorOverflow;
  });
  const component = fixture.debugElement.query(By.directive(MediaGalleryComponent)).componentInstance as MediaGalleryComponent;
  const dialog = root.querySelector('dialog')!;
  stubDialog(dialog);
  const opener = root.querySelector<HTMLButtonElement>('.gcsp-media-gallery-enlarge')!;
  opener.click();
  fixture.detectChanges();
  return { fixture, root, component, dialog, opener };
}

describe('MediaGalleryComponent', () => {
  it('shows an empty placeholder and omits navigation for an empty or single-image gallery', async () => {
    const fixture = TestBed.createComponent(GalleryHost);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.vm-card-soon')?.textContent).toBe('No image is available');
    expect(root.querySelectorAll('button')).toHaveLength(0);

    fixture.componentInstance.images.set([{ ...imageA, alt: undefined }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.vm-card-photo')?.getAttribute('alt')).toBe('BMW X2 M35i, front view');
    expect(root.querySelectorAll('.gcsp-media-gallery-thumbs')).toHaveLength(0);
    expect(root.querySelectorAll('.gcsp-media-gallery-previous:not([hidden]), .gcsp-media-gallery-next:not([hidden])')).toHaveLength(0);
    expect(root.querySelectorAll('button')).toHaveLength(2);
    fixture.destroy();
  });

  it('shows a readable fallback for a supplied image with an empty source', async () => {
    const fixture = TestBed.createComponent(GalleryHost);
    fixture.componentInstance.images.set([{ ...imageA, src: '' }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.vm-card-photo')).toBeNull();
    expect(root.querySelector('.vm-card-soon')?.textContent).toBe('No image is available');
    expect(root.querySelector('.gcsp-media-gallery-feature')?.getAttribute('aria-busy')).toBeNull();
    expect(root.querySelector('.gcsp-media-gallery-enlarge')).toBeNull();
    fixture.destroy();
  });

  it('preserves selection across equivalent readback and clamps it after the supplied list changes', async () => {
    const fixture = TestBed.createComponent(GalleryHost);
    const host = fixture.componentInstance;
    const component = fixture.debugElement.query(By.directive(MediaGalleryComponent)).componentInstance as MediaGalleryComponent;
    host.images.set([imageA, imageB, imageC]);
    await fixture.whenStable();
    fixture.detectChanges();
    component.select(2);
    host.images.set([{ ...imageA }, { ...imageB }, { ...imageC }]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.selectedIndex()).toBe(2);

    host.images.set([imageA, imageB]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.selectedIndex()).toBe(1);
    component.select(-1);
    expect(component.selectedIndex()).toBe(1);
    fixture.destroy();
  });

  it('keeps failed images selectable and replaces failed feature and thumbnail chrome with readable text', async () => {
    const fixture = TestBed.createComponent(GalleryHost);
    fixture.componentInstance.images.set([imageA, imageB]);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const component = fixture.debugElement.query(By.directive(MediaGalleryComponent)).componentInstance as MediaGalleryComponent;
    component.select(1);
    fixture.detectChanges();
    const selectedThumb = root.querySelectorAll<HTMLButtonElement>('.gcsp-media-gallery-thumbs .gcsp-media-gallery-thumb')[1];
    selectedThumb.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(component.selectedIndex()).toBe(1);
    expect(selectedThumb.getAttribute('aria-pressed')).toBe('true');
    expect(selectedThumb.querySelector('img')).toBeNull();
    expect(selectedThumb.classList.contains('is-unavailable')).toBe(true);
    expect(root.querySelector('.vm-card-soon')?.textContent).toBe('Image unavailable. Choose another view.');
    expect(root.querySelector<HTMLButtonElement>('.gcsp-media-gallery-enlarge')?.hidden).toBe(true);
    fixture.destroy();
  });

  it('opens the enlarged native dialog, wraps controls and arrow keys, and restores focus and body scrolling', async () => {
    document.body.style.overflow = 'scroll';
    const fixture = TestBed.createComponent(GalleryHost);
    fixture.componentInstance.images.set([imageA, imageB, imageC]);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.append(root);
    const component = fixture.debugElement.query(By.directive(MediaGalleryComponent)).componentInstance as MediaGalleryComponent;
    const dialog = root.querySelector('dialog')!;
    stubDialog(dialog);
    const enlarge = root.querySelector<HTMLButtonElement>('.gcsp-media-gallery-enlarge')!;
    enlarge.click();
    fixture.detectChanges();

    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
    expect(dialog.querySelector('button[aria-label="Close image viewer"]')).not.toBeNull();
    expect(document.activeElement).toBe(dialog.querySelector('button[aria-label="Close image viewer"]'));
    expect(dialog.querySelectorAll('.gcsp-media-gallery-strip .gcsp-media-gallery-thumb')).toHaveLength(3);
    const close = dialog.querySelector<HTMLButtonElement>('[aria-label="Close image viewer"]')!;
    const last = dialog.querySelectorAll<HTMLButtonElement>('.gcsp-media-gallery-strip .gcsp-media-gallery-thumb')[2];
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
    enlarge.focus();
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe('hidden');

    dialog.querySelector<HTMLButtonElement>('[aria-label="Previous image"]')!.click();
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(2);
    expect(dialog.querySelector('.gcsp-media-gallery-position')?.textContent?.trim()).toBe('3 of 3');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(0);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(enlarge);
    expect(document.body.style.overflow).toBe('scroll');
    root.remove();
    fixture.destroy();
    document.body.style.overflow = '';
  });


  it('closes the previous viewer when images clear and allows the replacement gallery to open', async () => {
    const { fixture, root, component, dialog } = await openedGallery();
    fixture.componentInstance.images.set([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(component.viewerOpen()).toBe(false);
    expect(document.body.style.overflow).toBe('scroll');
    expect(root.querySelector('.vm-card-soon')).not.toBeNull();
    expect(root.querySelector('dialog[open]')).toBeNull();

    fixture.componentInstance.images.set([imageC]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.gcsp-media-gallery-enlarge')!.click();
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(component.viewerOpen()).toBe(true);
    expect(dialog.querySelector('button[aria-label="Close image viewer"]')).not.toBeNull();
  });

  it('closes changed image content and restores focus to a connected opener', async () => {
    const { fixture, component, dialog, opener } = await openedGallery();
    const focus = vi.spyOn(opener, 'focus');
    fixture.componentInstance.images.set([imageC, imageB, imageA]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(component.viewerOpen()).toBe(false);
    expect(document.body.style.overflow).toBe('scroll');
    expect(focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
    expect(component.currentImage()).toEqual({ ...imageC, alt: 'BMW X2 M35i, interior' });
  });

  it('closes a changed vehicle name even when its image readback is unchanged', async () => {
    const { fixture, component, dialog } = await openedGallery();
    fixture.componentInstance.name.set('BMW iX1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    expect(component.viewerOpen()).toBe(false);
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('never focuses a detached opener when changed content closes the viewer', async () => {
    const { fixture, root, component, dialog, opener } = await openedGallery();
    const focus = vi.spyOn(opener, 'focus');
    root.remove();
    fixture.componentInstance.images.set([]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(dialog.open).toBe(false);
    expect(component.viewerOpen()).toBe(false);
    expect(document.body.style.overflow).toBe('scroll');
    expect(focus).not.toHaveBeenCalled();
    expect(opener.isConnected).toBe(false);
  });

  it('keeps the selected view and viewer open across equivalent cloned readback', async () => {
    const { fixture, component, dialog } = await openedGallery();
    component.select(2);
    fixture.detectChanges();
    fixture.componentInstance.images.set([{ ...imageA }, { ...imageB }, { ...imageC }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(2);
    expect(component.viewerOpen()).toBe(true);
    expect(dialog.open).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(dialog.querySelector('.gcsp-media-gallery-position')?.textContent?.trim()).toBe('3 of 3');
  });

  it('synchronizes native close and ignores an old close event after reopening', async () => {
    const { fixture, component, dialog, opener } = await openedGallery();
    dialog.close();
    dialog.dispatchEvent(new Event('close'));
    fixture.detectChanges();
    expect(component.viewerOpen()).toBe(false);
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.activeElement).toBe(opener);

    opener.click();
    fixture.detectChanges();
    component.closeViewer();
    opener.click();
    fixture.detectChanges();
    dialog.dispatchEvent(new Event('close'));
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(component.viewerOpen()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('navigates healthy images while failed views stay selectable with a closeable fallback', async () => {
    const { fixture, component, dialog } = await openedGallery();
    component.markFailed(imageB);
    fixture.detectChanges();
    dialog.querySelector<HTMLButtonElement>('[aria-label="Next image"]')!.click();
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(2);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(0);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(2);

    component.markFailed(imageA);
    fixture.detectChanges();
    expect(dialog.querySelectorAll('.gcsp-media-gallery-previous:not([hidden]), .gcsp-media-gallery-next:not([hidden])')).toHaveLength(0);
    dialog.querySelectorAll<HTMLButtonElement>('.gcsp-media-gallery-thumb')[1].click();
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(1);
    expect(dialog.querySelector('.gcsp-media-gallery-unavailable')?.textContent).toBe('Image unavailable');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(2);
    component.markFailed(imageC);
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.gcsp-media-gallery-unavailable')?.textContent).toBe('Image unavailable');
    expect(dialog.querySelectorAll('.gcsp-media-gallery-previous:not([hidden]), .gcsp-media-gallery-next:not([hidden])')).toHaveLength(0);
    dialog.querySelector<HTMLButtonElement>('[aria-label="Close image viewer"]')!.click();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
  });

  it('names image-only picker buttons without painting view labels', async () => {
    const fixture = TestBed.createComponent(MediaGalleryComponent);
    fixture.componentRef.setInput('name', 'BMW X2 M35i');
    fixture.componentRef.setInput('images', [imageA, imageB, imageC]);
    fixture.componentRef.setInput('presentation', 'picker');
    await fixture.whenStable();
    cleanup.push(() => fixture.destroy());
    const root = fixture.nativeElement as HTMLElement;
    const thumbs = root.querySelectorAll<HTMLButtonElement>('.gcsp-media-gallery-thumbs .gcsp-media-gallery-thumb');
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0].getAttribute('aria-label')).toBe('Front view of BMW X2 M35i');
    expect(thumbs[0].getAttribute('aria-pressed')).toBe('true');
    for (const thumb of Array.from(thumbs)) {
      expect(thumb.textContent?.trim()).toBe('');
      expect(thumb.querySelector('img')?.getAttribute('alt')).toBe('');
    }
    expect(root.querySelector('.gcsp-media-gallery-enlarge svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('closes without returning focus to an opener when destroyed', async () => {
    const fixture = TestBed.createComponent(GalleryHost);
    fixture.componentInstance.images.set([imageA]);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.append(root);
    const dialog = root.querySelector('dialog')!;
    stubDialog(dialog);
    const opener = root.querySelector<HTMLButtonElement>('.gcsp-media-gallery-enlarge')!;
    const focus = vi.spyOn(opener, 'focus');
    opener.click();
    fixture.detectChanges();
    fixture.destroy();

    expect(dialog.open).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    root.remove();
  });
});

describe('compact stock media', () => {
  it('retains the supplied primary image and fallback without card picker or enlarge controls', async () => {
    const fixture = TestBed.createComponent(GalleryHost); fixture.componentInstance.compact.set(true);
    fixture.componentInstance.images.set([imageA, imageB]); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.gcsp-media-gallery')?.classList.contains('is-compact')).toBe(true);
    expect(root.querySelector('.vm-card-photo')?.getAttribute('src')).toBe(imageA.src);
    expect(root.querySelector('.gcsp-media-gallery-enlarge, .gcsp-media-gallery-thumbs, .vm-media-caption')).toBeNull();
    root.querySelector('img')!.dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(root.querySelector('.vm-card-soon')?.textContent).toBe('Image unavailable. Choose another view.'); fixture.destroy();
  });
  it('closes an existing viewer on compact transition and guards programmatic opening', async () => {
    const { fixture, component, dialog } = await openedGallery();
    expect(dialog.open).toBe(true); fixture.componentInstance.compact.set(true); await fixture.whenStable(); fixture.detectChanges();
    expect(dialog.open).toBe(false); expect(component.viewerOpen()).toBe(false); expect(document.body.style.overflow).toBe('scroll');
    component.openViewer(); expect(dialog.open).toBe(false);
  });
});


@Component({
  imports: [VehicleDecisionComponent, MediaGalleryComponent],
  template: '<gcsp-vehicle-decision name="BMW X2" layout="focused"><gcsp-media-gallery decisionMedia name="BMW X2" [images]="images" /></gcsp-vehicle-decision>',
})
class DecisionMediaHost { readonly images = [imageA]; }

describe('source media projection and DOM', () => {
  it('makes the actual Angular host the direct source decision media root', async () => {
    const fixture = TestBed.createComponent(DecisionMediaHost); await fixture.whenStable();
    cleanup.push(() => fixture.destroy());
    const root = fixture.nativeElement as HTMLElement;
    const media = root.querySelector('.gcsp-vehicle-decision > .gcsp-media-gallery');
    expect(media?.tagName).toBe('GCSP-MEDIA-GALLERY');
    expect(media?.querySelector(':scope > .gcsp-media-gallery-feature > .vm-card-media.gcsp-media-whole > img.vm-card-photo')).not.toBeNull();
    expect(media?.querySelector(':scope > dialog.gcsp-media-gallery-dialog')).not.toBeNull();
    expect(media?.querySelector('.gcsp-media-gallery')).toBeNull();
  });

  it('filters before indexing, keeps first-source deduplication, and uses source label/alt defaults', async () => {
    const fixture = TestBed.createComponent(GalleryHost);
    fixture.componentInstance.images.set([
      { src: 'https://images.example/rejected.webp', label: 'Rejected' },
      { ...imageA, fidelity: 'exact' }, { ...imageA, fidelity: 'representative-model' },
      { ...imageB, fidelity: '', label: undefined, alt: undefined, viewpoint: 'Ignored viewpoint' },
      { ...imageC, fidelity: 'representative-model', alt: '' }, { ...imageB, label: 'Duplicate' },
      { src: '/assets/brand-hero/bmw.jpg', fidelity: 'representative' },
    ]);
    await fixture.whenStable(); cleanup.push(() => fixture.destroy());
    const root = fixture.nativeElement as HTMLElement;
    const component = fixture.debugElement.query(By.directive(MediaGalleryComponent)).componentInstance as MediaGalleryComponent;
    const thumbs = root.querySelectorAll('.gcsp-media-gallery-thumbs button');
    expect(Array.from(thumbs, thumb => thumb.getAttribute('aria-label'))).toEqual(['View 1 of BMW X2 M35i', 'Interior of BMW X2 M35i', 'View 3 of BMW X2 M35i']);
    expect(root.querySelector('.vm-card-photo')?.getAttribute('src')).toBe(imageB.src);
    expect(root.querySelector('.vm-card-photo')?.getAttribute('alt')).toBe('BMW X2 M35i, view 1');
    component.select(-1); fixture.detectChanges(); expect(component.selectedIndex()).toBe(2);
    expect(root.querySelector('.vm-card-photo')?.getAttribute('src')).toBe('/assets/brand-hero/bmw.jpg');
    component.select(7); fixture.detectChanges(); expect(component.selectedIndex()).toBe(1);
    expect(root.querySelector('.vm-card-photo')?.getAttribute('src')).toBe(imageC.src);
    component.select(1.5); expect(component.selectedIndex()).toBe(1);
  });

  it.each([
    [undefined, true], ['', true], ['representative-model', true], ['exact', false],
  ] as const)('applies gallery missing-fidelity fallback without accepting explicit %s', async (fidelity, wanted) => {
    const fixture = TestBed.createComponent(GalleryHost); fixture.componentInstance.images.set([{ ...imageC, fidelity }]);
    await fixture.whenStable(); cleanup.push(() => fixture.destroy());
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.vm-card-photo') !== null).toBe(wanted);
  });

  it.each([[undefined, true], ['', true], ['representative', true], ['representative-model', false], ['exact', false]] as const)('limits the hero exception to source fidelity %s', async (fidelity, wanted) => {
    const fixture = TestBed.createComponent(GalleryHost); fixture.componentInstance.images.set([{ src: '/assets/brand-hero/bmw.jpg', fidelity }]);
    await fixture.whenStable(); cleanup.push(() => fixture.destroy());
    expect((fixture.nativeElement as HTMLElement).querySelector('.vm-card-photo') !== null).toBe(wanted);
  });

  it('retains source default thumbnail labels, contain classes and separate feature/viewer loading states', async () => {
    const fixture = TestBed.createComponent(MediaGalleryComponent);
    fixture.componentRef.setInput('name', 'BMW'); fixture.componentRef.setInput('images', [imageA, imageB]); fixture.componentRef.setInput('fit', 'contain');
    await fixture.whenStable(); cleanup.push(() => fixture.destroy());
    const root = fixture.nativeElement as HTMLElement;
    expect(root.classList.contains('gcsp-media-gallery-whole')).toBe(true);
    expect(root.querySelector('.gcsp-media-gallery-thumbs button span')?.textContent).toBe('Front view');
    expect(root.querySelector('.gcsp-media-gallery-feature')?.getAttribute('aria-busy')).toBe('true');
    root.querySelector('.vm-card-photo')!.dispatchEvent(new Event('load')); fixture.detectChanges();
    expect(root.querySelector('.gcsp-media-gallery-feature')?.getAttribute('aria-busy')).toBe('false');
    const dialog = root.querySelector('dialog')!; stubDialog(dialog);
    root.querySelector<HTMLButtonElement>('.gcsp-media-gallery-enlarge')!.click(); fixture.detectChanges();
    expect(dialog.querySelector('.gcsp-media-gallery-large-well > .gcsp-skeleton.gcsp-media-gallery-large-loading')).not.toBeNull();
    dialog.querySelector('.gcsp-media-gallery-large')!.dispatchEvent(new Event('load')); fixture.detectChanges();
    expect(dialog.querySelector('.gcsp-media-gallery-large-loading')).toBeNull();
  });
});
