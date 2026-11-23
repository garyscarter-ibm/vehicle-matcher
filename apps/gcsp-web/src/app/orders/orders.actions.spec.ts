import { describe, expect, it, vi } from 'vitest';
import { OrdersActions } from './orders.actions';
import { OrdersController, OrdersControllerState } from './orders.controller';
import type { OrdersCommandPort, OrdersCommandValue } from './orders.client';
import type { OrdersReadContext, OrdersReadPort } from './orders.read-port';
import type { LifecycleResult } from './orders.types';

const context = (): OrdersReadContext => ({ subject: 'subject', environmentId: 'dev', runId: 'run', employeeId: 'employee', employeeAuthority: true });
const identity = { orderUuid: 'order', employeeId: 'employee', runId: 'run' };
const slot = { slotId: 'offered', start: '2026-11-15T09:00:00Z' };
const ok = <T>(value: T): { status: 'ok'; value: T } => ({ status: 'ok', value });
async function setup(appointmentState = 'not-requested') {
  let ctx: OrdersReadContext | null = context();
  const reads: OrdersReadPort = {
    readOrders: async () => ok({ orders: [{ ...identity, entitlementSlotId: 'entitlement' }], failed: [], failedCount: 0, nextAfter: null, pageEvidence: [] }),
    readOrder: async () => ok({}), readStages: async () => ({ status: 'unavailable' }),
    readDocuments: async () => ok({ contractVersion: 'lifecycle.documents.v1', orders: [{ ...identity, contractVersion: 'lifecycle.documents.v1', documentsRevision: 3, acknowledgementSupported: true,
      items: [{ itemId: 'agreement', label: 'Agreement', kind: 'document', owner: 'employee', status: 'waiting-for-employee' }], tasks: [{ itemId: 'agreement', status: 'waiting-for-employee', actionable: true }],
      readiness: { ready: false, state: 'waiting', documentsComplete: false, vehicleReady: true, blocking: ['agreement'], failed: [] } }] }),
    readAppointment: async () => ok({ ...identity, contractVersion: 'lifecycle.appointments.v1', version: 2, state: appointmentState, booked: false,
      offeredSlots: [slot], owner: 'employee', provider: { mode: 'configured' }, eligibility: { eligible: true } }),
    readReturnPlan: async () => ok({ ...identity, contractVersion: 'lifecycle.return-plan.v1', version: 4, state: 'not-planned', applicable: true,
      scheduled: false, choices: [{ id: 'same-visit', available: true }], offeredSlots: { 'same-visit': [slot] }, owner: 'employee', provider: { mode: 'configured' } }),
  };
  const controller = new OrdersController(reads, () => ctx); await controller.load();
  let state = controller.state;
  const execute = vi.fn<OrdersCommandPort['execute']>(async () => ({ status: 'pending', operationId: 'operation', retryable: false }));
  const actions = new OrdersActions({ execute }, () => state, () => ctx, () => {}, () => 'command');
  return { actions, execute, controller, reads, setState: (s: OrdersControllerState) => { state = s; }, getState: () => state, setContext: (c: OrdersReadContext | null) => { ctx = c; } };
}
describe('reviewed employee lifecycle actions', () => {
  it('reviews a supplied no-show rebooking slot and sends it once with the observed version', async () => {
    const s = await setup('no-show');
    expect(s.actions.prepare({ kind: 'request-appointment', slotId: slot.slotId })).toBe(true);
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.actions.state.review?.command).toEqual({ kind: 'request-appointment', commandId: 'command', orderUuid: 'order', slotId: 'offered', expectedVersion: 2 });
    await s.actions.confirm(); await s.actions.confirm();
    expect(s.execute).toHaveBeenCalledOnce();
    expect(s.actions.state.result).toMatchObject({ status: 'pending', operationId: 'operation' });
    expect(s.actions.prepare({ kind: 'request-appointment', slotId: slot.slotId })).toBe(false);
  });
  it('prepares exact provider slot/version without writing until deliberate confirmation', async () => {
    const s = await setup(); expect(s.actions.prepare({ kind: 'request-appointment', slotId: slot.slotId })).toBe(true);
    expect(s.execute).not.toHaveBeenCalled(); expect(s.actions.state.review?.command).toEqual({ kind: 'request-appointment', commandId: 'command', orderUuid: 'order', slotId: 'offered', expectedVersion: 2 });
    await s.actions.confirm(); expect(s.execute).toHaveBeenCalledOnce(); expect(s.actions.state.result).toMatchObject({ status: 'pending', operationId: 'operation' });
  });
  it('rejects unoffered slots and unavailable return choices', async () => {
    const { actions, execute } = await setup(); expect(actions.prepare({ kind: 'request-appointment', slotId: 'made-up' })).toBe(false);
    expect(actions.prepare({ kind: 'request-return', choice: 'unavailable', slotId: slot.slotId })).toBe(false); expect(execute).not.toHaveBeenCalled();
  });
  it('uses document revision and acknowledgement wording', async () => {
    const { actions } = await setup(); expect(actions.prepare({ kind: 'acknowledge', itemId: 'agreement' })).toBe(true);
    expect(actions.state.review?.command).toMatchObject({ itemId: 'agreement', expectedDocumentsRevision: 3 }); expect(actions.state.review?.detail).toContain('not a signature');
    actions.cancel(); await actions.confirm(); expect(actions.state.result).toBeNull();
  });
  it('preserves the return choice, exact slot and version through confirmation', async () => {
    const { actions, execute } = await setup(); actions.prepare({ kind: 'request-return', choice: 'same-visit', slotId: slot.slotId }); await actions.confirm();
    expect(execute.mock.calls[0][0]).toMatchObject({ choice: 'same-visit', slotId: 'offered', expectedVersion: 4 });
  });
  it.each(['accept-appointment', 'accept-return'] as const)('accepts only the displayed %s proposal', async (kind) => {
    const s = await setup(); const p = s.getState().projection!;
    s.setState({ ...s.getState(), projection: { ...p,
      appointment: { ...p.appointment, value: { ...p.appointment.value!, proposedSlot: slot } }, returnPlan: { ...p.returnPlan, value: { ...p.returnPlan.value!, proposedSlot: slot } },
      actions: { ...p.actions, appointment: { requestSlotIds: [], acceptProposalId: 'handover-proposal' }, returnPlan: { choices: [], acceptProposalId: 'return-proposal' } } } });
    expect(s.actions.prepare({ kind })).toBe(true); await s.actions.confirm();
    expect(s.execute.mock.calls[0][0]).toMatchObject({ proposalId: kind === 'accept-return' ? 'return-proposal' : 'handover-proposal', expectedVersion: kind === 'accept-return' ? 4 : 2 });
  });
  it.each(['subject', 'runId', 'employeeId', 'environmentId', 'employeeAuthority'] as const)('rejects a reviewed command after %s changes', async (field) => {
    const s = await setup(); s.actions.prepare({ kind: 'request-appointment', slotId: slot.slotId });
    s.setContext({ ...context(), [field]: field === 'employeeAuthority' ? false : 'changed' }); await s.actions.confirm(); expect(s.execute).not.toHaveBeenCalled(); expect(s.actions.state.result?.status).toBe('stale-version');
  });
  it('requires review again after a same-order refresh', async () => {
    const s = await setup(); s.actions.prepare({ kind: 'request-appointment', slotId: slot.slotId }); await s.controller.refresh(); s.setState(s.controller.state);
    await s.actions.confirm(); expect(s.execute).not.toHaveBeenCalled(); expect(s.actions.state.result?.status).toBe('stale-version');
  });
  it('blocks double confirmation and repeat writes at the same observed revision, including after refresh', async () => {
    const s = await setup(); let resolve!: (r: LifecycleResult<OrdersCommandValue>) => void;
    s.execute.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    s.actions.prepare({ kind: 'request-appointment', slotId: slot.slotId }); const pending = s.actions.confirm(); await s.actions.confirm();
    expect(s.execute).toHaveBeenCalledOnce(); resolve({ status: 'uncertain', retryable: false }); await pending;
    s.actions.refreshing(); expect(s.actions.locked('appointment')).toBe(true); expect(s.actions.prepare({ kind: 'request-appointment', slotId: slot.slotId })).toBe(false);
    expect(s.actions.prepare({ kind: 'acknowledge', itemId: 'agreement' })).toBe(true);
  });
  it('drops a late command result and clears review on context notification/disposal', async () => {
    const s = await setup(); let resolve!: (r: LifecycleResult<OrdersCommandValue>) => void;
    s.execute.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; })); s.actions.prepare({ kind: 'request-appointment', slotId: slot.slotId });
    const pending = s.actions.confirm(); const signal = s.execute.mock.calls[0][1]?.signal; s.actions.contextChanged(); expect(signal?.aborted).toBe(true);
    resolve({ status: 'ok', value: {} as OrdersCommandValue }); await pending; expect(s.actions.state.result).toBeNull();
    s.actions.dispose(); expect(s.actions.prepare({ kind: 'acknowledge', itemId: 'agreement' })).toBe(false);
  });
});
