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
  const guard = (target = '/offers/offer-7') => TestBed.runInInjectionContext(() => sessionGuard({ data: { roles: ['employee'] } } as unknown as ActivatedRouteSnapshot, { url: target } as RouterStateSnapshot));
  const land = (target = '/') => TestBed.runInInjectionContext(() => landingGuard({} as ActivatedRouteSnapshot, { url: target } as RouterStateSnapshot));
  const url = (result: unknown) => TestBed.inject(Router).serializeUrl(result as UrlTree);
  it('sends signed-out direct entry to sign-in with a safe return route', async () => { expect(url(await guard())).toBe('/sign-in?returnTo=%2Fgcsp%2Foffers%2Foffer-7'); expect(initialize).toHaveBeenCalledOnce(); });
  it('allows the authorized role and renders unavailable context truthfully', async () => { state.set({ status: 'ready', context }); expect(await guard()).toBe(true); state.set({ status: 'unavailable', message: 'Unavailable', retryable: true }); expect(await guard()).toBe(true); });
  it('refuses roles and explicit denied contexts', async () => { state.set({ status: 'ready', context: { ...context, roles: ['greg'] } }); expect(url(await guard())).toBe('/access-denied'); state.set({ status: 'denied', message: 'Denied' }); expect(url(await guard())).toBe('/access-denied'); });
  it('lands an authenticated employee on their own account', async () => { state.set({ status: 'ready', context }); expect(url(await land())).toBe('/account'); });
  it('contains a rejected context read and retains the authorized return candidate', async () => {
    initialize.mockRejectedValueOnce(new Error('private upstream detail'));
    expect(url(await guard('/offers/offer-7?brand=mini#decision'))).toBe('/unavailable?returnTo=%2Fgcsp%2Foffers%2Foffer-7%3Fbrand%3Dmini%23decision');
  });
  it('retains new offer query and fragment on both base-prefixed and Angular direct entry', async () => {
    for (const target of ['/offers/offer-7?brand=mini#decision', '/gcsp/offers/offer-7?brand=mini#decision']) {
      expect(url(await guard(target))).toBe('/sign-in?returnTo=%2Fgcsp%2Foffers%2Foffer-7%3Fbrand%3Dmini%23decision');
    }
  });
  it('keeps launcher context through sign-in and role landing without granting query roles', async () => {
    const entry = '/?brand=bmw&role=presenter&employeeId=another#home';
    expect(url(await land(entry))).toBe('/sign-in?returnTo=%2Fgcsp%2F%3Fbrand%3Dbmw%26role%3Dpresenter%26employeeId%3Danother%23home');
    for (const [roles, path] of [[['employee'], '/account'], [['greg'], '/greg/plan'], [['presenter', 'employee'], '/presenter']] as const) {
      state.set({ status: 'ready', context: { ...context, roles } });
      expect(url(await land(entry))).toBe(`${path}?brand=bmw&role=presenter&employeeId=another#home`);
    }
    state.set({ status: 'ready', context: { ...context, roles: [] } });
    expect(url(await land(entry))).toBe('/access-denied?brand=bmw&role=presenter&employeeId=another#home');
  });
  it('retains launcher context when initialization rejects, and keeps denied and loading states truthful', async () => {
    initialize.mockRejectedValueOnce(new Error('private upstream detail'));
    expect(url(await land('/?brand=mini#home'))).toBe('/unavailable?returnTo=%2Fgcsp%2F%3Fbrand%3Dmini%23home');
    state.set({ status: 'denied', message: 'Denied' }); expect(await land()).toBe(true);
    state.set({ status: 'loading' }); expect(await guard()).toBe(true); expect(await land()).toBe(true);
  });
  it('retains comparison direct entry through sign-in and enforces its two permitted roles', async () => {
    const inspect = () => TestBed.runInInjectionContext(() => sessionGuard({ data: { roles: ['greg', 'presenter'] } } as unknown as ActivatedRouteSnapshot, { url: '/comparison?experimentId=points' } as RouterStateSnapshot));
    expect(url(await inspect())).toBe('/sign-in?returnTo=%2Fgcsp%2Fcomparison%3FexperimentId%3Dpoints');
    for (const role of ['greg', 'presenter'] as const) { state.set({ status: 'ready', context: { ...context, roles: [role] } }); expect(await inspect()).toBe(true); }
    state.set({ status: 'ready', context }); expect(url(await inspect())).toBe('/access-denied');
  });
});
