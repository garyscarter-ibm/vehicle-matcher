import { inject, Injectable } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';

export interface OutboxMessage {
  readonly jobId: string;
  readonly messageKind: string;
  readonly state: string;
  readonly transport: 'captured' | 'configured' | null;
  readonly attempts: number;
  readonly error: string | null;
  readonly nextAttemptAt: string | null;
  readonly time: string | null;
  readonly recipient: { readonly employeeId: string; readonly name: string | null };
  readonly subject: string | null;
  readonly textBody: string | null;
  readonly htmlBody: string | null;
  readonly offerLink: string | null;
}
export interface OutboxProjection { readonly runId: string; readonly messages: readonly OutboxMessage[] }
export type OutboxResult = { readonly status: 'ok'; readonly value: OutboxProjection }
  | { readonly status: 'authentication-required' | 'forbidden' | 'stale-run' | 'account-changed' | 'unavailable' | 'aborted';
    readonly code: string; readonly retryable: boolean };
type Failure = Exclude<OutboxResult, { readonly status: 'ok' }>;
type RecordValue = Record<string, unknown>;

function object(value: unknown): value is RecordValue { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
function nullableText(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function code(value: unknown): value is string { return typeof value === 'string' && /^[a-z][a-z0-9._-]{0,127}$/i.test(value); }
function instant(value: unknown): value is string | null {
  return value === null || text(value) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function failure(status: Failure['status'], code: string, retryable = false): Failure { return { status, code, retryable }; }

function message(value: unknown): OutboxMessage | null {
  if (!object(value) || !text(value['jobId']) || !text(value['messageKind']) || !text(value['state'])
    || ![null, 'captured', 'configured'].includes(value['transport'] as string | null)
    || !Number.isSafeInteger(value['attempts']) || (value['attempts'] as number) < 0
    || !(value['error'] === null || typeof value['error'] === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value['error']))
    || !instant(value['nextAttemptAt']) || !instant(value['time']) || !object(value['recipient'])
    || !text(value['recipient']['employeeId']) || !nullableText(value['recipient']['name'])
    || !nullableText(value['subject']) || !nullableText(value['textBody']) || !nullableText(value['htmlBody'])
    || !nullableText(value['offerLink'])) return null;
  // Only the public OutboxView fields cross into presentation state.
  return { jobId: value['jobId'], messageKind: value['messageKind'], state: value['state'],
    transport: value['transport'] as OutboxMessage['transport'], attempts: value['attempts'] as number,
    error: value['error'], nextAttemptAt: value['nextAttemptAt'], time: value['time'],
    recipient: { employeeId: value['recipient']['employeeId'], name: value['recipient']['name'] },
    subject: value['subject'], textBody: value['textBody'], htmlBody: value['htmlBody'], offerLink: value['offerLink'] };
}

function scoped(value: unknown, environmentId: string, runId: string): boolean {
  if (Array.isArray(value)) return value.every((entry) => scoped(entry, environmentId, runId));
  return !object(value) || Object.entries(value).every(([key, entry]) => key === 'runId' ? entry === runId
    : key === 'environmentId' ? entry === environmentId : scoped(entry, environmentId, runId));
}

function responseFailure(status: number, body: unknown): Failure {
  const resultStatus: Failure['status'] = status === 401 ? 'authentication-required' : status === 403 ? 'forbidden'
    : status === 409 ? 'stale-run' : 'unavailable';
  if (object(body) && (body['code'] !== undefined && !code(body['code'])
    || body['retryable'] !== undefined && typeof body['retryable'] !== 'boolean')) {
    return failure('unavailable', 'outbox-response-invalid');
  }
  return failure(resultStatus, object(body) && code(body['code']) ? body['code'] : resultStatus,
    object(body) && typeof body['retryable'] === 'boolean' ? body['retryable'] : resultStatus === 'unavailable');
}

/** Presenter inspection only: no command, selector, recipient address or employee authority. */
@Injectable({ providedIn: 'root' })
export class OutboxClient {
  private readonly auth = inject(AuthPort);
  private readonly config = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);

  async read(options: { readonly signal?: AbortSignal } = {}): Promise<OutboxResult> {
    const session = this.auth.state();
    if (session.status !== 'ready') return failure('authentication-required', 'presenter-sign-in-required');
    if (!session.context.roles.includes('presenter')) return failure('forbidden', 'presenter-role-required');
    const { subject, environmentId, runId } = session.context;
    if (![subject, environmentId, runId].every(text)) return failure('unavailable', 'outbox-context-invalid');
    if (options.signal?.aborted) return failure('aborted', 'outbox-request-aborted');
    const controller = new AbortController(); let timedOut = false;
    const interruption = (): Failure | null => {
      const current = this.auth.state();
      if (current !== session || current.status !== 'ready' || current.context !== session.context
        || current.context.subject !== subject || current.context.environmentId !== environmentId
        || current.context.runId !== runId || !current.context.roles.includes('presenter')) {
        return failure('account-changed', 'outbox-context-changed');
      }
      return controller.signal.aborted
        ? failure(timedOut ? 'unavailable' : 'aborted', timedOut ? 'outbox-timeout' : 'outbox-request-aborted', timedOut) : null;
    };
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const stopped = new Promise<Failure>((resolve) => controller.signal.addEventListener('abort', () => {
      resolve(interruption() ?? failure('aborted', 'outbox-request-aborted'));
    }, { once: true }));
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
    const request = async (): Promise<OutboxResult> => {
      try {
        const config = await this.config.load();
        let interrupted = interruption(); if (interrupted) return interrupted;
        if (config.environmentId !== environmentId) return failure('unavailable', 'outbox-environment-mismatch');
        let token: string | null;
        try { token = await this.auth.getAccessToken(); }
        catch { return interruption() ?? failure('authentication-required', 'presenter-sign-in-required'); }
        interrupted = interruption(); if (interrupted) return interrupted;
        if (!token || /\s/.test(token)) return failure('authentication-required', 'presenter-sign-in-required');
        const response = await this.fetcher(`${config.apiBaseUrl}/presenter/outbox`, {
          method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        });
        interrupted = interruption(); if (interrupted) return interrupted;
        let envelope: unknown;
        try { envelope = await response.json(); } catch { envelope = null; }
        interrupted = interruption(); if (interrupted) return interrupted;
        if (!scoped(envelope, environmentId, runId)) return failure('unavailable', 'outbox-response-scope-mismatch');
        if (response.status !== 200) return responseFailure(response.status, envelope);
        if (!object(envelope) || envelope['status'] !== 'ok' || !object(envelope['value'])
          || envelope['value']['runId'] !== runId || !Array.isArray(envelope['value']['messages'])
          || envelope['value']['messages'].length > 500) return failure('unavailable', 'outbox-response-invalid');
        const messages = envelope['value']['messages'].map(message);
        if (messages.some((entry) => entry === null) || new Set(messages.map((entry) => entry?.jobId)).size !== messages.length) {
          return failure('unavailable', 'outbox-response-invalid');
        }
        return { status: 'ok', value: { runId, messages: messages as OutboxMessage[] } };
      } catch { return interruption() ?? failure('unavailable', 'outbox-transport-unavailable', true); }
    };
    try { return await Promise.race([request(), stopped]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}
