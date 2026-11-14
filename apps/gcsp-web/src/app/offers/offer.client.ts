import { inject, Injectable } from '@angular/core';
import { ApplicationContext, AuthPort } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import {
  OfferDecisionInput,
  OfferDecisionReceipt,
  OfferDeclineReasons,
  OfferFailure,
  OfferFollowupConfirmInput,
  OfferFollowupValue,
  OfferProjection,
  OfferRequestOptions,
  OfferResult,
} from './offer.types';
import {
  isOfferDecisionInput,
  parseOfferDecisionReceipt,
  isOfferDeclineReasons,
  isOfferFollowupConfirmInput,
  isOfferFollowupValue,
  isOfferProjection,
  parseOfferFailure,
} from './offer.validation';

const AUTH_REQUIRED: OfferFailure = { status: 'unauthenticated', code: 'authentication-required', retryable: false };
const EMPLOYEE_REQUIRED: OfferFailure = { status: 'denied', code: 'employee-role-required', retryable: false };
const unavailable = (code: string): OfferFailure => ({ status: 'unavailable', code, retryable: true });
const invalid = (code: string): OfferFailure => ({ status: 'invalid', code, retryable: false });
const REQUEST_TIMEOUT_MS = 10_000;

interface CapturedContext {
  readonly context: ApplicationContext;
  readonly key: string;
}

function keyOf(context: ApplicationContext): string {
  return JSON.stringify([context.subject, context.environmentId, context.runId, context.employeeId]);
}

function employeeContext(context: ApplicationContext): boolean {
  return typeof context.subject === 'string' && context.subject.trim().length > 0
    && typeof context.environmentId === 'string' && context.environmentId.trim().length > 0
    && typeof context.runId === 'string' && context.runId.trim().length > 0
    && typeof context.employeeId === 'string' && context.employeeId.trim().length > 0
    && context.roles.includes('employee');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failureForStatus(status: number, body: unknown, identity: { runId?: string; offerId?: string; decisionId?: string; commandId?: string }): OfferFailure {
  const failure = parseOfferFailure(body, identity);
  const matches = (allowed: readonly string[]) => failure && allowed.includes(failure.status) ? failure : null;
  if (status === 401) return matches(['unauthenticated']) ?? AUTH_REQUIRED;
  if (status === 403) return matches(['forbidden', 'denied']) ?? EMPLOYEE_REQUIRED;
  if (status === 404) return matches(['not-found']) ?? { status: 'not-found', code: 'offer-not-found', retryable: false };
  if (status === 409) return matches(['stale-run', 'stale-version', 'conflict']) ?? { status: 'conflict', code: 'offer-conflict', retryable: false };
  if (status === 422) return matches(['unsupported', 'invalid']) ?? { status: 'unsupported', code: 'offer-unsupported', retryable: false };
  if (status === 503) return matches(['unavailable']) ?? unavailable('offer-unavailable');
  if (status >= 500) return matches(['unavailable']) ?? unavailable('offer-unavailable');
  if (status === 400) return matches(['invalid']) ?? invalid('invalid-offer-request');
  return failure && failure.status !== 'pending' ? failure : unavailable('invalid-offer-response');
}

@Injectable({ providedIn: 'root' })
export class OfferClient {
  private readonly auth = inject(AuthPort);
  private readonly runtime = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);

  readOffer(offerId: string, options: OfferRequestOptions = {}): Promise<OfferResult<OfferProjection>> {
    if (!this.identifier(offerId)) return Promise.resolve(invalid('invalid-offer-selector'));
    return this.call((context) => `/offers/${encodeURIComponent(offerId)}?runId=${encodeURIComponent(context.runId)}`,
      undefined, (value, context) => isOfferProjection(value, { offerId, runId: context.runId }) ? value : null,
      { offerId }, options, undefined, () => unavailable('invalid-offer-response'));
  }

  readDecisionReasons(offerId: string, runId: string, options: OfferRequestOptions = {}): Promise<OfferResult<OfferDeclineReasons>> {
    if (!this.identifier(offerId) || !this.identifier(runId)) return Promise.resolve(invalid('invalid-offer-selector'));
    return this.call((context) => `/offers/${encodeURIComponent(offerId)}/decision-reasons?runId=${encodeURIComponent(context.runId)}`,
      undefined, (value) => isOfferDeclineReasons(value) ? value : null, { offerId, runId }, options, runId,
      () => unavailable('invalid-offer-response'));
  }

  decide(input: OfferDecisionInput, options: OfferRequestOptions = {}): Promise<OfferResult<OfferDecisionReceipt>> {
    if (!isOfferDecisionInput(input)) return Promise.resolve(invalid('invalid-offer-decision'));
    const body = {
      commandId: input.commandId,
      runId: input.runId,
      decision: input.decision,
      ...(input.decision === 'decline' ? { reasonCode: input.reasonCode } : {}),
      expectedOfferVersion: input.expectedOfferVersion,
      expectedHoldVersion: input.expectedHoldVersion,
      expectedQuoteVersion: input.expectedQuoteVersion,
      ...(input.decision === 'accept' ? { termsDigest: input.termsDigest, declarations: { ...input.declarations } } : {}),
      ...(input.decision === 'accept' && input.expectedReturnMileage !== undefined
        ? { expectedReturnMileage: input.expectedReturnMileage } : {}),
    };
    return this.call(() => `/offers/${encodeURIComponent(input.offerId)}/decision`, body,
      (value, context) => parseOfferDecisionReceipt(value, input, context.employeeId!), input, options, input.runId,
      () => unavailable('invalid-offer-response'));
  }

  readFollowup(decisionId: string, options: OfferRequestOptions = {}): Promise<OfferResult<OfferFollowupValue>> {
    if (!this.identifier(decisionId)) return Promise.resolve(invalid('invalid-offer-followup-selector'));
    return this.call(() => `/offer-followup?decisionId=${encodeURIComponent(decisionId)}`, undefined,
      (value, context) => isOfferFollowupValue(value, decisionId, context.runId) ? value : null, { decisionId }, options, undefined,
      () => unavailable('invalid-offer-response'));
  }

  confirmFollowup(input: OfferFollowupConfirmInput, options: OfferRequestOptions = {}): Promise<OfferResult<OfferFollowupValue>> {
    if (!isOfferFollowupConfirmInput(input)) return Promise.resolve(invalid('invalid-offer-followup'));
    const body = {
      commandId: input.commandId,
      decisionId: input.decisionId,
      expectedBriefVersion: input.expectedBriefVersion,
      questionVersion: input.questionVersion,
      value: input.value,
    };
    return this.call(() => '/offer-followup/confirm', body,
      (value) => isOfferFollowupValue(value, input.decisionId) && value.state === 'change-saved' ? value : null,
      input, options, undefined, () => unavailable('invalid-offer-response'));
  }

  private identifier(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 128
      && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  }

  private capture(options: OfferRequestOptions): CapturedContext | OfferFailure {
    const state = this.auth.state();
    if (state.status === 'signed-out') return AUTH_REQUIRED;
    if (state.status !== 'ready') return unavailable('offer-context-unavailable');
    if (!employeeContext(state.context)) return EMPLOYEE_REQUIRED;
    const context = state.context;
    const key = keyOf(context);
    if (options.expectedContextKey !== undefined && options.expectedContextKey !== key) return unavailable('offer-cancelled');
    return { context, key };
  }

  private cancelled(captured: CapturedContext, options: OfferRequestOptions): boolean {
    if (options.signal?.aborted || options.expectedContextKey !== undefined && options.expectedContextKey !== captured.key) return true;
    const state = this.auth.state();
    return state.status !== 'ready' || !employeeContext(state.context) || keyOf(state.context) !== captured.key;
  }

  private async call<T>(
    path: (context: ApplicationContext) => string,
    body: object | undefined,
    parse: (value: unknown, context: ApplicationContext) => T | null,
    identity: { readonly runId?: string; readonly offerId?: string; readonly decisionId?: string; readonly commandId?: string },
    options: OfferRequestOptions,
    expectedRunId: string | undefined,
    malformed: () => OfferFailure,
  ): Promise<OfferResult<T>> {
    const captured = this.capture(options);
    if ('status' in captured) return captured;
    if (expectedRunId !== undefined && expectedRunId !== captured.context.runId) return invalid('offer-run-mismatch');
    if (this.cancelled(captured, options)) return unavailable('offer-cancelled');

    let token: string | null;
    try { token = await this.auth.getAccessToken(); } catch { return AUTH_REQUIRED; }
    if (this.cancelled(captured, options)) return unavailable('offer-cancelled');
    if (!token || /\s/.test(token)) return AUTH_REQUIRED;

    let config;
    try { config = await this.runtime.load(); } catch { return unavailable('offer-config-unavailable'); }
    if (this.cancelled(captured, options)) return unavailable('offer-cancelled');
    if (config.environmentId !== captured.context.environmentId) return unavailable('offer-config-unavailable');

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
    try {
      if (this.cancelled(captured, options)) return unavailable('offer-cancelled');
      const response = await this.fetcher(`${config.apiBaseUrl}${path(captured.context)}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let responseBody: unknown;
      try { responseBody = await response.json(); } catch { responseBody = undefined; }
      if (this.cancelled(captured, options)) return unavailable('offer-cancelled');

      if (response.status === 202) {
        const pending = parseOfferFailure(responseBody, identity);
        return pending?.status === 'pending' && this.pendingIdentityMatches(pending, captured.context, identity)
          ? pending : malformed();
      }
      if (response.status !== 200) return failureForStatus(response.status, responseBody, identity);
      if (!isRecord(responseBody) || Object.keys(responseBody).some((key) => !['status', 'value', 'contractVersion'].includes(key))
        || responseBody['status'] !== 'ok' || !Object.hasOwn(responseBody, 'value')
        || responseBody['contractVersion'] !== undefined && !this.identifier(responseBody['contractVersion'])) return malformed();
      const parsed = parse(responseBody['value'], captured.context);
      if (parsed === null) return malformed();
      return { status: 'ok', value: parsed, ...(responseBody['contractVersion'] === undefined
        ? {} : { contractVersion: responseBody['contractVersion'] as string }) };
    } catch {
      return unavailable('offer-unavailable');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  private pendingIdentityMatches(
    pending: OfferFailure,
    context: ApplicationContext,
    expected: { readonly runId?: string; readonly offerId?: string; readonly decisionId?: string; readonly commandId?: string },
  ): boolean {
    return (pending.runId === undefined || pending.runId === context.runId)
      && (pending.offerId === undefined || expected.offerId === pending.offerId)
      && (pending.decisionId === undefined || expected.decisionId === pending.decisionId)
      && (pending.commandId === undefined || expected.commandId === pending.commandId);
  }
}
