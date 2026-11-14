import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { ActivityClient } from './activity.client';
import { ActivityCommandInput, ActivityFailure, ActivityOfferDisplay, ActivityOperation, ActivityProjection, ActivityResult } from './activity.types';

type BuddyOperation = Extract<ActivityOperation, 'engage' | 'disengage'>;
type ActivityPhase = 'auth-loading' | 'signed-out' | 'auth-unavailable' | 'access-denied' | 'auth-required'
  | 'loading' | 'ready' | 'unavailable' | 'denied' | 'refused' | 'restarted' | 'conflict' | 'recovery';
interface EmployeeScope {
  readonly subject: string;
  readonly environmentId: string;
  readonly runId: string;
  readonly employeeId: string;
}
interface PendingRetry {
  readonly scopeKey: string;
  readonly operation: BuddyOperation;
  readonly input: ActivityCommandInput;
}
interface ActivitySnapshot {
  readonly scopeKey: string | null;
  readonly phase: ActivityPhase;
  readonly projection: ActivityProjection | null;
  readonly offerDisplay: ActivityOfferDisplay | null;
  readonly message: string;
  readonly pending: boolean;
  readonly retry: PendingRetry | null;
}
export interface ActivityView {
  readonly phase: ActivityPhase;
  readonly projection: ActivityProjection | null;
  readonly offerDisplay: ActivityOfferDisplay | null;
  readonly message: string;
  readonly pending: boolean;
  readonly showControls: boolean;
  readonly controlOperation: BuddyOperation | null;
  readonly retryAvailable: boolean;
}

const emptySnapshot = (): ActivitySnapshot => ({ scopeKey: null, phase: 'loading', projection: null, offerDisplay: null, message: '', pending: false, retry: null });
const usableText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const keyOf = (scope: EmployeeScope): string => JSON.stringify([scope.subject, scope.environmentId, scope.runId, scope.employeeId]);
const employeeScope = (state: SessionState): EmployeeScope | null => {
  if (state.status !== 'ready') return null;
  const context: ApplicationContext = state.context;
  if (!context.roles.includes('employee') || !usableText(context.subject) || !usableText(context.environmentId)
    || !usableText(context.runId) || !usableText(context.employeeId)) return null;
  return { subject: context.subject, environmentId: context.environmentId, runId: context.runId, employeeId: context.employeeId };
};
const sameScope = (left: EmployeeScope, right: EmployeeScope): boolean => left.subject === right.subject
  && left.environmentId === right.environmentId && left.runId === right.runId && left.employeeId === right.employeeId;
const accepted = (projection: ActivityProjection | null): boolean => projection?.currentOffer?.state === 'accepted';
const engaged = (projection: ActivityProjection): boolean => projection.permission?.searchConsent === true
  && projection.permission.holdConsent === true && projection.permission.paused === false;
const canControl = (projection: ActivityProjection | null): boolean => !!projection?.permission
  && projection.permission.searchConsent === true && projection.permission.holdConsent === true && !accepted(projection);

@Injectable()
export class ActivityStore {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(ActivityClient);
  private readonly snapshot = signal<ActivitySnapshot>(emptySnapshot());
  private readonly scope = computed(() => employeeScope(this.auth.state()));
  private activeScopeKey: string | null | undefined;
  private readAbort?: AbortController;
  private commandAbort?: AbortController;
  private readGeneration = 0;
  private commandGeneration = 0;
  private disposed = false;

  readonly view = computed<ActivityView>(() => {
    const session = this.auth.state();
    const scope = employeeScope(session);
    if (!scope) return this.authView(session);
    const key = keyOf(scope);
    const saved = this.snapshot();
    if (saved.scopeKey !== key) {
      return { phase: 'loading', projection: null, offerDisplay: null, message: '', pending: false,
        showControls: false, controlOperation: null, retryAvailable: false };
    }
    const showControls = saved.phase === 'ready' && canControl(saved.projection);
    return {
      phase: saved.phase,
      projection: saved.projection,
      offerDisplay: saved.offerDisplay,
      message: saved.message,
      pending: saved.pending,
      showControls,
      controlOperation: showControls ? (engaged(saved.projection!) ? 'disengage' : 'engage') : null,
      retryAvailable: !saved.pending && !!saved.retry && saved.retry.scopeKey === key && !accepted(saved.projection),
    };
  });

  constructor() {
    effect(() => {
      const scope = this.scope();
      const key = scope ? keyOf(scope) : null;
      if (key === this.activeScopeKey || this.disposed) return;
      this.activeScopeKey = key;
      untracked(() => {
        this.cancelPending();
        this.snapshot.set(scope ? { ...emptySnapshot(), scopeKey: key, phase: 'loading' } : emptySnapshot());
        if (scope) void this.load(scope);
      });
    });
  }

  async refresh(): Promise<void> {
    const scope = this.scope();
    if (!scope || this.disposed || this.view().pending) return;
    await this.load(scope, 'Refreshing activity.');
  }

  async signIn(): Promise<void> {
    if (this.disposed || !['signed-out', 'auth-required'].includes(this.view().phase)) return;
    await this.auth.signIn('/gcsp/activity');
  }

  async retryAuthentication(): Promise<void> {
    if (this.disposed || this.auth.state().status !== 'unavailable') return;
    try { await this.auth.retry(); } catch { /* The fixed unavailable state remains safe to show. */ }
  }

  async updateBuddy(operation: BuddyOperation): Promise<void> {
    const scope = this.scope();
    const view = this.view();
    const projection = view.projection;
    if (!scope || this.disposed || view.phase !== 'ready' || view.pending || !projection || !canControl(projection)
      || accepted(projection) || view.controlOperation !== operation) return;
    const versions = projection.briefVersion;
    if (!Number.isSafeInteger(versions) || (versions ?? 0) <= 0) {
      this.setSnapshot({ ...this.snapshot(), phase: 'unavailable', projection: null, offerDisplay: null,
        message: 'Current Buddy status is unavailable. Refresh activity before trying again.', pending: false });
      return;
    }
    await this.sendNewCommand(scope, operation, projection);
  }

  async retryUpdate(): Promise<void> {
    const scope = this.scope();
    const view = this.view();
    const retry = this.snapshot().retry;
    if (!scope || this.disposed || view.pending || !view.retryAvailable || !retry || retry.scopeKey !== keyOf(scope)
      || accepted(view.projection)) return;
    await this.sendCommand(scope, retry.operation, retry.input);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activeScopeKey = null;
    this.cancelPending();
    this.snapshot.set(emptySnapshot());
  }

  private authView(session: SessionState): ActivityView {
    const base: ActivityView = { phase: 'loading', projection: null, offerDisplay: null, message: '', pending: false,
      showControls: false, controlOperation: null, retryAvailable: false };
    if (session.status === 'loading') return { ...base, phase: 'auth-loading', message: 'Checking your sign-in.' };
    if (session.status === 'signed-out') return { ...base, phase: 'signed-out', message: 'Sign in to view your Buddy activity.' };
    if (session.status === 'denied') return { ...base, phase: 'access-denied', message: 'You do not have access to this activity.' };
    if (session.status === 'unavailable') return { ...base, phase: 'auth-unavailable', message: 'Sign-in is unavailable right now. Try again.' };
    if (!session.context.roles.includes('employee')) return { ...base, phase: 'access-denied', message: 'You do not have access to this activity.' };
    return { ...base, phase: 'auth-required', message: 'Sign in again to view your Buddy activity.' };
  }

  private async load(scope: EmployeeScope, message = ''): Promise<void> {
    if (this.disposed || !this.isCurrentScope(scope)) return;
    this.readAbort?.abort();
    const controller = new AbortController();
    this.readAbort = controller;
    const generation = ++this.readGeneration;
    const key = keyOf(scope);
    const previous = this.snapshot();
    const retry = previous.scopeKey === key ? previous.retry : null;
    this.setSnapshot({ scopeKey: key, phase: 'loading', projection: null, offerDisplay: null, message, pending: false, retry });

    let result: ActivityResult<ActivityProjection>;
    try { result = await this.client.readActivity({ signal: controller.signal }); }
    catch { result = { status: 'unavailable', code: 'activity-read-failed' }; }
    if (!this.isCurrentRead(generation, controller, scope)) return;
    if (result.status !== 'ok') {
      this.applyReadFailure(key, result, retry);
      return;
    }
    const projection = result.value;
    if (projection.runId !== scope.runId || projection.employeeId !== scope.employeeId) {
      this.setSnapshot({ scopeKey: key, phase: 'restarted', projection: null, offerDisplay: null,
        message: 'This session has changed. Refresh activity to read the current status.', pending: false, retry: null });
      return;
    }

    let offerDisplay: ActivityOfferDisplay | null = null;
    const offerId = projection.currentOffer?.offerRef?.offerId;
    if (usableText(offerId)) {
      try {
        const display = await this.client.readOfferDisplay({ offerId, runId: scope.runId, signal: controller.signal });
        if (display.status === 'ok' && display.value.offerRef.offerId === offerId) offerDisplay = display.value;
      } catch { offerDisplay = null; }
      if (!this.isCurrentRead(generation, controller, scope)) return;
    }

    let nextRetry = retry;
    if (accepted(projection) || retry && retry.scopeKey !== key || retry && this.operationApplied(projection, retry.operation)) nextRetry = null;
    this.setSnapshot({ scopeKey: key, phase: nextRetry ? 'recovery' : 'ready', projection, offerDisplay,
      message: nextRetry && !message ? 'The update outcome could not be confirmed. Retry update or refresh activity.' : message,
      pending: false, retry: nextRetry });
  }

  private applyReadFailure(key: string, failure: ActivityFailure, retry: PendingRetry | null): void {
    if (failure.status === 'aborted') return;
    if (failure.status === 'authentication-required') {
      this.setSnapshot({ scopeKey: key, phase: 'auth-required', projection: null, offerDisplay: null,
        message: 'Sign in again to view your Buddy activity.', pending: false, retry: null });
      return;
    }
    if (failure.status === 'forbidden') {
      this.setSnapshot({ scopeKey: key, phase: 'denied', projection: null, offerDisplay: null,
        message: 'You do not have access to this activity.', pending: false, retry: null });
      return;
    }
    if (failure.status === 'refused') {
      this.setSnapshot({ scopeKey: key, phase: 'refused', projection: null, offerDisplay: null,
        message: 'Activity access was refused. Refresh to check your current access.', pending: false, retry: null });
      return;
    }
    if (failure.status === 'stale-run') {
      this.setSnapshot({ scopeKey: key, phase: 'restarted', projection: null, offerDisplay: null,
        message: 'This session has changed. Refresh activity to read the current status.', pending: false, retry: null });
      return;
    }
    if (failure.status === 'conflict' || failure.status === 'stale-version') {
      this.setSnapshot({ scopeKey: key, phase: 'conflict', projection: null, offerDisplay: null,
        message: 'Activity changed. Refresh to see current status.', pending: false, retry });
      return;
    }
    this.setSnapshot({ scopeKey: key, phase: 'unavailable', projection: null, offerDisplay: null,
      message: retry ? 'The update outcome could not be confirmed. Retry update or refresh activity.'
        : 'Search status and offers are unavailable. Try again.', pending: false, retry });
  }

  private async sendNewCommand(scope: EmployeeScope, operation: BuddyOperation, projection: ActivityProjection): Promise<void> {
    this.beginCommand(scope, projection, 'Updating Buddy.');
    const controller = this.commandAbort!;
    const generation = this.commandGeneration;
    let versions: Awaited<ReturnType<ActivityClient['readControlVersions']>>;
    try { versions = await this.client.readControlVersions({ signal: controller.signal }); }
    catch { versions = { status: 'unavailable', code: 'activity-control-versions-unavailable' }; }
    if (!this.isCurrentCommand(generation, controller, scope)) return;
    if (versions.status !== 'ok') {
      this.finishCommandFailure(scope, versions, null);
      return;
    }
    if (versions.value.briefVersion !== projection.briefVersion) {
      this.commandAbort = undefined;
      this.setSnapshot({ ...this.snapshot(), pending: false, retry: null, phase: 'loading', projection: null, offerDisplay: null,
        message: 'Buddy changed. Showing current status.' });
      await this.load(scope, 'Buddy changed. Showing current status.');
      return;
    }
    let commandId: string | null = null;
    try { commandId = globalThis.crypto?.randomUUID?.() ?? null; } catch { commandId = null; }
    if (!usableText(commandId)) {
      this.commandAbort = undefined;
      this.setSnapshot({ ...this.snapshot(), pending: false, phase: 'unavailable', projection: null, offerDisplay: null,
        retry: null, message: 'This action is unavailable. Refresh activity and try again.' });
      return;
    }
    const input: ActivityCommandInput = {
      commandId,
      expectedBriefVersion: projection.briefVersion!,
      expectedDraftVersion: versions.value.draftVersion,
    };
    await this.sendCommand(scope, operation, input, controller, generation);
  }

  private async sendCommand(scope: EmployeeScope, operation: BuddyOperation, input: ActivityCommandInput,
    existingController?: AbortController, existingGeneration?: number): Promise<void> {
    if (!this.isCurrentScope(scope) || this.disposed) return;
    let controller = existingController;
    let generation = existingGeneration;
    if (!controller) {
      this.beginCommand(scope, this.snapshot().projection, 'Retrying the Buddy update.');
      controller = this.commandAbort!;
      generation = this.commandGeneration;
    }
    try {
      const result = await this.client.command(operation, input, { signal: controller.signal });
      if (!this.isCurrentCommand(generation!, controller, scope)) return;
      this.commandAbort = undefined;
      if (result.status === 'ok') {
        this.setSnapshot({ ...this.snapshot(), pending: false, retry: null, phase: 'loading', projection: null, offerDisplay: null,
          message: 'Buddy updated. Showing current status.' });
        await this.load(scope, 'Buddy updated. Showing current status.');
        return;
      }
      if (result.status === 'conflict' || result.status === 'stale-version') {
        this.setSnapshot({ ...this.snapshot(), pending: false, retry: null, phase: 'loading', projection: null, offerDisplay: null,
          message: 'Buddy changed. Showing current status.' });
        await this.load(scope, 'Buddy changed. Showing current status.');
        return;
      }
      if (result.status === 'authentication-required' || result.status === 'forbidden' || result.status === 'refused'
        || result.status === 'stale-run') {
        this.applyReadFailure(keyOf(scope), result, null);
        return;
      }
      if (result.status === 'pending' || result.status === 'uncertain' || result.status === 'unavailable') {
        const savedRetry: PendingRetry = { scopeKey: keyOf(scope), operation, input };
        this.setSnapshot({ ...this.snapshot(), phase: 'recovery', projection: null, offerDisplay: null, pending: false,
          retry: savedRetry, message: 'The update outcome could not be confirmed. Choose Retry update or Refresh activity.' });
        return;
      }
      this.setSnapshot({ ...this.snapshot(), phase: 'unavailable', projection: null, offerDisplay: null, pending: false,
        retry: null, message: 'Buddy could not be updated. Refresh activity to check the current status.' });
    } catch {
      if (!this.isCurrentCommand(generation!, controller, scope)) return;
      this.commandAbort = undefined;
      const savedRetry: PendingRetry = { scopeKey: keyOf(scope), operation, input };
      this.setSnapshot({ ...this.snapshot(), phase: 'recovery', projection: null, offerDisplay: null, pending: false,
        retry: savedRetry, message: 'The update outcome could not be confirmed. Choose Retry update or Refresh activity.' });
    }
  }

  private beginCommand(scope: EmployeeScope, projection: ActivityProjection | null, message: string): void {
    this.commandAbort?.abort();
    this.commandAbort = new AbortController();
    this.commandGeneration += 1;
    const saved = this.snapshot();
    this.setSnapshot({ ...saved, scopeKey: keyOf(scope), phase: projection ? 'ready' : saved.phase, pending: true, message });
  }

  private finishCommandFailure(scope: EmployeeScope, failure: ActivityFailure, retry: PendingRetry | null): void {
    this.commandAbort = undefined;
    const key = keyOf(scope);
    if (failure.status === 'authentication-required' || failure.status === 'forbidden' || failure.status === 'refused' || failure.status === 'stale-run') {
      this.applyReadFailure(key, failure, null);
      return;
    }
    if (failure.status === 'conflict' || failure.status === 'stale-version') {
      this.setSnapshot({ ...this.snapshot(), pending: false, phase: 'loading', projection: null, offerDisplay: null, retry: null,
        message: 'Buddy changed. Showing current status.' });
      void this.load(scope, 'Buddy changed. Showing current status.');
      return;
    }
    this.setSnapshot({ ...this.snapshot(), phase: 'unavailable', projection: null, offerDisplay: null, pending: false, retry,
      message: 'Current Buddy status is unavailable. Refresh activity before trying again.' });
  }

  private operationApplied(projection: ActivityProjection, operation: BuddyOperation): boolean {
    if (operation === 'engage') return engaged(projection);
    return projection.permission?.searchConsent === true && projection.permission.holdConsent === true && projection.permission.paused === true;
  }

  private isCurrentScope(scope: EmployeeScope): boolean {
    const current = this.scope();
    return !this.disposed && !!current && sameScope(current, scope);
  }

  private isCurrentRead(generation: number, controller: AbortController, scope: EmployeeScope): boolean {
    return !this.disposed && generation === this.readGeneration && this.readAbort === controller && !controller.signal.aborted && this.isCurrentScope(scope);
  }

  private isCurrentCommand(generation: number, controller: AbortController, scope: EmployeeScope): boolean {
    return !this.disposed && generation === this.commandGeneration && this.commandAbort === controller && !controller.signal.aborted && this.isCurrentScope(scope);
  }

  private cancelPending(): void {
    this.readGeneration += 1;
    this.commandGeneration += 1;
    this.readAbort?.abort();
    this.commandAbort?.abort();
    this.readAbort = undefined;
    this.commandAbort = undefined;
  }

  private setSnapshot(value: ActivitySnapshot): void {
    if (!this.disposed) this.snapshot.set(value);
  }
}
