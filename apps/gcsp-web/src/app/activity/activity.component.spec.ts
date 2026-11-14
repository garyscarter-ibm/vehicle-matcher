import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { ActivityClient } from './activity.client';
import { ActivityComponent } from './activity.component';
import { isApprovedActivityImage } from './activity-image-registry';
import { ActivityOffer, ActivityProjection, ActivityResult, ActivityStateChange } from './activity.types';

const employee: ApplicationContext & { readonly employeeId: string } = { subject: 'subject-one', roles: ['employee'], environmentId: 'env-one', runId: 'run-one',
  employeeId: 'employee-one', policyVersion: 'policy-one', capabilities: ['activity:read'] };
const offer = (state = 'active', offerId = 'offer-one'): ActivityOffer => ({ offerRef: { offerId }, state,
  displayState: state === 'awaiting-review' ? 'unavailable' : state as ActivityOffer['displayState'], version: 4,
  briefVersion: 8, expiresAt: '2020-01-02T00:00:00.000Z' });
const projection = (patch: Partial<ActivityProjection> = {}): ActivityProjection => ({
  runId: employee.runId, employeeId: employee.employeeId, asOf: '2026-11-14T08:00:00.000Z', clockVersion: 'clock-1',
  briefVersion: 8, permission: { searchConsent: true, holdConsent: true, paused: false, permissionVersion: 6, canSearch: true, canHold: true },
  state: 'searching', lastSuccessfulCheck: null, searchEvidence: { status: 'recorded', checks: 2 }, sourceStatus: 'ok',
  currentOffer: null, offers: [], stateChanges: [], stateChangesEvidence: { status: 'not-recorded', rejectedReceipts: 0 }, ...patch,
});
const ok = (value: ActivityProjection): ActivityResult<ActivityProjection> => ({ status: 'ok', value });
const display = (offerId = 'offer-one', images: readonly { src: string; alt?: string; caption?: string; fidelity?: string }[] = []) => ({
  status: 'ok' as const, value: { offerRef: { offerId }, title: 'BMW X3', images },
});
const imageOne = { src: '/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp',
  alt: 'BMW X3 side view', fidelity: 'representative-configuration', caption: 'Side view' };
const imageTwo = { src: '/api/gcsp/vehicle-images/bmw-display-07c269dd7f55fad0a56b.webp',
  alt: 'BMW X3 front view', kind: 'representative-model' };
const event = (eventId: string, operation: ActivityStateChange['operation'], occurredAt: string): ActivityStateChange => ({
  eventId, eventType: 'brief-changed', operation, briefVersion: 8, previousBriefVersion: 7, occurredAt,
});
const pageText = (fixture: ComponentFixture<ActivityComponent>): string =>
  fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('native employee activity view', () => {
  let state: WritableSignal<SessionState>;
  let client: {
    readActivity: ReturnType<typeof vi.fn>;
    readOfferDisplay: ReturnType<typeof vi.fn>;
    readControlVersions: ReturnType<typeof vi.fn>;
    command: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    state = signal<SessionState>({ status: 'ready', context: employee });
    client = {
      readActivity: vi.fn(async () => ok(projection())),
      readOfferDisplay: vi.fn(async () => ({ status: 'unavailable', code: 'no-display' })),
      readControlVersions: vi.fn(async () => ({ status: 'ok', value: { briefVersion: 8, draftVersion: 5 } })),
      command: vi.fn(async () => ({ status: 'ok', value: {} })),
    };
    TestBed.configureTestingModule({ imports: [ActivityComponent], providers: [
      provideRouter([]), { provide: AuthPort, useValue: { state, signIn: vi.fn(async () => {}), retry: vi.fn(async () => {}) } },
      { provide: ActivityClient, useValue: client },
    ] });
  });

  afterEach(() => { TestBed.resetTestingModule(); });

  async function mount() {
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    TestBed.flushEffects();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.view().phase).toBe('ready');
    });
    fixture.detectChanges();
    return fixture;
  }

  it('renders server-backed no-match and exclusion copy, and keeps acknowledgement local', async () => {
    client.readActivity.mockResolvedValueOnce(ok(projection({ lastSuccessfulCheck: {
      checkedAt: '2026-11-14T07:30:00.000Z', clockVersion: 'clock-1', carsChecked: 12, suitableCars: 0,
      exclusions: [
        { essential: 'seats', requirement: { operator: 'gte', value: 9 }, cars: 12 },
        { essential: 'boot', requirement: { operator: 'gte', value: 430, unit: 'litres' }, cars: 9 },
      ], outcome: 'no-match', limitation: 'renewal-deadline-unknown',
    } })));
    const fixture = await mount();
    const initialCalls = client.readActivity.mock.calls.length;
    expect(pageText(fixture)).toContain('Still searching. No match yet.');
    expect(pageText(fixture)).toContain('No released car has 9 seats.');
    expect(pageText(fixture)).toContain('9 of 12 cars do not have 430 litres of boot space.');
    expect(pageText(fixture)).toContain('Buddy cannot hold a car for you yet.');
    const keep = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent.trim() === 'Keep searching') as HTMLButtonElement;
    const review = fixture.nativeElement.querySelector('[data-focus-key="review-preferences"]') as HTMLAnchorElement;
    keep.focus(); keep.click(); fixture.detectChanges();
    expect(pageText(fixture)).toContain('Buddy will keep searching with your preferences as they are.');
    expect(fixture.nativeElement.querySelector('button')?.textContent).not.toContain('Keep searching');
    expect(fixture.nativeElement.ownerDocument.activeElement).toBe(review);
    expect(client.readActivity).toHaveBeenCalledTimes(initialCalls);
    expect(client.command).not.toHaveBeenCalled();
  });

  it('keeps a past-dated active offer open, uses its London deadline, and links with the exact server id', async () => {
    client.readActivity.mockResolvedValueOnce(ok(projection({ currentOffer: offer('active', 'offer-current-7f96'),
      state: 'offer', offers: [offer('active', 'offer-current-7f96')] })));
    client.readOfferDisplay.mockResolvedValueOnce(display('offer-current-7f96', [imageOne]));
    const fixture = await mount();
    expect(pageText(fixture)).toContain('Your buddy found a car');
    expect(pageText(fixture)).toContain('Waiting for you');
    expect(pageText(fixture)).toContain('Respond by 2 Jan 2020, 00:00');
    expect(pageText(fixture)).toContain('BMW X3');
    const link = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a')).find((anchor) => anchor.textContent.trim() === 'View offer') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/offers/offer-current-7f96');
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe(imageOne.src);
    expect(fixture.nativeElement.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  it('shows setup preferences and preserves an exact local route', async () => {
    client.readActivity.mockResolvedValueOnce(ok(projection({ permission: null, briefVersion: null, state: 'no-brief',
      searchEvidence: { status: 'not-recorded', reason: 'no-search-check-yet' } })));
    const fixture = await mount();
    expect(pageText(fixture)).toContain('Not set up');
    expect(pageText(fixture)).toContain('Set up your buddy');
    expect(pageText(fixture)).toContain('Choose your preferences to get started.');
    const link = fixture.nativeElement.querySelector('a[href="/preferences"]');
    expect(link).toBeTruthy();
  });

  it('does not use an offer title or image display whose reference differs from the current offer', async () => {
    client.readActivity.mockResolvedValueOnce(ok(projection({ currentOffer: offer('active', 'offer-current-7f96'),
      state: 'offer', offers: [offer('active', 'offer-current-7f96')] })));
    client.readOfferDisplay.mockResolvedValueOnce(display('offer-other', [imageOne]));
    const fixture = await mount();
    expect(pageText(fixture)).toContain('Your buddy found a car');
    expect(pageText(fixture)).not.toContain('BMW X3');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(pageText(fixture)).toContain('No image for this car yet');
  });

  it('suppresses Buddy controls for accepted offers and keeps terminal wording', async () => {
    client.readActivity.mockResolvedValueOnce(ok(projection({ currentOffer: offer('accepted'), state: 'offer-closed',
      offers: [offer('accepted')] })));
    const fixture = await mount();
    expect(pageText(fixture)).toContain('Search finished');
    expect(pageText(fixture)).toContain('Your offer');
    expect(pageText(fixture)).toContain('Accepted');
    expect(fixture.nativeElement.querySelector('.activity-control')).toBeNull();
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).map((button) => button.textContent.trim()))
      .not.toContain('Engage Buddy');
  });

  it('keeps the update pending without optimistic changes and presents explicit recovery choices', async () => {
    const commandResult = deferred<ActivityResult<{ readonly version?: number }>>();
    client.command.mockReturnValueOnce(commandResult.promise);
    const fixture = await mount();
    const button = fixture.nativeElement.querySelector('.activity-control') as HTMLButtonElement;
    const update = fixture.componentInstance.toggleBuddy();
    await vi.waitFor(() => expect(client.command).toHaveBeenCalledOnce());
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.activity-page').getAttribute('aria-busy')).toBe('true');
    expect(fixture.componentInstance.view().projection?.permission?.paused).toBe(false);
    commandResult.resolve({ status: 'uncertain', code: 'do-not-render-diagnostic' });
    await update;
    fixture.detectChanges();
    expect(pageText(fixture)).toContain('The update outcome could not be confirmed.');
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).map((item) => item.textContent.trim()))
      .toContain('Retry update');
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).map((item) => item.textContent.trim()))
      .toContain('Refresh activity');
    expect(pageText(fixture)).not.toContain('do-not-render-diagnostic');
  });

  it('engages a fully disengaged Buddy using fresh versions and waits for authoritative readback', async () => {
    const disengaged = projection({ state: 'paused', permission: {
      searchConsent: false, holdConsent: false, paused: false, permissionVersion: 6, canSearch: false, canHold: false,
    } });
    client.readActivity.mockResolvedValueOnce(ok(disengaged));
    const fixture = await mount();
    const button = fixture.nativeElement.querySelector('.activity-control') as HTMLButtonElement;
    expect(button.textContent.trim()).toBe('Engage Buddy');
    const versions = deferred<{ status: 'ok'; value: { briefVersion: number; draftVersion: number } }>();
    const result = deferred<ActivityResult<{}>>();
    const readback = deferred<ActivityResult<ActivityProjection>>();
    client.readControlVersions.mockReturnValueOnce(versions.promise);
    client.command.mockReturnValueOnce(result.promise);
    client.readActivity.mockReturnValueOnce(readback.promise);
    button.click(); fixture.detectChanges();
    expect(client.readControlVersions).toHaveBeenCalledOnce();
    expect(client.command).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(fixture.componentInstance.view().projection).toBe(disengaged);
    versions.resolve({ status: 'ok', value: { briefVersion: 8, draftVersion: 11 } });
    await vi.waitFor(() => expect(client.command).toHaveBeenCalledOnce());
    expect(client.command).toHaveBeenCalledWith('engage', {
      commandId: expect.any(String), expectedBriefVersion: 8, expectedDraftVersion: 11,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fixture.componentInstance.view().projection).toBe(disengaged);
    result.resolve({ status: 'ok', value: {} });
    await vi.waitFor(() => expect(client.readActivity).toHaveBeenCalledTimes(2));
    fixture.detectChanges();
    expect(fixture.componentInstance.view().projection).toBeNull();
    expect(pageText(fixture)).not.toContain('Buddy engaged');
    readback.resolve(ok(projection({ briefVersion: 9 })));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.activity-control')?.textContent.trim()).toBe('Disengage Buddy');
    });
    expect(pageText(fixture)).toContain('Buddy engaged');
    expect(client.command).toHaveBeenCalledOnce();
  });

  it('offers Engage Buddy after an explicit disengage reads back revoked consent', async () => {
    const fixture = await mount();
    client.readActivity.mockResolvedValueOnce(ok(projection({ briefVersion: 9, state: 'paused', permission: {
      searchConsent: false, holdConsent: false, paused: false, permissionVersion: 9, canSearch: false, canHold: false,
    } })));
    const button = fixture.nativeElement.querySelector('.activity-control') as HTMLButtonElement;
    expect(button.textContent.trim()).toBe('Disengage Buddy');
    button.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.activity-control')?.textContent.trim()).toBe('Engage Buddy');
    });
    expect(client.command).toHaveBeenCalledWith('disengage', {
      commandId: expect.any(String), expectedBriefVersion: 8, expectedDraftVersion: 5,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(pageText(fixture)).toContain('Buddy disengaged');
    expect(fixture.componentInstance.view().projection?.briefVersion).toBe(9);
    expect(client.command).toHaveBeenCalledOnce();
  });

  it('clears an uncertain disengage after Refresh activity reads revoked consent without replaying the command', async () => {
    const fixture = await mount();
    client.command.mockResolvedValueOnce({ status: 'uncertain', code: 'diagnostic-detail' });
    (fixture.nativeElement.querySelector('.activity-control') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.view().retryAvailable).toBe(true);
    });
    client.readActivity.mockResolvedValueOnce(ok(projection({ briefVersion: 9, state: 'paused', permission: {
      searchConsent: false, holdConsent: false, paused: false, permissionVersion: 9, canSearch: false, canHold: false,
    } })));
    const refresh = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent.trim() === 'Refresh activity')!;
    refresh.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.view().phase).toBe('ready');
    });
    expect(fixture.componentInstance.view().retryAvailable).toBe(false);
    expect(fixture.nativeElement.querySelector('.activity-control')?.textContent.trim()).toBe('Engage Buddy');
    expect(pageText(fixture)).not.toContain('Retry update');
    expect(client.readActivity).toHaveBeenCalledTimes(2);
    expect(client.command).toHaveBeenCalledOnce();
    expect(client.readControlVersions).toHaveBeenCalledOnce();
  });

  it('deduplicates event ids and collapses adjacent identical time and label rows in supplied order', async () => {
    const sameTime = '2026-11-14T07:00:00.000Z';
    client.readActivity.mockResolvedValueOnce(ok(projection({ stateChanges: [
      event('event-one', 'engaged', sameTime), event('event-two', 'engaged', sameTime),
      event('event-three', 'paused', sameTime), event('event-four', 'engaged', sameTime),
      event('event-one', 'confirmed', '2026-11-14T07:05:00.000Z'),
    ] })));
    const fixture = await mount();
    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLLIElement>('.activity-timeline-list li'));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Buddy engaged'), expect.stringContaining('Buddy disengaged'), expect.stringContaining('Buddy engaged'),
    ]);
    expect(fixture.nativeElement.querySelector('time')?.getAttribute('datetime')).toBe(sameTime);
  });

  it('accepts only exact reviewed image path and fidelity pairs and keeps the fallback when images fail validation', async () => {
    expect(isApprovedActivityImage(imageOne)).toBe(true);
    expect(isApprovedActivityImage({ ...imageOne, src: `${imageOne.src}?width=500` })).toBe(false);
    expect(isApprovedActivityImage({ ...imageOne, src: `${imageOne.src}lookalike` })).toBe(false);
    expect(isApprovedActivityImage({ ...imageOne, src: `${imageOne.src}#crop` })).toBe(false);
    expect(isApprovedActivityImage({ ...imageOne, src: 'https://images.example/car.webp' })).toBe(false);
    expect(isApprovedActivityImage({ ...imageOne, fidelity: 'representative-model' })).toBe(true);
    expect(isApprovedActivityImage({ ...imageOne, fidelity: 'confirmed-listing' })).toBe(false);
    expect(isApprovedActivityImage({ ...imageOne, alt: '  ' })).toBe(false);
    const modelOnly = { src: '/assets/gcsp-vehicle-evidence/01af2978ba13fd99e11d6477eb706e0648f67d5602bc72e8e20217908b235748.webp',
      alt: 'BMW model', fidelity: 'representative-model' };
    expect(isApprovedActivityImage(modelOnly)).toBe(true);
    expect(isApprovedActivityImage({ ...modelOnly, fidelity: 'representative-configuration' })).toBe(false);
    expect(isApprovedActivityImage({ src: '/assets/brand-hero/bmw.jpg', alt: 'BMW', fidelity: 'representative' })).toBe(true);
    client.readActivity.mockResolvedValueOnce(ok(projection({ currentOffer: offer(), state: 'offer', offers: [offer()] })));
    client.readOfferDisplay.mockResolvedValueOnce(display('offer-one', [{ src: 'https://images.example/car.webp', alt: 'Car' }]));
    const fixture = await mount();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(pageText(fixture)).toContain('No image for this car yet');
  });

  it('keeps other approved image choices available after a broken image', async () => {
    client.readActivity.mockResolvedValueOnce(ok(projection({ currentOffer: offer(), state: 'offer', offers: [offer()] })));
    client.readOfferDisplay.mockResolvedValueOnce(display('offer-one', [imageOne, imageTwo]));
    const fixture = await mount();
    const firstImage = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    firstImage.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(pageText(fixture)).toContain('No image for this car yet');
    const second = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent.trim() === 'Image 2') as HTMLButtonElement;
    second.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe(imageTwo.src);
    expect(second.getAttribute('aria-pressed')).toBe('true');
  });

  it('reads again on a new component mount instead of carrying navigation state across visits', async () => {
    const first = await mount();
    expect(client.readActivity).toHaveBeenCalledOnce();
    first.destroy();
    const second = await mount();
    expect(client.readActivity).toHaveBeenCalledTimes(2);
    expect(second.componentInstance.view().projection?.employeeId).toBe(employee.employeeId);
  });
});
