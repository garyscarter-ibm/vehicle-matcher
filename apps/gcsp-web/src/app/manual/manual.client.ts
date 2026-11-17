import { inject, Injectable } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { isManualClaim, isManualOrder, isManualReviewDetails, isManualTerms, manualObject, manualPositive, manualRevision, manualText,
  sameManualDetails, validManualEditableDetails } from './manual.projection';
import type { ManualClaim, ManualClaimCommand, ManualFailure, ManualOptions, ManualOrder, ManualRecord, ManualReleaseCommand,
  ManualResult, ManualReviewCommand, ManualReviewDetails, ManualReviewDetailsCommand, ManualScope, ManualSubmitCommand, ManualTerms } from './manual.types';

const only = (v: unknown, keys: readonly string[]): v is ManualRecord => manualObject(v)
  && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const id = (v: unknown): v is string => manualText(v, 128);
const action = (v: ManualReviewCommand): boolean => id(v.commandId) && id(v.holdId)
  && manualPositive(v.expectedHoldVersion) && manualPositive(v.expectedDraftVersion);
const actionKeys = ['commandId', 'holdId', 'expectedHoldVersion', 'expectedDraftVersion'];
const failure = (status: ManualFailure['status'], code: string): ManualFailure => ({ status, code, retryable: false });
const same = (a: ManualScope, b: ManualScope | null): boolean => !!b && JSON.stringify(a) === JSON.stringify(b);
function scoped(value: unknown, scope: ManualScope): boolean {
  if (Array.isArray(value)) return value.every((v) => scoped(v, scope));
  return !manualObject(value) || Object.entries(value).every(([key, part]) => ['employeeId', 'environmentId', 'runId'].includes(key)
    ? part === scope[key as keyof ManualScope] : scoped(part, scope));
}
const statuses: Readonly<Record<number, readonly string[]>> = { 202: ['pending'], 400: ['invalid'], 401: ['unauthenticated', 'authentication-required'],
  403: ['forbidden'], 404: ['not-found'], 409: ['conflict'], 422: ['refused'], 503: ['unavailable'] };
function reviewFailure(v: ManualRecord, httpStatus: number): ManualFailure | null {
  const status = v['status']; const view = v['view'];
  const actualView = (state: string, editable: boolean, action: string) => manualObject(view) && view['state'] === state
    && view['editable'] === editable && view['action'] === action && view['supportOwner'] === 'employee';
  const result = (state: ManualFailure['status'], code: string): ManualFailure => ({ ...structuredClone(v), status: state, code,
    retryable: false, httpStatus });
  if (status === 'invalid' && httpStatus === 400 && v['code'] === 'invalid-review-details'
    && Array.isArray(v['reasons']) && v['reasons'].length > 0 && v['reasons'].every((r) => manualObject(r) && manualText(r['field']) && manualText(r['reason']))
    && actualView('validation', true, 'correct-fields')) return result('invalid', 'invalid-review-details');
  if (status === 'stale-version' && httpStatus === 409 && v['code'] === 'stale-review-details' && manualText(v['resource'])
    && manualRevision(v['expectedVersion']) && manualRevision(v['currentVersion']) && v['action'] === 'refresh'
    && actualView('conflict', false, 'refresh-review')) return result('conflict', 'stale-review-details');
  if (status === 'conflict' && httpStatus === 409 && manualText(v['code']) && manualText(v['reason']) && v['action'] === 'refresh'
    && actualView('conflict', false, 'refresh-review')) return result('conflict', v['code']);
  if (status === 'forbidden' && httpStatus === 403 && v['code'] === undefined && manualText(v['reason'])) return result('forbidden', 'manual-review-forbidden');
  if (status === 'not-found' && httpStatus === 404 && v['code'] === undefined && manualText(v['resourceType'])) return result('not-found', 'manual-review-not-found');
  if (status === 'stale-run' && httpStatus === 409 && v['code'] === undefined && manualText(v['reason'])) return result('conflict', 'stale-run');
  return null;
}

/** Fixed principal-scoped Java routes. No implicit retries or successful transport substitutes. */
@Injectable({ providedIn: 'root' })
export class ManualClient {
  private readonly auth = inject(AuthPort);
  private readonly config = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);
  context(): ManualScope | null {
    const state = this.auth.state();
    return state.status === 'ready' && state.context.roles.includes('employee') && !state.context.roles.includes('presenter') && id(state.context.employeeId)
      ? { subject: state.context.subject, environmentId: state.context.environmentId, runId: state.context.runId, employeeId: state.context.employeeId } : null;
  }
  readClaim(options: ManualOptions = {}): Promise<ManualResult<ManualClaim>> { return this.request('manual/claim', isManualClaim, options); }
  readOrder(options: ManualOptions = {}): Promise<ManualResult<ManualOrder>> { return this.request('manual/order', isManualOrder, options); }
  readTerms(options: ManualOptions = {}): Promise<ManualResult<ManualTerms>> { return this.request('manual/order/terms', isManualTerms, options); }
  readReviewDetails(options: ManualOptions = {}): Promise<ManualResult<ManualReviewDetails>> {
    return this.request('manual/review-details', isManualReviewDetails, options);
  }
  saveReviewDetails(command: ManualReviewDetailsCommand, options: ManualOptions = {}): Promise<ManualResult<ManualReviewDetails>> {
    if (!only(command, [...actionKeys, 'quoteId', 'expectedReviewDetailsVersion', 'details']) || !action(command)
      || ![command.commandId, command.holdId, command.quoteId].every((value) => manualText(value, 100))
      || !manualRevision(command.expectedReviewDetailsVersion) || !validManualEditableDetails(command.details)) {
      return Promise.resolve(failure('invalid', 'invalid-manual-review-details-command'));
    }
    return this.request('manual/review-details', isManualReviewDetails, options, command, (value) => value.binding.holdId === command.holdId
      && value.binding.quoteId === command.quoteId && value.binding.expectedHoldVersion === command.expectedHoldVersion
      && value.binding.expectedDraftVersion === command.expectedDraftVersion && value.reviewDetailsVersion === command.expectedReviewDetailsVersion + 1
      && sameManualDetails(value.details, command.details));
  }
  claim(command: ManualClaimCommand, options: ManualOptions = {}): Promise<ManualResult<ManualClaim>> {
    if (!only(command, ['commandId', 'orderUuid', 'expectedStockVersion', 'expectedDraftVersion', 'expectedContextVersion', 'expectedTermsDigest'])
      || !id(command.commandId) || !id(command.orderUuid) || !manualPositive(command.expectedStockVersion)
      || !manualPositive(command.expectedDraftVersion) || !id(command.expectedContextVersion) || !id(command.expectedTermsDigest)) {
      return Promise.resolve(failure('invalid', 'invalid-manual-claim-command'));
    }
    const { orderUuid, expectedDraftVersion, expectedContextVersion, expectedTermsDigest } = command;
    return this.request('manual/claim', isManualClaim, options, command, (value) => value.hold.orderUuid === orderUuid
      && value.quote.draftVersion === expectedDraftVersion && value.quote.contextVersion === expectedContextVersion
      && value.quote.termsDigest === expectedTermsDigest);
  }
  review(command: ManualReviewCommand, options: ManualOptions = {}): Promise<ManualResult<ManualClaim>> {
    if (!only(command, actionKeys) || !action(command)) return Promise.resolve(failure('invalid', 'invalid-manual-review-command'));
    const { holdId, expectedDraftVersion } = command;
    return this.request('manual/claim/review', isManualClaim, options, command,
      (value) => value.hold.holdId === holdId && value.quote.draftVersion === expectedDraftVersion);
  }
  release(command: ManualReleaseCommand, options: ManualOptions = {}): Promise<ManualResult<ManualClaim>> {
    if (!only(command, [...actionKeys, 'reason']) || !action(command) || !['cancel', 'change', 'back'].includes(command.reason)) {
      return Promise.resolve(failure('invalid', 'invalid-manual-release-command'));
    }
    const { holdId, expectedDraftVersion } = command;
    return this.request('manual/claim/release', isManualClaim, options, command,
      (value) => value.hold.holdId === holdId && value.quote.draftVersion === expectedDraftVersion);
  }
  submit(command: ManualSubmitCommand, options: ManualOptions = {}): Promise<ManualResult<ManualOrder>> {
    if (!only(command, ['commandId', 'source', 'expectedQuoteId', 'expectedStockVersion', 'expectedReviewDetailsVersion', 'termsDigest', 'declarations'])
      || !id(command.commandId) || !only(command.source, ['type', 'holdId', 'expectedHoldVersion', 'expectedDraftVersion'])
      || command.source.type !== 'cart' || !id(command.source.holdId) || !manualPositive(command.source.expectedHoldVersion)
      || !manualPositive(command.source.expectedDraftVersion) || !id(command.expectedQuoteId) || !manualPositive(command.expectedStockVersion)
      || !manualPositive(command.expectedReviewDetailsVersion) || !id(command.termsDigest) || !manualObject(command.declarations)
      || !Object.entries(command.declarations).every(([key, value]) => id(key) && value === true)) return Promise.resolve(failure('invalid', 'invalid-manual-submit-command'));
    const { holdId } = command.source; const { expectedQuoteId } = command;
    return this.request('manual/order', isManualOrder, options, command, (value) => value.selection.sourceType === 'cart'
      && value.selection.holdId === holdId && value.selection.quoteId === expectedQuoteId);
  }
  private async request<T>(path: string, valid: (v: unknown) => v is T, options: ManualOptions, command?: unknown,
    matchesCommand?: (value: T) => boolean): Promise<ManualResult<T>> {
    const context = this.context(); if (!context) return failure('authentication-required', 'employee-sign-in-required');
    if (options.signal?.aborted) return failure('aborted', 'manual-request-aborted');
    const body = command === undefined ? undefined : JSON.stringify(command);
    const controller = new AbortController(); let sent = false; let timedOut = false;
    const interrupted = () => failure(sent && body !== undefined ? 'uncertain' : timedOut ? 'unavailable' : 'aborted', timedOut ? 'manual-timeout' : 'manual-request-aborted');
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    const stopped = new Promise<ManualFailure>((resolve) => controller.signal.addEventListener('abort', () => resolve(interrupted()), { once: true }));
    const invalid = () => failure(body === undefined ? 'unavailable' : 'uncertain', 'manual-response-invalid');
    const run = async (): Promise<ManualResult<T>> => {
      try {
        const config = await this.config.load();
        if (!same(context, this.context())) return failure('account-changed', 'manual-context-changed');
        if (config.environmentId !== context.environmentId) return failure('unavailable', 'manual-environment-mismatch');
        let token: string | null;
        try { token = await this.auth.getAccessToken(); } catch { return failure('authentication-required', 'employee-sign-in-required'); }
        if (!same(context, this.context())) return failure('account-changed', 'manual-context-changed');
        if (!token || /\s/.test(token)) return failure('authentication-required', 'employee-sign-in-required');
        if (controller.signal.aborted) return interrupted();
        sent = true;
        const response = await this.fetcher(`${config.apiBaseUrl}/${path}`, { method: body === undefined ? 'GET' : 'POST',
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body }) });
        const envelope: unknown = await response.json();
        if (!same(context, this.context())) return failure('account-changed', 'manual-context-changed');
        if (!scoped(envelope, context)) return failure(body === undefined ? 'unavailable' : 'uncertain', 'manual-response-scope-mismatch');
        if (response.status === 401) return failure('authentication-required', 'employee-sign-in-required');
        if (!manualObject(envelope)) return invalid();
        if (response.status === 200 && envelope['status'] === 'ok' && valid(envelope['value']) && (!matchesCommand || matchesCommand(envelope['value']))
          && (envelope['replayed'] === undefined || typeof envelope['replayed'] === 'boolean')) {
          return { status: 'ok', value: structuredClone(envelope['value']), ...(envelope['replayed'] === undefined ? {} : { replayed: envelope['replayed'] as boolean }) };
        }
        if (path === 'manual/review-details') {
          const detailsFailure = reviewFailure(envelope, response.status);
          if (detailsFailure) return detailsFailure;
        }
        if (!statuses[response.status]?.includes(envelope['status'] as string) || !manualText(envelope['code'])
          || !manualText(envelope['reason']) || typeof envelope['retryable'] !== 'boolean'
          || (envelope['operationId'] !== undefined && !id(envelope['operationId']))
          || (envelope['status'] === 'pending' && (!id(envelope['operationId']) || envelope['retryable'] !== false))
          || (envelope['value'] != null && !valid(envelope['value']))
          || (envelope['reasons'] !== undefined && (!Array.isArray(envelope['reasons']) || !envelope['reasons'].every((r) => manualObject(r)
            && manualText(r['field']) && manualText(r['reason']))))) return invalid();
        if (envelope['status'] === 'pending' && manualObject(envelope['value']) && 'operationId' in envelope['value']
          && envelope['value']['operationId'] !== envelope['operationId']) return invalid();
        return { ...structuredClone(envelope), httpStatus: response.status } as ManualResult<T>;
      } catch {
        if (!same(context, this.context())) return failure('account-changed', 'manual-context-changed');
        return failure(sent && body !== undefined ? 'uncertain' : 'unavailable', 'manual-transport-unavailable');
      }
    };
    try { return await Promise.race([run(), stopped]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}
