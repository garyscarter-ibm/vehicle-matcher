import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import type { RuntimePublicConfig } from '../auth/runtime-config';
import { PresenterClient } from './presenter.client';
import type { PresenterClientFailure, PresenterCommand, PresenterResetInput } from './presenter.types';

const at = '2026-07-14T10:00:00.123Z';
const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1/',
  oidc: { authority: 'https://identity.example', clientId: 'portal', scope: 'openid',
    redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } };
const context = (changes: Partial<ApplicationContext> = {}): ApplicationContext => ({ subject: 'presenter-one', environmentId: 'isolated',
  runId: 'run-1', roles: ['presenter'], policyVersion: 'policy-1', capabilities: [], ...changes });
const advance = (runId = 'run-1') => ({ runId, now: at, clockVersion: 2 });
const tick = (runId = 'run-1') => ({ ...advance(runId), tickId: 'tick-1', kind: 'presenter', policyVersion: 'policy-1',
  state: 'pending', handlerOrder: [{ handlerId: 'release', stage: 'release' }], missingStages: ['allocation'],
  outcomes: [{ handlerId: 'release', stage: 'release', outcome: { status: 'ok', value: { released: 3 } } }] });
const clock = (runId = 'run-1') => ({ ...advance(runId), scenarioVersion: 'scenario-1', fixtureVersion: 'fixture-1', startsAt: at,
  namedTimes: { release: at }, lastTick: tick(runId) });
const summary = () => ({ scenarioId: 'mechanics', name: 'Clock mechanics', scenarioVersion: 'scenario-1', fixtureVersion: 'fixture-1', policyVersion: 'policy-1' });
const catalogue = () => ({ catalogueVersion: 'catalogue-1', policyVersion: 'policy-1', scenarios: [{ ...summary(), kind: 'mechanics', clockStart: at,
  namedTimes: { release: at }, principals: [{ employeeId: 'paula', roles: ['employee'] }],
  availability: { available: true, outcome: 'available', missingCapabilities: [] } }] });
const faults = () => ({ runId: 'run-1', faults: [{ adapter: 'stock', available: true, mode: 'none', modes: ['none', 'unavailable', 'stale'] },
  { adapter: 'ordering', available: false, reason: 'not available yet' }] });
const resetInput = (): PresenterResetInput => ({ commandId: 'reset-1', expectedRunId: 'run-1', scenarioId: 'mechanics',
  scenarioVersion: 'scenario-1', fixtureVersion: 'fixture-1', policyVersion: 'policy-1' });
const resetValue = () => ({ retiredRunId: 'run-1', activatedRunId: 'run-2', replayed: false, scenario: summary(), clock: clock('run-2') });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (value: unknown) => json({ status: 'ok', value });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function command(value: PresenterCommand | PresenterClientFailure): PresenterCommand { if ('state' in value) throw new Error(value.problem); return value; }

describe('PresenterClient Java routes, pinned commands and private lifecycle', () => {
  let state = signal<SessionState>({ status: 'ready', context: context() });
  let fetcher = vi.fn<typeof fetch>(); let load = vi.fn<() => Promise<RuntimePublicConfig>>();
  let getAccessToken = vi.fn<() => Promise<string | null>>(); let retry = vi.fn(); let client: PresenterClient;
  const makeClient = () => runInInjectionContext(Injector.create({ providers: [
    { provide: AuthPort, useValue: { state, getAccessToken, retry } }, { provide: RuntimeConfigService, useValue: { load } },
    { provide: PORTAL_FETCH, useValue: fetcher },
  ] }), () => new PresenterClient());
  const prepare = () => command(client.prepareAdvance({ commandId: 'advance-1', expectedClockVersion: 1, bySeconds: 60 }));
  beforeEach(() => {
    state = signal<SessionState>({ status: 'ready', context: context() }); fetcher = vi.fn<typeof fetch>();
    load = vi.fn<() => Promise<RuntimePublicConfig>>().mockResolvedValue(config);
    getAccessToken = vi.fn<() => Promise<string | null>>().mockResolvedValue('access-token'); retry = vi.fn(); client = makeClient();
  });
  afterEach(() => vi.useRealTimers());

  it('P01 reads only actual presenter GET routes without account selectors or cookies', async () => {
    const controls = { ...clock(), controls: { policyVersion: 'policy-1', step: { value: 60, unit: 'seconds' },
      namedTimes: { release: at }, nextRelease: { status: 'unavailable', reason: 'No future release' } } };
    for (const value of [clock(), controls, tick(), catalogue(), { ...clock(), catalogueVersion: 'c1', currentScenario: summary() }, faults()]) fetcher.mockResolvedValueOnce(ok(value));
    for (const result of [await client.readClock(), await client.readControls(), await client.readTick('tick-1'), await client.readCatalogue(),
      await client.readCurrentScenario(), await client.readFaults()]) expect(result.state).toBe('ready');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['presenter/clock', 'presenter/controls', 'presenter/clock/ticks/tick-1',
      'presenter/scenarios', 'presenter/scenarios/current', 'presenter/scenarios/faults'].map((p) => `https://api.example/api/gcsp/v1/${p}`));
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer access-token' } });
      expect(init?.body).toBeUndefined(); expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it('P02 strips catalogue principals and retains actual unavailable fault projections', async () => {
    fetcher.mockResolvedValueOnce(ok(catalogue())).mockResolvedValueOnce(ok(faults()));
    const c = await client.readCatalogue(); expect(c.state).toBe('ready');
    if (c.state === 'ready') expect(c.value.scenarios[0]).not.toHaveProperty('principals');
    expect(await client.readFaults()).toMatchObject({ state: 'ready', value: { faults: [{ available: true }, { adapter: 'ordering', available: false }] } });
  });
  it('P03 freezes reviewed bytes and submits exact API bodies only on explicit same-command calls', async () => {
    const input = { commandId: 'a1', expectedClockVersion: 1, bySeconds: 60 };
    const a = command(client.prepareAdvance(input)); input.bySeconds = 120;
    const commands = [a, command(client.prepareTick({ tickId: 'tick-1', expectedClockVersion: 2 })),
      command(client.prepareControlTick({ commandId: 'c1', expectedClockVersion: 1, mode: 'next-release' })),
      command(client.prepareReset(resetInput())), command(client.prepareFault({ commandId: 'f1', adapter: 'stock', mode: 'stale' }))];
    expect(fetcher).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
    for (const c of commands) { expect(Object.isFrozen(c)).toBe(true); expect(Object.isFrozen(c.input)).toBe(true); }
    for (const value of [advance(), tick(), { advance: advance(), tick: tick() }, resetValue(), faults(), advance()]) fetcher.mockResolvedValueOnce(ok(value));
    for (const c of commands) expect((await client.submit(c)).state).toBe('ready');
    expect((await client.submit(a)).state).toBe('ready');
    expect(fetcher.mock.calls.map(([url]) => String(url).split('/v1')[1])).toEqual(['/presenter/clock/advance', '/presenter/clock/tick', '/presenter/controls/tick',
      '/presenter/scenarios/reset', '/presenter/scenarios/faults', '/presenter/clock/advance']);
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([a.input, commands[1].input, commands[2].input, commands[3].input, commands[4].input, a.input]);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[5][1]?.body);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
  });
  it('P04 rejects fabricated, foreign-client and expired session commands before transport', async () => {
    const a = prepare(); expect(await client.submit({ ...a })).toMatchObject({ problem: 'unrecognized-command', writeOutcome: 'not-sent' });
    expect(await makeClient().submit(a)).toMatchObject({ problem: 'unrecognized-command' });
    state.set({ status: 'ready', context: context() });
    expect(await client.submit(a)).toMatchObject({ problem: 'context-changed', writeOutcome: 'not-sent' });
    expect(fetcher).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  });
  it('P05 validates supported Java inputs and rejects authority selectors', async () => {
    for (const extra of [{ runId: 'other' }, { principal: 'paula' }, { employeeId: 'paula' }, { query: 'x' }, { expectedClockVersion: 0 },
      { bySeconds: 1.2 }, { to: at }, { commandId: '' }]) {
      expect(client.prepareAdvance({ commandId: 'a', expectedClockVersion: 1, bySeconds: 60, ...extra } as never)).toMatchObject({ problem: 'invalid-command' });
    }
    expect(client.prepareTick({ tickId: 'bad/selector?runId=other', expectedClockVersion: 1 })).toMatchObject({ problem: 'invalid-command' });
    expect(client.prepareControlTick({ commandId: 'c', expectedClockVersion: 1, mode: 'step', to: at } as never)).toMatchObject({ problem: 'invalid-command' });
    expect(client.prepareFault({ commandId: 'f', adapter: 'ordering', mode: 'none' })).toMatchObject({ problem: 'invalid-command' });
    expect(client.prepareFault({ commandId: 'f', adapter: 'stock', mode: 'invented' })).toMatchObject({ problem: 'invalid-command' });
    expect(client.prepareReset({ ...resetInput(), principal: 'paula' } as PresenterResetInput)).toMatchObject({ problem: 'invalid-command' });
    expect(await client.readTick('tick?employeeId=other')).toMatchObject({ problem: 'invalid-selector' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['employee', 'greg'] as const)('P06 refuses %s without presenter authority', async (role) => {
    state.set({ status: 'ready', context: context({ roles: [role] }) });
    expect(await client.readClock()).toMatchObject({ problem: 'role-required' }); expect(client.prepareReset(resetInput())).toMatchObject({ problem: 'role-required' });
    expect(load).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['signed-out', 'loading', 'denied', 'unavailable'] as const)('P07 refuses auth %s before transport', async (status) => {
    state.set({ status, message: 'Unavailable', retryable: true } as SessionState);
    expect(await client.readCatalogue()).toMatchObject({ state: 'failed' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['subject', 'environmentId', 'runId', 'policyVersion'] as const)('P08 requires trusted %s', async (field) => {
    state.set({ status: 'ready', context: context({ [field]: '' }) }); expect(await client.readClock()).toMatchObject({ problem: 'context-unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[400, 'invalid'], [401, 'unauthenticated'], [403, 'forbidden'], [404, 'not-found'], [409, 'conflict'], [202, 'pending'], [503, 'unavailable']] as const)(
    'P09 preserves HTTP %s %s refusal and excludes attached values', async (http, status) => {
      fetcher.mockResolvedValueOnce(json({ status, code: 'server-code', reason: 'Server reason', retryable: false, currentVersion: 'scenario-2',
        value: clock(), principals: ['private'], action: 'refresh', operationId: 'op1', reasons: [{ field: 'to', reason: 'Check it' }] }, http));
      const result = await client.submit(prepare()); expect(result).toMatchObject({ state: 'refused', value: null, httpStatus: http,
        refusal: { status, currentVersion: 'scenario-2', action: 'refresh', operationId: 'op1' } });
      expect(result).not.toHaveProperty('principals'); expect(fetcher).toHaveBeenCalledTimes(1); expect(retry).not.toHaveBeenCalled();
      if (http === 202) expect(result).toHaveProperty('writeOutcome', 'unknown');
    });
  it.each([[200, null], [403, { status: 'ok', value: clock() }], [200, { status: 'forbidden', code: 'x', reason: 'Denied', retryable: false }],
    [200, { status: 'ok', value: { ...clock(), namedTimes: { release: 'bad' } } }], [202, { status: 'pending' }],
    [503, { status: 'unavailable', code: 'x', reason: 'Unavailable', retryable: 'yes' }]] as const)(
    'P10 rejects malformed or mismatched HTTP %s responses', async (http, body) => {
      fetcher.mockResolvedValueOnce(json(body, http)); expect(await client.readClock()).toMatchObject({ state: 'invalid-response', value: null, httpStatus: http });
    });
  it('P11 rejects mismatched read run IDs and tick identity', async () => {
    fetcher.mockResolvedValueOnce(ok(clock('retired'))).mockResolvedValueOnce(ok({ ...tick(), tickId: 'other' }));
    expect(await client.readClock()).toMatchObject({ state: 'scope-mismatch', value: null });
    expect(await client.readTick('tick-1')).toMatchObject({ state: 'invalid-response', value: null });
  });
  it('P12 accepts reset new-run success and validates retired run, scenario pins and nested clock', async () => {
    const r = command(client.prepareReset(resetInput())); fetcher.mockResolvedValueOnce(ok(resetValue()));
    expect(await client.submit(r)).toMatchObject({ state: 'ready', value: { activatedRunId: 'run-2', clock: { runId: 'run-2' } } });
    for (const value of [{ ...resetValue(), retiredRunId: 'other' }, { ...resetValue(), scenario: { ...summary(), fixtureVersion: 'changed' } },
      { ...resetValue(), clock: clock('other') }]) {
      fetcher.mockResolvedValueOnce(ok(value)); expect(await client.submit(r)).toMatchObject({ state: 'invalid-response', writeOutcome: 'unknown' });
    }
    fetcher.mockResolvedValueOnce(ok({ ...resetValue(), replayed: true, clock: null }));
    expect(await client.submit(r)).toMatchObject({ state: 'ready', value: { clock: null, replayed: true } });
  });
  it('P13 retains exact reset input after preparation failure and explicit recovery', async () => {
    const r = command(client.prepareReset(resetInput()));
    fetcher.mockResolvedValueOnce(json({ status: 'unavailable', code: 'scenario-preparation-incomplete', reason: 'Send the same reset again', retryable: true, runId: 'run-2' }, 503));
    expect(await client.submit(r)).toMatchObject({ state: 'refused', writeOutcome: 'unknown', refusal: { runId: 'run-2', retryable: true } });
    const bytes = fetcher.mock.calls[0][1]?.body;
    state.set({ status: 'ready', context: context({ runId: 'run-2' }) });
    expect(await client.submit(r)).toMatchObject({ problem: 'context-changed', writeOutcome: 'not-sent' });
    const recovered = command(client.prepareReset(resetInput())); fetcher.mockResolvedValueOnce(ok({ ...resetValue(), replayed: true }));
    expect((await client.submit(recovered)).state).toBe('ready'); expect(fetcher.mock.calls[1][1]?.body).toBe(bytes); expect(retry).not.toHaveBeenCalled();
  });
  it('P14 refuses runtime environment and token failures without sending', async () => {
    load.mockRejectedValueOnce(new Error('No config')); expect(await client.readClock()).toMatchObject({ problem: 'configuration-unavailable' });
    load.mockResolvedValueOnce({ ...config, environmentId: 'production' }); expect(await client.readClock()).toMatchObject({ problem: 'environment-mismatch' });
    for (const token of [null, '', 'two tokens']) { getAccessToken.mockResolvedValueOnce(token); expect(await client.readClock()).toMatchObject({ problem: 'access-token-unavailable' }); }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['subject', 'environmentId', 'runId', 'roles'] as const)('P15 blocks %s change during token acquisition', async (field) => {
    const gate = deferred<string | null>(); const entered = deferred<void>(); getAccessToken.mockImplementationOnce(() => { entered.resolve(); return gate.promise; });
    const pending = client.submit(prepare()); await entered.promise;
    state.set({ status: 'ready', context: context({ [field]: field === 'roles' ? ['employee'] : 'changed' }) }); gate.resolve('token');
    expect(await pending).toMatchObject({ problem: 'context-changed', writeOutcome: 'not-sent' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('P16 rejects results after A to B to new A session or in-place context mutation', async () => {
    const gate = deferred<Response>(); const sent = deferred<void>(); fetcher.mockImplementationOnce(() => { sent.resolve(); return gate.promise; });
    const pending = client.readClock(); await sent.promise;
    state.set({ status: 'ready', context: context({ subject: 'other' }) }); state.set({ status: 'ready', context: context() }); gate.resolve(ok(clock()));
    expect(await pending).toMatchObject({ problem: 'context-changed', value: null });
    const mutable = { ...context() }; state.set({ status: 'ready', context: mutable }); const body = deferred<unknown>(); const reading = deferred<void>();
    fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: () => { reading.resolve(); return body.promise; } } as Response);
    const next = client.readClock(); await reading.promise; mutable.runId = 'changed'; body.resolve({ status: 'ok', value: clock() });
    expect(await next).toMatchObject({ problem: 'context-changed', value: null });
  });
  it('P17 bounds stalled config and suppresses a late write', async () => {
    vi.useFakeTimers(); const gate = deferred<RuntimePublicConfig>(); load.mockReturnValueOnce(gate.promise);
    const pending = client.submit(prepare()); await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ problem: 'timeout', writeOutcome: 'not-sent' }); gate.resolve(config);
    await Promise.resolve(); await Promise.resolve(); expect(getAccessToken).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('P18 bounds stalled token and suppresses its late write', async () => {
    vi.useFakeTimers(); const gate = deferred<string | null>(); getAccessToken.mockReturnValueOnce(gate.promise);
    const pending = client.submit(prepare()); await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ problem: 'timeout', writeOutcome: 'not-sent' }); gate.resolve('late-token');
    await Promise.resolve(); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('P19 cancels before dispatch and preserves unknown dispatched writes without automatic replay', async () => {
    const a = prepare(); const cancelled = new AbortController(); cancelled.abort();
    expect(await client.submit(a, { signal: cancelled.signal })).toMatchObject({ problem: 'aborted', writeOutcome: 'not-sent' });
    const gate = deferred<Response>(); const sent = deferred<void>(); const abort = new AbortController();
    fetcher.mockImplementationOnce(() => { sent.resolve(); return gate.promise; }); const pending = client.submit(a, { signal: abort.signal }); await sent.promise; abort.abort();
    expect(await pending).toMatchObject({ problem: 'aborted', writeOutcome: 'unknown' }); gate.resolve(ok(advance()));
    await Promise.resolve(); await Promise.resolve(); expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(ok(advance())); expect((await client.submit(a)).state).toBe('ready');
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body); expect(retry).not.toHaveBeenCalled();
  });
  it('P20 bounds ignored-abort body parsing and discards late values', async () => {
    vi.useFakeTimers(); const body = deferred<unknown>(); fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: () => body.promise } as Response);
    const pending = client.submit(prepare()); await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ problem: 'timeout', httpStatus: 200, writeOutcome: 'unknown', value: null });
    body.resolve({ status: 'ok', value: advance() }); await Promise.resolve(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('P21 labels invalid JSON and transport loss as unknown write outcomes', async () => {
    const a = prepare(); fetcher.mockResolvedValueOnce(new Response('{bad', { status: 200 })).mockRejectedValueOnce(new TypeError('Network lost'));
    expect(await client.submit(a)).toMatchObject({ state: 'invalid-response', writeOutcome: 'unknown' });
    expect(await client.submit(a)).toMatchObject({ problem: 'transport-unavailable', writeOutcome: 'unknown' }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('P22 preserves named-time advance and both supported control tick modes without derived selectors', async () => {
    const inputs = [{ commandId: 'to-1', expectedClockVersion: 1, to: 'release' },
      { commandId: 'step-1', expectedClockVersion: 1, mode: 'step' as const },
      { commandId: 'to-2', expectedClockVersion: 1, mode: 'to' as const, to: at }] as const;
    const commands = [command(client.prepareAdvance(inputs[0])), command(client.prepareControlTick(inputs[1])), command(client.prepareControlTick(inputs[2]))];
    fetcher.mockResolvedValueOnce(ok(advance())).mockResolvedValueOnce(ok({ advance: advance(), tick: tick() })).mockResolvedValueOnce(ok({ advance: advance(), tick: tick() }));
    for (const c of commands) expect((await client.submit(c)).state).toBe('ready');
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual(inputs);
  });
  it('P23 discards a context change while loading config before token acquisition', async () => {
    const gate = deferred<RuntimePublicConfig>(); const entered = deferred<void>(); load.mockImplementationOnce(() => { entered.resolve(); return gate.promise; });
    const pending = client.submit(prepare()); await entered.promise;
    state.set({ status: 'ready', context: context({ environmentId: 'other' }) }); gate.resolve(config);
    expect(await pending).toMatchObject({ problem: 'context-changed', writeOutcome: 'not-sent' }); expect(getAccessToken).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
});
