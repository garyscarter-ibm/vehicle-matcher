import type { AccountClient } from '../account/account.client';
import type { AccountRequestOptions } from '../account/account.types';
import type { DocumentsCollection, LifecycleResult, OrderAppointment, OrderReturnPlan, OrderStages } from './orders.types';

export type OrdersListReadResult = Awaited<ReturnType<AccountClient['readOrders']>>;
export type OrdersSnapshotReadResult = Awaited<ReturnType<AccountClient['readOrder']>>;

/** Supplied by the authenticated host, never derived from order/provider response fields. */
export interface OrdersReadContext {
  readonly subject: string;
  readonly environmentId: string;
  readonly runId: string;
  readonly employeeId: string;
  readonly employeeAuthority: boolean;
}

/**
 * The host binds all six reads to the same trusted context and supplies validated envelopes.
 * AccountClient owns complete-list pagination, snapshot transport, authentication and ownership.
 * Lifecycle transport must use the agreed shared facade; this port provides no default adapter.
 */
export interface OrdersReadPort extends Pick<AccountClient, 'readOrders' | 'readOrder'> {
  readStages(orderUuid: string, options?: AccountRequestOptions): Promise<LifecycleResult<OrderStages>>;
  readDocuments(options?: AccountRequestOptions): Promise<LifecycleResult<DocumentsCollection>>;
  readAppointment(orderUuid: string, options?: AccountRequestOptions): Promise<LifecycleResult<OrderAppointment>>;
  readReturnPlan(orderUuid: string, options?: AccountRequestOptions): Promise<LifecycleResult<OrderReturnPlan>>;
}
