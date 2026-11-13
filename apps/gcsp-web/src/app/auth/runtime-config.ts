import { DOCUMENT } from '@angular/common';
import { inject, Injectable, InjectionToken } from '@angular/core';
export interface RuntimePublicConfig {
  readonly schemaVersion: 1;
  readonly environmentId: string;
  readonly apiBaseUrl: string;
  readonly oidc: {
    readonly authority: string; readonly clientId: string; readonly scope: string;
    readonly redirectUri: string; readonly postLogoutRedirectUri: string;
  };
}
export const RUNTIME_CONFIG_PATH = '/gcsp/runtime-config.json';
export type BootstrapConfig = { readonly value: RuntimePublicConfig } | { readonly error: RuntimeConfigError };
export const INITIAL_RUNTIME_CONFIG = new InjectionToken<BootstrapConfig | null>('Initial runtime config', { providedIn: 'root', factory: () => null });
export const PORTAL_FETCH = new InjectionToken<typeof fetch>('Portal fetch', { providedIn: 'root', factory: () => globalThis.fetch.bind(globalThis) });
export class RuntimeConfigError extends Error {
  constructor(readonly code: 'config-unavailable' | 'invalid-config') { super('Sign-in settings are not available. Please try again later.'); }
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 2048 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function publicUrl(value: unknown): URL {
  if (!text(value)) throw new RuntimeConfigError('invalid-config');
  let url: URL;
  try { url = new URL(value); } catch { throw new RuntimeConfigError('invalid-config'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) throw new RuntimeConfigError('invalid-config');
  return url;
}
export function validateRuntimeConfig(value: unknown, appOrigin: string): RuntimePublicConfig {
  if (!object(value) || !keys(value, ['schemaVersion', 'environmentId', 'apiBaseUrl', 'oidc']) || value['schemaVersion'] !== 1 || !text(value['environmentId']) || !object(value['oidc'])) throw new RuntimeConfigError('invalid-config');
  const oidc = value['oidc'];
  if (!keys(oidc, ['authority', 'clientId', 'scope', 'redirectUri', 'postLogoutRedirectUri']) || !text(oidc['clientId']) || !text(oidc['scope']) || !oidc['scope'].split(/\s+/).includes('openid')) throw new RuntimeConfigError('invalid-config');
  const origin = publicUrl(appOrigin).origin; const api = publicUrl(value['apiBaseUrl']); const authority = publicUrl(oidc['authority']);
  const callback = publicUrl(oidc['redirectUri']); const logout = publicUrl(oidc['postLogoutRedirectUri']);
  if (!api.pathname.replace(/\/$/, '').endsWith('/api/gcsp/v1')) throw new RuntimeConfigError('invalid-config');
  if (callback.origin !== origin || callback.pathname !== '/gcsp/auth/callback' || logout.origin !== origin || logout.pathname !== '/gcsp/') throw new RuntimeConfigError('invalid-config');
  return Object.freeze({ schemaVersion: 1, environmentId: value['environmentId'], apiBaseUrl: api.href.replace(/\/$/, ''), oidc: Object.freeze({ authority: authority.href.replace(/\/$/, ''), clientId: oidc['clientId'], scope: oidc['scope'], redirectUri: callback.href, postLogoutRedirectUri: logout.href }) });
}
export async function loadRuntimeConfig(fetcher: typeof fetch, appOrigin: string): Promise<RuntimePublicConfig> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(new URL(RUNTIME_CONFIG_PATH, appOrigin).href, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new RuntimeConfigError('config-unavailable');
    return validateRuntimeConfig(await response.json(), appOrigin);
  } catch (error) { if (error instanceof RuntimeConfigError) throw error; throw new RuntimeConfigError('config-unavailable'); }
  finally { clearTimeout(timer); }
}
@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  private readonly fetcher = inject(PORTAL_FETCH); private readonly document = inject(DOCUMENT);
  private initial = inject(INITIAL_RUNTIME_CONFIG);
  private pending?: Promise<RuntimePublicConfig>;
  load(): Promise<RuntimePublicConfig> {
    if (this.pending) return this.pending;
    const initial = this.initial; this.initial = null;
    const attempt = initial ? ('value' in initial ? Promise.resolve(initial.value) : Promise.reject(initial.error)) : loadRuntimeConfig(this.fetcher, this.document.location.origin);
    return this.pending = attempt.catch((error: unknown) => { this.pending = undefined; throw error; });
  }
}
