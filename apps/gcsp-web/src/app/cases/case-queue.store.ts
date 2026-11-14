import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthPort, SessionState } from '../auth/auth.port';
import { CaseClient, CaseClientResult, CaseCommandRemedy, UpdateCaseCommand } from './case.client';
import { carOptionNames, caseStatusLabel, caseTime, projectCase } from './case.projection';
import { CaseDisplay, CaseOptions, CaseScope, CaseStatus } from './case.types';

type Session = Extract<SessionState, { status: 'ready' }>;
interface Scope { session: Session; key: string; resource: Extract<CaseScope, { audience: 'scheme-team' }> }
export interface QueueDraft { status: string; reason: string; nextAction: string; dueAt: string; remedyKey: string; decision: string; until: string }
interface Choice { key: string; label: string; remedy: CaseCommandRemedy | 'manual-decision' | 'contract-extension' }
const emptyDraft = (): QueueDraft => ({ status: '', reason: '', nextAction: '', dueAt: '', remedyKey: '', decision: '', until: '' });
interface State {
  scope: Scope | null; phase: 'loading' | 'ready' | 'empty' | 'unavailable' | 'denied' | 'auth-required';
  rows: readonly CaseDisplay[]; selected: string | null; options: CaseOptions | null;
  detailPhase: 'closed' | 'loading' | 'ready' | 'unavailable' | 'stale';
  draft: QueueDraft; errors: Readonly<Partial<Record<keyof QueueDraft, string>>>;
  review: UpdateCaseCommand | null; pending: boolean; uncertain: boolean; reconciled: boolean; recorded: boolean; message: string;
}
const blank = (scope: Scope | null = null): State => ({ scope, phase: 'loading', rows: [], selected: null, options: null, detailPhase: 'closed',
  draft: emptyDraft(), errors: {}, review: null, pending: false, uncertain: false, reconciled: false, recorded: false, message: '' });
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
function scopeOf(state: SessionState): Scope | null {
  if (state.status !== 'ready') return null;
  const c = state.context;
  if (!c.roles.includes('greg') || c.roles.includes('presenter') || ![c.subject, c.environmentId, c.runId, c.policyVersion].every(nonempty)) return null;
  return { session: state, key: JSON.stringify([c.subject, c.environmentId, c.runId, c.employeeId, c.policyVersion, [...c.roles].sort()]),
    resource: { audience: 'scheme-team', runId: c.runId } };
}
const same = (a: Scope | null, b: Scope | null) => !!a && !!b && a.session === b.session && a.key === b.key;
const failed = (): CaseClientResult<never> => ({ state: 'failed', value: null, problem: 'transport-unavailable' });
const unknown = 'This update has an unknown outcome. Check the current case before deliberately retrying the same update.';

/** One routed queue owns one private selection and immutable command lane. Java decides feasibility. */
@Injectable()
export class CaseQueueStore {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(CaseClient);
  private readonly snapshot = signal<State>(blank());
  private readonly stopped = signal(false);
  private active: Scope | null = null;
  private queueController?: AbortController;
  private detailController?: AbortController;
  private writeController?: AbortController;
  private queueGeneration = 0;
  private detailGeneration = 0;

  readonly view = computed(() => {
    const session = this.auth.state(); const scope = scopeOf(session);
    const s = !this.stopped() && same(scope, this.snapshot().scope) ? this.snapshot() : blank();
    const phase = this.stopped() ? 'loading' : scope ? s.phase : session.status === 'ready' || session.status === 'denied' ? 'denied' : session.status;
    return { ...s, phase, authenticationUnavailable: session.status === 'unavailable',
      canRetryAuthentication: session.status === 'unavailable' && session.retryable,
      detail: s.options ? projectCase(s.options.case, scope!.resource) : null,
      canConfirm: !!scope && !this.stopped() && !!s.review && !s.pending && !s.uncertain && s.detailPhase === 'ready',
      canRetry: !!scope && !this.stopped() && !!s.review && !s.pending && s.uncertain && s.reconciled };
  });
  readonly choices = computed<readonly Choice[]>(() => {
    const o = this.view().options?.options; if (!o) return [];
    const choices: Choice[] = [];
    if (o.alternativeCars.available) {
      const names = carOptionNames(o.alternativeCars.items);
      o.alternativeCars.items.forEach((car, i) => {
        const orderUuid = car['orderUuid'];
        if (nonempty(orderUuid)) choices.push({ key: `car:${i}`, label: `Alternative car: ${names[i]}`, remedy: { type: 'alternative-car', orderUuid } });
      });
    }
    if (o.laterRelease.available) o.laterRelease.items.forEach((item, i) => {
      if (item.type === 'later-release' && nonempty(item['releaseAt']) && nonempty(item['source'])) choices.push({ key: `later:${i}`,
        label: `Later release: ${caseTime(item['releaseAt'], 'scheme-team')}`, remedy: { type: 'later-release', releaseAt: item['releaseAt'], source: item['source'] } });
    });
    if (o.manualDecision.available) choices.push({ key: 'manual', label: 'Manual decision', remedy: 'manual-decision' });
    if (o.contractExtension.available) choices.push({ key: 'extension', label: 'Contract extension', remedy: 'contract-extension' });
    return choices;
  });

  constructor() {
    effect(() => {
      const scope = scopeOf(this.auth.state());
      if (this.stopped() || same(scope, this.active)) return;
      untracked(() => { this.invalidate(); this.active = scope; this.snapshot.set(blank(scope)); if (scope) void this.loadQueue(scope); });
    });
  }
  async signIn(): Promise<void> { if (!this.stopped()) await this.auth.signIn('/gcsp/greg/cases'); }
  async retryAuthentication(): Promise<void> { if (this.auth.state().status === 'unavailable') try { await this.auth.retry(); } catch { /* auth owns its unavailable state */ } }
  async refresh(): Promise<boolean> { const scope = this.currentScope(); return scope && !this.view().pending ? this.loadQueue(scope, this.view().selected, this.view().uncertain) : false; }
  async open(caseId: string): Promise<boolean> {
    const scope = this.currentScope(); const s = this.view();
    if (!scope || s.pending || s.uncertain || s.phase !== 'ready' || !s.rows.some(row => row.caseId === caseId)) return false;
    this.snapshot.update(v => ({ ...v, recorded: false }));
    return this.loadOptions(scope, caseId);
  }
  async refreshOptions(): Promise<boolean> {
    const scope = this.currentScope(); const s = this.view();
    return scope && s.selected && !s.pending && !s.uncertain ? this.loadOptions(scope, s.selected) : false;
  }
  close(): void {
    if (this.view().pending) return;
    this.detailController?.abort(); this.detailGeneration++;
    this.snapshot.update(s => ({ ...s, selected: null, options: null, detailPhase: 'closed', draft: emptyDraft(), review: null, errors: {}, uncertain: false, reconciled: false }));
  }
  edit(field: keyof QueueDraft, value: string): void {
    const s = this.view(); if (s.pending || s.review || s.detailPhase !== 'ready') return;
    this.snapshot.update(v => ({ ...v, draft: { ...v.draft, [field]: value, ...(field === 'remedyKey' ? { decision: '', until: '' } : {}) }, errors: {} }));
  }
  review(): boolean {
    const s = this.view(); const scope = this.currentScope();
    if (!scope || !s.options || s.pending || s.review || s.uncertain || s.detailPhase !== 'ready' || !s.options.nextStatuses.length) return false;
    const d = s.draft; const errors: Partial<Record<keyof QueueDraft, string>> = {};
    if (!s.options.nextStatuses.includes(d.status as CaseStatus)) errors.status = 'Choose a status supplied by the server.';
    if (!d.reason.trim() || d.reason.length > 2000) errors.reason = 'Describe why this case is changing in 1 to 2,000 characters.';
    if (!d.nextAction.trim() || d.nextAction.length > 2000) errors.nextAction = 'Record the next action in 1 to 2,000 characters.';
    const date = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(d.dueAt) ? new Date(d.dueAt + 'Z') : null;
    if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, d.dueAt.length) !== d.dueAt || date.getTime() <= Date.parse(s.options.asOf)) errors.dueAt = 'Supply a future UTC due date and time.';
    const choice = this.choices().find(v => v.key === d.remedyKey);
    let remedy: CaseCommandRemedy | undefined;
    if (d.remedyKey && !choice) errors.remedyKey = 'Choose a remedy supplied by the server.';
    if (choice?.remedy === 'manual-decision') {
      if (!d.decision.trim() || d.decision.length > 2000) errors.decision = 'Record the authorised scheme-team decision in 1 to 2,000 characters.';
      remedy = { type: 'manual-decision', decision: d.decision.trim() };
    } else if (choice?.remedy === 'contract-extension') {
      const end = s.options.options.contractExtension.contractEndDate;
      if (!/^\d{4}-\d\d-\d\d$/.test(d.until) || !end || d.until <= end || d.until <= s.options.asOf.slice(0, 10) || !Number.isFinite(Date.parse(d.until)) || new Date(d.until).toISOString().slice(0, 10) !== d.until) errors.until = 'Choose a future date after the actual contract end.';
      remedy = { type: 'contract-extension', until: d.until };
    } else if (choice) remedy = choice.remedy;
    if (!remedy && !s.options.case.remedy && ['remedy-proposed', 'resolved'].includes(d.status)) errors.remedyKey = 'Choose a permitted remedy before proposing or resolving this case.';
    if (Object.keys(errors).length) { this.snapshot.update(v => ({ ...v, errors })); return false; }
    try {
      const command = this.client.prepareUpdate({ commandId: `case-update-${crypto.randomUUID()}`, caseId: s.options.case.caseId,
        expectedVersion: s.options.case.version, status: d.status as CaseStatus, reason: d.reason.trim(), nextAction: d.nextAction.trim(),
        dueAt: date!.toISOString(), ...(remedy ? { remedy } : {}) });
      if ('state' in command) { this.failure(command, 'detail'); return false; }
      this.snapshot.update(v => ({ ...v, review: command, errors: {}, message: 'Review the case update before confirming.' })); return true;
    } catch { this.snapshot.update(v => ({ ...v, message: 'The update could not be prepared. Refresh case options before reviewing again.', review: null })); return false; }
  }
  cancelReview(): void { if (!this.view().pending && !this.view().uncertain) this.snapshot.update(s => ({ ...s, review: null, message: 'Case update cancelled.' })); }
  async confirm(): Promise<boolean> { return this.view().canConfirm ? this.send(this.view().review!) : false; }
  async retry(): Promise<boolean> { return this.view().canRetry ? this.send(this.view().review!) : false; }
  dispose(): void { this.stopped.set(true); this.invalidate(); this.active = null; this.snapshot.set(blank()); }
  private currentScope(): Scope | null { const scope = scopeOf(this.auth.state()); return !this.stopped() && same(scope, this.active) ? scope : null; }
  private current(scope: Scope): boolean { return !this.stopped() && same(scope, scopeOf(this.auth.state())); }
  private invalidate(): void { this.queueGeneration++; this.detailGeneration++; this.queueController?.abort(); this.detailController?.abort(); this.writeController?.abort(); }
  private async read<T>(work: () => Promise<CaseClientResult<T>>): Promise<CaseClientResult<T>> { try { return await work(); } catch { return failed(); } }
  private async loadQueue(scope: Scope, selected: string | null = null, preserve = false): Promise<boolean> {
    this.queueController?.abort(); this.detailController?.abort(); this.detailGeneration++;
    const controller = new AbortController(); this.queueController = controller; const generation = ++this.queueGeneration;
    this.snapshot.update(s => ({ ...s, phase: 'loading', rows: [], options: null, detailPhase: 'closed', draft: emptyDraft(), errors: {},
      review: preserve ? s.review : null, uncertain: preserve, reconciled: false, selected, message: s.recorded ? 'The case update was recorded. Loading current cases.' : 'Loading renewal cases.' }));
    const result = await this.read(() => this.client.readQueue({ signal: controller.signal }));
    if (!this.current(scope) || generation !== this.queueGeneration || controller.signal.aborted) return false;
    if (result.state !== 'ready') { this.failure(result, 'queue'); return true; }
    const rows = result.value.cases.map(row => projectCase(row, scope.resource));
    if (rows.some(row => row === null)) { this.failure({ state: 'scope-mismatch', value: null }, 'queue'); return true; }
    this.snapshot.update(s => ({ ...s, rows: rows as CaseDisplay[], phase: rows.length ? 'ready' : 'empty',
      message: s.recorded ? 'The case update was recorded. Showing current cases.' : preserve ? unknown : 'Current renewal cases loaded.' }));
    if (selected && rows.some(row => row?.caseId === selected)) await this.loadOptions(scope, selected, preserve);
    else this.snapshot.update(s => ({ ...s, selected: preserve ? selected : null, detailPhase: preserve ? 'unavailable' : 'closed' }));
    return true;
  }
  private async loadOptions(scope: Scope, caseId: string, preserve = false): Promise<boolean> {
    this.detailController?.abort(); const controller = new AbortController(); this.detailController = controller; const generation = ++this.detailGeneration;
    this.snapshot.update(s => ({ ...s, selected: caseId, options: null, detailPhase: 'loading', draft: emptyDraft(), errors: {},
      review: preserve ? s.review : null, uncertain: preserve, reconciled: false }));
    const result = await this.read(() => this.client.readOptions(caseId, { signal: controller.signal }));
    if (!this.current(scope) || generation !== this.detailGeneration || controller.signal.aborted) return false;
    if (result.state !== 'ready') { this.failure(result, 'detail'); return true; }
    const o = result.value;
    if (o.case.caseId !== caseId || !projectCase(o.case, scope.resource)) { this.failure({ state: 'scope-mismatch', value: null }, 'detail'); return true; }
    this.snapshot.update(s => ({ ...s, options: o, detailPhase: 'ready', draft: { ...emptyDraft(), nextAction: o.case.nextAction, dueAt: o.case.dueAt?.slice(0, 19) ?? '' },
      reconciled: preserve, message: s.recorded ? 'The case update was recorded. Showing current case options.' : preserve ? unknown : 'Current case options loaded.' }));
    return true;
  }
  private async send(command: UpdateCaseCommand): Promise<boolean> {
    const scope = this.currentScope(); if (!scope || this.view().pending) return false;
    const controller = new AbortController(); this.writeController = controller;
    this.snapshot.update(s => ({ ...s, pending: true, recorded: false, reconciled: false, message: 'Recording the confirmed case update.' }));
    let result: CaseClientResult<{ case: CaseOptions['case'] }>;
    try { result = await this.client.updateCase(command, { signal: controller.signal }); }
    catch { result = { state: 'failed', value: null, problem: 'transport-unavailable', writeOutcome: 'unknown' }; }
    if (!this.current(scope) || controller.signal.aborted) return false;
    if (result.state === 'ready') {
      if (result.value.case.caseId !== command.input.caseId || !projectCase(result.value.case, scope.resource)) { this.failure({ state: 'scope-mismatch', value: null }, 'detail'); return true; }
      this.snapshot.update(s => ({ ...s, pending: false, review: null, uncertain: false, recorded: true }));
      return this.loadQueue(scope, command.input.caseId);
    }
    if (!this.losesAccess(result) && (result.writeOutcome === 'unknown' || result.state === 'refused' && result.refusal.code === 'outcome-uncertain')) {
      this.snapshot.update(s => ({ ...s, pending: false, options: null, draft: emptyDraft(), errors: {}, detailPhase: 'unavailable', uncertain: true, reconciled: false, message: unknown }));
    } else this.failure(result, 'detail');
    return true;
  }
  private losesAccess(result: CaseClientResult<unknown>): boolean {
    return result.state === 'scope-mismatch' || result.state === 'refused' && ['forbidden', 'unauthenticated'].includes(result.refusal.status)
      || result.state === 'failed' && ['context-changed', 'authentication-required', 'role-required', 'context-unavailable', 'environment-mismatch'].includes(result.problem);
  }
  private failure(result: CaseClientResult<unknown>, lane: 'queue' | 'detail'): void {
    const reason = result.state === 'refused' ? result.refusal.reason : result.state === 'scope-mismatch' ? 'Reopen your current session. These cases do not match this account or run.' : 'Current case information is unavailable. Refresh before trying again.';
    const auth = result.state === 'refused' && result.refusal.status === 'unauthenticated' || result.state === 'failed' && result.problem === 'authentication-required';
    const stale = result.state === 'refused' && ['stale-version', 'conflict'].includes(result.refusal.status);
    if (this.losesAccess(result)) {
      this.invalidate(); this.snapshot.set({ ...blank(this.active), phase: auth ? 'auth-required' : 'denied', message: reason }); return;
    }
    this.snapshot.update(s => ({ ...s, ...(lane === 'queue' ? { phase: 'unavailable' as const, rows: [] } : {}), options: null, draft: emptyDraft(), errors: {},
      detailPhase: stale ? 'stale' : 'unavailable', pending: false, review: s.uncertain && !stale ? s.review : null,
      uncertain: s.uncertain && !stale, reconciled: false,
      message: `${s.recorded ? 'The case update was recorded. ' : s.uncertain && !stale ? unknown + ' ' : ''}${reason}${stale ? ' Refresh case options and review again.' : ''}` }));
  }
  readonly statusLabel = caseStatusLabel;
}
