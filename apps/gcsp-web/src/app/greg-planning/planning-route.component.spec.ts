import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { OrderPlanComponent } from './order-plan.component';
import { PlanningClient } from './planning.client';
import { PlanningRouteComponent } from './planning-route.component';
import { PlanningStore } from './planning.store';
import { ProductionStatusComponent } from './production-status.component';

const context: ApplicationContext = { subject: 'greg', environmentId: 'isolated', runId: 'run-1', policyVersion: 'p1', roles: ['greg'], capabilities: [] };
function value() { return { mode: 'current', preview: false, presentation: {}, plan: { planId: 'plan-1', runId: 'run-1', asOf: '2026-11-16T12:00:00Z',
  versions: { policy: 'p1', forecast: 'f1', stock: 's1', supply: 'i1', cohort: 'c1', catalog: 'v1' }, status: 'feasible', orderQuantity: 1, spendMinor: 4000000, currency: 'GBP',
  quantities: [{ derivativeId: 'd1', modelId: 'm1', quantity: 1 }], modelQuantities: [{ modelId: 'm1', quantity: 1 }], expectedAcceptableCoverage: { covered: 1, total: 1 },
  unallocatedStockRisk: { quantity: 0, totalSupply: 1 }, alternatives: [] } }; }
describe('planning route composition', () => {
  const state = signal<SessionState>({ status: 'ready', context }); const submit = vi.fn(); const readPlan = vi.fn(); const readProduction = vi.fn();
  beforeEach(async () => {
    state.set({ status: 'ready', context }); submit.mockReset().mockResolvedValue({ status: 'pending', reason: 'Waiting for Production.', operationId: 'operation-1', httpStatus: 202 });
    readPlan.mockReset().mockResolvedValue({ status: 'ok', value: value() }); readProduction.mockReset().mockResolvedValue({ status: 'ok', value: { asOf: '2026-11-16T12:00:00Z', provider: {}, submissions: [], requests: [] } });
    await TestBed.configureTestingModule({ imports: [PlanningRouteComponent], providers: [provideRouter([{ path: 'greg/plan', component: PlanningRouteComponent }]), { provide: AuthPort, useValue: { state, signIn: vi.fn(), retry: vi.fn() } },
      { provide: PlanningClient, useValue: { readPlan, readProduction, previewPlan: vi.fn(), submit } }] }).compileComponents();
  });
  it('shares one route-owned store between both native Angular sections without auto submission', async () => {
    const fixture = TestBed.createComponent(PlanningRouteComponent); fixture.detectChanges(); await fixture.whenStable();
    const order = fixture.debugElement.query(By.directive(OrderPlanComponent)); const production = fixture.debugElement.query(By.directive(ProductionStatusComponent));
    expect(order.injector.get(PlanningStore)).toBe(production.injector.get(PlanningStore));
    await vi.waitFor(() => expect(order.injector.get(PlanningStore).plan()?.planId).toBe('plan-1'));
    expect(submit).not.toHaveBeenCalled(); expect((fixture.nativeElement as HTMLElement).querySelectorAll('h1').length).toBe(1);
  });
  it('keeps the selected planning heading before the six tabs for Next order and Order requests', async () => {
    const fixture = TestBed.createComponent(PlanningRouteComponent); fixture.detectChanges(); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const heading = root.querySelector('h1')!;
    expect(heading.closest('[role=tabpanel]')).toBeNull(); expect(heading.textContent).toBe('Next order');
    Array.from(root.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(tab => tab.textContent === 'Order requests')!.click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(root.querySelector('h1')?.textContent).toBe('Order requests'); expect(root.querySelector('h1')?.closest('[hidden]')).toBeNull();
    expect(root.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Order requests');
  });
  it('composes a deliberate request with pending feedback and renders outcome focus after the action', async () => {
    const fixture = TestBed.createComponent(PlanningRouteComponent); fixture.detectChanges(); await fixture.whenStable();
    const store = fixture.debugElement.query(By.directive(OrderPlanComponent)).injector.get(PlanningStore);
    await vi.waitFor(() => expect(store.canSubmit()).toBe(true)); fixture.detectChanges();
    const request = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === 'Request from Production')!;
    request.click(); await fixture.whenStable(); fixture.detectChanges(); await fixture.whenStable();
    expect(submit).toHaveBeenCalledOnce(); expect(store.submission()?.status).toBe('pending');
    expect(document.activeElement).toBe((fixture.nativeElement as HTMLElement).querySelector('[data-production-result]'));
  });
  it('focuses the fresh plan only after an explicit response-driven replan', async () => {
    const fixture = TestBed.createComponent(PlanningRouteComponent); fixture.detectChanges(); await fixture.whenStable();
    const production = fixture.debugElement.query(By.directive(ProductionStatusComponent)).componentInstance as ProductionStatusComponent;
    await production.replan(); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe((fixture.nativeElement as HTMLElement).querySelector('[data-plan-result]'));
  });
  it('clears the private store and aborts work when the route is destroyed', async () => {
    const fixture = TestBed.createComponent(PlanningRouteComponent); fixture.detectChanges(); await fixture.whenStable();
    const store = fixture.debugElement.query(By.directive(OrderPlanComponent)).injector.get(PlanningStore); const before = readPlan.mock.calls.length;
    fixture.destroy(); expect(store.plan()).toBeNull(); expect(store.production()).toBeNull();
    await store.refresh(); expect(readPlan).toHaveBeenCalledTimes(before); expect(submit).not.toHaveBeenCalled();
  });
});
