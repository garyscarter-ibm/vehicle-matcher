import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, Role, SessionState } from '../auth/auth.port';
import { StatePageComponent } from '../pages/state-page.component';
import { routes } from '../routes';
import { OfferRouteComponent } from './offer-route.component';
import { OfferScreenComponent } from './offer-screen.component';
import { offerScreenEmployee, offerScreenFixture } from './offer-screen.fixture';
import { OfferClient } from './offer.client';
import { OfferProjection, OfferRequestOptions, OfferResult } from './offer.types';

describe('owned offer route composition', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  let state: ReturnType<typeof signal<SessionState>>;
  let auth: AuthPort;
  let signIn: ReturnType<typeof vi.fn<AuthPort['signIn']>>;
  let returnTo: string;
  let client: Record<string, ReturnType<typeof vi.fn>>;
  let reads: { id: string; options: OfferRequestOptions; resolve: (result: OfferResult<OfferProjection>) => void }[];
  const screen = (): OfferScreenComponent => harness.routeDebugElement!.query(By.directive(OfferScreenComponent)).componentInstance;
  const text = () => harness.routeNativeElement!.textContent!.replace(/\s+/g, ' ');
  const settle = async () => { harness.detectChanges(); await harness.fixture.whenStable(); harness.detectChanges(); };
  const load = async (index = reads.length - 1) => {
    reads[index]!.resolve({ status: 'ok', value: { ...offerScreenFixture(), offerId: reads[index]!.id } }); await settle();
  };
  const contextKey = JSON.stringify([offerScreenEmployee.subject, offerScreenEmployee.environmentId, offerScreenEmployee.runId, offerScreenEmployee.employeeId]);

  beforeEach(async () => {
    TestBed.resetTestingModule(); reads = []; returnTo = '/gcsp/offers/offer-1';
    state = signal<SessionState>({ status: 'ready', context: offerScreenEmployee }); signIn = vi.fn(async (_returnTo: string) => {});
    auth = { state, recovery: signal(null), initialize: vi.fn(async () => {}), retry: vi.fn(async () => {}),
      getAccessToken: vi.fn(async () => null), signIn, signOut: vi.fn(async () => {}),
      completeSignIn: vi.fn(async () => { state.set({ status: 'ready', context: offerScreenEmployee }); return returnTo; }) };
    client = Object.fromEntries(['readOffer', 'readDecisionReasons', 'decide', 'readFollowup', 'confirmFollowup'].map((key) => [key, vi.fn()]));
    client['readOffer'].mockImplementation((id: string, options: OfferRequestOptions) => new Promise((resolve) => reads.push({ id, options, resolve })));
    TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: AuthPort, useValue: auth }, { provide: OfferClient, useValue: client }] });
    harness = await RouterTestingHarness.create(); router = TestBed.inject(Router);
  });
  afterEach(() => {
    for (const method of ['readDecisionReasons', 'decide', 'readFollowup', 'confirmFollowup']) expect(client[method]).not.toHaveBeenCalled();
    harness?.fixture.destroy(); TestBed.resetTestingModule();
  });

  it('loads the signed-in direct link through the actual lazy route and existing offer screen', async () => {
    const route = await harness.navigateByUrl('/offers/offer-1', OfferRouteComponent); await settle();
    expect(route.offerId()).toBe('offer-1'); expect(screen().offerId()).toBe('offer-1');
    expect(reads).toHaveLength(1); expect(reads[0]!.id).toBe('offer-1'); expect(reads[0]!.options.expectedContextKey).toBe(contextKey);
    expect(harness.routeDebugElement!.injector.get(ActivatedRoute).snapshot.data['title']).toBe('Your offer');
    expect(text()).toContain('Loading your offer'); await load(); expect(text()).toContain('BMW 330e M Sport Touring');
    expect(text()).not.toContain('This page is not available yet.');
  });

  it('updates the same route instance and cancels the previous selector read', async () => {
    const first = await harness.navigateByUrl('/offers/offer-1', OfferRouteComponent); await settle(); const firstScreen = screen();
    const second = await harness.navigateByUrl('/offers/offer-2', OfferRouteComponent); await settle();
    expect(second).toBe(first); expect(screen()).toBe(firstScreen); expect(second.offerId()).toBe('offer-2');
    expect(reads.map((read) => read.id)).toEqual(['offer-1', 'offer-2']); expect(reads[0]!.options.signal!.aborted).toBe(true);
    await load(0); expect(text()).toContain('Loading your offer'); await load(1); expect(text()).toContain('BMW 330e M Sport Touring');
  });

  it('takes the selector from the path and keeps query or fragment changes from becoming commands or identity', async () => {
    const first = await harness.navigateByUrl('/offers/offer-1?employeeId=other&runId=other&decision=accept#confirm', OfferRouteComponent); await settle(); await load();
    const second = await harness.navigateByUrl('/offers/offer-1?employeeId=someone-else&decision=decline#followup', OfferRouteComponent); await settle();
    expect(second).toBe(first); expect(reads).toHaveLength(1); expect(reads[0]!.options.expectedContextKey).toBe(contextKey);
    expect(screen().offerId()).toBe('offer-1'); expect(text()).toContain('BMW 330e M Sport Touring');
  });

  it.each(['offer-2', 'https://outside.invalid/a?decision=accept#done', '../orders'])
    ('navigates an emitted next handle as one local segment without a duplicate read: %s', async (handle) => {
      const route = await harness.navigateByUrl('/offers/offer-1', OfferRouteComponent); await settle(); await load();
      screen().openNextOffer(handle); await settle();
      const url = router.parseUrl(router.url); const segments = url.root.children['primary']!.segments;
      expect(segments.map((segment) => segment.path)).toEqual(['offers', handle]); expect(url.queryParams).toEqual({}); expect(url.fragment).toBeNull();
      expect(route.offerId()).toBe(handle); expect(screen().offerId()).toBe(handle);
      expect(reads.map((read) => read.id)).toEqual(['offer-1', handle]); await load();
      expect(router.url).not.toContain('outside.invalid/a?');
    });

  it('returns a signed-out offer link through the existing sign-in and callback flow without submitting', async () => {
    state.set({ status: 'signed-out' }); returnTo = '/gcsp/offers/offer-1?source=email#details';
    await harness.navigateByUrl('/offers/offer-1?source=email#details', StatePageComponent); await settle();
    expect(router.parseUrl(router.url).queryParams['returnTo']).toBe(returnTo); expect(reads).toHaveLength(0);
    expect(text()).toContain('Sign in'); harness.routeNativeElement!.querySelector<HTMLButtonElement>('button')!.click(); await settle();
    expect(signIn).toHaveBeenCalledWith(returnTo); expect(reads).toHaveLength(0);
    await harness.navigateByUrl('/auth/callback'); await settle();
    expect(router.url).toBe('/offers/offer-1?source=email#details'); expect(reads.map((read) => read.id)).toEqual(['offer-1']);
    expect(screen().offerId()).toBe('offer-1'); await load();
  });

  it.each([['presenter'], ['employee', 'presenter'], ['greg']] satisfies Role[][])
    ('retains the route guard for roles %j before any offer read', async (...roles) => {
      state.set({ status: 'ready', context: { ...offerScreenEmployee, roles } });
      await harness.navigateByUrl('/offers/offer-1', StatePageComponent); await settle();
      expect(router.url).toBe('/access-denied'); expect(text()).toContain('Access not available'); expect(reads).toHaveLength(0);
    });

  it('retains an explicitly denied session at the existing access boundary', async () => {
    state.set({ status: 'denied', message: 'Denied' }); await harness.navigateByUrl('/offers/offer-1', StatePageComponent); await settle();
    expect(router.url).toBe('/access-denied'); expect(reads).toHaveLength(0);
  });

  it('destroys the route-local request on exit and starts a fresh screen on re-entry', async () => {
    const first = await harness.navigateByUrl('/offers/offer-1', OfferRouteComponent); await settle();
    await harness.navigateByUrl('/access-denied', StatePageComponent); await settle(); expect(reads[0]!.options.signal!.aborted).toBe(true);
    await load(0); expect(text()).toContain('Access not available');
    const second = await harness.navigateByUrl('/offers/offer-2', OfferRouteComponent); await settle(); expect(second).not.toBe(first);
    expect(reads.map((read) => read.id)).toEqual(['offer-1', 'offer-2']); expect(text()).toContain('Loading your offer'); await load(1);
  });
});
