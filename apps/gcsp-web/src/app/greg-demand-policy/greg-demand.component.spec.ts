import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { GregDemandComponent } from './greg-demand.component';
import { projectDemand } from './greg.projection';
import { GregStore, GregView } from './greg.store';
import type { GregCount, GregDemand } from './greg.types';

const versions = { brief: ['brief-7'], policy: ['policy-1'] };
const exact: GregCount = { kind: 'exact', value: 12, label: '12 recorded' };
const fewer: GregCount = { kind: 'band', fewerThan: 5, label: 'fewer than 5' };
const atLeast: GregCount = { kind: 'band', atLeast: 5, label: '5 or more' };
const cell = (count: GregCount = fewer) => ({ count, versions });
function demand(): GregDemand {
  return projectDemand({ runId: 'run-1', asOf: '2026-11-16T12:00:00Z', projectionVersion: 'digest-1', basis: 'expressed-saved-demand',
    versions: { ...versions, revision: 3 }, privacy: { threshold: 5, thresholdKey: 'privacy', policyVersion: 'policy-1', status: 'assumed', withheld: true },
    demand: { activeBriefs: cell(exact), byModelLine: [{ key: 'G21 Touring', ...cell(atLeast) }], byBody: [{ key: 'estate', ...cell() }], byFuel: [],
      essentials: [{ field: 'seats', operator: 'gte', value: 5, unit: 'count', state: 'confirmed', ...cell() }],
      unmet: { total: cell(), byGate: [{ key: 'no-released-stock', ...cell() }] } },
    holds: { total: cell(), active: cell(), byState: [], byType: [] },
    offers: { made: cell(exact), accepted: cell(), declined: cell(), expired: cell(), selected: cell(atLeast), declinedByReason: [{ key: 'points', ...cell() }] },
    stock: { byModelLine: [], source: { status: 'unavailable' } } });
}
function view(): GregView { return { demandState: 'ready', policyState: 'ready', demand: demand(), policy: null, fields: [], pending: false, action: null,
  preview: null, publication: null, retainedCommand: null, uncertain: false, message: '', demandMessage: '', policyMessage: '', canEdit: false, canPreview: false, canPublish: false, canRetry: false }; }

describe('Greg demand screen', () => {
  let fixture: ComponentFixture<GregDemandComponent>; let state = signal(view());
  const authState = signal<SessionState>({ status: 'loading' });
  const store = { view: () => state(), refresh: vi.fn(), signIn: vi.fn(), retryAuthentication: vi.fn() };
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent!;
  const button = (label: string) => Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === label)!;
  beforeEach(async () => {
    state = signal(view()); authState.set({ status: 'ready', context: { subject: 'greg', environmentId: 'isolated', runId: 'run-1', policyVersion: 'policy-1', roles: ['greg', 'employee'], capabilities: [] } });
    vi.clearAllMocks(); await TestBed.configureTestingModule({ imports: [GregDemandComponent], providers: [
      { provide: GregStore, useValue: store }, { provide: AuthPort, useValue: { state: authState } },
    ] }).compileComponents(); fixture = TestBed.createComponent(GregDemandComponent); fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  it('shows supplied exact and complementary band labels with source/version context and no derived total', () => {
    expect(text()).toContain('12 recorded'); expect(text()).toContain('fewer than 5'); expect(text()).toContain('5 or more');
    expect(text()).toContain('G21 Touring'); expect(text()).toContain('Estate'); expect(text()).toContain('Seats at least 5');
    expect(text()).toContain('policy-1'); expect(text()).toContain('brief-7'); expect(text()).toContain('digest-1'); expect(text()).toContain('16 Nov 2026');
    expect(text()).toContain('Other cells may also be withheld'); expect(text()).toContain('do not add them together');
    expect(root().querySelectorAll('table caption').length).toBe(7); expect(root().querySelectorAll('th[scope="col"]').length).toBeGreaterThan(10);
    expect(text()).not.toContain('Clock version'); expect(root().querySelectorAll('input')).toHaveLength(0);
  });
  it('distinguishes unavailable stock and its unmet gate from a proven empty source', () => {
    expect(text()).toContain('Stock source unavailable'); expect(text()).toContain('New stock could not be checked.'); expect(text()).not.toContain('No stock has been released yet.');
    const d = demand(); state.update(v => ({ ...v, demand: { ...d, stock: { ...d.stock, source: { status: 'ok' }, unavailable: false, empty: true } } })); fixture.detectChanges();
    expect(text()).toContain('No stock has been released yet.'); expect(text()).not.toContain('New stock could not be checked.');
  });
  it('escapes supplied labels and refreshes deliberately without a source-outage sign-in action', () => {
    const d = demand(); state.update(v => ({ ...v, demand: { ...d, demand: { ...d.demand, byModelLine: [{ key: 'unsafe', label: '<img src=x onerror=alert(1)>', ...cell() }] } } })); fixture.detectChanges();
    expect(text()).toContain('<img src=x onerror=alert(1)>'); expect(root().querySelector('img')).toBeNull();
    expect(button('Retry sign-in connection')).toBeUndefined(); button('Refresh demand and policy').click(); expect(store.refresh).toHaveBeenCalledOnce();
    authState.set({ status: 'unavailable', message: 'Unavailable', retryable: true }); fixture.detectChanges(); button('Retry sign-in connection').click(); expect(store.retryAuthentication).toHaveBeenCalledOnce();
  });
  it('replaces private figures with loading, denied and sign-in states', () => {
    state.update(v => ({ ...v, demand: null, demandState: 'loading', pending: true })); fixture.detectChanges(); expect(text()).toContain('Loading the demand figures'); expect(root().querySelector('table')).toBeNull();
    expect(button('Refresh demand and policy').disabled).toBe(true);
    state.update(v => ({ ...v, demandState: 'denied', pending: false })); fixture.detectChanges(); expect(text()).toContain('Access refused'); expect(root().querySelectorAll('button')).toHaveLength(0);
    state.update(v => ({ ...v, demandState: 'auth-required' })); fixture.detectChanges(); button('Sign in').click(); expect(store.signIn).toHaveBeenCalledOnce(); expect(root().querySelector('table')).toBeNull();
  });
});
