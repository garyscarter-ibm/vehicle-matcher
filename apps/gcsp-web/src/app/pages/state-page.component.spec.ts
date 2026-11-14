import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { routes } from '../routes';
describe('route state presentation', () => {
  const state = signal<SessionState>({ status: 'unavailable', message: 'No connection', retryable: true });
  const signIn = vi.fn(async (_target: string) => {}); const retry = vi.fn<() => Promise<string | void>>(async () => {}); const completeSignIn = vi.fn<() => Promise<string | void>>(async () => {});
  beforeEach(() => { signIn.mockReset(); retry.mockReset(); completeSignIn.mockReset(); state.set({ status: 'unavailable', message: 'No connection', retryable: true }); TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: AuthPort, useValue: { state, recovery: signal(null), initialize: async () => {}, retry, signIn, completeSignIn } }] }); });
  it('shows callback failure and retries through the auth port without repeating exchange', async () => {
    completeSignIn.mockRejectedValue(new Error('consumed callback')); const harness = await RouterTestingHarness.create('/auth/callback'); await harness.fixture.whenStable(); expect(harness.routeNativeElement?.textContent).toContain('Account unavailable');
    retry.mockImplementation(async () => { state.set({ status: 'ready', context: { subject: 'employee', roles: ['employee'], environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] } }); return '/gcsp/orders'; });
    harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable(); expect(retry).toHaveBeenCalledOnce(); expect(completeSignIn).toHaveBeenCalledOnce(); expect(TestBed.inject(Router).url).toBe('/orders');
  });
  it('shows useful unavailable context on refresh without invented account facts', async () => { const harness = await RouterTestingHarness.create('/account'); expect(harness.routeNativeElement?.textContent).toContain('Account unavailable'); expect(harness.routeNativeElement?.textContent).not.toContain('subject'); harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable(); expect(retry).toHaveBeenCalledOnce(); });
  it('starts real sign-in through its port with the owned email deep link', async () => { state.set({ status: 'signed-out' }); const harness = await RouterTestingHarness.create('/sign-in?returnTo=%2Fgcsp%2Foffers%2Foffer-7'); harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable(); expect(signIn).toHaveBeenCalledWith('/gcsp/offers/offer-7'); });
  it('shows access denial for unauthorized direct entry', async () => { state.set({ status: 'ready', context: { subject: 'greg', roles: ['greg'], environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] } }); const harness = await RouterTestingHarness.create('/offers/offer-7'); expect(harness.routeNativeElement?.textContent).toContain('Access not available'); });
  it('keeps unfinished body features explicitly unavailable', async () => { state.set({ status: 'ready', context: { subject: 'employee', roles: ['employee'], environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] } }); const harness = await RouterTestingHarness.create('/account'); expect(harness.routeNativeElement?.textContent).toContain('Your cars'); expect(harness.routeNativeElement?.textContent).toContain('This page is not available yet.'); });
});
