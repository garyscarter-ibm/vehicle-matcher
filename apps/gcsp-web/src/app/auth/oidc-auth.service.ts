import { inject, Injectable, InjectionToken, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { User, UserManager, UserManagerSettings, WebStorageStateStore } from 'oidc-client-ts';
import { AuthPort, RecoveryNotice, SessionState } from './auth.port';
import { ContextClient, ContextResult } from './context.client';
import { RuntimeConfigService, RuntimePublicConfig } from './runtime-config';
import { safeReturnTo } from './route-policy';
export const PORTAL_BROWSER = new InjectionToken<Window>('Portal browser', { providedIn: 'root', factory: () => window });
export const OIDC_MANAGER_FACTORY = new InjectionToken<(settings: UserManagerSettings) => UserManager>('OIDC manager factory', { providedIn: 'root', factory: () => (settings) => new UserManager(settings) });
export const AUTH_NAVIGATE = new InjectionToken<(url: string) => void>('Auth document navigation', { providedIn: 'root', factory: () => (url) => window.location.assign(url) });
const LOGOUT_MARKER = 'gcsp:auth:logout';
const OBSERVED_LOGOUT = 'gcsp:auth:observed-logout';
const recoveryMessage = 'You are signed in again. Review your saved progress before continuing.';
interface ReturnState { readonly returnTo: string; readonly recovery: boolean; readonly logoutEpoch: string; readonly subject?: string }
function returnState(value: unknown): ReturnState {
  const data = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return { returnTo: safeReturnTo(typeof data['returnTo'] === 'string' ? data['returnTo'] : null), recovery: data['recovery'] === true, logoutEpoch: typeof data['logoutEpoch'] === 'string' ? data['logoutEpoch'] : 'invalid', ...(typeof data['subject'] === 'string' ? { subject: data['subject'] } : {}) };
}
@Injectable({ providedIn: 'root' })
export class OidcAuthService extends AuthPort implements OnDestroy {
  private readonly browser = inject(PORTAL_BROWSER); private readonly router = inject(Router);
  private readonly configService = inject(RuntimeConfigService); private readonly contextClient = inject(ContextClient);
  private readonly createManager = inject(OIDC_MANAGER_FACTORY); private readonly navigate = inject(AUTH_NAVIGATE);
  private readonly session = signal<SessionState>({ status: 'loading' }); private readonly notice = signal<RecoveryNotice | null>(null);
  readonly state = this.session.asReadonly(); readonly recovery = this.notice.asReadonly();
  private config?: RuntimePublicConfig; private manager?: UserManager; private managerLoading?: Promise<UserManager>; private user: User | null = null;
  private initialized = false; private initialization?: Promise<void>; private renewal?: Promise<User | null>;
  // Serialize SDK writes: a stale renewal/callback cannot overwrite or remove a newer user's stored session.
  private sdkTail: Promise<unknown> = Promise.resolve();
  private generation = 0; private signedOut = false; private expiredSubject?: string; private callbackReturn = '/gcsp/'; private callbackExchanged = false;
  private eventCleanup: (() => void)[] = [];
  constructor() {
    super(); this.browser.addEventListener('storage', this.handleStorage); this.browser.addEventListener('pagehide', this.handlePageHide); this.browser.addEventListener('pageshow', this.handlePageShow);
  }
  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    if (this.initialized) return Promise.resolve();
    const generation = this.generation;
    const attempt = this.initializeSession(generation).finally(() => { if (this.initialization === attempt) this.initialization = undefined; });
    this.initialization = attempt; return attempt;
  }
  async retry(): Promise<string | void> {
    if (this.browser.location.pathname === '/gcsp/auth/callback' && (!this.callbackExchanged || !this.user || this.signedOut)) { await this.signIn(this.callbackReturn); return; }
    this.initialized = false; await this.initialize();
    if (this.callbackExchanged && this.state().status === 'ready') return this.callbackReturn;
  }
  async getAccessToken(): Promise<string | null> {
    if (this.state().status !== 'ready') return null;
    const generation = this.generation; const user = await this.validUser(generation);
    if (!user && generation === this.generation) await this.requireSignIn(generation);
    return generation === this.generation ? user?.access_token ?? null : null;
  }
  async signIn(returnTo: string): Promise<void> {
    const generation = this.invalidate(); this.session.set({ status: 'loading' }); this.initialized = false; this.signedOut = false;
    this.user = null;
    try {
      const state: ReturnState = { returnTo: safeReturnTo(returnTo), recovery: this.notice() !== null, logoutEpoch: this.logoutEpoch(), ...(this.expiredSubject ? { subject: this.expiredSubject } : {}) };
      const manager = await this.ensureManager();
      await this.sdk(generation, async () => { await manager.removeUser(); await manager.clearStaleState(); if (generation === this.generation) await manager.signinRedirect({ prompt: 'login', state }); });
    } catch { if (generation === this.generation) this.unavailable('Sign-in could not be started. Please try again.'); }
  }
  async completeSignIn(): Promise<string | void> {
    const generation = this.generation; this.session.set({ status: 'loading' });
    try {
      const manager = await this.ensureManager();
      const user = await this.sdk(generation, async () => {
        const result = await manager.signinRedirectCallback(this.browser.location.href);
        if (returnState(result.state).logoutEpoch !== this.logoutEpoch()) { await manager.removeUser(); return null; }
        return result;
      });
      if (generation !== this.generation) return;
      this.browser.history.replaceState(null, '', this.config!.oidc.redirectUri);
      if (!user) { this.clearVisibleSession(); this.signedOut = true; return; }
      this.callbackExchanged = true; const state = returnState(user.state); this.callbackReturn = state.returnTo;
      this.browser.sessionStorage.setItem(OBSERVED_LOGOUT, this.logoutEpoch()); this.user = user; this.signedOut = false;
      const result = await this.readContext(generation); if (generation !== this.generation) return;
      this.applyContext(result, user);
      if (this.state().status !== 'ready') return;
      this.initialized = true;
      this.notice.set(state.recovery && state.subject === user.profile.sub ? { message: recoveryMessage, requiresConfirmation: true } : null);
      this.expiredSubject = undefined; return state.returnTo;
    } catch { if (generation === this.generation) { this.browser.history.replaceState(null, '', this.config?.oidc.redirectUri ?? '/gcsp/auth/callback'); this.unavailable('Sign-in could not be completed. Please try again.'); } }
  }
  async signOut(): Promise<void> {
    const generation = this.invalidate(); const capturedUser = this.user;
    this.clearVisibleSession(); this.signedOut = true; this.initialized = true; this.broadcastLogout();
    try {
      const manager = this.manager; manager?.stopSilentRenew();
      const user = manager ? await this.sdk(generation, async () => { const previous = capturedUser ?? await manager.getUser(); await manager.removeUser(); return previous; }) : null;
      if (generation !== this.generation) return;
      const endpoint = await manager?.metadataService.getEndSessionEndpoint(); if (generation !== this.generation) return;
      if (endpoint && this.config) await this.sdk(generation, () => manager!.signoutRedirect({ id_token_hint: user?.id_token, post_logout_redirect_uri: this.config!.oidc.postLogoutRedirectUri }));
      else this.navigate(this.config?.oidc.postLogoutRedirectUri ?? '/gcsp/');
    } catch {
      if (generation !== this.generation) return;
      this.notice.set({ message: 'You are signed out of the portal. Provider sign-out could not be confirmed.', requiresConfirmation: true }); await this.router.navigate(['/sign-in']);
    }
  }
  private async initializeSession(generation: number): Promise<void> {
    this.session.set({ status: 'loading' });
    try {
      const manager = await this.ensureManager(); if (generation !== this.generation) return;
      if (this.browser.location.pathname === '/gcsp/auth/callback' && !this.callbackExchanged) return;
      const user = await this.sdk(generation, async () => {
        const stored = await manager.getUser(); const observed = this.browser.sessionStorage.getItem(OBSERVED_LOGOUT);
        if (stored && observed !== this.logoutEpoch()) { await manager.removeUser(); return null; }
        return stored;
      });
      if (generation !== this.generation) return; this.user = user ?? null;
      if (!this.user || this.signedOut) { this.session.set({ status: 'signed-out' }); this.initialized = true; return; }
      const result = await this.readContext(generation); if (generation !== this.generation) return;
      this.applyContext(result, this.user); this.initialized = true;
      if (result.status === 'unauthenticated') await this.requireSignIn(generation);
    } catch { if (generation === this.generation) this.unavailable('Sign-in is not available. Check that browser session storage is allowed, then try again.'); }
  }
  private ensureManager(): Promise<UserManager> {
    if (this.manager) return Promise.resolve(this.manager); if (this.managerLoading) return this.managerLoading;
    const attempt = this.configService.load().then((config) => {
      const storage = this.browser.sessionStorage; const probe = 'gcsp:auth:storage-check'; storage.setItem(probe, '1'); storage.removeItem(probe); this.config = config;
      const manager = this.createManager({ authority: config.oidc.authority, client_id: config.oidc.clientId, scope: config.oidc.scope, redirect_uri: config.oidc.redirectUri, post_logout_redirect_uri: config.oidc.postLogoutRedirectUri, response_type: 'code', disablePKCE: false, userStore: new WebStorageStateStore({ store: storage, prefix: 'gcsp:oidc:user:' }), stateStore: new WebStorageStateStore({ store: storage, prefix: 'gcsp:oidc:state:' }), automaticSilentRenew: false, monitorSession: false, loadUserInfo: false, requestTimeoutInSeconds: 10, silentRequestTimeoutInSeconds: 10, fetchRequestCredentials: 'omit' });
      this.manager = manager;
      this.eventCleanup.push(manager.events.addAccessTokenExpired(() => { void this.refreshExpiredSession(); })); this.eventCleanup.push(manager.events.addUserSignedOut(() => { this.broadcastLogout(); void this.receiveLogout(); })); return manager;
    }).finally(() => { if (this.managerLoading === attempt) this.managerLoading = undefined; });
    this.managerLoading = attempt; return attempt;
  }
  private sdk<T>(generation: number, action: () => Promise<T>): Promise<T | undefined> {
    const attempt = this.sdkTail.then(async () => {
      if (generation !== this.generation) return undefined;
      try { const result = await action(); if (generation !== this.generation) { await this.manager?.removeUser(); return undefined; } return result; }
      catch (error) { if (generation !== this.generation) await this.manager?.removeUser(); throw error; }
    });
    this.sdkTail = attempt.catch(() => {}); return attempt;
  }
  private async readContext(generation: number): Promise<ContextResult> { return this.contextClient.read(this.config!, { getAccessToken: async () => (await this.validUser(generation))?.access_token ?? null, renewAccessToken: async () => (await this.renewUser(generation))?.access_token ?? null }); }
  private async validUser(generation: number): Promise<User | null> {
    if (generation !== this.generation || this.signedOut) return null;
    const user = this.user; if (!user?.access_token || !user.profile.sub) return null; return user.expired ? this.renewUser(generation) : user;
  }
  private renewUser(generation: number): Promise<User | null> {
    if (generation !== this.generation || this.signedOut || !this.user?.refresh_token) return Promise.resolve(null); if (this.renewal) return this.renewal;
    const subject = this.user.profile.sub;
    const attempt = this.sdk(generation, () => this.manager!.signinSilent()).then((user) => {
      if (generation !== this.generation || this.signedOut || !user || user.expired || user.profile.sub !== subject) return null;
      this.user = user; return user;
    }).catch(() => null).finally(() => { if (this.renewal === attempt) this.renewal = undefined; }); this.renewal = attempt; return attempt;
  }
  private applyContext(result: ContextResult, user: User | null): void {
    if (result.status === 'ok') {
      if (!user || result.value.subject !== user.profile.sub) { this.user = null; this.session.set({ status: 'denied', message: 'Your account could not be verified.' }); return; }
      this.session.set({ status: 'ready', context: result.value });
    } else if (result.status === 'denied') this.session.set({ status: 'denied', message: 'Your account does not have access to this page.' });
    else if (result.status === 'unauthenticated') this.session.set({ status: 'signed-out' }); else this.unavailable('We could not load your account. Please try again.');
  }
  private async refreshExpiredSession(): Promise<void> {
    if (this.signedOut || this.state().status !== 'ready') return;
    const generation = this.generation; this.expiredSubject = this.user?.profile.sub;
    this.notice.set({ message: 'Your session expired. Sign in to continue with your saved progress.', requiresConfirmation: true });
    this.initialized = false; await this.initialize();
    if (generation === this.generation && this.state().status === 'ready') this.notice.set({ message: recoveryMessage, requiresConfirmation: true });
  }
  private async requireSignIn(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    this.expiredSubject ??= this.user?.profile.sub; const target = this.currentReturn(); this.user = null; this.session.set({ status: 'signed-out' });
    this.notice.set({ message: 'Your session expired. Sign in to continue with your saved progress.', requiresConfirmation: true });
    try { await this.sdk(generation, async () => { await this.manager?.removeUser(); }); } catch { /* Visible account data has already been removed. */ }
    if (generation === this.generation) await this.router.navigate(['/sign-in'], { queryParams: { returnTo: target } });
  }
  private currentReturn(): string { return safeReturnTo(this.browser.location.pathname + this.browser.location.search + this.browser.location.hash); }
  private unavailable(message: string): void { this.session.set({ status: 'unavailable', message, retryable: true }); }
  private clearVisibleSession(): void { this.user = null; this.session.set({ status: 'signed-out' }); this.notice.set(null); this.expiredSubject = undefined; this.callbackReturn = '/gcsp/'; this.callbackExchanged = false; }
  private logoutEpoch(): string { return this.browser.localStorage.getItem(LOGOUT_MARKER) ?? ''; }
  private broadcastLogout(): void { try { this.browser.localStorage.setItem(LOGOUT_MARKER, `${Date.now()}:${Math.random()}`); } catch { /* Local credentials still clear if cross-tab storage is blocked. */ } }
  private invalidate(): number { this.initialization = undefined; this.renewal = undefined; return ++this.generation; }
  private async receiveLogout(): Promise<void> {
    const generation = this.invalidate(); this.clearVisibleSession(); this.signedOut = true; this.initialized = true; this.manager?.stopSilentRenew();
    try { await this.sdk(generation, async () => { await this.manager?.removeUser(); }); } catch { /* Never restore a signed-out account after storage failure. */ }
    if (generation === this.generation) await this.router.navigate(['/sign-in']);
  }
  private readonly handleStorage = (event: StorageEvent): void => { if (event.key === LOGOUT_MARKER && event.newValue) void this.receiveLogout(); };
  private readonly handlePageHide = (): void => { this.invalidate(); this.user = null; this.initialized = false; this.session.set({ status: 'loading' }); this.manager?.stopSilentRenew(); };
  private readonly handlePageShow = (event: PageTransitionEvent): void => { if (event.persisted) { this.initialized = false; void this.initialize(); } };
  ngOnDestroy(): void { this.invalidate(); this.browser.removeEventListener('storage', this.handleStorage); this.browser.removeEventListener('pagehide', this.handlePageHide); this.browser.removeEventListener('pageshow', this.handlePageShow); this.eventCleanup.forEach((cleanup) => cleanup()); this.manager?.stopSilentRenew(); }
}
