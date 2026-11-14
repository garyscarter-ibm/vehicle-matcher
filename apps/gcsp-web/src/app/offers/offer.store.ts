import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ApplicationContext, AuthPort } from '../auth/auth.port';
import { OfferClient } from './offer.client';
import { OfferFailure, OfferProjection, OfferResult } from './offer.types';

export type OfferStoreState =
  | { readonly status: 'idle'; readonly offerId: null }
  | { readonly status: 'loading'; readonly offerId: string }
  | { readonly status: 'ready'; readonly offerId: string; readonly offer: OfferProjection }
  | { readonly status: 'failed'; readonly offerId: string; readonly failure: OfferFailure };

type SelectedState = Exclude<OfferStoreState, { readonly status: 'idle' }>;
interface Authority { readonly scope: string | null }
interface ResourceSnapshot { readonly authority: Authority; readonly state: SelectedState }
interface ActiveRead { readonly offerId: string; readonly scope: string; readonly authority: Authority; readonly controller: AbortController; readonly epoch: number }

const AUTH_REQUIRED: OfferFailure = { status: 'unauthenticated', code: 'authentication-required', retryable: false };
const EMPLOYEE_REQUIRED: OfferFailure = { status: 'denied', code: 'employee-role-required', retryable: false };
const CONTEXT_DENIED: OfferFailure = { status: 'denied', code: 'offer-context-denied', retryable: false };
const OFFER_UNAVAILABLE: OfferFailure = { status: 'unavailable', code: 'offer-unavailable', retryable: true };

function authorityKey(context: ApplicationContext): string | null {
  if (!context.roles.includes('employee') || ![context.subject, context.environmentId, context.runId, context.employeeId]
    .every((value) => typeof value === 'string' && value.trim().length > 0)) return null;
  return JSON.stringify([context.subject, context.environmentId, context.runId, context.employeeId]);
}

function contextUnavailable(reason?: string): OfferFailure {
  return { status: 'unavailable', code: 'offer-context-unavailable', retryable: true,
    ...(reason?.trim() ? { reason } : {}) };
}

@Injectable({ providedIn: 'root' })
export class OfferStore {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(OfferClient);
  // Retain observed authority boundaries while coalescing equivalent ready contexts.
  // A current-value Signal cannot reveal transitions no consumer observed.
  private readonly authority = computed<Authority>(() => ({ scope: authorityKeyForState(this.auth.state()) }), {
    equal: (previous, current) => previous.scope === current.scope,
  });
  private readonly selectedOfferId = signal<string | null>(null);
  private readonly snapshot = signal<ResourceSnapshot | null>(null);
  private activeRead: ActiveRead | null = null;
  private epoch = 0;
  private destroyed = false;

  readonly state = computed<OfferStoreState>(() => {
    const offerId = this.selectedOfferId();
    if (offerId === null) return { status: 'idle', offerId: null };

    const authority = this.authority();
    const authState = this.auth.state();
    if (authState.status === 'loading') return { status: 'loading', offerId };
    if (authState.status === 'signed-out') return { status: 'failed', offerId, failure: AUTH_REQUIRED };
    if (authState.status === 'unavailable') return { status: 'failed', offerId, failure: contextUnavailable(authState.message) };
    if (authState.status === 'denied') return { status: 'failed', offerId, failure: { ...CONTEXT_DENIED,
      ...(authState.message.trim() ? { reason: authState.message } : {}) } };

    const scope = authority.scope;
    if (!scope) return { status: 'failed', offerId, failure: EMPLOYEE_REQUIRED };
    const snapshot = this.snapshot();
    return snapshot?.authority === authority && snapshot.state.offerId === offerId
      ? snapshot.state : { status: 'loading', offerId };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.invalidate();
    });
    effect(() => {
      this.auth.state();
      this.selectedOfferId();
      untracked(() => this.reconcile());
    });
  }

  open(offerId: string): void {
    if (this.destroyed) return;
    if (this.selectedOfferId() !== offerId) {
      this.selectedOfferId.set(offerId);
      this.invalidate();
    }
    this.reconcile();
  }

  refresh(): void {
    if (!this.destroyed && this.selectedOfferId() !== null) this.reconcile(true);
  }

  clear(): void {
    this.selectedOfferId.set(null);
    this.invalidate();
  }

  private reconcile(force = false): void {
    if (this.destroyed) return;
    const offerId = this.selectedOfferId();
    if (offerId === null) { this.invalidate(); return; }

    const authority = this.authority();
    const authState = this.auth.state();
    if (authState.status !== 'ready') { this.invalidate(); return; }
    const scope = authority.scope;
    if (!scope) { this.invalidate(); return; }

    if (this.activeRead?.offerId === offerId && this.activeRead.authority === authority) return;
    const snapshot = this.snapshot();
    if (!force && snapshot?.authority === authority && snapshot.state.offerId === offerId) return;
    this.startRead(offerId, scope, authority);
  }

  private startRead(offerId: string, scope: string, authority: Authority): void {
    this.invalidate();
    const request: ActiveRead = { offerId, scope, authority, controller: new AbortController(), epoch: ++this.epoch };
    this.activeRead = request;
    try {
      void this.client.readOffer(offerId, { signal: request.controller.signal, expectedContextKey: scope })
        .then((result) => this.complete(request, result), () => this.complete(request, OFFER_UNAVAILABLE));
    } catch {
      this.complete(request, OFFER_UNAVAILABLE);
    }
  }

  private complete(request: ActiveRead, result: OfferResult<OfferProjection> | OfferFailure): void {
    if (this.destroyed || this.activeRead !== request || request.epoch !== this.epoch || request.controller.signal.aborted
      || this.selectedOfferId() !== request.offerId || this.authority() !== request.authority) return;
    this.activeRead = null;
    const state: SelectedState = result.status === 'ok'
      ? { status: 'ready', offerId: request.offerId, offer: result.value }
      : { status: 'failed', offerId: request.offerId, failure: result };
    this.snapshot.set({ authority: request.authority, state });
  }

  private invalidate(): void {
    this.epoch++;
    this.activeRead?.controller.abort();
    this.activeRead = null;
    this.snapshot.set(null);
  }
}

function authorityKeyForState(state: ReturnType<AuthPort['state']>): string | null {
  return state.status === 'ready' ? authorityKey(state.context) : null;
}
