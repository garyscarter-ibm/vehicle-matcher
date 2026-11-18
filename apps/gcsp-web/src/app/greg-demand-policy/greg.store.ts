import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import type { SessionState } from '../auth/auth.port';
import { GregClient, gregContextKey, gregSession } from './greg.client';
import type { GregPublishCommand } from './greg.client';
import type { GregChange, GregDemand, GregPolicy, GregPolicyField, GregPreview, GregPreviewInput, GregPublished, GregPublishInput, GregResult } from './greg.types';

export type GregState = 'loading' | 'ready' | 'unavailable' | 'denied' | 'stale' | 'auth-required' | 'unsupported' | 'uncertain';
type ReadySession = Extract<SessionState, { status: 'ready' }>;
interface Scope { readonly session: ReadySession; readonly key: string }
export interface GregEditorField extends GregPolicyField { readonly draft: string; readonly error: string; readonly outsideRange: boolean }
export interface GregView {
  readonly demandState: GregState; readonly policyState: GregState; readonly demand: GregDemand | null; readonly policy: GregPolicy | null;
  readonly fields: readonly GregEditorField[]; readonly pending: boolean; readonly action: 'load' | 'preview' | 'publish' | null;
  readonly preview: GregPreview | null; readonly publication: GregPublished | null; readonly retainedCommand: GregPublishInput | null;
  readonly uncertain: boolean; readonly message: string; readonly demandMessage: string; readonly policyMessage: string;
  readonly canPreview: boolean; readonly canPublish: boolean; readonly canRetry: boolean; readonly canEdit: boolean;
}
interface Snapshot {
  readonly scope: Scope | null; readonly demand: GregDemand | null; readonly policy: GregPolicy | null;
  readonly demandState: GregState; readonly policyState: GregState; readonly drafts: Readonly<Record<string, string>>;
  readonly pending: boolean; readonly action: GregView['action']; readonly preview: GregPreview | null;
  readonly binding: GregPreviewInput | null; readonly command: GregPublishCommand | null; readonly publication: GregPublished | null;
  readonly uncertain: boolean; readonly reconciled: boolean; readonly message: string; readonly demandMessage: string; readonly policyMessage: string;
}
const blank = (scope: Scope | null = null): Snapshot => ({ scope, demand: null, policy: null, demandState: 'loading', policyState: 'loading',
  drafts: {}, pending: false, action: null, preview: null, binding: null, command: null, publication: null, uncertain: false,
  reconciled: false, message: '', demandMessage: '', policyMessage: '' });
const scopeOf = (s: SessionState): Scope | null => gregSession(s) ? { session: s, key: gregContextKey(s.context) } : null;
const same = (a: Scope | null, b: Scope | null): boolean => !!a && !!b && a.session === b.session && a.key === b.key;
const whole = (raw: string): number | null => /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
const inputError = 'Enter a whole number of zero or more, within the safe integer limit.';
const unknownMessage = 'The publication outcome is unknown. The original request is retained. This service cannot reconcile a publication receipt here; do not create another publication.';
const failure = (): GregResult<never> => ({ state: 'failed', value: null, problem: 'transport-unavailable' });
function changes(s: Snapshot): readonly GregChange[] | null {
  if (!s.policy) return null;
  const rows: GregChange[] = [];
  for (const f of s.policy.fields) { const value = whole(s.drafts[f.id] ?? ''); if (value === null) return null; if (value !== f.value) rows.push({ id: f.id, value }); }
  return rows.length >= 1 && rows.length <= 100 ? rows : null;
}
function notice(result: GregResult<unknown>): { state: GregState; message: string; losesAccess: boolean } {
  if (result.state === 'refused') {
    const status = result.refusal.status;
    return { state: status === 'forbidden' ? 'denied' : status === 'unauthenticated' ? 'auth-required'
      : ['stale-version', 'stale-run', 'conflict'].includes(status) ? 'stale' : status === 'unsupported' ? 'unsupported'
        : status === 'uncertain' ? 'uncertain' : 'unavailable', message: result.refusal.reason,
      losesAccess: ['unauthenticated', 'forbidden', 'stale-run'].includes(status) };
  }
  if (result.state === 'scope-mismatch') return { state: 'stale', message: 'The run changed. Reopen your current session.', losesAccess: true };
  const problem = result.state === 'failed' ? result.problem : '';
  return { state: problem === 'role-required' ? 'denied' : ['authentication-required', 'access-token-unavailable'].includes(problem) ? 'auth-required' : 'unavailable',
    message: problem === 'role-required' ? 'Only the scheme ordering lead can open these controls.' : problem === 'authentication-required'
      ? 'Sign in to continue.' : 'The current information could not be confirmed. Refresh before continuing.',
    losesAccess: ['role-required', 'authentication-required', 'access-token-unavailable', 'context-changed', 'environment-mismatch', 'context-unavailable'].includes(problem) };
}

/** Provide once on the Greg route. Session replacement hides data synchronously and cancels its owned requests. */
@Injectable()
export class GregStore {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(GregClient);
  private readonly snapshot = signal<Snapshot>(blank());
  private readonly stopped = signal(false);
  private active: Scope | null = null;
  private controller?: AbortController;
  private generation = 0;

  readonly view = computed<GregView>(() => {
    const session = this.auth.state(); const scope = scopeOf(session);
    const s = !this.stopped() && same(scope, this.snapshot().scope) ? this.snapshot() : blank();
    const base: GregView = { demandState: 'loading', policyState: 'loading', demand: null, policy: null, fields: [], pending: false,
      action: null, preview: null, publication: null, retainedCommand: null, uncertain: false, message: '', demandMessage: '', policyMessage: '',
      canPreview: false, canPublish: false, canRetry: false, canEdit: false };
    if (this.stopped()) return base;
    if (!scope) {
      const state: GregState = session.status === 'signed-out' ? 'auth-required' : session.status === 'loading' ? 'loading'
        : session.status === 'unavailable' ? 'unavailable' : 'denied';
      const message = state === 'auth-required' ? 'Sign in to view demand and policy.' : state === 'loading' ? 'Checking your sign-in.'
        : state === 'denied' ? 'Only the scheme ordering lead can open these controls.' : 'Sign-in is unavailable. Try again.';
      return { ...base, demandState: state, policyState: state, message, demandMessage: message, policyMessage: message };
    }
    const edits = changes(s);
    const fields = (s.policy?.fields ?? []).map(f => { const draft = s.drafts[f.id] ?? ''; const value = whole(draft); return { ...f, draft,
      error: value === null ? inputError : '', outsideRange: !!f.presentationRange && value !== null && (value < f.presentationRange.minimum || value > f.presentationRange.maximum) }; });
    const editable = !!s.policy && ['ready', 'unsupported', 'unavailable'].includes(s.policyState) && !s.command && (!s.pending || s.action === 'preview');
    const bound = !!s.preview && !!s.binding && !!s.policy && s.preview.activeVersion === s.policy.activeVersion
      && JSON.stringify(edits) === JSON.stringify(s.binding.changes);
    return { demandState: s.demandState, policyState: s.policyState, demand: s.demand, policy: s.policy, fields, pending: s.pending, action: s.action,
      preview: s.preview, publication: s.publication, retainedCommand: s.command?.input ?? null, uncertain: s.uncertain,
      message: s.message, demandMessage: s.demandMessage, policyMessage: s.policyMessage,
      canEdit: editable, canPreview: editable && !s.pending && !!edits,
      canPublish: editable && !s.pending && bound, canRetry: !!s.command && !!s.publication && s.publication.activation?.status === 'pending' && s.publication.activation.retryable
        && s.reconciled && !s.pending && !s.uncertain };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dispose());
    effect(() => { const scope = scopeOf(this.auth.state()); if (this.stopped() || same(scope, this.active)) return;
      untracked(() => { this.invalidate(); this.active = scope; this.snapshot.set(blank(scope)); if (scope) void this.load(scope); }); });
  }
  async refresh(): Promise<boolean> {
    const scope = scopeOf(this.auth.state()); if (!scope || this.stopped() || !same(scope, this.active) || this.view().pending) return false;
    return this.load(scope);
  }
  setField(id: string, raw: string): void {
    const s = this.snapshot(); if (!this.view().canEdit || !s.policy?.fields.some(f => f.id === id) || typeof raw !== 'string' || raw.length > 64) return;
    if (s.action === 'preview') this.invalidate();
    this.snapshot.update(v => ({ ...v, drafts: { ...v.drafts, [id]: raw }, preview: null, binding: null, policyState: 'ready', policyMessage: '', pending: false, action: null,
      message: 'Draft changes. Preview again before publishing.' }));
  }
  async previewChanges(): Promise<boolean> {
    const s = this.snapshot(); const edits = changes(s);
    if (!this.view().canPreview || !s.policy || !edits || !this.current(s.scope)) return false;
    const operation = this.start(); const scope = s.scope!;
    const input: GregPreviewInput = Object.freeze({ expectedActiveVersion: s.policy.activeVersion, changes: Object.freeze(edits.map(c => Object.freeze({ ...c }))) });
    this.snapshot.update(v => ({ ...v, pending: true, action: 'preview', preview: null, binding: null, message: 'Calculating preview. Nothing is being published.' }));
    const result = await this.safe(() => this.client.preview(input, { signal: operation.controller.signal }));
    if (!this.isCurrent(scope, operation)) return false;
    const value = result.state === 'ready' ? result.value : null;
    const matches = value && value.activeVersion === input.expectedActiveVersion
      && value.active.demand.runId === scope.session.context.runId && value.draft.demand.runId === scope.session.context.runId
      && value.active.demand.asOf === value.asOf && value.draft.demand.asOf === value.asOf
      && value.active.demand.versions.policy.includes(input.expectedActiveVersion)
      && value.differences.length === edits.length && edits.every(e => value.differences.some(d => d.id === e.id && d.after === e.value
        && d.before === s.policy!.fields.find(f => f.id === e.id)?.value && d.unit === s.policy!.fields.find(f => f.id === e.id)?.unit));
    if (matches && value) this.snapshot.update(v => ({ ...v, pending: false, action: null, policyState: 'ready', policyMessage: '', preview: value, binding: input, message: 'Preview ready. Review the server results before publishing.' }));
    else this.applyFailure(result.state === 'ready' ? { state: 'invalid-response', value: null } : result, 'policy');
    return true;
  }
  async publishPreview(): Promise<boolean> {
    const s = this.snapshot(); if (!this.view().canPublish || !s.preview || !s.binding || !this.current(s.scope)) return false;
    let command: ReturnType<GregClient['preparePublish']>;
    try { const id = globalThis.crypto.randomUUID(); command = this.client.preparePublish({ ...s.binding, commandId: id,
      policyVersion: `greg-${id}`, effectiveFrom: s.preview.asOf }); }
    catch { this.applyFailure(failure(), 'policy'); return false; }
    if ('state' in command) { this.applyFailure(command, 'policy'); return false; }
    this.snapshot.update(v => ({ ...v, command, reconciled: false })); return this.send(s.scope!, command);
  }
  async retryPublication(): Promise<boolean> {
    const s = this.snapshot(); if (!this.view().canRetry || !s.command || !this.current(s.scope)) return false;
    return this.send(s.scope!, s.command);
  }
  async signIn(): Promise<void> { if (!this.stopped() && this.view().policyState === 'auth-required') await this.auth.signIn('/gcsp/greg'); }
  async retryAuthentication(): Promise<void> { if (!this.stopped() && this.auth.state().status === 'unavailable') { try { await this.auth.retry(); } catch { /* Auth owns recovery state. */ } } }
  dispose(): void { if (this.stopped()) return; this.stopped.set(true); this.invalidate(); this.active = null; this.snapshot.set(blank()); }

  private current(scope: Scope | null): boolean { return !this.stopped() && same(scope, scopeOf(this.auth.state())); }
  private invalidate(): void { this.generation++; this.controller?.abort(); this.controller = undefined; }
  private start(): { generation: number; controller: AbortController } { this.invalidate(); const controller = new AbortController(); this.controller = controller; return { generation: this.generation, controller }; }
  private isCurrent(scope: Scope, operation: { generation: number; controller: AbortController }): boolean { return this.current(scope) && operation.generation === this.generation && !operation.controller.signal.aborted; }
  private async safe<T>(work: () => Promise<GregResult<T>>): Promise<GregResult<T>> { try { return await work(); } catch { return failure(); } }
  private async load(scope: Scope): Promise<boolean> {
    if (!this.current(scope)) return false;
    const operation = this.start(); const options = { signal: operation.controller.signal };
    this.snapshot.update(s => ({ ...s, pending: true, action: 'load', demand: null, policy: null, demandState: 'loading', policyState: 'loading',
      preview: null, binding: null, reconciled: false, demandMessage: '', policyMessage: '', message: 'Loading current demand and policy.' }));
    const [demand, policy] = await Promise.all([this.safe(() => this.client.loadDemand(options)), this.safe(() => this.client.readPolicy(options))]);
    if (!this.isCurrent(scope, operation)) return false;
    if (demand.state !== 'ready' && notice(demand).losesAccess || policy.state !== 'ready' && notice(policy).losesAccess) {
      this.applyFailure(demand.state !== 'ready' && notice(demand).losesAccess ? demand : policy, 'all'); return true;
    }
    const d = demand.state === 'ready' ? null : notice(demand); const p = policy.state === 'ready' ? null : notice(policy);
    this.snapshot.update(s => ({ ...s, demand: demand.state === 'ready' ? demand.value : null, demandState: d?.state ?? 'ready', demandMessage: d?.message ?? '',
      policy: policy.state === 'ready' ? policy.value : null, policyState: p?.state ?? 'ready', policyMessage: p?.message ?? '', pending: false, action: null,
      drafts: policy.state === 'ready' ? Object.fromEntries(policy.value.fields.map(f => [f.id, s.command ? s.command.input.changes.find(c => c.id === f.id)?.value.toString() ?? String(f.value) : String(f.value)])) : {},
      reconciled: !s.uncertain && !!s.command && !!s.publication && policy.state === 'ready'
        && [s.command?.input.expectedActiveVersion, s.command?.input.policyVersion].includes(policy.value.activeVersion)
        && Date.parse(policy.value.asOf) >= Date.parse(s.command!.input.effectiveFrom),
      message: s.uncertain ? unknownMessage : s.publication ? 'Publication was accepted. Current readback does not change its recorded outcome.' : p?.message ?? d?.message ?? 'Current demand and policy loaded.' }));
    return true;
  }
  private async send(scope: Scope, command: GregPublishCommand): Promise<boolean> {
    const operation = this.start(); this.snapshot.update(s => ({ ...s, pending: true, action: 'publish', reconciled: false, message: 'Publishing the reviewed preview.' }));
    const result = await this.safe(() => this.client.publish(command, { signal: operation.controller.signal }));
    if (!this.isCurrent(scope, operation)) return false;
    if (result.state === 'ready' && result.value.policyVersion === command.input.policyVersion && result.value.effectiveFrom === command.input.effectiveFrom) {
      const publication = result.value;
      const active = publication.activation?.status === 'active';
      this.snapshot.update(s => ({ ...s, pending: false, action: null, preview: null, binding: null, publication, uncertain: false,
        command: active ? null : s.command, policy: active ? null : s.policy,
        message: active ? publication.activation?.status === 'active' && publication.activation.publishedVersionActive
          ? 'Publication accepted and active for new work. Existing offers keep their pinned terms.' : 'Publication accepted. A different policy is now active.'
          : 'Publication accepted. Activation is pending or could not be confirmed. Existing offers keep their pinned terms.' }));
      const demand = await this.safe(() => this.client.loadDemand({ signal: operation.controller.signal }));
      if (this.isCurrent(scope, operation)) {
        if (demand.state === 'ready') this.snapshot.update(s => ({ ...s, demand: demand.value, demandState: 'ready', demandMessage: '' }));
        else this.applyFailure(demand, 'demand');
      }
    } else if (result.state === 'ready' || result.writeOutcome === 'unknown' || result.state === 'refused' && result.refusal.status === 'uncertain') {
      this.snapshot.update(s => ({ ...s, pending: false, action: null, preview: null, binding: null, uncertain: true, reconciled: false, message: unknownMessage }));
    } else { this.snapshot.update(s => ({ ...s, command: null, preview: null, binding: null })); this.applyFailure(result, 'policy'); }
    return true;
  }
  private applyFailure(result: GregResult<unknown>, target: 'demand' | 'policy' | 'all'): void {
    const n = notice(result);
    this.snapshot.update(s => n.losesAccess ? { ...blank(s.scope), demandState: n.state, policyState: n.state, message: n.message, demandMessage: n.message, policyMessage: n.message }
      : { ...s, pending: false, action: null, preview: null, binding: null, reconciled: false,
        ...(target === 'demand' || target === 'all' ? { demand: null, demandState: n.state, demandMessage: n.message } : {}),
        ...(target === 'policy' || target === 'all' ? { policyState: n.state, policyMessage: n.message } : {}), message: n.message });
  }
}
