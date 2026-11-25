import { Location } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ManualStore } from '../manual/manual.store';
import { ManualClient } from '../manual/manual.client';
import type { ManualClaim, ManualClaimCommand, ManualHandoff, ManualResult } from '../manual/manual.types';
import { StockComponent } from './stock.component';
import { StockNavigationSnapshot } from './stock.store';
import type { StockCar } from './stock.types';

const historyKey = 'gcspStock';
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export type GalleryReservationState = 'checking' | 'ready' | 'claiming' | 'pending' | 'uncertain' | 'retry-available'
  | 'readback-mismatch' | 'existing-claim' | 'confirmed' | 'failed' | 'released';
export interface GalleryReservation {
  readonly state: GalleryReservationState; readonly blocked: boolean; readonly selection: ManualHandoff | null;
  readonly claim: ManualClaim | null; readonly failure: string | null; readonly refresh: number;
}
interface GalleryAttempt { readonly selection: ManualHandoff; readonly command: ManualClaimCommand; receipt: ManualResult<ManualClaim> | null }
const initialReservation = (): GalleryReservation => ({ state: 'checking', blocked: true, selection: null, claim: null, failure: null, refresh: 0 });
const definitive = (r: ManualResult<ManualClaim> | null): boolean => !!r && ['conflict', 'invalid', 'forbidden', 'not-found'].includes(r.status);
const nonoccupying = (r: ManualResult<ManualClaim>): r is { status: 'ok'; value: ManualClaim } => r.status === 'ok'
  && ['released', 'expired', 'claim-failed'].includes(r.value.state) && r.value.pendingOperation === null
  && r.value.hold.state === r.value.state && ['orderUuid', 'employeeId', 'entitlementSlotId'].every(key => r.value.hold[key] === r.value.quote[key]);
const galleryFailure = (result: ManualResult<ManualClaim> | null): string | null => !result || result.status === 'ok' ? null
  : ['car-not-eligible-or-available', 'stock-unavailable'].includes(result.code) || result.code === 'stale-version' && result['resource'] === 'stock'
    ? 'car-taken' : result.code;
function sameGallerySelection(claim: ManualClaim, selection: ManualHandoff): boolean {
  const expected = selection.claimInput; const { hold, quote } = claim; const facts = record(quote.facts['facts']);
  return !!expected && hold.type === 'cart' && hold.orderUuid === selection.orderUuid && quote.orderUuid === selection.orderUuid
    && quote.configurationId === selection.configurationId && hold.employeeId === quote.employeeId && hold.entitlementSlotId === quote.entitlementSlotId
    && facts['identityKind'] === 'exact-stock' && record(facts['sourceKeys'])['stockId'] === selection.orderUuid
    && facts['sourceNamespace'] === selection.snapshot.sourceNamespace && facts['snapshotVersion'] === selection.snapshot.snapshotVersion
    && quote.policyVersion === selection.versions.policy && quote.draftVersion === expected.expectedDraftVersion
    && quote.contextVersion === expected.expectedContextVersion && quote.termsDigest === expected.expectedTermsDigest
    && Number.isSafeInteger(quote.stockVersion) && quote.stockVersion > 0;
}
/** Only a current authenticated GET of this exact stock selection can open review. */
export function confirmedGalleryClaim(claim: ManualClaim, selection: ManualHandoff, receipt: ManualResult<ManualClaim> | null = null): boolean {
  const { hold, quote, now } = claim; const posted = receipt?.status === 'ok' ? receipt.value : null;
  return sameGallerySelection(claim, selection) && claim.state === 'quoted' && hold.state === 'active' && claim.pendingOperation === null
    && Number.isFinite(Date.parse(now)) && Date.parse(hold.expiresAt) > Date.parse(now) && Date.parse(quote.validUntil) > Date.parse(now)
    && (!posted || posted.hold.holdId === hold.holdId && posted.quote.quoteId === quote.quoteId);
}

/** One retained principal/run-scoped gallery attempt; checks never repeat a command. */
@Injectable({ providedIn: 'root' })
export class GalleryReservationController {
  private readonly client = inject(ManualClient);
  private readonly scope = computed(() => { const context = this.client.context(); return context ? JSON.stringify(context) : null; });
  private readonly owner = signal<string | null>(null);
  private readonly value = signal<GalleryReservation>(initialReservation());
  readonly state = computed(() => this.owner() === this.scope() && !!this.scope() ? this.value() : initialReservation());
  private attempt: GalleryAttempt | null = null;
  private request = new AbortController(); private epoch = 0; private active = false; private destroyed = false;
  private operation: Promise<void> | null = null;
  constructor() {
    effect(() => { const scope = this.scope(); untracked(() => { if (this.owner() !== scope) this.reset(); }); });
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.reset(); });
  }
  private reset(): void { this.dispose(); this.owner.set(null); this.attempt = null; this.value.set(initialReservation()); }
  dispose(): void { this.active = false; this.epoch++; this.request.abort(); this.operation = null; }
  load(): Promise<void> {
    const scope = this.scope(); if (!scope || this.destroyed) return Promise.resolve();
    if (this.owner() !== scope) { this.reset(); this.owner.set(scope); }
    this.active = true; return this.run(false);
  }
  checkStatus(): Promise<void> { return this.active ? this.run(false) : this.load(); }
  dismissFailure(): void { if (!this.state().blocked) this.publish('ready', false, { failure: null }); }
  reserve(selection: ManualHandoff): Promise<void> {
    if (this.operation) return this.operation;
    if (!this.active || this.state().blocked || !selection.claimInput) return Promise.resolve();
    this.attempt = { selection: structuredClone(selection), command: { ...structuredClone(selection.claimInput), commandId: crypto.randomUUID() }, receipt: null };
    return this.run(true);
  }
  retry(): Promise<void> {
    if (this.operation) return this.operation;
    return this.active && this.attempt && this.state().state === 'retry-available' ? this.run(true) : Promise.resolve();
  }
  private publish(state: GalleryReservationState, blocked: boolean, changes: Partial<GalleryReservation> = {}): void {
    this.value.update(value => ({ ...value, state, blocked, selection: this.attempt?.selection ?? null, ...changes }));
  }
  private run(dispatch: boolean): Promise<void> {
    if (this.operation) return this.operation;
    const scope = this.scope(); if (!this.active || this.owner() !== scope || !scope || this.destroyed) return Promise.resolve();
    this.request = new AbortController(); const epoch = ++this.epoch; const options = { signal: this.request.signal };
    const valid = () => this.active && !this.destroyed && epoch === this.epoch && scope === this.scope();
    this.publish(dispatch ? 'claiming' : 'checking', true, dispatch ? { failure: null } : {});
    const operation = (async () => {
      if (dispatch && this.attempt) {
        try { this.attempt.receipt = await this.client.claim(this.attempt.command, options); }
        catch { if (valid() && this.attempt) this.attempt.receipt = { status: 'uncertain', code: 'manual-command-outcome-unknown', retryable: false }; }
        if (!valid()) return;
      }
      let result: ManualResult<ManualClaim>;
      try { result = await this.client.readClaim(options); }
      catch { result = { status: 'unavailable', code: 'manual-read-unavailable', retryable: false }; }
      if (!valid()) return;
      const attempt = this.attempt; const claim = result.status === 'ok' ? result.value : null;
      // Java's 202 supplies an operation ID; bind only its exact authenticated pending snapshot.
      if (attempt?.receipt?.status === 'pending' && claim && claim.pendingOperation?.operationId === attempt.receipt.operationId
        && sameGallerySelection(claim, attempt.selection)) attempt.receipt = { status: 'ok', value: claim };
      if (attempt && claim && confirmedGalleryClaim(claim, attempt.selection, attempt.receipt)) {
        this.publish('confirmed', true, { claim, failure: null });
      } else if (nonoccupying(result) && (!attempt || definitive(attempt.receipt) || attempt.receipt?.status === 'ok'
        && attempt.receipt.value.hold.holdId === result.value.hold.holdId && attempt.receipt.value.quote.quoteId === result.value.quote.quoteId
        && result.value.hold.orderUuid === attempt.selection.orderUuid && result.value.quote.configurationId === attempt.selection.configurationId)) {
        this.attempt = null; this.publish('released', false, { claim, failure: null, refresh: this.value().refresh + 1 });
      } else if (result.status === 'not-found' && (!attempt || definitive(attempt.receipt))) {
        const failure = attempt?.receipt; this.attempt = null;
        this.publish(failure ? 'failed' : 'ready', false, { claim: null, failure: galleryFailure(failure ?? null) });
      } else if (claim && ['quoted', 'allocated'].includes(claim.state)) {
        this.publish(attempt && claim.state !== 'allocated' ? 'readback-mismatch' : 'existing-claim', true, { claim });
      } else if (attempt && (result.status === 'not-found' || nonoccupying(result))) {
        this.publish('retry-available', true, { claim });
      } else this.publish(result.status === 'pending' || claim?.pendingOperation ? 'pending' : 'uncertain', true, { claim });
    })().finally(() => { if (valid()) this.operation = null; });
    this.operation = operation; return operation;
  }
}

@Component({
  selector: 'gcsp-stock-route',
  imports: [StockComponent],
  template: `<gcsp-stock [navigation]="navigation()" (navigationChange)="saveNavigation($event)"
    [reservation]="reservation.state()" [reviewUnavailableReason]="reservation.state().blocked ? 'Check your reservation before choosing another car.' : null"
    (availabilityRefresh)="reservation.dismissFailure()" (checkReservation)="checkReservation()" (retryReservation)="retryReservation()" (viewOffer)="viewOffer($event)"
    (review)="reviewSelection($event)" (back)="backToChoices()" />`,
})
export class StockRouteComponent {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly manual = inject(ManualStore);
  readonly openingReview = signal(false);
  readonly reservation = inject(GalleryReservationController);
  private readonly routePath = this.location.path().split('?')[0];
  readonly navigation = signal<unknown>(record(this.location.getState())[historyKey] ?? null);
  private lastSnapshot: string | undefined;
  private disposed = false;

  constructor() {
    void this.reservation.load();
    const subscription = this.location.subscribe(event => {
      if (this.onStockPath()) {
        this.lastSnapshot = undefined;
        this.navigation.set(record(event.state)[historyKey] ?? null);
      }
    });
    inject(DestroyRef).onDestroy(() => { this.disposed = true; this.reservation.dispose(); subscription.unsubscribe(); });
  }

  saveNavigation(event: { readonly snapshot: StockNavigationSnapshot | null; readonly replace: boolean }): void {
    if (this.disposed || !this.onStockPath()) return;
    const value = event.snapshot;
    // Copy the navigation allowlist only; review facts and authority never enter history.
    const snapshot: StockNavigationSnapshot | null = value ? { version: value.version, scope: value.scope,
      controls: { query: value.controls.query, series: value.controls.series, body: value.controls.body, sort: value.controls.sort },
      limit: value.limit, selectedId: value.selectedId } : null;
    const signature = JSON.stringify(snapshot);
    if (signature === this.lastSnapshot) return;
    this.lastSnapshot = signature;
    const state = { ...record(this.location.getState()) };
    if (snapshot) state[historyKey] = snapshot;
    else delete state[historyKey];
    const path = this.location.path(true);
    if (event.replace) this.location.replaceState(path, '', state);
    else this.location.go(path, '', state);
  }

  async reviewSelection(selection: StockCar['review']): Promise<void> {
    if (this.disposed || this.openingReview()) return;
    await this.reservation.reserve(selection); await this.openConfirmed();
  }
  async checkReservation(): Promise<void> { await this.reservation.checkStatus(); await this.openConfirmed(); }
  async retryReservation(): Promise<void> { await this.reservation.retry(); await this.openConfirmed(); }
  private async openConfirmed(): Promise<void> {
    const current = this.reservation.state();
    if (this.disposed || this.openingReview() || current.state !== 'confirmed' || !current.selection || !current.claim) return;
    this.openingReview.set(true);
    try {
      await this.manual.enter(current.selection);
      const read = this.manual.projection().claim;
      if (!this.disposed && read && confirmedGalleryClaim(read, current.selection, { status: 'ok', value: current.claim })) {
        this.manual.confirmResume(); await this.router.navigateByUrl('/manual/review');
      }
    } finally { this.openingReview.set(false); }
  }
  viewOffer(offerId: string): void { if (!this.disposed) void this.router.navigateByUrl(`/offers/${encodeURIComponent(offerId)}`); }
  backToChoices(): void { if (!this.reservation.state().blocked) void this.router.navigateByUrl('/account'); }
  private onStockPath(): boolean { return this.location.path().split('?')[0] === this.routePath; }
}
