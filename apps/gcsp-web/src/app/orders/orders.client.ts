import { inject, Injectable } from '@angular/core';
import { AccountClient } from '../account/account.client';
import type { AccountFailure, AccountRequestOptions, EvidenceRecord } from '../account/account.types';
import { AuthPort } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import type { OrdersReadContext, OrdersReadPort } from './orders.read-port';
import type { DocumentsCollection, LifecycleResult, OrderAppointment, OrderDocuments, OrderReturnPlan, OrderStages } from './orders.types';

interface CommandIdentity { readonly commandId: string; readonly orderUuid: string }
export type OrdersCommand = CommandIdentity & (
  { readonly kind: 'acknowledge'; readonly itemId: string; readonly expectedDocumentsRevision: number }
  | { readonly kind: 'request-appointment'; readonly slotId: string; readonly expectedVersion: number }
  | { readonly kind: 'accept-appointment'; readonly proposalId: string; readonly expectedVersion: number }
  | { readonly kind: 'request-return'; readonly choice: string; readonly slotId: string; readonly expectedVersion: number }
  | { readonly kind: 'accept-return'; readonly proposalId: string; readonly expectedVersion: number });
export type OrdersCommandValue = OrderAppointment | OrderReturnPlan | { readonly order: OrderDocuments };
export interface OrdersCommandPort {
  execute(command: OrdersCommand, options?: AccountRequestOptions): Promise<LifecycleResult<OrdersCommandValue>>;
}

const object = (v: unknown): v is EvidenceRecord => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const optionalText = (v: unknown): boolean => v == null || typeof v === 'string';
const strings = (v: unknown): boolean => Array.isArray(v) && v.every((s) => typeof s === 'string');
const records = (v: unknown, valid: (row: EvidenceRecord) => boolean): boolean => Array.isArray(v) && v.every((r) => object(r) && valid(r));
const identity = (v: EvidenceRecord): boolean => text(v['orderUuid']) && text(v['employeeId']) && text(v['runId']);
const owned = (v: EvidenceRecord): boolean => optionalText(v['owner']) && optionalText(v['nextStep']);
const note = (v: unknown): boolean => v == null || object(v) && optionalText(v['reason']);
const slot = (v: unknown): boolean => object(v) && text(v['slotId']) && text(v['start']) && Number.isFinite(Date.parse(v['start'])) && optionalText(v['end']);
const slots = (v: unknown): boolean => Array.isArray(v) && v.every(slot) && new Set(v.map((s) => (s as EvidenceRecord)['slotId'])).size === v.length;
function stages(v: unknown): v is OrderStages {
  return object(v) && identity(v) && owned(v) && v['contractVersion'] === 'lifecycle.stages.v1' && v['schemaVersion'] === 1
    && strings(v['stageList']) && records(v['stages'], (r) => text(r['stage']) && text(r['state']) && optionalText(r['at']))
    && optionalText(v['currentStage']) && text(v['outcome']) && note(v['blocked']);
}
function document(v: unknown): v is OrderDocuments {
  if (!object(v) || !identity(v) || v['contractVersion'] !== 'lifecycle.documents.v1' || !revision(v['documentsRevision'])
    || typeof v['acknowledgementSupported'] !== 'boolean' || !records(v['items'], (r) => text(r['itemId'], 64) && text(r['kind'])
      && text(r['owner']) && text(r['status']) && optionalText(r['label']) && optionalText(r['action']) && optionalText(r['reason']))
    || !records(v['tasks'], (r) => text(r['itemId'], 64) && text(r['status']) && typeof r['actionable'] === 'boolean'
      && optionalText(r['label']) && optionalText(r['action']))) return false;
  const r = v['readiness'];
  return object(r) && ['ready', 'documentsComplete', 'vehicleReady'].every((k) => typeof r[k] === 'boolean')
    && text(r['state']) && strings(r['blocking']) && strings(r['failed']);
}
function documents(v: unknown): v is DocumentsCollection {
  return object(v) && v['contractVersion'] === 'lifecycle.documents.v1' && Array.isArray(v['orders']) && v['orders'].every(document)
    && new Set(v['orders'].map((r) => r.orderUuid)).size === v['orders'].length;
}
function appointment(v: unknown): v is OrderAppointment {
  if (!object(v)) return false;
  const eligible = v['eligibility']; const provider = v['provider'];
  return identity(v) && owned(v) && v['contractVersion'] === 'lifecycle.appointments.v1' && revision(v['version'])
    && text(v['state']) && typeof v['booked'] === 'boolean' && slots(v['offeredSlots'])
    && ['slot', 'requestedSlot', 'proposedSlot'].every((k) => v[k] == null || slot(v[k]))
    && optionalText(v['proposalId']) && note(v['pending']) && note(v['blocked'])
    && (eligible == null || object(eligible) && typeof eligible['eligible'] === 'boolean' && optionalText(eligible['reason']))
    && (provider == null || object(provider) && optionalText(provider['mode']));
}
function returnPlan(v: unknown): v is OrderReturnPlan {
  if (!object(v)) return false;
  const offered = v['offeredSlots']; const relation = v['relationship']; const a = v['appointment']; const provider = v['provider'];
  return identity(v) && owned(v) && v['contractVersion'] === 'lifecycle.return-plan.v1' && revision(v['version'])
    && typeof v['applicable'] === 'boolean' && optionalText(v['state']) && typeof v['scheduled'] === 'boolean'
    && records(v['choices'], (r) => text(r['id']) && typeof r['available'] === 'boolean' && optionalText(r['label']) && optionalText(r['reason']))
    && object(offered) && Object.values(offered).every(slots)
    && ['slot', 'requestedSlot', 'proposedSlot'].every((k) => v[k] == null || slot(v[k]))
    && optionalText(v['proposalId']) && note(v['pending']) && note(v['blocked'])
    && (a == null || object(a) && text(a['state'])) && (provider == null || object(provider) && optionalText(provider['mode']))
    && (relation == null || object(relation) && identity(relation) && relation['contractVersion'] === 'lifecycle.current-car.v1'
      && (relation['currentCar'] === null || object(relation['currentCar']) && (relation['currentCar']['kind'] === 'contract'
        ? text(relation['currentCar']['contractId']) : relation['currentCar']['kind'] === 'order' && text(relation['currentCar']['orderUuid'])))
      && (relation['oldCar'] == null || object(relation['oldCar'])) && (relation['newCar'] == null || object(relation['newCar'])));
}
function scoped(v: unknown, context: OrdersReadContext): boolean {
  if (Array.isArray(v)) return v.every((part) => scoped(part, context));
  return !object(v) || Object.entries(v).every(([key, part]) => ['employeeId', 'environmentId', 'runId'].includes(key)
    ? part === context[key as 'employeeId' | 'environmentId' | 'runId'] : scoped(part, context));
}
const same = (a: OrdersReadContext, b: OrdersReadContext | null): boolean => !!b && Object.keys(a).every((key) => a[key as keyof OrdersReadContext] === b[key as keyof OrdersReadContext]);
const failureStatuses = ['unavailable', 'forbidden', 'invalid', 'not-found', 'conflict', 'stale-version', 'stale-run', 'unsupported',
  'unauthenticated', 'authentication-required', 'pending', 'uncertain', 'refused'];
const failure = (status: AccountFailure['status'], code: string): AccountFailure => ({ status, code, retryable: false });

/** Only the named employee lifecycle endpoints. AccountClient owns complete-list/snapshot reads. */
@Injectable({ providedIn: 'root' })
export class OrdersClient implements OrdersReadPort, OrdersCommandPort {
  private readonly account = inject(AccountClient);
  private readonly auth = inject(AuthPort);
  private readonly config = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);

  context(): OrdersReadContext | null {
    const state = this.auth.state();
    return state.status === 'ready' && state.context.roles.includes('employee') && !state.context.roles.includes('presenter') && text(state.context.employeeId)
      ? { subject: state.context.subject, environmentId: state.context.environmentId, runId: state.context.runId,
        employeeId: state.context.employeeId, employeeAuthority: true } : null;
  }
  readOrders(options?: AccountRequestOptions) { return this.account.readOrders(options); }
  readOrder(options?: AccountRequestOptions) { return this.account.readOrder(options); }
  readStages(orderUuid: string, options: AccountRequestOptions = {}): Promise<LifecycleResult<OrderStages>> {
    return this.read('orders/progress', orderUuid, stages, options);
  }
  readDocuments(options: AccountRequestOptions = {}): Promise<LifecycleResult<DocumentsCollection>> {
    return this.request('documents', documents, options);
  }
  readAppointment(orderUuid: string, options: AccountRequestOptions = {}): Promise<LifecycleResult<OrderAppointment>> {
    return this.read('appointments', orderUuid, appointment, options);
  }
  readReturnPlan(orderUuid: string, options: AccountRequestOptions = {}): Promise<LifecycleResult<OrderReturnPlan>> {
    return this.read('return-plan', orderUuid, returnPlan, options);
  }
  execute(input: OrdersCommand, options: AccountRequestOptions = {}): Promise<LifecycleResult<OrdersCommandValue>> {
    const c = structuredClone(input); const { kind, ...body } = c;
    let fields: readonly string[]; let path: string; let valid: (v: unknown) => v is OrdersCommandValue;
    if (kind === 'acknowledge') {
      fields = ['commandId', 'orderUuid', 'itemId', 'expectedDocumentsRevision']; path = 'documents/tasks/acknowledge';
      valid = (v): v is { order: OrderDocuments } => object(v) && document(v['order']) && v['order'].orderUuid === c.orderUuid;
      if (!text(c.itemId, 64) || !revision(c.expectedDocumentsRevision) || c.expectedDocumentsRevision === 0) return Promise.resolve(failure('invalid', 'invalid-lifecycle-command'));
    } else {
      fields = ['commandId', 'orderUuid', 'expectedVersion', ...(kind.startsWith('request') ? ['slotId'] : ['proposalId']), ...(kind === 'request-return' ? ['choice'] : [])];
      const isReturn = kind === 'request-return' || kind === 'accept-return';
      path = `${isReturn ? 'return-plan' : 'appointments'}/${kind.startsWith('request') ? 'request' : 'accept'}`;
      valid = isReturn ? returnPlan : appointment;
      if (!['request-appointment', 'accept-appointment', 'request-return', 'accept-return'].includes(kind)
        || !revision(c.expectedVersion) || ('slotId' in c && !text(c.slotId, 128)) || ('proposalId' in c && !text(c.proposalId, 128))
        || ('choice' in c && !text(c.choice))) return Promise.resolve(failure('invalid', 'invalid-lifecycle-command'));
    }
    if (!text(c.commandId, 128) || !text(c.orderUuid, 128) || Object.keys(body).length !== fields.length || Object.keys(body).some((k) => !fields.includes(k))) {
      return Promise.resolve(failure('invalid', 'invalid-lifecycle-command'));
    }
    return this.request(path, (v): v is OrdersCommandValue => object(v) && (v['orderUuid'] === undefined || v['orderUuid'] === c.orderUuid) && valid(v), options, body);
  }
  private read<T>(path: string, orderUuid: string, valid: (v: unknown) => v is T, options: AccountRequestOptions): Promise<LifecycleResult<T>> {
    if (!text(orderUuid, 128)) return Promise.resolve(failure('invalid', 'invalid-order-identity'));
    return this.request(`${path}?orderUuid=${encodeURIComponent(orderUuid)}`,
      (v): v is T => valid(v) && object(v) && v['orderUuid'] === orderUuid, options);
  }
  private async request<T>(path: string, valid: (v: unknown) => v is T, options: AccountRequestOptions, body?: unknown): Promise<LifecycleResult<T>> {
    const context = this.context(); if (!context) return failure('authentication-required', 'employee-sign-in-required');
    if (options.signal?.aborted) return failure('aborted', 'lifecycle-request-aborted');
    const controller = new AbortController(); let sent = false; let timedOut = false;
    const interrupted = () => failure(sent && body !== undefined ? 'uncertain' : timedOut ? 'unavailable' : 'aborted', timedOut ? 'lifecycle-timeout' : 'lifecycle-request-aborted');
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    const stopped = new Promise<AccountFailure>((resolve) => controller.signal.addEventListener('abort', () => resolve(interrupted()), { once: true }));
    const run = async (): Promise<LifecycleResult<T>> => {
      try {
        const config = await this.config.load();
        if (!same(context, this.context())) return failure('account-changed', 'lifecycle-context-changed');
        if (config.environmentId !== context.environmentId) return failure('unavailable', 'lifecycle-environment-mismatch');
        let token: string | null;
        try { token = await this.auth.getAccessToken(); }
        catch { return same(context, this.context()) ? failure('authentication-required', 'employee-sign-in-required') : failure('account-changed', 'lifecycle-context-changed'); }
        if (!same(context, this.context())) return failure('account-changed', 'lifecycle-context-changed');
        if (!token || /\s/.test(token)) return failure('authentication-required', 'employee-sign-in-required');
        if (controller.signal.aborted) return interrupted();
        sent = true;
        const response = await this.fetcher(`${config.apiBaseUrl}/${path}`, { method: body === undefined ? 'GET' : 'POST',
          signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const envelope: unknown = await response.json();
        if (!same(context, this.context())) return failure('account-changed', 'lifecycle-context-changed');
        if (!scoped(envelope, context)) return failure('unavailable', 'lifecycle-response-scope-mismatch');
        if (response.status === 401) return failure('authentication-required', 'employee-sign-in-required');
        if (response.status === 403 && (!object(envelope) || envelope['status'] !== 'forbidden')) return failure('forbidden', 'lifecycle-access-denied');
        if (!object(envelope)) return failure(body === undefined ? 'unavailable' : 'uncertain', 'lifecycle-response-invalid');
        if (response.status === 200 && envelope['status'] === 'ok' && valid(envelope['value'])
          && (envelope['contractVersion'] === undefined || text(envelope['contractVersion']))) return { status: 'ok', value: structuredClone(envelope['value']),
            ...(envelope['contractVersion'] === undefined ? {} : { contractVersion: envelope['contractVersion'] as string }) };
        if (response.status !== 200 && failureStatuses.includes(envelope['status'] as string)
          && ['code', 'reason', 'operationId', 'contractVersion'].every((k) => envelope[k] === undefined || text(envelope[k], 2048))
          && (envelope['retryable'] === undefined || typeof envelope['retryable'] === 'boolean')) {
          if (envelope['value'] !== undefined && envelope['value'] !== null && !valid(envelope['value'])) return failure('unavailable', 'lifecycle-response-invalid');
          // Keep the provider's typed pending value, null, operation identity and refusal evidence.
          return { ...structuredClone(envelope), status: envelope['status'] as AccountFailure['status'], httpStatus: response.status } as LifecycleResult<T>;
        }
        return failure(body === undefined ? 'unavailable' : 'uncertain', 'lifecycle-response-invalid');
      } catch {
        if (!same(context, this.context())) return failure('account-changed', 'lifecycle-context-changed');
        return failure(sent && body !== undefined ? 'uncertain' : 'unavailable', 'lifecycle-transport-unavailable');
      }
    };
    try { return await Promise.race([run(), stopped]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}
