import { Location, PlatformLocation } from '@angular/common';
import { MockPlatformLocation } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountClient } from '../account/account.client';
import { AuthPort, Role, SessionState } from '../auth/auth.port';
import { GalleryComponent } from '../pages/gallery.component';
import { StatePageComponent } from '../pages/state-page.component';
import { ManualStore } from '../manual/manual.store';
import { routes } from '../routes';
import { StockComponent } from './stock.component';
import { StockRouteComponent } from './stock-route.component';
import { StockNavigationSnapshot } from './stock.store';
import { StockDecision, StockFact, StockPayload } from './stock.types';

const ready = { status: 'ready', context: { subject: 'user-1', employeeId: 'employee-1', environmentId: 'test', runId: 'run-1',
  roles: ['employee'], policyVersion: 'policy-1', capabilities: [] } } as const satisfies SessionState;
const fact = (value: StockFact['value'], assurance = 'confirmed-build'): StockFact => ({ value, status: value === null ? 'unknown' : 'known', unit: null,
  provenance: { sourceRef: 'source', version: 'facts-1', observedAt: '2026-11-05T12:00:00Z', assurance } });
function decision(id: number): StockDecision {
  const orderUuid = `stock-${id}`; const candidateKey = `fixture:exact-stock:${orderUuid}`;
  return { orderUuid, orderNumber: String(id).padStart(7, '0'), candidateKey, configurationId: 'shared-config', draftVersion: 2,
    gateStatus: id === 2 ? 'ineligible' : id === 3 ? 'needs-confirmation' : 'eligible', blockers: [], unknowns: [],
    snapshot: { identityKind: 'exact-stock', candidateKey, sourceNamespace: 'fixture', sourceKeys: { stockId: orderUuid }, snapshotVersion: `snapshot-${id}`,
      display: { name: `BMW car ${id}` }, facts: { series: fact('3 Series'), body: fact(id % 2 ? 'estate' : 'saloon'), exterior: fact('Blue'),
        equipment: fact([{ code: 'S0488', name: 'Lumbar support' }]), reference: fact('Reference only', 'model-reference'), other: fact(false, 'derived') } },
    terms: { kind: 'employee-scheme', termsVersion: `terms-${id}`, points: { value: id * 100, unit: 'points' }, allowanceInputs: { allowance: { value: 1000, unit: 'points' } }, contribution: null },
    versions: { brief: 2, facts: 'facts-1', policy: 'policy-1', stock: 'source-stock-1', clock: 'clock-1', snapshot: `snapshot-${id}`, terms: `terms-${id}`, availability: `availability-${id}` },
    claimInput: id === 2 || id === 3 ? null : { orderUuid, expectedStockVersion: id + 10, expectedDraftVersion: 2,
      expectedContextVersion: 'context-1', expectedTermsDigest: `opaque-${id}` } };
}
function stock(count = 8): StockPayload {
  const decisions = Array.from({ length: count }, (_, i) => decision(i + 1)); const cars = decisions.filter(car => car.gateStatus === 'eligible');
  return { state: count ? 'available-stock' : 'empty-stock', decisions, cars, total: cars.length, ranked: false, browsingReservesStock: false,
    versions: { brief: 2, facts: 'facts-1', policy: 'policy-1', stock: 'source-stock-1', clock: 'clock-1', draft: 2, context: 'context-1' } };
}
const scope = JSON.stringify(['user-1', 'test', 'run-1', 'employee-1']);
const snapshot = (selectedId: string | null = null): StockNavigationSnapshot => ({ version: 1, scope,
  controls: { query: '', series: '', body: '', sort: 'name' }, limit: 12, selectedId });

describe('released stock route and browser history', () => {
  let harness: RouterTestingHarness; let router: Router; let location: Location; let platform: MockPlatformLocation;
  const state = signal<SessionState>(ready); const client = { readStock: vi.fn() };
  const manual = { enter: vi.fn() };
  const screen = () => harness.routeDebugElement!.query(By.directive(StockComponent)).componentInstance as StockComponent;
  const settle = async () => { harness.detectChanges(); await harness.fixture.whenStable(); harness.detectChanges(); };
  const history = () => location.getState() as Record<string, unknown>;
  const open = async (data?: Record<string, unknown>) => {
    await router.navigateByUrl('/stock?origin=choices#cars', { state: data }); await settle();
    return harness.routeDebugElement!.componentInstance as StockRouteComponent;
  };
  beforeEach(async () => {
    TestBed.resetTestingModule(); state.set(ready); client.readStock.mockReset().mockResolvedValue({ status: 'ok', value: stock() });
    manual.enter.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true, configurable: true });
    TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: PlatformLocation, useClass: MockPlatformLocation },
      { provide: AuthPort, useValue: { state, initialize: vi.fn(async () => {}) } }, { provide: AccountClient, useValue: client },
      { provide: ManualStore, useValue: manual }] });
    harness = await RouterTestingHarness.create(); router = TestBed.inject(Router); location = TestBed.inject(Location);
    platform = TestBed.inject(PlatformLocation) as MockPlatformLocation;
  });
  afterEach(() => { harness?.fixture.destroy(); TestBed.resetTestingModule(); vi.restoreAllMocks(); });

  it('hands the exact supplied car to manual review without putting authority in navigation history', async () => {
    await open(); expect(harness.routeDebugElement!.componentInstance).toBeInstanceOf(StockRouteComponent);
    expect(client.readStock).toHaveBeenCalledTimes(1); expect(harness.routeNativeElement!.textContent).toContain('Released cars');
    const selection = screen().store.allCars().find(car => car.id === 'stock-1')!.review;
    const buttons = Array.from(harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.some(button => button.textContent?.trim() === 'Review this car' && !button.disabled)).toBe(true);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    screen().activate({ memberId: 'stock-1', action: 'review' });
    await settle();
    expect(manual.enter).toHaveBeenCalledExactlyOnceWith(selection);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/manual/review');
    expect(JSON.stringify(history())).not.toMatch(/claimInput|expectedTermsDigest|opaque-1/);
  });

  it('waits for authoritative reads and ignores duplicate review actions during the handoff', async () => {
    const host = await open(); let finish!: () => void;
    manual.enter.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const selection = screen().store.allCars().find(car => car.id === 'stock-1')!.review;
    const pending = host.reviewSelection(selection); await host.reviewSelection(selection);
    expect(manual.enter).toHaveBeenCalledTimes(1); expect(navigate).not.toHaveBeenCalled();
    finish(); await pending; expect(navigate).toHaveBeenCalledExactlyOnceWith('/manual/review');
  });

  it('restores exact selection/filter/expanded page on entry while preserving Router and unrelated history fields', async () => {
    const saved = { ...snapshot('stock-8'), controls: { ...snapshot().controls, query: 'BMW', sort: 'points' as const } };
    await open({ gcspStock: saved, unrelated: { retained: true } });
    expect(screen().store.selectedId()).toBe('stock-8'); expect(screen().store.limit()).toBe(12);
    expect(screen().store.controls()).toEqual(saved.controls); expect(harness.routeNativeElement!.textContent).toContain('BMW car 8');
    expect(history()['navigationId']).toBeTypeOf('number'); expect(history()['unrelated']).toEqual({ retained: true });
    expect(history()['gcspStock']).toEqual(saved);
  });

  it('pushes deliberate changes, replaces automatic snapshots, preserves URL and avoids write echoes', async () => {
    const host = await open({ unrelated: 'keep' }); const go = vi.spyOn(location, 'go'); const replace = vi.spyOn(location, 'replaceState');
    screen().showMore(); await settle(); expect(go).toHaveBeenCalledTimes(1); expect(replace).not.toHaveBeenCalled();
    const expanded = screen().store.navigationSnapshot()!; host.saveNavigation({ snapshot: expanded, replace: true });
    expect(go).toHaveBeenCalledTimes(1); expect(replace).not.toHaveBeenCalled();
    host.saveNavigation({ snapshot: { ...expanded, limit: 18 }, replace: true }); expect(replace).toHaveBeenCalledTimes(1);
    expect(location.path(true)).toBe('/stock?origin=choices#cars'); expect(history()['unrelated']).toBe('keep');
    expect(history()['navigationId']).toBeTypeOf('number'); expect(client.readStock).toHaveBeenCalledTimes(1);
  });

  it('restores filter/page and the exact car on native back and forward without adding history entries', async () => {
    await open(); const initial = history()['gcspStock']; screen().showMore(); await settle();
    screen().activate({ memberId: 'stock-8', action: 'details' }); await settle();
    const go = vi.spyOn(location, 'go'); platform.back(); await settle();
    expect(screen().store.selectedId()).toBeNull(); expect(screen().store.limit()).toBe(12);
    platform.back(); await settle(); expect(history()['gcspStock']).toEqual(initial); expect(screen().store.limit()).toBe(6);
    platform.forward(); await settle(); platform.forward(); await settle();
    expect(screen().store.selectedId()).toBe('stock-8'); expect(screen().store.limit()).toBe(12);
    expect(go).not.toHaveBeenCalled(); expect(client.readStock).toHaveBeenCalledTimes(1);
  });

  it.each([{ ...snapshot('stock-8'), scope: 'another-employee' }, { ...snapshot(), token: 'must-not-retain' }])
    ('rejects cross-scope or malformed entry snapshots through the existing store', async saved => {
      await open({ gcspStock: saved }); expect(screen().store.selectedId()).toBeNull(); expect(screen().store.limit()).toBe(6);
      expect(history()['gcspStock']).toEqual(screen().store.navigationSnapshot());
    });

  it('writes only the existing navigation allowlist and removes it when the scoped resource clears', async () => {
    const host = await open({ unrelated: 'keep' }); const injected = { ...snapshot('stock-1'), facts: { vin: 'private' }, review: { claimInput: 'authority' }, token: 'secret' };
    host.saveNavigation({ snapshot: injected, replace: false });
    expect(Object.keys(history()['gcspStock'] as object).sort()).toEqual(['controls', 'limit', 'scope', 'selectedId', 'version']);
    expect(JSON.stringify(history())).not.toMatch(/private|authority|secret/);
    state.set({ status: 'signed-out' }); await settle(); expect(history()['gcspStock']).toBeUndefined(); expect(history()['unrelated']).toBe('keep');
    expect(harness.routeNativeElement!.textContent).not.toContain('BMW car 1');
  });

  it('returns to the existing account destination and ignores writes after route teardown', async () => {
    const host = await open(); const request = client.readStock.mock.calls[0][0];
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true); host.backToChoices(); expect(navigate).toHaveBeenCalledWith('/account'); navigate.mockRestore();
    const input = host.navigation(); await harness.navigateByUrl('/access-denied', StatePageComponent); await settle();
    const go = vi.spyOn(location, 'go'); const replace = vi.spyOn(location, 'replaceState');
    host.saveNavigation({ snapshot: snapshot('stock-8'), replace: false }); expect(go).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    expect(request.signal.aborted).toBe(true);
    platform.back(); await settle(); expect(host.navigation()).toBe(input);
  });

  it.each([['greg'], ['presenter'], ['employee', 'presenter']] satisfies Role[][])('keeps employee/session role guards for %j', async (...roles) => {
    state.set({ status: 'ready', context: { ...ready.context, roles } });
    await harness.navigateByUrl('/stock', StatePageComponent); await settle(); expect(router.url).toBe('/access-denied'); expect(client.readStock).not.toHaveBeenCalled();
  });

  it('keeps signed-out deep links in the existing sign-in return flow without a stock request', async () => {
    state.set({ status: 'signed-out' }); await harness.navigateByUrl('/stock?origin=choices#cars', StatePageComponent); await settle();
    expect(router.parseUrl(router.url).queryParams['returnTo']).toBe('/gcsp/stock?origin=choices#cars'); expect(client.readStock).not.toHaveBeenCalled();
  });

  it('adds a shared card gallery example with details feedback while preserving the existing table examples', async () => {
    await harness.navigateByUrl('/components', GalleryComponent); await settle();
    const root = harness.routeNativeElement!; const captions = Array.from(root.querySelectorAll('gcsp-data-table caption')).map(caption => caption.textContent);
    expect(captions).toEqual(['Example renewal cases', 'Unavailable case actions', 'Example car comparison']);
    expect(root.querySelector('gcsp-data-table .gcsp-table-action')?.getAttribute('aria-label')).toBe('Open case for Paula');
    const comparison = root.querySelector('gcsp-data-table .gcsp-table-wrap.is-compare')!; expect(comparison.querySelector('button')).toBeNull(); expect(comparison.querySelector('td.is-winner')?.textContent).toBe('1,100'); expect(comparison.querySelector('[data-band=true] .gcsp-vh')?.textContent).toBe('Fewer than five');
    expect(root.textContent).toContain('Case queue table'); expect(root.textContent).toContain('Released vehicle card');
    const card = root.querySelector('gcsp-vehicle-card')!;
    const actions = Array.from(card.querySelectorAll<HTMLButtonElement>('button'));
    expect(actions.find(button => button.textContent?.trim() === 'Review this car')!.disabled).toBe(true);
    actions.find(button => button.textContent?.trim() === 'Vehicle details')!.click(); await settle();
    expect(root.textContent).toContain('Vehicle details selected for the example car');
  });
});
