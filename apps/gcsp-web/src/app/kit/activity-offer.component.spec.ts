import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ActivityOfferComponent } from './activity-offer.component';
const offer = { offerRef: { offerId: 'o' }, state: 'active', displayState: 'active', version: 1, briefVersion: 4, href: '/gcsp/offers/o', expiresAt: '2026-11-22T11:00:00Z' };
const first = '/assets/gcsp-vehicle-evidence/fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe.webp';
const second = '/assets/gcsp-vehicle-evidence/9704a8616835a1c1ce3b6d65f80e91cabb9edbfc0f83eca06b467bb3b1d236e3.webp';
describe('source activity offer', () => {
  it('filters original registry sources before normalization and retains image chooser/caption/failure semantics', async () => {
    const fixture = TestBed.createComponent(ActivityOfferComponent); fixture.componentRef.setInput('offer', offer); fixture.componentRef.setInput('level', 3);
    fixture.componentRef.setInput('display', { offerRef: offer.offerRef, state: 'active', version: 1, title: 'BMW X2', images: [{ src: first, alt: 'BMW front', kind: 'representative-configuration', caption: 'Front' }, { src: second, alt: 'BMW side', kind: 'representative-configuration' }, { src: first.slice(1), alt: 'Unapproved spelling', kind: 'representative-configuration' }, { src: 'https://unapproved.test/car.webp', alt: 'No', kind: 'representative' }] }); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement; expect(root.querySelector('h3')?.textContent).toBe('Your buddy found a car'); expect(root.querySelectorAll('[data-image]')).toHaveLength(2); expect(root.querySelector('img')?.getAttribute('src')).toBe(first.slice(1)); expect(root.querySelector('.vm-media-caption')?.textContent).toBe('Front');
    root.querySelectorAll<HTMLButtonElement>('[data-image]')[1].click(); await fixture.whenStable(); expect(root.querySelector('img')?.getAttribute('alt')).toBe('BMW side'); expect(root.querySelector('.vm-media-caption')).toBeNull(); expect(root.querySelector('[data-image="1"]')?.getAttribute('aria-pressed')).toBe('true');
    root.querySelector('img')!.dispatchEvent(new Event('error')); await fixture.whenStable(); expect(root.querySelector('img')).toBeNull(); expect(root.textContent).toContain('No image for this car yet');
    expect(root.querySelector('a.vm-btn-primary')?.getAttribute('href')).toBe('/gcsp/offers/o'); fixture.destroy();
  });
  it('renders nothing without an offer and a ghost decision link for a closed offer', async () => {
    const fixture = TestBed.createComponent(ActivityOfferComponent); await fixture.whenStable(); expect(fixture.nativeElement.querySelector('section')).toBeNull(); fixture.componentRef.setInput('offer', { ...offer, state: 'expired', displayState: 'expired' }); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Expired'); expect(fixture.nativeElement.querySelector('a.vm-btn-ghost')).not.toBeNull(); fixture.destroy();
  });
});
