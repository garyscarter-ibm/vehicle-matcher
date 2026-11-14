import { latestOrder, orderVehicle } from '../account/account.preview';
import type { AccountOrder } from '../account/account.preview';
import type { EvidenceRecord } from '../account/account.types';
import type { EmployeeActionHints, LifecycleResult, OrderIdentity, OrderScope, OrderSelection, OrdersPage,
  OrdersProjection, OrdersProjectionInput, ProducerSection, ProviderEvidence } from './orders.types';

// Sources: Java ApprovalView/DocumentView/ReadModel/PlanView at worker 5f376dd.
// This pure join neither authenticates callers nor fetches, filters pages or infers provider outcomes.
const sameScope = (value: EvidenceRecord, scope: OrderScope): boolean =>
  (value['employeeId'] == null || value['employeeId'] === scope.employeeId)
  && (value['runId'] == null || value['runId'] === scope.runId);
const exact = (value: OrderIdentity, order: AccountOrder | null, scope: OrderScope): boolean =>
  !!order && value.orderUuid === order.orderUuid && value.employeeId === scope.employeeId && value.runId === scope.runId;
const readValue = <T>(result: LifecycleResult<T> | null | undefined): T | null =>
  result && (result.status === 'ok' || result.status === 'pending') ? result.value ?? null : null;

export function selectOrder(result: LifecycleResult<OrdersPage> | null, scope: OrderScope, orderUuid?: string): OrderSelection {
  const unresolved = (reason: string): OrderSelection => ({ state: 'unresolved', reason, complete: false, order: null });
  if (!result || result.status !== 'ok') return unresolved(result?.status ?? 'not-loaded');
  const page = result.value;
  // The existing account DTO permits absent metadata. Absence is not proof of a complete list.
  const complete = page.nextAfter === null && page.failedCount === 0 && page.failed?.length === 0;
  if (page.orders.some((order) => !sameScope(order, scope))) return unresolved('identity-mismatch');
  if (new Set(page.orders.map((order) => order.orderUuid)).size !== page.orders.length) return unresolved('ambiguous-order');
  if (orderUuid !== undefined) {
    const order = page.orders.find((row) => row.orderUuid === orderUuid) ?? null;
    return { state: order ? 'selected' : complete ? 'not-found' : 'unresolved',
      reason: order ? null : complete ? 'order-not-found' : 'incomplete-list', complete, order };
  }
  if (!complete) return unresolved('incomplete-list');
  const order = latestOrder(page.orders);
  return { state: order ? 'selected' : 'none', reason: null, complete, order };
}

function section<T extends OrderIdentity>(source: string, envelope: LifecycleResult<T> | null | undefined,
  order: AccountOrder | null, scope: OrderScope): ProducerSection<T> {
  const value = readValue(envelope);
  const matches = value && exact(value, order, scope);
  return { source, envelope: envelope ?? null,
    state: value && !matches ? 'identity-mismatch' : envelope?.status ?? 'not-loaded', value: matches ? value : null };
}
const providerAvailable = (provider: ProviderEvidence | undefined): boolean =>
  typeof provider?.mode === 'string' && !!provider.mode && provider.mode !== 'none';
const version = (value: number): boolean => Number.isInteger(value) && value >= 0;

export function projectOrders(input: OrdersProjectionInput): OrdersProjection {
  const selection = selectOrder(input.orders, input.scope, input.selectedOrderUuid);
  const order = selection.order;
  const stages = section('orders/progress', input.stages, order, input.scope);
  const appointment = section('appointments', input.appointment, order, input.scope);
  const returnPlan = section('return-plan', input.returnPlan, order, input.scope);
  const collection = readValue(input.documents);
  const matches = collection?.orders.filter((row) => row.orderUuid === order?.orderUuid) ?? [];
  const doc = matches.length === 1 && exact(matches[0], order, input.scope) ? matches[0] : null;
  const documents: OrdersProjection['documents'] = { source: 'documents', envelope: input.documents ?? null,
    state: collection ? doc ? input.documents!.status : matches.length ? 'identity-mismatch' : 'not-open'
      : input.documents?.status ?? 'not-loaded', value: doc };
  const snapshot = readValue(input.snapshot);
  const vehicle = order && snapshot && sameScope(snapshot, input.scope) ? orderVehicle(snapshot, order.orderUuid) : null;
  const a = appointment.value;
  const r = returnPlan.value;
  const canAct = input.employeeAuthority && selection.state === 'selected';
  const documentsOpen = canAct && documents.state === 'ok' && doc?.acknowledgementSupported
    && Number.isInteger(doc.documentsRevision) && doc.documentsRevision > 0;
  const appointmentOpen = canAct && appointment.state === 'ok' && a && a.owner === 'employee'
    && !a.pending && !a.blocked && version(a.version) && providerAvailable(a.provider);
  const returnOpen = canAct && returnPlan.state === 'ok' && r?.applicable && r.owner === 'employee'
    && !r.pending && !r.blocked && version(r.version) && providerAvailable(r.provider);
  const actions: EmployeeActionHints = {
    documentTaskIds: documentsOpen ? doc.tasks.filter((task) => task.actionable && task.status === 'waiting-for-employee'
      && doc.items.some((item) => item.itemId === task.itemId && item.owner === 'employee' && item.status === task.status))
      .map((task) => task.itemId) : [],
    appointment: {
      requestSlotIds: appointmentOpen && a.eligibility?.eligible === true && a.state === 'not-requested'
        ? a.offeredSlots.map((slot) => slot.slotId) : [],
      acceptProposalId: appointmentOpen && a.state === 'change-proposed' && a.proposedSlot && a.proposalId ? a.proposalId : null,
    },
    returnPlan: {
      choices: returnOpen && r.state === 'not-planned' ? r.choices.filter((choice) => choice.available)
        .map((choice) => ({ choiceId: choice.id, slotIds: (r.offeredSlots[choice.id] ?? []).map((slot) => slot.slotId) })) : [],
      acceptProposalId: returnOpen && r.appointment?.state === 'change-proposed' && r.proposedSlot && r.proposalId ? r.proposalId : null,
    },
  };
  // Only the supplied relationship says which car is current. Booking/outcome labels never manufacture one.
  const relationship = r?.relationship && exact(r.relationship, order, input.scope) ? r.relationship : null;
  return { orders: { source: 'orders/progress/all', envelope: input.orders }, selection, vehicle,
    snapshot: input.snapshot ?? null, stages, documents, appointment, returnPlan,
    relationship: { source: 'return-plan.relationship', value: relationship }, actions };
}
