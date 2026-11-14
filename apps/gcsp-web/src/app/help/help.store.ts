import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import type { SessionState } from '../auth/auth.port';
import { CaseClient } from '../cases/case.client';
import type { CaseClientResult, HelpCaseCommand } from '../cases/case.client';
import { projectCase } from '../cases/case.projection';
import type { CaseDetailValue, CaseDisplay, CaseHelp, CaseRecord, CaseScope } from '../cases/case.types';
import { caseReadNotice } from './help.projection';

type ReadySession = Extract<SessionState, { status: 'ready' }>;
type Phase = 'loading' | 'ready' | 'empty' | 'unavailable' | 'denied' | 'stale' | 'auth-required';
interface Scope {
  readonly session: ReadySession;
  readonly key: string;
  readonly resource: Extract<CaseScope, { audience: 'employee' }>;
}
interface Notice { readonly title: string; readonly text: string }
interface Snapshot {
  readonly scope: Scope | null;
  readonly phase: Phase;
  readonly help: CaseHelp | null;
  readonly cases: readonly CaseDisplay[];
  readonly draft: string;
  readonly editing: boolean;
  readonly review: HelpCaseCommand | null;
  readonly error: string;
  readonly pending: boolean;
  readonly uncertain: boolean;
  readonly reconciled: boolean;
  readonly recordedCaseId: string | null;
  readonly notice: Notice | null;
  readonly message: string;
}
export interface HelpView {
  readonly phase: Phase | 'signed-out' | 'auth-loading' | 'auth-unavailable' | 'access-denied';
  readonly help: CaseHelp | null;
  readonly cases: readonly CaseDisplay[];
  readonly draft: string;
  readonly editing: boolean;
  readonly reviewReason: string | null;
  readonly error: string;
  readonly pending: boolean;
  readonly uncertain: boolean;
  readonly recorded: boolean;
  readonly notice: Notice | null;
  readonly message: string;
  readonly canAsk: boolean;
  readonly canReview: boolean;
  readonly canConfirm: boolean;
  readonly canRetry: boolean;
}
const blank = (scope: Scope | null = null): Snapshot => ({ scope, phase: 'loading', help: null, cases: [], draft: '',
  editing: false, review: null, error: '', pending: false, uncertain: false, reconciled: false,
  recordedCaseId: null, notice: null, message: '' });
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
function scopeOf(session: SessionState): Scope | null {
  if (session.status !== 'ready') return null;
  const c = session.context;
  if (!c.roles.includes('employee') || ![c.subject, c.environmentId, c.runId, c.employeeId, c.policyVersion].every(text)) return null;
  return { session, key: JSON.stringify([c.subject, c.environmentId, c.runId, c.employeeId, c.policyVersion, [...c.roles].sort()]),
    resource: { audience: 'employee', runId: c.runId, employeeId: c.employeeId! } };
}
const loaded = (s: Snapshot): boolean => s.phase === 'ready' || s.phase === 'empty';
const same = (a: Scope | null, b: Scope | null): boolean => !!a && !!b && a.session === b.session && a.key === b.key;
const readFailure = (): CaseClientResult<never> => ({ state: 'failed', value: null, problem: 'transport-unavailable' });
const unknownMessage = 'Your request has an unknown outcome. Check the current cases before deliberately retrying the same request.';

/** One Help body owns one draft and command lane. Java remains the authority for cases and actions. */
@Injectable()
export class HelpStore {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(CaseClient);
  private readonly snapshot = signal<Snapshot>(blank());
  private readonly stopped = signal(false);
  private active: Scope | null = null;
  private controller?: AbortController;
  private generation = 0;

  readonly view = computed<HelpView>(() => {
    const session = this.auth.state();
    const scope = scopeOf(session);
    const s = !this.stopped() && same(scope, this.snapshot().scope) ? this.snapshot() : blank();
    const base: HelpView = { phase: 'loading', help: null, cases: [], draft: '', editing: false, reviewReason: null,
      error: '', pending: false, uncertain: false, recorded: false, notice: null, message: '',
      canAsk: false, canReview: false, canConfirm: false, canRetry: false };
    if (this.stopped()) return base;
    if (!scope) {
      if (session.status === 'loading') return { ...base, phase: 'auth-loading', message: 'Checking your sign-in.' };
      if (session.status === 'signed-out') return { ...base, phase: 'signed-out', message: 'Sign in to view your renewal help.' };
      if (session.status === 'unavailable') return { ...base, phase: 'auth-unavailable', message: 'Sign-in is unavailable. Try again.' };
      return { ...base, phase: 'access-denied', message: 'You do not have access to this renewal help.' };
    }
    const actionable = loaded(s) && !s.pending;
    return { phase: s.phase, help: s.help, cases: s.cases, draft: s.draft, editing: s.editing,
      reviewReason: s.review?.input.reason ?? null, error: s.error, pending: s.pending, uncertain: s.uncertain,
      recorded: s.recordedCaseId !== null, notice: s.notice, message: s.message,
      canAsk: actionable && !s.editing && !s.review,
      canReview: actionable && s.editing && !s.uncertain,
      canConfirm: actionable && !!s.review && !s.uncertain,
      canRetry: actionable && !!s.review && s.uncertain && s.reconciled };
  });

  constructor() {
    effect(() => {
      const scope = scopeOf(this.auth.state());
      if (this.stopped() || same(scope, this.active)) return;
      untracked(() => {
        this.invalidate();
        this.active = scope;
        this.snapshot.set(blank(scope));
        if (scope) void this.load(scope);
      });
    });
  }

  beginRequest(): void {
    if (!this.view().canAsk) return;
    this.snapshot.update(s => ({ ...s, editing: true, error: '', notice: null, message: '', recordedCaseId: null }));
  }
  setReason(reason: string): void {
    if (!this.view().editing || this.view().pending) return;
    this.snapshot.update(s => ({ ...s, draft: reason, review: null, error: '' }));
  }
  reviewRequest(): void {
    const s = this.snapshot();
    if (!this.view().canReview || !this.current(s.scope)) return;
    if (!s.draft.trim() || s.draft.length > 2000) {
      const error = 'Describe your renewal problem in 1 to 2,000 characters.';
      this.snapshot.update(v => ({ ...v, error, message: error }));
      return;
    }
    let command: ReturnType<CaseClient['prepareHelp']>;
    try { command = this.client.prepareHelp({ commandId: `case-${globalThis.crypto.randomUUID()}`, reason: s.draft.trim() }); }
    catch {
      this.snapshot.update(v => ({ ...v, notice: { title: 'Request unavailable', text: 'Refresh cases before reviewing your request again.' },
        message: 'Your request has not been sent.' }));
      return;
    }
    if ('state' in command) { this.applyFailure(command, s.scope!); return; }
    this.snapshot.update(v => ({ ...v, review: command, editing: false, error: '', notice: null, message: 'Review your reason before confirming.' }));
  }
  cancelRequest(): void {
    const view = this.view();
    if (view.pending || view.uncertain || (!view.editing && view.reviewReason === null)) return;
    this.snapshot.update(s => ({ ...s, editing: false, review: null, error: '', notice: loaded(s) ? null : s.notice,
      message: 'Request review cancelled.' }));
  }
  async confirm(): Promise<boolean> {
    const s = this.snapshot();
    if (!this.view().canConfirm || !s.review || !this.current(s.scope)) return false;
    return this.send(s.scope!, s.review);
  }
  async retryRequest(): Promise<boolean> {
    const s = this.snapshot();
    if (!this.view().canRetry || !s.review || !this.current(s.scope)) return false;
    return this.send(s.scope!, s.review);
  }
  async refresh(): Promise<boolean> {
    const scope = scopeOf(this.auth.state());
    if (this.stopped() || !scope || !same(scope, this.active) || this.view().pending) return false;
    return this.load(scope);
  }
  async signIn(): Promise<void> {
    if (!this.stopped() && ['signed-out', 'auth-required'].includes(this.view().phase)) await this.auth.signIn('/gcsp/help');
  }
  async retryAuthentication(): Promise<void> {
    if (this.stopped() || this.auth.state().status !== 'unavailable') return;
    try { await this.auth.retry(); } catch { /* Shared auth retains its actual failure. No command is replayed. */ }
  }
  dispose(): void {
    if (this.stopped()) return;
    this.stopped.set(true);
    this.invalidate();
    this.active = null;
    this.snapshot.set(blank());
  }

  private current(scope: Scope | null): boolean {
    return !this.stopped() && same(scope, scopeOf(this.auth.state()));
  }
  private invalidate(): void { this.generation++; this.controller?.abort(); this.controller = undefined; }
  private start(): { generation: number; controller: AbortController } {
    this.invalidate();
    const controller = new AbortController();
    this.controller = controller;
    return { generation: this.generation, controller };
  }
  private isCurrent(scope: Scope, operation: { generation: number; controller: AbortController }): boolean {
    return this.current(scope) && operation.generation === this.generation && !operation.controller.signal.aborted;
  }
  private async safeRead<T>(work: () => Promise<CaseClientResult<T>>): Promise<CaseClientResult<T>> {
    try { return await work(); } catch { return readFailure(); }
  }
  private async load(scope: Scope): Promise<boolean> {
    if (!this.current(scope)) return false;
    const operation = this.start();
    const options = { signal: operation.controller.signal };
    this.snapshot.update(s => ({ ...s, phase: 'loading', help: null, cases: [], notice: null, reconciled: false,
      message: s.recordedCaseId ? 'Your help request was recorded. Loading current cases.' : 'Loading renewal help.' }));
    const id = this.snapshot().recordedCaseId;
    const read = async <T>(work: () => Promise<CaseClientResult<T>>): Promise<CaseClientResult<T>> => {
      const result = await this.safeRead(work);
      // A denial clears private draft/review immediately, even if a sibling read ignores abort.
      if (this.isCurrent(scope, operation) && this.losesAccess(result)) {
        this.invalidate();
        this.applyFailure(result, scope);
      }
      return result;
    };
    const [help, cases, detail] = await Promise.all([
      read(() => this.client.readHelp(options)),
      read(() => this.client.readOwnCases(options)),
      id ? read(() => this.client.readOwnCase(id, options)) : Promise.resolve(null),
    ]);
    if (!this.isCurrent(scope, operation)) return false;
    const failures = [help, cases, ...(detail ? [detail] : [])].filter(result => result.state !== 'ready');
    const failure = failures.find(result => result.state === 'scope-mismatch'
      || result.state === 'refused' && ['unauthenticated', 'forbidden'].includes(result.refusal.status)) ?? failures[0];
    if (failure) { this.applyFailure(failure, scope); return true; }
    if (help.state !== 'ready' || cases.state !== 'ready' || detail && detail.state !== 'ready') return false;
    const rows: CaseRecord[] = [...cases.value.cases];
    if (detail?.state === 'ready') {
      const index = rows.findIndex(row => row.caseId === detail.value.case.caseId);
      if (index < 0) rows.push(detail.value.case);
      else if (detail.value.case.version >= rows[index].version) rows[index] = detail.value.case;
    }
    const displayed = rows.map(row => projectCase(row, scope.resource));
    if (displayed.some(row => row === null)) { this.applyFailure({ state: 'scope-mismatch', value: null }, scope); return true; }
    this.snapshot.update(s => ({ ...s, phase: rows.length ? 'ready' : 'empty', help: help.value,
      cases: displayed as CaseDisplay[], reconciled: s.uncertain,
      message: s.uncertain ? 'Current cases loaded. Your previous request still has an unknown outcome; you may deliberately retry the same request.'
        : s.recordedCaseId ? 'Your help request was recorded. Showing current cases.' : 'Cases refreshed.' }));
    return true;
  }
  private async send(scope: Scope, command: HelpCaseCommand): Promise<boolean> {
    const operation = this.start();
    this.snapshot.update(s => ({ ...s, pending: true, notice: null, reconciled: false, message: 'Saving your confirmed request.' }));
    let result: CaseClientResult<CaseDetailValue>;
    try { result = await this.client.requestHelp(command, { signal: operation.controller.signal }); }
    catch { result = { ...readFailure(), writeOutcome: 'unknown' as const }; }
    if (!this.isCurrent(scope, operation)) return false;
    if (result.state === 'ready') {
      if (!projectCase(result.value.case, scope.resource)) { this.applyFailure({ state: 'scope-mismatch', value: null }, scope); return true; }
      this.snapshot.set({ ...blank(scope), recordedCaseId: result.value.case.caseId });
      return this.load(scope);
    }
    const privateLoss = this.losesAccess(result);
    if (!privateLoss && (result.writeOutcome === 'unknown' || result.state === 'refused' && result.refusal.code === 'outcome-uncertain')) {
      this.snapshot.update(s => ({ ...s, phase: 'unavailable', help: null, cases: [], pending: false, editing: false,
        review: command, uncertain: true, reconciled: false, notice: { title: 'Check the current case', text: unknownMessage }, message: unknownMessage }));
    } else this.applyFailure(result, scope);
    return true;
  }
  private losesAccess(result: CaseClientResult<unknown>): boolean {
    return result.state === 'scope-mismatch' || result.state === 'refused' && ['unauthenticated', 'forbidden'].includes(result.refusal.status)
      || result.state === 'failed' && ['context-changed', 'authentication-required', 'role-required', 'context-unavailable', 'environment-mismatch'].includes(result.problem);
  }
  private applyFailure(result: CaseClientResult<unknown>, scope: Scope): void {
    if (!this.current(scope)) return;
    const old = this.snapshot();
    const lost = this.losesAccess(result);
    const denied = result.state === 'refused' && result.refusal.status === 'forbidden'
      || result.state === 'failed' && result.problem === 'role-required';
    const auth = result.state === 'refused' && result.refusal.status === 'unauthenticated'
      || result.state === 'failed' && result.problem === 'authentication-required';
    const stale = result.state === 'scope-mismatch' || result.state === 'refused' && ['stale-version', 'conflict'].includes(result.refusal.status);
    const notice = result.state === 'failed'
      ? { title: denied ? 'You cannot open these cases' : auth ? 'Sign in to continue' : lost ? 'Reopen your current session' : 'Renewal help is unavailable',
        text: lost ? 'Reopen your current employee session before continuing.' : 'Refresh cases before trying again.' }
      : caseReadNotice(result) ?? { title: 'Renewal help is unavailable', text: 'Refresh cases before trying again.' };
    const s = lost ? blank(scope) : old;
    this.snapshot.set({ ...s, phase: denied ? 'denied' : auth ? 'auth-required' : stale ? 'stale' : 'unavailable',
      help: null, cases: [], pending: false, reconciled: false, notice,
      // Refused commands need a fresh read/review. An unknown intent survives failed reads only.
      review: lost || stale || !s.uncertain ? null : s.review,
      uncertain: !lost && !stale && s.uncertain,
      editing: !lost && !stale && !s.uncertain && !!s.draft,
      message: `${s.recordedCaseId ? 'Your help request was recorded. Current case information is unavailable. ' : s.uncertain ? `${unknownMessage} ` : ''}${notice.title}. ${notice.text}` });
  }
}
