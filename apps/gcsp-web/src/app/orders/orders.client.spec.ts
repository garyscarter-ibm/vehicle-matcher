import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountClient } from '../account/account.client';
import { AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { OrdersClient, OrdersCommand } from './orders.client';

const context = { subject: 'subject', employeeId: 'employee', environmentId: 'dev', runId: 'run', roles: ['employee'] as const, policyVersion: 'policy', capabilities: [] };
const identity = { orderUuid: 'order/?exact', employeeId: 'employee', runId: 'run' };
const slot = { slotId: 'provider-slot', start: '2026-11-15T09:00:00Z' };
const a = () => ({ ...identity, contractVersion: 'lifecycle.appointments.v1', state: 'not-requested', version: 2, booked: false,
  offeredSlots: [slot], owner: 'employee', eligibility: { eligible: true }, provider: { mode: 'configured' } });
const r = () => ({ ...identity, contractVersion: 'lifecycle.return-plan.v1', applicable: true, state: 'not-planned', version: 4,
  scheduled: false, choices: [{ id: 'same-visit', available: true }], offeredSlots: { 'same-visit': [slot] } });
const d = () => ({ ...identity, contractVersion: 'lifecycle.documents.v1', documentsRevision: 3, acknowledgementSupported: true,
  items: [{ itemId: 'agreement', kind: 'document', owner: 'employee', status: 'waiting-for-employee' }],
  tasks: [{ itemId: 'agreement', actionable: true, status: 'waiting-for-employee' }],
  readiness: { ready: false, state: 'waiting', documentsComplete: false, vehicleReady: true, blocking: ['agreement'], failed: [] } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (value: unknown) => json({ status: 'ok', value });
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };

describe('owned employee lifecycle transport', () => {
  let client: OrdersClient; let state: ReturnType<typeof signal<SessionState>>;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>; let token: ReturnType<typeof vi.fn>;
  let account: { readOrders: ReturnType<typeof vi.fn>; readOrder: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    state = signal<SessionState>({ status: 'ready', context }); fetcher = vi.fn<typeof fetch>(); token = vi.fn(async () => 'access-token');
    account = { readOrders: vi.fn(async () => ({ status: 'ok', value: { orders: [] } })), readOrder: vi.fn(async () => ({ status: 'not-found' })) };
    TestBed.configureTestingModule({ providers: [OrdersClient, { provide: AccountClient, useValue: account },
      { provide: AuthPort, useValue: { state, getAccessToken: token } }, { provide: PORTAL_FETCH, useValue: fetcher },
      { provide: RuntimeConfigService, useValue: { load: async () => ({ environmentId: 'dev', apiBaseUrl: 'https://api.test/api/gcsp/v1' }) } }] });
    client = TestBed.inject(OrdersClient);
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });
  it('delegates complete-list and snapshot exactly once with the original options and envelopes', async () => {
    const options = { signal: new AbortController().signal };
    expect(await client.readOrders(options)).toBe(await account.readOrders.mock.results[0].value);
    expect(await client.readOrder(options)).toBe(await account.readOrder.mock.results[0].value);
    expect(account.readOrders).toHaveBeenCalledExactlyOnceWith(options); expect(account.readOrder).toHaveBeenCalledExactlyOnceWith(options); expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses fixed bearer-only read endpoints with encoded exact order identity', async () => {
    const stages = { ...identity, contractVersion: 'lifecycle.stages.v1', schemaVersion: 1, stages: [], stageList: [], currentStage: null, outcome: 'pending' };
    fetcher.mockResolvedValueOnce(ok(stages)).mockResolvedValueOnce(ok({ contractVersion: 'lifecycle.documents.v1', orders: [d()] }))
      .mockResolvedValueOnce(ok(a())).mockResolvedValueOnce(ok(r()));
    for (const result of [await client.readStages(identity.orderUuid), await client.readDocuments(), await client.readAppointment(identity.orderUuid), await client.readReturnPlan(identity.orderUuid)]) expect(result.status).toBe('ok');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['orders/progress?orderUuid=order%2F%3Fexact', 'documents', 'appointments?orderUuid=order%2F%3Fexact', 'return-plan?orderUuid=order%2F%3Fexact'].map((p) => 'https://api.test/api/gcsp/v1/' + p));
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer access-token' } });
  });
  it.each(['presenter', 'greg', 'signed-out'])('requires an employee session for %s', async (role) => {
    state.set(role === 'signed-out' ? { status: 'signed-out' } : { status: 'ready', context: { ...context, roles: [role as 'greg' | 'presenter'] } });
    expect((await client.readAppointment(identity.orderUuid)).status).toBe('authentication-required'); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['employeeId', 'runId', 'environmentId', 'orderUuid'])('refuses foreign %s in a producer response', async (field) => {
    fetcher.mockResolvedValueOnce(ok({ ...a(), [field]: 'foreign' })); expect((await client.readAppointment(identity.orderUuid)).status).toBe('unavailable');
  });
  it('refuses presenter business commands even with an employee role also present', async () => {
    state.set({ status: 'ready', context: { ...context, roles: ['employee', 'presenter'] } });
    expect((await client.execute({ kind: 'acknowledge', commandId: 'command', orderUuid: identity.orderUuid, itemId: 'agreement', expectedDocumentsRevision: 3 })).status).toBe('authentication-required');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires deliberate sign-in after token renewal fails and sends no command', async () => {
    token.mockRejectedValueOnce(new Error('renewal unavailable'));
    expect((await client.execute({ kind: 'acknowledge', commandId: 'command', orderUuid: identity.orderUuid, itemId: 'agreement', expectedDocumentsRevision: 3 })).status).toBe('authentication-required');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects malformed actionable slots and nested foreign relationship facts', async () => {
    fetcher.mockResolvedValueOnce(ok({ ...a(), offeredSlots: [{ slotId: 'slot', start: 'unparseable' }] }));
    expect((await client.readAppointment(identity.orderUuid)).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(ok({ ...r(), relationship: { ...identity, contractVersion: 'lifecycle.current-car.v1', currentCar: { kind: 'contract', contractId: 'old', employeeId: 'foreign' } } }));
    expect((await client.readReturnPlan(identity.orderUuid)).status).toBe('unavailable');
  });
  it.each(['pending', 'unsupported', 'refused', 'conflict'])('preserves %s, typed pending value and operation evidence', async (status) => {
    const envelope = { status, code: 'provider-state', operationId: 'operation', retryable: false, value: status === 'pending' ? a() : null, reason: 'Provider answer' };
    fetcher.mockResolvedValueOnce(json(envelope, status === 'pending' ? 202 : status === 'conflict' ? 409 : 422));
    expect(await client.readAppointment(identity.orderUuid)).toMatchObject(envelope);
  });
  it('drops late responses when the same subject moves to another run', async () => {
    const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const pending = client.readAppointment(identity.orderUuid); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    state.set({ status: 'ready', context: { ...context, runId: 'new-run' } }); response.resolve(ok(a()));
    expect((await pending).status).toBe('account-changed');
  });
  it('never fetches after cancellation during token renewal and never automatically retries', async () => {
    const access = deferred<string>(); token.mockReturnValueOnce(access.promise); const abort = new AbortController();
    const pending = client.readAppointment(identity.orderUuid, { signal: abort.signal }); await vi.waitFor(() => expect(token).toHaveBeenCalled());
    abort.abort(); expect((await pending).status).toBe('aborted'); access.resolve('renewed'); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { kind: 'acknowledge', itemId: 'agreement', expectedDocumentsRevision: 3, path: 'documents/tasks/acknowledge' },
    { kind: 'request-appointment', slotId: slot.slotId, expectedVersion: 2, path: 'appointments/request' },
    { kind: 'accept-appointment', proposalId: 'proposal', expectedVersion: 2, path: 'appointments/accept' },
    { kind: 'request-return', choice: 'same-visit', slotId: slot.slotId, expectedVersion: 4, path: 'return-plan/request' },
    { kind: 'accept-return', proposalId: 'proposal', expectedVersion: 4, path: 'return-plan/accept' },
  ])('sends the exact versioned $kind command without caller authority or kind fields', async ({ path, ...action }) => {
    const command = { commandId: 'command', orderUuid: identity.orderUuid, ...action } as OrdersCommand;
    fetcher.mockResolvedValueOnce(ok(action.kind === 'acknowledge' ? { order: d() } : action.kind.includes('return') ? r() : a()));
    expect((await client.execute(command)).status).toBe('ok'); const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.test/api/gcsp/v1/' + path); const { kind, ...body } = command;
    expect(JSON.parse(options!.body as string)).toEqual(body); expect(options).toMatchObject({ method: 'POST', credentials: 'omit' });
  });
  it('rejects extra authority and stale/missing command versions before fetch', async () => {
    for (const input of [
      { kind: 'acknowledge', itemId: 'agreement', expectedDocumentsRevision: 0 },
      { kind: 'request-appointment', slotId: slot.slotId, expectedVersion: -1 },
      { kind: 'request-return', choice: 'same-visit', slotId: slot.slotId, expectedVersion: 4, employeeId: 'foreign' },
    ]) expect((await client.execute({ commandId: 'command', orderUuid: identity.orderUuid, ...input } as OrdersCommand)).status).toBe('invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports an interrupted sent command as uncertain without retrying', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('disconnected'));
    expect((await client.execute({ kind: 'request-appointment', commandId: 'command', orderUuid: identity.orderUuid, slotId: slot.slotId, expectedVersion: 2 })).status).toBe('uncertain');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('bounds ignored cancellation and marks a timed-out sent command uncertain', async () => {
    vi.useFakeTimers(); fetcher.mockReturnValueOnce(new Promise(() => {}));
    const pending = client.execute({ kind: 'request-appointment', commandId: 'command', orderUuid: identity.orderUuid, slotId: slot.slotId, expectedVersion: 2 });
    await vi.advanceTimersByTimeAsync(10000); expect((await pending).status).toBe('uncertain'); expect(fetcher).toHaveBeenCalledOnce();
  });
});
