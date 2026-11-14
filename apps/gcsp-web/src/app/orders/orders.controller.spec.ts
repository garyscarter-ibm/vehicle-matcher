import { describe, expect, it, vi } from 'vitest';
import type { AccountOrder, AccountOrdersCollection } from '../account/account.preview';
import { OrdersController } from './orders.controller';
import type { OrdersControllerState } from './orders.controller';
import type { OrdersListReadResult, OrdersReadContext, OrdersReadPort, OrdersSnapshotReadResult } from './orders.read-port';
import type { DocumentsCollection, LifecycleResult, OrderAppointment, OrderRelationship, OrderReturnPlan, OrderStages } from './orders.types';

const context = (): OrdersReadContext => ({ subject: 'employee-subject', environmentId: 'isolated-dev',
  runId: 'isolated-run', employeeId: 'employee-paula', employeeAuthority: true });
const identity = { orderUuid: 'order-2', employeeId: 'employee-paula', runId: 'isolated-run' };
const ok = <T>(value: T): { readonly status: 'ok'; readonly value: T } => ({ status: 'ok', value });
const order = (orderUuid = identity.orderUuid): AccountOrder => ({ ...identity, orderUuid, entitlementSlotId: 'slot-1',
  source: { receivedAt: '2026-11-14T08:00:00Z' } });
const collection = (orders: readonly AccountOrder[] = [order()]): AccountOrdersCollection => ({ orders,
  failed: [], failedCount: 0, nextAfter: null, pageEvidence: [
    { after: null, nextAfter: 'source-key', failedCount: 0 },
    { after: 'source-key', nextAfter: null, failedCount: 0 },
  ] });
const stages = (changes: Partial<OrderStages> = {}): OrderStages => ({ ...identity,
  contractVersion: 'lifecycle.stages.v1', schemaVersion: 1, stageList: ['selection received', 'HR'],
  stages: [{ stage: 'HR', state: 'waiting' }], currentStage: 'HR', outcome: 'in-progress',
  owner: 'hr', nextStep: 'Waiting for HR', ...changes });
const documents = (): DocumentsCollection => ({ contractVersion: 'lifecycle.documents.v1', orders: [{ ...identity,
  contractVersion: 'lifecycle.documents.v1', documentsRevision: 3, acknowledgementSupported: true,
  items: [{ itemId: 'licence', kind: 'document', owner: 'employee', status: 'waiting-for-employee' }],
  tasks: [{ itemId: 'licence', status: 'waiting-for-employee', actionable: true }],
  readiness: { ready: false, state: 'waiting', documentsComplete: false, vehicleReady: true, blocking: ['licence'], failed: [] },
}] });
const appointment = (changes: Partial<OrderAppointment> = {}): OrderAppointment => ({ ...identity,
  contractVersion: 'lifecycle.appointments.v1', version: 0, state: 'not-requested', booked: false,
  owner: 'employee', nextStep: 'Choose a handover slot', offeredSlots: [{ slotId: 'slot', start: '2026-11-15T09:00:00Z' }],
  eligibility: { eligible: true }, provider: { mode: 'synthetic' }, ...changes });
const relationship = (changes: Partial<OrderRelationship> = {}): OrderRelationship => ({ ...identity,
  contractVersion: 'lifecycle.current-car.v1', currentCar: { kind: 'contract', contractId: 'held-car' },
  oldCar: { contractId: 'held-car', status: 'held' }, newCar: { status: 'on-order', collectedAt: null }, ...changes });
const plan = (changes: Partial<OrderReturnPlan> = {}): OrderReturnPlan => ({ ...identity,
  contractVersion: 'lifecycle.return-plan.v1', version: 0, applicable: true, state: 'not-planned', scheduled: false,
  owner: 'employee', nextStep: 'Choose a return slot', choices: [], offeredSlots: {},
  provider: { mode: 'synthetic' }, relationship: relationship(), ...changes });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function port(overrides: Partial<OrdersReadPort> = {}) {
  return {
    readOrders: vi.fn<OrdersReadPort['readOrders']>(overrides.readOrders ?? (async () => ok(collection()))),
    readOrder: vi.fn<OrdersReadPort['readOrder']>(overrides.readOrder ?? (async () => ok({ selection: { orderUuid: identity.orderUuid } }))),
    readStages: vi.fn<OrdersReadPort['readStages']>(overrides.readStages ?? (async (orderUuid) => ok(stages({ orderUuid })))),
    readDocuments: vi.fn<OrdersReadPort['readDocuments']>(overrides.readDocuments ?? (async () => ok(documents()))),
    readAppointment: vi.fn<OrdersReadPort['readAppointment']>(overrides.readAppointment ?? (async (orderUuid) => ok(appointment({ orderUuid })))),
    readReturnPlan: vi.fn<OrdersReadPort['readReturnPlan']>(overrides.readReturnPlan ?? (async (orderUuid) => ok(plan({ orderUuid })))),
  };
}

function setup(reads = port(), initial: OrdersReadContext | null = context()) {
  let current = initial;
  const changes: OrdersControllerState[] = [];
  const controller = new OrdersController(reads, () => current, (state) => changes.push(state));
  return { reads, controller, changes, setContext: (value: OrdersReadContext | null) => { current = value; } };
}

describe('injected read-only orders orchestration', () => {
  it('is idle until explicitly loaded and performs no reads without host context', async () => {
    const host = setup(port(), null);
    expect(host.controller.state.phase).toBe('inactive');
    expect(host.reads.readOrders).not.toHaveBeenCalled();
    await host.controller.load();
    expect(host.reads.readOrders).not.toHaveBeenCalled();
    expect(host.reads.readOrder).not.toHaveBeenCalled();
    host.setContext(context());
    expect(host.reads.readOrders).not.toHaveBeenCalled();
    await host.controller.load();
    expect(host.controller.state.projection?.selection.order?.orderUuid).toBe(identity.orderUuid);
  });

  it('calls the shared complete-list and snapshot methods once, retaining all page evidence and newest selection', async () => {
    const listed = ok(collection([order('order-1'), order('order-3'), order()]));
    const host = setup(port({ readOrders: async () => listed }));
    const loading = host.controller.load();
    expect(host.reads.readOrder).toHaveBeenCalledTimes(1);
    expect(host.reads.readOrders).toHaveBeenCalledTimes(1);
    expect(host.controller.state.phase).toBe('loading');
    await loading;
    const state = host.controller.state;
    expect(state.phase).toBe('settled');
    expect(state.orders).toBe(listed);
    expect(state.projection?.orders.envelope).toBe(listed);
    expect(state.projection?.selection).toMatchObject({ state: 'selected', complete: true, order: { orderUuid: 'order-3' } });
    expect(host.reads.readStages).toHaveBeenCalledWith('order-3', { signal: expect.any(AbortSignal) });
    expect(host.reads.readDocuments).toHaveBeenCalledTimes(1);
    expect(host.reads.readAppointment).toHaveBeenCalledWith('order-3', { signal: expect.any(AbortSignal) });
    expect(host.reads.readReturnPlan).toHaveBeenCalledWith('order-3', { signal: expect.any(AbortSignal) });
  });

  it('loads the requested owned order and never displays another order snapshot as its car', async () => {
    const host = setup(port({ readOrders: async () => ok(collection([order('order-1'), order()])),
      readOrder: async () => ok({ selection: { stock: { orderUuid: identity.orderUuid, facts: { display: { name: 'Other car' } } } } }) }));
    await host.controller.load('order-1');
    expect(host.controller.state.projection?.selection.order?.orderUuid).toBe('order-1');
    expect(host.controller.state.projection?.vehicle).toBeNull();
    expect(host.reads.readStages.mock.calls[0]?.[0]).toBe('order-1');
  });

  it.each(['unavailable', 'pending', 'forbidden'] as const)('retains a %s aggregate and partial evidence without starting lifecycle reads', async (status) => {
    const result: OrdersListReadResult = { status, code: 'source-not-complete', retryable: false,
      partial: collection(), failedAfter: 'later-key', operationId: 'list-operation', value: collection() };
    const host = setup(port({ readOrders: async () => result }));
    await host.controller.load(identity.orderUuid);
    expect(host.controller.state.orders).toBe(result);
    expect(host.controller.state.projection?.selection.state).toBe('unresolved');
    expect(host.controller.state.projection?.orders.envelope).toMatchObject({ status, partial: result.partial,
      failedAfter: 'later-key', operationId: 'list-operation' });
    expect(host.reads.readStages).not.toHaveBeenCalled();
    expect(host.reads.readDocuments).not.toHaveBeenCalled();
    expect(host.reads.readAppointment).not.toHaveBeenCalled();
    expect(host.reads.readReturnPlan).not.toHaveBeenCalled();
  });

  it('does not automatically select from an incomplete successful list supplied by a port', async () => {
    const result = ok({ ...collection(), nextAfter: 'still-incomplete' });
    const host = setup(port({ readOrders: async () => result }));
    await host.controller.load();
    expect(host.controller.state.orders).toBe(result);
    expect(host.controller.state.projection?.selection.reason).toBe('incomplete-list');
    expect(host.reads.readStages).not.toHaveBeenCalled();
  });

  it.each([
    { orders: [], requested: undefined, selected: 'none' },
    { orders: [order()], requested: 'missing-order', selected: 'not-found' },
  ])('preserves proven $selected separately from unavailable data', async ({ orders, requested, selected }) => {
    const host = setup(port({ readOrders: async () => ok(collection(orders)) }));
    await host.controller.load(requested);
    expect(host.controller.state.projection?.selection.state).toBe(selected);
    expect(host.controller.state.phase).toBe('settled');
    expect(host.reads.readStages).not.toHaveBeenCalled();
    expect(host.reads.readDocuments).not.toHaveBeenCalled();
  });

  const snapshots: readonly { label: string; result: OrdersSnapshotReadResult; vehicle: string | null }[] = [
    { label: 'flat', result: ok({ selection: { orderUuid: identity.orderUuid } }), vehicle: null },
    { label: 'nested', result: ok({ selection: { stock: { orderUuid: identity.orderUuid,
      facts: { display: { name: 'Supplied car' } } } } }), vehicle: 'Supplied car' },
    { label: 'absent', result: { status: 'not-found', code: 'selection-not-found' }, vehicle: null },
    { label: 'pending-data', result: { status: 'pending', httpStatus: 202, operationId: 'snapshot-operation',
      value: { selection: { stock: { orderUuid: identity.orderUuid, facts: { display: { name: 'Supplied pending car' } } } } } }, vehicle: 'Supplied pending car' },
    { label: 'pending-null', result: { status: 'pending', httpStatus: 202, operationId: 'snapshot-operation', value: null }, vehicle: null },
    { label: 'pending-absent', result: { status: 'pending', httpStatus: 202, operationId: 'snapshot-operation' }, vehicle: null },
  ];
  it.each(snapshots)('preserves the raw $label snapshot without inventing display facts', async ({ result, vehicle }) => {
    const host = setup(port({ readOrder: async () => result }));
    await host.controller.load();
    expect(host.controller.state.snapshot).toBe(result);
    expect(host.controller.state.projection?.snapshot?.status).toBe(result.status);
    expect(host.controller.state.projection?.vehicle?.name ?? null).toBe(vehicle);
    if (result.status === 'pending') {
      expect(host.controller.state.projection?.snapshot).toMatchObject({ httpStatus: 202, operationId: 'snapshot-operation' });
      if (result['value'] == null) expect(host.controller.state.projection?.snapshot?.value).toBeUndefined();
    }
  });

  it('publishes independent producer failures and pending facts while another producer is still loading', async () => {
    const waiting = deferred<LifecycleResult<OrderStages>>();
    const refused: LifecycleResult<DocumentsCollection> = { status: 'refused', code: 'provider-refused', reason: 'Supplied reason' };
    const pending: LifecycleResult<OrderAppointment> = { status: 'pending', httpStatus: 202, operationId: 'appointment-operation',
      value: appointment({ pending: { step: 'request' } }) };
    const unsupported: LifecycleResult<OrderReturnPlan> = { status: 'unsupported', retryable: false, code: 'provider-not-supported' };
    const host = setup(port({ readStages: () => waiting.promise, readDocuments: async () => refused,
      readAppointment: async () => pending, readReturnPlan: async () => unsupported }));
    const loading = host.controller.load();
    await vi.waitFor(() => expect(host.controller.state.projection?.documents.envelope).toBe(refused));
    expect(host.controller.state.phase).toBe('loading');
    expect(host.controller.state.projection?.stages.state).toBe('not-loaded');
    expect(host.controller.state.projection?.appointment.envelope).toBe(pending);
    expect(host.controller.state.projection?.appointment.value).toBe(pending.value);
    expect(host.controller.state.projection?.returnPlan.envelope).toBe(unsupported);
    expect(host.controller.state.projection?.actions.appointment.requestSlotIds).toEqual([]);
    const supplied = ok(stages());
    waiting.resolve(supplied);
    await loading;
    expect(host.controller.state.projection?.stages.envelope).toBe(supplied);
    expect(host.controller.state.projection?.stages.value?.owner).toBe('hr');
    expect(host.controller.state.phase).toBe('settled');
  });

  it('uses the existing exact lifecycle joins for foreign employee, run and order evidence', async () => {
    const host = setup(port({ readStages: async () => ok(stages({ employeeId: 'someone-else' })),
      readAppointment: async () => ok(appointment({ runId: 'retired-run' })),
      readReturnPlan: async () => ok(plan({ orderUuid: 'another-order' })) }));
    await host.controller.load();
    const projected = host.controller.state.projection;
    expect([projected?.stages.state, projected?.appointment.state, projected?.returnPlan.state])
      .toEqual(['identity-mismatch', 'identity-mismatch', 'identity-mismatch']);
    expect(projected?.documents.value?.orderUuid).toBe(identity.orderUuid);
    expect(projected?.relationship.value).toBeNull();
  });

  it('turns only a rejected producer read into an unavailable section and preserves other results', async () => {
    const host = setup(port({ readDocuments: () => { throw new Error('private transport diagnostic'); },
      readAppointment: async () => { throw new Error('private transport diagnostic'); } }));
    await host.controller.load();
    expect(host.controller.state.projection?.documents.envelope).toEqual({ status: 'unavailable',
      code: 'orders-read-rejected', retryable: true, source: 'documents' });
    expect(host.controller.state.projection?.appointment.envelope).toEqual({ status: 'unavailable',
      code: 'orders-read-rejected', retryable: true, source: 'appointments' });
    expect(host.controller.state.projection?.stages.value?.owner).toBe('hr');
    expect(host.controller.state.projection?.returnPlan.value?.state).toBe('not-planned');
  });

  it('retains snapshot truth when the complete-list promise rejects', async () => {
    const supplied = ok({ selection: { orderUuid: identity.orderUuid } });
    const host = setup(port({ readOrders: async () => { throw new Error('unavailable'); }, readOrder: async () => supplied }));
    await host.controller.load();
    expect(host.controller.state.orders).toMatchObject({ status: 'unavailable', code: 'orders-read-rejected', source: 'orders/progress/all' });
    expect(host.controller.state.snapshot).toBe(supplied);
    expect(host.controller.state.projection?.selection.state).toBe('unresolved');
    expect(host.reads.readStages).not.toHaveBeenCalled();
  });

  it('aborts and settles an earlier order load even if its port ignores the signal', async () => {
    const oldList = deferred<OrdersListReadResult>();
    const oldSnapshot = deferred<OrdersSnapshotReadResult>();
    const reads = port();
    reads.readOrders.mockImplementationOnce(() => oldList.promise).mockResolvedValue(ok(collection([order('order-1'), order()])));
    reads.readOrder.mockImplementationOnce(() => oldSnapshot.promise);
    const host = setup(reads);
    const first = host.controller.load('order-1');
    const oldSignal = reads.readOrders.mock.calls[0]?.[0]?.signal;
    const second = host.controller.load(identity.orderUuid);
    await first;
    expect(oldSignal?.aborted).toBe(true);
    await second;
    const current = host.controller.state;
    const publications = host.changes.length;
    oldList.resolve(ok(collection([order('order-1')])));
    oldSnapshot.reject(new Error('late rejection'));
    await Promise.allSettled([oldList.promise, oldSnapshot.promise]);
    expect(host.controller.state).toBe(current);
    expect(host.changes).toHaveLength(publications);
    expect(reads.readStages.mock.calls.map(([id]) => id)).toEqual([identity.orderUuid]);
  });

  it('uses a new generation for a same-order refresh and drops late lifecycle success or rejection', async () => {
    const oldStages = deferred<LifecycleResult<OrderStages>>();
    const oldPlan = deferred<LifecycleResult<OrderReturnPlan>>();
    const reads = port();
    reads.readStages.mockImplementationOnce(() => oldStages.promise);
    reads.readReturnPlan.mockImplementationOnce(() => oldPlan.promise);
    const host = setup(reads);
    const first = host.controller.load(identity.orderUuid);
    await vi.waitFor(() => expect(reads.readStages).toHaveBeenCalledTimes(1));
    const oldSignal = reads.readStages.mock.calls[0]?.[1]?.signal;
    const second = host.controller.refresh();
    await first;
    await second;
    expect(oldSignal?.aborted).toBe(true);
    expect(reads.readStages).toHaveBeenCalledTimes(2);
    expect(host.controller.state.requestedOrderUuid).toBe(identity.orderUuid);
    const current = host.controller.state;
    oldStages.reject(new Error('late provider rejection'));
    oldPlan.resolve(ok(plan({ relationship: relationship({ currentCar: null }) })));
    await Promise.allSettled([oldStages.promise, oldPlan.promise]);
    expect(host.controller.state).toBe(current);
    expect(host.controller.state.projection?.relationship.value?.currentCar).toEqual({ kind: 'contract', contractId: 'held-car' });
  });

  it.each([
    { label: 'subject', changed: { subject: 'another-subject' } },
    { label: 'environment', changed: { environmentId: 'another-environment' } },
    { label: 'run', changed: { runId: 'another-run' } },
    { label: 'employee', changed: { employeeId: 'another-employee' } },
    { label: 'authority', changed: { employeeAuthority: false } },
  ])('clears all facts when a completion detects an unnotified $label change', async ({ changed }) => {
    const waiting = deferred<LifecycleResult<OrderStages>>();
    const host = setup(port({ readStages: () => waiting.promise }));
    const loading = host.controller.load();
    await vi.waitFor(() => expect(host.reads.readStages).toHaveBeenCalledOnce());
    expect(host.controller.state.orders).not.toBeNull();
    const signal = host.reads.readStages.mock.calls[0]?.[1]?.signal;
    host.setContext({ ...context(), ...changed });
    waiting.resolve(ok(stages()));
    await loading;
    expect(signal?.aborted).toBe(true);
    expect(host.controller.state).toEqual({ phase: 'inactive', context: null, requestedOrderUuid: undefined,
      orders: null, snapshot: null, projection: null });
  });

  it('captures primitive context identity even when the host mutates the same object', async () => {
    const mutable = { ...context() };
    const waiting = deferred<OrdersListReadResult>();
    const reads = port({ readOrders: () => waiting.promise });
    const controller = new OrdersController(reads, () => mutable);
    const loading = controller.load();
    mutable.employeeId = 'changed-in-place';
    waiting.resolve(ok(collection()));
    await loading;
    expect(controller.state.phase).toBe('inactive');
    expect(controller.state.projection).toBeNull();
    expect(reads.readStages).not.toHaveBeenCalled();
  });

  it('accepts equivalent scalar context copies and derives hints from host authority', async () => {
    const readonlyContext = { ...context(), employeeAuthority: false };
    const controller = new OrdersController(port(), () => ({ ...readonlyContext }));
    await controller.load();
    expect(controller.state.phase).toBe('settled');
    expect(controller.state.projection?.actions).toEqual({ documentTaskIds: [],
      appointment: { requestSlotIds: [], acceptProposalId: null }, returnPlan: { choices: [], acceptProposalId: null } });
    expect(controller.state.projection?.documents.value?.tasks[0].actionable).toBe(true);
  });

  it('contextChanged clears promptly and settles ignored requests without starting replacement reads', async () => {
    const waiting = deferred<OrdersListReadResult>();
    const host = setup(port({ readOrders: () => waiting.promise }));
    const loading = host.controller.load();
    host.setContext(null);
    host.controller.contextChanged();
    await loading;
    expect(host.reads.readOrders.mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
    expect(host.controller.state.phase).toBe('inactive');
    expect(host.controller.state.snapshot).toBeNull();
    expect(host.reads.readOrders).toHaveBeenCalledOnce();
    waiting.resolve(ok(collection()));
    await waiting.promise;
    expect(host.controller.state.projection).toBeNull();
    expect(host.reads.readStages).not.toHaveBeenCalled();
  });

  it('disposal settles outstanding work, drops late resolution/rejection and permanently prevents reads', async () => {
    const listed = deferred<OrdersListReadResult>();
    const snapshot = deferred<OrdersSnapshotReadResult>();
    const host = setup(port({ readOrders: () => listed.promise, readOrder: () => snapshot.promise }));
    const loading = host.controller.load();
    host.controller.dispose();
    await loading;
    const disposed = host.controller.state;
    listed.reject(new Error('late failure'));
    snapshot.resolve(ok({ selection: { orderUuid: identity.orderUuid } }));
    await Promise.allSettled([listed.promise, snapshot.promise]);
    host.controller.contextChanged();
    host.controller.dispose();
    await host.controller.load();
    await host.controller.refresh();
    expect(host.controller.state).toBe(disposed);
    expect(disposed).toEqual({ phase: 'disposed', context: null, requestedOrderUuid: undefined, orders: null, snapshot: null, projection: null });
    expect(host.reads.readOrders).toHaveBeenCalledOnce();
    expect(host.reads.readOrder).toHaveBeenCalledOnce();
    expect(host.reads.readStages).not.toHaveBeenCalled();
  });

  it('reconstructs the supplied current-car relationship on reload and never infers it from returned labels', async () => {
    const reads = port();
    reads.readReturnPlan.mockResolvedValueOnce(ok(plan({ state: 'scheduled', scheduled: true })))
      .mockResolvedValueOnce(ok(plan({ state: 'returned', relationship: relationship({
        currentCar: { kind: 'order', orderUuid: identity.orderUuid },
        changes: [{ event: 'handover-completed', at: '2026-11-14T10:00:00Z' }],
      }) })))
      .mockResolvedValueOnce(ok(plan({ state: 'returned', relationship: null })));
    const host = setup(reads);
    await host.controller.load();
    expect(host.controller.state.projection?.relationship.value?.currentCar).toEqual({ kind: 'contract', contractId: 'held-car' });
    await host.controller.refresh();
    expect(host.controller.state.projection?.relationship.value?.currentCar).toEqual({ kind: 'order', orderUuid: identity.orderUuid });
    await host.controller.refresh();
    expect(host.controller.state.projection?.returnPlan.value?.state).toBe('returned');
    expect(host.controller.state.projection?.relationship.value).toBeNull();
  });
});
