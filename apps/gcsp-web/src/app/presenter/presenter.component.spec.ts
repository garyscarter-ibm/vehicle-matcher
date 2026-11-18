import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { routes } from '../routes';
import { PresenterClient } from './presenter.client';
import { PresenterComponent } from './presenter.component';
import { PresenterCatalogue, PresenterCommandValue, PresenterControls, PresenterCurrentScenario, PresenterFaults, PresenterResult, PresenterScenario, PresenterTick } from './presenter.types';

const at = '2026-11-16T12:00:00.000Z';
const context: ApplicationContext = { subject: 'presenter', roles: ['presenter'], environmentId: 'isolated-dev', runId: 'run-1', policyVersion: 'policy-1', capabilities: [] };
const scenario: PresenterScenario = { scenarioId: 'baseline', name: 'Baseline', scenarioVersion: 'scenario-1', fixtureVersion: 'fixture-1', policyVersion: 'policy-1',
  kind: 'demo', clockStart: at, namedTimes: { tomorrow: '2026-11-17T12:00:00.000Z' }, availability: { available: true, outcome: 'available', missingCapabilities: [] } };
const unavailableScenario: PresenterScenario = { ...scenario, scenarioId: 'remote', name: 'Remote supply', availability: { available: false, outcome: 'preparation unavailable', missingCapabilities: ['remote-stock'] } };
const lastTick: PresenterTick = { runId: 'run-1', tickId: 'tick-current', kind: 'presenter', now: at, clockVersion: 4, policyVersion: 'policy-1', state: 'completed',
  handlerOrder: [{ handlerId: 'stock-release', stage: 'release' }], missingStages: ['allocation'], outcomes: [{ handlerId: 'stock-release', stage: 'release', outcome: { status: 'pending', operationId: 'op-current' } }] };
const controls = (patch: Partial<PresenterControls> = {}): PresenterControls => ({ runId: 'run-1', now: at, clockVersion: 4, scenarioVersion: 'scenario-1', fixtureVersion: 'fixture-1', startsAt: at,
  namedTimes: scenario.namedTimes, lastTick, controls: { policyVersion: 'policy-1', step: { value: 60, unit: 'seconds' }, namedTimes: scenario.namedTimes, nextRelease: { status: 'available', to: 'tomorrow', at: '2026-11-17T12:00:00.000Z' } }, ...patch });
const catalogue: PresenterCatalogue = { catalogueVersion: 'catalogue-1', policyVersion: 'policy-1', scenarios: [scenario, unavailableScenario] };
const current = (patch: Partial<PresenterCurrentScenario> = {}): PresenterCurrentScenario => ({ ...controls(), catalogueVersion: 'catalogue-1', currentScenario: scenario, ...patch });
const faults: PresenterFaults = { runId: 'run-1', faults: [{ adapter: 'stock', available: true, mode: 'none', modes: ['none', 'unavailable'] }, { adapter: 'ordering', available: false, reason: 'not available yet' }] };
const ok = <T>(value: T): PresenterResult<T> => ({ state: 'ready', value });
const acknowledged = (): PresenterResult<PresenterCommandValue> => ok({ runId: 'run-1', now: at, clockVersion: 5 });
const fakeClient = () => ({
  readControls: vi.fn<PresenterClient['readControls']>().mockResolvedValue(ok(controls())),
  readClock: vi.fn<PresenterClient['readClock']>().mockResolvedValue(ok(controls())),
  readTick: vi.fn<PresenterClient['readTick']>().mockResolvedValue(ok(lastTick)),
  readCatalogue: vi.fn<PresenterClient['readCatalogue']>().mockResolvedValue(ok(catalogue)),
  readCurrentScenario: vi.fn<PresenterClient['readCurrentScenario']>().mockResolvedValue(ok(current())),
  readFaults: vi.fn<PresenterClient['readFaults']>().mockResolvedValue(ok(faults)),
  prepareAdvance: vi.fn<PresenterClient['prepareAdvance']>().mockImplementation(input => Object.freeze({ kind: 'advance', input: Object.freeze({ ...input }) })),
  prepareTick: vi.fn<PresenterClient['prepareTick']>().mockImplementation(input => Object.freeze({ kind: 'tick', input: Object.freeze({ ...input }) })),
  prepareControlTick: vi.fn<PresenterClient['prepareControlTick']>().mockImplementation(input => Object.freeze({ kind: 'control-tick', input: Object.freeze({ ...input }) })),
  prepareReset: vi.fn<PresenterClient['prepareReset']>().mockImplementation(input => Object.freeze({ kind: 'reset', input: Object.freeze({ ...input }) })),
  prepareFault: vi.fn<PresenterClient['prepareFault']>().mockImplementation(input => Object.freeze({ kind: 'fault', input: Object.freeze({ ...input }) })),
  submit: vi.fn<PresenterClient['submit']>().mockResolvedValue(acknowledged()),
});

// Controlled projections establish view behaviour only. Real Java/OIDC/reset-isolation acceptance remains separate.
describe('FUCQ-450 registered presenter route and deliberate controls', () => {
  let state = signal<SessionState>({ status: 'ready', context });
  let client = fakeClient(); let harness: RouterTestingHarness; let page: PresenterComponent;
  let auth: { state: typeof state; recovery: WritableSignal<null>; initialize: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn>;
    signIn: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn>; completeSignIn: ReturnType<typeof vi.fn>; getAccessToken: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    let sequence = 0; vi.stubGlobal('crypto', { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` });
    state = signal<SessionState>({ status: 'ready', context }); client = fakeClient();
    auth = { state, recovery: signal(null), initialize: vi.fn(async () => {}), retry: vi.fn(async () => {}), signIn: vi.fn(async () => {}), signOut: vi.fn(async () => {}), completeSignIn: vi.fn(async () => {}), getAccessToken: vi.fn(async () => null) };
    TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: AuthPort, useValue: auth }, { provide: PresenterClient, useValue: client }] });
    harness = await RouterTestingHarness.create();
  });
  afterEach(() => { harness?.fixture.destroy(); TestBed.resetTestingModule(); vi.unstubAllGlobals(); });
  const root = () => harness.routeNativeElement!;
  const text = () => root().textContent!.replace(/\s+/g, ' ');
  const settle = async () => { harness.detectChanges(); await harness.fixture.whenStable(); harness.detectChanges(); };
  const wait = async (assertion: () => void) => { await vi.waitFor(async () => { await settle(); assertion(); }); };
  async function enter() { page = await harness.navigateByUrl('/presenter', PresenterComponent); await wait(() => expect(page.controls()?.clockVersion).toBe(4)); }
  function button(label: string): HTMLButtonElement {
    const result = Array.from(root().querySelectorAll('button')).find(b => b.textContent!.trim() === label);
    if (!result) throw new Error(`Missing button: ${label}`); return result;
  }
  function field(name: string, value: string): void {
    const control = root().querySelector<HTMLInputElement | HTMLSelectElement>(`#${page.control(name)}`)!;
    control.value = value; control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); harness.detectChanges();
  }
  async function completeCommand(label: string): Promise<void> { button(label).click(); await wait(() => expect(page.pending() || page.reading()).toBe(false)); }

  it('P01 mounts the actual lazy route with presenter metadata and no entry command', async () => {
    await enter(); expect(routes.find(r => r.path === 'presenter')?.loadComponent).toBeTypeOf('function');
    expect(harness.routeDebugElement!.injector.get(ActivatedRoute).snapshot.data).toEqual({ title: 'Presenter controls', roles: ['presenter'] });
    expect(root().querySelectorAll('h1')).toHaveLength(1); expect(text()).toContain('Presenter controls'); expect(client.submit).not.toHaveBeenCalled();
  });
  it('P02 retains the signed-out presenter destination through the actual guard', async () => {
    state.set({ status: 'signed-out' }); await harness.navigateByUrl('/presenter');
    expect(TestBed.inject(Router).url).toBe('/sign-in?returnTo=%2Fgcsp%2Fpresenter'); expect(client.readControls).not.toHaveBeenCalled(); expect(client.submit).not.toHaveBeenCalled();
  });
  it.each(['employee', 'greg'] as const)('P03 denies the %s login at the registered guard', async role => {
    state.set({ status: 'ready', context: { ...context, roles: [role] } }); await harness.navigateByUrl('/presenter');
    expect(TestBed.inject(Router).url).toBe('/access-denied'); expect(client.readControls).not.toHaveBeenCalled(); expect(client.submit).not.toHaveBeenCalled();
  });
  it('P04 renders authoritative UTC/run/version and actual missing-stage/handler outcomes', async () => {
    await enter(); expect(text()).toContain(at); expect(text()).toContain('run-1'); expect(text()).toContain('tick-current'); expect(text()).toContain('stock-release');
    expect(text()).toContain('allocation'); expect(text()).toContain('op-current'); expect(text()).toContain('pending'); expect(text()).not.toContain('All handlers completed');
  });
  it('P05 pins step and next-release to the current clock version with fresh command references', async () => {
    await enter(); await completeCommand('Step 60 seconds'); await completeCommand('Next release');
    expect(client.prepareControlTick.mock.calls.map(call => call[0])).toEqual([
      { commandId: expect.any(String), expectedClockVersion: 4, mode: 'step' }, { commandId: expect.any(String), expectedClockVersion: 4, mode: 'next-release' },
    ]);
    expect(client.prepareControlTick.mock.calls[0][0].commandId).not.toBe(client.prepareControlTick.mock.calls[1][0].commandId);
    expect(client.readControls).toHaveBeenCalledTimes(3); expect(document.activeElement).toBe(root().querySelector('[data-presenter-status]'));
  });
  it('P06 disables unavailable next release and describes the actual reason', async () => {
    const value = controls(); client.readControls.mockResolvedValue(ok({ ...value, controls: { ...value.controls, nextRelease: { status: 'unavailable', reason: 'No further release configured' } } }));
    await enter(); expect(button('Next release').disabled).toBe(true); expect(text()).toContain('No further release configured');
    expect(button('Next release').getAttribute('aria-describedby')).toBe(page.control('release-reason'));
    await page.step('next-release'); expect(client.prepareControlTick).not.toHaveBeenCalled();
  });
  it('P07 submits exactly seconds or a named/instant target and preserves edited drafts across readback', async () => {
    await enter(); field('seconds', '120'); await completeCommand('Advance clock');
    expect(client.prepareAdvance).toHaveBeenLastCalledWith({ commandId: expect.any(String), expectedClockVersion: 4, bySeconds: 120 }); expect(page.seconds()).toBe('120');
    field('advance-kind', 'to'); field('target', 'tomorrow'); await completeCommand('Advance clock');
    expect(client.prepareAdvance).toHaveBeenLastCalledWith({ commandId: expect.any(String), expectedClockVersion: 4, to: 'tomorrow' });
    field('target', '2026-11-18T12:00:00Z'); await completeCommand('Advance clock'); expect(client.prepareAdvance).toHaveBeenLastCalledWith({ commandId: expect.any(String), expectedClockVersion: 4, to: '2026-11-18T12:00:00Z' });
  });
  it('P08 validates a positive whole seconds draft without preparing or sending a command', async () => {
    await enter(); page.seconds.set('1.5'); await page.advance(new Event('submit', { cancelable: true })); harness.detectChanges();
    expect(text()).toContain('Enter a positive whole number'); expect(document.activeElement?.id).toBe(page.control('seconds')); expect(client.prepareAdvance).not.toHaveBeenCalled();
  });
  it('P09 ticks current time with the entered tick reference and current clock pin', async () => {
    await enter(); field('tick', 'specific-tick'); await completeCommand('Tick current time');
    expect(client.prepareTick).toHaveBeenCalledWith({ tickId: 'specific-tick', expectedClockVersion: 4 });
    expect(client.submit.mock.calls[0][0]).toEqual({ kind: 'tick', input: { tickId: 'specific-tick', expectedClockVersion: 4 } });
  });
  it('P10 resets only after an inline pinned review, while Cancel and Escape restore trigger focus', async () => {
    await enter(); button('Reset scenario').click(); harness.detectChanges(); expect(document.activeElement).toBe(root().querySelector('[data-reset-review]'));
    expect(text()).toContain('Run to replace'); expect(client.submit).not.toHaveBeenCalled();
    button('Cancel').click(); harness.detectChanges(); expect(document.activeElement).toBe(button('Reset scenario'));
    button('Reset scenario').click(); harness.detectChanges(); root().querySelector('.presenter-confirmation')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); harness.detectChanges();
    expect(document.activeElement).toBe(button('Reset scenario')); expect(client.submit).not.toHaveBeenCalled();
    button('Reset scenario').click(); harness.detectChanges(); await completeCommand('Confirm reset');
    expect(client.prepareReset).toHaveBeenLastCalledWith({ commandId: expect.any(String), expectedRunId: 'run-1', scenarioId: 'baseline', scenarioVersion: 'scenario-1', fixtureVersion: 'fixture-1', policyVersion: 'policy-1' });
    expect(client.submit).toHaveBeenCalledOnce();
  });
  it('P11 keeps unavailable scenarios selectable with missing capabilities and prevents reset', async () => {
    await enter(); field('scenario', 'remote'); expect(text()).toContain('remote-stock'); expect(text()).toContain('preparation unavailable'); expect(button('Reset scenario').disabled).toBe(true);
    page.reviewReset(); expect(client.prepareReset).not.toHaveBeenCalled(); expect(client.submit).not.toHaveBeenCalled();
  });
  it('P12 clears an obsolete reset confirmation on refresh without clearing ordinary clock drafts', async () => {
    await enter(); field('seconds', '900'); button('Reset scenario').click(); harness.detectChanges(); await completeCommand('Refresh current state');
    expect(page.resetReview()).toBeNull(); expect(page.seconds()).toBe('900'); expect(client.submit).not.toHaveBeenCalled();
  });
  it('P13 offers only supported fault adapters and modes; ordering remains visibly unavailable', async () => {
    await enter(); expect(text()).toContain('ordering: unavailable');
    expect(root().querySelector(`select#${page.control('fault')} option[value="ordering"]`)).toBeNull();
    field('fault', 'stock'); expect(Array.from(root().querySelectorAll(`#${page.control('mode')} option`)).map(o => (o as HTMLOptionElement).value)).toEqual(['', 'none', 'unavailable']);
    field('mode', 'unavailable'); await completeCommand('Set fault mode'); expect(client.prepareFault).toHaveBeenCalledWith({ commandId: expect.any(String), adapter: 'stock', mode: 'unavailable' });
  });
  it('P14 links permitted outbox and comparison inspection without a principal, employee or Greg action surface', async () => {
    await enter(); const links = Array.from(root().querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(links).toEqual(['/presenter/outbox', '/comparison']); expect(text()).toContain('Process comparisons'); expect(text()).toContain("account's own login");
    expect(root().querySelector('[name="principalId"], [name="employeeId"], [name="runId"]')).toBeNull(); expect(client.submit).not.toHaveBeenCalled();
  });
  it('P15 locks duplicate commands and all editors while submission is pending', async () => {
    await enter(); let resolve!: (v: PresenterResult<PresenterCommandValue>) => void; client.submit.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const first = page.step('step'); harness.detectChanges(); expect(page.pending()).toBe(true); expect(button('Next release').disabled).toBe(true); expect(button('Reset scenario').disabled).toBe(true);
    await page.step('step'); await page.setFault(new Event('submit')); expect(client.submit).toHaveBeenCalledOnce(); resolve(acknowledged()); await first;
  });
  it.each(['unknown', 'pending'] as const)('P16 retains the exact %s command, reads current state and retries only on deliberate action', async outcome => {
    await enter(); client.submit.mockResolvedValueOnce(outcome === 'unknown' ? { state: 'failed', value: null, problem: 'Connection lost', writeOutcome: 'unknown' }
      : { state: 'refused', value: null, refusal: { status: 'pending', code: 'in-progress', reason: 'Still running', retryable: true, operationId: 'op-1' } });
    await completeCommand('Step 60 seconds'); const original = client.submit.mock.calls[0][0]; expect(page.retryCommand()).toBe(original); expect(client.readControls).toHaveBeenCalledTimes(2); expect(client.submit).toHaveBeenCalledOnce();
    expect(button('Step 60 seconds').disabled).toBe(true); await completeCommand('Refresh current state'); expect(client.submit).toHaveBeenCalledOnce();
    await completeCommand('Retry the same command'); expect(client.submit.mock.calls[1][0]).toBe(original); expect(client.prepareControlTick).toHaveBeenCalledOnce(); expect(page.retryCommand()).toBeNull();
  });
  it('P17 shows a current-version conflict and uses current GET state without retrying the refused command', async () => {
    await enter(); client.submit.mockResolvedValueOnce({ state: 'refused', value: null, refusal: { status: 'conflict', code: 'clock-version', reason: 'Clock changed', retryable: false, currentVersion: 8 } });
    client.readControls.mockResolvedValueOnce(ok(controls({ clockVersion: 8 }))); await completeCommand('Step 60 seconds');
    expect(page.controls()?.clockVersion).toBe(8); expect(text()).toContain('Current-version conflict'); expect(text()).toContain('Current version: 8'); expect(page.retryCommand()).toBeNull(); expect(client.submit).toHaveBeenCalledOnce();
  });
  it('P18 reports an unavailable readback after acknowledgement and keeps new commands disabled', async () => {
    await enter(); client.readControls.mockResolvedValueOnce({ state: 'refused', value: null, refusal: { status: 'unavailable', code: 'database', reason: 'Database unavailable', retryable: true } });
    await completeCommand('Step 60 seconds'); expect(text()).toContain('Command acknowledged'); expect(text()).toContain('Database unavailable'); expect(page.controls()).toBeNull();
    expect(text()).not.toContain('Current backend state loaded'); expect(client.submit).toHaveBeenCalledOnce();
  });
  it('P19 aborts and clears private projections on changed auth and ignores late read completion', async () => {
    await enter(); let resolve!: (v: PresenterResult<PresenterControls>) => void; client.readControls.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const read = page.refresh(); const signal = client.readControls.mock.calls.at(-1)![0]!.signal!;
    state.set({ status: 'signed-out' }); harness.detectChanges(); await Promise.resolve(); harness.detectChanges();
    expect(signal.aborted).toBe(true); expect(page.controls()).toBeNull(); expect(page.current()).toBeNull(); expect(page.catalogue()).toBeNull(); expect(page.faults()).toBeNull();
    resolve(ok(controls())); await read; harness.detectChanges(); expect(page.controls()).toBeNull(); expect(text()).not.toContain('op-current'); expect(client.submit).not.toHaveBeenCalled();
  });
  it('P20 retains an incomplete reset across deliberate same-account context refresh and re-prepares identical input only on retry', async () => {
    await enter(); client.submit.mockResolvedValueOnce({ state: 'refused', value: null, refusal: { status: 'unavailable', code: 'scenario-preparation-incomplete', reason: 'Preparation incomplete; retry same reset', retryable: true, runId: 'run-2' } });
    button('Reset scenario').click(); harness.detectChanges(); await completeCommand('Confirm reset'); const original = client.submit.mock.calls[0][0];
    const activated = controls({ runId: 'run-2', clockVersion: 1, lastTick: null });
    let finishAuthentication!: () => void; let finishRead!: (value: PresenterResult<PresenterControls>) => void;
    client.readControls.mockResolvedValue(ok(activated)).mockReturnValueOnce(new Promise(done => { finishRead = done; }));
    client.readCurrentScenario.mockResolvedValue(ok(current({ ...activated, currentScenario: scenario })));
    client.readFaults.mockResolvedValue(ok({ ...faults, runId: 'run-2' }));
    auth.retry.mockImplementationOnce(async () => {
      state.set({ status: 'loading' }); await new Promise<void>(done => { finishAuthentication = done; });
      state.set({ status: 'ready', context: { ...context, runId: 'run-2' } });
    });
    button('Refresh sign-in context').click(); expect(page.reading()).toBe(true); expect(auth.retry).toHaveBeenCalledOnce();
    harness.detectChanges(); expect(page.permitted()).toBe(false); expect(client.submit).toHaveBeenCalledOnce();
    finishAuthentication(); await wait(() => { expect(page.permitted()).toBe(true); expect(page.reading()).toBe(true); });
    expect(button('Retry the same command').disabled).toBe(true); expect(page.retryCommand()?.input).toEqual(original.input);
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.prepareReset).toHaveBeenCalledOnce();
    finishRead(ok(activated)); await wait(() => {
      expect(page.controls()?.runId).toBe('run-2'); expect(page.reading()).toBe(false); expect(page.pending()).toBe(false);
      expect(page.permitted()).toBe(true); expect(page.faultRetryCommand()).toBeNull(); expect(button('Retry the same command').disabled).toBe(false);
    });
    expect(page.current()?.runId).toBe('run-2'); expect(page.faults()?.runId).toBe('run-2'); expect(page.readProblems()).toEqual([]);
    expect(page.retryCommand()?.input).toEqual(original.input); expect(client.submit).toHaveBeenCalledOnce(); expect(client.prepareReset).toHaveBeenCalledOnce();
    const retry = vi.spyOn(page, 'retry'); button('Retry the same command').click(); expect(retry).toHaveBeenCalledOnce();
    await wait(() => { expect(client.prepareReset).toHaveBeenCalledTimes(2); expect(page.pending() || page.reading()).toBe(false); });
    expect(client.prepareReset.mock.calls[1][0]).toEqual(original.input);
    expect(client.submit.mock.calls[1][0].input).toEqual(original.input);
  });
  it('P21 never replays on authentication recovery and drops a prior command for another account', async () => {
    await enter(); client.submit.mockResolvedValueOnce({ state: 'failed', value: null, problem: 'expired', writeOutcome: 'unknown' }); await completeCommand('Step 60 seconds');
    state.set({ status: 'ready', context: { ...context, subject: 'another-presenter' } }); await settle();
    expect(page.retryCommand()).toBeNull(); expect(client.submit).toHaveBeenCalledOnce(); expect(text()).not.toContain('Retry the same command');
  });
  it('P22 aborts pending work on destruction and ignores late command completion', async () => {
    await enter(); let resolve!: (v: PresenterResult<PresenterCommandValue>) => void; client.submit.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const command = page.step('step'); const signal = client.submit.mock.calls[0][1]!.signal!; page.ngOnDestroy(); expect(signal.aborted).toBe(true);
    resolve(acknowledged()); await command; expect(client.readControls).toHaveBeenCalledOnce();
  });
  it('P23 labels native inputs and associates supplied hints', async () => {
    await enter(); for (const control of Array.from(root().querySelectorAll('input,select'))) {
      expect(root().querySelector(`label[for="${control.id}"]`)).toBeTruthy(); const described = control.getAttribute('aria-describedby');
      if (described) expect(root().querySelector(`[id="${described}"]`)).toBeTruthy();
    }
  });
  it('P24 rejects mixed-run readbacks and prevents commands from stale clock state', async () => {
    client.readCurrentScenario.mockResolvedValue(ok(current({ runId: 'changed-run' })));
    page = await harness.navigateByUrl('/presenter', PresenterComponent); await wait(() => expect(page.reading()).toBe(false));
    expect(page.controls()).toBeNull(); expect(text()).toContain('active run changed'); await page.step('step'); expect(client.submit).not.toHaveBeenCalled();
  });
  it('P25 reports the activated reset run, requests context refresh and reads the new run without replay', async () => {
    await enter(); const activated = controls({ runId: 'run-2', clockVersion: 1, lastTick: null });
    client.submit.mockResolvedValueOnce(ok({ retiredRunId: 'run-1', activatedRunId: 'run-2', replayed: false, scenario, clock: activated }));
    client.readControls.mockResolvedValueOnce({ state: 'scope-mismatch', value: null });
    button('Reset scenario').click(); harness.detectChanges(); await completeCommand('Confirm reset');
    expect(text()).toContain('Activated run: run-2'); expect(text()).toContain('Refresh sign-in context to read the active run'); expect(page.controls()).toBeNull();
    client.readControls.mockResolvedValue(ok(activated)); client.readCurrentScenario.mockResolvedValue(ok(current({ ...activated, currentScenario: scenario })));
    client.readFaults.mockResolvedValue(ok({ ...faults, runId: 'run-2' }));
    auth.retry.mockImplementationOnce(async () => { state.set({ status: 'ready', context: { ...context, runId: 'run-2' } }); });
    await completeCommand('Refresh sign-in context'); await wait(() => expect(page.controls()?.runId).toBe('run-2'));
    expect(client.submit).toHaveBeenCalledOnce(); expect(page.retryCommand()).toBeNull(); expect(text()).toContain('Current backend state loaded.');
  });
  it.each(['ready', 'unknown', 'unavailable'] as const)('P26 clears the fault with %s recovery while preserving the exact interrupted control command', async clearOutcome => {
    await enter(); field('fault', 'stock'); field('mode', 'unavailable'); await completeCommand('Set fault mode');
    client.submit.mockResolvedValueOnce({ state: 'refused', value: null, refusal: { status: 'unavailable', code: 'handler-interrupted', reason: 'Stock fault interrupted the tick', retryable: true } });
    await completeCommand('Step 60 seconds'); const original = client.submit.mock.calls[1][0];
    expect(page.retryCommand()).toBe(original); expect(original.input).toMatchObject({ expectedClockVersion: 4, mode: 'step' });
    expect((root().querySelector(`#${page.control('fault')}`) as HTMLSelectElement).disabled).toBe(false);
    expect(page.modes()).toEqual(['none']); field('mode', 'none');
    client.submit.mockResolvedValueOnce(clearOutcome === 'ready' ? ok(faults) : clearOutcome === 'unknown'
      ? { state: 'failed', value: null, problem: 'Connection lost while clearing fault', writeOutcome: 'unknown' }
      : { state: 'refused', value: null, refusal: { status: 'unavailable', code: 'fault-store', reason: 'Fault outcome unresolved', retryable: true } });
    await completeCommand('Set fault mode'); const clearing = client.submit.mock.calls[2][0];
    expect(clearing.input).toMatchObject({ adapter: 'stock', mode: 'none' }); expect(page.retryCommand()).toBe(original);
    expect(client.submit).toHaveBeenCalledTimes(3); expect(client.prepareControlTick).toHaveBeenCalledOnce();
    if (clearOutcome !== 'ready') {
      expect(page.faultRetryCommand()).toBe(clearing); expect(button('Retry the same command').disabled).toBe(true);
      await page.retry(); expect(client.submit).toHaveBeenCalledTimes(3);
      client.submit.mockResolvedValueOnce(ok(faults)); await completeCommand('Retry the fault command');
      expect(client.submit.mock.calls[3][0]).toBe(clearing); expect(page.retryCommand()).toBe(original);
    }
    expect(page.faultRetryCommand()).toBeNull(); expect(client.prepareFault).toHaveBeenCalledTimes(2);
    await completeCommand('Retry the same command'); expect(client.submit.mock.calls.at(-1)![0]).toBe(original);
    expect(client.prepareControlTick).toHaveBeenCalledOnce(); expect(page.retryCommand()).toBeNull();
  });
});
