import { inject, Injectable } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { record, text, validPlanValue, validProduction, validSubmission, versionPins } from './planning.projection';
import { PlanChange, PlanningFailure, PlanningFailureStatus, PlanningOptions, PlanningResult, PlanValueDto,
  ProductionCommand, ProductionSubmissionDto, ProductionValueDto } from './planning.types';

const exactKeys = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => record(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const whole = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;
function validChanges(v: unknown): v is readonly PlanChange[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 3 && v.every(c => {
    if (!exactKeys(c, ['key', 'value'])) return false;
    if (c['key'] === 'orderPlan.budgetMinor') return whole(c['value']);
    const id = c['key'] === 'orderPlan.modelBounds' ? 'modelId' : c['key'] === 'orderPlan.derivativeBounds' ? 'derivativeId' : null;
    return !!id && Array.isArray(c['value']) && c['value'].every(b => exactKeys(b, [id, 'min', 'max'])
      && text(b[id]) && whole(b['min']) && whole(b['max']) && (b['min'] as number) <= (b['max'] as number));
  }) && new Set(v.map(c => c.key)).size === v.length;
}
const failure = (status: PlanningFailureStatus, code: string, reason: string, retryable = false): PlanningFailure => ({ status, code, reason, retryable });
const unavailable = (): PlanningFailure => failure('unavailable', 'planning-transport-unavailable', 'Planning could not be reached. Try again.', true);
const authentication = (): PlanningFailure => failure('authentication-required', 'authentication-required', 'Sign in again to continue.');
const changed = (): PlanningFailure => failure('context-changed', 'planning-context-changed', 'Your account or planning context changed. Refresh the plan.');
const uncertain = (): PlanningFailure => failure('uncertain', 'outcome-uncertain', 'The result is not known. Retry the same request to continue without duplicates.');
const statuses: readonly PlanningFailureStatus[] = ['invalid', 'forbidden', 'not-found', 'conflict', 'stale-version', 'stale-run',
  'unsupported', 'unavailable', 'unauthenticated', 'authentication-required', 'pending', 'uncertain', 'refused'];

@Injectable({ providedIn: 'root' })
export class PlanningClient {
  private readonly auth = inject(AuthPort);
  private readonly config = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);

  readPlan(options: PlanningOptions = {}): Promise<PlanningResult<PlanValueDto>> {
    return this.request('greg/order-plan', validPlanValue, options);
  }
  previewPlan(changes: readonly PlanChange[], options: PlanningOptions = {}): Promise<PlanningResult<PlanValueDto>> {
    if (!validChanges(changes)) return Promise.resolve(failure('invalid', 'invalid-changes', 'Check the editable limits and try again.'));
    return this.request('greg/order-plan/preview', validPlanValue, options, { changes: structuredClone(changes) });
  }
  readProduction(options: PlanningOptions = {}): Promise<PlanningResult<ProductionValueDto>> {
    return this.request('greg/orders', validProduction, options);
  }
  submit(input: ProductionCommand, options: PlanningOptions = {}): Promise<PlanningResult<ProductionSubmissionDto>> {
    if (!exactKeys(input, ['commandId', 'planId', 'versions']) || !text(input['commandId']) || input['commandId'].length > 200
      || !text(input['planId']) || input['planId'].length > 512 || !versionPins(input['versions'])) {
      return Promise.resolve(failure('invalid', 'invalid-production-command', 'Supply the current plan and its unchanged input versions.'));
    }
    return this.request('greg/production/requests', validSubmission, options, structuredClone(input), true);
  }
  submitManual(input: { readonly commandId: string; readonly model: string; readonly derivative: string; readonly quantity: number;
    readonly expectedPolicyVersion: string; readonly expectedStockVersion: string }, options: PlanningOptions = {}): Promise<PlanningResult<ProductionSubmissionDto>> {
    if (!exactKeys(input, ['commandId', 'model', 'derivative', 'quantity', 'expectedPolicyVersion', 'expectedStockVersion'])
      || !['commandId', 'model', 'derivative', 'expectedPolicyVersion', 'expectedStockVersion'].every(k => text(input[k as keyof typeof input]) && String(input[k as keyof typeof input]).length <= 200)
      || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000) {
      return Promise.resolve(failure('invalid', 'invalid-manual-request', 'Choose a car and a whole quantity from 1 to 1000.'));
    }
    return this.request('greg/orders', validSubmission, options, structuredClone(input), true);
  }
  queue(input: { readonly commandId: string; readonly requestId: string }, options: PlanningOptions = {}): Promise<PlanningResult<{ readonly requestId: string }>> {
    if (!exactKeys(input, ['commandId', 'requestId']) || ![input.commandId, input.requestId].every(v => text(v) && v.length <= 200)) {
      return Promise.resolve(failure('invalid', 'invalid-queue-request', 'Choose the confirmed request to queue.'));
    }
    return this.request('greg/orders/queue', (v): v is { readonly requestId: string } => record(v) && v['requestId'] === input.requestId && Array.isArray(v['queued']), options, structuredClone(input), true);
  }
  private scope(): string | null {
    const state = this.auth.state();
    return state.status === 'ready' && state.context.roles.includes('greg')
      ? JSON.stringify([state.context.subject, state.context.environmentId, state.context.runId, state.context.policyVersion]) : null;
  }
  private async request<T>(path: string, valid: (v: unknown) => v is T, options: PlanningOptions,
    body?: unknown, command = false): Promise<PlanningResult<T>> {
    const initial = this.scope(); if (!initial) return authentication();
    const state = this.auth.state(); if (state.status !== 'ready') return authentication();
    const context = state.context;
    if (options.signal?.aborted) return failure('aborted', 'planning-request-aborted', 'Request cancelled.');
    const controller = new AbortController(); let sent = false;
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 10000);
    options.signal?.addEventListener('abort', abort, { once: true });
    const stopped = new Promise<PlanningFailure>(resolve => controller.signal.addEventListener('abort', () => resolve(command && sent
      ? uncertain() : options.signal?.aborted ? failure('aborted', 'planning-request-aborted', 'Request cancelled.') : unavailable()), { once: true }));
    const run = async (): Promise<PlanningResult<T>> => {
      try {
        const config = await this.config.load();
        if (initial !== this.scope()) return changed();
        if (config.environmentId !== context.environmentId) return failure('unavailable', 'planning-environment-mismatch', 'Planning is not available for this environment.');
        const token = await this.auth.getAccessToken();
        if (initial !== this.scope()) return changed();
        if (!token || /\s/.test(token)) return authentication();
        if (controller.signal.aborted) return failure('aborted', 'planning-request-aborted', 'Request cancelled.');
        sent = true;
        const response = await this.fetcher(`${config.apiBaseUrl}/${path}`, { method: body === undefined ? 'GET' : 'POST',
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (initial !== this.scope()) return changed();
        let payload: unknown; try { payload = await response.json(); } catch { payload = null; }
        if (initial !== this.scope()) return changed();
        if (response.status === 401) return { ...authentication(), httpStatus: 401 };
        if (response.status === 403) return { ...failure('forbidden', 'role-required', 'Your account cannot use this action.'), httpStatus: 403 };
        if (response.status === 200 && record(payload) && payload['status'] === 'ok' && valid(payload['value'])) {
          if (validPlanValue(payload['value'])) {
            const value = payload['value'];
            if (value.plan.runId !== context.runId || value.mode === 'current' && value.plan.versions['policy'] !== context.policyVersion
              || value.mode === 'preview' && (value.activePlan?.runId !== context.runId || value.activePlan?.versions['policy'] !== context.policyVersion
                || value['activePolicyVersion'] !== context.policyVersion)) return changed();
            if (path === 'greg/order-plan' && value.mode !== 'current' || path === 'greg/order-plan/preview' && value.mode !== 'preview') return changed();
          }
          return { status: 'ok', value: payload['value'], httpStatus: response.status };
        }
        if (record(payload) && statuses.includes(payload['status'] as PlanningFailureStatus) && payload['status'] !== 'pending'
          && response.status >= 400 || record(payload) && response.status === 202 && payload['status'] === 'pending') {
          const p = payload as Record<string, unknown>;
          return { status: p['status'] as PlanningFailureStatus, httpStatus: response.status,
            ...(text(p['code']) ? { code: p['code'] } : {}), ...(text(p['reason']) ? { reason: p['reason'] } : {}),
            ...(typeof p['retryable'] === 'boolean' ? { retryable: p['retryable'] } : {}),
            ...(text(p['operationId']) ? { operationId: p['operationId'] } : {}),
            ...(Array.isArray(p['changedInputs']) ? { changedInputs: p['changedInputs'].filter(text) } : {}),
            ...(Array.isArray(p['reasons']) ? { reasons: p['reasons'].filter(record).filter(r => text(r['field']) && text(r['reason']))
              .map(r => ({ field: String(r['field']), reason: String(r['reason']) })) } : {}),
            ...(Object.hasOwn(p, 'value') ? { value: structuredClone(p['value']) } : {}),
            ...(Object.hasOwn(p, 'current') ? { current: structuredClone(p['current']) } : {}), details: structuredClone(p) };
        }
        if (command && (response.status < 400 || response.status >= 500)) return { ...uncertain(), httpStatus: response.status };
        const mapped: PlanningFailureStatus = response.status === 409 ? 'conflict' : response.status === 400 ? 'invalid'
          : response.status === 404 ? 'not-found' : response.status === 422 ? 'unsupported' : 'unavailable';
        return { ...failure(mapped, 'planning-response-unreadable', 'The service response could not be read. Refresh before continuing.', mapped === 'unavailable'), httpStatus: response.status };
      } catch { return initial !== this.scope() ? changed() : command && sent ? uncertain() : unavailable(); }
    };
    try { return await Promise.race([run(), stopped]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}
