import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, Role, SessionState } from '../auth/auth.port';
import { ComparisonClient } from './comparison.client';
import { ComparisonComponent } from './comparison.component';
import { COMPARISON_EXPERIMENTS, ComparisonCatalogue, ComparisonJob, ComparisonResponse, StoredComparison } from './comparison.types';

const session = (roles: readonly Role[] = ['greg'], subject = 'greg-1', runId = 'run-1'): SessionState => ({ status: 'ready', context: { subject, roles, runId, environmentId: 'dev', policyVersion: 'gcsp-policy-v1', capabilities: [] } });
// Minimal projection of server/data/gcsp/comparison/process-only.json; no worker execution is implied.
const retained = (): StoredComparison => ({ resultId: 'retained-process', storedAt: '2026-11-09T18:12:24.449Z', policyVersion: 'gcsp-policy-v1', activePolicyVersion: 'gcsp-policy-v1', policyCurrent: true, resultDigest: 'd388e3371ea4a7f3c3665102e9452e7ccd0940b685b64fa2d623e7e47a3f3027', origin: 'retained', result: {
  schemaVersion: 1, kind: 'process-comparison', experimentId: 'process-only', completedAt: '2026-11-09T18:12:24.449Z',
  manifest: { experimentId: 'process-only', seeds: ['comparison-a', 'comparison-b', 'comparison-c'], policyVersion: 'gcsp-policy-v1', generatorVersion: 'comparison-inputs.sha256.v1', codeRevision: '669fbc2f', overlays: {} },
  differences: [{ measure: 'retries', betterWhen: 'lower', verdict: 'buddy-better', current: { mean: 1189, min: 1102, max: 1234 }, buddy: { mean: 3.666667, min: 3, max: 4 }, difference: { mean: -1185.333333, min: -1230, max: -1099 } }],
  assumptions: [{ key: 'brief.slider.maximum', value: 100, unit: 'integer slider units', status: 'assumed', basis: 'Assumed `brief.slider.scale`; dimensions declare categorical alternatives where required.', source: 'docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance', policyVersion: 'gcsp-policy-v1' }],
  caveat: 'Calculated fit is not observed satisfaction.', limitations: ['Acceptance is recorded as a local offer decision; the ordering handoff is not replayed.'],
} });
const catalogue = (stored: StoredComparison | null = retained()): ComparisonResponse<ComparisonCatalogue> => ({ status: 'ok', value: { activePolicyVersion: 'gcsp-policy-v1', experiments: COMPARISON_EXPERIMENTS.map(experimentId => ({ experimentId, latest: stored?.result.experimentId === experimentId ? stored : null })) } });
const job = (overrides: Partial<ComparisonJob> = {}): ComparisonJob => ({ jobId: 'job-1', experimentId: 'process-only', status: 'running', progress: { seedsDone: 1, seedsTotal: 3, stepsDone: 2, stepsTotal: 6 }, startedAt: '2026-11-16T19:00:00Z', finishedAt: null, resultId: null, reason: null, request: { experimentId: 'process-only', change: null }, ...overrides });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('comparison inspection and supported Greg commands', () => {
  let fixture: ComponentFixture<ComparisonComponent> | undefined;
  let authState: ReturnType<typeof signal<SessionState>>;
  let readResults: ReturnType<typeof vi.fn<ComparisonClient['readResults']>>;
  let readJob: ReturnType<typeof vi.fn<ComparisonClient['readJob']>>;
  let start: ReturnType<typeof vi.fn<ComparisonClient['start']>>;
  let retry: ReturnType<typeof vi.fn>;
  let signIn: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    authState = signal(session()); readResults = vi.fn<ComparisonClient['readResults']>().mockResolvedValue(catalogue());
    readJob = vi.fn<ComparisonClient['readJob']>().mockResolvedValue({ status: 'ok', value: { job: null, reruns: true } });
    start = vi.fn<ComparisonClient['start']>().mockResolvedValue({ status: 'pending', value: job() }); retry = vi.fn().mockResolvedValue(undefined); signIn = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({ imports: [ComparisonComponent], providers: [
      { provide: AuthPort, useValue: { state: authState, retry, signIn } }, { provide: ComparisonClient, useValue: { readResults, readJob, start } },
    ] }).compileComponents();
  });
  afterEach(() => { fixture?.destroy(); fixture = undefined; vi.useRealTimers(); vi.restoreAllMocks(); TestBed.resetTestingModule(); });
  const root = () => fixture!.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const button = (label: string) => Array.from(root().querySelectorAll('button')).find(b => b.textContent?.trim() === label)!;
  async function settle() {
    await vi.waitFor(() => { expect(fixture!.componentInstance.view()).not.toBe('loading'); expect(fixture!.componentInstance.commandBusy()).toBe(false); });
    await fixture!.whenStable(); fixture!.detectChanges();
  }
  async function render() { fixture = TestBed.createComponent(ComparisonComponent); fixture.detectChanges(); await settle(); }
  function select(id: string) { const el = root().querySelector<HTMLSelectElement>('#comparison-experiment')!; el.value = id; el.dispatchEvent(new Event('change')); fixture!.detectChanges(); }
  function input(id: string, value: string) { const el = root().querySelector<HTMLTextAreaElement>(`#comparison-${id}`)!; el.value = value; el.dispatchEvent(new Event('input')); fixture!.detectChanges(); }
  async function click(label: string) { button(label).click(); fixture!.detectChanges(); await settle(); }

  it('renders actual retained measurements, full assumptions, provenance and the fit caveat', async () => {
    const stored = retained(); const units = ['versioned synthetic buddy behaviour', 'versioned synthetic manual behaviour'];
    readResults.mockResolvedValue(catalogue({ ...stored, result: { ...stored.result, assumptions: [...stored.result.assumptions, ...units.map((unit, index) => ({ ...stored.result.assumptions[0], key: `behaviour.${index}`, unit }))] } }));
    await render(); expect(text()).toContain('Retained baseline'); expect(text()).toContain('1189 (1102 to 1234)'); expect(text()).toContain('3.7 (3 to 4)'); expect(text()).toContain('-1185.3 (-1230 to -1099)'); expect(text()).toContain('Buddy route better');
    expect(text()).toContain('brief.slider.maximum'); expect(text()).toContain('integer slider units'); expect(text()).toContain('Assumed `brief.slider.scale`'); expect(text()).toContain('comparison-a, comparison-b, comparison-c'); expect(text()).toContain('669fbc2f'); expect(text()).toContain('Calculated fit is not observed satisfaction.'); expect(root().querySelectorAll('h1')).toHaveLength(1); expect(text()).toContain('versioned buddy behaviour'); expect(text()).toContain('versioned manual behaviour'); expect(text()).not.toContain('synthetic'); expect(units).toEqual(['versioned synthetic buddy behaviour', 'versioned synthetic manual behaviour']);
    expect(root().querySelector('table caption')?.textContent).toContain('Assumptions'); expect(root().querySelector('th[scope="row"]')?.textContent).toBe('brief.slider.maximum');
  });
  it('shows older policy explicitly while retaining the historical result', async () => {
    readResults.mockResolvedValue(catalogue({ ...retained(), policyCurrent: false, activePolicyVersion: 'policy-new' })); await render();
    expect(text()).toContain('Older policy version'); expect(text()).toContain('policy-new'); expect(text()).toContain('1189');
  });
  it('distinguishes a missing result from an unavailable comparison read', async () => {
    readResults.mockResolvedValueOnce(catalogue(null)); await render(); expect(text()).toContain('No stored result yet');
    readResults.mockResolvedValueOnce({ status: 'unavailable', code: 'offline', reason: 'Read unavailable', retryable: true }); await click('Refresh'); expect(text()).toContain('Comparisons are unavailable'); expect(text()).not.toContain('No stored result yet');
  });
  it('renders actual experiment arms, differences, effects and the supplied change', async () => {
    const base = retained(); readResults.mockResolvedValue(catalogue({ ...base, result: { ...base.result, kind: 'experiment-comparison', experimentId: 'points', manifest: { ...base.result.manifest, experimentId: 'points', change: { value: 1.2, basis: 'Actual basis' } }, arms: [{ armId: 'baseline', value: 1, differences: base.result.differences!, measures: { supplied: 7 }, perSeed: [] }, { armId: 'variant', value: 1.2, differences: [{ ...base.result.differences![0], current: { mean: 800, min: 800, max: 800 }, buddy: { mean: 40, min: 40, max: 40 }, difference: { mean: -760, min: -760, max: -760 } }], measures: { supplied: 9 }, perSeed: [] }], effects: [{ armId: 'variant', value: 1.2, routes: { current: [{ effect: 'Actual current-route effect' }], buddy: [{ effect: 'Actual buddy-route effect' }] } }] } }));
    await render(); select('points'); expect(text()).toContain('Tried value: 1.2'); expect(text()).toContain('Today’s value: 1'); expect(text()).toContain('Buddy route better'); expect(text()).toContain('Actual current-route effect'); expect(text()).toContain('Actual buddy-route effect'); expect(text()).toContain('800 (800 to 800)'); expect(text()).toContain('40 (40 to 40)'); expect(text()).toContain('Difference (buddy minus today): -760'); expect(text()).not.toContain('Difference (tried value minus today)'); const arms = root().querySelectorAll('.comparison-measure'); expect(arms).toHaveLength(2); expect(arms[1].querySelectorAll('dt')[0].textContent).toBe("Today's release route"); expect(arms[1].querySelectorAll('dt')[1].textContent).toBe('Buddy route'); expect(text()).toContain('Actual basis'); expect(text()).toContain('supplied');
  });
  it('retains the selected native option through a loading refresh', async () => {
    await render(); select('hold-sweep'); const waiting = deferred<ComparisonResponse<ComparisonCatalogue>>(); readResults.mockReturnValueOnce(waiting.promise);
    button('Refresh').click(); fixture!.detectChanges(); expect(text()).toContain('Loading the stored comparisons'); waiting.resolve(catalogue()); await settle();
    expect(root().querySelector<HTMLSelectElement>('#comparison-experiment')!.value).toBe('hold-sweep'); expect(root().querySelector<HTMLOptionElement>('option[value="hold-sweep"]')!.selected).toBe(true);
  });
  it('keeps presenter inspection read-only and guards direct command calls', async () => {
    authState.set(session(['presenter'])); await render(); expect(text()).toContain('1189'); expect(root().querySelector('.comparison-command')).toBeNull(); expect(root().querySelector('textarea')).toBeNull(); fixture!.componentInstance.start(); fixture!.componentInstance.retryCommand(); await settle(); expect(start).not.toHaveBeenCalled();
  });
  it('denies employee-only access without reading comparison facts', async () => {
    authState.set(session(['employee'])); await render(); expect(text()).toContain('You cannot open comparisons'); expect(readResults).not.toHaveBeenCalled(); expect(readJob).not.toHaveBeenCalled();
  });
  it('gates start using the server reruns flag without hiding the retained result', async () => {
    readJob.mockResolvedValue({ status: 'ok', value: { job: null, reruns: false } }); await render(); expect(button('Start comparison').disabled).toBe(true); expect(text()).toContain('Starting comparisons is unavailable'); expect(text()).toContain('1189'); fixture!.componentInstance.start(); expect(start).not.toHaveBeenCalled();
  });
  it('starts the exact process command and shows server progress without changing seeds or workload', async () => {
    await render(); await click('Start comparison'); const submitted = start.mock.calls[0][0]; expect(submitted).toEqual({ experimentId: 'process-only', commandId: expect.any(String) }); expect(text()).toContain('Seeds done: 1 of 3. Steps: 2 of 6.'); expect(text()).toContain('job-1'); expect(button('Start comparison').disabled).toBe(true); expect(text()).toContain('retained-process');
  });
  it('polls the named running job and reads back only its matching completed result', async () => {
    await render(); vi.useFakeTimers(); await click('Start comparison');
    readJob.mockResolvedValueOnce({ status: 'ok', value: { job: job({ status: 'succeeded', finishedAt: '2026-11-16T19:01:00Z', resultId: 'new-result' }), reruns: true } }); readResults.mockResolvedValueOnce(catalogue({ ...retained(), resultId: 'new-result', origin: 'run' }));
    await vi.advanceTimersByTimeAsync(2000); await settle(); expect(readJob.mock.calls.at(-1)![0]?.jobId).toBe('job-1'); expect(text()).toContain('New result stored and read back.'); expect(text()).toContain('New result: Process only'); const calls = readJob.mock.calls.length; await vi.advanceTimersByTimeAsync(6000); expect(readJob).toHaveBeenCalledTimes(calls);
  });
  it('does not call an unrelated latest result this job’s new result', async () => {
    readJob.mockResolvedValue({ status: 'ok', value: { job: job({ status: 'succeeded', finishedAt: '2026-11-16T19:01:00Z', resultId: 'different-result' }), reruns: true } }); await render();
    expect(text()).toContain('This job’s result has not been read back here'); expect(text()).toContain('Stored result: Process only'); expect(text()).not.toContain('New result stored and read back.');
  });
  it.each(['interrupted', 'failed'] as const)('shows exact %s reason and leaves retained measurements usable', async status => {
    readJob.mockResolvedValue({ status: 'ok', value: { job: job({ status, reason: 'The route replay is not available in this service yet.', finishedAt: '2026-11-16T19:01:00Z' }), reruns: true } }); await render();
    expect(text()).toContain('The route replay is not available in this service yet.'); expect(text()).toContain('No result was stored.'); expect(text()).toContain('1189'); expect(text()).not.toContain('New result stored and read back.');
  });
  it.each([['points', '1.2', { value: 1.2, basis: 'Changed basis' }], ['hold-sweep', '900,7200', { values: [900, 7200], basis: 'Changed basis' }], ['order-mix', '3 Series=2\nX1=1', { value: [{ modelLine: '3 Series', weight: 2 }, { modelLine: 'X1', weight: 1 }], basis: 'Changed basis' }]] as const)('submits %s values and basis as entered', async (id, values, change) => {
    await render(); select(id); input('values', values); input('basis', 'Changed basis'); await click('Start comparison'); expect(start.mock.calls[0][0]).toEqual({ experimentId: id, change, commandId: expect.any(String) });
  });
  it('rejects fractional seconds before sending and shows definitive server field reasons', async () => {
    await render(); select('hold-sweep'); input('values', '1.5'); input('basis', 'Basis'); await click('Start comparison'); expect(text()).toContain('whole-second'); expect(start).not.toHaveBeenCalled();
    input('values', '10'); start.mockResolvedValueOnce({ status: 'invalid', code: 'invalid-change', reason: 'Change refused', retryable: false, reasons: [{ field: 'change.values', reason: 'Must differ from current policy' }] }); await click('Start comparison'); expect(text()).toContain('Must differ from current policy'); expect(button('Retry same command')).toBeUndefined();
  });
  it('retries an uncertain start with the exact original input and command identity', async () => {
    await render(); select('points'); input('values', '1.3'); input('basis', 'Keep exact intent'); start.mockRejectedValueOnce(new Error('network lost')); await click('Start comparison');
    const original = start.mock.calls[0][0]; expect(text()).toContain('Start is unconfirmed'); expect(root().querySelector<HTMLTextAreaElement>('#comparison-values')!.disabled).toBe(true); await click('Refresh'); await click('Retry same command'); expect(start.mock.calls[1][0]).toBe(original); expect(start.mock.calls[1][0]).toEqual(original);
  });
  it('retains form data across explicit same-account auth refresh without replaying a command', async () => {
    await render(); select('points'); input('values', '1.3'); input('basis', 'Keep draft'); authState.set({ status: 'loading' }); fixture!.detectChanges(); authState.set(session()); fixture!.detectChanges(); await settle(); expect(root().querySelector<HTMLTextAreaElement>('#comparison-values')!.value).toBe('1.3'); expect(root().querySelector<HTMLTextAreaElement>('#comparison-basis')!.value).toBe('Keep draft'); expect(start).not.toHaveBeenCalled();
  });
  it('hides old facts synchronously on role change and ignores a late start response', async () => {
    await render(); const late = deferred<Awaited<ReturnType<ComparisonClient['start']>>>(); start.mockReturnValueOnce(late.promise); button('Start comparison').click(); fixture!.detectChanges(); const oldSignal = start.mock.calls[0][1]!.signal!;
    authState.set(session(['presenter'])); expect(fixture!.componentInstance.selected()).toBeNull(); expect(fixture!.componentInstance.isGreg()).toBe(false); fixture!.detectChanges(); expect(oldSignal.aborted).toBe(true); await settle(); late.resolve({ status: 'pending', value: job({ jobId: 'old-private-job' }) }); await settle(); expect(text()).not.toContain('old-private-job'); expect(root().querySelector('.comparison-command')).toBeNull();
  });
  it('clears drafts on account or run changes', async () => {
    await render(); select('points'); input('values', '1.3'); input('basis', 'Old account draft'); authState.set(session(['greg'], 'greg-2', 'run-2')); fixture!.detectChanges(); await settle(); select('points'); expect(root().querySelector<HTMLTextAreaElement>('#comparison-values')!.value).toBe(''); expect(text()).not.toContain('Old account draft');
  });
  it('offers only explicit authentication recovery and never automatically starts', async () => {
    authState.set({ status: 'signed-out' }); await render(); await click('Sign in'); expect(signIn).toHaveBeenCalledWith('/gcsp/comparison'); expect(start).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  });
  it('inspects a conflict’s actual running job identity', async () => {
    await render(); start.mockResolvedValueOnce({ status: 'conflict', code: 'busy', reason: 'Already running', retryable: false, jobId: 'busy-2' }); readJob.mockResolvedValueOnce({ status: 'ok', value: { job: job({ jobId: 'busy-2' }), reruns: true } }); await click('Start comparison'); expect(readJob.mock.calls.at(-1)![0]?.jobId).toBe('busy-2'); expect(text()).toContain('busy-2');
  });
  it('uses native labelled fields, disclosure and button controls for keyboard access', async () => {
    await render(); const picker = root().querySelector<HTMLSelectElement>('#comparison-experiment')!; expect(root().querySelector('label[for="comparison-experiment"]')).not.toBeNull(); picker.focus(); expect(document.activeElement).toBe(picker); expect(button('Start comparison').type).toBe('button'); expect(root().querySelectorAll('summary').length).toBeGreaterThan(0); button('Start comparison').focus(); expect(document.activeElement).toBe(button('Start comparison'));
  });
  it('aborts pending reads on destroy and ignores their late data', async () => {
    const pending = deferred<ComparisonResponse<ComparisonCatalogue>>(); readResults.mockReturnValueOnce(pending.promise); fixture = TestBed.createComponent(ComparisonComponent); fixture.detectChanges(); const component = fixture.componentInstance; const signal = readResults.mock.calls[0][0]!.signal!; fixture.destroy(); fixture = undefined; expect(signal.aborted).toBe(true); pending.resolve(catalogue()); await Promise.resolve(); expect(component.selected()).toBeNull();
  });
  it('maps approved painted disclaimer wording while retaining technical limitations and original data', async () => {
    const stored = retained(); const raw = 'Underlying needs are synthetic latent inputs, not a real employee confirmation.';
    readResults.mockResolvedValue(catalogue({ ...stored, result: { ...stored.result, limitations: [raw, ...stored.result.limitations], assumptions: [{ ...stored.result.assumptions[0], basis: 'Assumed demo fairness: earlier renewal due.' }] } })); await render();
    expect(text()).toContain('Underlying needs are modelled inputs, not an employee confirmation.'); expect(text()).toContain('the ordering handoff is not replayed.'); expect(text()).toContain('Assumed fairness: earlier renewal due.'); expect(text()).not.toContain('synthetic'); expect(text()).not.toContain('Assumed demo fairness'); expect(raw).toContain('synthetic');
  });
  it('keeps retained results available when job reads fail and requires explicit refresh', async () => {
    readJob.mockResolvedValue({ status: 'unavailable', code: 'jobs-offline', reason: 'Job progress unavailable', retryable: true }); await render();
    expect(text()).toContain('1189'); expect(text()).toContain('Job progress unavailable'); expect(button('Start comparison').disabled).toBe(true); expect(button('Refresh').disabled).toBe(false);
  });
  it('pauses polling while hidden, aborts an in-flight poll and resumes only the named visible job', async () => {
    let hidden = false; vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden); await render(); vi.useFakeTimers(); await click('Start comparison');
    const pending = deferred<Awaited<ReturnType<ComparisonClient['readJob']>>>(); readJob.mockReturnValueOnce(pending.promise); await vi.advanceTimersByTimeAsync(2000); const signal = readJob.mock.calls.at(-1)![0]!.signal!;
    hidden = true; document.dispatchEvent(new Event('visibilitychange')); expect(signal.aborted).toBe(true); const calls = readJob.mock.calls.length; await vi.advanceTimersByTimeAsync(6000); expect(readJob).toHaveBeenCalledTimes(calls);
    pending.resolve({ status: 'ok', value: { job: job(), reruns: true } }); await Promise.resolve(); hidden = false; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(2000); expect(readJob).toHaveBeenCalledTimes(calls + 1); expect(readJob.mock.calls.at(-1)![0]?.jobId).toBe('job-1');
  });
  it('retains the uncertain command through same-account auth recovery without automatic resubmission', async () => {
    await render(); const pending = deferred<Awaited<ReturnType<ComparisonClient['start']>>>(); start.mockReturnValueOnce(pending.promise); button('Start comparison').click(); fixture!.detectChanges(); const original = start.mock.calls[0][0];
    authState.set({ status: 'loading' }); fixture!.detectChanges(); authState.set(session()); fixture!.detectChanges(); await settle(); expect(start).toHaveBeenCalledOnce(); expect(text()).toContain('Start is unconfirmed'); pending.resolve({ status: 'pending', value: job({ jobId: 'late-ignored' }) }); await settle(); expect(text()).not.toContain('late-ignored'); await click('Retry same command'); expect(start.mock.calls[1][0]).toBe(original);
  });
  it('cleans up the running-job poll timer on destroy', async () => {
    await render(); vi.useFakeTimers(); await click('Start comparison'); const calls = readJob.mock.calls.length; fixture!.destroy(); fixture = undefined; await vi.advanceTimersByTimeAsync(6000); expect(readJob).toHaveBeenCalledTimes(calls);
  });

});
