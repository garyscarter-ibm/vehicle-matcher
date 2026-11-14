import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { OfferClient } from './offer.client';
import { OfferScreenComponent } from './offer-screen.component';
import { offerScreenEmployee, offerScreenFixture } from './offer-screen.fixture';
import { OfferFailure, OfferProjection, OfferRequestOptions, OfferResult } from './offer.types';

describe('native offer read screen', () => {
  let fixture: ComponentFixture<OfferScreenComponent>;
  let auth: ReturnType<typeof signal<SessionState>>;
  let reads: { id: string; options: OfferRequestOptions; resolve: (value: OfferResult<OfferProjection>) => void }[];
  let client: Record<string, ReturnType<typeof vi.fn>>;
  const text = () => fixture.nativeElement.textContent.replace(/\s+/g, ' ');
  const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  const load = async (offer = offerScreenFixture()) => { reads.at(-1)!.resolve({ status: 'ok', value: offer }); await settle(); };

  beforeEach(async () => {
    TestBed.resetTestingModule(); reads = []; auth = signal<SessionState>({ status: 'ready', context: offerScreenEmployee });
    client = Object.fromEntries(['readOffer', 'readDecisionReasons', 'decide', 'readFollowup', 'confirmFollowup'].map((key) => [key, vi.fn()]));
    client['readOffer'].mockImplementation((id: string, options: OfferRequestOptions) => new Promise((resolve) => reads.push({ id, options, resolve })));
    await TestBed.configureTestingModule({ imports: [OfferScreenComponent], providers: [{ provide: AuthPort, useValue: { state: auth } }, { provide: OfferClient, useValue: client }] }).compileComponents();
    fixture = TestBed.createComponent(OfferScreenComponent);
  });
  afterEach(() => {
    for (const command of ['readDecisionReasons', 'decide', 'readFollowup', 'confirmFollowup']) expect(client[command]).not.toHaveBeenCalled();
    fixture.destroy(); TestBed.resetTestingModule();
  });
  it('renders idle/missing selector and loading distinctly before the read settles', async () => {
    await settle(); expect(text()).toContain('Choose an offer'); expect(reads.length).toBe(0);
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    expect(text()).toContain('Loading your offer'); expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(reads[0]!.id).toBe('offer-1');
  });
  it('renders exact terms, nested reasons, all details and no working-looking decision controls', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    expect(text()).toContain('BMW 330e M Sport Touring'); expect(text()).toContain('295 points a month');
    expect(text()).toContain('620 points a month allowance'); expect(text()).toContain('£12.50 a month');
    expect(text()).toContain('Required: at least 5'); expect(text()).toContain('Mileage needs confirmation.');
    expect(text()).not.toContain('[object Object]'); expect(text()).not.toMatch(/synthetic|fictional|example data/i);
    expect(Array.from(fixture.nativeElement.querySelectorAll('button')).some((button) => /accept|decline/i.test((button as HTMLButtonElement).textContent ?? ''))).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('h1')).toHaveLength(1);
  });
  it.each(['accepted', 'declined', 'expired', 'superseded'] as const)('reopens the authoritative %s state', async (state) => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offerScreenFixture(state));
    expect(text()).toContain(state === 'superseded' ? 'Offer superseded' : `Offer ${state}`);
    if (state === 'accepted') {
      expect(text()).toContain('Waiting for HR approval'); expect(text().split('0123456')).toHaveLength(2);
      expect(fixture.nativeElement.querySelector('gcsp-media-gallery')).toBeNull();
      expect(fixture.nativeElement.querySelector('table')).toBeNull();
    }
  });
  it.each(['decision-pending', 'release-pending'])('shows truthful uncertain copy for %s', async (reason) => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load({ ...offerScreenFixture(), reason });
    expect(text()).toContain('Checking your decision'); expect(text()).toContain('being confirmed');
  });
  it.each(['handoff-pending', 'handoff-failed'] as const)('preserves actual %s selection state', async (selectionState) => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    const offer = offerScreenFixture('accepted'); await load({ ...offer, selection: { ...offer.selection!, selectionState } });
    expect(text()).toContain(selectionState === 'handoff-pending' ? 'Sending your selection to ordering.' : 'Nothing has been ordered.');
    expect(text()).not.toContain('Your order is approved');
  });
  it.each(['invalid', 'unavailable', 'stale-version', 'conflict', 'forbidden', 'denied', 'not-found', 'stale-run', 'pending', 'unauthenticated', 'unsupported'] as const)('uses safe distinct failure copy for %s', async (status) => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    reads[0]!.resolve({ status, reason: 'PRIVATE employee-id stacktrace', retryable: true } satisfies OfferFailure); await settle();
    expect(text()).not.toContain('PRIVATE'); expect(text()).not.toContain('stacktrace');
    const retry = fixture.nativeElement.querySelector('button');
    if (['unavailable', 'stale-version', 'conflict', 'pending'].includes(status)) {
      expect(retry?.textContent).toContain('Check current offer'); retry.click(); await settle(); expect(reads).toHaveLength(2);
    } else expect(retry).toBeNull();
  });
  it('redacts the old snapshot and invalidates its request when the selector changes', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    fixture.componentRef.setInput('offerId', 'offer-2'); await settle();
    expect(text()).not.toContain('BMW 330e'); expect(reads.at(-1)!.id).toBe('offer-2');
    fixture.componentRef.setInput('offerId', ''); await settle();
    expect(reads.at(-1)!.options.signal?.aborted).toBe(true); expect(text()).toContain('Choose an offer');
  });
  it('redacts on observed sign-out and denies presenter authority without another read', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    auth.set({ status: 'signed-out' }); await settle();
    expect(text()).toContain('Sign in to view your offer'); expect(text()).not.toContain('BMW 330e');
    auth.set({ status: 'ready', context: { ...offerScreenEmployee, roles: ['presenter'] } }); await settle();
    expect(text()).toContain('Offer unavailable'); expect(reads).toHaveLength(1);
  });
  it('owns a local store per screen and aborts only its own request on destruction', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    const second = TestBed.createComponent(OfferScreenComponent); second.componentRef.setInput('offerId', 'offer-2'); second.detectChanges(); await second.whenStable();
    fixture.destroy(); expect(reads[0]!.options.signal?.aborted).toBe(true); expect(reads[1]!.options.signal?.aborted).toBe(false);
    second.destroy(); expect(reads[1]!.options.signal?.aborted).toBe(true);
  });
});
