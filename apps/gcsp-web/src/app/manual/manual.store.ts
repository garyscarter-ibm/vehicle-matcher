import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { ManualClient } from './manual.client';
import { completeManualDetails, editableManualDetails, isManualReviewDetails, manualDetailsMatchClaim, projectManual, sameManualDetails,
  validManualEditableDetails } from './manual.projection';
import type { ManualClaim, ManualEditableDetails, ManualFailure, ManualHandoff, ManualOrder, ManualReleaseCommand, ManualResult, ManualReviewCommand,
  ManualReviewDetails, ManualReviewDetailsCommand, ManualSubmitCommand, ManualTerms } from './manual.types';

type Lane = 'claim' | 'review' | 'release' | 'save-details' | 'submit';
interface UnknownAttempt { readonly lane: Lane; readonly holdId?: string; readonly orderUuid?: string; readonly pending?: boolean;
  readonly detailsCommand?: ManualReviewDetailsCommand }
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
  private readonly detailsValue = signal<ManualResult<ManualReviewDetails> | null>(null);
  private readonly draftValue = signal<ManualEditableDetails | null>(null);
  private readonly failureValue = signal<ManualFailure | null>(null);
  private readonly handoffValue = signal<ManualHandoff | null>(null);
  private readonly ticks = signal<Readonly<Record<string, boolean>>>({});
  private readonly resume = signal(false);
  private readonly unknownAttempt = signal<UnknownAttempt | null>(null);
  private readonly owned = computed(() => this.active() && !!this.scope() && this.owner() === this.scope());
  readonly projection = computed(() => projectManual(this.owned() ? {
    claim: this.claimValue(), order: this.orderValue(), terms: this.termsValue(), failure: this.failureValue(),
    reviewDetails: this.detailsValue(), detailsDirty: this.detailsDirty(),
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
  readonly detailsDraft = computed(() => this.owned() ? this.draftValue() : null);
  readonly detailsDirty = computed(() => {
    const saved = this.detailsValue(); const draft = this.draftValue();
    return this.owned() && !!draft && saved?.status === 'ok' && !sameManualDetails(draft, editableManualDetails(saved.value));
  });
  readonly canSaveReviewDetails = computed(() => {
    const p = this.projection(); const draft = this.detailsDraft(); const details = p.reviewDetails;
    return this.owned() && !this.busy() && !this.resume() && !this.unknownAttempt() && this.orderValue()?.status === 'not-found'
      && !!details && details.editable && details.canContinue && !!draft && !!p.claim && p.claim.state === 'quoted'
      && (!p.failure || p.failure.status === 'invalid') && (this.detailsDirty() || details.reviewDetailsVersion === 0)
      && completeManualDetails(draft, details.mode, details.constraints);
  });
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
    this.detailsValue.set(null); this.draftValue.set(null);
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
          this.detailsValue.set(null); this.draftValue.set(null);
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
        if (claim.value.state === 'quoted') {
          const details = await this.client.readReviewDetails(options); if (!valid()) return;
          this.acceptDetails(details);
        } else { this.detailsValue.set(null); this.draftValue.set(null); }
      } else { this.termsValue.set(null); this.detailsValue.set(null); this.draftValue.set(null); }
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
  setReviewDetails(details: ManualEditableDetails): void {
    if (!this.owned() || this.busy() || this.resume() || this.unknownAttempt() || this.projection().order
      || !this.projection().reviewDetails?.editable || !validManualEditableDetails(details)) return;
    if (sameManualDetails(this.draftValue(), details)) return;
    this.draftValue.set(structuredClone(details)); this.ticks.set({});
    if (this.failureValue()?.status === 'invalid') this.failureValue.set(null);
  }
  saveReviewDetails(): Promise<void> {
    if (!this.canSaveReviewDetails()) return this.operation ?? Promise.resolve();
    const details = this.projection().reviewDetails!; const draft = structuredClone(this.detailsDraft()!);
    const body = { holdId: details.binding.holdId, quoteId: details.binding.quoteId,
      expectedHoldVersion: details.binding.expectedHoldVersion, expectedDraftVersion: details.binding.expectedDraftVersion,
      expectedReviewDetailsVersion: details.reviewDetailsVersion, details: draft };
    const command: ManualReviewDetailsCommand = { ...body, commandId: this.commandId('save-details', body) };
    return this.run(async (valid, options) => {
      this.failureValue.set(null); this.ticks.set({});
      const attempt: UnknownAttempt = { lane: 'save-details', holdId: body.holdId, detailsCommand: command };
      this.unknownAttempt.set(attempt);
      let result: ManualResult<ManualReviewDetails>;
      try { result = await this.client.saveReviewDetails(command, options); }
      catch { result = { status: 'uncertain', code: 'manual-command-outcome-unknown', retryable: false }; }
      if (!valid()) return;
      this.failureValue.set(failed(result));
      this.unknownAttempt.set(uncertain(result.status) ? { ...attempt, pending: result.status === 'pending' } : null);
      if (result.status === 'ok') this.acceptDetails(result, true);
      else if (uncertain(result.status)) {
        const read = await this.client.readReviewDetails(options); if (!valid()) return;
        this.acceptDetails(read);
      }
    });
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
    const claim = this.projection().claim!; const terms = this.projection().terms!; const details = this.projection().reviewDetails!;
    const body: Omit<ManualSubmitCommand, 'commandId'> = { source: { type: 'cart', holdId: claim.hold.holdId,
      expectedHoldVersion: claim.hold.version, expectedDraftVersion: claim.quote.draftVersion }, expectedQuoteId: claim.quote.quoteId,
      expectedStockVersion: details.stockVersion, expectedReviewDetailsVersion: details.reviewDetailsVersion, termsDigest: terms.termsDigest,
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
        if (lane !== 'release') {
          const terms = await this.client.readTerms(options); if (!valid()) return; this.termsValue.set(terms);
          const details = await this.client.readReviewDetails(options); if (valid()) this.acceptDetails(details);
        } else { this.detailsValue.set(null); this.draftValue.set(null); }
      }
    });
  }
  private acceptDetails(result: ManualResult<ManualReviewDetails>, saved = false): void {
    const old = this.detailsValue(); const dirty = this.detailsDirty();
    if (result.status !== 'ok') {
      if (old?.status !== 'ok') this.detailsValue.set(result);
      this.failureValue.set(result); return;
    }
    if (!isManualReviewDetails(result.value)) {
      this.failureValue.set({ status: 'unavailable', code: 'manual-response-invalid', retryable: false }); return;
    }
    const value = result.value; const claim = this.claimValue();
    const matchesClaim = claim?.status === 'ok' && manualDetailsMatchClaim(value, claim.value);
    if (old?.status !== 'ok' || old.value.reviewDetailsVersion !== value.reviewDetailsVersion
      || !sameManualDetails(old.value.binding, value.binding) || old.value.stockVersion !== value.stockVersion
      || !sameManualDetails(old.value.details, value.details) || !sameManualDetails(old.value.constraints, value.constraints)) this.ticks.set({});
    const sameBinding = old?.status === 'ok' && old.value.binding.holdId === value.binding.holdId
      && old.value.binding.quoteId === value.binding.quoteId && old.value.binding.expectedDraftVersion === value.binding.expectedDraftVersion;
    this.detailsValue.set(result);
    const unknown = this.unknownAttempt(); const command = unknown?.detailsCommand;
    const reconciled = unknown?.lane === 'save-details' && !!command && matchesClaim
      && value.binding.holdId === command.holdId && value.binding.quoteId === command.quoteId
      && value.binding.expectedHoldVersion === command.expectedHoldVersion && value.binding.expectedDraftVersion === command.expectedDraftVersion
      && value.reviewDetailsVersion === command.expectedReviewDetailsVersion + 1 && sameManualDetails(value.details, command.details);
    if (reconciled) { this.unknownAttempt.set(null); this.failureValue.set(null); }
    if (matchesClaim && (saved || reconciled || !dirty || !sameBinding)) this.draftValue.set(editableManualDetails(value));
    else if (!matchesClaim) this.draftValue.set(null);
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
