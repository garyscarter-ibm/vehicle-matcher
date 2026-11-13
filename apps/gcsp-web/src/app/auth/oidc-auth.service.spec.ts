import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { User, UserManagerSettings } from 'oidc-client-ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextClient, ContextCredentials } from './context.client';
import { AUTH_NAVIGATE, OIDC_MANAGER_FACTORY, OidcAuthService, PORTAL_BROWSER } from './oidc-auth.service';
import { RuntimeConfigService, RuntimePublicConfig } from './runtime-config';
const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1', oidc: { authority: 'https://identity.example', clientId: 'public', scope: 'openid profile', redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/' } };
function user(subject = 'alice', extras: Partial<User> = {}): User { return { access_token: `${subject}-access`, refresh_token: `${subject}-refresh`, id_token: `${subject}-id`, expired: false, profile: { sub: subject }, state: { returnTo: '/gcsp/orders', recovery: false, logoutEpoch: '' }, ...extras } as User; }
function context(subject = 'alice') { return { status: 'ok' as const, value: { subject, roles: ['employee'] as const, environmentId: 'isolated', runId: 'run', policyVersion: 'v1', capabilities: [] } }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
describe('real OIDC authentication adapter', () => {
  let service: OidcAuthService; let stored: User | null; let settings: UserManagerSettings; let credentials: ContextCredentials;
  let manager: any; let browser: Window; let load: any; let read: any; let navigate: any; let routerNavigate: any; let create: any;
  beforeEach(() => {
    stored = user(); const sessionStorage = window.sessionStorage; const localStorage = window.localStorage; sessionStorage.clear(); localStorage.clear(); sessionStorage.setItem('gcsp:auth:observed-logout', '');
    const target = new EventTarget();
    browser = { sessionStorage, localStorage, location: { pathname: '/gcsp/account', search: '', hash: '', href: 'https://portal.example/gcsp/account' }, history: { replaceState: vi.fn() }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) } as unknown as Window;
    manager = { getUser: vi.fn(async () => stored), removeUser: vi.fn(async () => { stored = null; }), clearStaleState: vi.fn(async () => {}), signinRedirect: vi.fn(async () => {}), signinRedirectCallback: vi.fn(async () => { stored = user(); return stored; }), signinSilent: vi.fn(async () => { stored = user(); return stored; }), signoutRedirect: vi.fn(async () => {}), stopSilentRenew: vi.fn(), metadataService: { getEndSessionEndpoint: vi.fn(async () => 'https://identity.example/logout') }, events: { addAccessTokenExpired: vi.fn(() => () => {}), addUserSignedOut: vi.fn(() => () => {}) } };
    load = vi.fn(async () => config); read = vi.fn(async (_config, supplied) => { credentials = supplied; const token = await supplied.getAccessToken(); return token ? context(token.startsWith('bob') ? 'bob' : 'alice') : { status: 'unauthenticated' }; }); navigate = vi.fn(); routerNavigate = vi.fn(async () => true); create = vi.fn((input) => { settings = input; return manager; });
    TestBed.configureTestingModule({ providers: [OidcAuthService, { provide: PORTAL_BROWSER, useValue: browser }, { provide: AUTH_NAVIGATE, useValue: navigate }, { provide: OIDC_MANAGER_FACTORY, useValue: create }, { provide: RuntimeConfigService, useValue: { load } }, { provide: ContextClient, useValue: { read } }, { provide: Router, useValue: { navigate: routerNavigate } }] }); service = TestBed.inject(OidcAuthService);
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); window.sessionStorage.clear(); window.localStorage.clear(); });
  it('coalesces initialization and trusts only matching authoritative context', async () => {
    const first = service.initialize(); expect(service.initialize()).toBe(first); await first; expect(service.state().status).toBe('ready'); expect(read).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledOnce(); expect(await service.getAccessToken()).toBe('alice-access');
    read.mockResolvedValue(context('other')); await service.retry(); expect(service.state().status).toBe('denied'); expect(await service.getAccessToken()).toBeNull();
  });
  it('uses authorization code with PKCE and session storage for users and redirect state', async () => {
    await service.initialize(); expect(settings).toMatchObject({ response_type: 'code', disablePKCE: false, automaticSilentRenew: false, monitorSession: false, loadUserInfo: false, fetchRequestCredentials: 'omit' });
    await settings.userStore!.set('test', 'user-value'); await settings.stateStore!.set('test', 'transaction');
    expect(browser.sessionStorage.getItem('gcsp:oidc:user:test')).toBe('user-value'); expect(browser.sessionStorage.getItem('gcsp:oidc:state:test')).toBe('transaction'); expect(browser.localStorage.length).toBe(0);
  });
  it('fails usefully when settings or required browser storage is unavailable', async () => {
    load.mockRejectedValue(new Error('secret')); await service.initialize(); expect(service.state().status).toBe('unavailable'); expect(JSON.stringify(service.state())).not.toContain('secret'); expect(create).not.toHaveBeenCalled();
    load.mockResolvedValue(config); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); }); await service.retry(); expect(service.state().status).toBe('unavailable'); expect(create).not.toHaveBeenCalled();
  });
  it('starts interactive login with an owned safe return and logout epoch only', async () => {
    browser.localStorage.setItem('gcsp:auth:logout', 'epoch'); await service.signIn('https://evil.example'); expect(manager.signinRedirect).toHaveBeenCalledWith({ prompt: 'login', state: { returnTo: '/gcsp/', recovery: false, logoutEpoch: 'epoch' } }); expect(service.state().status).toBe('loading'); expect(manager.removeUser).toHaveBeenCalledOnce();
  });
  it('completes callback and checks server subject before showing identity', async () => {
    Object.assign(browser.location, { pathname: '/gcsp/auth/callback', href: 'https://portal.example/gcsp/auth/callback?code=opaque&state=opaque' });
    await service.initialize(); expect(read).not.toHaveBeenCalled(); expect(await service.completeSignIn()).toBe('/gcsp/orders'); expect(service.state().status).toBe('ready'); expect(browser.history.replaceState).toHaveBeenCalledWith(null, '', config.oidc.redirectUri); expect(manager.signinRedirectCallback).toHaveBeenCalledOnce();
  });
  it('rejects a callback started before another tab signed out', async () => {
    browser.localStorage.setItem('gcsp:auth:logout', 'later-logout'); expect(await service.completeSignIn()).toBeUndefined(); expect(service.state().status).toBe('signed-out'); expect(stored).toBeNull(); expect(read).not.toHaveBeenCalled();
  });
  it('restarts failed callback safely rather than retrying consumed code', async () => {
    Object.assign(browser.location, { pathname: '/gcsp/auth/callback' }); manager.signinRedirectCallback.mockRejectedValue(new Error('private callback')); await service.completeSignIn(); expect(service.state().status).toBe('unavailable'); await service.retry(); expect(manager.signinRedirectCallback).toHaveBeenCalledOnce(); expect(manager.signinRedirect).toHaveBeenCalledOnce(); expect(browser.history.replaceState).toHaveBeenCalled();
  });
  it('retries context after exchanged code and keeps the authorized return', async () => {
    Object.assign(browser.location, { pathname: '/gcsp/auth/callback' }); read.mockResolvedValueOnce({ status: 'unavailable' }); await service.completeSignIn(); expect(service.state().status).toBe('unavailable'); expect(await service.retry()).toBe('/gcsp/orders'); expect(service.state().status).toBe('ready'); expect(manager.signinRedirectCallback).toHaveBeenCalledOnce();
  });
  it('offers fresh sign-in when a restored callback page lost its session in another tab', async () => {
    Object.assign(browser.location, { pathname: '/gcsp/auth/callback' }); read.mockResolvedValueOnce({ status: 'unavailable' }); await service.completeSignIn(); browser.dispatchEvent(new Event('pagehide')); browser.localStorage.setItem('gcsp:auth:logout', 'missed-event'); browser.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await settle(); expect(service.state().status).toBe('signed-out'); await service.retry(); expect(manager.signinRedirect).toHaveBeenCalledOnce(); expect(manager.signinRedirectCallback).toHaveBeenCalledOnce();
  });
  it('renews only with a refresh token and supplies bearer access without a command', async () => {
    await service.initialize(); Object.assign(stored!, { expired: true }); expect(await service.getAccessToken()).toBe('alice-access'); expect(manager.signinSilent).toHaveBeenCalledOnce(); expect(manager.signinRedirect).not.toHaveBeenCalled(); expect(Object.keys(credentials).sort()).toEqual(['getAccessToken', 'renewAccessToken']);
  });
  it('returns to sign-in after expiry without renewal support and retains safe progress guidance', async () => {
    await service.initialize(); Object.assign(stored!, { expired: true, refresh_token: undefined }); expect(await service.getAccessToken()).toBeNull(); expect(manager.signinSilent).not.toHaveBeenCalled(); expect(service.state().status).toBe('signed-out'); expect(routerNavigate).toHaveBeenCalledWith(['/sign-in'], { queryParams: { returnTo: '/gcsp/account' } }); expect(service.recovery()?.requiresConfirmation).toBe(true);
  });
  it('does not apply previous-account recovery guidance to a different signed-in account', async () => {
    await service.initialize(); Object.assign(stored!, { expired: true, refresh_token: undefined }); await service.getAccessToken(); await service.signIn('/gcsp/orders'); const state = manager.signinRedirect.mock.calls[0][0].state; expect(state.subject).toBe('alice');
    manager.signinRedirectCallback.mockImplementation(async () => { stored = user('bob', { state }); return stored; }); expect(await service.completeSignIn()).toBe('/gcsp/orders'); expect(service.state()).toMatchObject({ status: 'ready', context: { subject: 'bob' } }); expect(service.recovery()).toBeNull();
  });
  it('retains explicit review guidance when the same account signs in again', async () => {
    await service.initialize(); Object.assign(stored!, { expired: true, refresh_token: undefined }); await service.getAccessToken(); await service.signIn('/gcsp/orders'); const state = manager.signinRedirect.mock.calls[0][0].state;
    manager.signinRedirectCallback.mockImplementation(async () => { stored = user('alice', { state }); return stored; }); await service.completeSignIn(); expect(service.recovery()?.requiresConfirmation).toBe(true); expect(service.recovery()?.message).toContain('Review your saved progress');
  });
  it('clears immediately and captures provider logout hint before local removal', async () => {
    await service.initialize(); const logout = service.signOut(); expect(service.state().status).toBe('signed-out'); expect(service.recovery()).toBeNull(); await logout; expect(stored).toBeNull(); expect(manager.signoutRedirect).toHaveBeenCalledWith({ id_token_hint: 'alice-id', post_logout_redirect_uri: config.oidc.postLogoutRedirectUri }); expect(browser.localStorage.getItem('gcsp:auth:logout')).not.toContain('alice');
  });
  it('keeps local logout when provider discovery fails', async () => {
    await service.initialize(); manager.metadataService.getEndSessionEndpoint.mockRejectedValue(new Error('upstream secret')); await service.signOut(); expect(service.state().status).toBe('signed-out'); expect(stored).toBeNull(); expect(service.recovery()?.message).toContain('could not be confirmed'); expect(routerNavigate).toHaveBeenCalledWith(['/sign-in']);
  });
  it('cannot restore ready from a context read that finishes after sign-out', async () => {
    const pending = deferred<ReturnType<typeof context>>(); read.mockReturnValue(pending.promise); const initialize = service.initialize(); await settle(); await service.signOut(); pending.resolve(context()); await initialize; expect(service.state().status).toBe('signed-out'); expect(await service.getAccessToken()).toBeNull();
  });
  it('does not let an old expiry removal route over a newer interactive login', async () => {
    await service.initialize(); Object.assign(stored!, { expired: true, refresh_token: undefined }); const pending = deferred<void>(); manager.removeUser.mockImplementationOnce(async () => { await pending.promise; stored = null; });
    const token = service.getAccessToken(); await settle(); const login = service.signIn('/gcsp/orders'); pending.resolve(); await Promise.all([token, login]); expect(routerNavigate).not.toHaveBeenCalled(); expect(manager.signinRedirect).toHaveBeenCalledOnce(); expect(service.state().status).toBe('loading');
  });
  it('serializes stale renewal cleanup before the next account callback writes', async () => {
    await service.initialize(); Object.assign(stored!, { expired: true }); const pending = deferred<User>(); manager.signinSilent.mockImplementation(async () => { stored = await pending.promise; return stored; }); const token = service.getAccessToken(); await settle(); const login = service.signIn('/gcsp/orders');
    pending.resolve(user('alice')); await Promise.all([token, login]); const state = manager.signinRedirect.mock.calls[0][0].state; manager.signinRedirectCallback.mockImplementation(async () => { stored = user('bob', { state }); return stored; }); await service.completeSignIn(); expect(stored!.profile.sub).toBe('bob'); expect(service.state()).toMatchObject({ status: 'ready', context: { subject: 'bob' } }); expect(routerNavigate).not.toHaveBeenCalled();
  });
  it('prevents stale callback completion after logout from changing URL or context', async () => {
    const pending = deferred<User>(); manager.signinRedirectCallback.mockImplementation(async () => { stored = await pending.promise; return stored; }); const callback = service.completeSignIn(); await settle(); const logout = service.signOut(); pending.resolve(user()); await Promise.all([callback, logout]); expect(service.state().status).toBe('signed-out'); expect(stored).toBeNull(); expect(browser.history.replaceState).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it('clears account state on a nonsecret cross-tab logout event', async () => {
    await service.initialize(); browser.localStorage.setItem('gcsp:auth:logout', 'new-epoch'); browser.dispatchEvent(new StorageEvent('storage', { key: 'gcsp:auth:logout', newValue: 'new-epoch' })); expect(service.state().status).toBe('signed-out'); await settle(); expect(stored).toBeNull(); expect(routerNavigate).toHaveBeenCalledWith(['/sign-in']);
  });
  it('invalidates private state on pagehide and catches logout missed while in BFCache', async () => {
    await service.initialize(); browser.sessionStorage.setItem('gcsp:oidc:state:pending', 'preserved'); browser.dispatchEvent(new Event('pagehide')); expect(service.state().status).toBe('loading'); expect(await service.getAccessToken()).toBeNull(); browser.localStorage.setItem('gcsp:auth:logout', 'missed-event'); browser.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await settle(); expect(service.state().status).toBe('signed-out'); expect(stored).toBeNull(); expect(read).toHaveBeenCalledOnce(); expect(browser.sessionStorage.getItem('gcsp:oidc:state:pending')).toBe('preserved');
  });
  it('revalidates persisted pageshow and ignores the previous pending context generation', async () => {
    const old = deferred<ReturnType<typeof context>>(); read.mockReturnValueOnce(old.promise); const first = service.initialize(); await settle(); browser.dispatchEvent(new Event('pagehide')); browser.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await settle(); expect(read).toHaveBeenCalledTimes(2); expect(service.state().status).toBe('ready'); old.resolve(context('old')); await first; expect(service.state()).toMatchObject({ status: 'ready', context: { subject: 'alice' } });
  });
});
