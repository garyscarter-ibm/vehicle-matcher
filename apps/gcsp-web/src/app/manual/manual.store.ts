import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { ManualClient } from './manual.client';
import { projectManual } from './manual.projection';
import type { ManualClaim, ManualFailure, ManualHandoff, ManualOrder, ManualReleaseCommand, ManualResult, ManualReviewCommand,
  ManualSubmitCommand, ManualTerms } from './manual.types';

type Lane = 'claim' | 'review' | 'release' | 'submit';
interface UnknownAttempt { readonly lane: Lane; readonly holdId?: string; readonly orderUuid?: string; readonly pending?: boolean }
const uncertain = (status: string): boolean => status === 'uncertain' || status === 'pending';
const failed = <T>(result: ManualResult<T>): ManualFailure | null => result.status === 'ok' ? null : result;

/** In-memory principal/run scoped command lane. Nothing in browser history/storage grants write authority. */
@Injectable({ providedIn: 'root' })
export class ManualStore {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(ManualClient);
  readonly scope = computed(() => { const context = this.client.context(); return context ? JSON.stringify(context) : null; });
  private readonly owner = signal<string | null>(null);
  private readonly active = signal(false);
  private readonly busy = signal(false);
  private readonly claimValue = signal<ManualResult<ManualClaim> | null>(null);
  private readonly orderValue = signal<ManualResult<ManualOrder> | null>(null);
  private readonly termsValue = signal<ManualResult<ManualTerms> | null>(null);
  private readonly failureValue = signal<ManualFailure | null>(null);
  private readonly handoffValue = signal<ManualHandoff | null>(null);
  private readonly ticks = signal<Readonly<Record<string, boolean>>>({});
  private readonly resume = signal(false);
  private readonly unknownAttempt = signal<UnknownAttempt | null>(null);
  private readonly owned = computed(() => this.active() && !!this.scope() && this.owner() === this.scope());
  readonly projection = computed(() => projectManual(this.owned() ? {
    claim: this.claimValue(), order: this.orderValue(), terms: this.termsValue(), failure: this.failureValue(),
    loading: this.busy(), hasHandoff: !!this.handoffValue()?.claimInput, resumeRequired: this.resume(),
    uncertain: !!this.unknownAttempt() && !this.unknownAttempt()?.pending, pending: this.unknownAttempt()?.pending, declarations: this.ticks(),
  } : {}));
  readonly state = computed(() => {
    if (!this.scope()) { const auth = this.auth.state(); return auth.status === 'loading' ? 'loading'
      : auth.status === 'denied' || auth.status === 'ready' ? 'denied' : auth.status === 'unavailable' ? 'unavailable' : 'authentication-required'; }
    return this.projection().state;
  });
  readonly loading = computed(() => this.owned() && this.busy());
  readonly declarations = computed(() => this.owned() ? this.ticks() : {});
  readonly handoff = computed(() => this.owned() ? this.handoffValue() : null);
  readonly resumeRequired = computed(() => this.owned() && this.resume());
  readonly canClaim = computed(() => this.owned() && !this.busy() && !this.unknownAttempt()
    && this.orderValue()?.status === 'not-found' && this.claimValue()?.status === 'not-found' && !!this.handoffValue()?.claimInput);
  private controller = new AbortController();
  private epoch = 0;
  private operation: Promise<void> | null = null;
  private readonly commands = new Map<string, string>();
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.clear(); });
    effect(() => {
      const scope = this.scope(); const recovery = this.auth.recovery();
      untracked(() => {
        if (this.owner() !== scope) this.clear();
        if (recovery && this.owner() === scope) { this.resume.set(true); this.ticks.set({}); }
      });
    });
  }
  private cancel(): void { this.epoch++; this.controller.abort(); this.controller = new AbortController(); this.operation = null; this.busy.set(false); }
  private clear(): void {
    this.cancel(); this.owner.set(null); this.active.set(false); this.claimValue.set(null); this.orderValue.set(null); this.termsValue.set(null);
    this.failureValue.set(null); this.handoffValue.set(null); this.ticks.set({}); this.resume.set(false); this.unknownAttempt.set(null); this.commands.clear();
  }
  /** Re-entry always reads the existing order first; a supplied stock record does not cause a POST. */
  enter(handoff?: ManualHandoff | null): Promise<void> {
    const scope = this.scope(); if (!scope || this.destroyed) return Promise.resolve();
    if (this.owner() !== scope) { this.clear(); this.owner.set(scope); }
    this.active.set(true);
    if (handoff !== undefined) this.handoffValue.set(handoff ? structuredClone(handoff) : null);
    this.resume.set(true); this.ticks.set({});
    return this.refresh();
  }
  /** Ends this route's reads; retains attempted identities until account/run change so re-entry cannot replay a write. */
  dispose(): void { this.cancel(); this.active.set(false); this.resume.set(true); this.ticks.set({}); this.handoffValue.set(null); }
  refresh(): Promise<void> {
    if (!this.owned() || this.destroyed) return Promise.resolve();
    if (this.operation) return this.operation;
    return this.run(async (valid, options) => {
      this.failureValue.set(null);
      const order = await this.client.readOrder(options); if (!valid()) return;
      this.orderValue.set(order);
      if (order.status !== 'not-found') {
        if (order.status === 'ok' || order.status === 'pending') {
          this.unknownAttempt.set(order.status === 'pending' || order.value?.status === 'pending' ? { lane: 'submit', pending: true } : null);
          this.claimValue.set(null); this.termsValue.set(null); this.ticks.set({});
        }
        return;
      }
      const claim = await this.client.readClaim(options); if (!valid()) return;
      const oldQuote = this.claimValue(); this.claimValue.set(claim);
      if (claim.status === 'ok') {
        if (oldQuote?.status !== 'ok' || oldQuote.value.quote.quoteId !== claim.value.quote.quoteId
          || oldQuote.value.hold.version !== claim.value.hold.version) this.ticks.set({});
        const unknown = this.unknownAttempt();
        if (unknown && (unknown.lane === 'claim' && claim.value.hold.orderUuid === unknown.orderUuid
          || unknown.holdId === claim.value.hold.holdId && (unknown.lane === 'review' && claim.value.hold.phase === 'order-review'
            || unknown.lane === 'release' && ['released', 'expired'].includes(claim.value.state)))) this.unknownAttempt.set(null);
        const terms = await this.client.readTerms(options); if (!valid()) return;
        const oldTerms = this.termsValue();
        if (oldTerms?.status !== 'ok' || terms.status !== 'ok' || oldTerms.value.termsDigest !== terms.value.termsDigest) this.ticks.set({});
        this.termsValue.set(terms);
      } else this.termsValue.set(null);
    });
  }
  checkStatus(): Promise<void> { return this.refresh(); }
  confirmResume(): void {
    if (this.owned() && !this.busy() && !this.unknownAttempt() && this.orderValue()?.status === 'not-found'
      && this.claimValue()?.status === 'ok') { this.resume.set(false); this.ticks.set({}); }
  }
  setDeclaration(id: string, checked: boolean): void {
    if (!this.owned() || this.busy() || this.resume() || this.unknownAttempt() || this.projection().order
      || !this.projection().declarations.some((d) => d.id === id) || typeof checked !== 'boolean') return;
    this.ticks.update((ticks) => ({ ...ticks, [id]: checked }));
  }
  claimSelection(): Promise<void> {
    if (!this.canClaim()) return Promise.resolve();
    const input = this.handoffValue()!.claimInput!;
    const command = { ...structuredClone(input), commandId: this.commandId('claim', input) };
    return this.writeClaim('claim', () => this.client.claim(command, { signal: this.controller.signal }), { lane: 'claim', orderUuid: input.orderUuid });
  }
  beginReview(): Promise<void> {
    if (!this.owned() || !this.projection().canReview) return Promise.resolve();
    const command = this.reviewCommand('review');
    return this.writeClaim('review', () => this.client.review(command, { signal: this.controller.signal }), { lane: 'review', holdId: command.holdId });
  }
  async release(reason: ManualReleaseCommand['reason']): Promise<boolean> {
    if (this.owned() && !this.busy() && !this.unknownAttempt() && this.orderValue()?.status === 'not-found'
      && this.claimValue()?.status === 'ok' && this.projection().claim?.state === 'released' && ['cancel', 'change', 'back'].includes(reason)) return true;
    if (!this.owned() || !this.projection().canRelease || !['cancel', 'change', 'back'].includes(reason)) return false;
    const base = this.reviewCommand('release', reason); const command = { ...base, reason };
    await this.writeClaim('release', () => this.client.release(command, { signal: this.controller.signal }), { lane: 'release', holdId: base.holdId });
    // Router must await true before editing /account or browsing another car.
    return this.owned() && !this.unknownAttempt() && this.claimValue()?.status === 'ok' && this.projection().claim?.state === 'released';
  }
  submit(): Promise<void> {
    if (!this.owned() || !this.projection().canSubmit || this.orderValue()?.status !== 'not-found') return Promise.resolve();
    const claim = this.projection().claim!; const terms = this.projection().terms!;
    const body: Omit<ManualSubmitCommand, 'commandId'> = { source: { type: 'cart', holdId: claim.hold.holdId,
      expectedHoldVersion: claim.hold.version, expectedDraftVersion: claim.quote.draftVersion }, expectedQuoteId: claim.quote.quoteId,
      expectedStockVersion: claim.quote.stockVersion, termsDigest: terms.termsDigest,
      declarations: Object.fromEntries(this.projection().declarations.map((d) => [d.id, this.ticks()[d.id] === true])) };
    const command = { ...body, commandId: this.commandId('submit', body) };
    return this.run(async (valid, options) => {
      this.unknownAttempt.set({ lane: 'submit', holdId: claim.hold.holdId });
      let result: ManualResult<ManualOrder>;
      try { result = await this.client.submit(command, options); }
      catch { result = { status: 'uncertain', code: 'manual-command-outcome-unknown', retryable: false }; }
      if (!valid()) return;
      if (result.status !== 'uncertain') this.unknownAttempt.set(result.status === 'pending' ? { lane: 'submit', holdId: claim.hold.holdId, pending: true } : null);
      this.orderValue.set(result); this.failureValue.set(failed(result));
      if (result.status === 'uncertain') {
        this.unknownAttempt.set({ lane: 'submit', holdId: claim.hold.holdId });
        // Only a read may reconcile a lost response. A 404 does not erase the uncertain attempt.
        const order = await this.client.readOrder(options); if (!valid()) return;
        this.orderValue.set(order);
        if (order.status === 'ok' || order.status === 'pending') {
          this.unknownAttempt.set(order.status === 'pending' || order.value?.status === 'pending' ? { lane: 'submit', pending: true } : null);
          this.failureValue.set(failed(order));
        }
      }
      if (result.status !== 'ok') this.ticks.set({});
    });
  }
  private reviewCommand(lane: Lane, reason?: string): ManualReviewCommand {
    const claim = this.projection().claim!;
    const body = { holdId: claim.hold.holdId, expectedHoldVersion: claim.hold.version, expectedDraftVersion: claim.quote.draftVersion };
    return { ...body, commandId: this.commandId(lane, { ...body, ...(reason ? { reason } : {}) }) };
  }
  private commandId(lane: Lane, body: unknown): string {
    const key = JSON.stringify([lane, body]); let id = this.commands.get(key);
    if (!id) { id = crypto.randomUUID(); this.commands.set(key, id); } return id;
  }
  private writeClaim(lane: Lane, send: () => Promise<ManualResult<ManualClaim>>, attempt: UnknownAttempt): Promise<void> {
    return this.run(async (valid, options) => {
      this.failureValue.set(null);
      this.unknownAttempt.set(attempt);
      let result: ManualResult<ManualClaim>;
      try { result = await send(); } catch { result = { status: 'uncertain', code: 'manual-command-outcome-unknown', retryable: false }; }
      if (!valid()) return;
      this.failureValue.set(failed(result));
      this.unknownAttempt.set(uncertain(result.status) ? { ...attempt, pending: result.status === 'pending' } : null);
      if (result.status === 'ok') {
        this.claimValue.set(result); this.ticks.set({});
        if (lane === 'claim') this.resume.set(false);
        if (lane !== 'release') { const terms = await this.client.readTerms(options); if (valid()) this.termsValue.set(terms); }
      }
    });
  }
  private run(work: (valid: () => boolean, options: { signal: AbortSignal }) => Promise<void>): Promise<void> {
    if (!this.owned() || this.busy() || this.destroyed) return this.operation ?? Promise.resolve();
    const epoch = this.epoch; const scope = this.scope(); const controller = this.controller;
    const valid = () => this.owned() && !this.destroyed && epoch === this.epoch && scope === this.scope();
    this.busy.set(true);
    const operation = (async () => {
      try { await work(valid, { signal: controller.signal }); }
      catch { if (valid()) this.failureValue.set({ status: 'unavailable', code: 'manual-read-unavailable', retryable: true }); }
      finally { if (valid()) { this.busy.set(false); this.operation = null; } }
    })();
    this.operation = operation; return operation;
  }
}
