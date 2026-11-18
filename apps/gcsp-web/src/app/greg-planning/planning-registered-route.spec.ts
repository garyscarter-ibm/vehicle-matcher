import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { sessionGuard } from '../auth/route.guards';
import { routes } from '../routes';
import { OrderPlanComponent } from './order-plan.component';
import { PlanningClient } from './planning.client';
import { PlanningRouteComponent } from './planning-route.component';
import { PlanningStore } from './planning.store';
import { PlanValueDto } from './planning.types';
import { ProductionStatusComponent } from './production-status.component';

const greg: ApplicationContext = { subject: 'greg', environmentId: 'isolated', runId: 'run-1', policyVersion: 'p1', roles: ['greg'], capabilities: [] };
const plan = (): PlanValueDto => ({ mode: 'current', preview: false, presentation: {}, plan: {
  planId: 'plan-1', runId: 'run-1', asOf: '2026-11-16T12:00:00Z',
  versions: { policy: 'p1', forecast: 'f1', stock: 's1', supply: 'i1', cohort: 'c1', catalog: 'v1' },
  status: 'feasible', orderQuantity: 1, spendMinor: 4000000, currency: 'GBP',
  quantities: [{ derivativeId: 'd1', modelId: 'm1', quantity: 1 }], modelQuantities: [{ modelId: 'm1', quantity: 1 }],
  expectedAcceptableCoverage: { covered: 1, total: 1 }, unallocatedStockRisk: { quantity: 0, totalSupply: 1 }, alternatives: []
} });

// Exercises the exported routes and real guard. Controlled ports do not prove OIDC or Java acceptance.
describe('registered Greg planning route', () => {
  let state = signal<SessionState>({ status: 'ready', context: greg });
  let harness: RouterTestingHarness;
  const initialize = vi.fn(async () => {});
  const readPlan = vi.fn<PlanningClient['readPlan']>();
  const readProduction = vi.fn<PlanningClient['readProduction']>();
  const previewPlan = vi.fn<PlanningClient['previewPlan']>();
  const submit = vi.fn<PlanningClient['submit']>();

  beforeEach(async () => {
    state = signal<SessionState>({ status: 'ready', context: greg });
    initialize.mockClear(); previewPlan.mockReset(); submit.mockReset();
    readPlan.mockReset().mockResolvedValue({ status: 'ok', value: plan() });
    readProduction.mockReset().mockResolvedValue({ status: 'ok', value: {
      asOf: '2026-11-16T12:00:00Z', provider: {}, submissions: [], requests: []
    } });
    const auth = { state, recovery: signal(null), initialize, retry: vi.fn(async () => {}),
      signIn: vi.fn(async (_returnTo: string) => {}), signOut: vi.fn(async () => {}),
      completeSignIn: vi.fn(async () => {}), getAccessToken: vi.fn(async () => null) };
    TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: AuthPort, useValue: auth },
      { provide: PlanningClient, useValue: { readPlan, readProduction, previewPlan, submit } }] });
    harness = await RouterTestingHarness.create();
  });
  afterEach(() => { harness?.fixture.destroy(); TestBed.resetTestingModule(); });

  it('navigates through the guarded lazy Greg route, loads both sections and never submits on entry', async () => {
    const registered = routes.find(route => route.path === 'greg/plan');
    expect(registered?.loadComponent).toBeTypeOf('function');
    expect(registered?.component).toBeUndefined();
    expect(registered?.canActivate).toEqual([sessionGuard]);
    expect(registered?.data?.['roles']).toEqual(['greg']);

    await harness.navigateByUrl('/greg/plan', PlanningRouteComponent);
    await harness.fixture.whenStable(); harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/greg/plan');
    expect(initialize).toHaveBeenCalled();
    const activated = harness.routeDebugElement!.injector.get(ActivatedRoute).snapshot;
    expect(activated.routeConfig?.path).toBe('greg/plan');
    expect(activated.routeConfig?.loadComponent).toBe(registered?.loadComponent);
    expect(activated.data['roles']).toEqual(['greg']);
    const order = harness.routeDebugElement!.query(By.directive(OrderPlanComponent));
    const production = harness.routeDebugElement!.query(By.directive(ProductionStatusComponent));
    expect(order).toBeTruthy(); expect(production).toBeTruthy();
    const store = order.injector.get(PlanningStore);
    expect(store).toBe(production.injector.get(PlanningStore));
    await vi.waitFor(() => { expect(store.plan()?.planId).toBe('plan-1'); expect(store.production()).not.toBeNull(); });
    harness.detectChanges(); await harness.fixture.whenStable();
    expect(store.canSubmit()).toBe(true);
    expect(harness.routeNativeElement!.querySelector('#planning-title')?.textContent).toBe('Order planning');
    expect(harness.routeNativeElement!.querySelector('#production-title')?.textContent).toBe('Order requests');
    expect(readPlan).toHaveBeenCalledOnce(); expect(readProduction).toHaveBeenCalledOnce();
    expect(previewPlan).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });

  it('returns signed-out direct entry to sign-in with the planning return destination and no feature calls', async () => {
    state.set({ status: 'signed-out' });
    await harness.navigateByUrl('/greg/plan');
    await harness.fixture.whenStable(); harness.detectChanges();
    const destination = TestBed.inject(Router).parseUrl(TestBed.inject(Router).url);
    expect(TestBed.inject(Router).url.split('?')[0]).toBe('/sign-in');
    expect(destination.queryParams['returnTo']).toBe('/gcsp/greg/plan');
    expect(harness.routeNativeElement!.querySelector('gcsp-order-plan')).toBeNull();
    expect(readPlan).not.toHaveBeenCalled(); expect(readProduction).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });

  it('denies a presenter planning entry through the actual role guard without loading private sections', async () => {
    state.set({ status: 'ready', context: { ...greg, subject: 'presenter', roles: ['presenter'] } });
    await harness.navigateByUrl('/greg/plan');
    await harness.fixture.whenStable(); harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/access-denied');
    expect(harness.routeNativeElement!.textContent).toContain('Access not available');
    expect(harness.routeNativeElement!.querySelector('gcsp-order-plan, gcsp-production-status')).toBeNull();
    expect(readPlan).not.toHaveBeenCalled(); expect(readProduction).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });
});
