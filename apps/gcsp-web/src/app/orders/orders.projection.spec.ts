import { describe, expect, it } from 'vitest';
import { projectOrders, selectOrder } from './orders.projection';
import type { DocumentsCollection, LifecycleResult, OrderAppointment, OrderDocuments, OrderRelationship,
  OrderReturnPlan, OrderStages, OrdersPage, OrdersProjectionInput } from './orders.types';

const scope = { employeeId: 'employee-paula', runId: 'isolated-run' };
const identity = { ...scope, orderUuid: 'order-2' };
const ok = <T>(value: T): LifecycleResult<T> => ({ status: 'ok', value });
const page = (changes: Partial<OrdersPage> = {}): OrdersPage => ({ orders: [{ ...identity, entitlementSlotId: 'slot-1',
  source: { receivedAt: '2026-11-14T08:00:00Z', orderNumber: 'supplied-number' } }], nextAfter: null, failed: [], failedCount: 0, ...changes });
const stages = (changes: Partial<OrderStages> = {}): OrderStages => ({ ...identity, contractVersion: 'lifecycle.stages.v1',
  schemaVersion: 1, stageList: ['selection received', 'HR'], stages: [{ stage: 'HR', state: 'waiting' }],
  currentStage: 'HR', outcome: 'in-progress', owner: 'hr', nextStep: 'Waiting for HR', ...changes });
const documents = (changes: Partial<OrderDocuments> = {}): OrderDocuments => ({ ...identity, contractVersion: 'lifecycle.documents.v1',
  documentsRevision: 3, acknowledgementSupported: true,
  items: [{ itemId: 'licence', kind: 'document', owner: 'employee', status: 'waiting-for-employee' }],
  tasks: [{ itemId: 'licence', status: 'waiting-for-employee', actionable: true }],
  readiness: { ready: false, state: 'waiting', documentsComplete: false, vehicleReady: true, blocking: ['licence'], failed: [] }, ...changes });
const docs = (value = documents()): LifecycleResult<DocumentsCollection> => ok({ contractVersion: 'lifecycle.documents.v1', orders: [value] });
const slot = { slotId: 'offered-slot', start: '2026-11-15T09:00:00Z' };
const appointment = (changes: Partial<OrderAppointment> = {}): OrderAppointment => ({ ...identity, contractVersion: 'lifecycle.appointments.v1',
  version: 0, state: 'not-requested', booked: false, owner: 'employee', nextStep: 'Choose a handover slot',
  offeredSlots: [slot], eligibility: { eligible: true }, provider: { mode: 'synthetic' }, ...changes });
const relationship = (changes: Partial<OrderRelationship> = {}): OrderRelationship => ({ ...identity, contractVersion: 'lifecycle.current-car.v1',
  currentCar: { kind: 'contract', contractId: 'old-car' }, oldCar: { contractId: 'old-car', status: 'held' },
  newCar: { status: 'on-order', collectedAt: null }, changes: [], ...changes });
const plan = (changes: Partial<OrderReturnPlan> = {}): OrderReturnPlan => ({ ...identity, contractVersion: 'lifecycle.return-plan.v1',
  version: 0, applicable: true, state: 'not-planned', scheduled: false, owner: 'employee', nextStep: 'Choose a return slot',
  choices: [{ id: 'same-visit', available: true }, { id: 'earlier', available: false, reason: 'Not offered' }],
  offeredSlots: { 'same-visit': [slot], earlier: [slot] }, provider: { mode: 'synthetic' }, relationship: relationship(), ...changes });
const input = (changes: Partial<OrdersProjectionInput> = {}): OrdersProjectionInput => ({ scope, employeeAuthority: true,
  orders: ok(page()), stages: ok(stages()), documents: docs(), appointment: ok(appointment()), returnPlan: ok(plan()), ...changes });

describe('pure owned order and Java lifecycle projection', () => {
  it('uses the existing newest-order tie break without mutating the page', () => {
    const first = page().orders[0];
    const orders = [first, { ...first, orderUuid: 'order-1' }, { ...first, orderUuid: 'order-3' }];
    expect(selectOrder(ok(page({ orders })), scope).order?.orderUuid).toBe('order-3');
    expect(orders.map((row) => row.orderUuid)).toEqual(['order-2', 'order-1', 'order-3']);
  });

  it.each([
    { orders: [], nextAfter: 'next-source-key' },
    { orders: page().orders, nextAfter: 'next-source-key' },
    { nextAfter: undefined },
    { failed: [{ orderUuid: 'failed-order', code: 'selection-source-invalid' }], failedCount: 1 },
    { failedCount: undefined },
  ])('keeps automatic newest/empty selection unresolved for incomplete evidence %j', (changes) => {
    expect(selectOrder(ok(page(changes)), scope)).toMatchObject({ state: 'unresolved', reason: 'incomplete-list', order: null });
  });

  it('distinguishes proven empty, exact missing and an exact owned row on an incomplete page', () => {
    expect(selectOrder(ok(page({ orders: [] })), scope).state).toBe('none');
    expect(selectOrder(ok(page()), scope, 'absent').state).toBe('not-found');
    expect(selectOrder(ok(page({ nextAfter: 'next' })), scope, 'absent').state).toBe('unresolved');
    expect(selectOrder(ok(page({ nextAfter: 'next' })), scope, identity.orderUuid))
      .toMatchObject({ state: 'selected', complete: false, order: identity });
  });

  it('does not reinterpret a failed/pending list or inconsistent identities as an empty owned list', () => {
    for (const status of ['forbidden', 'unavailable', 'pending'] as const) {
      expect(selectOrder({ status, value: page({ orders: [] }), operationId: 'kept' }, scope).state).toBe('unresolved');
    }
    expect(selectOrder(ok(page({ orders: [{ ...page().orders[0], employeeId: 'another' }] })), scope).reason).toBe('identity-mismatch');
    expect(selectOrder(ok(page({ orders: [page().orders[0], page().orders[0]] })), scope).reason).toBe('ambiguous-order');
  });

  it('joins only the exact selected car and preserves absent display facts', () => {
    const snapshot = ok({ selection: { stock: { orderUuid: identity.orderUuid, facts: { display: { name: 'Supplied BMW', photo: '/car.png' } } } } });
    expect(projectOrders(input({ snapshot })).vehicle).toEqual({ name: 'Supplied BMW', photo: '/car.png' });
    expect(projectOrders(input({ snapshot: ok({ selection: { stock: { orderUuid: 'another-order', facts: { display: { name: 'Other car' } } } } }) })).vehicle).toBeNull();
    expect(projectOrders(input({ snapshot: ok({ selection: { stock: { orderUuid: identity.orderUuid } } }) })).vehicle).toBeNull();
    expect(projectOrders(input({ snapshot: ok({ selection: { orderUuid: identity.orderUuid } }) })).vehicle).toBeNull();
    expect(projectOrders(input({ snapshot: ok({ ...snapshot.value!, runId: 'another-run' }) })).vehicle).toBeNull();
  });

  it('keeps stage order, owner, next-step and producer provenance without deriving approval commands', () => {
    const producer = ok(stages({ blocked: { code: 'unsupported', reason: 'Provider cannot update HR' } }));
    const result = projectOrders(input({ stages: producer }));
    expect(result.stages).toEqual({ source: 'orders/progress', envelope: producer, state: 'ok', value: producer.value });
    expect(result.stages.value?.stageList).toEqual(['selection received', 'HR']);
    expect(result.stages.value).toMatchObject({ owner: 'hr', nextStep: 'Waiting for HR', blocked: { code: 'unsupported' } });
    expect(Object.keys(result.actions)).toEqual(['documentTaskIds', 'appointment', 'returnPlan']);
  });

  it('isolates section failure and retains 202 value/operation evidence without enabling a pending action', () => {
    const pending: LifecycleResult<OrderAppointment> = { status: 'pending', httpStatus: 202, operationId: 'same-operation', value: appointment() };
    const failure = { status: 'unavailable' as const, code: 'documents-not-configured', retryable: true };
    const result = projectOrders(input({ documents: failure, appointment: pending }));
    expect(result.documents).toMatchObject({ source: 'documents', envelope: failure, state: 'unavailable', value: null });
    expect(result.stages.value).toEqual(stages());
    expect(result.returnPlan.value).toEqual(plan());
    expect(result.appointment.envelope).toBe(pending);
    expect(result.appointment.value).toEqual(appointment());
    expect(result.actions.appointment).toEqual({ requestSlotIds: [], acceptProposalId: null });
  });

  it.each(['refused', 'unsupported'] as const)('keeps %s separate from success and other producer facts', (status) => {
    const result = projectOrders(input({ appointment: { status, code: 'provider-reason', value: appointment() } }));
    expect(result.appointment.state).toBe(status);
    expect(result.appointment.envelope).toMatchObject({ status, code: 'provider-reason' });
    expect(result.appointment.value).toBeNull();
    expect(result.documents.value?.readiness.ready).toBe(false);
    expect(result.actions.appointment.requestSlotIds).toEqual([]);
  });

  it('rejects cross-order/run/employee section joins without hiding an independently correct section', () => {
    const result = projectOrders(input({ stages: ok(stages({ orderUuid: 'foreign' })),
      appointment: ok(appointment({ runId: 'retired' })), documents: docs(documents({ employeeId: 'another' })),
      returnPlan: ok(plan({ relationship: relationship({ orderUuid: 'foreign' }) })) }));
    expect([result.stages.state, result.appointment.state, result.documents.state]).toEqual(Array(3).fill('identity-mismatch'));
    expect(result.returnPlan.value?.orderUuid).toBe(identity.orderUuid);
    expect(result.relationship.value).toBeNull();
    expect(result.actions.documentTaskIds).toEqual([]);
  });

  it('requires provider support, employee authority and matching actionable employee items for task hints', () => {
    expect(projectOrders(input()).actions.documentTaskIds).toEqual(['licence']);
    for (const value of [documents({ acknowledgementSupported: false }), documents({ documentsRevision: 0 }),
      documents({ tasks: [{ itemId: 'licence', status: 'waiting-for-employee', actionable: false }] }),
      documents({ items: [{ itemId: 'licence', kind: 'document', owner: 'retailer', status: 'waiting-for-employee' }] }),
      documents({ tasks: [{ itemId: 'licence', status: 'complete', actionable: true }] })]) {
      expect(projectOrders(input({ documents: docs(value) })).actions.documentTaskIds).toEqual([]);
    }
    const readonly = projectOrders(input({ employeeAuthority: false })).actions;
    expect(readonly).toEqual({ documentTaskIds: [], appointment: { requestSlotIds: [], acceptProposalId: null },
      returnPlan: { choices: [], acceptProposalId: null } });
  });

  it('uses supplied eligible slots/proposals and suppresses unsupported, blocked and terminal appointment actions', () => {
    expect(projectOrders(input()).actions.appointment.requestSlotIds).toEqual(['offered-slot']);
    expect(projectOrders(input({ appointment: ok(appointment({ state: 'change-proposed', proposalId: 'proposal', proposedSlot: slot })) }))
      .actions.appointment).toEqual({ requestSlotIds: [], acceptProposalId: 'proposal' });
    for (const changes of [{ provider: { mode: 'none' } }, { pending: { step: 'request' } },
      { blocked: { code: 'unsupported' } }, { eligibility: { eligible: false } }, { version: -1 },
      { owner: 'retailer' }, { state: 'scheduled', booked: true }, { state: 'completed' }, { state: 'no-show' }]) {
      expect(projectOrders(input({ appointment: ok(appointment(changes)) })).actions.appointment.requestSlotIds).toEqual([]);
    }
    expect(projectOrders(input({ appointment: ok(appointment({ state: 'change-proposed', proposalId: 'proposal' })) }))
      .actions.appointment.acceptProposalId).toBeNull();
  });

  it('returns only provider-offered return choices and exact proposal hints, with no physical completion action', () => {
    expect(projectOrders(input()).actions.returnPlan).toEqual({ choices: [{ choiceId: 'same-visit', slotIds: ['offered-slot'] }], acceptProposalId: null });
    expect(projectOrders(input({ returnPlan: ok(plan({ state: 'return-requested', appointment: { state: 'change-proposed' },
      proposalId: 'return-proposal', proposedSlot: slot })) })).actions.returnPlan.acceptProposalId).toBe('return-proposal');
    for (const changes of [{ applicable: false }, { provider: { mode: 'none' } }, { pending: { step: 'outcome' } },
      { blocked: { code: 'refused' } }, { owner: 'scheme-team' }, { state: 'return-missed' }, { state: 'returned' }]) {
      expect(projectOrders(input({ returnPlan: ok(plan(changes)) })).actions.returnPlan.choices).toEqual([]);
    }
  });

  it('uses confirmed relationship facts only; planned or pending appointment labels cannot replace the current car', () => {
    for (const state of ['return-requested', 'return-scheduled', 'returned']) {
      const value = plan({ state, currentCar: { contractId: 'old-car-to-return' }, handover: { state: 'completed' } });
      expect(projectOrders(input({ returnPlan: ok(value) })).relationship.value?.currentCar)
        .toEqual({ kind: 'contract', contractId: 'old-car' });
    }
    const collected = relationship({ currentCar: { kind: 'order', orderUuid: identity.orderUuid, vin: 'supplied-vin' },
      newCar: { status: 'collected', collectedAt: '2026-11-15T09:30:00Z' }, changes: [{ type: 'handover-completed' }] });
    expect(projectOrders(input({ returnPlan: ok(plan({ relationship: collected })) })).relationship.value).toBe(collected);
    const returnedFirst = relationship({ currentCar: null, oldCar: { contractId: 'old-car', status: 'returned' }, changes: [{ type: 'return-confirmed' }] });
    expect(projectOrders(input({ returnPlan: ok(plan({ relationship: returnedFirst })) })).relationship.value?.currentCar).toBeNull();
    expect(projectOrders(input({ returnPlan: { status: 'pending', operationId: 'outcome-operation', value: plan() } })).relationship.value)
      .toEqual(relationship());
    expect(projectOrders(input({ returnPlan: { status: 'refused', value: plan({ relationship: collected }) } })).relationship.value).toBeNull();
    expect(projectOrders(input({ returnPlan: ok(plan({ relationship: undefined })) })).relationship.value).toBeNull();
  });
});
