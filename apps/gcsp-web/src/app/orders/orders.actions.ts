import type { OrdersCommand, OrdersCommandPort, OrdersCommandValue } from './orders.client';
import type { OrdersControllerState } from './orders.controller';
import type { OrdersReadContext } from './orders.read-port';
import type { LifecycleResult, OrdersProjection } from './orders.types';

export type OrderAction = { readonly kind: 'acknowledge'; readonly itemId: string }
  | { readonly kind: 'request-appointment'; readonly slotId: string }
  | { readonly kind: 'accept-appointment' }
  | { readonly kind: 'request-return'; readonly choice: string; readonly slotId: string }
  | { readonly kind: 'accept-return' };
export interface OrderActionReview { readonly title: string; readonly detail: string; readonly command: OrdersCommand }
export interface OrdersActionState { readonly review: OrderActionReview | null; readonly busy: boolean;
  readonly result: LifecycleResult<OrdersCommandValue> | null }
const initial = (): OrdersActionState => ({ review: null, busy: false, result: null });
const key = (c: OrdersReadContext): string => JSON.stringify([c.subject, c.environmentId, c.runId, c.employeeId, c.employeeAuthority]);
const time = (start: string): string => new Date(start).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

/** One reviewed employee command at a time. Refresh reads state; it never replays a write. */
export class OrdersActions {
  private value = initial();
  private reviewedProjection: OrdersProjection | null = null;
  private reviewedContext = '';
  private reviewedLock = '';
  private readonly sent = new Set<string>();
  private readonly noEffect = new Map<string, OrdersProjection>();
  private abort = new AbortController();
  private generation = 0;
  private disposed = false;
  constructor(private readonly port: OrdersCommandPort, private readonly read: () => OrdersControllerState,
    private readonly context: () => OrdersReadContext | null, private readonly changed: (state: OrdersActionState) => void = () => {},
    private readonly commandId: () => string = () => crypto.randomUUID()) {}
  get state(): OrdersActionState { return this.value; }
  locked(resource: 'documents' | 'appointment' | 'return'): boolean {
    const state = this.read(); const p = state.projection; const c = this.context();
    const version = resource === 'documents' ? p?.documents.value?.documentsRevision : resource === 'appointment' ? p?.appointment.value?.version : p?.returnPlan.value?.version;
    return !!c && this.isLocked(JSON.stringify([key(c), p?.selection.order?.orderUuid, resource, version]), state);
  }
  private isLocked(lock: string, state: OrdersControllerState): boolean {
    if (!this.sent.has(lock)) return false;
    const refusedAt = this.noEffect.get(lock); const p = state.projection; const c = this.context();
    // Only a new successful authoritative read can release this exact no-effect attempt.
    if (refusedAt && p && p !== refusedAt && state.phase === 'settled' && c && state.context
      && key(c) === key(state.context) && p.appointment.state === 'ok' && !p.appointment.value?.pending
      && p.actions.appointment.requestSlotIds.length > 0) {
      this.sent.delete(lock); this.noEffect.delete(lock); return false;
    }
    return true;
  }
  refreshing(): void { if (!this.value.busy) this.update(initial()); }
  private update(state: OrdersActionState): void { this.value = state; this.changed(state); }
  prepare(action: OrderAction): boolean {
    const state = this.read(); const c = this.context(); const p = state.projection;
    if (this.disposed || this.value.busy || state.phase !== 'settled' || !c?.employeeAuthority || !state.context
      || key(c) !== key(state.context) || !p?.selection.order) return false;
    const base = { commandId: this.commandId(), orderUuid: p.selection.order.orderUuid };
    let command: OrdersCommand; let title: string; let detail: string; let resource: string; let version: number;
    if (action.kind === 'acknowledge') {
      const d = p.documents.value; if (!d || !p.actions.documentTaskIds.includes(action.itemId)) return false;
      command = { ...base, ...action, expectedDocumentsRevision: d.documentsRevision }; resource = 'documents'; version = d.documentsRevision;
      title = 'Acknowledge this task?'; detail = d.items.find((item) => item.itemId === action.itemId)?.label ?? action.itemId;
      detail += ' · Acknowledgement, not a signature.';
    } else if (action.kind === 'request-appointment' || action.kind === 'accept-appointment') {
      const a = p.appointment.value; if (!a) return false;
      if (action.kind === 'request-appointment') {
        const slot = a.offeredSlots.find((s) => s.slotId === action.slotId);
        if (!slot || !p.actions.appointment.requestSlotIds.includes(slot.slotId)) return false;
        command = { ...base, ...action, expectedVersion: a.version }; detail = time(slot.start); title = 'Request this handover time?';
      } else {
        const proposalId = p.actions.appointment.acceptProposalId; if (!proposalId || !a.proposedSlot) return false;
        command = { ...base, kind: action.kind, proposalId, expectedVersion: a.version }; detail = time(a.proposedSlot.start); title = 'Accept the new handover time?';
      }
      resource = 'appointment'; version = a.version;
    } else {
      const r = p.returnPlan.value; if (!r) return false;
      if (action.kind === 'request-return') {
        const choice = p.actions.returnPlan.choices.find((row) => row.choiceId === action.choice);
        const slot = r.offeredSlots[action.choice]?.find((s) => s.slotId === action.slotId);
        if (!choice?.slotIds.includes(action.slotId) || !slot) return false;
        command = { ...base, ...action, expectedVersion: r.version };
        detail = `${r.choices.find((row) => row.id === action.choice)?.label ?? action.choice} · ${time(slot.start)}`; title = 'Request this return time?';
      } else {
        const proposalId = p.actions.returnPlan.acceptProposalId; if (!proposalId || !r.proposedSlot) return false;
        command = { ...base, kind: action.kind, proposalId, expectedVersion: r.version }; detail = time(r.proposedSlot.start); title = 'Accept the new return time?';
      }
      resource = 'return'; version = r.version;
    }
    const lock = JSON.stringify([key(c), base.orderUuid, resource, version]);
    if (this.isLocked(lock, state)) return false;
    this.reviewedContext = key(c); this.reviewedProjection = p; this.reviewedLock = lock;
    this.update({ review: { command: Object.freeze(command), title, detail }, busy: false, result: null }); return true;
  }
  cancel(): void { if (!this.value.busy) this.update({ ...this.value, review: null }); }
  async confirm(): Promise<void> {
    const review = this.value.review; const state = this.read(); const c = this.context();
    if (!review || this.disposed || this.value.busy) return;
    if (!c || key(c) !== this.reviewedContext || state.projection !== this.reviewedProjection || state.phase !== 'settled') {
      this.update({ review: null, busy: false, result: { status: 'stale-version', code: 'review-changed', retryable: false } }); return;
    }
    if (this.sent.has(this.reviewedLock)) return;
    this.sent.add(this.reviewedLock); const generation = this.generation;
    this.update({ review: null, busy: true, result: null });
    let result: LifecycleResult<OrdersCommandValue>;
    try { result = await this.port.execute(review.command, { signal: this.abort.signal }); }
    catch { result = { status: 'uncertain', code: 'lifecycle-command-interrupted', retryable: false }; }
    if (this.disposed || generation !== this.generation) return;
    if (!this.context() || key(this.context()!) !== this.reviewedContext) { this.contextChanged(); return; }
    // This appointment request refusal precedes the Java appointment/intent transaction.
    // Generic unavailable, malformed responses and provider write refusals may follow a write.
    if (review.command.kind === 'request-appointment' && result.status === 'unavailable'
      && result.code === 'offer-unavailable' && result.httpStatus === 503 && result.retryable === true
      && result.operationId === undefined && result.value == null && this.reviewedProjection) {
      this.noEffect.set(this.reviewedLock, this.reviewedProjection);
    }
    this.update({ review: null, busy: false, result });
  }
  contextChanged(): void {
    this.generation++; this.abort.abort(); this.abort = new AbortController(); this.reviewedProjection = null; this.update(initial());
  }
  dispose(): void { this.disposed = true; this.contextChanged(); }
}
