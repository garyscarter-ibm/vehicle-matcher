import { inject, Injectable } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { parseCaseDetail, parseCaseHelp, parseCaseList, parseCaseOptions } from './case.projection';
import type { CaseAudience, CaseDetailValue, CaseHelp, CaseList, CaseOptions, CaseRead, CaseScope, CaseStatus } from './case.types';

export interface CaseRequestOptions { readonly signal?: AbortSignal }
export interface HelpCaseInput { readonly commandId: string; readonly reason: string }
export type CaseCommandRemedy = { readonly type: 'manual-decision'; readonly decision: string }
  | { readonly type: 'contract-extension'; readonly until: string }
  | { readonly type: 'later-release'; readonly releaseAt: string; readonly source: string }
  | { readonly type: 'alternative-car'; readonly orderUuid: string };
export interface UpdateCaseInput {
  readonly commandId: string; readonly caseId: string; readonly expectedVersion: number;
  readonly status: CaseStatus; readonly reason: string; readonly nextAction: string;
  readonly dueAt: string; readonly remedy?: CaseCommandRemedy;
}
// Prepare after review; submit only on an explicit confirmation/retry. Reusing the
// same object sends identical bytes. A new intent requires a new caller commandId.
export interface HelpCaseCommand { readonly kind: 'request-help'; readonly input: HelpCaseInput }
export interface UpdateCaseCommand { readonly kind: 'update-case'; readonly input: UpdateCaseInput }
type Command = HelpCaseCommand | UpdateCaseCommand;
type Problem = 'authentication-required' | 'context-unavailable' | 'role-required' | 'context-changed'
  | 'invalid-command' | 'invalid-selector' | 'unrecognized-command' | 'configuration-unavailable'
  | 'environment-mismatch' | 'access-token-unavailable' | 'aborted' | 'timeout' | 'transport-unavailable';
interface RequestEvidence {
  readonly httpStatus?: number;
  // No automatic retry: unknown writes require current readback and deliberate
  // same-intent retry. This is local transport evidence, not a Java status.
  readonly writeOutcome?: 'not-sent' | 'unknown';
}
export interface CaseClientFailure extends RequestEvidence {
  readonly state: 'failed'; readonly value: null; readonly problem: Problem;
}
export type CaseClientResult<T> = (CaseRead<T> & RequestEvidence) | CaseClientFailure;
type ReadySession = Extract<SessionState, { status: 'ready' }>;
interface CapturedScope {
  readonly session: ReadySession; readonly key: string; readonly scope: CaseScope;
}
interface Intent { readonly captured: CapturedScope; readonly body: string }
type Parser<T> = (body: unknown, scope: CaseScope) => CaseRead<T>;
const timeoutMs = 10_000;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(v).every((key) => keys.includes(key));
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const identifier = (v: unknown): v is string => text(v, 128) && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const instant = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const calendar = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v)
  && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const failed = (problem: Problem, evidence: RequestEvidence = {}): CaseClientFailure => ({ state: 'failed', value: null, problem, ...evidence });
const malformed = (evidence: RequestEvidence): CaseClientResult<never> => ({ state: 'invalid-response', value: null, ...evidence });

function contextKey(c: ApplicationContext): string {
  return JSON.stringify([c.subject, c.environmentId, c.runId, c.employeeId, c.policyVersion, [...c.roles].sort()]);
}
function validRemedy(v: unknown): v is CaseCommandRemedy {
  if (!object(v)) return false;
  switch (v['type']) {
    case 'manual-decision': return only(v, ['type', 'decision']) && text(v['decision'], 2000);
    case 'contract-extension': return only(v, ['type', 'until']) && calendar(v['until']);
    case 'later-release': return only(v, ['type', 'releaseAt', 'source']) && instant(v['releaseAt']) && text(v['source'], 2000);
    case 'alternative-car': return only(v, ['type', 'orderUuid']) && identifier(v['orderUuid']);
    default: return false;
  }
}
function validUpdate(v: unknown): v is UpdateCaseInput {
  return object(v) && only(v, ['commandId', 'caseId', 'expectedVersion', 'status', 'reason', 'nextAction', 'dueAt', 'remedy'])
    && identifier(v['commandId']) && identifier(v['caseId']) && Number.isSafeInteger(v['expectedVersion']) && (v['expectedVersion'] as number) > 0
    && ['open', 'in-progress', 'remedy-proposed', 'resolved', 'closed'].includes(v['status'] as string)
    && text(v['reason'], 2000) && text(v['nextAction'], 2000) && instant(v['dueAt'])
    && (v['remedy'] === undefined || validRemedy(v['remedy']));
}
function matchesHttp(http: number, status: string): boolean {
  return ({ 400: ['invalid'], 401: ['unauthenticated'], 403: ['forbidden'], 404: ['not-found'],
    409: ['stale-version', 'conflict'], 503: ['unavailable'] } as Record<number, readonly string[]>)[http]?.includes(status) === true;
}

@Injectable({ providedIn: 'root' })
export class CaseClient {
  private readonly auth = inject(AuthPort);
  private readonly runtime = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);
  private readonly intents = new WeakMap<Command, Intent>();

  readHelp(options: CaseRequestOptions = {}): Promise<CaseClientResult<CaseHelp>> {
    return this.request('employee', '/help', parseCaseHelp, options);
  }
  readOwnCases(options: CaseRequestOptions = {}): Promise<CaseClientResult<CaseList>> {
    return this.request('employee', '/cases', parseCaseList, options);
  }
  readOwnCase(caseId: string, options: CaseRequestOptions = {}): Promise<CaseClientResult<CaseDetailValue>> {
    if (!identifier(caseId)) return Promise.resolve(failed('invalid-selector'));
    return this.request('employee', `/cases?caseId=${encodeURIComponent(caseId)}`, (body, scope): CaseRead<CaseDetailValue> => {
      const result = parseCaseDetail(body, scope, caseId);
      return result.state === 'ready' && (result.value.asOf === undefined || result.value.policyVersion === undefined)
        ? { state: 'invalid-response', value: null } : result;
    }, options);
  }
  readQueue(options: CaseRequestOptions = {}): Promise<CaseClientResult<CaseList>> {
    return this.request('scheme-team', '/scheme-team/cases', parseCaseList, options);
  }
  readOptions(caseId: string, options: CaseRequestOptions = {}): Promise<CaseClientResult<CaseOptions>> {
    if (!identifier(caseId)) return Promise.resolve(failed('invalid-selector'));
    return this.request('scheme-team', `/scheme-team/cases/options?caseId=${encodeURIComponent(caseId)}`,
      (body, scope) => parseCaseOptions(body, scope, caseId), options);
  }

  prepareHelp(input: HelpCaseInput): HelpCaseCommand | CaseClientFailure {
    const captured = this.capture('employee');
    if ('state' in captured) return captured;
    if (!object(input) || !only(input, ['commandId', 'reason']) || !identifier(input.commandId) || !text(input.reason, 2000)) {
      return failed('invalid-command', { writeOutcome: 'not-sent' });
    }
    const command: HelpCaseCommand = Object.freeze({ kind: 'request-help', input: Object.freeze({ commandId: input.commandId, reason: input.reason }) });
    this.intents.set(command, { captured, body: JSON.stringify(command.input) });
    return command;
  }
  prepareUpdate(input: UpdateCaseInput): UpdateCaseCommand | CaseClientFailure {
    const captured = this.capture('scheme-team');
    if ('state' in captured) return captured;
    if (!validUpdate(input)) return failed('invalid-command', { writeOutcome: 'not-sent' });
    const snapshot: UpdateCaseInput = Object.freeze({ commandId: input.commandId, caseId: input.caseId, expectedVersion: input.expectedVersion,
      status: input.status, reason: input.reason, nextAction: input.nextAction, dueAt: input.dueAt,
      ...(input.remedy === undefined ? {} : { remedy: Object.freeze({ ...input.remedy }) }) });
    const command: UpdateCaseCommand = Object.freeze({ kind: 'update-case', input: snapshot });
    this.intents.set(command, { captured, body: JSON.stringify(snapshot) });
    return command;
  }
  requestHelp(command: HelpCaseCommand, options: CaseRequestOptions = {}): Promise<CaseClientResult<CaseDetailValue>> {
    return this.submit(command, 'request-help', '/cases', options);
  }
  updateCase(command: UpdateCaseCommand, options: CaseRequestOptions = {}): Promise<CaseClientResult<CaseDetailValue>> {
    return this.submit(command, 'update-case', '/scheme-team/cases/update', options);
  }

  private submit(command: Command, kind: Command['kind'], path: string, options: CaseRequestOptions): Promise<CaseClientResult<CaseDetailValue>> {
    const intent = command && this.intents.get(command);
    if (!intent || command.kind !== kind) return Promise.resolve(failed('unrecognized-command', { writeOutcome: 'not-sent' }));
    const expected = command.kind === 'update-case' ? command.input.caseId : undefined;
    return this.request(intent.captured.scope.audience, path, (body, scope) => parseCaseDetail(body, scope, expected), options, intent);
  }
  private capture(audience: CaseAudience): CapturedScope | CaseClientFailure {
    const session = this.auth.state();
    if (session.status !== 'ready') return failed(session.status === 'signed-out' ? 'authentication-required' : 'context-unavailable');
    const c = session.context;
    if (!c.roles.includes(audience === 'employee' ? 'employee' : 'greg')) return failed('role-required');
    if (![c.subject, c.environmentId, c.runId, c.policyVersion].every((value) => text(value, 2048))
      || audience === 'employee' && !text(c.employeeId, 2048)) return failed('context-unavailable');
    const scope: CaseScope = audience === 'employee'
      ? Object.freeze({ audience, runId: c.runId, employeeId: c.employeeId! }) : Object.freeze({ audience, runId: c.runId });
    return { session, key: contextKey(c), scope };
  }
  private same(captured: CapturedScope): boolean {
    const current = this.auth.state();
    // OIDC publishes a new ready session after sign-in/retry/context replacement.
    // Compare its identity too: A -> B -> a new A must not revive an old result.
    return current === captured.session && current.status === 'ready' && contextKey(current.context) === captured.key;
  }

  private async request<T>(audience: CaseAudience, path: string, parse: Parser<T>, options: CaseRequestOptions, intent?: Intent): Promise<CaseClientResult<T>> {
    const captured = intent?.captured ?? this.capture(audience);
    if ('state' in captured) return intent ? { ...captured, writeOutcome: 'not-sent' } : captured;
    const controller = new AbortController();
    let timedOut = false; let dispatched = false; let httpStatus: number | undefined;
    const evidence = (): RequestEvidence => ({ ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(intent ? { writeOutcome: dispatched ? 'unknown' as const : 'not-sent' as const } : {}) });
    const stopped = (): CaseClientFailure | null => controller.signal.aborted ? failed(timedOut ? 'timeout' : 'aborted', evidence())
      : !this.same(captured) ? failed('context-changed', evidence()) : null;
    const abort = () => controller.abort();
    const interrupted = new Promise<CaseClientFailure>((resolve) => controller.signal.addEventListener('abort', () => {
      resolve(failed(timedOut ? 'timeout' : 'aborted', evidence()));
    }, { once: true }));
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    if (options.signal?.aborted) controller.abort();
    const work = async (): Promise<CaseClientResult<T>> => {
      try {
        const before = stopped(); if (before) return before;
        let config;
        try { config = await this.runtime.load(); } catch { return stopped() ?? failed('configuration-unavailable', evidence()); }
        const afterConfig = stopped(); if (afterConfig) return afterConfig;
        if (config.environmentId !== captured.session.context.environmentId) return failed('environment-mismatch', evidence());
        let token: string | null;
        try { token = await this.auth.getAccessToken(); } catch { return stopped() ?? failed('access-token-unavailable', evidence()); }
        const afterToken = stopped(); if (afterToken) return afterToken;
        if (!text(token, 8192) || /\s/.test(token)) return failed('access-token-unavailable', evidence());
        dispatched = true;
        const response = await this.fetcher(`${config.apiBaseUrl.replace(/\/+$/, '')}${path}`, {
          method: intent ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(intent ? { 'Content-Type': 'application/json' } : {}) },
          ...(intent ? { body: intent.body } : {}),
        });
        httpStatus = response.status;
        const afterHeaders = stopped(); if (afterHeaders) return afterHeaders;
        let body: unknown;
        try { body = await response.json(); } catch { return stopped() ?? malformed({ httpStatus, ...evidence() }); }
        const afterBody = stopped(); if (afterBody) return afterBody;
        const result = parse(body, captured.scope);
        if (response.status === 200 && response.ok && result.state === 'ready') return { ...result, httpStatus };
        if (result.state === 'refused' && matchesHttp(response.status, result.refusal.status)) {
          return { ...result, httpStatus, ...(intent && result.refusal.code === 'outcome-uncertain' ? { writeOutcome: 'unknown' as const } : {}) };
        }
        if (result.state === 'scope-mismatch') return { ...result, httpStatus, ...evidence() };
        return malformed({ httpStatus, ...evidence() });
      } catch {
        return stopped() ?? failed('transport-unavailable', { ...(httpStatus === undefined ? {} : { httpStatus }), ...evidence() });
      }
    };
    // Some fetch/token/body implementations ignore AbortSignal. Race the entire
    // chain and recheck before every later side effect or private result.
    try { return await Promise.race([work(), interrupted]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}
