import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, ApplicationContext, Role, SessionState } from '../auth/auth.port';
import { CaseClient, CaseClientResult, CaseRequestOptions } from '../cases/case.client';
import { CaseHelp, CaseList, CaseRecord } from '../cases/case.types';
import { StatePageComponent } from '../pages/state-page.component';
import { routes } from '../routes';
import { HelpComponent } from './help.component';
import { HelpStore } from './help.store';

const at = '2026-07-14T10:00:00.000Z';
const employee: ApplicationContext = { subject: 'paula-subject', environmentId: 'isolated', runId: 'run-1',
  employeeId: 'paula', roles: ['employee'], policyVersion: 'policy-1', capabilities: [] };
const guidance: CaseHelp = { opensCase: false, ownerRole: 'scheme-team', extensionPermitted: false,
  automaticRecoveryPriority: false, nextAction: 'Ask for help to open an owned renewal case.', policyVersion: 'policy-1', assumptions: [] };
const ok = <T>(value: T): CaseClientResult<T> => ({ state: 'ready', value, replayed: false });
const record = (reason: string): CaseRecord => ({ caseId: 'renewal-current', runId: 'run-1', employeeId: 'paula', renewalId: 'renewal-1',
  owner: { role: 'scheme-team', name: 'Scheme team' }, status: 'open', reason, trigger: { type: 'employee-request' },
  nextAction: 'Review renewal', dueAt: at, openedAt: at, lastUpdatedAt: at, renewalDeadline: null,
  renewalDeadlineState: 'needs-confirmation', policyVersion: 'policy-1', version: 1, fictional: true, remedy: null, history: [] });
interface Read<T> { options: CaseRequestOptions; resolve: (result: CaseClientResult<T>) => void }

describe('employee Help route integration', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  let state: ReturnType<typeof signal<SessionState>>;
  let auth: AuthPort;
  let client: Record<string, ReturnType<typeof vi.fn>>;
  let helpReads: Read<CaseHelp>[];
  let caseReads: Read<CaseList>[];
  const text = () => harness.routeNativeElement!.textContent!.replace(/\s+/g, ' ');
  const settle = async () => { harness.detectChanges(); await harness.fixture.whenStable(); harness.detectChanges(); };
  const button = (label: string) => {
    const found = Array.from(harness.routeNativeElement!.querySelectorAll('button')).find(b => b.textContent!.trim() === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  const waitFor = async (assertion: () => void) => { await vi.waitFor(async () => { await settle(); assertion(); }); };
  const load = async (index = helpReads.length - 1, reason = 'Please review my renewal.') => {
    helpReads[index]!.resolve(ok(guidance));
    caseReads[index]!.resolve(ok({ cases: [record(reason)], asOf: at, policyVersion: 'policy-1' }));
    await waitFor(() => expect(harness.routeDebugElement!.componentInstance.view().phase).toBe('ready'));
  };
  const noReads = () => { expect(helpReads).toHaveLength(0); expect(caseReads).toHaveLength(0); };

  beforeEach(async () => {
    TestBed.resetTestingModule(); helpReads = []; caseReads = [];
    state = signal<SessionState>({ status: 'ready', context: employee });
    auth = { state, recovery: signal(null), initialize: vi.fn(async () => {}),
      retry: vi.fn(async () => { state.set({ status: 'ready', context: employee }); return '/gcsp/help'; }),
      signIn: vi.fn(async (_returnTo: string) => {}), signOut: vi.fn(async () => {}), getAccessToken: vi.fn(async () => null),
      completeSignIn: vi.fn(async () => { state.set({ status: 'ready', context: employee }); return '/gcsp/help'; }) };
    client = Object.fromEntries(['readHelp', 'readOwnCases', 'readOwnCase', 'readQueue', 'readOptions',
      'prepareHelp', 'requestHelp', 'prepareUpdate', 'updateCase'].map(key => [key, vi.fn()]));
    client['readHelp'].mockImplementation((options: CaseRequestOptions) => new Promise(resolve => helpReads.push({ options, resolve })));
    client['readOwnCases'].mockImplementation((options: CaseRequestOptions) => new Promise(resolve => caseReads.push({ options, resolve })));
    TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: AuthPort, useValue: auth }, { provide: CaseClient, useValue: client }] });
    harness = await RouterTestingHarness.create(); router = TestBed.inject(Router);
  });
  afterEach(() => {
    for (const name of ['readOwnCase', 'readQueue', 'readOptions', 'prepareHelp', 'requestHelp', 'prepareUpdate', 'updateCase']) {
      expect(client[name]).not.toHaveBeenCalled();
    }
    harness?.fixture.destroy(); TestBed.resetTestingModule();
  });

  it('opens the actual lazy Help body for the employee direct link with its existing route metadata', async () => {
    const page = await harness.navigateByUrl('/help', HelpComponent); await settle();
    const route = harness.routeDebugElement!.injector.get(ActivatedRoute);
    expect(router.url).toBe('/help'); expect(route.snapshot.data).toEqual({ title: 'Renewal help', roles: ['employee'] });
    expect(harness.routeDebugElement!.injector.get(HelpStore)).toBe(page.store);
    expect(harness.routeNativeElement!.querySelectorAll('h1')).toHaveLength(1);
    expect(harness.routeNativeElement!.querySelector('h1')!.textContent).toBe('Renewal help');
    expect(page.view().phase).toBe('loading'); expect(text()).toContain('Loading renewal help');
    expect(helpReads).toHaveLength(1); expect(caseReads).toHaveLength(1);
    expect(helpReads[0]!.options.signal).toBe(caseReads[0]!.options.signal);
    await load(); expect(page.view().phase).toBe('ready'); expect(text()).toContain('Please review my renewal.');
    expect(text()).toContain('Scheme team'); expect(button('Ask for help').disabled).toBe(false);
  });

  it('returns signed-out direct entry through the existing sign-in and callback without a command', async () => {
    state.set({ status: 'signed-out' });
    await harness.navigateByUrl('/help', StatePageComponent); await settle();
    expect(router.parseUrl(router.url).root.children['primary']!.segments.map(segment => segment.path)).toEqual(['sign-in']);
    expect(router.parseUrl(router.url).queryParams['returnTo']).toBe('/gcsp/help'); noReads();
    button('Sign in').click(); await settle(); expect(auth.signIn).toHaveBeenCalledWith('/gcsp/help'); noReads();
    await harness.navigateByUrl('/auth/callback'); await settle();
    expect(auth.completeSignIn).toHaveBeenCalledOnce(); expect(router.url).toBe('/help');
    expect(harness.routeDebugElement!.componentInstance).toBeInstanceOf(HelpComponent);
    await load(); expect(text()).toContain('Please review my renewal.');
  });

  it('recovers a failed callback through the existing retry and returns to Help without replay', async () => {
    state.set({ status: 'signed-out' }); vi.mocked(auth.completeSignIn).mockRejectedValueOnce(new Error('sign-in unavailable'));
    await harness.navigateByUrl('/auth/callback', StatePageComponent); await settle();
    expect(text()).toContain('Account unavailable'); noReads();
    button('Try again').click(); await waitFor(() => expect(router.url).toBe('/help'));
    expect(auth.retry).toHaveBeenCalledOnce(); await load();
    expect(text()).toContain('Please review my renewal.');
  });

  it.each([['greg'], ['presenter'], ['employee', 'presenter']] satisfies Role[][])
    ('denies roles %j before any private case read', async (...roles) => {
      state.set({ status: 'ready', context: { ...employee, roles } });
      await harness.navigateByUrl('/help', StatePageComponent); await settle();
      expect(router.url).toBe('/access-denied'); expect(text()).toContain('Access not available'); noReads();
    });

  it('shows unavailable reads and refreshes through the route without preparing or submitting help', async () => {
    const page = await harness.navigateByUrl('/help', HelpComponent); await settle();
    helpReads[0]!.resolve({ state: 'failed', value: null, problem: 'transport-unavailable' });
    caseReads[0]!.resolve(ok({ cases: [], asOf: at, policyVersion: 'policy-1' }));
    await waitFor(() => expect(page.view().phase).toBe('unavailable'));
    expect(page.view().phase).toBe('unavailable'); expect(text()).toContain('Renewal help is unavailable');
    expect(harness.routeNativeElement!.querySelector('[data-help-ask]')).toBeNull();
    button('Refresh cases').click(); await settle(); expect(helpReads).toHaveLength(2); expect(caseReads).toHaveLength(2);
    expect(page.view().phase).toBe('loading'); await load(); expect(page.view().phase).toBe('ready');
  });

  it('recovers authentication in the mounted body using fresh reads only', async () => {
    state.set({ status: 'unavailable', message: 'Identity service unavailable', retryable: true });
    const page = await harness.navigateByUrl('/help', HelpComponent); await settle();
    expect(text()).toContain('Sign-in unavailable'); noReads();
    button('Try again').click(); await settle(); expect(auth.retry).toHaveBeenCalledOnce();
    expect(harness.routeDebugElement!.componentInstance).toBe(page); expect(helpReads).toHaveLength(1);
    await load(); expect(page.view().phase).toBe('ready');
  });

  it('disposes on exit, ignores late private reads, and creates a fresh component and store on reentry', async () => {
    const first = await harness.navigateByUrl('/help', HelpComponent); await settle();
    await harness.navigateByUrl('/access-denied', StatePageComponent); await settle();
    expect(helpReads[0]!.options.signal!.aborted).toBe(true); expect(caseReads[0]!.options.signal!.aborted).toBe(true);
    expect(text()).toContain('Access not available');
    const second = await harness.navigateByUrl('/help', HelpComponent); await settle();
    expect(second).not.toBe(first); expect(second.store).not.toBe(first.store);
    expect(first.view().help).toBeNull(); expect(first.view().cases).toEqual([]);
    expect(second.view().phase).toBe('loading'); expect(text()).not.toContain('Private response after exit');
    expect(helpReads).toHaveLength(2); expect(caseReads).toHaveLength(2); await load(1, 'Fresh private response');
    helpReads[0]!.resolve(ok(guidance));
    caseReads[0]!.resolve(ok({ cases: [record('Private response after exit')], asOf: at, policyVersion: 'policy-1' }));
    await new Promise<void>(resolve => setTimeout(resolve, 0)); await settle();
    expect(first.view().cases).toEqual([]); expect(text()).toContain('Fresh private response');
    expect(text()).not.toContain('Private response after exit');
  });
});
