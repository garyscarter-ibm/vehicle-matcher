import { inject, Injectable } from '@angular/core';
import { ApplicationContext, Role } from './auth.port';
import { PORTAL_FETCH, RuntimePublicConfig } from './runtime-config';
export interface ContextCredentials { getAccessToken(): Promise<string | null>; renewAccessToken(): Promise<string | null> }
export interface ApiContextFailure {
  readonly status: string; readonly code?: string; readonly reason?: string; readonly retryable: boolean;
  readonly reasons?: unknown; readonly operationId?: string;
}
export type ContextResult = { readonly status: 'ok'; readonly value: ApplicationContext }
  | { readonly status: 'unauthenticated' | 'denied' | 'unavailable'; readonly error: ApiContextFailure };
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 256 && value.every(text); }
const roles: readonly Role[] = ['employee', 'greg', 'presenter'];
export function parseContext(value: unknown, environmentId: string): ApplicationContext | null {
  if (!object(value) || !text(value['subject']) || !text(value['environmentId']) || value['environmentId'] !== environmentId || !text(value['runId']) || !text(value['policyVersion']) || !strings(value['roles']) || !value['roles'].every((role) => roles.includes(role as Role)) || !strings(value['capabilities'])) return null;
  const employeeId = value['employeeId'];
  if (value['roles'].includes('employee') ? !text(employeeId) : employeeId !== undefined) return null;
  if ((value['displayName'] !== undefined && !text(value['displayName'])) || (value['email'] !== undefined && !text(value['email']))) return null;
  return Object.freeze({ subject: value['subject'], roles: Object.freeze([...value['roles']] as Role[]), environmentId, runId: value['runId'], policyVersion: value['policyVersion'], capabilities: Object.freeze([...value['capabilities']]), ...(employeeId === undefined ? {} : { employeeId: employeeId as string }), ...(value['displayName'] === undefined ? {} : { displayName: value['displayName'] as string }), ...(value['email'] === undefined ? {} : { email: value['email'] as string }) });
}
function failure(value: unknown): ApiContextFailure | null {
  if (!object(value) || !text(value['status']) || value['status'] === 'ok' || typeof value['retryable'] !== 'boolean' || (!text(value['code']) && !text(value['reason']))) return null;
  if ((value['code'] !== undefined && !text(value['code'])) || (value['reason'] !== undefined && !text(value['reason'])) || (value['operationId'] !== undefined && !text(value['operationId']))) return null;
  return { status: value['status'], retryable: value['retryable'], ...(value['code'] === undefined ? {} : { code: value['code'] as string }), ...(value['reason'] === undefined ? {} : { reason: value['reason'] as string }), ...(value['reasons'] === undefined ? {} : { reasons: value['reasons'] }), ...(value['operationId'] === undefined ? {} : { operationId: value['operationId'] as string }) };
}
const unavailable = (code: string): ContextResult => ({ status: 'unavailable', error: { status: 'unavailable', code, retryable: true } });
const signedOut = (): ContextResult => ({ status: 'unauthenticated', error: { status: 'unauthenticated', code: 'authentication-required', retryable: false } });
@Injectable({ providedIn: 'root' })
export class ContextClient {
  private readonly fetcher = inject(PORTAL_FETCH);
  async read(config: RuntimePublicConfig, credentials: ContextCredentials): Promise<ContextResult> {
    let token: string | null;
    try { token = await credentials.getAccessToken(); } catch { return signedOut(); }
    if (!token || /\s/.test(token)) return signedOut();
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: { status: number; body: unknown };
      try { response = await this.request(config, token); } catch { return unavailable('context-unavailable'); }
      if (response.status === 401 && attempt === 0) {
        try { token = await credentials.renewAccessToken(); } catch { return signedOut(); }
        if (!token || /\s/.test(token)) return signedOut();
        continue;
      }
      const body = response.body;
      if (response.status === 200 && object(body) && body['status'] === 'ok') {
        const context = parseContext(body['value'], config.environmentId);
        return context ? { status: 'ok', value: context } : unavailable('invalid-context-response');
      }
      const error = failure(body);
      if (response.status === 401) return { status: 'unauthenticated', error: error ?? signedOutError() };
      if (!error) return unavailable('invalid-context-response');
      return { status: response.status === 403 ? 'denied' : 'unavailable', error };
    }
    return signedOut();
  }
  private async request(config: RuntimePublicConfig, token: string): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetcher(`${config.apiBaseUrl}/context`, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
      let body: unknown; try { body = await response.json(); } catch { body = undefined; }
      return { status: response.status, body };
    }
    finally { clearTimeout(timer); }
  }
}
function signedOutError(): ApiContextFailure { return { status: 'unauthenticated', code: 'authentication-required', retryable: false }; }
