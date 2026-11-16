import { inject, Injectable } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { parseGregDemand, parseGregPolicy, parseGregPreview, parseGregPublished } from './greg.projection';
import type { GregDemand, GregPolicy, GregPreview, GregPreviewInput, GregPublished, GregPublishInput,
  GregRequestEvidence, GregRequestOptions, GregResult } from './greg.types';

type ReadySession = Extract<SessionState, { status: 'ready' }>;
interface Captured { readonly session: ReadySession; readonly key: string }
interface Intent { readonly captured: Captured; readonly body: string }
export interface GregPublishCommand { readonly kind: 'publish-policy'; readonly input: GregPublishInput }
type Failure = Extract<GregResult<never>, { state: 'failed' }>;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (o: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(o).every(k => allowed.includes(k));
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const failed = (problem: string, evidence: GregRequestEvidence = {}): Failure => ({ state: 'failed', value: null, problem, ...evidence });
export function gregContextKey(c: ApplicationContext): string { return JSON.stringify([c.subject, c.environmentId, c.runId, c.policyVersion, [...c.roles].sort()]); }
export function gregSession(session: SessionState): session is ReadySession {
  return session.status === 'ready' && session.context.roles.includes('greg') && !session.context.roles.includes('presenter')
    && [session.context.subject, session.context.environmentId, session.context.runId, session.context.policyVersion].every(v => text(v, 2048));
}
export function validGregChanges(input: unknown): input is GregPreviewInput {
  if (!object(input) || !text(input['expectedActiveVersion']) || !Array.isArray(input['changes']) || !input['changes'].length || input['changes'].length > 100) return false;
  const seen = new Set<string>();
  return input['changes'].every((v: unknown) => {
    if (!object(v) || !only(v, ['id', 'value']) || !text(v['id']) || !/^(?:price|weight):.+/.test(v['id'])
      || typeof v['value'] !== 'number' || !Number.isSafeInteger(v['value']) || v['value'] < 0 || seen.has(v['id'])) return false;
    seen.add(v['id']); return true;
  });
}
const freezeInput = (input: GregPreviewInput): GregPreviewInput => Object.freeze({ expectedActiveVersion: input.expectedActiveVersion,
  changes: Object.freeze(input.changes.map(c => Object.freeze({ id: c.id, value: c.value }))) });
const matchesHttp = (http: number, status: string): boolean => ({ 400: ['invalid'], 401: ['unauthenticated'], 403: ['forbidden'],
  409: ['stale-version', 'stale-run', 'conflict'], 422: ['unsupported'], 503: ['unavailable'], 202: ['uncertain'] } as Record<number, readonly string[]>)[http]?.includes(status) === true;

@Injectable({ providedIn: 'root' })
export class GregClient {
  private readonly auth = inject(AuthPort);
  private readonly runtime = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);
  private readonly intents = new WeakMap<GregPublishCommand, Intent>();

  loadDemand(options: GregRequestOptions = {}): Promise<GregResult<GregDemand>> {
    return this.request('/greg/demand', (body, scope) => parseGregDemand(body, scope.session.context.runId, scope.session.context.policyVersion), options);
  }
  readPolicy(options: GregRequestOptions = {}): Promise<GregResult<GregPolicy>> { return this.request('/greg/policy', parseGregPolicy, options); }
  preview(input: GregPreviewInput, options: GregRequestOptions = {}): Promise<GregResult<GregPreview>> {
    if (!object(input) || !only(input, ['expectedActiveVersion', 'changes']) || !validGregChanges(input)) return Promise.resolve(failed('invalid-command'));
    return this.request('/greg/policy/preview', parseGregPreview, options, { body: JSON.stringify(freezeInput(input)) });
  }
  preparePublish(input: GregPublishInput): GregPublishCommand | Failure {
    const captured = this.capture(); if ('state' in captured) return { ...captured, writeOutcome: 'not-sent' };
    if (!object(input) || !only(input, ['commandId', 'expectedActiveVersion', 'policyVersion', 'effectiveFrom', 'changes'])
      || !validGregChanges(input) || !text(input.commandId) || !text(input.policyVersion) || input.policyVersion === input.expectedActiveVersion
      || !text(input.effectiveFrom) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(input.effectiveFrom)
      || !Number.isFinite(Date.parse(input.effectiveFrom))) return failed('invalid-command', { writeOutcome: 'not-sent' });
    const command: GregPublishCommand = Object.freeze({ kind: 'publish-policy', input: Object.freeze({ ...freezeInput(input),
      commandId: input.commandId, policyVersion: input.policyVersion, effectiveFrom: input.effectiveFrom }) });
    this.intents.set(command, { captured, body: JSON.stringify(command.input) }); return command;
  }
  publish(command: GregPublishCommand, options: GregRequestOptions = {}): Promise<GregResult<GregPublished>> {
    const intent = command && this.intents.get(command);
    if (!intent || command.kind !== 'publish-policy') return Promise.resolve(failed('unrecognized-command', { writeOutcome: 'not-sent' }));
    return this.request('/greg/policy/publish', parseGregPublished, options, intent, true);
  }
  private capture(): Captured | Failure {
    const session = this.auth.state();
    if (!gregSession(session)) return failed(session.status === 'signed-out' ? 'authentication-required'
      : session.status === 'ready' || session.status === 'denied' ? 'role-required' : 'context-unavailable');
    return { session, key: gregContextKey(session.context) };
  }
  private same(c: Captured): boolean {
    const current = this.auth.state();
    return current === c.session && gregSession(current) && gregContextKey(current.context) === c.key;
  }
  private async request<T>(path: string, parse: (body: unknown, scope: Captured) => GregResult<T>, options: GregRequestOptions,
    input?: { readonly body: string; readonly captured?: Captured }, writing = false): Promise<GregResult<T>> {
    const captured = input?.captured ?? this.capture();
    if ('state' in captured) return { ...captured, ...(writing ? { writeOutcome: 'not-sent' as const } : {}) };
    const controller = new AbortController(); let timedOut = false; let sent = false; let httpStatus: number | undefined;
    const evidence = (): GregRequestEvidence => ({ ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(writing ? { writeOutcome: sent ? 'unknown' as const : 'not-sent' as const } : {}) });
    const stopped = (): Failure | null => controller.signal.aborted ? failed(timedOut ? 'timeout' : 'aborted', evidence())
      : !this.same(captured) ? failed('context-changed', evidence()) : null;
    const abort = () => controller.abort();
    const interrupted = new Promise<Failure>(resolve => controller.signal.addEventListener('abort', () => resolve(failed(timedOut ? 'timeout' : 'aborted', evidence())), { once: true }));
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    if (options.signal?.aborted) controller.abort();
    const work = async (): Promise<GregResult<T>> => {
      try {
        const initial = stopped(); if (initial) return initial;
        let config;
        try { config = await this.runtime.load(); } catch { return stopped() ?? failed('configuration-unavailable', evidence()); }
        const afterConfig = stopped(); if (afterConfig) return afterConfig;
        if (config.environmentId !== captured.session.context.environmentId || !config.apiBaseUrl.replace(/\/+$/, '').endsWith('/api/gcsp/v1')) return failed('environment-mismatch', evidence());
        let token: string | null;
        try { token = await this.auth.getAccessToken(); } catch { return stopped() ?? failed('access-token-unavailable', evidence()); }
        const afterToken = stopped(); if (afterToken) return afterToken;
        if (!text(token, 8192) || /\s/.test(token)) return failed('access-token-unavailable', evidence());
        sent = true;
        const response = await this.fetcher(`${config.apiBaseUrl.replace(/\/+$/, '')}${path}`, { method: input ? 'POST' : 'GET',
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
          ...(input ? { body: input.body } : {}) });
        httpStatus = response.status;
        const afterHeaders = stopped(); if (afterHeaders) return afterHeaders;
        let body: unknown;
        try { body = await response.json(); } catch { return stopped() ?? { state: 'invalid-response', value: null, ...evidence() }; }
        const afterBody = stopped(); if (afterBody) return afterBody;
        const result = parse(body, captured);
        if (response.status === 200 && response.ok && result.state === 'ready') return { ...result, httpStatus };
        if (result.state === 'refused' && matchesHttp(response.status, result.refusal.status)) return { ...result, httpStatus,
          ...(writing && (response.status === 202 || response.status === 503) ? { writeOutcome: 'unknown' as const } : {}) };
        return { state: result.state === 'scope-mismatch' ? 'scope-mismatch' : 'invalid-response', value: null, ...evidence() };
      } catch { return stopped() ?? failed('transport-unavailable', evidence()); }
    };
    try { return await Promise.race([work(), interrupted]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}
