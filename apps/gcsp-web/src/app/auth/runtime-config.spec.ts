import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_RUNTIME_CONFIG, loadRuntimeConfig, PORTAL_FETCH, RuntimeConfigError, RuntimeConfigService, validateRuntimeConfig } from './runtime-config';
const origin = 'https://portal.example';
function config(base = origin) { return { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1/', oidc: { authority: 'https://identity.example/tenant', clientId: 'public-client', scope: 'openid profile', redirectUri: `${base}/gcsp/auth/callback`, postLogoutRedirectUri: `${base}/gcsp/` } }; }
describe('runtime public configuration', () => {
  it('uses deployment configuration without embedding an environment or provider', () => {
    const parsed = validateRuntimeConfig(config(), origin);
    expect(parsed.apiBaseUrl).toBe('https://api.example/api/gcsp/v1'); expect(parsed.oidc.authority).toBe('https://identity.example/tenant'); expect(Object.isFrozen(parsed.oidc)).toBe(true);
  });
  it('accepts registered local loopback HTTP only for local proof', () => {
    const local = config('http://localhost:4200'); local.apiBaseUrl = 'http://127.0.0.1:8080/api/gcsp/v1'; local.oidc.authority = 'http://[::1]:8081/realm';
    expect(validateRuntimeConfig(local, 'http://localhost:4200').environmentId).toBe('isolated');
    for (const url of ['http://api.example/api/gcsp/v1', 'http://localhost.evil.example/api/gcsp/v1', 'javascript:alert(1)', 'https://user:secret@api.example/api/gcsp/v1', 'https://api.example/api/gcsp/v1?token=secret', 'https://api.example/api/gcsp/v1#secret', 'https://api.example']) expect(() => validateRuntimeConfig({ ...config(), apiBaseUrl: url }, origin)).toThrow(RuntimeConfigError);
  });
  it('rejects missing, malformed, secret-bearing or unsupported configuration', () => {
    for (const value of [null, {}, { ...config(), schemaVersion: 2 }, { ...config(), environmentId: '' }, { ...config(), clientSecret: 'secret' }, { ...config(), oidc: { ...config().oidc, clientSecret: 'secret' } }, { ...config(), oidc: { ...config().oidc, scope: 'profile' } }]) expect(() => validateRuntimeConfig(value, origin)).toThrow(RuntimeConfigError);
  });
  it('requires exact same-origin callback and portal logout URLs', () => {
    for (const redirectUri of ['https://other.example/gcsp/auth/callback', 'https://portal.example/gcsp/auth/callback?returnTo=other', 'https://portal.example/gcsp/account']) expect(() => validateRuntimeConfig({ ...config(), oidc: { ...config().oidc, redirectUri } }, origin)).toThrow(RuntimeConfigError);
    for (const postLogoutRedirectUri of ['https://other.example/gcsp/', 'https://portal.example/gcsp/sign-in', 'https://portal.example/']) expect(() => validateRuntimeConfig({ ...config(), oidc: { ...config().oidc, postLogoutRedirectUri } }, origin)).toThrow(RuntimeConfigError);
  });
  it('loads JSON without browser credentials, caches or redirect following', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(config())));
    await loadRuntimeConfig(fetcher, origin);
    expect(fetcher).toHaveBeenCalledWith(`${origin}/gcsp/runtime-config.json`, expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
  });
  it('turns missing and malformed responses into safe explicit failures', async () => {
    for (const response of [new Response('', { status: 404 }), new Response('<html>fallback</html>'), new Response('{}')]) await expect(loadRuntimeConfig(vi.fn(async () => response), origin)).rejects.toBeInstanceOf(RuntimeConfigError);
    await expect(loadRuntimeConfig(vi.fn(async () => { throw new Error('private transport details'); }), origin)).rejects.toThrow('Sign-in settings are not available. Please try again later.');
  });
  it('consumes successfully validated pre-bootstrap settings without a duplicate fetch', async () => {
    const fetcher = vi.fn(); const value = validateRuntimeConfig(config(), origin); TestBed.configureTestingModule({ providers: [{ provide: PORTAL_FETCH, useValue: fetcher }, { provide: INITIAL_RUNTIME_CONFIG, useValue: { value } }] }); const service = TestBed.inject(RuntimeConfigService); expect(await service.load()).toBe(value); expect(await service.load()).toBe(value); expect(fetcher).not.toHaveBeenCalled();
  });
  it('shows the initial settings failure and then permits a genuine retry', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(config(document.location.origin)))); TestBed.configureTestingModule({ providers: [{ provide: PORTAL_FETCH, useValue: fetcher }, { provide: INITIAL_RUNTIME_CONFIG, useValue: { error: new RuntimeConfigError('config-unavailable') } }] }); const service = TestBed.inject(RuntimeConfigService); await expect(service.load()).rejects.toBeInstanceOf(RuntimeConfigError); expect(fetcher).not.toHaveBeenCalled(); expect((await service.load()).environmentId).toBe('isolated'); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('coalesces valid loads and permits a fresh attempt after configuration failure', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockImplementation(async () => new Response(JSON.stringify(config(document.location.origin))));
    TestBed.configureTestingModule({ providers: [{ provide: PORTAL_FETCH, useValue: fetcher }] }); const service = TestBed.inject(RuntimeConfigService);
    await expect(service.load()).rejects.toBeInstanceOf(RuntimeConfigError);
    const a = service.load(); const b = service.load(); expect(a).toBe(b); await a; await service.load(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
