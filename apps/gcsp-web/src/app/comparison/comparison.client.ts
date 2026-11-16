import { inject, Injectable } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { COMPARISON_EXPERIMENTS } from './comparison.types';
import type {
  ComparisonArm, ComparisonAssumption, ComparisonCatalogue, ComparisonDifference, ComparisonExperimentId,
  ComparisonFailure, ComparisonJob, ComparisonJobRead, ComparisonJson, ComparisonManifest, ComparisonReadOptions,
  ComparisonResponse, ComparisonResult, ComparisonStartInput, ComparisonStartResponse, ComparisonStats, StoredComparison,
} from './comparison.types';

type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.trim().length > 0
  && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const id = (v: unknown, max = 2048): v is string => text(v, max) && v === v.trim() && !/\s/.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const whole = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const only = (v: JsonObject, keys: readonly string[]) => Object.keys(v).every((k) => keys.includes(k));
const list = <T>(v: unknown, guard: (item: unknown) => item is T): v is T[] => Array.isArray(v) && v.every(guard);
const experiment = (v: unknown): v is ComparisonExperimentId => COMPARISON_EXPERIMENTS.some((candidate) => candidate === v);
const instant = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(v) && Number.isFinite(Date.parse(v))
  && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const json = (v: unknown): v is ComparisonJson => v === null || typeof v === 'boolean' || typeof v === 'string' || finite(v)
  || Array.isArray(v) && v.every(json) || object(v) && Object.values(v).every(json);
const jsonObject = (v: unknown): v is { [key: string]: ComparisonJson } => object(v) && Object.values(v).every(json);
const optional = (v: JsonObject, key: string, guard: (value: unknown) => boolean) => v[key] === undefined || guard(v[key]);
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const strings = (v: unknown): v is string[] => list(v, (s): s is string => text(s));
const resultIdentity = (v: unknown, experimentId: ComparisonExperimentId): v is string => id(v)
  && v.startsWith(experimentId === 'process-only' ? 'process-comparison-' : `${experimentId}-comparison-`);
const scopeKey = (c: ApplicationContext) => JSON.stringify([c.subject, c.environmentId, c.runId, c.policyVersion,
  c.employeeId, [...c.roles].sort(), [...c.capabilities].sort()]);
const fail = (status: ComparisonFailure['status'], code: string, reason: string, retryable = false): ComparisonFailure =>
  ({ status, code, reason, retryable });
const invalidResponse = () => fail('unavailable', 'comparison-response-invalid', 'The comparison response could not be read.');

function stats(v: unknown): v is ComparisonStats {
  return object(v) && ['mean', 'min', 'max'].every((key) => v[key] === null || finite(v[key]));
}
function difference(v: unknown): v is ComparisonDifference {
  return object(v) && text(v['measure']) && text(v['betterWhen']) && text(v['verdict'])
    && stats(v['current']) && stats(v['buddy']) && stats(v['difference']);
}
function differences(v: unknown): v is ComparisonDifference[] {
  return list(v, difference) && unique(v.map((row) => row.measure));
}
function assumption(v: unknown): v is ComparisonAssumption {
  return object(v) && text(v['key']) && json(v['value']) && typeof v['unit'] === 'string' && text(v['status'])
    && text(v['basis']) && optional(v, 'source', json) && optional(v, 'policyVersion', text);
}
function manifest(v: unknown): v is ComparisonManifest {
  return object(v) && experiment(v['experimentId']) && strings(v['seeds']) && v['seeds'].length > 0
    && unique(v['seeds']) && text(v['policyVersion']) && optional(v, 'policyHash', text)
    && optional(v, 'generatorVersion', text) && optional(v, 'codeRevision', text)
    && optional(v, 'overlays', jsonObject) && optional(v, 'change', json) && optional(v, 'inputHashes', jsonObject)
    && optional(v, 'arms', (arms) => list(arms, json));
}
function arm(v: unknown): v is ComparisonArm {
  return object(v) && id(v['armId']) && json(v['value']) && differences(v['differences'])
    && jsonObject(v['measures']) && list(v['perSeed'], json);
}
function perSeed(v: unknown, seeds: readonly string[], hashes: unknown): boolean {
  return Array.isArray(v) && v.length === seeds.length && v.every((row, index) => {
    if (!object(row) || row['seed'] !== seeds[index] || !id(row['inputHash']) || !object(hashes)
      || hashes[seeds[index]] !== row['inputHash'] || !object(row['routes'])) return false;
    const routes = row['routes'];
    return ['current', 'buddy'].every((route) => {
      const entry = routes[route];
      return object(entry) && jsonObject(entry['measures']) && jsonObject(entry['totals']) && id(entry['recordDigest']);
    });
  });
}
function result(v: unknown): v is ComparisonResult {
  if (!object(v) || !json(v) || v['schemaVersion'] !== 1 || !experiment(v['experimentId']) || !instant(v['completedAt'])
    || !manifest(v['manifest']) || v['manifest'].experimentId !== v['experimentId']
    || !list(v['assumptions'], assumption) || !unique(v['assumptions'].map((row) => row.key))
    || !text(v['caveat']) || !strings(v['limitations']) || !optional(v, 'rule', json)
    || !optional(v, 'effects', (effects) => list(effects, json))) return false;
  if (v['experimentId'] === 'process-only') {
    return v['kind'] === 'process-comparison' && differences(v['differences']) && jsonObject(v['measures'])
      && perSeed(v['perSeed'], v['manifest'].seeds, v['manifest'].inputHashes) && v['arms'] === undefined;
  }
  if (v['kind'] !== 'experiment-comparison' || !list(v['arms'], arm) || v['arms'].length < 2
    || !unique(v['arms'].map((row) => row.armId)) || v['arms'][0].armId !== 'baseline'
    || !Array.isArray(v['manifest'].arms) || v['manifest'].arms.length !== v['arms'].length) return false;
  const arms = v['arms']; const seeds = v['manifest'].seeds;
  return v['manifest'].arms.every((row, index) => object(row) && row['armId'] === arms[index].armId
    && perSeed(arms[index].perSeed, seeds, row['inputHashes']));
}
function stored(v: unknown): v is StoredComparison {
  return object(v) && result(v['result']) && resultIdentity(v['resultId'], v['result'].experimentId) && instant(v['storedAt'])
    && text(v['policyVersion']) && v['policyVersion'] === v['result'].manifest.policyVersion
    && text(v['activePolicyVersion']) && typeof v['policyCurrent'] === 'boolean'
    && v['policyCurrent'] === (v['policyVersion'] === v['activePolicyVersion'])
    && typeof v['resultDigest'] === 'string' && /^[0-9a-f]{64}$/.test(v['resultDigest'])
    && (v['origin'] === 'retained' || v['origin'] === 'run');
}
function catalogue(v: unknown): ComparisonCatalogue | null {
  if (!object(v) || !text(v['activePolicyVersion']) || !Array.isArray(v['experiments'])
    || v['experiments'].length !== COMPARISON_EXPERIMENTS.length) return null;
  const experiments: { experimentId: ComparisonExperimentId; latest: StoredComparison | null }[] = [];
  for (const [index, row] of v['experiments'].entries()) {
    const experimentId = COMPARISON_EXPERIMENTS[index];
    if (!object(row) || row['experimentId'] !== experimentId || !(row['latest'] === null || stored(row['latest']))) return null;
    const latest = row['latest'];
    if (latest && (latest.result.experimentId !== experimentId || latest.activePolicyVersion !== v['activePolicyVersion'])) return null;
    experiments.push({ experimentId, latest });
  }
  return { activePolicyVersion: v['activePolicyVersion'], experiments };
}
function change(v: unknown, experimentId: ComparisonExperimentId): boolean {
  if (experimentId === 'process-only') return v === null;
  if (!object(v) || !text(v['basis'], 500)) return false;
  if (experimentId === 'hold-sweep') return only(v, ['basis', 'values']) && list(v['values'], whole)
    && v['values'].length > 0 && new Set(v['values']).size === v['values'].length;
  if (!only(v, ['basis', 'value'])) return false;
  if (experimentId === 'points') return finite(v['value']);
  return Array.isArray(v['value']) && v['value'].length > 0 && v['value'].every((row) => object(row)
    && only(row, ['modelLine', 'weight']) && text(row['modelLine']) && finite(row['weight']) && row['weight'] >= 0);
}
function job(v: unknown): v is ComparisonJob {
  if (!object(v) || !id(v['jobId']) || !experiment(v['experimentId']) || !object(v['progress'])
    || !instant(v['startedAt']) || !(v['finishedAt'] === null || instant(v['finishedAt']))
    || !(v['resultId'] === null || id(v['resultId'])) || !(v['reason'] === null || text(v['reason']))
    || !object(v['request']) || v['request']['experimentId'] !== v['experimentId']
    || !json(v['request']['change']) || !change(v['request']['change'], v['experimentId'])) return false;
  const p = v['progress'];
  if (!whole(p['seedsDone']) || !whole(p['seedsTotal']) || !whole(p['stepsDone']) || !whole(p['stepsTotal'])
    || p['seedsDone'] > p['seedsTotal'] || p['stepsDone'] > p['stepsTotal']) return false;
  if (v['status'] === 'running') return v['finishedAt'] === null && v['resultId'] === null && v['reason'] === null;
  if (!instant(v['finishedAt'])) return false;
  if (v['status'] === 'succeeded') return resultIdentity(v['resultId'], v['experimentId']) && v['reason'] === null;
  return (v['status'] === 'failed' || v['status'] === 'interrupted') && v['resultId'] === null && text(v['reason']);
}
function validInput(v: unknown): v is ComparisonStartInput {
  return object(v) && typeof v['commandId'] === 'string' && v['commandId'].length > 0 && v['commandId'].length <= 128
    && experiment(v['experimentId']) && only(v, v['experimentId'] === 'process-only' ? ['commandId', 'experimentId'] : ['commandId', 'experimentId', 'change'])
    && (v['experimentId'] === 'process-only' || change(v['change'], v['experimentId']));
}

function refusal(http: number, body: unknown): ComparisonFailure {
  const status = http === 401 ? 'authentication-required' : http === 403 ? 'forbidden' : http === 400 ? 'invalid'
    : http === 404 ? 'not-found' : http === 409 ? 'conflict' : 'unavailable';
  const fallback = fail(status, `comparison-${status}`, status === 'authentication-required' ? 'Sign in to inspect comparisons.'
    : status === 'forbidden' ? 'Your account cannot perform this comparison action.' : 'The comparison request could not be completed.', status === 'unavailable');
  if (!object(body)) return fallback;
  const expected = status === 'authentication-required' ? ['unauthenticated', 'authentication-required'] : [status];
  if (!expected.includes(String(body['status'])) || typeof body['code'] !== 'string' || !/^[a-z][a-z0-9._-]{0,127}$/.test(body['code'])
    || !optional(body, 'retryable', (v) => typeof v === 'boolean') || !optional(body, 'reason', text)
    || !optional(body, 'jobId', id)) return invalidResponse();
  const reasons: { field: string; reason: string }[] = [];
  if (body['reasons'] !== undefined) {
    if (!Array.isArray(body['reasons'])) return invalidResponse();
    for (const row of body['reasons']) {
      if (!object(row) || !text(row['field'], 256) || !text(row['reason'])) return invalidResponse();
      reasons.push({ field: row['field'], reason: row['reason'] });
    }
  }
  return { status, code: body['code'], reason: text(body['reason']) ? body['reason'] : fallback.reason,
    retryable: typeof body['retryable'] === 'boolean' ? body['retryable'] : false,
    ...(body['reasons'] === undefined ? {} : { reasons }), ...(id(body['jobId']) ? { jobId: body['jobId'] } : {}) };
}

/** Current server scope only; retained result provenance can describe earlier runs. No command is retried here. */
@Injectable({ providedIn: 'root' })
export class ComparisonClient {
  private readonly auth = inject(AuthPort);
  private readonly config = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);

  readResults(options: ComparisonReadOptions = {}): Promise<ComparisonResponse<ComparisonCatalogue>> {
    return this.request('/comparison/results/latest', (http, body) => {
      const value = http === 200 && object(body) && body['status'] === 'ok' ? catalogue(body['value']) : null;
      return value ? { status: 'ok', value } : http === 200 ? invalidResponse() : refusal(http, body);
    }, options);
  }
  readProcess(options: ComparisonReadOptions = {}): Promise<ComparisonResponse<StoredComparison>> {
    return this.request('/comparison/process/latest', (http, body) => http === 200
      ? object(body) && body['status'] === 'ok' && stored(body['value']) && body['value'].result.experimentId === 'process-only'
        ? { status: 'ok', value: body['value'] } : invalidResponse()
      : refusal(http, body), options);
  }
  readJob(options: ComparisonReadOptions & { readonly jobId?: string } = {}): Promise<ComparisonResponse<ComparisonJobRead>> {
    if (options.jobId !== undefined && !id(options.jobId)) return Promise.resolve(fail('invalid', 'invalid-job-id', 'Give one job id.'));
    const jobId = options.jobId;
    return this.request(`/comparison/jobs/latest${jobId === undefined ? '' : `?jobId=${encodeURIComponent(jobId)}`}`, (http, body) => {
      if (object(body) && typeof body['reruns'] === 'boolean') {
        if (http === 404 && body['status'] === 'not-found' && body['value'] === undefined) {
          return { status: 'ok', value: { job: null, reruns: body['reruns'] } };
        }
        if (http === 200 && body['status'] === 'ok' && job(body['value']) && (!jobId || body['value'].jobId === jobId)) {
          return { status: 'ok', value: { job: body['value'], reruns: body['reruns'] } };
        }
      }
      return http === 200 || http === 404 && object(body) && body['status'] === 'not-found' && body['code'] === undefined
        ? invalidResponse() : refusal(http, body);
    }, options);
  }
  start(input: ComparisonStartInput, options: ComparisonReadOptions = {}): Promise<ComparisonStartResponse> {
    if (!validInput(input)) return Promise.resolve({ ...fail('invalid', 'invalid-comparison-command', 'Check the comparison change and command id.'), writeOutcome: 'not-sent' });
    const experimentId = input.experimentId;
    const body = JSON.stringify(input);
    return this.request('/comparison/jobs', (http, envelope): ComparisonStartResponse => {
      if (http === 200 || http === 202) {
        if (object(envelope) && envelope['status'] === (http === 202 ? 'pending' : 'ok') && job(envelope['value'])
          && envelope['value'].experimentId === experimentId && (http !== 202 || envelope['value'].status === 'running')) {
          return { status: http === 202 ? 'pending' : 'ok', value: envelope['value'] };
        }
        return { ...invalidResponse(), writeOutcome: 'unknown' };
      }
      const rejected = refusal(http, envelope);
      return http >= 500 || ![400, 401, 403, 404, 409].includes(http) || rejected.code === 'comparison-response-invalid'
        ? { ...rejected, writeOutcome: 'unknown' } : rejected;
    }, options, body);
  }

  private async request<T extends ComparisonResponse<unknown> | ComparisonStartResponse>(path: string,
    parse: (http: number, body: unknown) => T, options: ComparisonReadOptions, body?: string): Promise<T | ComparisonFailure> {
    const writing = body !== undefined;
    let sent = false;
    const failure = (v: ComparisonFailure): ComparisonFailure => writing ? { ...v, writeOutcome: sent ? 'unknown' : 'not-sent' } : v;
    const session = this.auth.state();
    if (session.status !== 'ready') return failure(fail('authentication-required', 'comparison-sign-in-required', 'Sign in to inspect comparisons.'));
    const allowed = () => writing ? session.context.roles.includes('greg') : session.context.roles.some((role) => role === 'greg' || role === 'presenter');
    if (!allowed()) return failure(fail('forbidden', 'comparison-role-required', writing ? 'Greg access is required to start a comparison.' : 'Greg or presenter access is required.'));
    const context = session.context; const capturedKey = scopeKey(context);
    if (![context.subject, context.environmentId, context.runId, context.policyVersion].every((value) => id(value))) {
      return failure(fail('unavailable', 'comparison-context-invalid', 'The comparison context is unavailable.'));
    }
    if (options.signal?.aborted) return failure(fail('aborted', 'comparison-request-aborted', 'The comparison request was interrupted.'));
    const controller = new AbortController(); let timedOut = false;
    const interruption = (): ComparisonFailure | null => {
      const current = this.auth.state();
      if (current !== session || current.status !== 'ready' || current.context !== context || scopeKey(current.context) !== capturedKey || !allowed()) {
        return failure(fail('account-changed', 'comparison-context-changed', 'The account or active run changed. Reload comparisons.'));
      }
      return controller.signal.aborted ? failure(timedOut
        ? fail('unavailable', 'comparison-timeout', 'The comparison request timed out.', true)
        : fail('aborted', 'comparison-request-aborted', 'The comparison request was interrupted.')) : null;
    };
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    const stopped = new Promise<ComparisonFailure>((resolve) => controller.signal.addEventListener('abort', () => {
      resolve(interruption() ?? failure(fail('aborted', 'comparison-request-aborted', 'The comparison request was interrupted.')));
    }, { once: true }));
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
    const request = async (): Promise<T | ComparisonFailure> => {
      try {
        const config = await this.config.load(); let interrupted = interruption(); if (interrupted) return interrupted;
        if (config.environmentId !== context.environmentId) return failure(fail('unavailable', 'comparison-environment-mismatch', 'The comparison environment is unavailable.'));
        let token: string | null;
        try { token = await this.auth.getAccessToken(); }
        catch { return interruption() ?? failure(fail('authentication-required', 'comparison-sign-in-required', 'Sign in to inspect comparisons.')); }
        interrupted = interruption(); if (interrupted) return interrupted;
        if (!token || /\s/.test(token)) return failure(fail('authentication-required', 'comparison-sign-in-required', 'Sign in to inspect comparisons.'));
        sent = true;
        const response = await this.fetcher(`${config.apiBaseUrl}${path}`, { method: writing ? 'POST' : 'GET',
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(writing ? { 'Content-Type': 'application/json' } : {}) },
          ...(writing ? { body } : {}) });
        interrupted = interruption(); if (interrupted) return interrupted;
        let envelope: unknown; try { envelope = await response.json(); } catch { envelope = null; }
        interrupted = interruption(); if (interrupted) return interrupted;
        // Only explicit current-scope fields are checked. Historical provenance is retained unchanged.
        if (object(envelope) && (envelope['runId'] !== undefined && envelope['runId'] !== context.runId
          || envelope['environmentId'] !== undefined && envelope['environmentId'] !== context.environmentId)) {
          return failure(fail('stale-run', 'comparison-response-scope-mismatch', 'The active comparison run changed. Reload comparisons.'));
        }
        return parse(response.status, envelope);
      } catch { return interruption() ?? failure(fail('unavailable', 'comparison-transport-unavailable', 'Comparisons are temporarily unavailable.', true)); }
    };
    try { return await Promise.race([request(), stopped]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}
