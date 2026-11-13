import { Injectable, Signal, signal } from '@angular/core';
export type Role = 'employee' | 'greg' | 'presenter';
export interface ApplicationContext {
  readonly subject: string; readonly roles: readonly Role[]; readonly environmentId: string;
  readonly runId: string; readonly employeeId?: string; readonly policyVersion: string;
  readonly capabilities: readonly string[]; readonly displayName?: string; readonly email?: string;
}
export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'ready'; readonly context: ApplicationContext }
  | { readonly status: 'unavailable'; readonly message: string; readonly retryable: boolean }
  | { readonly status: 'denied'; readonly message: string };
export interface RecoveryNotice { readonly message: string; readonly requiresConfirmation: true }
@Injectable({ providedIn: 'root', useFactory: () => new UnavailableAuth() })
export abstract class AuthPort {
  abstract readonly state: Signal<SessionState>;
  abstract readonly recovery: Signal<RecoveryNotice | null>;
  // Implementations coalesce initialization; retry explicitly refreshes the authoritative context.
  abstract initialize(): Promise<void>;
  abstract retry(): Promise<string | void>;
  abstract getAccessToken(): Promise<string | null>;
  abstract signIn(returnTo: string): Promise<void>;
  abstract completeSignIn(): Promise<string | void>;
  abstract signOut(): Promise<void>;
}
class UnavailableAuth implements AuthPort {
  readonly state = signal<SessionState>({ status: 'unavailable', message: 'Sign-in is not available. Please try again later.', retryable: true });
  readonly recovery = signal<RecoveryNotice | null>(null);
  async initialize(): Promise<void> {}
  async retry(): Promise<void> {}
  async getAccessToken(): Promise<null> { return null; }
  async signIn(_returnTo: string): Promise<void> {}
  async completeSignIn(): Promise<void> {}
  async signOut(): Promise<void> {}
}
