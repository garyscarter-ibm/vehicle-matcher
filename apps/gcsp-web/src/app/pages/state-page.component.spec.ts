import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { AccountComponent } from '../account/account.component';
import { routes } from '../routes';
import { ShellComponent } from '../shell/shell.component';
const context = { subject: 'employee', roles: ['employee'] as const, environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] };
describe('route state presentation', () => {
  const state = signal<SessionState>({ status: 'unavailable', message: 'No connection', retryable: true });
  const signIn = vi.fn(async (_target: string) => {}); const retry = vi.fn<() => Promise<string | void>>(async () => {}); const completeSignIn = vi.fn<() => Promise<string | void>>(async () => {});
  beforeEach(() => { signIn.mockReset(); retry.mockReset(); completeSignIn.mockReset(); state.set({ status: 'unavailable', message: 'No connection', retryable: true }); TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: AuthPort, useValue: { state, recovery: signal(null), initialize: async () => {}, retry, signIn, completeSignIn } }] }); });
  it('shows callback failure and retries through the auth port without repeating exchange', async () => {
    completeSignIn.mockRejectedValue(new Error('consumed callback')); const harness = await RouterTestingHarness.create('/auth/callback'); await harness.fixture.whenStable(); expect(harness.routeNativeElement?.textContent).toContain('Account unavailable');
    retry.mockImplementation(async () => { state.set({ status: 'ready', context: { subject: 'employee', roles: ['employee'], environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] } }); return '/gcsp/orders'; });
    harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable(); expect(retry).toHaveBeenCalledOnce(); expect(completeSignIn).toHaveBeenCalledOnce(); expect(TestBed.inject(Router).url).toBe('/orders');
  });
  it('shows useful unavailable context on refresh through the shell without invented account facts', async () => {
    const fixture = TestBed.createComponent(ShellComponent); await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/account'); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Account unavailable'); expect(fixture.nativeElement.textContent).not.toContain('subject');
    fixture.nativeElement.querySelector('main button')!.click(); await fixture.whenStable(); expect(retry).toHaveBeenCalledOnce();
  });
  it('starts real sign-in through its port with the owned email deep link', async () => { state.set({ status: 'signed-out' }); const harness = await RouterTestingHarness.create('/sign-in?returnTo=%2Fgcsp%2Foffers%2Foffer-7'); harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable(); expect(signIn).toHaveBeenCalledWith('/gcsp/offers/offer-7'); });
  it('shows access denial for unauthorized direct entry', async () => { state.set({ status: 'ready', context: { subject: 'greg', roles: ['greg'], environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] } }); const harness = await RouterTestingHarness.create('/offers/offer-7'); expect(harness.routeNativeElement?.textContent).toContain('Access not available'); });
  it('retains the actual lazy account screen instead of the retired account placeholder', async () => {
    const account = routes.find((route) => route.path === 'account');
    expect(await (account!.loadComponent as () => Promise<unknown>)()).toBe(AccountComponent);
  });
  it.each<SessionState>([
    { status: 'loading' }, { status: 'signed-out' }, { status: 'unavailable', message: 'No connection', retryable: true },
    { status: 'denied', message: 'Denied' }, { status: 'ready', context },
  ])('distinguishes an unknown route from account state $status', async (session) => {
    state.set(session); const harness = await RouterTestingHarness.create('/missing-page?brand=mini');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Page not found');
    expect(TestBed.inject(Router).url).toBe('/missing-page?brand=mini');
    expect(completeSignIn).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  });
  it('retains a new offer link including its query and fragment when starting sign-in', async () => {
    state.set({ status: 'signed-out' });
    const harness = await RouterTestingHarness.create('/offers/offer-7?brand=mini#decision');
    harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable();
    expect(signIn).toHaveBeenCalledWith('/gcsp/offers/offer-7?brand=mini#decision');
  });
  it('recovers the requested route when an ordinary auth retry returns no callback URL', async () => {
    const harness = await RouterTestingHarness.create('/unavailable?returnTo=%2Fgcsp%2Fgreg%3Fbrand%3Dmini%23work');
    retry.mockImplementation(async () => { state.set({ status: 'ready', context: { ...context, roles: ['greg'] } }); });
    harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/greg?brand=mini#work'); expect(retry).toHaveBeenCalledOnce();
  });
  it('retains launcher context when the initial account read is unavailable and retry recovers', async () => {
    const harness = await RouterTestingHarness.create('/?brand=mini#home');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Account unavailable');
    retry.mockImplementation(async () => { state.set({ status: 'ready', context: { ...context, roles: ['greg'] } }); });
    harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/greg?brand=mini#home');
  });
  it('offers sign-in with the requested route when retry discovers a signed-out session', async () => {
    const harness = await RouterTestingHarness.create('/unavailable?returnTo=%2Fgcsp%2Foffers%2Foffer-7%3Fbrand%3Dmini%23decision');
    retry.mockImplementation(async () => { state.set({ status: 'signed-out' }); });
    harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/sign-in?returnTo=%2Fgcsp%2Foffers%2Foffer-7%3Fbrand%3Dmini%23decision');
    expect(signIn).not.toHaveBeenCalled();
    harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable();
    expect(signIn).toHaveBeenCalledWith('/gcsp/offers/offer-7?brand=mini#decision');
  });
  it('completes sign-in through the safe root and retains launcher context at role landing', async () => {
    completeSignIn.mockImplementation(async () => { state.set({ status: 'ready', context: { ...context, roles: ['greg'] } }); return '/gcsp/?brand=bmw#home'; });
    const harness = await RouterTestingHarness.create('/auth/callback'); await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/greg?brand=bmw#home'); expect(completeSignIn).toHaveBeenCalledOnce();
  });
  it('contains an unsafe retry destination at the authorized role landing', async () => {
    const harness = await RouterTestingHarness.create('/unavailable?returnTo=https%3A%2F%2Fother.invalid%2Faccount');
    retry.mockImplementation(async () => { state.set({ status: 'ready', context: { ...context, roles: ['greg'] } }); return 'https://other.invalid/account'; });
    harness.routeNativeElement!.querySelector('button')!.click(); await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/greg');
  });
});
