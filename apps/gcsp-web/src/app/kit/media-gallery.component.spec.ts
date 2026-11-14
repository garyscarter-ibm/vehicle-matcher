import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaGalleryComponent, MediaGalleryImage } from './media-gallery.component';

const imageA: MediaGalleryImage = { src: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', label: 'Front view' };
const imageB: MediaGalleryImage = { src: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=2', alt: 'Rear of the supplied car', caption: 'Rear view', viewpoint: 'Rear' };
const imageC: MediaGalleryImage = { src: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=3', label: 'Interior' };

@Component({
  imports: [MediaGalleryComponent],
  template: '<gcsp-media-gallery [name]="name()" [images]="images()" [placeholder]="placeholder" />',
})
class GalleryHost {
  readonly name = signal('BMW X2 M35i');
  readonly images = signal<readonly MediaGalleryImage[]>([]);
  placeholder = 'No image is available';
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
  const opener = root.querySelector<HTMLButtonElement>('.gcsp-media-enlarge')!;
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
    expect(root.querySelector('.gcsp-media-placeholder')?.textContent).toBe('No image is available');
    expect(root.querySelectorAll('button')).toHaveLength(0);

    fixture.componentInstance.images.set([{ ...imageA, alt: undefined }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.gcsp-media-feature-image')?.getAttribute('alt')).toBe('BMW X2 M35i');
    expect(root.querySelectorAll('.gcsp-media-thumbnails')).toHaveLength(0);
    expect(root.querySelectorAll('.gcsp-media-viewer-previous, .gcsp-media-viewer-next')).toHaveLength(0);
    expect(root.querySelectorAll('button')).toHaveLength(2);
    fixture.destroy();
  });

  it('shows a readable fallback for a supplied image with an empty source', async () => {
    const fixture = TestBed.createComponent(GalleryHost);
    fixture.componentInstance.images.set([{ ...imageA, src: '' }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.gcsp-media-feature-image')).toBeNull();
    expect(root.querySelector('.gcsp-media-unavailable')?.textContent).toBe('Image unavailable');
    expect(root.querySelector('.gcsp-media-feature')?.getAttribute('aria-busy')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('.gcsp-media-enlarge')?.disabled).toBe(true);
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
    const selectedThumb = root.querySelectorAll<HTMLButtonElement>('.gcsp-media-thumbnails .gcsp-media-thumb')[1];
    selectedThumb.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(component.selectedIndex()).toBe(1);
    expect(selectedThumb.getAttribute('aria-pressed')).toBe('true');
    expect(selectedThumb.querySelector('img')).toBeNull();
    expect(selectedThumb.textContent).toContain('Image unavailable');
    expect(root.querySelector('.gcsp-media-unavailable')?.textContent).toBe('Image unavailable');
    expect(root.querySelector<HTMLButtonElement>('.gcsp-media-enlarge')?.disabled).toBe(true);
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
    const enlarge = root.querySelector<HTMLButtonElement>('.gcsp-media-enlarge')!;
    enlarge.click();
    fixture.detectChanges();

    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
    expect(dialog.querySelector('button[aria-label="Close image viewer"]')).not.toBeNull();
    expect(document.activeElement).toBe(dialog.querySelector('button[aria-label="Close image viewer"]'));
    expect(dialog.querySelectorAll('.gcsp-media-viewer-thumbnails .gcsp-media-thumb')).toHaveLength(3);
    expect(document.body.style.overflow).toBe('hidden');

    dialog.querySelector<HTMLButtonElement>('[aria-label="Previous image"]')!.click();
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(2);
    expect(dialog.querySelector('.gcsp-media-counter')?.textContent?.trim()).toBe('3 of 3');
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
    expect(root.querySelector('.gcsp-media-placeholder')).not.toBeNull();
    expect(root.querySelector('dialog[open]')).toBeNull();

    fixture.componentInstance.images.set([imageC]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.gcsp-media-enlarge')!.click();
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
    expect(component.currentImage()).toEqual(imageC);
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
    expect(dialog.querySelector('.gcsp-media-counter')?.textContent?.trim()).toBe('3 of 3');
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
    expect(dialog.querySelectorAll('.gcsp-media-viewer-previous, .gcsp-media-viewer-next')).toHaveLength(0);
    dialog.querySelectorAll<HTMLButtonElement>('.gcsp-media-thumb')[1].click();
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(1);
    expect(dialog.querySelector('.gcsp-media-unavailable')?.textContent).toBe('Image unavailable');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.selectedIndex()).toBe(2);
    component.markFailed(imageC);
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.gcsp-media-unavailable')?.textContent).toBe('Image unavailable');
    expect(dialog.querySelectorAll('.gcsp-media-viewer-previous, .gcsp-media-viewer-next')).toHaveLength(0);
    dialog.querySelector<HTMLButtonElement>('[aria-label="Close image viewer"]')!.click();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
  });

  it('names image-only picker buttons without painting view labels', async () => {
    const { root } = await openedGallery();
    const thumbs = root.querySelectorAll<HTMLButtonElement>('.gcsp-media-thumbnails .gcsp-media-thumb');
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0].getAttribute('aria-label')).toBe('Front view of BMW X2 M35i');
    expect(thumbs[0].getAttribute('aria-pressed')).toBe('true');
    for (const thumb of Array.from(thumbs)) {
      expect(thumb.textContent?.trim()).toBe('');
      expect(thumb.querySelector('img')?.getAttribute('alt')).toBe('');
    }
    expect(root.querySelector('.gcsp-media-enlarge svg[aria-hidden="true"]')).not.toBeNull();
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
    const opener = root.querySelector<HTMLButtonElement>('.gcsp-media-enlarge')!;
    const focus = vi.spyOn(opener, 'focus');
    opener.click();
    fixture.detectChanges();
    fixture.destroy();

    expect(dialog.open).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    root.remove();
  });
});
