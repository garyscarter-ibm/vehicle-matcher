import { parseRelease, parseSuitability } from './presenter.projections';
import { inject, Injectable } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { publishPresenterAction } from '../kit/presenter-actions';
import type {
  PresenterAdvance, PresenterAdvanceInput, PresenterCatalogue, PresenterClientFailure, PresenterClock,
  PresenterCommand, PresenterCommandValue, PresenterControls, PresenterControlTickInput, PresenterCurrentScenario,
  PresenterEvidence, PresenterFault, PresenterFaultInput, PresenterFaults, PresenterRefusal, PresenterRequestOptions,
  PresenterReset, PresenterResetInput, PresenterResult, PresenterScenario, PresenterScenarioSummary, PresenterTick, PresenterTickInput,
} from './presenter.types';

type ReadySession = Extract<SessionState, { status: 'ready' }>;
interface Scope { readonly session: ReadySession; readonly key: string; readonly environmentId: string; readonly runId: string }
interface Intent { readonly scope: Scope; readonly body: string }
type Parser<T> = (value: unknown) => T | null;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const id = (v: unknown, max = 128): v is string => text(v, max) && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const only = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every((key) => keys.includes(key));
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => text(s));
const instant = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const named = (v: unknown): v is Record<string, string> => object(v) && Object.entries(v).every(([k, at]) => text(k) && instant(at));
const failed = (problem: string, evidence: PresenterEvidence = {}): PresenterClientFailure => ({ state: 'failed', value: null, problem, ...evidence });
const invalid = (evidence: PresenterEvidence = {}): PresenterResult<never> => ({ state: 'invalid-response', value: null, ...evidence });
const key = (c: ApplicationContext) => JSON.stringify([c.subject, c.environmentId, c.runId, c.employeeId, c.policyVersion, [...c.roles].sort()]);

function advance(v: unknown): PresenterAdvance | null {
  return object(v) && id(v['runId'], 200) && instant(v['now']) && whole(v['clockVersion'])
    ? { runId: v['runId'], now: v['now'], clockVersion: v['clockVersion'] } : null;
}
function tick(v: unknown): PresenterTick | null {
  const base = advance(v);
  if (!base || !object(v) || !id(v['tickId'], 200) || !text(v['kind']) || !text(v['policyVersion'])
    || !['running', 'completed', 'pending', 'interrupted'].includes(v['state'] as string) || !strings(v['missingStages'])
    || !Array.isArray(v['handlerOrder']) || !Array.isArray(v['outcomes'])) return null;
  const handlerOrder: { handlerId: string; stage: string }[] = [];
  for (const row of v['handlerOrder']) {
    if (!object(row) || !text(row['handlerId']) || !text(row['stage'])) return null;
    handlerOrder.push({ handlerId: row['handlerId'], stage: row['stage'] });
  }
  const outcomes: { handlerId: string; stage: string; outcome: Readonly<Record<string, unknown>> }[] = [];
  for (const row of v['outcomes']) {
    if (!object(row) || !text(row['handlerId']) || !text(row['stage']) || !object(row['outcome'])) return null;
    outcomes.push({ handlerId: row['handlerId'], stage: row['stage'], outcome: row['outcome'] });
  }
  return { ...base, tickId: v['tickId'], kind: v['kind'], policyVersion: v['policyVersion'], state: v['state'] as string,
    handlerOrder, missingStages: [...v['missingStages']], outcomes };
}
function clock(v: unknown): PresenterClock | null {
  const base = advance(v);
  if (!base || !object(v) || !text(v['scenarioVersion']) || !text(v['fixtureVersion']) || !instant(v['startsAt']) || !named(v['namedTimes'])) return null;
  const lastTick = v['lastTick'] === null ? null : tick(v['lastTick']);
  if (v['lastTick'] !== null && (!lastTick || lastTick.runId !== base.runId)) return null;
  return { ...base, scenarioVersion: v['scenarioVersion'], fixtureVersion: v['fixtureVersion'], startsAt: v['startsAt'],
    namedTimes: { ...v['namedTimes'] }, lastTick };
}
function controls(v: unknown): PresenterControls | null {
  const base = clock(v);
  if (!base || !object(v) || !object(v['controls'])) return null;
  const c = v['controls']; const step = c['step']; const next = c['nextRelease'];
  if (!text(c['policyVersion']) || !object(step) || !whole(step['value']) || step['unit'] !== 'seconds' || !named(c['namedTimes']) || !object(next)) return null;
  const nextRelease = next['status'] === 'available' && text(next['to'], 200) && instant(next['at'])
    ? { status: 'available' as const, to: next['to'], at: next['at'] }
    : next['status'] === 'unavailable' && text(next['reason']) ? { status: 'unavailable' as const, reason: next['reason'] } : null;
  return nextRelease ? { ...base, controls: { policyVersion: c['policyVersion'], step: { value: step['value'], unit: 'seconds' },
    namedTimes: { ...c['namedTimes'] }, nextRelease } } : null;
}
function summary(v: unknown): PresenterScenarioSummary | null {
  if (!object(v) || !['scenarioId', 'name', 'scenarioVersion', 'fixtureVersion', 'policyVersion'].every((k) => text(v[k], 200))) return null;
  return { scenarioId: v['scenarioId'] as string, name: v['name'] as string, scenarioVersion: v['scenarioVersion'] as string,
    fixtureVersion: v['fixtureVersion'] as string, policyVersion: v['policyVersion'] as string };
}
function catalogue(v: unknown): PresenterCatalogue | null {
  if (!object(v) || !text(v['catalogueVersion']) || !text(v['policyVersion']) || !Array.isArray(v['scenarios'])) return null;
  const scenarios: PresenterScenario[] = [];
  for (const row of v['scenarios']) {
    const base = summary(row);
    if (!base || !object(row) || !text(row['kind']) || !instant(row['clockStart']) || !named(row['namedTimes']) || !object(row['availability'])) return null;
    const a = row['availability'];
    if (typeof a['available'] !== 'boolean' || !text(a['outcome']) || !strings(a['missingCapabilities'])) return null;
    scenarios.push({ ...base, kind: row['kind'], clockStart: row['clockStart'], namedTimes: { ...row['namedTimes'] },
      availability: { available: a['available'], outcome: a['outcome'], missingCapabilities: [...a['missingCapabilities']] } });
  }
  return { catalogueVersion: v['catalogueVersion'], policyVersion: v['policyVersion'], scenarios };
}
function current(v: unknown): PresenterCurrentScenario | null {
  const base = clock(v);
  if (!base || !object(v) || !text(v['catalogueVersion'])) return null;
  const currentScenario = v['currentScenario'] === null ? null : summary(v['currentScenario']);
  return v['currentScenario'] !== null && !currentScenario ? null : { ...base, catalogueVersion: v['catalogueVersion'], currentScenario };
}
function faults(v: unknown): PresenterFaults | null {
  if (!object(v) || !id(v['runId'], 200) || !Array.isArray(v['faults'])) return null;
  const result: PresenterFault[] = [];
  for (const f of v['faults']) {
    if (!object(f) || !text(f['adapter'])) return null;
    if (f['available'] === true && text(f['mode']) && strings(f['modes']) && f['modes'].includes(f['mode'])) {
      result.push({ adapter: f['adapter'], available: true, mode: f['mode'], modes: [...f['modes']] });
    } else if (f['available'] === false && text(f['reason'])) result.push({ adapter: f['adapter'], available: false, reason: f['reason'] });
    else return null;
  }
  return { runId: v['runId'], faults: result };
}
function reset(v: unknown, input: PresenterResetInput): PresenterReset | null {
  if (!object(v) || !id(v['retiredRunId'], 200) || !id(v['activatedRunId'], 200) || v['retiredRunId'] !== input.expectedRunId
    || v['activatedRunId'] === v['retiredRunId'] || typeof v['replayed'] !== 'boolean') return null;
  const scenario = summary(v['scenario']); const c = v['clock'] === null ? null : clock(v['clock']);
  // Preparation and clock policy have independent version pins; both belong to the activated run.
  if (!scenario || scenario.scenarioId !== input.scenarioId || scenario.scenarioVersion !== input.scenarioVersion
    || scenario.fixtureVersion !== input.fixtureVersion || scenario.policyVersion !== input.policyVersion
    || v['clock'] !== null && (!c || c.runId !== v['activatedRunId'])) return null;
  return { retiredRunId: v['retiredRunId'], activatedRunId: v['activatedRunId'], replayed: v['replayed'], scenario, clock: c };
}
function refusal(v: Record<string, unknown>, http: number): PresenterRefusal | null {
  const statuses: Record<number, readonly string[]> = { 400: ['invalid'], 401: ['unauthenticated'], 403: ['forbidden'], 404: ['not-found'],
    409: ['conflict'], 503: ['unavailable'], 202: ['pending'] };
  if (!statuses[http]?.includes(v['status'] as string) || !text(v['code']) || !text(v['reason']) || typeof v['retryable'] !== 'boolean') return null;
  if (v['currentVersion'] !== undefined && !(whole(v['currentVersion']) || text(v['currentVersion']))) return null;
  for (const k of ['action', 'operationId', 'runId']) if (v[k] !== undefined && !text(v[k])) return null;
  const reasons: { field: string; reason: string }[] = [];
  if (v['reasons'] !== undefined) {
    if (!Array.isArray(v['reasons'])) return null;
    for (const r of v['reasons']) {
      if (!object(r) || !text(r['field']) || !text(r['reason'])) return null;
      reasons.push({ field: r['field'], reason: r['reason'] });
    }
  }
  return { status: v['status'] as PresenterRefusal['status'], code: v['code'], reason: v['reason'], retryable: v['retryable'],
    ...(v['currentVersion'] === undefined ? {} : { currentVersion: v['currentVersion'] as string | number }),
    ...(v['action'] === undefined ? {} : { action: v['action'] as string }), ...(v['operationId'] === undefined ? {} : { operationId: v['operationId'] as string }),
    ...(v['runId'] === undefined ? {} : { runId: v['runId'] as string }), ...(v['reasons'] === undefined ? {} : { reasons }) };
}

@Injectable({ providedIn: 'root' })
export class PresenterClient {
  private readonly auth = inject(AuthPort);
  private readonly runtime = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);
  private readonly intents = new WeakMap<PresenterCommand, Intent>();

  async readOrderCount(options: PresenterRequestOptions = {}): Promise<PresenterResult<{ readonly count: number }>> {
    const scope = this.capture(); if ('state' in scope) return scope;
    const ids = new Set<string>(); const cursors = new Set<string>(); let after: string | null = null;
    do {
      if (!this.same(scope)) return { state: 'scope-mismatch', value: null };
      const query = new URLSearchParams({ limit: '100' }); if (after) query.set('after', after);
      const result = await this.request(`/orders/progress/all?${query}`, (value) => {
        if (!object(value) || !Array.isArray(value['orders']) || value['failedCount'] !== 0 || !Array.isArray(value['failed']) || value['failed'].length
          || !(value['nextAfter'] === null || id(value['nextAfter'], 200))) return null;
        const orders: string[] = [];
        for (const order of value['orders']) { if (!object(order) || !id(order['orderUuid'], 200) || order['runId'] !== scope.runId) return null; orders.push(order['orderUuid']); }
        return { orders, nextAfter: value['nextAfter'] as string | null };
      }, options);
      if (result.state !== 'ready') return result;
      if (!this.same(scope)) return { state: 'scope-mismatch', value: null };
      for (const id of result.value.orders) { if (ids.has(id)) return invalid(); ids.add(id); }
      after = result.value.nextAfter;
      if (after && cursors.has(after)) return invalid(); if (after) cursors.add(after);
    } while (after);
    return { state: 'ready', value: { count: ids.size } };
  }
  readLatestRelease(options: PresenterRequestOptions = {}) { return this.request('/presenter/releases/latest', parseRelease, options); }
  readSuitability(page = 1, buddyPage = 1, release: 'all' | 'latest' = 'all', options: PresenterRequestOptions = {}) {
    if (![page, buddyPage].every(whole) || !['all', 'latest'].includes(release)) return Promise.resolve(failed('invalid-selector'));
    return this.request(`/presenter/suitability?${new URLSearchParams({ page: String(page), buddyPage: String(buddyPage), release })}`, parseSuitability, options);
  }
  readClock(options: PresenterRequestOptions = {}) { return this.request('/presenter/clock', clock, options); }
  readControls(options: PresenterRequestOptions = {}) { return this.request('/presenter/controls', controls, options); }
  readCatalogue(options: PresenterRequestOptions = {}) { return this.request('/presenter/scenarios', catalogue, options); }
  readCurrentScenario(options: PresenterRequestOptions = {}) { return this.request('/presenter/scenarios/current', current, options); }
  readFaults(options: PresenterRequestOptions = {}) { return this.request('/presenter/scenarios/faults', faults, options); }
  readTick(tickId: string, options: PresenterRequestOptions = {}): Promise<PresenterResult<PresenterTick>> {
    if (!id(tickId, 200) || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(tickId)) return Promise.resolve(failed('invalid-selector'));
    return this.request(`/presenter/clock/ticks/${encodeURIComponent(tickId)}`, (v) => { const t = tick(v); return t?.tickId === tickId ? t : null; }, options);
  }
  prepareAdvance(input: PresenterAdvanceInput) { return this.prepare('advance', input); }
  prepareTick(input: PresenterTickInput) { return this.prepare('tick', input); }
  prepareControlTick(input: PresenterControlTickInput) { return this.prepare('control-tick', input); }
  prepareReset(input: PresenterResetInput) { return this.prepare('reset', input); }
  prepareFault(input: PresenterFaultInput) { return this.prepare('fault', input); }

  private prepare(kind: PresenterCommand['kind'], input: unknown): PresenterCommand | PresenterClientFailure {
    const scope = this.capture(); if ('state' in scope) return { ...scope, writeOutcome: 'not-sent' };
    if (!object(input)) return failed('invalid-command', { writeOutcome: 'not-sent' });
    let valid = false;
    switch (kind) {
      case 'advance': valid = only(input, ['commandId', 'expectedClockVersion', 'bySeconds', 'to']) && id(input['commandId']) && whole(input['expectedClockVersion'])
        && (whole(input['bySeconds']) && input['to'] === undefined || input['bySeconds'] === undefined && text(input['to'], 200)); break;
      case 'tick': valid = only(input, ['tickId', 'expectedClockVersion']) && id(input['tickId'], 200)
        && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(input['tickId']) && whole(input['expectedClockVersion']); break;
      case 'control-tick': valid = only(input, ['commandId', 'expectedClockVersion', 'mode', 'to']) && id(input['commandId']) && whole(input['expectedClockVersion'])
        && (['step', 'next-release'].includes(input['mode'] as string) && input['to'] === undefined || input['mode'] === 'to' && text(input['to'], 200)); break;
      case 'reset': valid = only(input, ['commandId', 'expectedRunId', 'scenarioId', 'scenarioVersion', 'fixtureVersion', 'policyVersion']) && id(input['commandId'])
        && ['expectedRunId', 'scenarioId', 'scenarioVersion', 'fixtureVersion', 'policyVersion'].every((k) => text(input[k], 200)); break;
      case 'fault': valid = only(input, ['commandId', 'adapter', 'mode']) && id(input['commandId']) && input['adapter'] === 'stock'
        && ['none', 'unavailable', 'stale'].includes(input['mode'] as string); break;
    }
    if (!valid) return failed('invalid-command', { writeOutcome: 'not-sent' });
    const snapshot = Object.freeze({ ...input });
    const command = Object.freeze({ kind, input: snapshot }) as PresenterCommand;
    this.intents.set(command, { scope, body: JSON.stringify(snapshot) });
    return command;
  }
  submit(command: PresenterCommand, options: PresenterRequestOptions = {}): Promise<PresenterResult<PresenterCommandValue>> {
    const intent = command && this.intents.get(command);
    if (!intent) return Promise.resolve(failed('unrecognized-command', { writeOutcome: 'not-sent' }));
    const paths = { advance: '/presenter/clock/advance', tick: '/presenter/clock/tick', 'control-tick': '/presenter/controls/tick',
      reset: '/presenter/scenarios/reset', fault: '/presenter/scenarios/faults' };
    const parse: Parser<PresenterCommandValue> = (v) => {
      switch (command.kind) {
        case 'advance': return advance(v);
        case 'tick': { const t = tick(v); return t?.tickId === command.input.tickId ? t : null; }
        case 'fault': return faults(v);
        case 'reset': return reset(v, command.input);
        case 'control-tick': {
          if (!object(v)) return null;
          const a = advance(v['advance']); const t = tick(v['tick']);
          return a && t && a.runId === t.runId && a.now === t.now && a.clockVersion === t.clockVersion ? { advance: a, tick: t } : null;
        }
      }
    };
    return this.request(paths[command.kind], parse, options, intent, command.kind === 'reset').then((result) => {
      if (result.state === 'ready') publishPresenterAction(document);
      return result;
    });
  }
  private capture(): Scope | PresenterClientFailure {
    const session = this.auth.state();
    if (session.status !== 'ready') return failed(session.status === 'signed-out' ? 'authentication-required' : 'context-unavailable');
    const c = session.context;
    if (!c.roles.includes('presenter')) return failed('role-required');
    if (![c.subject, c.environmentId, c.runId, c.policyVersion].every((v) => text(v))) return failed('context-unavailable');
    return { session, key: key(c), environmentId: c.environmentId, runId: c.runId };
  }
  private same(scope: Scope): boolean {
    const state = this.auth.state(); return state === scope.session && state.status === 'ready' && key(state.context) === scope.key;
  }
  private async request<T>(path: string, parse: Parser<T>, options: PresenterRequestOptions, intent?: Intent, resetting = false): Promise<PresenterResult<T>> {
    const scope = intent?.scope ?? this.capture(); if ('state' in scope) return scope;
    const controller = new AbortController(); let timedOut = false; let dispatched = false; let httpStatus: number | undefined;
    const evidence = (): PresenterEvidence => ({ ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(intent ? { writeOutcome: dispatched ? 'unknown' as const : 'not-sent' as const } : {}) });
    const stopped = () => controller.signal.aborted ? failed(timedOut ? 'timeout' : 'aborted', evidence())
      : !this.same(scope) ? failed('context-changed', evidence()) : null;
    const abort = () => controller.abort();
    const interrupted = new Promise<PresenterClientFailure>((resolve) => controller.signal.addEventListener('abort', () => resolve(failed(timedOut ? 'timeout' : 'aborted', evidence())), { once: true }));
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
    if (options.signal?.aborted) controller.abort();
    const work = async (): Promise<PresenterResult<T>> => {
      try {
        const before = stopped(); if (before) return before;
        let config;
        try { config = await this.runtime.load(); } catch { return stopped() ?? failed('configuration-unavailable', evidence()); }
        const afterConfig = stopped(); if (afterConfig) return afterConfig;
        if (config.environmentId !== scope.environmentId) return failed('environment-mismatch', evidence());
        let token;
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
        try { body = await response.json(); } catch { return stopped() ?? invalid(evidence()); }
        const afterBody = stopped(); if (afterBody) return afterBody;
        if (!object(body)) return invalid(evidence());
        if (body['status'] !== 'ok') {
          const r = refusal(body, response.status);
          if (!r) return invalid(evidence());
          return { state: 'refused', value: null, refusal: r, httpStatus,
            ...(intent && (r.status === 'pending' || r.status === 'unavailable') ? { writeOutcome: 'unknown' as const } : {}) };
        }
        if (response.status !== 200 || !response.ok) return invalid(evidence());
        const value = parse(body['value']); if (value === null) return invalid(evidence());
        // Catalogue has no run. Reset explicitly retires one run and activates another.
        const projected = value as unknown as Record<string, unknown>;
        const run = projected['runId'] ?? (object(projected['advance']) ? projected['advance']['runId'] : undefined);
        if (!resetting && run !== undefined && run !== scope.runId) return { state: 'scope-mismatch', value: null, ...evidence() };
        return { state: 'ready', value, httpStatus };
      } catch { return stopped() ?? failed('transport-unavailable', evidence()); }
    };
    try { return await Promise.race([work(), interrupted]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}
