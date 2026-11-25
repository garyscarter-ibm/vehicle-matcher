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
import { GalleryReservationController, StockRouteComponent } from './stock-route.component';
import { ManualClient } from '../manual/manual.client';
import type { ManualClaim, ManualResult } from '../manual/manual.types';
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
  const reserved = signal<any>({ state: 'ready', blocked: false, selection: null, claim: null, failure: null, refresh: 0 });
  const reservation = { state: reserved, load: vi.fn(async () => {}), dispose: vi.fn(), reserve: vi.fn(), checkStatus: vi.fn(), retry: vi.fn() };
  const manual = { enter: vi.fn(), projection: () => ({ claim: reserved().claim }), confirmResume: vi.fn() };
  const screen = () => harness.routeDebugElement!.query(By.directive(StockComponent)).componentInstance as StockComponent;
  const settle = async () => { harness.detectChanges(); await harness.fixture.whenStable(); harness.detectChanges(); };
  const history = () => location.getState() as Record<string, unknown>;
  const open = async (data?: Record<string, unknown>) => {
    await router.navigateByUrl('/stock?origin=choices#cars', { state: data }); await settle();
    return harness.routeDebugElement!.componentInstance as StockRouteComponent;
  };
  beforeEach(async () => {
    TestBed.resetTestingModule(); state.set(ready); client.readStock.mockReset().mockResolvedValue({ status: 'ok', value: stock() });
    manual.enter.mockReset().mockResolvedValue(undefined); manual.confirmResume.mockReset();
    reserved.set({ state: 'ready', blocked: false, selection: null, claim: null, failure: null, refresh: 0 });
    reservation.reserve.mockReset().mockImplementation(async (selection) => {
      const claim = { state: 'quoted', now: '2026-11-25T12:00:00Z', pendingOperation: null,
        hold: { holdId: 'hold', orderUuid: selection.orderUuid, type: 'cart', state: 'active', employeeId: 'employee-1', entitlementSlotId: 'slot', expiresAt: '2026-11-25T13:00:00Z' },
        quote: { quoteId: 'quote', orderUuid: selection.orderUuid, configurationId: selection.configurationId, employeeId: 'employee-1', entitlementSlotId: 'slot', facts: { facts: selection.snapshot },
          policyVersion: selection.versions.policy, draftVersion: selection.claimInput.expectedDraftVersion, contextVersion: selection.claimInput.expectedContextVersion,
          termsDigest: selection.claimInput.expectedTermsDigest, stockVersion: 12, validUntil: '2026-11-25T13:00:00Z' } };
      reserved.set({ ...reserved(), state: 'confirmed', blocked: true, selection, claim });
    });
    Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true, configurable: true });
    TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: PlatformLocation, useClass: MockPlatformLocation },
      { provide: AuthPort, useValue: { state, initialize: vi.fn(async () => {}) } }, { provide: AccountClient, useValue: client },
      { provide: ManualStore, useValue: manual }, { provide: GalleryReservationController, useValue: reservation }] });
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
    expect(reservation.reserve).toHaveBeenCalledExactlyOnceWith(selection);
    expect(manual.enter).toHaveBeenCalledExactlyOnceWith(selection);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/manual/review');
    expect(JSON.stringify(history())).not.toMatch(/claimInput|expectedTermsDigest|opaque-1/);
  });

  it('waits for authoritative reads and ignores duplicate review actions during the handoff', async () => {
    const host = await open(); let finish!: () => void;
    manual.enter.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const selection = screen().store.allCars().find(car => car.id === 'stock-1')!.review;
    const pending = host.reviewSelection(selection); await vi.waitFor(() => expect(manual.enter).toHaveBeenCalledOnce()); await host.reviewSelection(selection);
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
    expect(captions).toEqual(['Supplied cell content', 'Example renewal cases', 'Unavailable case actions', 'Example car comparison']);
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


describe('gallery reservation command ownership', () => {
  const context = signal<{ subject: string; environmentId: string; runId: string; employeeId: string } | null>({ subject: 'user-1', environmentId: 'test', runId: 'run-1', employeeId: 'employee-1' });
  const absent = { status: 'not-found', code: 'manual-claim-not-found', retryable: false } as const;
  const unknown = { status: 'uncertain', code: 'manual-transport-unavailable', retryable: false } as const;
  const pending = { status: 'pending', code: 'claim-pending', operationId: 'operation-1', retryable: false } as const;
  const api = { context: () => context(), readClaim: vi.fn(), claim: vi.fn() };
  let controller: GalleryReservationController;
  const selected = () => {
    const car = decision(1);
    return { orderUuid: car.orderUuid, orderNumber: car.orderNumber, configurationId: car.configurationId,
      candidateKey: car.candidateKey, facts: car.snapshot.facts, snapshot: car.snapshot, terms: car.terms,
      draftVersion: car.draftVersion, versions: stock().versions, decisionVersions: car.versions, claimInput: car.claimInput ?? null };
  };
  const held = (changes: Partial<ManualClaim> = {}): ManualClaim => ({ state: 'quoted', now: '2026-11-25T12:00:00Z', pendingOperation: null,
    hold: { holdId: 'hold-1', orderUuid: 'stock-1', employeeId: 'employee-1', entitlementSlotId: 'slot-1',
      type: 'cart', state: 'active', phase: 'preview', mode: 'new', version: 2, expiresAt: '2026-11-25T12:02:00Z', reviewStartedAt: null, releaseReason: null },
    quote: { quoteId: 'quote-1', orderUuid: 'stock-1', employeeId: 'employee-1', entitlementSlotId: 'slot-1', configurationId: 'shared-config',
      facts: { facts: decision(1).snapshot }, terms: {}, termsDigest: 'opaque-1', policyVersion: 'policy-1', contextVersion: 'context-1', draftVersion: 2,
      stockVersion: 12, quotedAt: '2026-11-25T12:00:00Z', validUntil: '2026-11-25T13:00:00Z', driverId: null,
      timing: { previewSeconds: 120, reviewSeconds: 600, transition: 'once-from-preview' } },
    view: { state: 'quoted', editable: false, supportOwner: 'employee', action: 'review-or-cancel' }, ...changes });
  const ok = (value: ManualClaim): ManualResult<ManualClaim> => ({ status: 'ok', value });
  const terminal = (holdId = 'hold-1'): ManualClaim => { const c = held(); return { ...c, state: 'claim-failed', hold: { ...c.hold, holdId, state: 'claim-failed', version: 3 },
    view: { ...c.view, state: 'claim-failed', action: 'browse-stock' } }; };
  beforeEach(() => {
    TestBed.resetTestingModule(); context.set({ subject: 'user-1', environmentId: 'test', runId: 'run-1', employeeId: 'employee-1' });
    api.readClaim.mockReset().mockResolvedValue(absent); api.claim.mockReset().mockResolvedValue(unknown);
    TestBed.configureTestingModule({ providers: [{ provide: ManualClient, useValue: api }] }); controller = TestBed.inject(GalleryReservationController);
  });
  afterEach(() => TestBed.resetTestingModule());
  it('posts once with exact supplied pins and confirms only from the current GET', async () => {
    await controller.load(); let finish!: (value: ManualResult<ManualClaim>) => void;
    api.claim.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); api.readClaim.mockResolvedValue(ok(held()));
    const first = controller.reserve(selected()); const duplicate = controller.reserve(selected());
    expect(controller.state().state).toBe('claiming'); expect(api.claim).toHaveBeenCalledTimes(1);
    expect(api.claim.mock.calls[0][0]).toEqual({ ...selected().claimInput, commandId: expect.any(String) });
    finish(ok(held())); await Promise.all([first, duplicate]);
    expect(api.readClaim).toHaveBeenCalledTimes(2); expect(controller.state().state).toBe('confirmed');
    expect(controller.state().selection?.orderUuid).toBe('stock-1');
  });
  it('checks pending/unknown outcomes with GET only, then explicitly retries the identical command', async () => {
    await controller.load(); api.claim.mockResolvedValueOnce(pending); api.readClaim.mockResolvedValueOnce(pending);
    await controller.reserve(selected()); expect(controller.state().state).toBe('pending');
    api.readClaim.mockResolvedValueOnce(absent); await controller.checkStatus();
    expect(api.claim).toHaveBeenCalledTimes(1); expect(controller.state().state).toBe('retry-available');
    const original = structuredClone(api.claim.mock.calls[0][0]);
    api.claim.mockResolvedValueOnce(ok(held())); api.readClaim.mockResolvedValueOnce(ok(held())); await controller.retry();
    expect(api.claim.mock.calls[1][0]).toEqual(original); expect(controller.state().state).toBe('confirmed');
  });
  it('resolves a matching terminal receipt and gives the same employee a fresh attempt with refreshed stock pins', async () => {
    await controller.load(); const receipt = held({ state: 'claim-pending', pendingOperation: { operationId: 'operation-1', operationType: 'claim', lastKnownState: 'pending' } });
    api.claim.mockResolvedValueOnce(ok(receipt)); api.readClaim.mockResolvedValueOnce(ok(terminal())); await controller.reserve(selected());
    expect(controller.state().state).toBe('released'); expect(controller.state().blocked).toBe(false);
    const first = api.claim.mock.calls[0][0]; const fresh = selected(); fresh.claimInput = { ...fresh.claimInput!, expectedStockVersion: 13 };
    api.readClaim.mockResolvedValueOnce(absent); await controller.reserve(fresh);
    expect(api.claim.mock.calls[1][0].commandId).not.toBe(first.commandId);
    expect(api.claim.mock.calls[1][0].expectedStockVersion).toBe(13);
  });
  it('binds the actual Java 202 operation to its authenticated pending GET before terminal recovery', async () => {
    await controller.load(); const c = held(); const pendingClaim = { ...c, state: 'claim-pending', hold: { ...c.hold, state: 'claim-pending' },
      pendingOperation: { operationId: 'operation-1', operationType: 'manual-claim', lastKnownState: 'claim-pending' },
      view: { ...c.view, state: 'pending', action: 'check-status' } };
    api.claim.mockResolvedValueOnce(pending); api.readClaim.mockResolvedValueOnce(ok(pendingClaim)); await controller.reserve(selected());
    expect(controller.state().state).toBe('pending');
    api.readClaim.mockResolvedValueOnce(ok(terminal())); await controller.checkStatus();
    expect(controller.state().state).toBe('released'); expect(controller.state().blocked).toBe(false);
    expect(api.claim).toHaveBeenCalledTimes(1);
  });
  it.each([{ code: 'car-not-eligible-or-available' }, { code: 'stock-unavailable' }, { code: 'stale-version', resource: 'stock' }])
    ('normalizes actual Java car refusal $code into the retained-list notice without reloading stock', async failure => {
      await controller.load(); api.claim.mockResolvedValueOnce({ status: 'conflict', retryable: false, ...failure });
      await controller.reserve(selected()); expect(controller.state().state).toBe('failed');
      expect(controller.state().failure).toBe('car-taken'); expect(controller.state().refresh).toBe(0);
    });
  it('clears the old single-car refusal when a new deliberate reservation begins', async () => {
    await controller.load(); api.claim.mockResolvedValueOnce({ status: 'conflict', code: 'stock-unavailable', retryable: false });
    await controller.reserve(selected()); expect(controller.state().failure).toBe('car-taken');
    let finish!: (value: ManualResult<ManualClaim>) => void;
    api.claim.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const next = controller.reserve(selected()); expect(controller.state().failure).toBeNull();
    finish(unknown); await next;
  });
  it('does not resolve a newer uncertain command from an old terminal hold', async () => {
    await controller.load(); api.readClaim.mockResolvedValueOnce(ok(terminal('old-hold'))); await controller.reserve(selected());
    expect(controller.state().state).toBe('retry-available'); expect(controller.state().blocked).toBe(true);
    await controller.reserve({ ...selected(), claimInput: { ...selected().claimInput!, expectedStockVersion: 90 } });
    expect(api.claim).toHaveBeenCalledTimes(1); await controller.retry();
    expect(api.claim.mock.calls[1][0]).toEqual(api.claim.mock.calls[0][0]);
  });
  it.each(['configuration', 'snapshot', 'draft', 'context', 'digest', 'expired', 'receipt'])('rejects a mismatched %s readback', async field => {
    await controller.load(); const receipt = held(); const current = held();
    const quote = { ...current.quote, ...(field === 'configuration' ? { configurationId: 'other' } : {}), ...(field === 'snapshot' ? { facts: { facts: { ...decision(1).snapshot, snapshotVersion: 'other' } } } : {}),
      ...(field === 'draft' ? { draftVersion: 99 } : {}), ...(field === 'context' ? { contextVersion: 'other' } : {}), ...(field === 'digest' ? { termsDigest: 'other' } : {}),
      ...(field === 'expired' ? { validUntil: current.now } : {}), ...(field === 'receipt' ? { quoteId: 'other' } : {}) };
    api.claim.mockResolvedValueOnce(ok(receipt)); api.readClaim.mockResolvedValueOnce(ok({ ...current, quote })); await controller.reserve(selected());
    expect(controller.state().state).toBe('readback-mismatch'); expect(controller.state().blocked).toBe(true);
  });
  it('retains an unknown identity across route disposal and clears it on principal/run change', async () => {
    await controller.load(); await controller.reserve(selected()); const command = api.claim.mock.calls[0][0];
    controller.dispose(); await controller.load(); await controller.retry(); expect(api.claim.mock.calls[1][0]).toEqual(command);
    context.set({ ...context()!, runId: 'new-run' }); TestBed.tick(); await controller.load();
    await controller.reserve(selected()); expect(api.claim.mock.calls[2][0].commandId).not.toBe(command.commandId);
  });
});
