import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService, RuntimePublicConfig } from '../auth/runtime-config';
import { OutboxClient, OutboxMessage, OutboxProjection } from './outbox.client';

const context: ApplicationContext = { subject: 'presenter-subject', roles: ['presenter'], environmentId: 'isolated',
  runId: 'current-run', policyVersion: 'retained-policy', capabilities: [] };
const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1',
  oidc: { authority: 'https://issuer.example', clientId: 'public-client', scope: 'openid',
    redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (value: unknown = projection()) => json({ status: 'ok', value });
function message(extra: Partial<OutboxMessage> = {}): OutboxMessage {
  return { jobId: 'notification:offer:offer-1:v1', messageKind: 'offer', state: 'sent', transport: 'captured', attempts: 1,
    error: null, nextAttemptAt: null, time: '2026-11-16T10:00:00.123456789Z', recipient: { employeeId: 'employee-1', name: 'Sam' },
    subject: 'Your offer', textBody: 'An offer is ready.\nNo email has been sent.', htmlBody: '<p>An offer is ready.</p>',
    offerLink: '/gcsp/offers/offer-1', ...extra };
}
function projection(messages: readonly OutboxMessage[] = [message()]): OutboxProjection { return { runId: context.runId, messages }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe('presenter outbox read client', () => {
  const state = signal<SessionState>({ status: 'ready', context });
  const getAccessToken = vi.fn(async (): Promise<string | null> => 'access-token');
  const fetcher = vi.fn<typeof fetch>(); const load = vi.fn(async () => config);
  let client: OutboxClient;
  beforeEach(() => {
    state.set({ status: 'ready', context }); getAccessToken.mockReset().mockResolvedValue('access-token');
    fetcher.mockReset(); load.mockReset().mockResolvedValue(config);
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state, getAccessToken } },
      { provide: RuntimeConfigService, useValue: { load } }, { provide: PORTAL_FETCH, useValue: fetcher }] });
    client = TestBed.inject(OutboxClient);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('reads the actual Java envelope from the exact selector-free endpoint with bearer and no cookies or body', async () => {
    fetcher.mockResolvedValueOnce(ok());
    expect(await client.read()).toEqual({ status: 'ok', value: projection() });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(`${config.apiBaseUrl}/presenter/outbox`, {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { Accept: 'application/json', Authorization: 'Bearer access-token' },
    });
    const [url, options] = fetcher.mock.calls[0];
    expect(new URL(url as string).search).toBe(''); expect(options?.body).toBeUndefined();
  });

  it('projects only named safe fields and keeps recipient identity separate from presenter authority', async () => {
    const row = { ...message(), payload: { secret: 'private payload' }, inputDigest: 'private digest',
      providerMessageId: 'private provider id', recipientAddress: 'private@example.test',
      recipient: { ...message().recipient, email: 'private@example.test', provider: { secret: 'private' } } };
    fetcher.mockResolvedValueOnce(ok({ ...projection([row]), provider: { private: true }, sender: 'sender@example.test' }));
    expect(await client.read()).toEqual({ status: 'ok', value: projection() });
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer access-token' });
  });

  it('preserves empty outbox, nullable unrendered messages and safe unknown states without inventing delivery', async () => {
    fetcher.mockResolvedValueOnce(ok(projection([])));
    expect(await client.read()).toEqual({ status: 'ok', value: projection([]) });
    const row = message({ state: 'provider-new-state', transport: null, attempts: 0, error: null, time: null, nextAttemptAt: null,
      subject: null, textBody: null, htmlBody: null, offerLink: null, recipient: { employeeId: 'employee-2', name: null } });
    fetcher.mockResolvedValueOnce(ok(projection([row])));
    expect(await client.read()).toEqual({ status: 'ok', value: projection([row]) });
  });

  it('retains configured transport and nanosecond Java Instants as supplied', async () => {
    const row = message({ state: 'retrying', transport: 'configured', error: 'provider-timeout',
      nextAttemptAt: '2026-11-16T10:00:01.000000001Z', time: '2026-11-16T10:00:00Z' });
    fetcher.mockResolvedValueOnce(ok(projection([row])));
    expect(await client.read()).toEqual({ status: 'ok', value: projection([row]) });
  });

  it('does not fetch for signed-out, unavailable, employee or Greg sessions', async () => {
    for (const session of [{ status: 'signed-out' }, { status: 'loading' },
      { status: 'unavailable', message: 'Unavailable', retryable: true }] as SessionState[]) {
      state.set(session); expect((await client.read()).status).toBe('authentication-required');
    }
    for (const roles of [['employee'], ['greg']] as const) {
      state.set({ status: 'ready', context: { ...context, roles } });
      expect(await client.read()).toEqual({ status: 'forbidden', code: 'presenter-role-required', retryable: false });
    }
    expect(load).not.toHaveBeenCalled(); expect(getAccessToken).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not fetch without a usable bearer credential or matching configured environment', async () => {
    for (const token of [null, '', 'contains whitespace']) {
      getAccessToken.mockResolvedValueOnce(token); expect((await client.read()).status).toBe('authentication-required');
    }
    getAccessToken.mockRejectedValueOnce(new Error('private token error'));
    expect((await client.read()).status).toBe('authentication-required');
    load.mockResolvedValueOnce({ ...config, environmentId: 'production' });
    expect(await client.read()).toEqual({ status: 'unavailable', code: 'outbox-environment-mismatch', retryable: false });
    load.mockRejectedValueOnce(new Error('private configuration error')); expect((await client.read()).status).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed or false-success envelopes and SPA fallback without exposing data', async () => {
    for (const response of [new Response('<html>SPA fallback</html>'), json({ status: 'ok', value: null }),
      json({ runId: context.runId, messages: [] }), json({ status: 'ok', value: { messages: [] } }),
      ok({ runId: context.runId, messages: 'invalid' }), json({ status: 'forbidden', value: projection() }),
      json({ status: 'ok', value: projection() }, 503)]) {
      fetcher.mockResolvedValueOnce(response); const result = await client.read();
      expect(result.status).toBe('unavailable'); expect(result).not.toHaveProperty('value');
    }
  });

  it('rejects malformed message fields, duplicate jobs and missing actual recipient identity', async () => {
    for (const row of [{ ...message(), jobId: '' }, { ...message(), messageKind: null }, { ...message(), state: 42 },
      { ...message(), transport: 'brevo' }, { ...message(), attempts: -1 }, { ...message(), attempts: 1.5 },
      { ...message(), error: 'private error with address@example.test' }, { ...message(), nextAttemptAt: 'tomorrow' },
      { ...message(), time: '2026-02-30T10:00:00Z' }, { ...message(), recipient: { employeeId: null, name: 'Sam' } },
      { ...message(), recipient: { employeeId: 'employee-1' } }, { ...message(), textBody: { payload: 'private' } },
      { ...message(), htmlBody: undefined }, { ...message(), offerLink: 42 }]) {
      fetcher.mockResolvedValueOnce(ok({ runId: context.runId, messages: [row] }));
      expect(await client.read()).toEqual({ status: 'unavailable', code: 'outbox-response-invalid', retryable: false });
    }
    fetcher.mockResolvedValueOnce(ok(projection([message(), message()])));
    expect((await client.read()).status).toBe('unavailable');
  });

  it('rejects run and environment conflicts in the response before returning any message', async () => {
    for (const value of [{ ...projection(), runId: 'retired-run' }, { ...projection(), environmentId: 'production' },
      { ...projection(), messages: [{ ...message(), runId: 'retired-run' }] }]) {
      fetcher.mockResolvedValueOnce(ok(value));
      expect(await client.read()).toEqual({ status: 'unavailable', code: 'outbox-response-scope-mismatch', retryable: false });
    }
  });

  it('retains safe 401, 403, 409 and 503 codes without replaying requests or carrying private errors', async () => {
    for (const [httpStatus, status, errorCode, retryable] of [[401, 'authentication-required', 'expired-token', false],
      [403, 'forbidden', 'presenter-required', false], [409, 'stale-run', 'retired-run', false],
      [503, 'unavailable', 'database-unavailable', true]] as const) {
      fetcher.mockResolvedValueOnce(json({ status, code: errorCode, retryable, message: 'private address@example.test', provider: { secret: true } }, httpStatus));
      expect(await client.read()).toEqual({ status, code: errorCode, retryable });
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('maps non-JSON authentication and role refusals truthfully and rejects malformed failure fields', async () => {
    fetcher.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response('', { status: 403 }));
    expect((await client.read()).status).toBe('authentication-required'); expect((await client.read()).status).toBe('forbidden');
    for (const body of [{ status: 'unavailable', code: 'private error@example.test', retryable: true },
      { status: 'unavailable', code: 'database-unavailable', retryable: 'yes' }]) {
      fetcher.mockResolvedValueOnce(json(body, 503));
      expect(await client.read()).toEqual({ status: 'unavailable', code: 'outbox-response-invalid', retryable: false });
    }
  });

  it('discards a late result after subject, run, environment or presenter-role replacement', async () => {
    for (const delta of [{ subject: 'another-presenter' }, { runId: 'new-run' }, { environmentId: 'production' }, { roles: ['employee'] as const }]) {
      state.set({ status: 'ready', context }); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
      const pending = client.read(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
      state.set({ status: 'ready', context: { ...context, ...delta } }); response.resolve(ok());
      expect(await pending).toEqual({ status: 'account-changed', code: 'outbox-context-changed', retryable: false }); fetcher.mockClear();
    }
  });

  it('discards late data after a same-account new session even when every scope field matches', async () => {
    const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const pending = client.read(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    state.set({ status: 'signed-out' }); state.set({ status: 'ready', context }); response.resolve(ok());
    expect(await pending).toEqual({ status: 'account-changed', code: 'outbox-context-changed', retryable: false });
  });

  it('does not fetch when context changes while resolving configuration or credentials', async () => {
    const settings = deferred<RuntimePublicConfig>(); load.mockReturnValueOnce(settings.promise);
    const first = client.read(); state.set({ status: 'ready', context: { ...context, runId: 'new-run' } }); settings.resolve(config);
    expect((await first).status).toBe('account-changed');
    state.set({ status: 'ready', context }); const token = deferred<string | null>(); getAccessToken.mockReturnValueOnce(token.promise);
    const second = client.read(); await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalled());
    state.set({ status: 'ready', context: { ...context } }); token.resolve('replacement-token');
    expect((await second).status).toBe('account-changed'); expect(fetcher).not.toHaveBeenCalled();
  });

  it('discards data if the account changes during response-body parsing', async () => {
    const body = deferred<unknown>(); const parse = vi.fn(() => body.promise);
    fetcher.mockResolvedValueOnce({ status: 200, json: parse } as unknown as Response);
    const pending = client.read(); await vi.waitFor(() => expect(parse).toHaveBeenCalled());
    state.set({ status: 'signed-out' }); body.resolve({ status: 'ok', value: projection() });
    expect((await pending).status).toBe('account-changed');
  });

  it('honours pre-abort and an active caller abort even when transport ignores the signal', async () => {
    const before = new AbortController(); before.abort();
    expect((await client.read({ signal: before.signal })).status).toBe('aborted'); expect(fetcher).not.toHaveBeenCalled();
    const caller = new AbortController(); const response = deferred<Response>(); fetcher.mockReturnValueOnce(response.promise);
    const pending = client.read({ signal: caller.signal }); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    caller.abort(); expect(await pending).toEqual({ status: 'aborted', code: 'outbox-request-aborted', retryable: false });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true); response.resolve(ok());
    await Promise.resolve(); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('times out finitely at ten seconds when transport ignores abort', async () => {
    vi.useFakeTimers(); fetcher.mockReturnValueOnce(new Promise<Response>(() => {}));
    const pending = client.read(); await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ status: 'unavailable', code: 'outbox-timeout', retryable: true });
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled configuration or credential lookup and never fetches after its late completion', async () => {
    vi.useFakeTimers(); const settings = deferred<RuntimePublicConfig>(); load.mockReturnValueOnce(settings.promise);
    const first = client.read(); await vi.advanceTimersByTimeAsync(10_000);
    expect((await first).status).toBe('unavailable'); settings.resolve(config); await vi.advanceTimersByTimeAsync(0);
    expect(getAccessToken).not.toHaveBeenCalled();
    const token = deferred<string | null>(); getAccessToken.mockReturnValueOnce(token.promise);
    const second = client.read(); await vi.advanceTimersByTimeAsync(10_000);
    expect((await second).status).toBe('unavailable'); token.resolve('late-token'); await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds stalled body parsing and cannot return a late body after timeout', async () => {
    vi.useFakeTimers(); const body = deferred<unknown>();
    fetcher.mockResolvedValueOnce({ status: 200, json: () => body.promise } as unknown as Response);
    const pending = client.read(); await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ status: 'unavailable', code: 'outbox-timeout', retryable: true });
    body.resolve({ status: 'ok', value: projection() }); await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('contains network failure with no private details or invented capture/delivery', async () => {
    fetcher.mockRejectedValueOnce(new Error('provider credentials and private address@example.test'));
    expect(await client.read()).toEqual({ status: 'unavailable', code: 'outbox-transport-unavailable', retryable: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
