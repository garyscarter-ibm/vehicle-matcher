import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, ApplicationContext, SessionState } from '../auth/auth.port';
import { routes } from '../routes';
import { CaseClient, CaseClientResult } from './case.client';
import { CaseOptions, CaseRecord } from './case.types';
import { CaseQueueComponent } from './case-queue.component';

const at = '2026-11-14T12:00:00.000Z';
const greg: ApplicationContext = { subject: 'greg', environmentId: 'isolated', runId: 'run-1', roles: ['greg'], policyVersion: 'policy-1', capabilities: [] };
const record = (patch: Partial<CaseRecord> = {}): CaseRecord => ({ caseId: 'renewal-12345678-current', runId: 'run-1', employeeId: 'paula', employeeName: 'Paula', renewalId: 'r1',
  owner: { role: 'scheme-team', name: 'Greg' }, status: 'open', reason: '<img src=x> Renewal delayed', trigger: { type: 'employee-request' }, nextAction: 'Review renewal',
  dueAt: '2026-11-15T12:00:00.000Z', openedAt: at, lastUpdatedAt: at, renewalDeadline: '2026-12-01', renewalDeadlineState: 'known', policyVersion: 'policy-1',
  history: [{ at, actorId: 'paula', actorRole: 'employee', status: 'open', reason: 'Please help', nextAction: 'Review renewal', dueAt: at, remedy: null }],
  remedy: null, fictional: true, version: 3, ...patch });
const options = (row = record()): CaseOptions => ({ case: row, asOf: at, policyVersion: 'policy-1', automaticRecoveryPriority: false, nextStatuses: row.status === 'closed' ? [] : ['in-progress', 'closed'],
  options: { alternativeCars: { available: false, items: [], needsConfirmation: [{ type: 'alternative-car', orderUuid: 'unknown-1', unknowns: ['charging-unconfirmed'] }], reason: 'No suitable stock' },
    preferenceRelaxations: { available: false, items: [], reason: 'Preference confirmation unavailable' }, laterRelease: { available: false, items: [], reason: 'No reviewed release' },
    manualDecision: { available: true, type: 'manual-decision', requiresDecision: true },
    contractExtension: { available: false, type: 'contract-extension', contractEndDate: null, requiresUntil: true, reason: 'Policy does not permit extension' } } });
const ok = <T>(value: T): CaseClientResult<T> => ({ state: 'ready', value, replayed: false });
const queue = (rows = [record()]) => ok({ cases: rows, asOf: at, policyVersion: 'policy-1' });
const unavailable = (): CaseClientResult<never> => ({ state: 'refused', value: null, refusal: { status: 'unavailable', code: 'unavailable', reason: 'Try later', retryable: true } });
const fakeClient = () => ({ readQueue: vi.fn<CaseClient['readQueue']>().mockResolvedValue(queue()), readOptions: vi.fn<CaseClient['readOptions']>().mockResolvedValue(ok(options())),
  prepareUpdate: vi.fn<CaseClient['prepareUpdate']>().mockImplementation(input => Object.freeze({ kind: 'update-case', input: Object.freeze(structuredClone(input)) })),
  updateCase: vi.fn<CaseClient['updateCase']>().mockResolvedValue(ok({ case: record({ status: 'in-progress', version: 4 }) })) });

describe('actual Greg route, native controls and case focus', () => {
  let state = signal<SessionState>({ status: 'ready', context: greg }); let client = fakeClient(); let harness: RouterTestingHarness; let page: CaseQueueComponent;
  beforeEach(async () => {
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
    state = signal<SessionState>({ status: 'ready', context: greg }); client = fakeClient();
    const auth = { state, recovery: signal(null), initialize: vi.fn(async () => {}), retry: vi.fn(async () => {}), signIn: vi.fn(async () => {}), signOut: vi.fn(async () => {}), completeSignIn: vi.fn(async () => {}), getAccessToken: vi.fn(async () => null) };
    TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: AuthPort, useValue: auth }, { provide: CaseClient, useValue: client }] });
    harness = await RouterTestingHarness.create();
  });
  afterEach(() => { harness?.fixture.destroy(); TestBed.resetTestingModule(); vi.unstubAllGlobals(); });
  const root = () => harness.routeNativeElement!;
  const text = () => root().textContent!.replace(/\s+/g, ' ');
  const settle = async () => { harness.detectChanges(); await harness.fixture.whenStable(); harness.detectChanges(); };
  const wait = async (assertion: () => void) => { await vi.waitFor(async () => { await settle(); assertion(); }); };
  function button(label: string): HTMLButtonElement {
    const found = Array.from(root().querySelectorAll('button')).find(b => b.textContent!.trim() === label); if (!found) throw new Error(`Missing ${label}`); return found;
  }
  async function enter() { page = await harness.navigateByUrl('/greg/cases', CaseQueueComponent); await wait(() => expect(page.view().phase).toBe('ready')); }
  async function open() { await enter(); button('Open').click(); await wait(() => expect(page.view().detailPhase).toBe('ready')); }
  function field(key: string, value: string) {
    const control = root().querySelector<HTMLInputElement>(`[id="${page.control(key)}"]`)!; control.value = value; control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); harness.detectChanges();
  }
  function review() { field('status', 'in-progress'); field('reason', 'Reviewed with employee'); field('nextAction', 'Call employee'); field('dueAt', '2026-11-16T10:30'); button('Review case update').click(); harness.detectChanges(); }

  it('mounts the exact lazy route, Greg metadata and server-owned queue without changing Help or offer destinations', async () => {
    await enter(); expect(TestBed.inject(Router).url).toBe('/greg/cases');
    expect(root().querySelectorAll('[role=tab]')).toHaveLength(6); expect(root().querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Renewal cases');
    expect(harness.routeDebugElement!.injector.get(ActivatedRoute).snapshot.data).toEqual({ title: 'Employee cases', roles: ['greg'] });
    expect(root().querySelectorAll('h1')).toHaveLength(1); expect(text()).toContain('Renewal cases'); expect(text()).toContain('Greg'); expect(text()).toContain('2026-12-01'); expect(text()).toContain('UTC');
    expect(root().querySelector('img')).toBeNull(); expect(routes.find(r => r.path === 'help')?.data).toEqual({ title: 'Renewal help', roles: ['employee'] });
    expect(routes.find(r => r.path === 'offers/:offerId')?.loadComponent).toBeTypeOf('function'); expect(client.updateCase).not.toHaveBeenCalled();
  });
  it('sorts displayed cases by the native deadline or status choice and preserves focus and exact open identity', async () => {
    const early = record({ caseId: 'early', employeeName: 'Early', status: 'in-progress', renewalDeadline: '2026-11-20' });
    const later = record({ caseId: 'later', employeeName: 'Later', status: 'open', renewalDeadline: '2026-12-01' });
    const terminal = record({ caseId: 'closed', employeeName: 'Closed', status: 'closed', renewalDeadline: '2026-11-01' });
    client.readQueue.mockResolvedValue(queue([terminal, later, early]));
    await enter();
    const names = () => Array.from(root().querySelectorAll('gcsp-data-table tbody button')).map(b => b.getAttribute('aria-label'));
    expect(names()).toEqual(['Open case for Early', 'Open case for Later', 'Open case for Closed']);
    const select = root().querySelector<HTMLSelectElement>(`#${page.control('sort')}`)!;
    expect(select).not.toBeNull(); expect(root().querySelector(`label[for="${select.id}"]`)?.textContent).toContain('Sort cases');
    expect(Array.from(select.options).map(o => [o.value, o.textContent])).toEqual([
      ['deadline', 'Deadline, active cases first'], ['status', 'Status, then deadline']]);
    select.focus(); select.value = 'status'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(names()).toEqual(['Open case for Later', 'Open case for Early', 'Open case for Closed']);
    expect(document.activeElement).toBe(select);
    client.readOptions.mockResolvedValueOnce(ok(options(later)));
    root().querySelector<HTMLButtonElement>('button[aria-label="Open case for Later"]')!.click();
    await wait(() => expect(page.view().detailPhase).toBe('ready'));
    expect(client.readOptions.mock.calls.at(-1)?.[0]).toBe('later');
  });
  it('renders the offered preference value control and explicit employee-confirmation consequence in review', async () => {
    const current = options();
    client.readOptions.mockResolvedValueOnce(ok({ ...current, options: { ...current.options, preferenceRelaxations: { available: true, items: [
      { type: 'preference-relaxation', decisionId: 'decline-1', expectedBriefVersion: 2, path: 'preferences.body.value', before: ['hatchback'], valueType: 'enum', values: ['estate'] },
    ] } } }));
    await open(); field('remedyKey', 'preference:0'); field('preferenceValue', '0'); review();
    expect(text()).toContain('Body: estate. Employee confirmation is required'); expect(client.updateCase).not.toHaveBeenCalled();
    expect(root().querySelector('[data-case-review]')).toBe(document.activeElement);
  });
  it('focuses selected heading, shows facts/history/feasibility and returns Close focus to its named Open', async () => {
    await open(); expect(document.activeElement).toBe(root().querySelector('[data-case-heading]'));
    const table = root().querySelector('gcsp-data-table')!; expect(table.querySelector('.gcsp-table-wrap.is-stack')).not.toBeNull(); expect(table.querySelector('button')?.getAttribute('aria-label')).toBe('Open case for Paula'); expect(table.querySelectorAll('thead th')).toHaveLength(8);
    expect(text()).toContain('Paula · 12345678'); expect(text()).toContain('Dated case history'); expect(text()).toContain('Please help');
    expect(text()).toContain('No suitable stock'); expect(text()).toContain('Preference confirmation unavailable'); expect(text()).toContain('Charging access not confirmed'); expect(text()).not.toContain('charging-unconfirmed');
    const status = root().querySelector<HTMLSelectElement>(`#${page.control('status')}`)!;
    expect(Array.from(status.options).map(o => o.value)).toEqual(['', 'in-progress', 'closed']);
    expect(root().querySelectorAll('option[value="unknown-1"]')).toHaveLength(0);
    button('Close case').click(); await settle(); expect(page.view().selected).toBeNull(); expect(document.activeElement).toBe(button('Open'));
  });
  it('uses associated native inputs, a separate review and Cancel without a write', async () => {
    await open(); for (const control of Array.from(root().querySelectorAll('input,select,textarea'))) expect(root().querySelector(`label[for="${control.id}"]`)).toBeTruthy();
    expect(root().querySelector('input[type="datetime-local"]')).toBeTruthy(); review();
    expect(document.activeElement).toBe(root().querySelector('[data-case-review]')); expect(text()).toContain('Confirm case update'); expect(client.updateCase).not.toHaveBeenCalled();
    button('Cancel').click(); await settle(); expect(document.activeElement?.id).toBe(page.control('status')); expect(client.updateCase).not.toHaveBeenCalled();
  });
  it('focuses validation summary and its links focus the invalid control', async () => {
    await open(); button('Review case update').click(); await settle(); const summary = root().querySelector('gcsp-error-summary section')!;
    expect(document.activeElement).toBe(summary); const link = summary.querySelector<HTMLAnchorElement>('a')!; link.click();
    expect(document.activeElement?.id).toBe(page.control('status')); expect(root().querySelector(`[id="${page.control('status')}"]`)?.getAttribute('aria-invalid')).toBe('true');
    expect(client.prepareUpdate).not.toHaveBeenCalled();
  });
  it('locks pending confirmation and focuses authoritative readback status', async () => {
    await open(); review(); let complete!: (value: Awaited<ReturnType<CaseClient['updateCase']>>) => void;
    client.updateCase.mockReturnValueOnce(new Promise(resolve => { complete = resolve; })); button('Confirm case update').click(); await settle();
    expect(button('Confirm case update').disabled).toBe(true); expect(button('Close case').disabled).toBe(true); expect(button('Open').disabled).toBe(true);
    const current = record({ version: 4, status: 'in-progress', nextAction: 'Authoritative follow-up' }); client.readQueue.mockResolvedValueOnce(queue([current])); client.readOptions.mockResolvedValueOnce(ok(options(current)));
    complete(ok({ case: current })); await wait(() => expect(page.view().recorded).toBe(true));
    await wait(() => expect(text()).toContain('Authoritative follow-up')); expect(document.activeElement).toBe(root().querySelector('[data-case-status]')); expect(client.updateCase).toHaveBeenCalledOnce();
  });
  it('shows stale recovery and requires refreshed options rather than resubmitting', async () => {
    await open(); review(); client.updateCase.mockResolvedValueOnce({ state: 'refused', value: null, refusal: { status: 'stale-version', code: 'stale', reason: 'Another reviewer updated the case', retryable: false } });
    button('Confirm case update').click(); await wait(() => expect(page.view().detailPhase).toBe('stale'));
    expect(text()).toContain('This case has changed'); expect(text()).toContain('Another reviewer'); expect(root().querySelector('form')).toBeNull();
    button('Refresh case options').click(); await wait(() => expect(page.view().detailPhase).toBe('ready')); expect(root().querySelector('form')).toBeTruthy(); expect(client.updateCase).toHaveBeenCalledOnce();
  });
  it('offers explicit same-update retry only after unknown outcome and current reread', async () => {
    await open(); review(); client.updateCase.mockResolvedValueOnce({ state: 'failed', value: null, problem: 'timeout', writeOutcome: 'unknown' });
    button('Confirm case update').click(); await wait(() => expect(page.view().uncertain).toBe(true)); expect(text()).toContain('Update outcome unknown');
    expect(text()).not.toContain('Retry the same case update'); button('Check current cases').click(); await wait(() => expect(page.view().canRetry).toBe(true));
    expect(text()).toContain('Retry the same case update'); expect(client.updateCase).toHaveBeenCalledOnce();
  });
  it('distinguishes proven empty, unavailable and access loss without retaining case details', async () => {
    await open(); client.readQueue.mockResolvedValueOnce(queue([])); await page.perform('refresh'); await settle(); expect(text()).toContain('No renewal cases');
    client.readQueue.mockResolvedValueOnce(unavailable()); await page.perform('refresh'); await settle(); expect(text()).toContain('Cases are unavailable'); expect(text()).not.toContain('No renewal cases');
    state.set({ status: 'denied', message: 'Access ended' }); await settle(); expect(text()).toContain('You cannot open these cases'); expect(text()).not.toContain('Paula'); expect(root().querySelector('table')).toBeNull();
  });
  it('shows terminal detail and recorded remedy without offering an unsupported update', async () => {
    client.readOptions.mockResolvedValueOnce(ok(options(record({ status: 'closed', remedy: { type: 'manual-decision', decision: 'Closed by agreement' } })))); await open();
    expect(text()).toContain('No further status changes'); expect(text()).toContain('Recorded remedy'); expect(text()).toContain('Closed by agreement'); expect(root().querySelector('form')).toBeNull(); expect(client.prepareUpdate).not.toHaveBeenCalled();
  });
  it('offers authentication recovery only for a retryable authentication failure', async () => {
    await open(); client.readQueue.mockResolvedValueOnce(unavailable()); await page.perform('refresh'); await settle();
    expect(text()).not.toContain('Retry sign-in connection');
    state.set({ status: 'unavailable', message: 'Provider unavailable', retryable: true }); await settle();
    expect(text()).toContain('Sign-in unavailable'); expect(text()).toContain('Retry sign-in connection'); expect(text()).not.toContain('Paula');
    state.set({ status: 'unavailable', message: 'Provider unavailable', retryable: false }); await settle(); expect(text()).not.toContain('Retry sign-in connection');
  });
  it.each([{ roles: ['employee'] as const }, { roles: ['presenter'] as const }, { roles: ['greg', 'presenter'] as const }])('denies direct entry for %j before any private request', async ({ roles }) => {
    state.set({ status: 'ready', context: { ...greg, roles } }); await harness.navigateByUrl('/greg/cases'); await settle();
    expect(TestBed.inject(Router).url).toBe('/access-denied'); expect(client.readQueue).not.toHaveBeenCalled(); expect(client.readOptions).not.toHaveBeenCalled();
  });
  it('returns signed-out direct entry to sign-in with the exact safe destination', async () => {
    state.set({ status: 'signed-out' }); await harness.navigateByUrl('/greg/cases'); await settle(); const url = TestBed.inject(Router).parseUrl(TestBed.inject(Router).url);
    expect(url.queryParams['returnTo']).toBe('/gcsp/greg/cases'); expect(client.readQueue).not.toHaveBeenCalled();
  });
  it('destroys private state and aborts detail work when leaving the route', async () => {
    await enter(); client.readOptions.mockReturnValueOnce(new Promise(() => {})); button('Open').click(); await settle(); const signal = client.readOptions.mock.calls[0][1]!.signal!;
    await harness.navigateByUrl('/greg'); await settle(); expect(signal.aborted).toBe(true); expect(page.view().rows).toEqual([]); expect(page.view().review).toBeNull();
  });
});
