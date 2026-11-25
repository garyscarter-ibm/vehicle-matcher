import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { GregOrderCommand, GregOrders, parseGregOrders } from './greg-orders.model';
import { PlanningClient } from './planning.client';
import { projectPlan, projectProduction, validSubmission } from './planning.projection';
import { ConstraintEditor, PlanChange, PlanningFailure, PlanningResult, PlanView, ProductionCommand, ProductionSubmissionDto, ProductionView } from './planning.types';

const integer = (v: string): number | null => /^\d+$/.test(v.trim()) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
const failureOf = <T>(v: PlanningResult<T> | null): PlanningFailure | null => v && v.status !== 'ok' ? v : null;
const authFailure = (v: PlanningFailure | null): boolean => !!v && ['authentication-required', 'unauthenticated', 'stale-run', 'context-changed'].includes(v.status)
  || v?.code === 'stale-run';

@Injectable()
export class PlanningStore {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(PlanningClient);
  private readonly owner = signal<string | null>(null);
  private readonly planResult = signal<PlanningResult<PlanView> | null>(null);
  private readonly productionResult = signal<PlanningResult<ProductionView> | null>(null);
  private readonly commandResult = signal<PlanningResult<ProductionSubmissionDto> | null>(null);
  private readonly activeEditors = signal<readonly ConstraintEditor[] | null>(null);
  private readonly edits = signal<Readonly<Record<string, string>>>({});
  private readonly retainedCommand = signal<ProductionCommand | null>(null);
  private readonly staleValue = signal(false);
  private readonly readingPlan = signal(false);
  private readonly readingProduction = signal(false);
  private readonly sending = signal(false);
  readonly scope = computed(() => {
    const state = this.auth.state(); return state.status === 'ready' && state.context.roles.includes('greg')
      ? JSON.stringify([state.context.subject, state.context.environmentId, state.context.runId]) : null;
  });
  private readonly owned = computed(() => !!this.scope() && this.scope() === this.owner() && !this.disposed);
  readonly plan = computed(() => this.owned() && this.planResult()?.status === 'ok' ? (this.planResult() as { status: 'ok'; value: PlanView }).value : null);
  readonly production = computed(() => this.owned() && this.productionResult()?.status === 'ok' ? (this.productionResult() as { status: 'ok'; value: ProductionView }).value : null);
  readonly planFailure = computed(() => this.owned() ? failureOf(this.planResult()) : null);
  readonly productionFailure = computed(() => this.owned() ? failureOf(this.productionResult()) : null);
  readonly submission = computed(() => this.owned() ? this.commandResult() : null);
  private readonly ordersValue = signal<GregOrders | null>(null);
  private readonly retainedOrder = signal<GregOrderCommand | null>(null);
  readonly orders = computed(() => this.owned() ? this.ordersValue() : null);
  private readonly orderSuccess = signal('');
  readonly orderMessage = computed(() => { const result = this.orderOutcome(); return !result ? '' : result.status === 'ok' ? this.orderSuccess() : this.failureMessage(failureOf(result)); });
  private readonly orderResult = signal<PlanningResult<unknown> | null>(null);
  readonly orderOutcome = computed(() => this.owned() ? this.orderResult() : null);
  readonly orderRetryKind = computed(() => this.owned() ? this.retainedOrder()?.kind ?? null : null);
  readonly canRetryOrder = computed(() => this.owned() && !!this.retainedOrder() && !this.submitting() && !this.needsAuthentication());
  readonly canRequestCars = computed(() => this.owned() && this.orders()?.providerStatus === 'available'
    && this.orders()?.versions?.['policy'] === this.contextVersion && !this.submitting() && !this.productionBusy()
    && !this.retainedOrder() && !this.retainedCommand() && !this.needsAuthentication());
  async requestCars(model: string, derivative: string, quantity: string): Promise<void> {
    const count = integer(quantity); const orders = this.orders();
    if (!this.canRequestCars() || !orders?.versions || count === null || count < 1 || count > 1000
      || !orders.choices.some(c => c.model === model && c.derivative === derivative)) return;
    const command: GregOrderCommand = { kind: 'manual', input: { commandId: globalThis.crypto.randomUUID(), model, derivative, quantity: count,
      expectedPolicyVersion: orders.versions['policy'], expectedStockVersion: orders.versions['stock'] } };
    this.retainedOrder.set(command); await this.sendOrder(command);
  }
  queueBlocked(requestId: string): boolean {
    const retained = this.retainedOrder();
    return !this.owned() || this.submitting() || !!this.retainedCommand() || this.needsAuthentication()
      || !!retained && !(retained.kind === 'queue' && retained.input.requestId === requestId);
  }
  async retryReleaseQueue(requestId: string): Promise<void> {
    if (this.queueBlocked(requestId)) return;
    const retained = this.retainedOrder(); if (retained) { await this.sendOrder(retained); return; }
    if (!this.orders()?.requests.some(r => r.requestId === requestId && r.supplies.some(s => !s.queued))) return;
    const command: GregOrderCommand = { kind: 'queue', input: { commandId: globalThis.crypto.randomUUID(), requestId } };
    this.retainedOrder.set(command); await this.sendOrder(command);
  }
  async retryOrder(): Promise<void> { const command = this.retainedOrder(); if (command && this.canRetryOrder()) await this.sendOrder(command); }
  private async sendOrder(command: GregOrderCommand): Promise<void> {
    const scope = this.scope(); const epoch = ++this.commandEpoch; this.sending.set(true); this.staleValue.set(true);
    this.refreshEpoch++; this.planEpoch++; this.planAbort.abort(); this.readingPlan.set(false);
    let result: PlanningResult<unknown>;
    try { result = command.kind === 'manual' ? await this.client.submitManual(command.input, { signal: this.commandAbort.signal })
      : await this.client.queue(command.input, { signal: this.commandAbort.signal }); }
    catch { result = { status: 'uncertain', reason: 'The result is not known. Retry the same command to continue.' }; }
    if (this.disposed || scope !== this.scope() || epoch !== this.commandEpoch) return;
    this.sending.set(false); this.orderResult.set(result);
    if (result.status === 'ok') this.orderSuccess.set(command.kind === 'queue' ? 'Confirmed supply queued.'
      : validSubmission(result.value) ? result.value.message : 'Request submitted. Awaiting production response.');
    if (result.status === 'ok' || !['uncertain', 'pending', 'unavailable', 'authentication-required', 'unauthenticated', 'context-changed', 'aborted'].includes(result.status)) this.retainedOrder.set(null);
    if (result.status === 'ok' || result.status === 'pending') await this.refreshProduction(true);
  }
  readonly pendingValue = computed(() => {
    const result = this.submission(); const value = result?.status === 'ok' ? result.value : result?.value;
    return validSubmission(value) ? value : null;
  });
  readonly planBusy = computed(() => this.owned() && this.readingPlan());
  readonly productionBusy = computed(() => this.owned() && this.readingProduction());
  readonly submitting = computed(() => this.owned() && this.sending());
  readonly stale = computed(() => this.owned() && this.staleValue());
  readonly hasEdits = computed(() => this.owned() && Object.keys(this.edits()).length > 0);
  readonly editorSource = computed(() => this.owned() ? this.activeEditors() ?? this.plan()?.editors ?? [] : []);
  readonly editorErrors = computed(() => this.changes().errors);
  readonly canPreview = computed(() => this.owned() && !!this.plan() && this.hasEdits() && !this.planBusy() && !this.submitting() && !this.editorErrors().length);
  readonly canSubmit = computed(() => this.owned() && !!this.plan()?.canSubmit && !this.stale() && !this.hasEdits()
    && !this.planBusy() && !this.submitting() && !this.retainedCommand() && !this.retainedOrder() && !this.needsAuthentication());
  readonly canRetrySubmission = computed(() => this.owned() && !!this.retainedCommand() && !this.submitting() && !this.needsAuthentication());
  readonly needsAuthentication = computed(() => authFailure(this.planFailure()) || authFailure(this.productionFailure())
    || authFailure(failureOf(this.submission())) || authFailure(failureOf(this.orderOutcome())));
  readonly access = computed(() => {
    const state = this.auth.state();
    if (state.status === 'denied' || state.status === 'ready' && !this.scope()) return 'denied';
    if (state.status === 'signed-out') return 'signed-out';
    if (state.status === 'unavailable') return 'unavailable';
    return state.status === 'ready' ? 'ready' : 'loading';
  });
  readonly submissionBlock = computed(() => this.retainedCommand() ? 'An earlier request needs a deliberate retry before another can be sent.'
    : this.plan()?.preview ? 'Preview only. Edited limits are not connected to Production requests.'
    : this.stale() || this.hasEdits() ? 'Replan with the latest inputs before requesting.'
    : this.plan()?.state === 'infeasible' ? 'Change the limits to get a plan you can request.'
    : !this.plan()?.canSubmit ? 'There is no current order to request.' : 'Nothing is ordered until Production confirms.');
  private disposed = false;
  private planEpoch = 0; private productionEpoch = 0; private commandEpoch = 0;
  private planAbort = new AbortController(); private productionAbort = new AbortController(); private commandAbort = new AbortController();
  private contextVersion: string | null = null;
  private refreshEpoch = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.disposed = true; this.clear(); });
    effect(() => {
      const state = this.auth.state(); const scope = this.scope();
      untracked(() => {
        if (this.disposed) return;
        if (state.status === 'signed-out' || state.status === 'denied' || state.status === 'ready' && !scope) { this.clear(); return; }
        if (!scope) {
          this.abortReads(); this.staleValue.set(true); this.contextVersion = null;
          if (this.sending()) {
            this.commandEpoch++; this.commandAbort.abort(); this.commandAbort = new AbortController(); this.sending.set(false);
            if (this.retainedOrder()) this.orderResult.set({ status: 'authentication-required', reason: 'Sign in again, then deliberately retry the same command.' });
            this.commandResult.set({ status: 'authentication-required', reason: 'Sign in again, then deliberately retry the same request.' });
          }
          return;
        }
        const policy = state.status === 'ready' ? state.context.policyVersion : null;
        if (scope !== this.owner()) { this.clear(); this.owner.set(scope); this.contextVersion = policy; void this.refresh(); }
        else if (policy !== this.contextVersion) {
          this.contextVersion = policy; this.staleValue.set(true);
          // Renew reads only. Safe same-account edits/intent stay in memory; commands require another click.
          this.commandResult.set(null); this.orderResult.set(null); void this.refresh();
        }
      });
    });
  }
  private abortReads(): void {
    this.refreshEpoch++; this.planEpoch++; this.productionEpoch++; this.planAbort.abort(); this.productionAbort.abort();
    this.planAbort = new AbortController(); this.productionAbort = new AbortController(); this.readingPlan.set(false); this.readingProduction.set(false);
  }
  private clear(): void {
    this.abortReads(); this.commandEpoch++; this.commandAbort.abort(); this.commandAbort = new AbortController();
    this.ordersValue.set(null); this.retainedOrder.set(null); this.orderResult.set(null); this.orderSuccess.set('');
    this.owner.set(null); this.planResult.set(null); this.productionResult.set(null); this.commandResult.set(null);
    this.activeEditors.set(null); this.edits.set({}); this.retainedCommand.set(null); this.staleValue.set(false); this.sending.set(false); this.contextVersion = null;
  }
  async refresh(): Promise<void> {
    if (!this.owned()) return;
    const epoch = ++this.refreshEpoch;
    // Read production first: changes invalidate the old plan, then the plan is read from fresh inputs.
    await this.readProduction();
    if (this.owned() && epoch === this.refreshEpoch) await this.readPlan(false);
  }
  async refreshPlan(): Promise<void> { this.refreshEpoch++; await this.readPlan(false); }
  async preview(): Promise<void> { if (this.canPreview()) { this.refreshEpoch++; await this.readPlan(true); } }
  private async readPlan(preview: boolean): Promise<void> {
    if (!this.owned() || this.submitting()) return;
    const parsed = this.changes(); if (preview && (!parsed.changes.length || parsed.errors.length)) return;
    const scope = this.scope(); const epoch = ++this.planEpoch;
    this.planAbort.abort(); this.planAbort = new AbortController(); this.readingPlan.set(true); this.staleValue.set(true);
    let result: PlanningResult<PlanView>;
    try { result = projectPlan(await (preview ? this.client.previewPlan(parsed.changes, { signal: this.planAbort.signal }) : this.client.readPlan({ signal: this.planAbort.signal }))); }
    catch { result = { status: 'unavailable', reason: 'The order plan could not be loaded. Try again.', retryable: true }; }
    if (this.disposed || epoch !== this.planEpoch || scope !== this.scope()) return;
    if (result.status === 'ok' && !result.value.preview && result.value.versions['policy'] !== this.contextVersion) {
      result = { status: 'context-changed', code: 'planning-context-changed', reason: 'The plan belongs to an earlier policy. Refresh your account and plan.' };
    }
    if (result.status === 'ok' && !result.value.preview) this.activeEditors.set(result.value.editors);
    this.planResult.set(result); this.readingPlan.set(false);
    this.staleValue.set(result.status !== 'ok' || !preview && this.hasEdits());
  }
  async refreshProduction(preserveOrderNotice = false): Promise<void> { this.refreshEpoch++; await this.readProduction(preserveOrderNotice); }
  private async readProduction(preserveOrderNotice = false): Promise<void> {
    if (!this.owned() || this.submitting()) return;
    const scope = this.scope(); const epoch = ++this.productionEpoch;
    this.productionAbort.abort(); this.productionAbort = new AbortController(); this.readingProduction.set(true);
    let result: PlanningResult<ProductionView>; let orders: GregOrders | null = null;
    try { const read = await this.client.readProduction({ signal: this.productionAbort.signal });
      orders = read.status === 'ok' ? parseGregOrders(read.value, true) : null; result = projectProduction(read); }
    catch { result = { status: 'unavailable', reason: 'Production status could not be loaded. Try again.', retryable: true }; }
    if (this.disposed || epoch !== this.productionEpoch || scope !== this.scope()) return;
    const previous = this.production();
    if (previous && (result.status !== 'ok' || previous.fingerprint !== result.value.fingerprint)) {
      this.staleValue.set(true); this.planEpoch++; this.planAbort.abort(); this.readingPlan.set(false);
      if (result.status === 'ok' && !preserveOrderNotice && this.orderResult()?.status === 'ok' && !this.retainedOrder()) {
        this.orderResult.set(null); this.orderSuccess.set('');
      }
    }
    this.ordersValue.set(orders); this.productionResult.set(result); this.readingProduction.set(false);
  }
  value(editor: ConstraintEditor, id = '', edge = ''): string {
    if (!this.owned()) return '';
    const key = this.inputKey(editor.key, id, edge);
    if (Object.hasOwn(this.edits(), key)) return this.edits()[key];
    return String(editor.kind === 'budget' ? editor.value ?? '' : editor.rows.find(r => r.id === id)?.[edge as 'min' | 'max'] ?? '');
  }
  edit(key: string, value: string, id = '', edge = ''): void {
    if (!this.owned() || this.submitting()) return;
    const editor = this.editorSource().find(e => e.key === key);
    if (!editor || editor.kind === 'bounds' && (!editor.rows.some(r => r.id === id) || !['min', 'max'].includes(edge))) return;
    this.edits.update(edits => ({ ...edits, [this.inputKey(key, id, edge)]: value }));
    this.refreshEpoch++; this.planEpoch++; this.planAbort.abort(); this.readingPlan.set(false); this.staleValue.set(true);
  }
  private inputKey(key: string, id: string, edge: string): string { return JSON.stringify([key, id, edge]); }
  private changes(): { changes: PlanChange[]; errors: string[] } {
    const changes: PlanChange[] = []; const errors: string[] = [];
    if (!this.owned()) return { changes, errors };
    for (const e of this.editorSource()) {
      const edited = Object.keys(this.edits()).some(key => JSON.parse(key)[0] === e.key); if (!edited) continue;
      if (e.kind === 'budget') {
        const value = integer(this.value(e)); if (value === null) errors.push('Order budget must be a nonnegative whole number of minor units.');
        changes.push({ key: e.key, value });
      } else {
        const value = e.rows.map(row => {
          const min = integer(this.value(e, row.id, 'min')); const max = integer(this.value(e, row.id, 'max'));
          if (min === null || max === null || min > max) errors.push(`${row.label}: use whole-number limits with minimum no greater than maximum.`);
          return { [e.idField!]: row.id, min, max };
        });
        changes.push({ key: e.key, value });
      }
    }
    return { changes, errors };
  }
  async backToCurrent(): Promise<void> { if (this.owned() && !this.submitting()) { this.edits.set({}); await this.refreshPlan(); } }
  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    const plan = this.plan()!;
    const command = { commandId: globalThis.crypto.randomUUID(), planId: plan.planId, versions: { ...plan.versions } };
    this.retainedCommand.set(command); await this.send(command);
  }
  async retrySubmission(): Promise<void> {
    const command = this.retainedCommand(); if (command && this.canRetrySubmission()) await this.send(command);
  }
  private async send(command: ProductionCommand): Promise<void> {
    const epoch = ++this.commandEpoch; const scope = this.scope(); this.sending.set(true);
    this.refreshEpoch++; this.planEpoch++; this.planAbort.abort(); this.readingPlan.set(false); this.staleValue.set(true);
    let result: PlanningResult<ProductionSubmissionDto>;
    try { result = await this.client.submit(command, { signal: this.commandAbort.signal }); }
    catch { result = { status: 'uncertain', code: 'outcome-uncertain', reason: 'The result is not known. Retry the same request to continue.' }; }
    if (this.disposed || epoch !== this.commandEpoch || scope !== this.scope()) return;
    this.commandResult.set(result); this.sending.set(false);
    const retain = result.status !== 'ok' && (['pending', 'uncertain', 'aborted', 'authentication-required', 'unauthenticated', 'context-changed', 'unavailable'].includes(result.status)
      || result.code === 'stale-run');
    if (!retain) this.retainedCommand.set(null);
    if (result.status === 'ok' || result.status === 'pending') await this.refreshProduction();
  }
  signIn(): void { void this.auth.signIn('/greg/plan'); }
  recover(): void { void this.auth.retry(); }
  failureMessage(value: PlanningFailure | null): string {
    return value?.reason ?? (value?.status === 'forbidden' ? 'Your account cannot use this action.' : 'This information is unavailable. Try again.');
  }
}
