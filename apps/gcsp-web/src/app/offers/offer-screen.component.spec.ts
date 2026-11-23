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
  const reviewAcceptance = async (offer = actionableOffer()) => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offer);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-offer-action="accept"]')!.click(); await settle();
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.gcsp-side-drawer:not([hidden]) [role="dialog"]')!;
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
    expect(fixture.nativeElement.querySelector('div[gcspScreenIntro].gcsp-vh > h1.vm-title')?.textContent).toBe('Your offer');
    expect(fixture.nativeElement.querySelector('.gcsp-skeleton[data-layout="offer"] > p.gcsp-vh[role="status"]')?.textContent).toBe('Loading your offer.');
    expect(fixture.nativeElement.querySelector('.gcsp-skeleton-shapes[aria-hidden="true"] .gcsp-skeleton-offer-card')).not.toBeNull();
    expect(reads[0]!.id).toBe('offer-1');
  });
  it('renders exact terms, nested reasons, all details and deliberate review controls without submitting', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    expect(text()).toContain('BMW 330e M Sport Touring'); expect(text()).toContain('295 points a month');
    expect(text()).toContain('620 points a month allowance'); expect(text()).not.toContain('£12.50 a month');
    expect(text()).not.toContain('Required: at least 5'); expect(text()).toContain('Mileage needs confirmation.');
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
  it('shows the source held-until time, weekday and accessible authoritative countdown', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    const deadline = (fixture.nativeElement as HTMLElement).querySelector('.gcsp-decision-deadline');
    expect(deadline?.querySelector('strong')?.textContent).toBe('Held until 14:30');
    expect(deadline?.querySelector('.gcsp-decision-date')?.textContent).toBe('Saturday, 14 November 2026');
    expect(deadline?.querySelector('.gcsp-decision-clock > .gcsp-countdown[aria-label="Time left to decide"]')?.textContent).toBe('2h 00m');
    expect(deadline?.querySelector('.gcsp-decision-clock > .gcsp-decision-date')?.textContent).toBe('left to decide');
    expect(text()).not.toContain('at last check');
  });
  it('uses London daylight saving for the held time and date', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    await load({ ...offerScreenFixture(), serverNow: '2026-07-14T10:30:00.000Z', expiresAt: '2026-07-14T12:30:00.000Z' });
    const deadline = (fixture.nativeElement as HTMLElement).querySelector('.gcsp-decision-deadline');
    expect(deadline?.querySelector('strong')?.textContent).toBe('Held until 13:30');
    expect(deadline?.querySelector('.gcsp-decision-date')?.textContent).toBe('Tuesday, 14 July 2026');
  });
  it('announces the five-minute boundary without repeating it on an unchanged authoritative refresh', async () => {
    const offer = { ...offerScreenFixture(), expiresAt: '2026-11-14T12:35:00.000Z' };
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offer);
    const announcement = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-offer-announcement]');
    expect(announcement?.textContent).toBe('Less than five minutes remain on this offer.');
    expect(announcement?.getAttribute('role')).toBe('status'); expect(announcement?.getAttribute('aria-live')).toBe('polite');
    expect(announcement?.classList.contains('gcsp-vh')).toBe(true);
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver(records => changes.push(...records));
    try {
      if (announcement) observer.observe(announcement, { childList: true, characterData: true, subtree: true });
      fixture.componentInstance.refresh(); await settle(); await load({ ...offer, clockVersion: 'clock-v4' });
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-offer-announcement]')).toBe(announcement);
      expect(changes).toHaveLength(0);
    } finally { observer.disconnect(); }
  });
  it('does not announce less than five minutes when the server still reports a fractional second above it', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    await load({ ...offerScreenFixture(), expiresAt: '2026-11-14T12:35:00.001Z' });
    expect((fixture.nativeElement as HTMLElement).querySelector('.gcsp-countdown')?.textContent).toBe('0h 06m');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-offer-announcement]')?.textContent).toBe('');
  });
  it('keeps the zero deadline and disabled controls visible until the bounded server reread establishes expiry', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    const offer = { ...actionableOffer(), expiresAt: '2026-11-14T12:30:00.000Z' };
    await load(offer);
    expect(reads).toHaveLength(2);
    expect((fixture.nativeElement as HTMLElement).querySelector('.gcsp-countdown')?.textContent).toBe('0h 00m');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-offer-announcement]')?.textContent).toBe('The deadline has been reached. Checking the current offer state.');
    for (const action of ['accept', 'decline']) expect((fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`[data-offer-action="${action}"]`)?.disabled).toBe(true);
    expect(text()).not.toContain('Offer expired'); expect(client['decide']).not.toHaveBeenCalled();
    await load({ ...offerScreenFixture('expired'), expiresAt: offer.expiresAt });
    expect(text()).toContain('Offer expired'); expect((fixture.nativeElement as HTMLElement).querySelector('.gcsp-countdown')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-offer-announcement]')?.textContent).toBe('Offer expired');
    expect(reads).toHaveLength(2);
  });
  it('redacts the deadline announcement when employee authority is lost', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    await load({ ...offerScreenFixture(), expiresAt: '2026-11-14T12:35:00.000Z' });
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-offer-announcement]')?.textContent).toBe('Less than five minutes remain on this offer.');
    auth.set({ status: 'signed-out' }); await settle();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-offer-announcement]')?.textContent).toBe('');
    expect(text()).not.toContain('BMW 330e');
  });
  it('replaces the deadline announcement with the read failure when the expiry check cannot complete', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    await load({ ...offerScreenFixture(), expiresAt: '2026-11-14T12:30:00.000Z' });
    expect(reads).toHaveLength(2);
    reads[1].resolve({ status: 'unavailable', retryable: true }); await settle();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-offer-announcement]')?.textContent).toBe('Your offer could not be loaded');
    expect((fixture.nativeElement as HTMLElement).querySelector('.gcsp-countdown')).toBeNull();
    expect(text()).toContain('Check current offer'); expect(text()).not.toContain('Offer expired');
  });
  it('announces a changed authoritative selection outcome even when its offer state stays accepted', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle();
    const accepted = offerScreenFixture('accepted'); await load(accepted);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-offer-announcement]')?.textContent).toBe('');
    fixture.componentInstance.refresh(); await settle();
    await load({ ...accepted, selection: { ...accepted.selection!, selectionState: 'handoff-failed' } });
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-offer-announcement]')?.textContent).toBe('Your selection was not sent to ordering');
  });
  it('offers the source back exit beside the pending heading without submitting a decision', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    const header = (fixture.nativeElement as HTMLElement).querySelector('.gcsp-offer-header');
    const back = header?.querySelector<HTMLAnchorElement>('a');
    expect(header?.querySelector('h1')?.textContent).toBe('Your offer');
    expect(header?.querySelector(':scope > div[gcspScreenIntro] > h1.vm-title')).not.toBeNull();
    expect(back?.textContent).toBe('‹ Back to Your cars'); expect(back?.getAttribute('href')).toBe('/account');
    expect(back?.classList.contains('gcsp-button-ghost')).toBe(true); expect(client['decide']).not.toHaveBeenCalled();
  });
  it('composes the focused source hero with direct picker media, numeric saving and decorative finish swatches', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    const host = fixture.nativeElement as HTMLElement; const card = host.querySelector('.gcsp-vehicle-decision.gcsp-vehicle-focused');
    expect(card).not.toBeNull();
    expect(Array.from(card?.children ?? []).map(child => child.classList.contains('gcsp-vehicle-summary') ? 'summary'
      : child.classList.contains('gcsp-media-gallery') ? 'media' : child.classList.contains('gcsp-vehicle-details') ? 'details' : 'other')).toEqual(['summary', 'media', 'details']);
    const summary = card?.querySelector('.gcsp-vehicle-summary');
    expect(summary?.querySelector('.gcsp-vehicle-context')?.textContent).toBe('Your buddy found a car for you');
    expect(summary?.querySelector('.gcsp-points-n')?.textContent).toBe('295');
    expect(summary?.querySelector('.gcsp-vehicle-saving')?.textContent).toBe('300 fewer than your current car');
    expect(card?.querySelector(':scope > .gcsp-media-gallery-picker.gcsp-media-gallery-whole')).not.toBeNull();
    expect(Array.from(summary?.querySelectorAll('.gcsp-vehicle-meta .gcsp-finish') ?? []).map(finish => [
      finish.querySelector('.gcsp-finish-label')?.textContent, finish.querySelector('.gcsp-finish-value')?.textContent,
      finish.querySelector('.gcsp-finish-swatch')?.getAttribute('aria-hidden'),
    ])).toEqual([['Paint', 'Alpine White', 'true'], ['Upholstery', 'Black Veganza', 'true']]);
    expect(host.querySelector('.offer-focused, .offer-summary, .offer-terms')).toBeNull();
    expect(summary?.querySelector('[data-offer-action="check"]')).toBeNull();
    expect(summary?.querySelector('.gcsp-offer-actions')).not.toBeNull();
  });
  it('shows canonical Benefits and Tradeoffs with numeric emphasis while omitting coded or invented highlights', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    const highlights = (fixture.nativeElement as HTMLElement).querySelector('.gcsp-decision-highlights.gcsp-decision-lists');
    expect(Array.from(highlights?.querySelectorAll('h3') ?? []).map(h => h.textContent)).toEqual(['Benefits', 'Tradeoffs']);
    expect(Array.from(highlights?.querySelectorAll('.gcsp-highlight-number') ?? []).map(n => n.textContent)).toEqual(['300', '30']);
    expect(highlights?.textContent).toContain('Available by Tuesday 1 December 2026.');
    expect(highlights?.textContent).toContain('Less sporty than you prefer.');
    expect(highlights?.textContent).not.toMatch(/essential|Required:|Preference fit|Desired:/);
  });
  it('renders the source empty highlights and unknown-current-car note without an invented comparison table', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); const offer = offerScreenFixture();
    await load({ ...offer, comparison: { ...offer.comparison, currentCar: null, comparisonAvailable: false }, quote: { ...offer.quote,
      decision: { ...offer.quote.decision, reasons: [], tradeOffs: [] } } });
    const host = fixture.nativeElement as HTMLElement;
    expect(Array.from(host.querySelectorAll('.gcsp-highlight-empty')).map(p => p.textContent)).toEqual(['No benefits confirmed.', 'No tradeoffs confirmed.']);
    expect(text()).toContain('Current-car details not supplied. Equipment is unknown.'); expect(host.querySelector('table')).toBeNull();
    expect(host.querySelector('.gcsp-vehicle-saving')).toBeNull();
  });
  it('keeps actual specification, confirmation notes and complete equipment in the one shared details drawer', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('gcsp-vehicle-details')).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('.gcsp-vehicle-details-entry')!.click(); await settle();
    const dialog = host.querySelector<HTMLElement>('gcsp-vehicle-details .gcsp-side-drawer:not([hidden]) [role="dialog"]');
    expect(dialog).not.toBeNull(); expect(dialog?.textContent).toContain('Mileage needs confirmation.');
    expect(dialog?.querySelector('.vm-card-decision .vm-why-label')?.textContent).toBe('Needs confirmation');
    expect(dialog?.querySelectorAll('.gcsp-vehicle-specification > .vm-card-facts')).toHaveLength(1);
    expect(dialog?.querySelectorAll('.vm-card-facts .vm-facts-wrap > .vm-facts-pair')).toHaveLength(1);
    expect(Array.from(dialog?.querySelectorAll('.vm-card-facts dt') ?? [], node => node.textContent)).toEqual(['Model', 'Derivative', 'Body style', 'Fuel', 'Seats', 'Boot', 'Gearbox']);
    expect(Array.from(dialog?.querySelectorAll('.vm-card-facts .vm-facts-more') ?? [], node => node.textContent)).toEqual(['More details not supplied']);
    expect(dialog?.querySelector('.vm-card-facts')?.textContent).not.toMatch(/Front ISOFIX|Manufacturer|Mileage|Options|Paint|Interior/);
    expect(dialog?.textContent).toContain('Seats'); expect(dialog?.textContent).toContain('5');
    expect(dialog?.textContent).not.toContain('Required: at least 5');
    const equipment = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []).find(tab => tab.textContent?.includes('Selected equipment'))!;
    equipment.click(); await settle();
    expect(Array.from(dialog?.querySelectorAll('.gcsp-vehicle-equipment li') ?? []).map(li => li.textContent)).toEqual(['Heated seats', 'Parking assistance']);
    expect(client['decide']).not.toHaveBeenCalled();
  });
  it('uses canonical short accepted facts and the order/back exits without a tracker or another decision check', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offerScreenFixture('accepted'));
    const host = fixture.nativeElement as HTMLElement;
    expect(Array.from(host.querySelectorAll('.gcsp-offer-actions > a')).map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Track your order', '/orders'], ['Back to Your cars', '/account'],
    ]);
    expect(Array.from(host.querySelectorAll('gcsp-fact-list .vm-fact')).map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])).toEqual([
      ['Your new car', 'BMW 330e M Sport Touring'], ['Car order number', '0123456'],
    ]);
    expect(text().split('BMW 330e M Sport Touring')).toHaveLength(2); expect(text().split('0123456')).toHaveLength(2);
    expect(host.querySelector('gcsp-stage-list, table, [data-offer-action]')).toBeNull();
    expect(text()).not.toContain('Order reference'); expect(client['decide']).not.toHaveBeenCalled();
  });
  it('offers the source activity/back exits for expiry without a second decision check', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offerScreenFixture('expired'));
    const host = fixture.nativeElement as HTMLElement;
    expect(Array.from(host.querySelectorAll('.gcsp-offer-actions > a')).map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['See buddy activity', '/activity'], ['Back to Your cars', '/account'],
    ]);
    expect(host.querySelector('[data-offer-action], gcsp-stage-list')).toBeNull();
    expect(client['decide']).not.toHaveBeenCalled();
  });
  it('composes refused support/back, canonical stage labels and the exact selection identity', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); const offer = offerScreenFixture('accepted');
    await load({ ...offer, selection: { ...offer.selection!, selectionState: 'handoff-failed', orderNumber: '7654321', stages: [
      { name: 'Selection received', state: 'complete' }, { name: 'Send to ordering', state: 'failed' }, { name: 'Await receipt', state: 'pending' },
    ] } });
    const host = fixture.nativeElement as HTMLElement; const support = host.querySelector('div[gcspStatusScreen].vm-screen.vm-status');
    expect(Array.from(support?.querySelectorAll('a') ?? []).map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Contact scheme support', '/help'], ['Back to Your cars', '/account'],
    ]);
    expect(support?.getAttribute('role')).toBeNull();
    expect(support?.querySelector(':scope > h1.vm-title')?.textContent).toBe('Your selection was not sent to ordering');
    expect(support?.querySelector(':scope > p.vm-lede')?.textContent).toContain('The car stays reserved for you.');
    expect(support?.querySelector('section, gcsp-screen-intro, .gcsp-actions')).toBeNull();
    const group = host.querySelector('.gcsp-offer-current');
    expect(group?.querySelector('.gcsp-stage-heading')?.textContent).toBe('Your selection');
    expect(Array.from(group?.querySelectorAll('.gcsp-stage-item') ?? []).map(row => [row.querySelector('.gcsp-stage-name')?.textContent, row.querySelector('.gcsp-stage-state')?.textContent])).toEqual([
      ['Selection received', 'Done'], ['Send to ordering', 'Not accepted'], ['Await receipt', 'Sending'],
    ]);
    expect(Array.from(group?.querySelectorAll('.vm-fact') ?? []).map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])).toEqual([
      ['Order reference', 'GCSP-000123'], ['Car order number', '7654321'],
    ]);
    expect(host.querySelector('[data-offer-action]')).toBeNull(); expect(client['decide']).not.toHaveBeenCalled();
  });
  it('does not borrow the quote order number for a refused selection with only an order reference', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); const offer = offerScreenFixture('accepted');
    await load({ ...offer, selection: { ...offer.selection!, selectionState: 'handoff-failed', orderNumber: null } });
    const group = (fixture.nativeElement as HTMLElement).querySelector('.gcsp-offer-current');
    expect(Array.from(group?.querySelectorAll('.vm-fact') ?? []).map(row => row.querySelector('dd')?.textContent)).toEqual(['GCSP-000123', 'Not supplied']);
  });
  it.each(['declined', 'superseded'] as const)('does not display another state exit in the %s state', async state => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offerScreenFixture(state));
    expect((fixture.nativeElement as HTMLElement).querySelector('.gcsp-offer-header, .gcsp-offer-actions > a')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('gcsp-stage-list')).toBeNull();
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
  it('opens the actual scheme terms from Documents without changing the entered acceptance details', async () => {
    const dialog = await reviewAcceptance();
    const links = Array.from(dialog.querySelectorAll<HTMLAnchorElement>('.gcsp-offer-document-links a'));
    expect(links.map(link => link.textContent)).toEqual(['Read scheme terms', 'View driver and licence record', 'View old contract and return mileage']);
    const terms = dialog.querySelector<HTMLDetailsElement>(links[0].getAttribute('href')!)!;
    expect(terms.tagName).toBe('DETAILS'); expect(terms.open).toBe(false); expect(terms.classList.contains('gcsp-details')).toBe(true);
    expect(terms.textContent).toContain(actionableOffer().handoff!.wording);
    const mileage = dialog.querySelector<HTMLInputElement>('input[type="text"]')!; mileage.value = '006100'; mileage.dispatchEvent(new Event('input')); await settle();
    const declaration = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!; declaration.click(); await settle();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true }); links[0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(terms.open).toBe(true); expect(document.activeElement).toBe(terms.querySelector('summary'));
    expect(mileage.value).toBe('006100'); expect(declaration.checked).toBe(true);
    expect(client['decide']).not.toHaveBeenCalled(); expect(reads).toHaveLength(1);
  });
  it.each([
    ['View driver and licence record', 'Driver and licence'],
    ['View old contract and return mileage', 'The car you will return'],
  ])('jumps from Documents to the actual %s heading', async (label, heading) => {
    const dialog = await reviewAcceptance();
    const link = Array.from(dialog.querySelectorAll<HTMLAnchorElement>('.gcsp-offer-document-links a')).find(node => node.textContent === label);
    expect(link).toBeDefined(); const target = dialog.querySelector<HTMLElement>(link!.getAttribute('href')!)!;
    expect(target.querySelector('h3')?.textContent).toBe(heading);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true }); link!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(document.activeElement).toBe(target.querySelector('h3')); expect(target.querySelector('h3')?.tabIndex).toBe(-1);
    expect(client['decide']).not.toHaveBeenCalled(); expect(client['readDecisionReasons']).not.toHaveBeenCalled();
  });
  it('offers only the actual terms and driver documents for a new car selection', async () => {
    const offer = actionableOffer(); const dialog = await reviewAcceptance({ ...offer, handoff: { ...offer.handoff!, mode: 'new', returnCar: null, returnMileage: null } });
    expect(Array.from(dialog.querySelectorAll('.gcsp-offer-document-links a')).map(link => link.textContent)).toEqual(['Read scheme terms', 'View driver and licence record']);
    expect(dialog.textContent).not.toContain('The car you will return'); expect(dialog.querySelector('input[type="text"]')).toBeNull();
    expect(client['decide']).not.toHaveBeenCalled();
  });
  it.each([null, ''])('keeps the source unavailable-terms message for wording %s', async wording => {
    const offer = actionableOffer(); const dialog = await reviewAcceptance({ ...offer, handoff: { ...offer.handoff!, wording } });
    const documents = Array.from(dialog.querySelectorAll('section')).find(section => section.querySelector('h3')?.textContent === 'Documents');
    expect(documents).toBeDefined(); expect(documents?.querySelector('details p')?.textContent).toBe('Scheme terms are unavailable.');
    expect(documents?.querySelector('a[download]')).toBeNull(); expect(client['decide']).not.toHaveBeenCalled();
  });
  it('keeps acceptance Documents out of the decline review', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-offer-action="decline"]')!.click(); await settle();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('.gcsp-offer-document-links')).toBeNull(); expect(dialog.textContent).not.toContain('Documents');
    expect(client['decide']).not.toHaveBeenCalled();
  });
  it('composes the source drawer sections, fact lists, declaration rows and direct footer children', async () => {
    const dialog = await reviewAcceptance(); const content = dialog.querySelector<HTMLElement>('.gcsp-offer-drawer-content');
    expect(content).not.toBeNull(); expect(content?.querySelector('.gcsp-offer-drawer-vehicle')?.textContent).toContain('Alpine White · Black Veganza');
    const driver = content?.querySelector<HTMLElement>('[id$="-driver-record"]');
    expect(Array.from(driver!.querySelectorAll('dl.vm-facts dt')).map(node => node.textContent)).toEqual(['Nominated driver', 'Licence number', 'Valid until', 'Car entitlement']);
    expect(driver?.textContent).toContain('Paula Mason'); expect(driver?.textContent).toContain('Car');
    const declarations = content?.querySelector<HTMLElement>('section[aria-label="Declarations"]'); expect(declarations?.getAttribute('role')).toBe('group');
    const rows = Array.from(declarations!.querySelectorAll<HTMLElement>('div[gcspCheckboxField].gcsp-check')); expect(rows).toHaveLength(3);
    for (const row of rows) { const input = row.querySelector('input')!; expect(row.querySelector('label')?.htmlFor).toBe(input.id); expect(row.firstElementChild).toBe(input); }
    const foot = dialog.querySelector('.gcsp-side-drawer-foot')!;
    expect(foot.querySelector(':scope > .gcsp-offer-decision-note')).not.toBeNull(); expect(foot.querySelectorAll(':scope > .gcsp-offer-decision-button')).toHaveLength(2);
    expect(foot.querySelector('.decision-footer')).toBeNull(); expect(client['decide']).not.toHaveBeenCalled();
  });
  it('shows the source decline summary and focuses the actual required radio without posting an empty reason', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-offer-action="decline"]')!.click(); await settle();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="dialog"]')!;
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-offer-action="confirm"]')!; expect(confirm.disabled).toBe(false); confirm.click(); await settle();
    const summary = dialog.querySelector<HTMLElement>('.gcsp-error-summary')!; expect(summary.hidden).toBe(false); expect(summary.textContent).toContain('Choose a reason.');
    const heading = summary.querySelector('h2')!; expect(heading.textContent).toBe('Check before continuing'); expect(document.activeElement).toBe(heading);
    const live = dialog.querySelector<HTMLElement>('.gcsp-side-drawer-foot [role="status"]'); expect(live?.textContent).toBe('Choose a reason.'); expect(live?.closest('[inert]')).toBeNull();
    const group = dialog.querySelector<HTMLElement>('.vm-options-rows[role="radiogroup"]')!; expect(group.getAttribute('aria-required')).toBe('true'); expect(group.getAttribute('aria-invalid')).toBe('true');
    const radio = group.querySelector<HTMLButtonElement>('button[role="radio"][tabindex="0"]')!;
    summary.querySelector<HTMLAnchorElement>('a')!.click(); expect(document.activeElement).toBe(radio); expect(client['decide']).not.toHaveBeenCalled();
    radio.click(); await settle(); expect(summary.hidden).toBe(true); expect(group.getAttribute('aria-invalid')).toBe('false'); expect(radio.getAttribute('aria-checked')).toBe('true');
    expect(client['decide']).not.toHaveBeenCalled();
  });
  it.each([false, true])('preserves source reason-loading focus ownership when the user moved to cancel: %s', async moved => {
    let complete!: (value: unknown) => void; client['readDecisionReasons'].mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-offer-action="decline"]')!.click(); await settle();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="dialog"]')!;
    const status = Array.from(dialog.querySelectorAll('p')).find(node => node.textContent === 'Loading reasons.')!; expect(document.activeElement).toBe(status);
    const cancel = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Keep this offer')!; if (moved) cancel.focus();
    complete({ status: 'ok', value: { schemaVersion: 1, key: 'offer.declineReasons.v1', policyVersion: 'policy-v2', reasons: [{ code: 'body', label: 'Body style', attribute: 'body' }], provenance: { status: 'assumed', basis: 'fixture', source: 'fixture', sourceDate: '2026-11-14' } } }); await settle();
    expect(document.activeElement).toBe(moved ? cancel : dialog.querySelector('button[role="radio"][tabindex="0"]')); expect(client['decide']).not.toHaveBeenCalled();
  });
  it('focuses the actual source retry control when the reason registry is unavailable', async () => {
    client['readDecisionReasons'].mockResolvedValueOnce({ status: 'unavailable' });
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-offer-action="decline"]')!.click(); await settle();
    const retry = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-offer-action="reasons-refresh"]');
    expect(retry?.hidden).toBe(false); expect(document.activeElement).toBe(retry); expect(client['decide']).not.toHaveBeenCalled();
  });
  it('links touched return-mileage validation to the actual input and clears it on a valid controlled value', async () => {
    const dialog = await reviewAcceptance(); const mileage = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    const summary = dialog.querySelector<HTMLElement>('.gcsp-error-summary'); expect(summary).not.toBeNull(); expect(summary?.hidden).toBe(true);
    mileage.dispatchEvent(new Event('blur')); await settle(); expect(summary?.hidden).toBe(false); expect(mileage.getAttribute('aria-invalid')).toBe('true');
    expect(mileage.getAttribute('aria-describedby')).toContain(mileage.id + '-error');
    const link = summary!.querySelector<HTMLAnchorElement>('a')!; expect(link.getAttribute('href')).toBe('#' + mileage.id); link.click(); expect(document.activeElement).toBe(mileage);
    mileage.value = '006100'; mileage.dispatchEvent(new Event('input')); await settle(); expect(mileage.value).toBe('006100'); expect(summary?.hidden).toBe(true); expect(mileage.hasAttribute('aria-invalid')).toBe(false);
    expect(client['decide']).not.toHaveBeenCalled();
  });
  it('keeps native fields and dismissal locked while the explicit acceptance command is pending', async () => {
    let finish!: (value: OfferFailure) => void; client['decide'].mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const dialog = await reviewAcceptance(); const mileage = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    mileage.value = '6100'; mileage.dispatchEvent(new Event('input')); await settle();
    for (const box of Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) box.click(); await settle();
    dialog.querySelector<HTMLButtonElement>('[data-offer-action="confirm"]')!.click(); await settle();
    expect(Array.from(dialog.querySelectorAll('input')).every(input => input.disabled)).toBe(true);
    expect(dialog.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(); expect(dialog.closest<HTMLElement>('.gcsp-side-drawer')?.hidden).toBe(false);
    expect(client['decide']).toHaveBeenCalledTimes(1); finish({ status: 'pending' }); await settle(); expect(client['decide']).toHaveBeenCalledTimes(1);
  });
  it('loads server decline reasons and offers a separate explicit preference confirmation', async () => {
    fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load();
    fixture.nativeElement.querySelector('[data-offer-action="decline"]').click(); await settle();
    const reason = fixture.nativeElement.querySelector('[role="dialog"] :is(input[type="radio"], button[role="radio"])'); expect(reason.value).toBe('body');
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
    fixture.nativeElement.querySelector('[role="dialog"] :is(input[type="radio"], button[role="radio"])').click(); await settle();
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
    const isLoading = () => !!fixture.nativeElement.querySelector('.gcsp-skeleton[data-layout="offer"]');
    let loadingHeading: HTMLElement;
    const openNext = async () => {
      client['readFollowup'].mockResolvedValue({ status: 'ok', value: { schemaVersion: 1, state: 'ready', decisionId: 'decision-1', savedChange: savedFollowup(),
        comparison: { schemaVersion: 1, currentBriefVersion: 8, requirements: [], previous: { offer: offerScreenFixture('declined') }, next: { offer: { ...actionableOffer(), offerId: 'offer-2' } } } } });
      fixture.componentRef.setInput('offerId', 'offer-1'); await settle(); await load(offerScreenFixture('declined'));
      const open = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('gcsp-offer-followup button')).find((button) => button.textContent?.includes('Open this offer'))!;
      open.focus(); open.click(); await settle();
      expect(reads.at(-1)!.id).toBe('offer-2'); expect(document.activeElement).toBe(heading()); expect(heading().textContent).toBe('Your offer');
      expect(heading().closest('.gcsp-vh')).not.toBeNull(); expect(isLoading()).toBe(true); loadingHeading = heading();
    };
    const resolveNext = async (value: OfferResult<OfferProjection> | OfferFailure, read = reads.at(-1)!) => { read.resolve(value as OfferResult<OfferProjection>); await settle(); };

    it('focuses the final ready heading once a delayed next-offer read completes', async () => {
      await openNext(); await resolveNext({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-2' } });
      expect(heading().textContent).toBe('Your offer'); expect(heading().isConnected).toBe(true);
      expect(loadingHeading.isConnected).toBe(false); expect(heading()).not.toBe(loadingHeading); expect(isLoading()).toBe(false);
      expect(document.activeElement).toBe(heading());
    });
    it('focuses the failure heading when the delayed next-offer read fails', async () => {
      await openNext(); await resolveNext({ status: 'unavailable', code: 'offer-unavailable', retryable: true });
      expect(heading().textContent).toBe('Your offer could not be loaded'); expect(document.activeElement).toBe(heading());
      expect(loadingHeading.isConnected).toBe(false); expect(heading()).not.toBe(loadingHeading); expect(isLoading()).toBe(false);
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
      expect(isLoading()).toBe(false); expect(loadingHeading.isConnected).toBe(false); expect(focus).not.toHaveBeenCalled();
    });
    it('does not move focus for a read completed under a different account', async () => {
      await openNext(); const stale = reads.at(-1)!;
      auth.set({ status: 'ready', context: { ...offerScreenEmployee, subject: 'other-subject', employeeId: 'employee-2' } }); await settle();
      await resolveNext({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-2' } }, stale);
      expect(isLoading()).toBe(true); expect(heading().textContent).toBe('Your offer');
      expect(reads.at(-1)).not.toBe(stale); await resolveNext({ status: 'ok', value: { ...offerScreenFixture(), offerId: 'offer-2' } });
      expect(isLoading()).toBe(false); expect(loadingHeading.isConnected).toBe(false); expect(document.activeElement).not.toBe(heading());
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
      provideRouter([]),
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
