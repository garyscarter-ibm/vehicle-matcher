import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaWellComponent } from './media-well.component';

describe('source primary media well', () => {
  let fixture: ComponentFixture<MediaWellComponent>;
  const image = { src: '/assets/brand-hero/bmw.jpg', alt: 'BMW Touring', caption: 'BMW' };
  const host = () => fixture.nativeElement as HTMLElement;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MediaWellComponent] }).compileComponents();
    fixture = TestBed.createComponent(MediaWellComponent); fixture.componentRef.setInput('name', 'BMW Touring');
    fixture.componentRef.setInput('line', 'Order no. 0123456');
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });
  it('keeps identity and placeholder when no primary image is supplied', () => {
    fixture.detectChanges(); expect(host().querySelector('img')).toBeNull();
    expect(host().textContent).toContain('No image for this car yet'); expect(host().textContent).toContain('Order no. 0123456');
    expect(host().classList.contains('has-photo')).toBe(false);
  });
  it('uses approved primary metadata without adding gallery controls', () => {
    fixture.componentRef.setInput('image', image); fixture.detectChanges();
    expect(host().classList.contains('has-photo')).toBe(true);
    expect(host().querySelector('img')?.getAttribute('src')).toBe(image.src);
    expect(host().querySelector('img')?.alt).toBe('BMW Touring'); expect(host().querySelector('img')?.getAttribute('loading')).toBe('lazy');
    expect(host().querySelector('.vm-media-caption')?.textContent).toBe('BMW'); expect(host().querySelector('button')).toBeNull();
  });
  it('removes broken media and its caption while preserving the exact identity', () => {
    fixture.componentRef.setInput('image', image); fixture.detectChanges(); host().querySelector('img')!.dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(host().querySelector('img, .vm-media-caption')).toBeNull(); expect(host().classList.contains('has-photo')).toBe(false);
    expect(host().textContent).toContain('Order no. 0123456');
  });
  it('retains a broken-primary fallback across equivalent authoritative readbacks', () => {
    fixture.componentRef.setInput('image', image); fixture.detectChanges(); host().querySelector('img')!.dispatchEvent(new Event('error')); fixture.detectChanges();
    fixture.componentRef.setInput('image', { ...image }); fixture.detectChanges();
    expect(host().querySelector('img, .vm-media-caption')).toBeNull(); expect(host().classList.contains('has-photo')).toBe(false);
    expect(host().textContent).toContain('Order no. 0123456');
  });
  it('does not let a delayed error from an old primary remove its replacement', () => {
    fixture.componentRef.setInput('image', image); fixture.detectChanges(); const old = host().querySelector('img')!;
    fixture.componentRef.setInput('image', { ...image, alt: 'New read' }); fixture.detectChanges();
    old.dispatchEvent(new Event('error')); fixture.detectChanges(); expect(host().querySelector('img')?.alt).toBe('New read');
    fixture.componentRef.setInput('image', null); fixture.detectChanges(); expect(host().querySelector('img, .vm-media-caption')).toBeNull();
  });
  it.each(['https://unapproved.example/car.jpg', 'javascript:alert(1)'])('rejects an unapproved primary %s', (src) => {
    fixture.componentRef.setInput('image', { src, caption: 'Unapproved' }); fixture.detectChanges();
    expect(host().querySelector('img, .vm-media-caption')).toBeNull(); expect(host().classList.contains('has-photo')).toBe(false);
  });
});
