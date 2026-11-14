import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextClient, parseContext } from './context.client';
import { PORTAL_FETCH, RuntimePublicConfig } from './runtime-config';
const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1', oidc: { authority: 'https://identity.example', clientId: 'client', scope: 'openid', redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } };
const context = { subject: 'server-subject', roles: ['employee'], environmentId: 'isolated', runId: 'server-run', employeeId: 'server-mapping', policyVersion: 'retained-policy', capabilities: ['account:read'] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe('app-local bearer context client', () => {
  const fetcher = vi.fn<typeof fetch>(); const getAccessToken = vi.fn(async () => 'access-token'); const renewAccessToken = vi.fn(async (): Promise<string | null> => 'renewed-token');
  let client: ContextClient;
  beforeEach(() => { fetcher.mockReset(); getAccessToken.mockReset().mockResolvedValue('access-token'); renewAccessToken.mockReset().mockResolvedValue('renewed-token'); TestBed.configureTestingModule({ providers: [{ provide: PORTAL_FETCH, useValue: fetcher }] }); client = TestBed.inject(ContextClient); });
  it('GETs only the configured context endpoint with bearer and no cookie authority', async () => {
    fetcher.mockResolvedValue(json({ status: 'ok', value: context }));
    expect(await client.read(config, { getAccessToken, renewAccessToken })).toEqual({ status: 'ok', value: context });
    expect(fetcher).toHaveBeenCalledWith('https://api.example/api/gcsp/v1/context', expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', Authorization: 'Bearer access-token' } })); expect(renewAccessToken).not.toHaveBeenCalled();
  });
  it('renews once after 401 and replays only this read using the renewed token', async () => {
    fetcher.mockResolvedValueOnce(json({ status: 'unauthenticated', code: 'expired', retryable: false }, 401)).mockResolvedValueOnce(json({ status: 'ok', value: context }));
    expect((await client.read(config, { getAccessToken, renewAccessToken })).status).toBe('ok'); expect(renewAccessToken).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer renewed-token' });
    expect(fetcher.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(true);
  });
  it('stops after a second 401 or unsupported renewal', async () => {
    fetcher.mockImplementation(async () => json({ status: 'unauthenticated', code: 'expired', retryable: false }, 401));
    expect((await client.read(config, { getAccessToken, renewAccessToken })).status).toBe('unauthenticated'); expect(fetcher).toHaveBeenCalledTimes(2); expect(renewAccessToken).toHaveBeenCalledOnce();
    fetcher.mockClear(); renewAccessToken.mockResolvedValue(null);
    expect((await client.read(config, { getAccessToken, renewAccessToken })).status).toBe('unauthenticated'); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('never sends a request without a valid credential and never infers roles from it', async () => {
    getAccessToken.mockResolvedValue(''); expect((await client.read(config, { getAccessToken, renewAccessToken })).status).toBe('unauthenticated'); expect(fetcher).not.toHaveBeenCalled();
    getAccessToken.mockResolvedValue('token-with-no-client-role-decoding'); fetcher.mockResolvedValue(json({ status: 'ok', value: { ...context, roles: ['greg'], employeeId: undefined } }));
    const result = await client.read(config, { getAccessToken, renewAccessToken }); expect(result.status === 'ok' && result.value.roles).toEqual(['greg']);
  });
  it('preserves typed denial/unavailability without renewing or exposing upstream message', async () => {
    const error = { status: 'refused', code: 'mapping-not-found', reason: 'unknown-subject', retryable: false, reasons: { account: 'not-mapped' }, message: 'private upstream message' };
    fetcher.mockResolvedValueOnce(json(error, 403)); expect(await client.read(config, { getAccessToken, renewAccessToken })).toEqual({ status: 'denied', error: { status: 'refused', code: 'mapping-not-found', reason: 'unknown-subject', retryable: false, reasons: { account: 'not-mapped' } } });
    fetcher.mockResolvedValueOnce(json({ status: 'unavailable', code: 'repository-unavailable', retryable: true }, 503)); expect((await client.read(config, { getAccessToken, renewAccessToken })).status).toBe('unavailable'); expect(renewAccessToken).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON, typed errors and cross-environment context', async () => {
    for (const response of [new Response('<html>fallback</html>'), json({ status: 'ok', value: { ...context, environmentId: 'running-production' } }), json({ status: 'refused', retryable: 'yes' }, 403), json({ status: 'ok', value: { ...context, roles: ['admin'] } })]) {
      fetcher.mockResolvedValueOnce(response); expect(await client.read(config, { getAccessToken, renewAccessToken })).toEqual({ status: 'unavailable', error: { status: 'unavailable', code: 'invalid-context-response', retryable: true } });
    }
  });
  it('requires trusted employee mapping and retains only explicit profile fields', () => {
    expect(parseContext({ ...context, employeeId: undefined }, 'isolated')).toBeNull(); expect(parseContext({ ...context, roles: ['greg'] }, 'isolated')).toBeNull();
    const parsed = parseContext({ ...context, token: 'must-not-project', displayName: 'Supplied Name' }, 'isolated'); expect(parsed?.displayName).toBe('Supplied Name'); expect(parsed).not.toHaveProperty('token'); expect(Object.isFrozen(parsed?.roles)).toBe(true);
  });
  it('contains network and renewal failure without inventing success', async () => {
    fetcher.mockRejectedValueOnce(new Error('private upstream details')); expect((await client.read(config, { getAccessToken, renewAccessToken })).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(json({}, 401)); renewAccessToken.mockRejectedValueOnce(new Error('unsupported')); expect((await client.read(config, { getAccessToken, renewAccessToken })).status).toBe('unauthenticated');
  });
});
