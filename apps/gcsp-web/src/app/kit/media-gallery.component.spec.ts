import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { MediaGalleryComponent, MediaGalleryImage } from './media-gallery.component';

const imageA: MediaGalleryImage = { src: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', label: 'Front view' };
const imageB: MediaGalleryImage = { src: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=2', alt: 'Rear of the supplied car', caption: 'Rear view', viewpoint: 'Rear' };
const imageC: MediaGalleryImage = { src: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=3', label: 'Interior' };

@Component({
  imports: [MediaGalleryComponent],
  template: '<gcsp-media-gallery [name]="name" [images]="images()" [placeholder]="placeholder" />',
})
class GalleryHost {
  readonly name = 'BMW X2 M35i';
  readonly images = signal<readonly MediaGalleryImage[]>([]);
  placeholder = 'No image is available';
}

function stubDialog(dialog: HTMLDialogElement): void {
  Object.defineProperty(dialog, 'showModal', { configurable: true, value: () => dialog.setAttribute('open', '') });
  Object.defineProperty(dialog, 'close', { configurable: true, value: () => dialog.removeAttribute('open') });
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
