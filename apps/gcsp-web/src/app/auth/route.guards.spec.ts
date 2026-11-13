import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from './auth.port';
import { landingGuard, sessionGuard } from './route.guards';
const context = { subject: 'subject', roles: ['employee'] as const, environmentId: 'isolated', runId: 'run', employeeId: 'owned', policyVersion: 'policy', capabilities: [] };
describe('session route guards', () => {
  const state = signal<SessionState>({ status: 'signed-out' });
  const initialize = vi.fn(async () => {});
  beforeEach(() => { state.set({ status: 'signed-out' }); initialize.mockClear(); TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthPort, useValue: { state, initialize } }] }); });
  const guard = () => TestBed.runInInjectionContext(() => sessionGuard({ data: { roles: ['employee'] } } as unknown as ActivatedRouteSnapshot, { url: '/offers/offer-7' } as RouterStateSnapshot));
  const url = (result: unknown) => TestBed.inject(Router).serializeUrl(result as UrlTree);
  it('sends signed-out direct entry to sign-in with a safe return route', async () => { expect(url(await guard())).toBe('/sign-in?returnTo=%2Fgcsp%2Foffers%2Foffer-7'); expect(initialize).toHaveBeenCalledOnce(); });
  it('allows the authorized role and renders unavailable context truthfully', async () => { state.set({ status: 'ready', context }); expect(await guard()).toBe(true); state.set({ status: 'unavailable', message: 'Unavailable', retryable: true }); expect(await guard()).toBe(true); });
  it('refuses roles and explicit denied contexts', async () => { state.set({ status: 'ready', context: { ...context, roles: ['greg'] } }); expect(url(await guard())).toBe('/access-denied'); state.set({ status: 'denied', message: 'Denied' }); expect(url(await guard())).toBe('/access-denied'); });
  it('lands an authenticated employee on their own account', async () => { state.set({ status: 'ready', context }); const result = await TestBed.runInInjectionContext(() => landingGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)); expect(url(result)).toBe('/account'); });
  it('contains a rejected context read as an unavailable state', async () => { initialize.mockRejectedValueOnce(new Error('private upstream detail')); expect(url(await guard())).toBe('/unavailable'); });
});
