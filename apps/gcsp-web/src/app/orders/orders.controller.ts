import { validOrderSnapshot } from '../account/account.preview';
import type { AccountOrderSnapshot } from '../account/account.preview';
import { projectOrders } from './orders.projection';
import type { OrdersListReadResult, OrdersReadContext, OrdersReadPort, OrdersSnapshotReadResult } from './orders.read-port';
import type { DocumentsCollection, LifecycleResult, OrderAppointment, OrderReturnPlan, OrderStages,
  OrdersPage, OrdersProjection } from './orders.types';

export interface OrdersControllerState {
  /** Settled means reads finished; each producer's own status still determines availability. */
  readonly phase: 'inactive' | 'loading' | 'settled' | 'disposed';
  readonly context: OrdersReadContext | null;
  readonly requestedOrderUuid: string | undefined;
  /** Original shared-client envelopes, including partial list and pending/null snapshot evidence. */
  readonly orders: OrdersListReadResult | null;
  readonly snapshot: OrdersSnapshotReadResult | null;
  readonly projection: OrdersProjection | null;
}

interface ReadGeneration {
  readonly context: OrdersReadContext;
  readonly requestedOrderUuid: string | undefined;
  readonly abort: AbortController;
  orders: OrdersListReadResult | null;
  snapshot: OrdersSnapshotReadResult | null;
  stages: LifecycleResult<OrderStages> | null;
  documents: LifecycleResult<DocumentsCollection> | null;
  appointment: LifecycleResult<OrderAppointment> | null;
  returnPlan: LifecycleResult<OrderReturnPlan> | null;
  settled: boolean;
}

const sameContext = (a: OrdersReadContext, b: OrdersReadContext | null): boolean => !!b
  && a.subject === b.subject && a.environmentId === b.environmentId && a.runId === b.runId
  && a.employeeId === b.employeeId && a.employeeAuthority === b.employeeAuthority;
const inactive = (phase: 'inactive' | 'disposed'): OrdersControllerState => ({ phase, context: null,
  requestedOrderUuid: undefined, orders: null, snapshot: null, projection: null });
const rejected = (source: string) => ({ status: 'unavailable' as const, code: 'orders-read-rejected', retryable: true, source });

function listForProjection(result: OrdersListReadResult | null): LifecycleResult<OrdersPage> | null {
  // A failed complete-list read stays failed. Its partial rows are never promoted to a successful list.
  return !result || result.status === 'ok' ? result : { ...result, value: undefined };
}

function snapshotForProjection(result: OrdersSnapshotReadResult | null): LifecycleResult<AccountOrderSnapshot> | null {
  if (!result || result.status === 'ok') return result;
  const value = result['value'];
  // The shared failure extension is unknown (including explicit null). Preserve it in state.snapshot;
  // the existing projector accepts only typed data, so absence of valid snapshot data stays absent there.
  return { ...result, value: validOrderSnapshot(value) ? value : undefined };
}

/** Read orchestration only. The host must notify contextChanged promptly on auth/account changes. */
export class OrdersController {
  private current: ReadGeneration | null = null;
  private disposed = false;
  private value: OrdersControllerState = inactive('inactive');

  constructor(private readonly port: OrdersReadPort,
    private readonly readContext: () => OrdersReadContext | null,
    private readonly onChange: (state: OrdersControllerState) => void = () => {}) {}

  get state(): OrdersControllerState { return this.value; }

  load(orderUuid?: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.cancelReads();
    const supplied = this.readContext();
    if (!supplied) { this.update(inactive('inactive')); return Promise.resolve(); }
    // Copy primitives: a host mutating the same context object cannot change this generation's identity.
    const context: OrdersReadContext = Object.freeze({ subject: supplied.subject, environmentId: supplied.environmentId,
      runId: supplied.runId, employeeId: supplied.employeeId, employeeAuthority: supplied.employeeAuthority });
    const generation: ReadGeneration = { context, requestedOrderUuid: orderUuid, abort: new AbortController(),
      orders: null, snapshot: null, stages: null, documents: null, appointment: null, returnPlan: null, settled: false };
    this.current = generation;
    this.publish(generation);
    return this.readOrder(generation);
  }

  refresh(): Promise<void> { return this.load(this.value.requestedOrderUuid); }

  contextChanged(): void {
    if (this.disposed) return;
    this.cancelReads();
    this.update(inactive('inactive'));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelReads();
    this.update(inactive('disposed'));
  }

  private cancelReads(): void {
    const previous = this.current;
    this.current = null;
    previous?.abort.abort();
  }

  private isCurrent(generation: ReadGeneration): boolean {
    // Object identity is the generation token, including a refresh of the same order/context.
    if (this.disposed || this.current !== generation || generation.abort.signal.aborted) return false;
    if (!sameContext(generation.context, this.readContext())) {
      this.contextChanged();
      return false;
    }
    return true;
  }

  private project(generation: ReadGeneration): OrdersProjection {
    return projectOrders({ scope: generation.context, employeeAuthority: generation.context.employeeAuthority,
      selectedOrderUuid: generation.requestedOrderUuid, orders: listForProjection(generation.orders),
      snapshot: snapshotForProjection(generation.snapshot), stages: generation.stages, documents: generation.documents,
      appointment: generation.appointment, returnPlan: generation.returnPlan });
  }

  private publish(generation: ReadGeneration): void {
    if (!this.isCurrent(generation)) return;
    this.update({ phase: generation.settled ? 'settled' : 'loading', context: generation.context,
      requestedOrderUuid: generation.requestedOrderUuid, orders: generation.orders, snapshot: generation.snapshot,
      projection: this.project(generation) });
  }

  private update(state: OrdersControllerState): void {
    this.value = state;
    this.onChange(state);
  }

  private async readOrder(generation: ReadGeneration): Promise<void> {
    const options = { signal: generation.abort.signal };
    await Promise.all([
      this.read<OrdersListReadResult>(generation, () => this.port.readOrders(options), rejected('orders/progress/all'), async (result) => {
        generation.orders = result;
        this.publish(generation);
        if (!this.isCurrent(generation)) return;
        const selected = this.project(generation).selection.order;
        if (selected) await this.readLifecycle(generation, selected.orderUuid);
      }),
      this.read<OrdersSnapshotReadResult>(generation, () => this.port.readOrder(options), rejected('order'), (result) => {
        generation.snapshot = result;
        this.publish(generation);
      }),
    ]);
    if (this.isCurrent(generation)) { generation.settled = true; this.publish(generation); }
  }

  private async readLifecycle(generation: ReadGeneration, orderUuid: string): Promise<void> {
    const options = { signal: generation.abort.signal };
    await Promise.all([
      this.read<LifecycleResult<OrderStages>>(generation, () => this.port.readStages(orderUuid, options), rejected('orders/progress'), (result) => {
        generation.stages = result;
        this.publish(generation);
      }),
      this.read<LifecycleResult<DocumentsCollection>>(generation, () => this.port.readDocuments(options), rejected('documents'), (result) => {
        generation.documents = result;
        this.publish(generation);
      }),
      this.read<LifecycleResult<OrderAppointment>>(generation, () => this.port.readAppointment(orderUuid, options), rejected('appointments'), (result) => {
        generation.appointment = result;
        this.publish(generation);
      }),
      this.read<LifecycleResult<OrderReturnPlan>>(generation, () => this.port.readReturnPlan(orderUuid, options), rejected('return-plan'), (result) => {
        generation.returnPlan = result;
        this.publish(generation);
      }),
    ]);
  }

  private async read<R>(generation: ReadGeneration, request: () => Promise<R>, failure: R,
    accept: (result: R) => void | Promise<void>): Promise<void> {
    if (!this.isCurrent(generation)) return;
    // Settle this controller's wait even when a port ignores cancellation. Both resolution and rejection
    // handlers remain attached to the original promise; late evidence cannot publish into another generation.
    const response = await new Promise<{ readonly result: R } | null>((resolve) => {
      const signal = generation.abort.signal;
      const abort = () => resolve(null);
      signal.addEventListener('abort', abort, { once: true });
      let pending: Promise<R>;
      try { pending = request(); } catch { pending = Promise.resolve(failure); }
      pending.then((result) => { signal.removeEventListener('abort', abort); resolve({ result }); },
        () => { signal.removeEventListener('abort', abort); resolve({ result: failure }); });
    });
    if (response && this.isCurrent(generation)) await accept(response.result);
  }
}
