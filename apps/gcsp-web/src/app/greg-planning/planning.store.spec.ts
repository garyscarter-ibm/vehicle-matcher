import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { PlanningClient } from './planning.client';
import { ordersFixture } from './greg-orders.fixtures';
import { PlanningStore } from './planning.store';
import { PlanningResult, PlanValueDto, ProductionSubmissionDto, ProductionValueDto } from './planning.types';

const context: ApplicationContext = { subject: 'greg', environmentId: 'isolated', runId: 'run-1', policyVersion: 'p1', roles: ['greg'], capabilities: [] };
const pins = { policy: 'p1', forecast: 'f1', stock: 's1', supply: 'i1', cohort: 'c1', catalog: 'v1' };
function planValue(id = 'order-plan-1'): PlanValueDto {
  return { mode: 'current', preview: false, plan: { planId: id, runId: 'run-1', asOf: '2026-11-16T12:00:00Z', versions: pins,
    status: 'feasible', quantities: [{ derivativeId: 'd1', modelId: 'm1', quantity: 2 }], modelQuantities: [{ modelId: 'm1', quantity: 2 }], orderQuantity: 2,
    spendMinor: 6000000, currency: 'GBP', expectedAcceptableCoverage: { covered: 2, total: 2 }, unallocatedStockRisk: { quantity: 0, totalSupply: 2 },
    alternatives: [], policyProvenance: [{ key: 'orderPlan.budgetMinor', value: 7000000 }, { key: 'orderPlan.modelBounds', value: [{ modelId: 'm1', min: 0, max: 3 }] }] },
  presentation: { editableKeys: ['orderPlan.budgetMinor', 'orderPlan.modelBounds'], models: [{ modelId: 'm1', model: '3 Series' }] } };
}
const production = (): ProductionValueDto => ({ asOf: '2026-11-16T12:00:00Z', provider: {}, submissions: [], requests: [] });
const accepted = (): PlanningResult<ProductionSubmissionDto> => ({ status: 'ok', value: { submissionId: 'submission-1', planId: 'order-plan-1', message: 'Requested. Production has not confirmed any of this yet.', requests: [] } });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('route-scoped planning state', () => {
  const state = signal<SessionState>({ status: 'ready', context });
  const readPlan = vi.fn<PlanningClient['readPlan']>(); const previewPlan = vi.fn<PlanningClient['previewPlan']>();
  const readProduction = vi.fn<PlanningClient['readProduction']>(); const submit = vi.fn<PlanningClient['submit']>();
  const submitManual = vi.fn<PlanningClient['submitManual']>(); const queue = vi.fn<PlanningClient['queue']>();
  const signIn = vi.fn(); const retry = vi.fn(); let store: PlanningStore;
  beforeEach(async () => {
    submitManual.mockReset().mockResolvedValue(accepted()); queue.mockReset().mockResolvedValue({ status: 'ok', value: { requestId: 'request-1' } });
    state.set({ status: 'ready', context }); readPlan.mockReset().mockResolvedValue({ status: 'ok', value: planValue() });
    previewPlan.mockReset().mockResolvedValue({ status: 'ok', value: { ...planValue('preview-1'), mode: 'preview', preview: true, activePlan: planValue().plan } });
    readProduction.mockReset().mockResolvedValue({ status: 'ok', value: production() }); submit.mockReset().mockResolvedValue(accepted()); signIn.mockReset(); retry.mockReset();
    TestBed.configureTestingModule({ providers: [PlanningStore, { provide: AuthPort, useValue: { state, signIn, retry } },
      { provide: PlanningClient, useValue: { readPlan, previewPlan, readProduction, submit, submitManual, queue } }] });
    store = TestBed.inject(PlanningStore); TestBed.tick(); await vi.waitFor(() => expect(store.plan()?.planId).toBe('order-plan-1'));
  });
  it('pins manual requests to the actual tracking versions and retains uncertain input through refresh', async () => {
    readProduction.mockResolvedValue({ status: 'ok', value: ordersFixture() }); await store.refreshProduction();
    expect(store.orders()?.choices[0].model).toBe('3 Series Saloon');
    submitManual.mockResolvedValueOnce({ status: 'uncertain', reason: 'Result unknown.' });
    await store.requestCars('3 Series Saloon', '320i', '3');
    expect(submitManual).toHaveBeenCalledOnce();
    const original = submitManual.mock.calls[0][0];
    expect(original).toEqual({ commandId: expect.any(String), model: '3 Series Saloon', derivative: '320i', quantity: 3, expectedPolicyVersion: 'p1', expectedStockVersion: 's1' });
    expect(store.canRetryOrder()).toBe(true); await store.refreshProduction(); expect(submitManual).toHaveBeenCalledOnce();
    await store.retryOrder(); expect(submitManual.mock.calls[1][0]).toEqual(original); expect(store.canRetryOrder()).toBe(false);
  });
  it('retries only saved unqueued confirmation without a new Production request', async () => {
    const value = ordersFixture(); readProduction.mockResolvedValue({ status: 'ok', value: { ...value,
      requests: [{ ...value.requests[0], queuedQuantity: 0, supplies: [{ ...(value.requests[0]['supplies'] as Record<string, unknown>[])[0], queued: false }] }] } });
    await store.refreshProduction(); queue.mockResolvedValueOnce({ status: 'unavailable', reason: 'Queue unavailable.' });
    await store.retryReleaseQueue('request-1'); expect(queue).toHaveBeenCalledOnce(); const original = queue.mock.calls[0][0];
    await store.retryReleaseQueue('request-1'); expect(queue).toHaveBeenCalledTimes(2); expect(queue.mock.calls[1][0]).toEqual(original); expect(submitManual).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });
  it('clears manual intent and private order projections after another account signs in', async () => {
    readProduction.mockResolvedValue({ status: 'ok', value: ordersFixture() }); await store.refreshProduction();
    submitManual.mockResolvedValueOnce({ status: 'pending', reason: 'Pending.', operationId: 'operation-1' });
    await store.requestCars('3 Series Saloon', '320i', '1'); expect(store.canRetryOrder()).toBe(true);
    state.set({ status: 'ready', context: { ...context, subject: 'other' } }); TestBed.tick();
    expect(store.canRetryOrder()).toBe(false); expect(store.orderOutcome()).toBeNull();
    await store.retryOrder(); expect(submitManual).toHaveBeenCalledOnce();
  });
  it('ignores a late manual acknowledgement after the signed-in account changes', async () => {
    readProduction.mockResolvedValue({ status: 'ok', value: ordersFixture() }); await store.refreshProduction();
    const gate = deferred<PlanningResult<ProductionSubmissionDto>>(); submitManual.mockReturnValueOnce(gate.promise);
    const pending = store.requestCars('3 Series Saloon', '320i', '1');
    state.set({ status: 'ready', context: { ...context, subject: 'other' } }); TestBed.tick();
    gate.resolve(accepted()); await pending; expect(store.orderOutcome()).toBeNull(); expect(store.canRetryOrder()).toBe(false);
    expect(submitManual).toHaveBeenCalledOnce();
  });
  it('retries a lost queue acknowledgement with the same identity after refreshed supply is already queued', async () => {
    const value = ordersFixture(); const unqueued = { ...value, requests: [{ ...value.requests[0], queuedQuantity: 0,
      supplies: [{ ...(value.requests[0]['supplies'] as Record<string, unknown>[])[0], queued: false }] }] };
    readProduction.mockResolvedValueOnce({ status: 'ok', value: unqueued }); await store.refreshProduction();
    queue.mockResolvedValueOnce({ status: 'uncertain', reason: 'Reply lost.' });
    await store.retryReleaseQueue('request-1'); const original = queue.mock.calls[0][0];
    readProduction.mockResolvedValue({ status: 'ok', value }); await store.refreshProduction();
    expect(store.orders()?.requests[0].supplies.every(s => s.queued)).toBe(true); expect(store.canRetryOrder()).toBe(true); expect(store.canRequestCars()).toBe(false);
    await store.retryOrder(); expect(queue.mock.calls[1][0]).toEqual(original); expect(store.canRetryOrder()).toBe(false); expect(store.canRequestCars()).toBe(true);
    await store.refresh(); expect(store.canSubmit()).toBe(true);
  });
  it('loads current inputs and Production without sending a command', () => {
    expect(store.canSubmit()).toBe(true); expect(store.production()?.requests).toEqual([]); expect(submit).not.toHaveBeenCalled();
  });
  it('invalidates submission immediately after edits and sends only changed groups to preview', async () => {
    store.edit('orderPlan.budgetMinor', '6500000'); expect(store.stale()).toBe(true); expect(store.canSubmit()).toBe(false);
    await store.preview(); expect(previewPlan).toHaveBeenCalledWith([{ key: 'orderPlan.budgetMinor', value: 6500000 }], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(store.plan()?.preview).toBe(true); expect(store.canSubmit()).toBe(false); expect(submit).not.toHaveBeenCalled();
  });
  it('validates whole-number bounds and keeps all active identities in edited groups', async () => {
    store.edit('orderPlan.modelBounds', '4', 'm1', 'min'); expect(store.editorErrors().length).toBe(1); await store.preview(); expect(previewPlan).not.toHaveBeenCalled();
    store.edit('orderPlan.modelBounds', '5', 'm1', 'max'); await store.preview();
    expect(previewPlan.mock.calls[0][0]).toEqual([{ key: 'orderPlan.modelBounds', value: [{ modelId: 'm1', min: 4, max: 5 }] }]);
  });
  it('keeps the active slider baseline while previewing an edited upper limit', async () => {
    const current = planValue(); const preview = { ...current, mode: 'preview' as const, preview: true, activePlan: current.plan,
      plan: { ...current.plan, policyProvenance: [{ key: 'orderPlan.modelBounds', value: [{ modelId: 'm1', min: 0, max: 8 }] }] } };
    previewPlan.mockResolvedValueOnce({ status: 'ok', value: preview });
    store.edit('orderPlan.modelBounds', '8', 'm1', 'max'); await store.preview();
    const editor = store.editorSource().find(e => e.key === 'orderPlan.modelBounds')!;
    expect(editor.rows[0].max).toBe(3); expect(store.value(editor, 'm1', 'max')).toBe('8');
  });
  it('returns to the current server plan and clears edited preview state explicitly', async () => {
    store.edit('orderPlan.budgetMinor', '0'); await store.preview(); await store.backToCurrent();
    expect(store.hasEdits()).toBe(false); expect(store.plan()?.preview).toBe(false); expect(store.canSubmit()).toBe(true);
  });
  it('aborts and ignores superseded preview responses, including a draft edited while preview was pending', async () => {
    const gate = deferred<PlanningResult<PlanValueDto>>(); previewPlan.mockReturnValueOnce(gate.promise);
    store.edit('orderPlan.budgetMinor', '0'); const old = store.preview(); const signal = previewPlan.mock.calls[0][1]?.signal;
    store.edit('orderPlan.budgetMinor', '10'); expect(signal?.aborted).toBe(true);
    gate.resolve({ status: 'ok', value: { ...planValue('old-preview'), mode: 'preview', preview: true, activePlan: planValue().plan } }); await old;
    expect(store.plan()?.planId).toBe('order-plan-1'); expect(store.stale()).toBe(true); expect(store.value(store.editorSource()[0])).toBe('10');
  });
  it('uses exact plan pins only on deliberate submit and does not call it twice while busy', async () => {
    const gate = deferred<PlanningResult<ProductionSubmissionDto>>(); submit.mockReturnValueOnce(gate.promise);
    const first = store.submit(); await store.submit(); expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0][0]).toEqual({ commandId: expect.any(String), planId: 'order-plan-1', versions: pins });
    gate.resolve(accepted()); await first; expect(store.stale()).toBe(true); expect(store.canSubmit()).toBe(false);
  });
  it('retains the same uncertain command and requires an explicit retry without treating pending as confirmed', async () => {
    submit.mockResolvedValueOnce({ status: 'pending', httpStatus: 202, operationId: 'operation-1', retryable: false });
    await store.submit(); const original = submit.mock.calls[0][0];
    expect(store.submission()?.status).toBe('pending'); expect(store.canRetrySubmission()).toBe(true); expect(submit).toHaveBeenCalledOnce();
    await store.refresh(); expect(submit).toHaveBeenCalledOnce(); await store.retrySubmission();
    expect(submit.mock.calls[1][0]).toEqual(original); expect(store.canRetrySubmission()).toBe(false);
  });
  it('preserves refusal and stale-input reasons and requires fresh planning before another request', async () => {
    submit.mockResolvedValueOnce({ status: 'conflict', code: 'replan-needed', reason: 'Stock changed.', changedInputs: ['stock'], httpStatus: 409, retryable: false });
    await store.submit(); expect(store.submission()).toEqual(expect.objectContaining({ status: 'conflict', reason: 'Stock changed.' }));
    expect(store.stale()).toBe(true); expect(store.canSubmit()).toBe(false); expect(store.canRetrySubmission()).toBe(false);
    await store.refresh(); expect(store.canSubmit()).toBe(true); expect(submit).toHaveBeenCalledOnce();
  });
  it('invalidates old plan authority when Production responses change and replans using fresh inputs', async () => {
    readProduction.mockResolvedValueOnce({ status: 'ok', value: { ...production(), submissions: [{ submissionId: 'submission-1', planId: 'order-plan-1', requestedAt: '2026-11-16T12:01:00Z' }] } });
    await store.refreshProduction(); expect(store.stale()).toBe(true); expect(store.canSubmit()).toBe(false);
    readPlan.mockResolvedValueOnce({ status: 'ok', value: planValue('order-plan-2') }); await store.refreshPlan();
    expect(store.plan()?.planId).toBe('order-plan-2'); expect(store.stale()).toBe(false);
  });
  it('recovers same-account edits through auth interruption without automatic submission', async () => {
    store.edit('orderPlan.budgetMinor', '6000001'); state.set({ status: 'loading' }); TestBed.tick(); expect(store.plan()).toBeNull();
    state.set({ status: 'ready', context }); TestBed.tick(); await vi.waitFor(() => expect(store.plan()).not.toBeNull());
    expect(store.value(store.editorSource()[0])).toBe('6000001'); expect(store.stale()).toBe(true); expect(submit).not.toHaveBeenCalled();
  });
  it('detaches a still-unresolved send on auth loss and resumes reads before deliberate same-command retry', async () => {
    const gate = deferred<PlanningResult<ProductionSubmissionDto>>(); submit.mockReturnValueOnce(gate.promise);
    const sending = store.submit(); const original = submit.mock.calls[0][0]; const signal = submit.mock.calls[0][1]?.signal;
    state.set({ status: 'loading' }); TestBed.tick(); expect(signal?.aborted).toBe(true); expect(store.submitting()).toBe(false);
    state.set({ status: 'ready', context }); TestBed.tick(); await vi.waitFor(() => expect(store.planBusy()).toBe(false));
    expect(submit).toHaveBeenCalledOnce(); expect(store.canRetrySubmission()).toBe(true);
    await store.retrySubmission(); expect(submit.mock.calls[1][0]).toEqual(original);
    gate.resolve({ status: 'pending', operationId: 'old-operation' }); await sending;
    expect(store.submission()?.status).toBe('ok');
  });
  it('clears private drafts and command intent on sign-out or a different account/run', async () => {
    store.edit('orderPlan.budgetMinor', '6000001'); submit.mockResolvedValueOnce({ status: 'uncertain' }); await store.backToCurrent(); await store.submit();
    expect(store.canRetrySubmission()).toBe(true); state.set({ status: 'signed-out' }); TestBed.tick();
    expect(store.plan()).toBeNull(); expect(store.submission()).toBeNull(); expect(store.hasEdits()).toBe(false);
    state.set({ status: 'ready', context: { ...context, subject: 'another-greg', runId: 'run-2' } }); TestBed.tick();
    await vi.waitFor(() => expect(store.planBusy()).toBe(false)); expect(store.canRetrySubmission()).toBe(false); expect(store.hasEdits()).toBe(false);
  });
  it('ignores late previous-run plan data even when its transport ignores abort', async () => {
    const gate = deferred<PlanningResult<PlanValueDto>>(); readPlan.mockReturnValueOnce(gate.promise); const old = store.refreshPlan();
    state.set({ status: 'ready', context: { ...context, runId: 'run-2' } }); TestBed.tick();
    gate.resolve({ status: 'ok', value: planValue('old-run') }); await old;
    expect(store.plan()?.planId).not.toBe('old-run'); expect(submit).not.toHaveBeenCalled();
  });
  it('invalidates a same-account policy change and routes authentication recovery only to the auth port', async () => {
    state.set({ status: 'ready', context: { ...context, policyVersion: 'p2' } }); TestBed.tick();
    expect(store.canSubmit()).toBe(false); await vi.waitFor(() => expect(store.planFailure()?.status).toBe('context-changed'));
    expect(store.canSubmit()).toBe(false);
    store.signIn(); store.recover(); expect(signIn).toHaveBeenCalledWith('/greg/plan'); expect(retry).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
  });
  it('does not let an older two-step refresh overwrite a newer intentional preview', async () => {
    const gate = deferred<PlanningResult<ProductionValueDto>>(); readProduction.mockReturnValueOnce(gate.promise);
    const oldRefresh = store.refresh(); store.edit('orderPlan.budgetMinor', '6000001'); await store.preview();
    expect(store.plan()?.planId).toBe('preview-1'); const reads = readPlan.mock.calls.length;
    gate.resolve({ status: 'ok', value: production() }); await oldRefresh;
    expect(store.plan()?.planId).toBe('preview-1'); expect(readPlan).toHaveBeenCalledTimes(reads);
  });
});
