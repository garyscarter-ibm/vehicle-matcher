import { ErrorHandler, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService, RuntimePublicConfig } from '../auth/runtime-config';
import { OfferClient } from './offer.client';
import { OfferScreenComponent } from './offer-screen.component';
import { offerScreenEmployee, offerScreenFixture } from './offer-screen.fixture';
import { OfferFailure, OfferProjection, OfferRequestOptions, OfferResult } from './offer.types';
import { actionableOffer, decisionReceipt, followupQuestion, savedFollowup } from './offer-interaction.fixture';

describe('native offer read screen', () => {
  let fixture: ComponentFixture<OfferScreenComponent>;
  let auth: ReturnType<typeof signal<SessionState>>;
  let reads: { id: string; options: OfferRequestOptions; resolve: (value: OfferResult<OfferProjection>) => void }[];
  let client: Record<string, ReturnType<typeof vi.fn>>;
  const text = () => fixture.nativeElement.textContent.replace(/\s+/g, ' ');
  const settle = async () => { fixture.detectChanges(); await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0)); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  const load = async (offer = offerScreenFixture()) => { reads.at(-1)!.resolve({ status: 'ok', value: offer }); await settle();
  };

  beforeEach(async () => {
    TestBed.resetTestingModule(); reads = []; auth = signal<SessionState>({ status: 'ready', context: offerScreenEmployee });
    client = Object.fromEntries(['readOffer', 'readDecisionReasons', 'decide', 'readFollowup', 'confirmFollowup'].map((key) => [key, vi.fn()]));
    client['readOffer'].mockImplementation((id: string, options: OfferRequestOptions) => new Promise((resolve) => reads.push({ id, options, resolve })));
    client['readFollowup'].mockResolvedValue({ status: 'ok', value: followupQuestion() });
    client['confirmFollowup'].mockResolvedValue({ status: 'ok', value: savedFollowup() });
    client['readDecisionReasons'].mockResolvedValue({ status: 'ok', value: { schemaVersion: 1, key: 'offer.declineReasons.v1', policyVersion: 'policy-v2',
      reasons: [{ code: 'body', label: 'Body style', attribute: 'body' }], provenance: { status: 'assumed', basis: 'fixture', source: 'fixture', sourceDate: '2026-11-14' } } });
    client['decide'].mockImplementation(async (input) => ({ status: 'ok', value: decisionReceipt(input) }));
    await TestBed.configureTestingModule({ imports: [OfferScreenComponent], providers: [provideRouter([]), { provide: AuthPort, useValue: { state: auth } }, { provide: OfferClient, useValue: client }] }).compileComponents();
    fixture = TestBed.createComponent(OfferScreenComponent);
  });
  afterEach(() => {
    fixture?.destroy(); TestBed.resetTestingModule(); vi.restoreAllMocks();
  });
  it('renders idle/missing selector and loading distinctly before the read settles', async () => {
    await settle(); expect(text()).toContain('Choose an offer'); expect(reads.length).toBe(0);
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    expect(text()).toContain('Loading your offer'); expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(reads[0]!.id).toBe('offer-1');
  });
  it('renders exact terms, nested reasons, all details and deliberate review controls without submitting', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    expect(text()).toContain('BMW 330e M Sport Touring'); expect(text()).toContain('295 points a month');
    expect(text()).toContain('620 points a month allowance'); expect(text()).toContain('£12.50 a month');
    expect(text()).toContain('Required: at least 5'); expect(text()).toContain('Mileage needs confirmation.');
    expect(text()).not.toContain('[object Object]'); expect(text()).not.toMatch(/synthetic|fictional|example data/i);
    expect(fixture.nativeElement.querySelector('[data-offer-action="accept"]').textContent).toContain('Review & accept');
    expect(fixture.nativeElement.querySelector('[data-offer-action="decline"]').textContent).toContain('Decline offer');
    expect(client['decide']).not.toHaveBeenCalled(); expect(client['readDecisionReasons']).not.toHaveBeenCalled();
    expect(client['readFollowup']).not.toHaveBeenCalled(); expect(client['confirmFollowup']).not.toHaveBeenCalled();
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
  it('reviews server driver, contact, terms and return mileage before explicitly accepting', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(actionableOffer());
    fixture.nativeElement.querySelector('[data-offer-action="accept"]').click(); await settle();
    const dialog: HTMLElement = fixture.nativeElement.querySelector('.gcsp-side-drawer:not([hidden]) [role="dialog"]'); expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Paula Mason'); expect(dialog.textContent).toContain('MASON900000PM9XX');
    expect(dialog.textContent).toContain('paula.mason@gcsp-demo.com'); expect(dialog.textContent).toContain('Expected return mileage (miles)');
    expect(dialog.querySelector<HTMLButtonElement>('[data-offer-action="confirm"]')!.disabled).toBe(true);
    const mileage = dialog.querySelector<HTMLInputElement>('input[type="text"]')!; mileage.value = '6100'; mileage.dispatchEvent(new Event('input')); await settle();
    for (const box of Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) box.click(); await settle();
    expect(dialog.querySelector<HTMLButtonElement>('[data-offer-action="confirm"]')!.disabled).toBe(false);
    dialog.querySelector<HTMLButtonElement>('[data-offer-action="confirm"]')!.click(); await settle();
    expect(client['decide']).toHaveBeenCalledTimes(1); expect(text()).toContain('Offer accepted');
    expect(text()).toContain('Ordering and approval are separate steps'); expect(text()).not.toContain('Your order is approved');
    expect(fixture.nativeElement.querySelector('.gcsp-side-drawer:not([hidden]) [role="dialog"]')).toBeNull();
  });
  it('loads server decline reasons and offers a separate explicit preference confirmation', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    fixture.nativeElement.querySelector('[data-offer-action="decline"]').click(); await settle();
    const reason = fixture.nativeElement.querySelector('[role="dialog"] input[type="radio"]'); expect(reason.value).toBe('body');
    reason.click(); await settle(); fixture.nativeElement.querySelector('[role="dialog"] [data-offer-action="confirm"]').click(); await settle();
    expect(text()).toContain('Offer declined'); expect(text()).toContain('One change to your preferences');
    expect(fixture.nativeElement.querySelector('[data-followup-link="activity"]')).toBeNull();
    expect(client['confirmFollowup']).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('gcsp-offer-followup input[value="suv"]').click(); await settle();
    fixture.nativeElement.querySelector('gcsp-offer-followup button[type="submit"]').click(); await settle();
    expect(client['confirmFollowup']).toHaveBeenCalledTimes(1); expect(text()).toContain('Change saved');
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('[data-followup-link="activity"]')?.getAttribute('href')).toBe('/activity');
  });
  it.each(['change-saved', 'waiting', 'no-match'] as const)('restores the buddy activity exit for the confirmed %s outcome', async (state) => {
    const saved = savedFollowup();
    const value = state === 'change-saved' ? saved : state === 'waiting'
      ? { schemaVersion: 1, state, decisionId: saved.decisionId, savedChange: saved }
      : { schemaVersion: 1, state, decisionId: saved.decisionId, savedChange: saved, evaluation: { evaluatedAt: '2026-11-04T09:00:00Z', carsChecked: 2, suitable: 0 } };
    client['readFollowup'].mockResolvedValue({ status: 'ok', value });
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offerScreenFixture('declined'));
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a[data-followup-link="activity"]');
    expect(link?.textContent?.trim()).toBe('See buddy activity'); expect(link?.getAttribute('href')).toBe('/activity');
    expect(link?.hasAttribute('gcspButton')).toBe(true);
    expect(client['decide']).not.toHaveBeenCalled(); expect(client['confirmFollowup']).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'pending', 'stale-version', 'forbidden'] as const)('does not promote the %s follow-up failure to a confirmed activity exit', async (status) => {
    client['readFollowup'].mockResolvedValue({ status, savedChange: savedFollowup() });
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offerScreenFixture('declined'));
    expect(fixture.nativeElement.querySelector('[data-followup-link="activity"]')).toBeNull();
    expect(client['confirmFollowup']).not.toHaveBeenCalled();
  });
  it.each(['pending', 'unavailable', 'conflict', 'stale-version', 'forbidden'] as const)('offers a read, with safe %s decision feedback and no automatic replay', async (status) => {
    client['decide'].mockResolvedValue({ status, reason: 'PRIVATE provider details' });
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    fixture.nativeElement.querySelector('[data-offer-action="decline"]').click(); await settle();
    fixture.nativeElement.querySelector('[role="dialog"] input[type="radio"]').click(); await settle();
    fixture.nativeElement.querySelector('[role="dialog"] [data-offer-action="confirm"]').click(); await settle();
    expect(text()).not.toContain('PRIVATE'); expect(text()).toMatch(/not.*confirmed|offer changed/i);
    expect(fixture.nativeElement.querySelector('[data-offer-action="accept"]')).toBeNull();
    fixture.nativeElement.querySelector('[data-offer-action="check"]').click(); await settle();
    expect(reads).toHaveLength(2); expect(client['decide']).toHaveBeenCalledTimes(1);
  });
  it.each(['slider', 'equipment'] as const)('renders a server-defined %s follow-up control', async (kind) => {
    const question = kind === 'slider' ? followupQuestion({ kind: 'slider', unit: 'percent', minimum: 0, maximum: 100 }, 30)
      : followupQuestion({ kind: 'equipment', maximumItems: 3, maximumItemLength: 40 }, ['Heated seats']);
    client['readFollowup'].mockResolvedValue({ status: 'ok', value: question });
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offerScreenFixture('declined'));
    const control = fixture.nativeElement.querySelector(kind === 'slider' ? 'input[type="range"]' : 'textarea'); expect(control).not.toBeNull();
    control.value = kind === 'slider' ? '70' : 'Heated seats\nTow bar'; control.dispatchEvent(new Event('input')); await settle();
    expect(fixture.nativeElement.querySelector('gcsp-offer-followup button[type="submit"]').disabled).toBe(false);
    expect(client['confirmFollowup']).not.toHaveBeenCalled();
  });
  it('retains both exact quoted cars and requirements and opens the supplied next offer selector', async () => {
    const previous = offerScreenFixture('declined'); const next = { ...actionableOffer(), offerId: 'offer-2' };
    client['readFollowup'].mockResolvedValue({ status: 'ok', value: { schemaVersion: 1, state: 'ready', decisionId: 'decision-1', savedChange: savedFollowup(),
      comparison: { schemaVersion: 1, currentBriefVersion: 8, requirements: [{ kind: 'preference', key: 'body', value: 'suv', importance: 70,
        previousFacts: { body: { status: 'known', value: 'estate', unit: null, provenance: null } }, nextFacts: { body: { status: 'unknown', value: null, unit: null, provenance: null } } },
        { kind: 'essential', key: 'seats', operator: 'gte', value: 5, unit: 'seats',
          previousFacts: { seats: { status: 'known', value: 5, unit: null, provenance: null } }, nextFacts: { seats: { status: 'known', value: 7, unit: null, provenance: null } } },
        { kind: 'essential', key: 'equipment', operator: 'includes', value: ['Heated seats'], unit: null,
          previousFacts: { equipment: { status: 'unknown', value: null, unit: null, provenance: null } }, nextFacts: { equipment: { status: 'known', value: ['Heated seats'], unit: null, provenance: null } } }],
        previous: { offer: previous }, next: { offer: next } } } });
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(previous);
    expect(fixture.nativeElement.querySelectorAll('gcsp-offer-followup gcsp-media-gallery')).toHaveLength(2);
    expect(text()).toContain('Your next car offer'); expect(text()).toContain('importance 70%'); expect(text()).toContain('No new match score is calculated');
    expect(fixture.nativeElement.querySelector('[data-followup-link="activity"]')).toBeNull();
    expect(text()).toContain('At least 5 (seats)'); expect(text()).toContain('Includes Heated seats'); expect(text()).not.toContain('gte ');
    expect(text()).not.toContain('[object Object]');
    const opened = vi.fn(); fixture.componentInstance.offerOpened.subscribe(opened);
    const open = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('gcsp-offer-followup button')).find((button) => button.textContent?.includes('Open this offer'))!;
    open.click(); await settle(); expect(reads.at(-1)!.id).toBe('offer-2'); expect(opened).toHaveBeenCalledWith('offer-2');
  });
  describe('focus after opening the next offer', () => {
    const heading = () => fixture.nativeElement.querySelector('h1') as HTMLElement;
    const openNext = async () => {
      client['readFollowup'].mockResolvedValue({ status: 'ok', value: { schemaVersion: 1, state: 'ready', decisionId: 'decision-1', savedChange: savedFollowup(),
        comparison: { schemaVersion: 1, currentBriefVersion: 8, requirements: [], previous: { offer: offerScreenFixture('declined') }, next: { offer: { ...actionableOffer(), offerId: 'offer-2' } } } } });
      fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offerScreenFixture('declined'));
      const open = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('gcsp-offer-followup button')).find((button) => button.textContent?.includes('Open this offer'))!;
      open.focus(); open.click(); await settle();
      expect(reads.at(-1)!.id).toBe('offer-2'); expect(document.activeElement).toBe(heading()); expect(heading().textContent).toContain('Loading your offer');
    };
    const resolveNext = async (value: OfferResult<OfferProjection> | OfferFailure, read = reads.at(-1)!) => { read.resolve(value as OfferResult<OfferProjection>); await settle(); };

    it('focuses the final ready heading once a delayed next-offer read completes', async () => {
      await openNext(); await resolveNext({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-2' } });
      expect(heading().textContent).not.toContain('Loading your offer'); expect(heading().isConnected).toBe(true);
      expect(document.activeElement).toBe(heading());
    });
    it('focuses the failure heading when the delayed next-offer read fails', async () => {
      await openNext(); await resolveNext({ status: 'unavailable', code: 'offer-unavailable', retryable: true });
      expect(heading().textContent).not.toContain('Loading your offer'); expect(document.activeElement).toBe(heading());
    });
    it('does not take focus back from a control the user moved to while loading', async () => {
      const elsewhere = document.body.appendChild(document.createElement('button'));
      try {
        await openNext(); elsewhere.focus(); await resolveNext({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-2' } });
        expect(document.activeElement).toBe(elsewhere);
      } finally { elsewhere.remove(); }
    });
    it('does not move focus for a superseded next-offer read', async () => {
      await openNext(); const stale = reads.at(-1)!; const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      fixture.componentRef.setInput('offerId', 'offer-3'); await settle(); expect(reads.at(-1)!.id).toBe('offer-3');
      await resolveNext({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-2' } }, stale);
      await resolveNext({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-3' } });
      expect(heading().textContent).not.toContain('Loading your offer'); expect(focus).not.toHaveBeenCalled();
    });
    it('does not move focus for a read completed under a different account', async () => {
      await openNext(); const stale = reads.at(-1)!;
      auth.set({ status: 'ready', context: { ...offerScreenEmployee, subject: 'other-subject', employeeId: 'employee-2' } }); await settle();
      await resolveNext({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-2' } }, stale);
      expect(heading().textContent).toContain('Loading your offer');
      expect(reads.at(-1)).not.toBe(stale); await resolveNext({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-2' } });
      expect(heading().textContent).not.toContain('Loading your offer'); expect(document.activeElement).not.toBe(heading());
    });
    it('does not focus anything after the screen is disposed mid-read', async () => {
      await openNext(); const read = reads.at(-1)!; fixture.destroy(); const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      read.resolve({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-2' } }); await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(focus).not.toHaveBeenCalled();
    });
  });
});

describe('native offer read screen through the real offer client', () => {
  const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'dev', apiBaseUrl: 'https://api.example/api/gcsp/v1',
    oidc: { authority: 'https://identity.example', clientId: 'client', scope: 'openid profile',
      redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } };
  const handleError = vi.fn();
  const render = async (images: unknown[]) => {
    TestBed.resetTestingModule(); handleError.mockReset();
    const offer = offerScreenFixture() as unknown as { quote: { facts: { display: { images: unknown[] } } } };
    offer.quote.facts.display.images = images;
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: 'ok', value: offer }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await TestBed.configureTestingModule({ imports: [OfferScreenComponent], providers: [
      { provide: AuthPort, useValue: { state: signal<SessionState>({ status: 'ready', context: offerScreenEmployee }), getAccessToken: async () => 'access-token' } },
      { provide: RuntimeConfigService, useValue: { load: async () => config } }, { provide: PORTAL_FETCH, useValue: fetcher },
      { provide: ErrorHandler, useValue: { handleError } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(OfferScreenComponent);
    fixture.componentRef.setInput('offerId', 'offer-1');
    for (let turn = 0; turn < 4; turn += 1) { fixture.detectChanges(); await fixture.whenStable(); await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
    fixture.detectChanges();
    return { fixture, fetcher, element: fixture.nativeElement as HTMLElement };
  };
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

  it('shows the safe read failure for a null per-image src without reaching the gallery', async () => {
    const { fixture, fetcher, element } = await render([{ src: null }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain('Your offer could not be loaded');
    expect(element.querySelector('gcsp-media-gallery')).toBeNull();
    expect(handleError).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('still renders healthy supplied images in the gallery with a null primary photo', async () => {
    const { fixture, element } = await render([{ src: '/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp', alt: 'BMW 330e M Sport Touring', label: 'Front' }]);
    expect(element.textContent).not.toContain('Your offer could not be loaded');
    expect(element.querySelector('gcsp-media-gallery img')?.getAttribute('src')).toBe('/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp');
    expect(handleError).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
