import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import type { RuntimePublicConfig } from '../auth/runtime-config';
import { ComparisonClient } from './comparison.client';
import { COMPARISON_EXPERIMENTS } from './comparison.types';
import type { ComparisonCatalogue, ComparisonJob, ComparisonStartInput, StoredComparison } from './comparison.types';

const context: ApplicationContext = { subject: 'greg-subject', roles: ['greg'], environmentId: 'isolated',
  runId: 'current-run', policyVersion: 'gcsp-policy-v1', capabilities: [] };
const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1',
  oidc: { authority: 'https://issuer.example', clientId: 'public-client', scope: 'openid',
    redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (value: unknown) => json({ status: 'ok', value });
const command: ComparisonStartInput = { experimentId: 'process-only', commandId: 'explicit-command-1' };
const hash = '53bcb43e78caefd6fef8c5c08e25454b1871c89af65369d624bb39af5b123509';

// Reduced client fixture derived from server/data/gcsp/comparison/process-only.json.
// The retained measurements are not improvement promises; this fixture proves only client behaviour.
function process(): StoredComparison {
  const route = { measures: { acceptableCoverage: 0.157 }, totals: { employees: 1000, taken: 157 }, recordDigest: hash };
  return { resultId: 'process-comparison-client-fixture', storedAt: '2026-11-09T18:12:24.449Z',
    policyVersion: 'gcsp-policy-v1', activePolicyVersion: 'gcsp-policy-v1', policyCurrent: true,
    resultDigest: 'd388e3371ea4a7f3c3665102e9452e7ccd0940b685b64fa2d623e7e47a3f3027', origin: 'retained',
    result: { schemaVersion: 1, kind: 'process-comparison', experimentId: 'process-only', completedAt: '2026-11-09T18:12:24.449Z',
      manifest: { experimentId: 'process-only', seeds: ['comparison-a'], policyVersion: 'gcsp-policy-v1',
        policyHash: '90da819d8ae50fb0a09073e34403abc6c2f411198e8eaaf514302afd014e96b4',
        generatorVersion: 'comparison-inputs.sha256.v1', overlays: {}, codeRevision: '669fbc2f', inputHashes: { 'comparison-a': hash } },
      assumptions: [{ key: 'allocation.tieBreak.rule', value: 'renewalDueThenFitThenSeededLottery', unit: 'enum', status: 'assumed',
        basis: 'Assumed demo fairness: earlier renewal due, then higher eligible fit, then seeded tie-break. Not employee iteration/mail speed or verified BMW policy.',
        source: 'docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance', policyVersion: 'gcsp-policy-v1' }],
      perSeed: [{ seed: 'comparison-a', inputHash: hash, routes: { current: route, buddy: route } }],
      differences: [{ measure: 'acceptableCoverage', betterWhen: 'higher', verdict: 'current-better',
        current: { mean: 0.148333, min: 0.136, max: 0.157 }, buddy: { mean: 0.117667, min: 0.115, max: 0.119 },
        difference: { mean: -0.030666, min: -0.038, max: -0.021 } }],
      measures: { current: { acceptableCoverage: { mean: 0.148333, min: 0.136, max: 0.157 } },
        buddy: { acceptableCoverage: { mean: 0.117667, min: 0.115, max: 0.119 } } },
      rule: { key: 'comparison.verdict.rule', value: {}, status: 'assumed', basis: 'Client fixture.' },
      caveat: 'Calculated fit is not observed satisfaction.', limitations: ['Calculated fit is not observed satisfaction.'] } };
}
function experiment(id: 'order-mix' | 'points' | 'hold-sweep'): StoredComparison {
  const p = process();
  const arms = ['baseline', 'variant'].map((armId) => ({ armId, value: armId === 'baseline' ? 1 : 1.5,
    differences: p.result.differences ?? [], measures: p.result.measures ?? {}, perSeed: p.result.perSeed ?? [] }));
  return { ...p, origin: 'run', resultId: `${id}-comparison-client-fixture`, result: {
    schemaVersion: 1, kind: 'experiment-comparison', experimentId: id, completedAt: p.result.completedAt,
    manifest: { ...p.result.manifest, experimentId: id, change: { value: 1.5, basis: 'Explicit what-if.' },
      arms: arms.map((arm) => ({ armId: arm.armId, value: arm.value, overlay: {}, overlayHash: hash, inputHashes: { 'comparison-a': hash } })) },
    arms, effects: [{ armId: 'variant', routes: {} }], assumptions: p.result.assumptions, rule: p.result.rule,
    caveat: p.result.caveat, limitations: [...p.result.limitations, 'What-if experiment: the changed values were never published as live policy.'] } };
}
function catalogue(all = false): ComparisonCatalogue {
  return { activePolicyVersion: 'gcsp-policy-v1', experiments: COMPARISON_EXPERIMENTS.map((experimentId) => ({ experimentId,
    latest: experimentId === 'process-only' ? process() : all ? experiment(experimentId) : null })) };
}
function job(extra: Partial<ComparisonJob> = {}): ComparisonJob {
  return { jobId: 'comparison-job-1', experimentId: 'process-only', status: 'running',
    progress: { seedsDone: 0, seedsTotal: 3, stepsDone: 0, stepsTotal: 6 }, startedAt: '2026-11-16T20:00:00Z',
    finishedAt: null, resultId: null, reason: null, request: { experimentId: 'process-only', change: null }, ...extra };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe('comparison client', () => {
  const state = signal<SessionState>({ status: 'ready', context });
  const getAccessToken = vi.fn(async (): Promise<string | null> => 'access-token');
  const fetcher = vi.fn<typeof fetch>(); const load = vi.fn(async () => config);
  let client: ComparisonClient;
  beforeEach(() => {
    state.set({ status: 'ready', context }); getAccessToken.mockReset().mockResolvedValue('access-token');
    fetcher.mockReset(); load.mockReset().mockResolvedValue(config);
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state, getAccessToken } },
      { provide: RuntimeConfigService, useValue: { load } }, { provide: PORTAL_FETCH, useValue: fetcher }] });
    client = TestBed.inject(ComparisonClient);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('reads the exact selector-free catalogue endpoint and retains actual stored identity and unfavourable measures', async () => {
    fetcher.mockResolvedValueOnce(ok(catalogue()));
    expect(await client.readResults()).toEqual({ status: 'ok', value: catalogue() });
    expect(fetcher).toHaveBeenCalledWith(`${config.apiBaseUrl}/comparison/results/latest`, {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { Accept: 'application/json', Authorization: 'Bearer access-token' },
    });
  });

  it('retains all four ordered experiments including arms, assumptions, effects and actual limitations', async () => {
    fetcher.mockResolvedValueOnce(ok(catalogue(true)));
    expect(await client.readResults()).toEqual({ status: 'ok', value: catalogue(true) });
  });

  it('reads the process endpoint and preserves stale policy evidence and nanosecond Java instants', async () => {
    const value = { ...process(), activePolicyVersion: 'policy-v2', policyCurrent: false, storedAt: '2026-11-16T10:00:00.123456789Z' };
    fetcher.mockResolvedValueOnce(ok(value)); expect(await client.readProcess()).toEqual({ status: 'ok', value });
    expect(fetcher.mock.calls[0][0]).toBe(`${config.apiBaseUrl}/comparison/process/latest`);
  });

  it('rejects missing, duplicate, reordered or contradictory catalogue identities', async () => {
    const c = catalogue();
    for (const value of [{ ...c, experiments: c.experiments.slice(1) }, { ...c, experiments: [...c.experiments].reverse() },
      { ...c, experiments: [c.experiments[0], c.experiments[0], ...c.experiments.slice(2)] },
      { ...c, activePolicyVersion: 'another-policy' }, { ...c, experiments: c.experiments.map((row) => ({ ...row, latest: process() })) }]) {
      fetcher.mockResolvedValueOnce(ok(value)); expect((await client.readResults()).status).toBe('unavailable');
    }
  });

  it('rejects contradictory kind, manifest, policy freshness, digest and stored identity fields', async () => {
    const p = process();
    for (const value of [{ ...p, resultId: '' }, { ...p, resultId: 'points-comparison-wrong-experiment' }, { ...p, origin: 'invented' }, { ...p, resultDigest: 'bad' },
      { ...p, policyCurrent: false }, { ...p, policyVersion: 'another-policy' },
      { ...p, result: { ...p.result, kind: 'experiment-comparison' } },
      { ...p, result: { ...p.result, manifest: { ...p.result.manifest, experimentId: 'points' } } },
      { ...p, result: { ...p.result, completedAt: '2026-02-30T10:00:00Z' } }]) {
      fetcher.mockResolvedValueOnce(ok(value)); expect((await client.readProcess()).status).toBe('unavailable');
    }
  });

  it('rejects malformed nested assumptions, differences, measures and seed provenance', async () => {
    const p = process();
    for (const result of [{ ...p.result, assumptions: [{ key: 'missing-fields' }] },
      { ...p.result, assumptions: [...p.result.assumptions, ...p.result.assumptions] },
      { ...p.result, differences: [{ measure: 'acceptableCoverage' }] }, { ...p.result, measures: null },
      { ...p.result, perSeed: ['not-a-seed'] }, { ...p.result, manifest: { ...p.result.manifest, seeds: ['another-seed'] } }]) {
      fetcher.mockResolvedValueOnce(ok({ ...p, result })); expect((await client.readProcess()).status).toBe('unavailable');
    }
    fetcher.mockResolvedValueOnce({ status: 200, json: async () => ({ status: 'ok', value: {
      ...p, result: { ...p.result, measures: { current: { coverage: Number.POSITIVE_INFINITY } } },
    } }) } as Response);
    expect((await client.readProcess()).status).toBe('unavailable');
  });

  it('rejects experimental arm identity contradictions and process-only data from the wrong endpoint', async () => {
    const e = experiment('points'); const c = catalogue(true);
    const malformed = { ...e, result: { ...e.result, arms: [{ armId: 'baseline' }] } };
    fetcher.mockResolvedValueOnce(ok({ ...c, experiments: c.experiments.map((row) => row.experimentId === 'points' ? { ...row, latest: malformed } : row) }));
    expect((await client.readResults()).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(ok(e)); expect((await client.readProcess()).status).toBe('unavailable');
  });

  it('allows historical retained result run provenance without treating it as current request scope', async () => {
    const p = process(); const value = { ...p, result: { ...p.result, rule: { runId: 'historical-comparison-run', environmentId: 'historical-environment' } } };
    fetcher.mockResolvedValueOnce(ok(value)); expect(await client.readProcess()).toEqual({ status: 'ok', value });
  });

  it('reads latest or exact jobs and learns reruns only from the GET response', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: job(), reruns: false }));
    expect(await client.readJob()).toEqual({ status: 'ok', value: { job: job(), reruns: false } });
    expect(fetcher.mock.calls[0][0]).toBe(`${config.apiBaseUrl}/comparison/jobs/latest`);
    const value = job({ jobId: 'comparison-job:a/b' });
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value, reruns: true }));
    expect(await client.readJob({ jobId: value.jobId })).toEqual({ status: 'ok', value: { job: value, reruns: true } });
    expect(fetcher.mock.calls[1][0]).toBe(`${config.apiBaseUrl}/comparison/jobs/latest?jobId=comparison-job%3Aa%2Fb`);
  });

  it('maps the actual empty 404 job envelope without inventing a reruns flag', async () => {
    for (const reruns of [false, true]) {
      fetcher.mockResolvedValueOnce(json({ status: 'not-found', reruns }, 404));
      expect(await client.readJob()).toEqual({ status: 'ok', value: { job: null, reruns } });
    }
    for (const body of [{ status: 'not-found' }, { status: 'not-found', reruns: 'yes' }, { status: 'ok', value: job() }]) {
      fetcher.mockResolvedValueOnce(json(body, body.status === 'ok' ? 200 : 404));
      expect((await client.readJob()).status).toBe('unavailable');
    }
  });

  it('retains successful, failed and interrupted terminal jobs without inventing completion', async () => {
    for (const value of [job({ status: 'succeeded', finishedAt: '2026-11-16T20:01:00Z', resultId: process().resultId,
      progress: { seedsDone: 3, seedsTotal: 3, stepsDone: 6, stepsTotal: 6 } }),
      job({ status: 'interrupted', finishedAt: '2026-11-16T20:01:00Z', reason: 'The backend restarted before the comparison finished.' }),
      job({ status: 'failed', finishedAt: '2026-11-16T20:01:00Z', reason: 'The comparison could not be completed.' })]) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value, reruns: true }));
      expect(await client.readJob()).toEqual({ status: 'ok', value: { job: value, reruns: true } });
    }
  });

  it('rejects malformed progress, terminal states, request identities and an incorrect selected job', async () => {
    for (const value of [job({ progress: { seedsDone: 4, seedsTotal: 3, stepsDone: 0, stepsTotal: 6 } }),
      job({ status: 'succeeded' }), job({ status: 'interrupted', finishedAt: '2026-11-16T20:01:00Z' }),
      job({ request: { experimentId: 'points', change: null } }), job({ finishedAt: '2026-11-16T20:01:00Z' })]) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value, reruns: true })); expect((await client.readJob()).status).toBe('unavailable');
    }
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: job(), reruns: true }));
    expect((await client.readJob({ jobId: 'different-job' })).status).toBe('unavailable');
    expect((await client.readJob({ jobId: '' })).status).toBe('invalid');
  });

  it('starts once with the exact supported command and accepts actual 202 and replayed 200 envelopes', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'pending', value: job() }, 202));
    expect(await client.start(command)).toEqual({ status: 'pending', value: job() });
    expect(fetcher).toHaveBeenCalledWith(`${config.apiBaseUrl}/comparison/jobs`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { Accept: 'application/json', Authorization: 'Bearer access-token', 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    });
    const value = job({ status: 'succeeded', finishedAt: '2026-11-16T20:01:00Z', resultId: process().resultId });
    fetcher.mockResolvedValueOnce(ok(value)); expect(await client.start(command)).toEqual({ status: 'ok', value });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sends explicit points, order mix and hold sweep shapes without changing seeds or workloads', async () => {
    const inputs: ComparisonStartInput[] = [
      { commandId: 'points-1', experimentId: 'points', change: { value: 1.5, basis: 'Test allowance sensitivity.' } },
      { commandId: 'mix-1', experimentId: 'order-mix', change: { value: [{ modelLine: '3', weight: 0.5 }], basis: 'Test mix sensitivity.' } },
      { commandId: 'holds-1', experimentId: 'hold-sweep', change: { values: [900, 1800], basis: 'Test hold sensitivity.' } },
    ];
    for (const input of inputs) {
      const value = job({ experimentId: input.experimentId, request: { experimentId: input.experimentId, change: 'change' in input ? input.change : null } });
      fetcher.mockResolvedValueOnce(json({ status: 'pending', value }, 202));
      expect((await client.start(input)).status).toBe('pending');
      expect(fetcher.mock.lastCall?.[1]?.body).toBe(JSON.stringify(input));
    }
  });

  it('rejects unsupported keys, seeds, overlays and malformed command or change shapes before sending', async () => {
    const inputs: unknown[] = [{ ...command, commandId: '' }, { ...command, commandId: 'x'.repeat(129) },
      { ...command, seeds: ['smaller'] }, { ...command, overlay: {} }, { ...command, runId: 'another-run' },
      { ...command, change: null }, { ...command, experimentId: 'unknown' },
      { ...command, experimentId: 'points', change: { value: Infinity, basis: 'A basis.' } },
      { ...command, experimentId: 'points', change: { value: 1.5, basis: '' } },
      { ...command, experimentId: 'points', change: { value: 1.5, basis: 'A basis.', seeds: ['a'] } },
      { ...command, experimentId: 'hold-sweep', change: { values: [1, 1], basis: 'A basis.' } },
      { ...command, experimentId: 'order-mix', change: { value: [{ modelLine: '3', weight: NaN }], basis: 'A basis.' } }];
    for (const input of inputs) expect(await client.start(input as ComparisonStartInput)).toMatchObject({ status: 'invalid', writeOutcome: 'not-sent' });
    expect(fetcher).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  });

  it('allows presenter inspection while refusing presenter and employee commands before configuration or tokens', async () => {
    state.set({ status: 'ready', context: { ...context, roles: ['presenter'] } });
    fetcher.mockResolvedValueOnce(ok(catalogue())); expect((await client.readResults()).status).toBe('ok');
    load.mockClear(); getAccessToken.mockClear(); fetcher.mockClear();
    for (const roles of [['presenter'], ['employee']] as const) {
      state.set({ status: 'ready', context: { ...context, roles } });
      expect(await client.start(command)).toMatchObject({ status: 'forbidden', writeOutcome: 'not-sent' });
    }
    expect((await client.readResults()).status).toBe('forbidden');
    expect(load).not.toHaveBeenCalled(); expect(getAccessToken).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses signed-out sessions, unusable tokens and mismatched environments without sending commands', async () => {
    state.set({ status: 'signed-out' }); expect(await client.start(command)).toMatchObject({ status: 'authentication-required', writeOutcome: 'not-sent' });
    state.set({ status: 'ready', context });
    for (const token of [null, '', 'contains whitespace']) {
      getAccessToken.mockResolvedValueOnce(token); expect(await client.start(command)).toMatchObject({ status: 'authentication-required', writeOutcome: 'not-sent' });
    }
    getAccessToken.mockRejectedValueOnce(new Error('private token error'));
    expect((await client.readResults()).status).toBe('authentication-required');
    load.mockResolvedValueOnce({ ...config, environmentId: 'production' });
    expect(await client.start(command)).toMatchObject({ code: 'comparison-environment-mismatch', writeOutcome: 'not-sent' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves safe refusal reasons, field reasons, codes and the currently running job identity', async () => {
    const busy = { status: 'conflict', code: 'job-running', reason: 'A comparison is already running. Wait for it to finish.', retryable: false, jobId: 'comparison-job-existing' };
    fetcher.mockResolvedValueOnce(json({ ...busy, privateProvider: 'discarded' }, 409)); expect(await client.start(command)).toEqual(busy);
    fetcher.mockResolvedValueOnce(json({ status: 'invalid', code: 'invalid-experiment', retryable: false,
      reasons: [{ field: 'change.value', key: 'comparison.pointsAllowanceMultiplier', reason: 'Give a number.' }] }, 400));
    expect(await client.start(command)).toMatchObject({ status: 'invalid', code: 'invalid-experiment', retryable: false,
      reasons: [{ field: 'change.value', reason: 'Give a number.' }] });
    for (const [http, status] of [[401, 'authentication-required'], [403, 'forbidden'], [404, 'not-found'], [503, 'unavailable']] as const) {
      fetcher.mockResolvedValueOnce(json({ status: http === 401 ? 'unauthenticated' : status, code: 'comparison-refused', reason: 'The comparison is unavailable.', retryable: false }, http));
      expect(await client.readProcess()).toMatchObject({ status, code: 'comparison-refused', reason: 'The comparison is unavailable.', retryable: false });
    }
  });

  it('rejects malformed failures, SPA fallback and false successes without exposing response bodies', async () => {
    for (const response of [new Response('<html>private fallback</html>'), json({ status: 'ok', value: null }),
      json({ status: 'forbidden', value: catalogue() }), json({ status: 'ok', value: catalogue() }, 503),
      json({ status: 'unavailable', code: 'unsafe code with private@example.test', reason: 'Unavailable', retryable: true }, 503),
      json({ status: 'invalid', code: 'invalid-experiment', reasons: [{ field: 'value', reason: {} }] }, 400)]) {
      fetcher.mockResolvedValueOnce(response); const result = await client.readResults();
      expect(result.status).toBe('unavailable'); expect(result).not.toHaveProperty('value'); expect(JSON.stringify(result)).not.toContain('private');
    }
  });

  it('keeps unrecognised HTTP outcomes, malformed acceptance and post-send network failures uncertain without retrying', async () => {
    for (const response of [json({ status: 'pending' }, 202), ok(job({ experimentId: 'points', request: { experimentId: 'points', change: { value: 1.5, basis: 'A basis.' } } })),
      new Response('', { status: 502 }), json({ status: 'unavailable', code: 'comparison-unavailable', reason: 'The comparison could not be started.', retryable: true }, 503),
      new Response('', { status: 429 })]) {
      fetcher.mockResolvedValueOnce(response); expect(await client.start(command)).toMatchObject({ writeOutcome: 'unknown' });
    }
    fetcher.mockRejectedValueOnce(new Error('private transport credentials'));
    expect(await client.start(command)).toMatchObject({ status: 'unavailable', writeOutcome: 'unknown' });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('snapshots the submitted command before asynchronous configuration can mutate its change', async () => {
    const settings = deferred<RuntimePublicConfig>(); load.mockReturnValueOnce(settings.promise);
    const change = { value: 1.5, basis: 'Original basis.' };
    const pending = client.start({ experimentId: 'points', commandId: 'snapshot', change }); change.value = 99;
    fetcher.mockResolvedValueOnce(json({ status: 'pending', value: job({ experimentId: 'points', request: { experimentId: 'points', change: { value: 1.5, basis: 'Original basis.' } } }) }, 202));
    settings.resolve(config); expect((await pending).status).toBe('pending');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).change.value).toBe(1.5);
  });

  it('rejects subject, environment, run, policy and role changes after send while preserving uncertain outcome', async () => {
    for (const delta of [{ subject: 'another' }, { environmentId: 'production' }, { runId: 'new-run' },
      { policyVersion: 'new-policy' }, { roles: ['presenter'] as const }]) {
      state.set({ status: 'ready', context }); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
      const pending = client.start(command); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
      state.set({ status: 'ready', context: { ...context, ...delta } }); response.resolve(json({ status: 'pending', value: job() }, 202));
      expect(await pending).toMatchObject({ status: 'account-changed', writeOutcome: 'unknown' }); fetcher.mockClear();
    }
  });

  it('rejects a same-account session replacement and explicit current-scope response conflicts', async () => {
    const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const pending = client.readResults(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    state.set({ status: 'signed-out' }); state.set({ status: 'ready', context }); response.resolve(ok(catalogue()));
    expect((await pending).status).toBe('account-changed');
    for (const extra of [{ runId: 'retired-run' }, { environmentId: 'production' }]) {
      fetcher.mockResolvedValueOnce(json({ status: 'ok', value: catalogue(), ...extra }));
      expect((await client.readResults()).status).toBe('stale-run');
    }
  });

  it('does not send when context changes during configuration or token acquisition', async () => {
    const settings = deferred<RuntimePublicConfig>(); load.mockReturnValueOnce(settings.promise);
    const first = client.start(command); state.set({ status: 'ready', context: { ...context, runId: 'new-run' } }); settings.resolve(config);
    expect(await first).toMatchObject({ status: 'account-changed', writeOutcome: 'not-sent' });
    state.set({ status: 'ready', context }); const token = deferred<string | null>(); getAccessToken.mockReturnValueOnce(token.promise);
    const second = client.start(command); await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalled());
    state.set({ status: 'ready', context: { ...context } }); token.resolve('replacement-token');
    expect(await second).toMatchObject({ status: 'account-changed', writeOutcome: 'not-sent' }); expect(fetcher).not.toHaveBeenCalled();
  });

  it('discards parsed data after account changes during JSON parsing', async () => {
    const body = deferred<unknown>(); const parse = vi.fn(() => body.promise);
    fetcher.mockResolvedValueOnce({ status: 200, json: parse } as unknown as Response);
    const pending = client.readProcess(); await vi.waitFor(() => expect(parse).toHaveBeenCalled());
    state.set({ status: 'signed-out' }); body.resolve({ status: 'ok', value: process() });
    expect((await pending).status).toBe('account-changed');
  });

  it('distinguishes pre-send abort from uncertain post-send abort even when transport ignores the signal', async () => {
    const before = new AbortController(); before.abort();
    expect(await client.start(command, { signal: before.signal })).toMatchObject({ status: 'aborted', writeOutcome: 'not-sent' });
    expect(fetcher).not.toHaveBeenCalled();
    const caller = new AbortController(); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const pending = client.start(command, { signal: caller.signal }); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    caller.abort(); expect(await pending).toMatchObject({ status: 'aborted', writeOutcome: 'unknown' });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true); response.resolve(json({ status: 'pending', value: job() }, 202));
    await Promise.resolve(); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('bounds stalled configuration and tokens with a finite timeout before a write is sent', async () => {
    vi.useFakeTimers(); const settings = deferred<RuntimePublicConfig>(); load.mockReturnValueOnce(settings.promise);
    const first = client.start(command); await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toMatchObject({ code: 'comparison-timeout', writeOutcome: 'not-sent' }); settings.resolve(config);
    await vi.advanceTimersByTimeAsync(0); expect(getAccessToken).not.toHaveBeenCalled();
    const token = deferred<string | null>(); getAccessToken.mockReturnValueOnce(token.promise);
    const second = client.start(command); await vi.advanceTimersByTimeAsync(10_000);
    expect(await second).toMatchObject({ code: 'comparison-timeout', writeOutcome: 'not-sent' }); token.resolve('late-token');
    await vi.advanceTimersByTimeAsync(0); expect(fetcher).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds transport and body parsing after send and cannot turn late completion into confirmation', async () => {
    vi.useFakeTimers(); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const first = client.start(command); await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toMatchObject({ code: 'comparison-timeout', writeOutcome: 'unknown' });
    response.resolve(json({ status: 'pending', value: job() }, 202)); await vi.advanceTimersByTimeAsync(0);
    const body = deferred<unknown>(); fetcher.mockResolvedValueOnce({ status: 202, json: () => body.promise } as unknown as Response);
    const second = client.start(command); await vi.advanceTimersByTimeAsync(10_000);
    expect(await second).toMatchObject({ code: 'comparison-timeout', writeOutcome: 'unknown' });
    body.resolve({ status: 'pending', value: job() }); await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});
