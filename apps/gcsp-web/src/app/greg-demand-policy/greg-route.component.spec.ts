import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, Role, SessionState } from '../auth/auth.port';
import { StatePageComponent } from '../pages/state-page.component';
import { routes } from '../routes';
import { GregClient } from './greg.client';
import { GregDemandComponent } from './greg-demand.component';
import { GregPolicyComponent } from './greg-policy.component';
import { GregRouteComponent } from './greg-route.component';
import { projectDemand } from './greg.projection';
import type { GregDemand, GregPolicy, GregResult } from './greg.types';

const ready = { status: 'ready', context: { subject: 'greg-subject', environmentId: 'isolated', runId: 'run-1', policyVersion: 'policy-1', roles: ['greg', 'employee'], capabilities: [] } } as const satisfies SessionState;
const at = '2026-11-16T12:00:00Z';
function demand(reference = 'Current demand'): GregDemand {
  const versions = { brief: [], policy: ['policy-1'] }; const cell = { count: { kind: 'band', fewerThan: 5, label: 'fewer than 5' }, versions };
  return projectDemand({ runId: 'run-1', asOf: at, projectionVersion: reference, basis: 'expressed-saved-demand', versions: { ...versions, revision: 1 },
    privacy: { threshold: 5, thresholdKey: 'privacy', policyVersion: 'policy-1', status: 'assumed', withheld: true },
    demand: { activeBriefs: cell, byModelLine: [], byBody: [], byFuel: [], essentials: [], unmet: { total: cell, byGate: [] } },
    holds: { total: cell, active: cell, byState: [], byType: [] }, offers: { made: cell, accepted: cell, declined: cell, expired: cell, selected: cell, declinedByReason: [] }, stock: { byModelLine: [], source: { status: 'ok' } } });
}
function policy(): GregPolicy { return { state: 'draft', activeVersion: 'policy-1', activeVersionLabel: 'Reviewed policy', versionNames: { 'policy-1': 'Reviewed policy' }, asOf: at, effectiveFrom: at,
  weightsAdoptionRequired: false, heldOffers: { count: null, message: 'Existing offers keep terms.' }, historyMessage: 'Version history retained.',
  fields: ['body', 'fuel', 'sportiness', 'comfort', 'economy', 'size'].map(key => ({ id: `weight:${key}`, key, kind: 'weight', value: 1, minimum: 0, step: 1,
    label: `${key} weight`, unitLabel: 'Relative weight', unit: 'relative-weight', source: 'reference', sourceDate: '2026-11-01', basis: 'Reviewed assumption.', status: 'assumed' })) }; }
const ok = <T>(value: T): GregResult<T> => ({ state: 'ready', value });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('Greg route integration and lifetime', () => {
  let harness: RouterTestingHarness; let router: Router; const state = signal<SessionState>(ready);
  const client = { loadDemand: vi.fn<GregClient['loadDemand']>(), readPolicy: vi.fn<GregClient['readPolicy']>(), preview: vi.fn<GregClient['preview']>(),
    preparePublish: vi.fn<GregClient['preparePublish']>(), publish: vi.fn<GregClient['publish']>() };
  const root = () => harness.routeNativeElement!;
  const settle = async () => { harness.detectChanges(); await harness.fixture.whenStable(); harness.detectChanges(); };
  const open = async () => { const route = await harness.navigateByUrl('/greg', GregRouteComponent); await settle(); return route; };
  beforeEach(async () => {
    state.set(ready); vi.clearAllMocks(); client.loadDemand.mockReset().mockResolvedValue(ok(demand())); client.readPolicy.mockReset().mockResolvedValue(ok(policy()));
    TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: AuthPort, useValue: { state, initialize: vi.fn(async () => {}), retry: vi.fn(), signIn: vi.fn() } },
      { provide: GregClient, useValue: client }] });
    harness = await RouterTestingHarness.create(); router = TestBed.inject(Router);
  });
  afterEach(() => { harness?.fixture.destroy(); TestBed.resetTestingModule(); vi.restoreAllMocks(); });

  it('opens the guarded lazy route with one store and one pair of reads for both mounted panels', async () => {
    const route = await open(); const demandScreen = harness.routeDebugElement!.query(By.directive(GregDemandComponent)).componentInstance as GregDemandComponent;
    const policyScreen = harness.routeDebugElement!.query(By.directive(GregPolicyComponent)).componentInstance as GregPolicyComponent;
    expect(demandScreen.store).toBe(route.store); expect(policyScreen.store).toBe(route.store); expect(client.loadDemand).toHaveBeenCalledOnce(); expect(client.readPolicy).toHaveBeenCalledOnce();
    expect(root().querySelector('h1')!.textContent).toBe('Employee car ordering'); expect(root().querySelectorAll('[role=tabpanel]')).toHaveLength(2);
    expect(root().querySelector('[role=tab][aria-selected=true]')!.textContent).toBe('Demand and supply'); expect(client.publish).not.toHaveBeenCalled();
  });
  it('keeps draft controls and values on keyboard tab changes without reloading or publishing', async () => {
    const route = await open(); const tabs = [...root().querySelectorAll<HTMLButtonElement>('[role=tab]')];
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle(); expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    const control = root().querySelector<HTMLInputElement>('input[type=number]')!;
    control.value = '9'; control.dispatchEvent(new Event('input', { bubbles: true })); await settle(); expect(route.store.view().fields[0].draft).toBe('9');
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await settle(); expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await settle();
    expect(root().querySelector('input[type=number]')).toBe(control); expect(control.value).toBe('9'); expect(client.loadDemand).toHaveBeenCalledOnce(); expect(client.readPolicy).toHaveBeenCalledOnce(); expect(client.publish).not.toHaveBeenCalled();
  });
  it.each([['employee'], ['presenter'], ['greg', 'presenter']] satisfies Role[][])('denies %j before private reads', async (...roles) => {
    state.set({ status: 'ready', context: { ...ready.context, roles } }); await harness.navigateByUrl('/greg', StatePageComponent); await settle();
    expect(router.url).toBe('/access-denied'); expect(client.loadDemand).not.toHaveBeenCalled(); expect(client.readPolicy).not.toHaveBeenCalled();
  });
  it('preserves signed-out Greg deep links through the existing sign-in return flow', async () => {
    state.set({ status: 'signed-out' }); await harness.navigateByUrl('/greg?from=ordering#policy', StatePageComponent); await settle();
    expect(router.parseUrl(router.url).queryParams['returnTo']).toBe('/gcsp/greg?from=ordering#policy'); expect(client.loadDemand).not.toHaveBeenCalled(); expect(client.readPolicy).not.toHaveBeenCalled();
  });
  it('aborts on route exit and ignores a late old result after a fresh store is created', async () => {
    const oldDemand = deferred<GregResult<GregDemand>>(); const oldPolicy = deferred<GregResult<GregPolicy>>();
    client.loadDemand.mockReturnValueOnce(oldDemand.promise); client.readPolicy.mockReturnValueOnce(oldPolicy.promise);
    const previous = await open(); const options = client.loadDemand.mock.calls[0][0]!;
    await harness.navigateByUrl('/access-denied', StatePageComponent); await settle(); expect(options.signal!.aborted).toBe(true); expect(previous.store.view().demand).toBeNull();
    const current = await open(); expect(current.store).not.toBe(previous.store); await vi.waitFor(() => expect(current.store.view().demandState).toBe('ready'));
    oldDemand.resolve(ok(demand('Late old private result'))); oldPolicy.resolve(ok(policy())); await settle();
    expect(root().textContent).toContain('Current demand'); expect(root().textContent).not.toContain('Late old private result');
    expect(previous.store.view().demand).toBeNull(); expect(client.loadDemand).toHaveBeenCalledTimes(2); expect(client.readPolicy).toHaveBeenCalledTimes(2);
  });
  it('hides previously loaded private figures when the session is replaced with a denied identity', async () => {
    const route = await open(); expect(root().textContent).toContain('Current demand'); state.set({ status: 'ready', context: { ...ready.context, subject: 'employee-subject', roles: ['employee'] } });
    await settle(); expect(route.store.view().demand).toBeNull(); expect(root().textContent).not.toContain('Current demand'); expect(root().textContent).toContain('Access refused');
    expect(client.loadDemand).toHaveBeenCalledOnce(); expect(client.readPolicy).toHaveBeenCalledOnce(); expect(client.publish).not.toHaveBeenCalled();
  });
});
