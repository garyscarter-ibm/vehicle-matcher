import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountClient } from '../account/account.client';
import { AuthPort, SessionState } from '../auth/auth.port';
import { StockCar, StockData, StockDecision, StockFact, StockGate, StockPayload, StockReleaseHistory } from './stock.types';
import { StockControls, StockSort, StockStore } from './stock.store';

const ready = (changes = {}): SessionState => ({ status: 'ready', context: { subject: 'subject-1', employeeId: 'employee-1',
  environmentId: 'dev', runId: 'run-1', roles: ['employee'], policyVersion: 'policy-1', capabilities: [], ...changes } });
const fact = (value: StockData, unit: string | null = null): StockFact => ({ status: value === null ? 'unknown' : 'known', value, unit });
function decision(id: number, gateStatus: StockGate = 'eligible', name: string | null = `Source car ${id}`,
  fields: Readonly<Record<string, StockFact>> = {}): StockDecision {
  const orderUuid = `stock-${id}`; const candidateKey = `fixture:exact-stock:${orderUuid}`;
  return { orderUuid, orderNumber: String(id).padStart(7, '0'), candidateKey, configurationId: 'shared-config', draftVersion: 2,
    gateStatus, blockers: [], unknowns: [], score: null,
    snapshot: { identityKind: 'exact-stock', candidateKey, sourceNamespace: 'fixture', sourceKeys: { stockId: orderUuid },
      snapshotVersion: `snapshot-${id}`, display: { name }, facts: { series: fact(id % 2 ? '3 Series' : '5 Series'),
        body: fact(id % 2 ? 'estate' : 'saloon'), engine: fact('320i'), equipment: fact([{ code: 'S0488', name: 'Lumbar support' }]), ...fields } },
    terms: { kind: 'employee-scheme', termsVersion: `terms-${id}`, points: { value: id * 100, unit: 'points' }, allowanceInputs: {}, contribution: null },
    versions: { brief: 2, facts: 'facts-1', policy: 'policy-1', stock: 'source-stock-1', clock: 'clock-1',
      snapshot: `snapshot-${id}`, terms: `terms-${id}`, availability: `availability-${id}` },
    claimInput: gateStatus === 'eligible' ? { orderUuid, expectedStockVersion: id + 10, expectedDraftVersion: 2,
      expectedContextVersion: 'context-1', expectedTermsDigest: `opaque-source-digest-${id}` } : null };
}
function stock(rows = Array.from({ length: 20 }, (_, index) => decision(index + 1))): StockPayload {
  const cars = rows.filter((row) => row.gateStatus === 'eligible');
  return { state: rows.length ? cars.length ? 'available-stock' : 'no-eligible-stock' : 'empty-stock', cars, decisions: rows,
    total: cars.length, ranked: false, browsingReservesStock: false,
    versions: { brief: 2, facts: 'facts-1', policy: 'policy-1', stock: 'source-stock-1', clock: 'clock-1', draft: 2, context: 'context-1' } };
}
const history = (released = true): StockReleaseHistory => ({ runId: 'run-1', observedAt: '2026-11-05T12:00:00.000Z', source: { state: 'current-version-unknown' },
  history: { state: released ? 'released' : 'none-visible', releasedCarCount: released ? 20 : 0, releaseCount: released ? 2 : 0,
    latestReleasedAt: released ? '2026-11-05T11:00:00.000Z' : null, sourceVersions: released ? ['source-stock-1'] : [] } });
const ok = (value = stock()) => ({ status: 'ok', value });
const ids = (cars: readonly StockCar[]) => cars.map((car) => car.id);
const tick = async () => { await Promise.resolve(); await Promise.resolve(); TestBed.tick(); };
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>((done) => { resolve = done; }); return { promise, resolve }; };

describe('scoped released stock browse state', () => {
  const auth = signal<SessionState>(ready());
  const client = { readStock: vi.fn() };
  let store: StockStore;
  beforeEach(async () => {
    auth.set(ready()); client.readStock.mockReset().mockResolvedValue(ok());
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state: auth } }, { provide: AccountClient, useValue: client }] });
    store = TestBed.inject(StockStore); TestBed.tick(); await tick();
  });
  async function supply(value: unknown): Promise<void> { client.readStock.mockResolvedValue(value); await store.reload(); }

  it('coalesces read-only loading and browses all unranked decisions independently of eligible-only cars', async () => {
    await supply(ok(stock([decision(1), decision(2, 'ineligible'), decision(3, 'needs-confirmation')])));
    await Promise.all([store.load(), store.load()]); expect(client.readStock).toHaveBeenCalledTimes(2);
    expect(store.counts()).toEqual({ records: 3, eligible: 1, visible: 3, visibleEligible: 1 });
    expect(ids(store.cars())).toEqual(['stock-1', 'stock-2', 'stock-3']);
    expect(store.projection()?.cars).toHaveLength(1); expect(store.projection()?.ranked).toBe(false);
    expect(store.projection()?.browsingReservesStock).toBe(false);
    expect(Object.keys(client)).toEqual(['readStock']);
  });

  it.each(['Source CAR 12', '0000012', '320I', 'lumbar', 'S0488'])('searches frozen names, order numbers, facts and known equipment: %s', (query) => {
    store.setControls({ query: `  ${query}  ` });
    expect(store.cars().length).toBeGreaterThan(0);
    if (/12/.test(query)) expect(ids(store.cars())).toEqual(['stock-12']);
  });

  it('does not search unknown equipment values or provenance', async () => {
    await supply(ok(stock([decision(1, 'eligible', 'One', { equipment: fact(null), engine: { ...fact('320i'),
      provenance: { sourceRef: 'secret-source-label', observedAt: '2026-11-05T12:00:00.000Z', version: '1', assurance: 'confirmed-build' } } })])));
    store.setControls({ query: 'lumbar' }); expect(store.state()).toBe('empty-search');
    store.setControls({ query: 'secret-source-label' }); expect(store.cars()).toEqual([]);
  });

  it('combines search, series and body without losing all/eligible counts or available filter options', async () => {
    await supply(ok(stock([decision(1), decision(2, 'ineligible'), decision(3, 'needs-confirmation')])));
    store.setControls({ series: '3 Series', body: 'estate', query: 'source' });
    expect(ids(store.cars())).toEqual(['stock-1', 'stock-3']);
    expect(store.counts()).toEqual({ records: 3, eligible: 1, visible: 2, visibleEligible: 1 });
    expect(store.series()).toEqual(['3 Series', '5 Series']); expect(store.bodies()).toEqual(['estate', 'saloon']);
    store.setControls({ body: 'saloon' }); expect(store.state()).toBe('empty-search'); expect(store.counts().records).toBe(3);
  });

  it.each(['name', 'points', 'earliest-collection'] as StockSort[])('sorts %s with missing values last and deterministic exact-car ties', async (sort) => {
    const rows = [decision(4, 'eligible', null), decision(3, 'eligible', 'Same'), decision(1, 'eligible', 'Same'), decision(2, 'eligible', 'First')];
    const missing = { ...rows[0], terms: null, claimInput: null, versions: { ...rows[0].versions, terms: null } };
    const priced = rows.slice(1).map((row) => ({ ...row, terms: { ...row.terms!, points: { value: row.orderUuid === 'stock-2' ? 50 : 100, unit: 'points' as const } },
      snapshot: { ...row.snapshot, facts: { ...row.snapshot.facts, earliestCollection: fact(row.orderUuid === 'stock-2' ? '2026-12-01' : '2026-12-02') } } }));
    await supply(ok(stock([missing, ...priced]))); store.setControls({ sort });
    expect(ids(store.cars())).toEqual(['stock-2', 'stock-1', 'stock-3', 'stock-4']);
  });

  it('treats malformed collection dates as missing and keeps numeric model-name order', async () => {
    await supply(ok(stock([decision(3, 'eligible', 'Model 10', { earliestCollection: fact('not a date') }),
      decision(2, 'eligible', 'Model 2', { earliestCollection: fact('2026-12-01') }), decision(1, 'eligible', null)])));
    expect(ids(store.cars())).toEqual(['stock-2', 'stock-3', 'stock-1']);
    store.setControls({ sort: 'earliest-collection' }); expect(ids(store.cars())).toEqual(['stock-2', 'stock-1', 'stock-3']);
  });

  it('pages six on desktop, preserves expansion through detail and resets on controls/reload', async () => {
    expect(store.pageCars()).toHaveLength(6); expect(store.hasMore()).toBe(true);
    store.showMore(); expect(store.pageCars()).toHaveLength(12);
    store.openDetail('stock-12'); expect(store.detailState()).toBe('available');
    store.closeDetail(); expect(store.pageCars()).toHaveLength(12);
    for (const patch of [{ sort: 'points' }, { query: 'source' }, { series: '3 Series' }, { body: 'estate' }] as Partial<StockControls>[]) {
      store.showMore(); store.setControls(patch); expect(store.limit()).toBe(6);
    }
    store.showMore(); await store.reload(); expect(store.limit()).toBe(6); expect(store.controls().series).toBe('3 Series');
  });

  it.each([600, 375])('pages three at width %s and keeps existing expansion on viewport changes', async (width) => {
    store.setViewportWidth(width); await store.reload(); expect(store.pageSize()).toBe(3); expect(store.pageCars()).toHaveLength(3);
    store.showMore(); expect(store.pageCars()).toHaveLength(6); store.showMore(); expect(store.pageCars()).toHaveLength(9);
    store.setViewportWidth(601); expect(store.pageSize()).toBe(6); expect(store.pageCars()).toHaveLength(9);
    store.setControls({ query: 'source' }); expect(store.pageCars()).toHaveLength(6);
  });

  it('stops show-more at the available stock without changing counts', () => {
    for (let i = 0; i < 8; i++) store.showMore();
    expect(store.pageCars()).toHaveLength(20); expect(store.hasMore()).toBe(false); expect(store.counts().visible).toBe(20);
  });

  it('preserves distinct same-configuration exact cars and source-issued quote pins even when filtered out', () => {
    store.openDetail('stock-2'); const source = store.selectedSource();
    expect(source).toMatchObject({ orderUuid: 'stock-2', configurationId: 'shared-config', candidateKey: 'fixture:exact-stock:stock-2',
      versions: { stock: 'source-stock-1' }, claimInput: { expectedStockVersion: 12, expectedTermsDigest: 'opaque-source-digest-2' } });
    expect(store.detail()?.snapshot.snapshotVersion).toBe('snapshot-2'); expect(store.detail()?.terms?.points.value).toBe(200);
    store.setControls({ query: '0000001' }); expect(store.selectedSource()).toBe(source); expect(store.detailState()).toBe('available');
    store.openDetail('stock-1'); expect(store.selectedSource()?.orderUuid).toBe('stock-1'); expect(store.detail()?.terms?.points.value).toBe(100);
  });

  it('retains ineligible and unknown evidence and a null-ID Buddy offer prevents review', async () => {
    await supply(ok({ ...stock([decision(1, 'ineligible'), decision(2, 'needs-confirmation'), decision(3)]), heldOffer: { offerId: null } }));
    expect(store.allCars().map((car) => car.reviewAvailable)).toEqual([false, false, false]);
    store.openDetail('stock-2'); expect(store.selectedCar()?.gateStatus).toBe('needs-confirmation');
    expect(store.detail()?.snapshot.facts['body'].value).toBe('saloon');
  });

  it('restores scoped navigation snapshots for exact detail and expanded pages without private facts', () => {
    store.setControls({ series: '5 Series', sort: 'points' }); store.showMore(); store.openDetail('stock-16');
    const snapshot = store.navigationSnapshot()!; const serialized = JSON.stringify(snapshot);
    expect(Object.keys(snapshot).sort()).toEqual(['controls', 'limit', 'scope', 'selectedId', 'version']);
    expect(serialized).not.toMatch(/terms|facts|digest|token|snapshot-/);
    store.closeDetail(); store.setControls({ series: '' });
    expect(store.restoreNavigation(JSON.parse(serialized))).toBe(true);
    expect(store.limit()).toBe(12); expect(store.selectedId()).toBe('stock-16'); expect(store.controls()).toEqual(snapshot.controls);
    expect(store.detail()?.snapshot.sourceKeys.stockId).toBe('stock-16');
    store.setControls({ query: 'source car 1' }); const forward = store.navigationSnapshot();
    expect(store.restoreNavigation(snapshot)).toBe(true); expect(store.controls().query).toBe('');
    expect(store.restoreNavigation(forward)).toBe(true); expect(store.controls().query).toBe('source car 1');
  });

  it.each(['scope', 'version', 'sort', 'query', 'limit', 'selectedId', 'extra', 'missing'])('rejects invalid restored %s without partial changes', (kind) => {
    const baseline = store.navigationSnapshot()!;
    const value: Record<string, unknown> = { ...structuredClone(baseline) };
    if (kind === 'scope') value['scope'] = 'other';
    if (kind === 'version') value['version'] = 2;
    if (kind === 'sort') value['controls'] = { ...baseline.controls, sort: 'ranking' };
    if (kind === 'query') value['controls'] = { ...baseline.controls, query: 'bad\nquery' };
    if (kind === 'limit') value['limit'] = -1;
    if (kind === 'selectedId') value['selectedId'] = {};
    if (kind === 'extra') value['token'] = 'forbidden';
    if (kind === 'missing') delete value['selectedId'];
    expect(store.restoreNavigation(value)).toBe(false); expect(store.navigationSnapshot()).toEqual(baseline);
  });

  it('reports unavailable exact selections without substituting a car sharing the configuration', async () => {
    store.openDetail('stock-2'); await supply(ok(stock([decision(1)])));
    expect(store.selectedId()).toBe('stock-2'); expect(store.detailState()).toBe('unavailable');
    expect(store.detail()).toBeNull(); expect(store.selectedSource()).toBeNull();
    store.closeDetail(); store.openDetail('missing-stock'); expect(store.detailState()).toBe('unavailable');
  });

  it('replays selected navigation while loading and resolves only the exact selected car', async () => {
    const snapshot = { ...store.navigationSnapshot()!, selectedId: 'stock-2', limit: 12 };
    const late = deferred(); client.readStock.mockReturnValueOnce(late.promise); const loading = store.reload();
    expect(store.restoreNavigation(snapshot)).toBe(true); expect(store.detailState()).toBe('loading');
    late.resolve(ok()); await loading; expect(store.detailState()).toBe('available'); expect(store.selectedCar()?.id).toBe('stock-2');
    expect(store.limit()).toBe(12);
  });

  it('keeps release history independent of search, current suitability and empty stock', async () => {
    const released = history(); await supply(ok({ ...stock([decision(1, 'ineligible')]), releaseHistory: released }));
    expect(store.state()).toBe('no-suitable-stock'); store.setControls({ query: 'absent' }); expect(store.state()).toBe('empty-search');
    expect(store.releaseHistory()).toEqual(released);
    await supply(ok({ ...stock([]), releaseHistory: released })); expect(store.state()).toBe('empty-stock'); expect(store.releaseHistory()).toEqual(released);
    await supply(ok({ ...stock([]), releaseHistory: history(false) })); expect(store.state()).toBe('no-visible-releases');
    await supply(ok(stock([]))); expect(store.releaseHistory()).toBeNull(); expect(store.state()).toBe('empty-stock');
    await supply(ok({ ...stock([]), state: 'nothing-released-yet' })); expect(store.state()).toBe('nothing-released-yet');
  });

  it.each([
    [{ status: 'invalid', reasons: [{ field: 'requestedCollectionDate' }] }, 'choices-invalid'],
    [{ status: 'unavailable', code: 'source-offline' }, 'source-unavailable'],
    [{ status: 'stale-version' }, 'context-refresh'], [{ status: 'stale-run' }, 'context-refresh'],
    [{ status: 'conflict', view: { state: 'car-taken' } }, 'car-taken'],
    [{ status: 'forbidden' }, 'denied'], [{ status: 'unauthenticated' }, 'authentication-required'],
    [{ status: 'authentication-required' }, 'authentication-required'],
  ])('clears private data and preserves meaningful failure %j', async (failure, state) => {
    store.openDetail('stock-1'); await supply(failure);
    expect(store.state()).toBe(state); expect(store.failure()).toEqual(failure);
    expect(store.allCars()).toEqual([]); expect(store.releaseHistory()).toBeNull(); expect(store.selectedSource()).toBeNull();
    expect(store.detailState()).toBe(state === 'context-refresh' ? 'stale' : 'unavailable');
  });

  it('rejects an invalid projection and exposes a retryable failure after thrown reads', async () => {
    await supply({ status: 'ok', value: {} }); expect(store.state()).toBe('source-unavailable');
    client.readStock.mockRejectedValueOnce(new Error('offline')); await store.reload();
    expect(store.failure()).toMatchObject({ code: 'stock-read-failed', retryable: true });
    client.readStock.mockResolvedValue(ok()); await store.reload(); expect(store.state()).toBe('available-stock');
  });

  it.each(['subject', 'environmentId', 'runId', 'employeeId'])('immediately hides all prior private state on %s changes and ignores a late old read', async (field) => {
    store.setControls({ query: 'source' }); store.openDetail('stock-1'); const snapshot = store.navigationSnapshot();
    const late = deferred(); client.readStock.mockReturnValueOnce(late.promise); const oldRead = store.reload();
    const oldSignal: AbortSignal = client.readStock.mock.calls.at(-1)![0].signal;
    auth.set(ready({ [field]: 'changed' }));
    expect(store.projection()).toBeNull(); expect(store.allCars()).toEqual([]); expect(store.controls().query).toBe('');
    expect(store.selectedId()).toBeNull(); expect(store.selectedSource()).toBeNull(); expect(store.navigationSnapshot()).toBeNull();
    TestBed.tick(); await tick(); expect(oldSignal.aborted).toBe(true); expect(store.restoreNavigation(snapshot)).toBe(false);
    late.resolve(ok(stock([]))); await oldRead; expect(store.state()).toBe('available-stock'); expect(store.counts().records).toBe(20);
    expect(store.controls().query).toBe('');
  });

  it.each([
    [{ status: 'signed-out' }, 'authentication-required'], [{ status: 'denied', message: 'Denied' }, 'denied'],
    [{ status: 'loading' }, 'loading'], [{ status: 'unavailable', message: 'Offline', retryable: true }, 'authentication-unavailable'],
    [ready({ roles: ['presenter'] }), 'denied'], [ready({ employeeId: undefined }), 'denied'],
  ] as [SessionState, string][])('suppresses data on auth state %j without automatic actions', async (next, expected) => {
    store.openDetail('stock-1'); auth.set(next);
    expect(store.state()).toBe(expected); expect(store.projection()).toBeNull(); expect(store.detail()).toBeNull(); expect(store.pageCars()).toEqual([]);
    TestBed.tick(); await tick(); await store.load(); expect(client.readStock).toHaveBeenCalledTimes(1);
    auth.set(ready()); TestBed.tick(); await tick(); expect(client.readStock).toHaveBeenCalledTimes(2); expect(store.selectedId()).toBeNull();
  });

  it('coalesces pending loads and aborts superseded reloads, ignoring their late results', async () => {
    const first = deferred(); const second = deferred(); client.readStock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldRead = store.reload(); const oldSignal: AbortSignal = client.readStock.mock.calls.at(-1)![0].signal;
    const current = store.reload(); expect(store.load()).toBe(current); expect(store.loading()).toBe(true); expect(store.allCars()).toEqual([]);
    expect(oldSignal.aborted).toBe(true); first.resolve(ok(stock([]))); await oldRead; expect(store.loading()).toBe(true);
    second.resolve(ok(stock([decision(4)]))); await current; expect(ids(store.cars())).toEqual(['stock-4']); expect(store.loading()).toBe(false);
  });

  it('suppresses and clears data on teardown, aborts the request and ignores late completion', async () => {
    const late = deferred(); client.readStock.mockReturnValueOnce(late.promise); const pending = store.reload();
    const requestSignal: AbortSignal = client.readStock.mock.calls.at(-1)![0].signal;
    TestBed.resetTestingModule(); expect(requestSignal.aborted).toBe(true); expect(store.state()).toBe('idle');
    expect(store.navigationSnapshot()).toBeNull(); expect(store.allCars()).toEqual([]); expect(store.failure()).toBeNull();
    late.resolve(ok()); await pending; await store.reload(); expect(client.readStock).toHaveBeenCalledTimes(2); expect(store.allCars()).toEqual([]);
  });
});
