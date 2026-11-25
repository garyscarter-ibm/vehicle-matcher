import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { PlanningClient } from './planning.client';
import { PlanChange, ProductionCommand } from './planning.types';

const context: ApplicationContext = { subject: 'greg', environmentId: 'isolated', runId: 'run-1', policyVersion: 'p1', roles: ['greg'], capabilities: [] };
const versions = { policy: 'p1', forecast: 'f1', stock: 's1', supply: 'i1', cohort: 'c1', catalog: 'v1' };
const command = (): ProductionCommand => ({ commandId: 'intent-1', planId: 'order-plan-1', versions });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const production = () => ({ asOf: '2026-11-16T12:00:00Z', provider: {}, submissions: [], requests: [] });
const submission = () => ({ submissionId: 'submission-1', planId: 'order-plan-1', message: 'Requested. Production has not confirmed any of this yet.', requests: [] });
function plan() { return { mode: 'current', preview: false, plan: { planId: 'order-plan-1', runId: 'run-1', asOf: '2026-11-16T12:00:00Z', versions,
  status: 'infeasible', quantities: [], conflicts: [] }, presentation: {} }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('Greg planning bearer transport', () => {
  const state = signal<SessionState>({ status: 'ready', context });
  const getAccessToken = vi.fn(async (): Promise<string | null> => 'access-token');
  const load = vi.fn(async () => ({ environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1' }));
  const fetcher = vi.fn<typeof fetch>(); let client: PlanningClient;
  beforeEach(() => {
    state.set({ status: 'ready', context }); getAccessToken.mockReset().mockResolvedValue('access-token');
    load.mockReset().mockResolvedValue({ environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1' }); fetcher.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state, getAccessToken } }, { provide: RuntimeConfigService, useValue: { load } }, { provide: PORTAL_FETCH, useValue: fetcher }] });
    client = TestBed.inject(PlanningClient);
  });
  afterEach(() => vi.useRealTimers());
  it('uses fixed v1 paths and bearer-only identity for read, preview, status and submission', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: plan() })).mockResolvedValueOnce(json({ status: 'ok', value: { ...plan(), mode: 'preview', preview: true, activePolicyVersion: 'p1', activePlan: plan().plan } }))
      .mockResolvedValueOnce(json({ status: 'ok', value: production() })).mockResolvedValueOnce(json({ status: 'ok', value: submission() }));
    await client.readPlan(); await client.previewPlan([{ key: 'orderPlan.budgetMinor', value: 0 }]); await client.readProduction(); await client.submit(command());
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['greg/order-plan', 'greg/order-plan/preview', 'greg/orders', 'greg/production/requests'].map(path => `https://api.example/api/gcsp/v1/${path}`));
    for (const [, options] of fetcher.mock.calls) expect(options).toEqual(expect.objectContaining({ credentials: 'omit', cache: 'no-store', redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer access-token' }) }));
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ changes: [{ key: 'orderPlan.budgetMinor', value: 0 }] });
    expect(JSON.parse(fetcher.mock.calls[3][1]?.body as string)).toEqual(command());
  });
  it('pins intentional manual requests and keeps release queue retries on Greg endpoints', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: submission() }))
      .mockResolvedValueOnce(json({ status: 'ok', value: { requestId: 'request-1', queued: [] } }));
    const manual = { commandId: 'manual-1', model: '3 Series', derivative: '320i', quantity: 2,
      expectedPolicyVersion: 'p1', expectedStockVersion: 's1' };
    expect((await client.submitManual(manual)).status).toBe('ok');
    expect((await client.queue({ commandId: 'queue-1', requestId: 'request-1' })).status).toBe('ok');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://api.example/api/gcsp/v1/greg/orders', 'https://api.example/api/gcsp/v1/greg/orders/queue']);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual(manual);
  });
  it('rejects injected manual identity and invalid quantities without sending', async () => {
    const manual = { commandId: 'manual-1', model: '3 Series', derivative: '320i', quantity: 2,
      expectedPolicyVersion: 'p1', expectedStockVersion: 's1' };
    for (const patch of [{ quantity: 0 }, { quantity: 1001 }, { quantity: 1.5 }, { runId: 'other' }]) {
      expect((await client.submitManual({ ...manual, ...patch })).status).toBe('invalid');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects command identity injection, changed keys and preview edits on submission before sending', async () => {
    for (const extra of [{ runId: 'other' }, { actorId: 'other' }, { changes: [] }, { versions: { policy: 4 } }]) {
      expect((await client.submit({ ...command(), ...extra } as unknown as ProductionCommand)).status).toBe('invalid');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects malformed, duplicate and unsupported edits without provider calls', async () => {
    for (const changes of [[], [{ key: 'orderPlan.horizonDays', value: 8 }], [{ key: 'orderPlan.budgetMinor', value: -1 }],
      [{ key: 'orderPlan.budgetMinor', value: 1 }, { key: 'orderPlan.budgetMinor', value: 2 }], [{ key: 'orderPlan.modelBounds', value: [{ modelId: 'm1', min: 4, max: 2 }] }]]) {
      expect((await client.previewPlan(changes as PlanChange[])).status).toBe('invalid');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves real 400/409/422/503 status, reason and changed-input evidence', async () => {
    for (const [http, status] of [[400, 'invalid'], [409, 'conflict'], [422, 'unsupported'], [503, 'unavailable']] as const) {
      fetcher.mockResolvedValueOnce(json({ status, code: 'source-code', reason: 'Source reason.', retryable: false, changedInputs: ['stock'], current: { versions: { stock: 's2' } }, limits: [{ field: 'candidatePlans' }] }, http));
      expect(await client.readPlan()).toEqual(expect.objectContaining({ status, httpStatus: http, reason: 'Source reason.', changedInputs: ['stock'], current: { versions: { stock: 's2' } }, details: expect.objectContaining({ limits: [{ field: 'candidatePlans' }] }) }));
    }
  });
  it('never promotes 202 responses with a value or operation-only result to success', async () => {
    for (const extra of [{ value: submission(), retryable: true }, { operationId: 'operation-1', retryable: false }]) {
      fetcher.mockResolvedValueOnce(json({ status: 'pending', code: 'outcome-uncertain', ...extra }, 202));
      expect(await client.submit(command())).toEqual(expect.objectContaining({ status: 'pending', httpStatus: 202, ...extra }));
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('maps expired and forbidden authentication even when their response bodies are unreadable', async () => {
    for (const [http, status] of [[401, 'authentication-required'], [403, 'forbidden']] as const) {
      fetcher.mockResolvedValueOnce(new Response('', { status: http })); expect(await client.readPlan()).toEqual(expect.objectContaining({ status, httpStatus: http }));
    }
  });
  it('refuses presenter-only identity and a deployment environment mismatch before fetch', async () => {
    state.set({ status: 'ready', context: { ...context, roles: ['presenter'] } }); expect((await client.readProduction()).status).toBe('authentication-required');
    state.set({ status: 'ready', context }); load.mockResolvedValueOnce({ environmentId: 'other', apiBaseUrl: 'https://api.example/api/gcsp/v1' });
    expect((await client.readPlan()).status).toBe('unavailable'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not send after identity changes while access-token acquisition is pending', async () => {
    const gate = deferred<string | null>(); getAccessToken.mockReturnValueOnce(gate.promise);
    const pending = client.readPlan(); await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalled());
    state.set({ status: 'ready', context: { ...context, subject: 'other' } }); gate.resolve('old-token');
    expect((await pending).status).toBe('context-changed'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('ignores a late old-account response and rejects mismatched plan run identity', async () => {
    const gate = deferred<Response>(); fetcher.mockReturnValueOnce(gate.promise); const pending = client.readPlan();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled()); state.set({ status: 'ready', context: { ...context, subject: 'other' } });
    gate.resolve(json({ status: 'ok', value: plan() })); expect((await pending).status).toBe('context-changed');
    state.set({ status: 'ready', context }); fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...plan(), plan: { ...plan().plan, runId: 'other' } } }));
    expect((await client.readPlan()).status).toBe('context-changed');
  });
  it('keeps lost or unreadable command results uncertain and never retries automatically', async () => {
    fetcher.mockRejectedValueOnce(new Error('private network detail')); expect((await client.submit(command())).status).toBe('uncertain');
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: {} })); expect((await client.submit(command())).status).toBe('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('refuses old current-policy pins and mismatched preview active-policy/run authority', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...plan(), plan: { ...plan().plan, versions: { ...versions, policy: 'old-policy' } } } }));
    expect((await client.readPlan()).status).toBe('context-changed');
    for (const patch of [{ activePolicyVersion: 'old-policy' }, { activePlan: { ...plan().plan, runId: 'old-run' } }, { activePlan: { ...plan().plan, versions: { ...versions, policy: 'old-policy' } } }]) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value: { ...plan(), mode: 'preview', preview: true, activePlan: plan().plan, activePolicyVersion: 'p1', ...patch } }));
      expect((await client.previewPlan([{ key: 'orderPlan.budgetMinor', value: 0 }])).status).toBe('context-changed');
    }
  });
  it('honours pre-abort and times out a non-settling submit without automatic replay', async () => {
    const controller = new AbortController(); controller.abort(); expect((await client.readPlan({ signal: controller.signal })).status).toBe('aborted'); expect(fetcher).not.toHaveBeenCalled();
    vi.useFakeTimers(); fetcher.mockImplementationOnce(() => new Promise(() => {})); const pending = client.submit(command());
    await vi.advanceTimersByTimeAsync(10001); expect((await pending).status).toBe('uncertain'); expect(fetcher).toHaveBeenCalledOnce();
  });
});
