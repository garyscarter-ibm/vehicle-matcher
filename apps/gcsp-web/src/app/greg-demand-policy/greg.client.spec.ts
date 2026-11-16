import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { GregClient } from './greg.client';
import type { GregPublishInput } from './greg.types';

const at = '2026-11-16T12:00:00.000Z';
const context: ApplicationContext = { subject: 'greg-subject', environmentId: 'isolated', runId: 'run-1', roles: ['greg', 'employee'], policyVersion: 'policy-1', capabilities: [] };
const input = (): GregPublishInput => ({ commandId: 'command-1', policyVersion: 'greg-command-1', expectedActiveVersion: 'policy-1',
  effectiveFrom: at, changes: [{ id: 'weight:body', value: 2 }] });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const refusal = (status = 'unsupported', code = 'preview-unavailable') => ({ status, code, reason: 'Authoritative service reason.', retryable: false });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('Greg bearer transport and immutable commands', () => {
  let state = signal<SessionState>({ status: 'ready', context });
  let fetcher = vi.fn<typeof fetch>(); let token = vi.fn(async (): Promise<string | null> => 'greg-token'); let client: GregClient;
  const config = { environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1/' };
  beforeEach(() => {
    state = signal<SessionState>({ status: 'ready', context }); fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(422, refusal()));
    token = vi.fn(async () => 'greg-token');
    const injector = Injector.create({ providers: [GregClient, { provide: AuthPort, useValue: { state, getAccessToken: token } },
      { provide: RuntimeConfigService, useValue: { load: async () => config } }, { provide: PORTAL_FETCH, useValue: fetcher }] });
    client = runInInjectionContext(injector, () => injector.get(GregClient));
  });
  afterEach(() => vi.useRealTimers());

  it('uses independent versioned URLs, bearer authorization, no cookies or client authority', async () => {
    await client.loadDemand(); await client.readPolicy(); await client.preview({ expectedActiveVersion: 'policy-1', changes: input().changes });
    expect(fetcher.mock.calls.map(c => c[0])).toEqual(['https://api.example/api/gcsp/v1/greg/demand',
      'https://api.example/api/gcsp/v1/greg/policy', 'https://api.example/api/gcsp/v1/greg/policy/preview']);
    for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer greg-token' } });
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('body');
    expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ expectedActiveVersion: 'policy-1', changes: input().changes });
  });
  it('preserves 422 preview-unavailable and never automatically sends a publication', async () => {
    expect(await client.preview({ expectedActiveVersion: 'policy-1', changes: input().changes })).toMatchObject({ state: 'refused', httpStatus: 422, refusal: refusal() });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('denies employee, presenter and mixed presenter before token acquisition or fetch', async () => {
    for (const roles of [['employee'], ['presenter'], ['greg', 'presenter']] as const) {
      state.set({ status: 'ready', context: { ...context, roles } });
      expect(await client.readPolicy()).toMatchObject({ state: 'failed', problem: 'role-required' });
      expect(client.preparePublish(input())).toMatchObject({ state: 'failed', problem: 'role-required' });
    }
    expect(token).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rechecks exact ready-session identity after token await, including A to B to A', async () => {
    const pending = deferred<string | null>(); token.mockReturnValueOnce(pending.promise);
    const work = client.readPolicy(); await vi.waitFor(() => expect(token).toHaveBeenCalledOnce());
    state.set({ status: 'signed-out' }); state.set({ status: 'ready', context }); pending.resolve('old-token');
    expect(await work).toMatchObject({ state: 'failed', problem: 'context-changed' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('discards body data if the subject, run, environment, roles or policy changes', async () => {
    for (const patch of [{ subject: 'other' }, { runId: 'run-2' }, { environmentId: 'other' }, { policyVersion: 'policy-2' }, { roles: ['greg', 'presenter'] as const }]) {
      state.set({ status: 'ready', context }); const body = deferred<unknown>();
      fetcher.mockResolvedValueOnce({ status: 503, ok: false, json: () => body.promise } as Response);
      const work = client.readPolicy(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
      state.set({ status: 'ready', context: { ...context, ...patch } }); body.resolve(refusal('unavailable', 'private-source-detail'));
      expect(await work).toMatchObject({ state: 'failed', problem: 'context-changed', value: null }); fetcher.mockClear();
    }
  });
  it('retains identical payload bytes and rejects forged commands and old sessions', async () => {
    fetcher.mockResolvedValue(json(202, refusal('uncertain', 'outcome-uncertain')));
    const source = input(); const command = client.preparePublish(source); if ('state' in command) throw new Error('Command was refused');
    expect(Object.isFrozen(command.input.changes[0])).toBe(true);
    (source.changes as { id: string; value: number }[])[0].value = 9;
    const first = await client.publish(command); const second = await client.publish(command);
    expect(first).toMatchObject({ state: 'refused', writeOutcome: 'unknown', httpStatus: 202 });
    expect(second).toMatchObject({ state: 'refused', writeOutcome: 'unknown' });
    expect(fetcher.mock.calls[0][1]!.body).toBe(fetcher.mock.calls[1][1]!.body);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual(input());
    expect(await client.publish({ ...command })).toMatchObject({ state: 'failed', problem: 'unrecognized-command', writeOutcome: 'not-sent' });
    state.set({ status: 'ready', context: { ...context } });
    expect(await client.publish(command)).toMatchObject({ state: 'failed', problem: 'context-changed', writeOutcome: 'not-sent' }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('maps structured HTTP refusals and rejects mismatched success/status envelopes', async () => {
    for (const [http, status] of [[400, 'invalid'], [401, 'unauthenticated'], [403, 'forbidden'], [409, 'stale-run'],
      [409, 'stale-version'], [409, 'conflict'], [422, 'unsupported'], [503, 'unavailable'], [202, 'uncertain']] as const) {
      fetcher.mockResolvedValueOnce(json(http, refusal(status, status)));
      expect(await client.readPolicy()).toMatchObject({ state: 'refused', httpStatus: http, refusal: { status } });
    }
    fetcher.mockResolvedValueOnce(json(200, refusal())); expect(await client.readPolicy()).toMatchObject({ state: 'invalid-response' });
    fetcher.mockResolvedValueOnce(json(503, refusal('invalid'))); expect(await client.readPolicy()).toMatchObject({ state: 'invalid-response' });
  });
  it('aborts an uncooperative token wait and never fetches when it later resolves', async () => {
    const pending = deferred<string | null>(); token.mockReturnValueOnce(pending.promise); const controller = new AbortController();
    const work = client.readPolicy({ signal: controller.signal }); await vi.waitFor(() => expect(token).toHaveBeenCalledOnce()); controller.abort();
    expect(await work).toMatchObject({ state: 'failed', problem: 'aborted' }); pending.resolve('late-token'); await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('marks a timed-out dispatched publication unknown and does not replay it', async () => {
    vi.useFakeTimers(); const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise);
    const command = client.preparePublish(input()); if ('state' in command) throw new Error('No command');
    const work = client.publish(command); await vi.advanceTimersByTimeAsync(10000);
    expect(await work).toMatchObject({ state: 'failed', problem: 'timeout', writeOutcome: 'unknown' }); expect(fetcher).toHaveBeenCalledOnce();
    pending.resolve(json(202, refusal('uncertain'))); await Promise.resolve(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects duplicate, negative, fractional, unbounded and forged-authority changes locally', async () => {
    for (const invalid of [{ ...input(), changes: [] }, { ...input(), changes: [input().changes[0], input().changes[0]] },
      { ...input(), changes: [{ id: 'weight:body', value: -1 }] }, { ...input(), changes: [{ id: 'weight:body', value: 0.5 }] },
      { ...input(), changes: Array.from({ length: 101 }, (_, i) => ({ id: `weight:${i}`, value: 1 })) }, { ...input(), runId: 'forged' }]) {
      expect(client.preparePublish(invalid)).toMatchObject({ state: 'failed', problem: 'invalid-command' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
