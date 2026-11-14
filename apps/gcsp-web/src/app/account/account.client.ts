import { inject, Injectable } from '@angular/core';
import { ApplicationContext, AuthPort } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { AccountOffers, AccountOrder, AccountOrderFailure, AccountOrdersCollection, AccountOrdersPage, AccountOrdersQuery,
  AccountOrdersReadResult, AccountOrderSnapshot, validOffer, validOffers, validOrdersPage, validOrderSnapshot } from './account.preview';
import { journeyIntent, matchingDraft } from './account.projection';
import { AccountAction, AccountFailure, AccountFailureStatus, AccountProjection, AccountRequestOptions, AccountResult,
  DiscardDraftCommand, DiscardedDraft, ManualDraft, ManualStock, NotificationEmail, SaveDraftCommand, SaveNotificationEmailCommand } from './account.types';

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value); }
function revision(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function only(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return object(value) && Object.keys(value).every((key) => keys.includes(key)); }
function records(value: unknown, valid: (row: Record<string, unknown>) => boolean = () => true): boolean { return Array.isArray(value) && value.every((row) => object(row) && valid(row)); }
function optionalObject(value: unknown): boolean { return value == null || object(value); }
function optionalText(value: unknown): boolean { return value == null || typeof value === 'string'; }
function optionalNumber(value: unknown): boolean { return value == null || typeof value === 'number' && Number.isFinite(value); }
function action(value: unknown): boolean { return object(value) && ['order', 'replace'].includes(value['action'] as string)
  && typeof value['enabled'] === 'boolean' && text(value['slotId']) && text(value['schemeId']) && (value['oldContractId'] === null || text(value['oldContractId'])); }
function contract(row: Record<string, unknown>): boolean { return text(row['contractId']) && text(row['schemeId'])
  && ['slotId', 'driverId', 'status', 'model', 'contractEndDate', 'actualCollectionDate', 'earliestCollectionDate', 'latestCollectionDate',
    'mileageUnit', 'orderNumber', 'registration', 'vin', 'returnedDate'].every((key) => optionalText(row[key]))
  && ['months', 'annualMileage', 'returnedMileage'].every((key) => optionalNumber(row[key]))
  && ['media', 'vehicle', 'terms', 'currentOdometer'].every((key) => optionalObject(row[key])); }
function account(value: unknown): value is AccountProjection {
  if (!object(value) || !text(value['state']) || !Array.isArray(value['actions']) || !value['actions'].every(action)) return false;
  if (!optionalObject(value['account']) || object(value['account']) && !text(value['account']['employeeId'])) return false;
  const identity = value['account'];
  const contact = object(identity) ? identity['contact'] : undefined;
  if (value['state'] === 'ready' && !object(identity)) return false;
  if (object(identity) && (!['name', 'company', 'companyId', 'schemeId', 'gradeId', 'grade', 'employeeNumber', 'dateOfBirth', 'allowanceOverrideEndDate']
    .every((key) => optionalText(identity[key])) || !optionalObject(identity['address']) || !optionalObject(identity['contact'])
    || object(contact) && !['phone', 'email'].every((key) => optionalText(contact[key])))) return false;
  if (!['allowance', 'choices', 'versions', 'view'].every((key) => optionalObject(value[key]))
    || value['contextVersion'] != null && !text(value['contextVersion']) || value['asOf'] != null && !text(value['asOf'])) return false;
  if (value['contracts'] !== undefined && !records(value['contracts'], contract)
    || value['currentContract'] != null && (!object(value['currentContract']) || !contract(value['currentContract']))
    || value['drivers'] !== undefined && !records(value['drivers'], (row) => text(row['driverId']) && optionalText(row['name']) && optionalText(row['kind']) && optionalObject(row['licence']))
    || value['slots'] !== undefined && !records(value['slots'], (row) => text(row['entitlementSlotId']))
    || value['histories'] !== undefined && !records(value['histories'], (row) => text(row['schemeId']) && records(row['entries'], contract))
    || value['assumptions'] != null && !records(value['assumptions'])) return false;
  return value['currentCarRelationships'] === undefined || records(value['currentCarRelationships'], (row) => {
    const current = row['currentCar'];
    return optionalObject(row['oldCar']) && optionalObject(row['newCar'])
      && (!object(row['newCar']) || optionalText(row['newCar']['collectedAt'])) && (current === null || object(current)
        && (current['kind'] === 'contract' && text(current['contractId']) || current['kind'] === 'order' && text(current['orderUuid']) && optionalText(current['vin'])));
  });
}
const choiceFields = ['mode', 'oldContractId', 'slotId', 'schemeId', 'driverId', 'contractOptionId', 'requestedCollectionDate',
  'collectionLocationId', 'brand', 'contact', 'expectedReturnMileage', 'specialRequirements'];
function choices(value: unknown): boolean {
  return only(value, choiceFields) && ['new', 'replacement'].includes(value['mode'] as string) && text(value['slotId']) && text(value['schemeId'])
    && (value['mode'] === 'replacement' ? text(value['oldContractId']) : value['oldContractId'] === null)
    && ['driverId', 'contractOptionId', 'requestedCollectionDate', 'collectionLocationId', 'brand'].every((key) => value[key] === undefined || text(value[key]))
    && (value['contact'] === undefined || only(value['contact'], ['phone', 'email']) && text(value['contact']['phone']) && text(value['contact']['email']))
    && (value['expectedReturnMileage'] == null || revision(value['expectedReturnMileage']))
    && (value['specialRequirements'] === undefined || typeof value['specialRequirements'] === 'string');
}
function draft(value: unknown): value is ManualDraft { return object(value) && revision(value['draftVersion']) && value['draftVersion'] > 0
  && text(value['contextVersion']) && choices(value['choices']) && (value['requiresRefresh'] === undefined || typeof value['requiresRefresh'] === 'boolean')
  && (value['draftStage'] === undefined || ['intent', 'complete'].includes(value['draftStage'] as string)) && optionalObject(value['view']); }
function discarded(value: unknown): value is DiscardedDraft { return object(value) && revision(value['draftVersion']) && value['draftVersion'] > 0 && value['discarded'] === true; }
function notification(value: unknown): value is NotificationEmail { return object(value) && revision(value['version']) && (value['deliveryEmail'] === null || typeof value['deliveryEmail'] === 'string'); }
function stock(value: unknown): value is ManualStock {
  if (!object(value) || !revision(value['total']) || !records(value['decisions']) || !object(value['versions'])
    || !revision(value['versions']['draft']) || !text(value['versions']['context'])) return false;
  if (value['payloadShape'] === undefined) return records(value['cars']);
  return value['payloadShape'] === 'manual-stock-compact-v1' && Array.isArray(value['carIds']) && value['carIds'].every(text)
    && Array.isArray(value['sharedVersionKeys']) && value['sharedVersionKeys'].every((key) => text(key) && Object.hasOwn(value['versions'] as object, key));
}
const statuses: readonly AccountFailureStatus[] = ['unavailable', 'forbidden', 'invalid', 'not-found', 'conflict', 'stale-version', 'stale-run',
  'unsupported', 'unauthenticated', 'authentication-required', 'pending', 'uncertain', 'refused'];
function failure(value: unknown, httpStatus: number): AccountFailure | null {
  if (!object(value) || !statuses.includes(value['status'] as AccountFailureStatus)
    || ['code', 'reason', 'operationId', 'resource', 'resourceType', 'action', 'contractVersion'].some((key) => value[key] !== undefined && !text(value[key]))
    || value['retryable'] !== undefined && typeof value['retryable'] !== 'boolean' || !optionalObject(value['view'])) return null;
  const fields = ['status', 'code', 'reason', 'retryable', 'reasons', 'view', 'operationId', 'resource', 'resourceType', 'expectedVersion', 'currentVersion', 'current', 'action', 'source', 'contractVersion'];
  return { ...Object.fromEntries(fields.filter((key) => value[key] !== undefined).map((key) => [key, structuredClone(value[key])])), httpStatus } as AccountFailure;
}
const unavailable = (code: string, retryable = true): AccountFailure => ({ status: 'unavailable', code, retryable });
const authentication = (): AccountFailure => ({ status: 'authentication-required', code: 'authentication-required', retryable: false });
const changed = (): AccountFailure => ({ status: 'account-changed', code: 'account-context-changed', retryable: false });
const invalid = (): AccountFailure => ({ status: 'invalid', code: 'invalid-account-command', retryable: false });
const aborted = (): AccountFailure => ({ status: 'aborted', code: 'account-request-aborted', retryable: false });
const requestTimeoutMs = 10000;
const retainedOrderFailures = 20;
function command(value: Record<string, unknown>): boolean { return text(value['commandId']) && value['commandId'].length <= 128; }
function orderQuery(value: unknown): value is AccountOrdersQuery {
  return only(value, ['after', 'limit']) && (value['after'] === undefined || text(value['after']) && value['after'].length <= 200)
    && (value['limit'] === undefined || typeof value['limit'] === 'number' && Number.isInteger(value['limit']) && value['limit'] >= 1 && value['limit'] <= 100);
}
type Scope = Pick<ApplicationContext, 'subject' | 'environmentId' | 'runId' | 'employeeId'>;
function scoped(value: unknown, scope: Scope): boolean {
  if (Array.isArray(value)) return value.every((row) => scoped(row, scope));
  if (!object(value)) return true;
  return Object.entries(value).every(([key, part]) => ['employeeId', 'environmentId', 'runId'].includes(key)
    ? part === scope[key as keyof Scope] : scoped(part, scope));
}

@Injectable({ providedIn: 'root' })
export class AccountClient {
  private readonly auth = inject(AuthPort);
  private readonly config = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);

  readAccount(options: AccountRequestOptions = {}): Promise<AccountResult<AccountProjection>> { return this.request('account', account, options); }
  readDraft(options: AccountRequestOptions = {}): Promise<AccountResult<ManualDraft>> { return this.request('draft', draft, options); }
  readNotificationEmail(options: AccountRequestOptions = {}): Promise<AccountResult<NotificationEmail>> { return this.request('notification-email', notification, options); }
  readStock(options: AccountRequestOptions = {}): Promise<AccountResult<ManualStock>> { return this.request('stock', stock, options); }
  readOrdersPage(query: AccountOrdersQuery = {}, options: AccountRequestOptions = {}): Promise<AccountResult<AccountOrdersPage>> {
    if (!orderQuery(query)) {
      return Promise.resolve({ status: 'invalid', code: 'invalid-order-page-query', retryable: false });
    }
    return this.request({ ordersPage: structuredClone(query) }, validOrdersPage, options);
  }
  async readOrders(options: AccountRequestOptions = {}): Promise<AccountOrdersReadResult> {
    const initial = this.scope(); if (!initial) return authentication();
    if (options.signal?.aborted) return aborted();
    const controller = new AbortController(); const abort = () => controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    const orders: AccountOrder[] = []; const failed: AccountOrderFailure[] = [];
    const pageEvidence: AccountOrdersCollection['pageEvidence'][number][] = []; const cursors = new Set<string>();
    let failedCount = 0; let after: string | null = null; let nextAfter: string | null = null;
    const partial = (): AccountOrdersCollection => ({ orders, failed, failedCount, nextAfter, pageEvidence });
    const incomplete = (error: AccountFailure): AccountOrdersReadResult => ({ ...error, partial: partial(), failedAfter: after });
    try {
      while (true) {
        if (!this.sameScope(initial)) return changed();
        const result = await this.readOrdersPage(after === null ? {} : { after }, { signal: controller.signal });
        if (!this.sameScope(initial)) return changed();
        if (timedOut) return incomplete(unavailable('account-timeout'));
        if (controller.signal.aborted) return aborted();
        if (result.status !== 'ok') {
          if (['authentication-required', 'unauthenticated', 'forbidden', 'account-changed', 'aborted'].includes(result.status)
            || result.code === 'account-response-scope-mismatch') return result;
          return incomplete(result);
        }
        const page = result.value;
        if (!Number.isSafeInteger(failedCount + page.failedCount)) return incomplete(unavailable('account-response-invalid', false));
        orders.push(...page.orders); failed.push(...page.failed.slice(0, retainedOrderFailures - failed.length));
        failedCount += page.failedCount; nextAfter = page.nextAfter;
        pageEvidence.push({ after, nextAfter, failedCount: page.failedCount,
          ...(page.asOf === undefined ? {} : { asOf: page.asOf }), ...(page.contractVersion === undefined ? {} : { contractVersion: page.contractVersion }),
          ...(result.contractVersion === undefined ? {} : { envelopeContractVersion: result.contractVersion }) });
        if (nextAfter === null) {
          if (failedCount) return incomplete(unavailable('account-orders-incomplete', false));
          const contractVersion = pageEvidence[0]?.envelopeContractVersion;
          return { status: 'ok', value: partial(), ...(contractVersion !== undefined
            && pageEvidence.every((evidence) => evidence.envelopeContractVersion === contractVersion) ? { contractVersion } : {}) };
        }
        if (cursors.has(nextAfter)) return incomplete(unavailable('account-orders-cursor-repeated', false));
        cursors.add(nextAfter); after = nextAfter;
      }
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
  readOrder(options: AccountRequestOptions = {}): Promise<AccountResult<AccountOrderSnapshot>> { return this.request('order', validOrderSnapshot, options); }
  async readOffers(options: AccountRequestOptions = {}): Promise<AccountResult<AccountOffers>> {
    const initial = this.scope(); if (!initial) return authentication();
    const listed = await this.request('offers/current', validOffers, options);
    if (!this.sameScope(initial)) return changed();
    if (listed.status !== 'ok' || !listed.value.offers.length) return listed;
    const newest = listed.value.offers[0];
    const detail = await this.request({ offerId: newest.offerId }, validOffer, options);
    if (!this.sameScope(initial)) return changed();
    if (detail.status !== 'ok') return detail;
    if (detail.value['offerId'] !== undefined && detail.value['offerId'] !== newest.offerId) return unavailable('account-response-offer-mismatch', false);
    return { ...listed, value: { ...listed.value, offers: [{ ...newest, state: detail.value.state }, ...listed.value.offers.slice(1)] } };
  }
  saveDraft(input: SaveDraftCommand, options: AccountRequestOptions = {}): Promise<AccountResult<ManualDraft>> {
    if (!only(input, ['commandId', 'expectedDraftVersion', 'expectedContextVersion', 'choices']) || !command(input)
      || !revision(input['expectedDraftVersion']) || !text(input['expectedContextVersion']) || !choices(input['choices'])) return Promise.resolve(invalid());
    return this.request('draft', draft, options, structuredClone(input));
  }
  discardDraft(input: DiscardDraftCommand, options: AccountRequestOptions = {}): Promise<AccountResult<DiscardedDraft>> {
    if (!only(input, ['commandId', 'expectedDraftVersion']) || !command(input) || !revision(input['expectedDraftVersion'])) return Promise.resolve(invalid());
    return this.request('draft/discard', discarded, options, structuredClone(input));
  }
  saveNotificationEmail(input: SaveNotificationEmailCommand, options: AccountRequestOptions = {}): Promise<AccountResult<NotificationEmail>> {
    if (!only(input, ['commandId', 'expectedVersion', 'deliveryEmail']) || !command(input) || !revision(input['expectedVersion'])
      || !(input['deliveryEmail'] === null || typeof input['deliveryEmail'] === 'string')) return Promise.resolve(invalid());
    return this.request('notification-email', notification, options, structuredClone(input));
  }

  async startJourney(input: { readonly account: AccountProjection; readonly action: AccountAction; readonly commandId: string;
    readonly reviewedContextVersion?: string | null }, options: AccountRequestOptions = {}): Promise<AccountResult<ManualDraft>> {
    const initial = this.scope(); if (!initial) return authentication();
    const snapshot = structuredClone(input);
    if (!account(snapshot.account) || !scoped(snapshot.account, initial)) return changed();
    const permitted = snapshot.account.state === 'ready' && snapshot.account.actions.find((row) => row.enabled && row.action === snapshot.action.action
      && row.slotId === snapshot.action.slotId && row.schemeId === snapshot.action.schemeId && row.oldContractId === snapshot.action.oldContractId);
    if (!permitted || !text(snapshot.account.contextVersion) || !command({ commandId: snapshot.commandId })) return invalid();
    const saved = await this.readDraft(options);
    if (!this.sameScope(initial)) return changed();
    if (saved.status !== 'ok' && saved.status !== 'not-found') return saved;
    if (saved.status === 'ok' && matchingDraft(snapshot.account, permitted, saved.value)) return saved;
    if (saved.status === 'ok' && (saved.value.requiresRefresh || saved.value.contextVersion !== snapshot.account.contextVersion)
      && !(snapshot.reviewedContextVersion === snapshot.account.contextVersion && saved.value.contextVersion !== snapshot.account.contextVersion)) {
      return { status: 'stale-version', resource: 'manual-context', action: 'refresh', view: { state: 'context-changed', editable: false, action: 'refresh-review' } };
    }
    return this.saveDraft({ commandId: snapshot.commandId, expectedDraftVersion: saved.status === 'ok' ? saved.value.draftVersion : 0,
      expectedContextVersion: snapshot.account.contextVersion, choices: journeyIntent(permitted) }, options);
  }

  private scope(): Scope | null {
    const state = this.auth.state();
    return state.status === 'ready' && state.context.roles.includes('employee') && text(state.context.employeeId)
      ? { subject: state.context.subject, environmentId: state.context.environmentId, runId: state.context.runId, employeeId: state.context.employeeId } : null;
  }
  private sameScope(scope: Scope): boolean { const current = this.scope(); return !!current && Object.keys(scope).every((key) => current[key as keyof Scope] === scope[key as keyof Scope]); }

  private async request<T>(path: 'account' | 'draft' | 'draft/discard' | 'notification-email' | 'stock' | 'order' | 'offers/current'
    | { readonly offerId: string } | { readonly ordersPage: AccountOrdersQuery }, valid: (value: unknown) => value is T,
    options: AccountRequestOptions, body?: unknown): Promise<AccountResult<T>> {
    const initial = this.scope(); if (!initial) return authentication();
    if (options.signal?.aborted) return { status: 'aborted', code: 'account-request-aborted', retryable: false };
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    const stopped: Promise<AccountFailure> = new Promise((resolve) => controller.signal.addEventListener('abort', () => resolve(timedOut
      ? unavailable('account-timeout', body === undefined) : { status: 'aborted', code: 'account-request-aborted', retryable: false }), { once: true }));
    const run = async (): Promise<AccountResult<T>> => {
      try {
        let config;
        try { config = await this.config.load(); } catch { return unavailable('account-config-unavailable'); }
        if (!this.sameScope(initial)) return changed();
        if (config.environmentId !== initial.environmentId) return unavailable('account-environment-mismatch', false);
        let token;
        try { token = await this.auth.getAccessToken(); } catch { return this.sameScope(initial) ? authentication() : changed(); }
        if (!this.sameScope(initial)) return changed();
        if (!token || /\s/.test(token)) return authentication();
        if (controller.signal.aborted) return { status: 'aborted', code: 'account-request-aborted', retryable: false };
        let suffix: string;
        if (typeof path === 'object' && 'ordersPage' in path) {
          const query = new URLSearchParams();
          if (path.ordersPage.after !== undefined) query.set('after', path.ordersPage.after);
          if (path.ordersPage.limit !== undefined) query.set('limit', String(path.ordersPage.limit));
          suffix = `orders/progress/all${query.size ? `?${query}` : ''}`;
        } else suffix = typeof path === 'object' ? `offers/${encodeURIComponent(path.offerId)}?runId=${encodeURIComponent(initial.runId)}`
          : path === 'offers/current' ? path : `manual/${path}`;
        const response = await this.fetcher(`${config.apiBaseUrl}/${suffix}`, { method: body === undefined ? 'GET' : 'POST',
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        let envelope: unknown; try { envelope = await response.json(); } catch { envelope = null; }
        if (!this.sameScope(initial)) return changed();
        if (!scoped(envelope, initial)) return unavailable('account-response-scope-mismatch', false);
        if (response.status === 401) return { ...(failure(envelope, 401) ?? authentication()), status: 'authentication-required', httpStatus: 401, retryable: false };
        if (response.status === 403) return failure(envelope, 403) ?? { status: 'forbidden', code: 'account-access-denied', httpStatus: 403, retryable: false };
        if (response.status === 200 && object(envelope) && envelope['status'] === 'ok' && valid(envelope['value'])
          && (envelope['contractVersion'] === undefined || text(envelope['contractVersion']))) return { status: 'ok', value: structuredClone(envelope['value']),
            ...(envelope['contractVersion'] === undefined ? {} : { contractVersion: envelope['contractVersion'] as string }) };
        const error = failure(envelope, response.status);
        if (path === 'order' && body === undefined && response.status === 202 && error?.status === 'pending'
          && object(envelope) && envelope['value'] !== undefined) {
          if (envelope['value'] !== null && !valid(envelope['value'])) return unavailable('account-response-invalid');
          return { ...error, value: structuredClone(envelope['value']) };
        }
        return error ?? unavailable('account-response-invalid');
      } catch {
        return this.sameScope(initial) ? unavailable('account-transport-unavailable', body === undefined) : changed();
      }
    };
    try { return await Promise.race([run(), stopped]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}
