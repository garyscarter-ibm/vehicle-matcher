import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
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
  readonly pendingValue = computed(() => {
    const result = this.submission(); const value = result?.status === 'ok' ? result.value : result?.value;
    return validSubmission(value) ? value : null;
  });
  readonly planBusy = computed(() => this.owned() && this.readingPlan());
  readonly productionBusy = computed(() => this.owned() && this.readingProduction());
  readonly submitting = computed(() => this.owned() && this.sending());
  readonly stale = computed(() => this.owned() && this.staleValue());
  readonly hasEdits = computed(() => this.owned() && Object.keys(this.edits()).length > 0);
  readonly editorSource = computed(() => this.plan()?.editors ?? []);
  readonly editorErrors = computed(() => this.changes().errors);
  readonly canPreview = computed(() => this.owned() && !!this.plan() && this.hasEdits() && !this.planBusy() && !this.submitting() && !this.editorErrors().length);
  readonly canSubmit = computed(() => this.owned() && !!this.plan()?.canSubmit && !this.stale() && !this.hasEdits()
    && !this.planBusy() && !this.submitting() && !this.retainedCommand() && !this.needsAuthentication());
  readonly canRetrySubmission = computed(() => this.owned() && !!this.retainedCommand() && !this.submitting() && !this.needsAuthentication());
  readonly needsAuthentication = computed(() => authFailure(this.planFailure()) || authFailure(this.productionFailure())
    || authFailure(failureOf(this.submission())));
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
            this.commandResult.set({ status: 'authentication-required', reason: 'Sign in again, then deliberately retry the same request.' });
          }
          return;
        }
        const policy = state.status === 'ready' ? state.context.policyVersion : null;
        if (scope !== this.owner()) { this.clear(); this.owner.set(scope); this.contextVersion = policy; void this.refresh(); }
        else if (policy !== this.contextVersion) {
          this.contextVersion = policy; this.staleValue.set(true);
          // Renew reads only. Safe same-account edits/intent stay in memory; commands require another click.
          this.commandResult.set(null); void this.refresh();
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
    this.owner.set(null); this.planResult.set(null); this.productionResult.set(null); this.commandResult.set(null);
    this.edits.set({}); this.retainedCommand.set(null); this.staleValue.set(false); this.sending.set(false); this.contextVersion = null;
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
    this.planResult.set(result); this.readingPlan.set(false);
    this.staleValue.set(result.status !== 'ok' || !preview && this.hasEdits());
  }
  async refreshProduction(): Promise<void> { this.refreshEpoch++; await this.readProduction(); }
  private async readProduction(): Promise<void> {
    if (!this.owned() || this.submitting()) return;
    const scope = this.scope(); const epoch = ++this.productionEpoch;
    this.productionAbort.abort(); this.productionAbort = new AbortController(); this.readingProduction.set(true);
    let result: PlanningResult<ProductionView>;
    try { result = projectProduction(await this.client.readProduction({ signal: this.productionAbort.signal })); }
    catch { result = { status: 'unavailable', reason: 'Production status could not be loaded. Try again.', retryable: true }; }
    if (this.disposed || epoch !== this.productionEpoch || scope !== this.scope()) return;
    const previous = this.production();
    if (previous && (result.status !== 'ok' || previous.fingerprint !== result.value.fingerprint)) {
      this.staleValue.set(true); this.planEpoch++; this.planAbort.abort(); this.readingPlan.set(false);
    }
    this.productionResult.set(result); this.readingProduction.set(false);
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
