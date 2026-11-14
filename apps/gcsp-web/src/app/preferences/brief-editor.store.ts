import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { BriefClient, BriefConfirmInput, BriefDraftInput, BriefPreferencesInput, BriefVersionCommand } from './brief.client';
import { AccountPreferenceCategoryState, BriefEditor, BriefEngagementValue, BriefFailure, BriefPreferenceSaveValue, BriefPreview, BriefResult, BriefValue, BuddyCommandAction, EditableBrief, EditablePreference } from './brief.types';

type Changes = BriefPreferencesInput['changes'];
type Change = Changes[string];
const copy = <T>(v: T): T => structuredClone(v);
const has = (v: Changes): boolean => Object.keys(v).length > 0;
const fold = (older: Changes, newer: Changes): Changes => {
  const next = { ...older };
  for (const [key, change] of Object.entries(newer)) next[key] = change === null || !Object.hasOwn(older, key)
    ? change : older[key] === null ? { importance: 'medium', ...change } : { ...older[key], ...change };
  return next;
};
const empty = (): EditableBrief => ({ schemaVersion: 1, preferences: {}, essentials: {} });

@Injectable({ providedIn: 'root' })
export class BriefEditorStore {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(BriefClient);
  readonly scope = computed(() => {
    const state = this.auth.state();
    return state.status === 'ready' && state.context.roles.includes('employee') && state.context.employeeId
      ? JSON.stringify([state.context.subject, state.context.environmentId, state.context.runId, state.context.employeeId]) : null;
  });
  private readonly owner = signal<string | null>(null);
  private readonly resource = signal<BriefEditor | null>(null);
  readonly editor = computed(() => this.owner() === this.scope() && this.scope() ? this.resource() : null);
  readonly loading = signal(false);
  readonly failure = signal<BriefFailure | null>(null);
  readonly message = signal('');
  readonly fullMessage = signal('');
  readonly categories = signal<Readonly<Record<string, AccountPreferenceCategoryState>>>({});
  readonly brief = signal<EditableBrief>(empty());
  readonly rating = signal<{ contractId: string; value: number | null } | null>(null);
  readonly sameAgain = signal(false);
  readonly briefVersion = signal(0);
  readonly draftVersion = signal(0);
  readonly saving = signal(false);
  readonly buddyPendingAction = signal<BuddyCommandAction | null>(null);
  readonly buddyFailure = signal<BriefFailure | null>(null);
  readonly buddyMessage = signal('');
  readonly buddyOperationId = signal<string | null>(null);
  readonly buddyRefreshing = signal(false);
  readonly queueNeedsReview = signal(false);
  readonly buddyBusy = computed(() => this.buddyPendingAction() !== null || this.buddyRefreshing());
  private readonly buddyRetryCommand = signal<{ action: BuddyCommandAction; input: BriefVersionCommand } | null>(null);
  readonly buddyResolutionRequired = computed(() => this.buddyBusy() || this.buddyRetryCommand() !== null
    || ['stale-version', 'conflict', 'stale-run', 'unauthenticated', 'access-required', 'denied', 'not-found', 'pending'].includes(this.buddyFailure()?.status ?? ''));
  readonly buddyCanRetry = computed(() => this.buddyFailure()?.status === 'unavailable' && this.buddyRetryCommand() !== null);
  readonly fullDirty = signal(false);
  readonly fullBusy = signal(false);
  private canonicalRecordsDirty = false;
  readonly fullState = signal<'idle' | 'draft-saved' | 'saving' | 'saved' | 'failed'>('idle');
  readonly preview = signal<BriefResult<BriefPreview> | null>(null);
  readonly previewLoading = signal(false);
  readonly consent = signal({ search: false, hold: false });
  readonly pendingRemoval = signal<string | null>(null);
  readonly openCategory = signal<string | null>(null);
  readonly locked = computed(() => !this.editor() || this.loading() || this.buddyRefreshing() || this.editor()?.selection?.state === 'accepted'
    || ['stale-version', 'conflict', 'stale-run', 'unauthenticated', 'access-required', 'denied', 'not-found'].includes(this.failure()?.status ?? '')
    || ['stale-version', 'conflict', 'stale-run', 'unauthenticated', 'access-required', 'denied', 'not-found', 'pending'].includes(this.buddyFailure()?.status ?? ''));
  readonly queuePending = computed(() => this.saving() || this.queueDirty());
  readonly queueBusy = computed(() => this.queuePending() || !!this.failure());
  private readonly fullTouched = new Set<string>();
  private readonly fullEssentialsTouched = new Set<string>();
  private readonly queueDirty = signal(false);
  readonly understanding = computed(() => {
    const editor = this.editor(); if (!editor) return null;
    const policy = editor.context.accountPreferences.understanding;
    const considered = editor.context.accountPreferences.order.filter((key) => this.categories()[key]?.state === 'considered').length;
    const pending = this.queueDirty() || this.saving();
    return { value: pending ? this.sameAgain() ? policy.sameAgain : policy.byConsidered[considered] : this.confirmedScore(), maximum: policy.maximum, pending };
  });
  private readonly confirmedScore = signal(0);
  private confirmed: Readonly<Record<string, AccountPreferenceCategoryState>> = {};
  private savedRating: { contractId: string; value: number | null } | null = null;
  private savedSame = false;
  private pending: Changes = {};
  private ratingIntent: BriefPreferencesInput['currentCarRating'];
  private sameIntent: BriefPreferencesInput['sameAgain'];
  private failedCommand: BriefPreferencesInput | null = null;
  private fullCommand: { draft: BriefDraftInput; confirm: BriefConfirmInput | null; edit: number; consent: { search: boolean; hold: boolean } } | null = null;
  private controller = new AbortController();
  private epoch = 0;
  private edit = 0;
  private previewEpoch = 0;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.epoch++; this.controller.abort(); });
    effect(() => { const scope = this.scope(); untracked(() => { this.reset(); if (scope) void this.load(); }); });
  }
  private reset(): void {
    this.epoch++; this.controller.abort(); this.controller = new AbortController(); this.previewEpoch++; this.owner.set(null); this.resource.set(null); this.loadPromise = null;
    this.loading.set(false); this.saving.set(false); this.fullBusy.set(false); this.canonicalRecordsDirty = false; this.pending = {}; this.ratingIntent = undefined; this.sameIntent = undefined;
    this.failedCommand = null; this.fullCommand = null; this.fullTouched.clear(); this.fullEssentialsTouched.clear(); this.queueDirty.set(false); this.categories.set({}); this.brief.set(empty());
    this.buddyPendingAction.set(null); this.buddyFailure.set(null); this.buddyMessage.set(''); this.buddyOperationId.set(null); this.buddyRefreshing.set(false);
    this.buddyRetryCommand.set(null); this.queueNeedsReview.set(false);
    this.rating.set(null); this.savedRating = null; this.sameAgain.set(false); this.savedSame = false; this.confirmed = {}; this.confirmedScore.set(0); this.briefVersion.set(0); this.draftVersion.set(0); this.consent.set({ search: false, hold: false }); this.edit = 0; this.failure.set(null); this.message.set(''); this.fullMessage.set(''); this.fullDirty.set(false);
    this.fullState.set('idle'); this.preview.set(null); this.previewLoading.set(false); this.pendingRemoval.set(null); this.openCategory.set(null);
  }
  private live(epoch: number, scope: string | null): boolean { return epoch === this.epoch && !!scope && scope === this.scope(); }
  async load(): Promise<void> {
    if (!this.scope()) return;
    if (this.loadPromise) return this.loadPromise;
    if (this.editor()) return;
    const epoch = this.epoch; const scope = this.scope(); this.loading.set(true);
    const operation = (async () => {
      const result = await this.client.readEditor({ signal: this.controller.signal, expectedContextKey: scope! }); if (!this.live(epoch, scope)) return;
      this.loading.set(false);
      if (result.status !== 'ok') { this.failure.set(result); this.message.set('Your preferences could not be loaded. Try again.'); return; }
      const value = copy(result.value); this.owner.set(scope); this.resource.set(value);
      this.brief.set(copy(value.initial.brief)); this.categories.set(copy(value.initial.accountPreferences.categories));
      this.confirmed = copy(value.initial.accountPreferences.categories); this.confirmedScore.set(value.initial.accountPreferences.understanding.value);
      this.savedRating = copy(value.initial.currentCarRating); this.rating.set(copy(this.savedRating));
      this.savedSame = value.initial.sameAgain.on; this.sameAgain.set(this.savedSame);
      this.briefVersion.set(value.initial.briefVersion); this.draftVersion.set(value.initial.draftVersion);
      const on = (value.initial.buddy.state === 'engaged' || value.initial.buddy.reason === 'paused')
        && value.initial.consent.search && value.initial.consent.hold;
      this.consent.set({ search: on, hold: on }); this.failure.set(null); this.message.set(value.selection?.state === 'accepted'
        ? 'Your buddy found your car, so your preferences can no longer be changed.' : 'Preferences save automatically.');
    })();
    this.loadPromise = operation;
    try { await operation; } finally { if (epoch === this.epoch) this.loadPromise = null; }
  }
  async reload(): Promise<void> { this.reset(); await this.load(); }
  buddyBlockedReason(): string | null {
    if (!this.editor()) return this.loading() ? 'Loading your saved Buddy status.' : 'Buddy status is unavailable. Reload to try again.';
    if (this.editor()?.selection?.state === 'accepted') return 'Your buddy found your car, so preferences can no longer be changed.';
    if (this.locked()) return 'Reload your saved preferences before changing Buddy.';
    if (this.buddyBusy()) return this.buddyMessage() || 'Wait for the Buddy request to finish.';
    if (this.buddyRetryCommand()) return 'Retry or reload the previous Buddy request before starting another.';
    if (this.buddyFailure() && this.buddyResolutionRequired()) return 'Reload saved Buddy status before changing it again.';
    if (this.queueBusy()) return 'Wait for your preference changes to save before changing Buddy.';
    if (this.fullBusy() || this.fullDirty()) return 'Save your preference changes before changing Buddy.';
    return null;
  }

  async runBuddyCommand(action: BuddyCommandAction): Promise<void> {
    if (this.buddyBlockedReason()) return;
    const buddy = this.editor()?.initial.buddy;
    if (!buddy) { this.buddyFailure.set({ status: 'unavailable', retryable: true }); this.buddyMessage.set('Buddy status is unavailable. Reload to try again.'); return; }
    if (action === 'engage') {
      if (buddy.state !== 'disengaged' || buddy.reason === 'paused') return;
      if (buddy.remaining > 0) {
        this.buddyFailure.set({ status: 'invalid', code: 'engagement-minimum', remaining: buddy.remaining, considered: buddy.considered, minimumCategories: buddy.minimumCategories, retryable: false });
        this.buddyMessage.set(this.minimumMessage(buddy.remaining)); return;
      }
      if (!buddy.canEngage) return;
    } else if (action === 'pauseSearch' && buddy.state !== 'engaged') return;
    else if (action === 'resumeSearch' && !(buddy.state === 'disengaged' && buddy.reason === 'paused')) return;
    else if (action === 'disengage' && !(buddy.state === 'engaged' || buddy.state === 'disengaged' && buddy.reason === 'paused')) return;
    await this.sendBuddyCommand(action);
  }

  retryBuddy(): void {
    const retry = this.buddyRetryCommand();
    if (!retry || this.locked() || this.buddyBusy()) return;
    if (retry.input.expectedBriefVersion !== this.briefVersion() || retry.input.expectedDraftVersion !== this.draftVersion()) {
      this.buddyRetryCommand.set(null); this.buddyFailure.set({ status: 'stale-version', action: 'refresh' });
      this.buddyMessage.set('Buddy status changed. Reload saved status to review it. Your edits are kept.'); return;
    }
    void this.sendBuddyCommand(retry.action, retry.input);
  }

  async reloadBuddyStatus(): Promise<void> {
    const scope = this.scope();
    if (!scope) { await this.load(); return; }
    if (this.buddyBusy() || this.fullBusy() || this.saving()) return;
    const epoch = this.epoch;
    const previousChoice = copy(this.consent());
    const previousBrief = copy(this.brief()); const previousFullDirty = this.fullDirty(); const previousFullMessage = this.fullMessage();
    const previousFullTouched = [...this.fullTouched]; const previousEssentialsTouched = [...this.fullEssentialsTouched];
    const previousCategories = copy(this.categories());
    const pending = copy(this.pending); const ratingIntent = this.ratingIntent; const sameIntent = this.sameIntent;
    this.buddyRefreshing.set(true); this.buddyMessage.set('Refreshing saved Buddy status.');
    const result = await this.client.readEditor({ signal: this.controller.signal, expectedContextKey: scope });
    if (!this.live(epoch, scope)) return;
    this.buddyRefreshing.set(false);
    if (result.status !== 'ok') {
      this.buddyFailure.set(result);
      this.buddyMessage.set(['unauthenticated', 'access-required'].includes(result.status)
        ? 'Sign in again, then reload Buddy status. No request was repeated.'
        : 'Buddy status could not be refreshed. Your edits are kept. Try again or reload preferences.');
      return;
    }
    const latest = copy(result.value); const initial = latest.initial;
    const serverChoice = (initial.buddy.state === 'engaged' || initial.buddy.reason === 'paused')
      && initial.consent.search && initial.consent.hold;
    this.owner.set(scope); this.resource.set(latest);
    const refreshedBrief: EditableBrief = { ...copy(initial.brief),
      preferences: { ...initial.brief.preferences, ...Object.fromEntries(previousFullTouched.filter((key) => previousBrief.preferences[key]).map((key) => [key, previousBrief.preferences[key]])) },
      essentials: { ...initial.brief.essentials, ...Object.fromEntries(previousEssentialsTouched.filter((key) => previousBrief.essentials[key]).map((key) => [key, previousBrief.essentials[key]])) } };
    this.brief.set(refreshedBrief); this.confirmed = copy(initial.accountPreferences.categories);
    this.fullTouched.clear(); previousFullTouched.forEach((key) => this.fullTouched.add(key));
    this.fullEssentialsTouched.clear(); previousEssentialsTouched.forEach((key) => this.fullEssentialsTouched.add(key));
    this.confirmedScore.set(initial.accountPreferences.understanding.value);
    this.categories.set({ ...copy(initial.accountPreferences.categories), ...Object.fromEntries(Object.keys(pending).map((key) => [key, previousCategories[key] ?? { state: 'unset' as const }])) });
    this.savedRating = copy(initial.currentCarRating); this.rating.set(ratingIntent ? { contractId: ratingIntent.contractId, value: ratingIntent.value } : copy(this.savedRating));
    this.savedSame = initial.sameAgain.on; this.sameAgain.set(sameIntent?.on ?? this.savedSame);
    this.briefVersion.set(initial.briefVersion); this.draftVersion.set(initial.draftVersion);
    this.consent.set(previousFullDirty ? previousChoice : { search: serverChoice, hold: serverChoice });
    this.pending = pending; this.ratingIntent = ratingIntent; this.sameIntent = sameIntent;
    this.queueDirty.set(has(pending) || !!ratingIntent || !!sameIntent); this.queueNeedsReview.set(this.queueDirty());
    this.canonicalRecordsDirty = false; this.buddyRetryCommand.set(null); this.buddyFailure.set(null); this.buddyOperationId.set(null);
    this.failedCommand = null; this.fullCommand = null; this.failure.set(null);
    this.fullDirty.set(previousFullDirty); this.fullState.set('idle');
    this.fullMessage.set(previousFullDirty
      ? 'Your edits and Buddy choice are kept as an unsaved preference. Review and save them to apply.' : previousFullMessage);
    for (const key of Object.keys(pending)) this.mirror(key);
    this.buddyMessage.set(latest.selection?.state === 'accepted'
      ? 'Your buddy found your car. Saved Buddy status is refreshed and your edits are kept.'
      : this.queueNeedsReview() ? 'Saved Buddy status is refreshed. Your preference edits are kept for review.'
        : previousFullDirty ? this.fullMessage() : 'Saved Buddy status refreshed.');
  }

  private minimumMessage(remaining: number): string { return `Choose ${remaining} more ${remaining === 1 ? 'category' : 'categories'} to engage Buddy. Your preferences save automatically.`; }

  private async sendBuddyCommand(action: BuddyCommandAction, retryInput?: BriefVersionCommand): Promise<void> {
    const scope = this.scope(); if (!scope || !this.editor()) return;
    const epoch = this.epoch;
    let input = retryInput;
    if (!input) {
      try { input = { commandId: `buddy:${crypto.randomUUID()}`, expectedBriefVersion: this.briefVersion(), expectedDraftVersion: this.draftVersion() }; }
      catch { this.buddyFailure.set({ status: 'unavailable', retryable: true }); this.buddyMessage.set('Buddy request could not be prepared. Reload saved status to try again.'); return; }
    }
    this.buddyRetryCommand.set(null); this.buddyFailure.set(null); this.buddyOperationId.set(null); this.buddyPendingAction.set(action);
    this.buddyMessage.set(({ engage: 'Engaging Buddy.', pauseSearch: 'Pausing search.', resumeSearch: 'Resuming search.', disengage: 'Disengaging Buddy.' })[action]);
    const options = { signal: this.controller.signal, expectedContextKey: scope };
    let result: BriefResult<BriefEngagementValue>;
    if (action === 'engage') result = await this.client.engage(input, options);
    else if (action === 'pauseSearch') result = await this.client.pauseSearch(input, options);
    else if (action === 'resumeSearch') result = await this.client.resumeSearch(input, options);
    else result = await this.client.disengage(input, options);
    if (!this.live(epoch, scope)) return;
    this.buddyPendingAction.set(null);
    if (result.status === 'ok') {
      const target = result.value.buddy;
      const matches = action === 'engage' || action === 'resumeSearch' ? target.state === 'engaged' && target.reason === null
        : action === 'pauseSearch' ? target.state === 'disengaged' && target.reason === 'paused'
          : target.state === 'disengaged' && target.reason !== 'paused';
      if (matches && result.value.briefVersion > input.expectedBriefVersion && result.value.draftVersion >= input.expectedDraftVersion) {
        this.adoptBuddyResult(result.value, action);
        this.queueNeedsReview.set(false);
        if (this.queueDirty()) void this.flush();
        return;
      }
      this.handleBuddyFailure({ status: 'unavailable', code: 'invalid-engagement-response', retryable: true }, action, input);
      return;
    }
    this.handleBuddyFailure(result, action, input);
  }

  private adoptBuddyResult(value: BriefEngagementValue, action: BuddyCommandAction): void {
    const on = action === 'engage' || action === 'resumeSearch' ? true : action === 'disengage' ? false : null;
    this.briefVersion.set(value.briefVersion); this.draftVersion.set(value.draftVersion);
    this.resource.update((editor) => editor && ({ ...editor, initial: { ...editor.initial, briefVersion: value.briefVersion,
      draftVersion: value.draftVersion, buddy: copy(value.buddy), consent: on === null ? editor.initial.consent : { search: on, hold: on } } }));
    if (on !== null) this.consent.set({ search: on, hold: on });
    this.canonicalRecordsDirty = true; this.buddyRetryCommand.set(null); this.buddyFailure.set(null); this.buddyOperationId.set(null);
    this.buddyMessage.set(action === 'engage' ? 'Buddy engaged. Your preferences will guide the search.'
      : action === 'pauseSearch' ? 'Search paused. New searches and holds have stopped. Any held offer stays open until its deadline.'
        : action === 'resumeSearch' ? 'Search resumed. Buddy will use your saved preferences.' : 'Buddy disengaged. Your preferences are kept.');
  }

  private handleBuddyFailure(failure: BriefFailure, action: BuddyCommandAction, input: BriefVersionCommand): void {
    this.buddyFailure.set(failure); this.buddyOperationId.set(failure.status === 'pending' ? failure.operationId ?? null : null);
    if (failure.status === 'unavailable') this.buddyRetryCommand.set({ action, input: copy(input) });
    else this.buddyRetryCommand.set(null);
    if (failure.buddy) this.resource.update((editor) => editor && ({ ...editor, initial: { ...editor.initial, buddy: copy(failure.buddy!) } }));
    if (failure.status === 'invalid' && failure.code === 'engagement-minimum' && failure.remaining !== undefined) {
      if (!failure.buddy) this.resource.update((editor) => editor && ({ ...editor, initial: { ...editor.initial, buddy: {
        ...editor.initial.buddy, remaining: failure.remaining!, ...(failure.considered === undefined ? {} : { considered: failure.considered }),
        ...(failure.minimumCategories === undefined ? {} : { minimumCategories: failure.minimumCategories }),
      } } }));
      this.buddyMessage.set(this.minimumMessage(failure.remaining));
    } else if (failure.status === 'pending') {
      this.buddyMessage.set(`${failure.operationId ? `Request ${failure.operationId}` : 'Buddy request'} is still pending. Reload saved status to check the result.`);
    } else if (failure.status === 'conflict' && failure.reason === 'brief-read-only') {
      this.buddyMessage.set('Your buddy found your car, so preferences can no longer be changed. Reload saved status to review it.');
    } else if (['stale-version', 'conflict'].includes(failure.status)) {
      this.buddyMessage.set('Buddy status changed. Reload to review the saved state. Your edits are kept.');
    } else if (['unauthenticated', 'access-required'].includes(failure.status)) {
      this.buddyMessage.set('Sign in again, then reload Buddy status. No request was repeated.');
    } else if (failure.status === 'stale-run') {
      this.buddyMessage.set('This session has changed. Reload Buddy status before continuing.');
    } else if (failure.status === 'denied' || failure.status === 'forbidden') {
      this.buddyMessage.set('You cannot change Buddy in this session. Reload saved status to continue.');
    } else if (failure.status === 'unavailable') {
      this.buddyMessage.set('Buddy was not confirmed. Retry the same request or reload saved status.');
    } else {
      this.buddyMessage.set('Buddy could not be changed. Reload saved status to review it.');
    }
    this.message.set(this.buddyMessage());
  }

  category(key: string): AccountPreferenceCategoryState { return this.categories()[key] ?? { state: 'unset' }; }
  open(key: string): void {
    if (this.locked() || this.sameAgain() || this.fullBusy()) return;
    const category = this.editor()?.context.accountPreferences.categories[key]; if (!category) return;
    this.openCategory.set(this.openCategory() === key ? null : key); this.pendingRemoval.set(null);
    if (category.kind === 'stops' && this.category(key).state === 'unset') this.change(key, { value: category.openDefault });
  }
  change(key: string, change: Exclude<Change, null>): void {
    if (this.locked() || this.sameAgain() || this.fullBusy()) return;
    const definition = this.editor()?.context.accountPreferences.categories[key]; if (!definition) return;
    const previous = this.category(key); const fresh = previous.state === 'unset';
    if (change.value !== undefined) {
      if (definition.kind === 'multi') {
        if (!Array.isArray(change.value) || !change.value.every((v) => definition.options.some((o) => o.value === v))) return;
        if (!change.value.length) { this.remove(key); return; }
      } else if (!definition.stops.some((s) => s.value === change.value)) return;
      this.categories.update((values) => ({ ...values, [key]: { state: 'considered', value: copy(change.value!), importance: fresh ? 'medium' : previous.importance, exact: true } }));
      this.stage(key, { value: copy(change.value), ...(fresh ? { importance: 'medium' as const } : {}) });
    } else if (change.importance && !fresh) {
      this.categories.update((values) => ({ ...values, [key]: { ...previous, importance: change.importance! } })); this.stage(key, { importance: change.importance });
    }
  }
  requestRemove(key: string): void { if (!this.locked() && !this.sameAgain() && this.category(key).state === 'considered') { this.pendingRemoval.set(key); this.openCategory.set(null); } }
  keep(): void { this.pendingRemoval.set(null); }
  confirmRemove(key: string): void { if (this.pendingRemoval() === key && !this.locked() && !this.sameAgain()) { this.pendingRemoval.set(null); this.remove(key); } }
  private remove(key: string): void { this.categories.update((values) => ({ ...values, [key]: { state: 'unset' } })); this.stage(key, null); }
  rate(value: number | null, contractId: string): void {
    const rating = this.rating(); if (this.locked() || this.fullBusy() || rating?.contractId !== contractId || !(value === null || Number.isInteger(value) && value >= 1 && value <= 5)) return;
    this.rating.set({ value, contractId }); this.ratingIntent = { value, contractId }; this.dirtyQueue();
  }
  toggleSameAgain(on: boolean): void {
    const same = this.editor()?.initial.sameAgain; if (!same?.available || !same.contractId || this.locked() || this.fullBusy()) return;
    this.sameAgain.set(on); this.sameIntent = { contractId: same.contractId, on }; this.openCategory.set(null); this.pendingRemoval.set(null); this.dirtyQueue();
  }
  private stage(key: string, change: Change): void { this.fullTouched.delete(key); this.pending = fold(this.pending, { [key]: change }); this.mirror(key); this.dirtyQueue(); }
  private mirror(key: string): void {
    const state = this.category(key); const next = { ...this.brief().preferences }; const policy = this.editor()!.context.accountPreferences;
    if (state.state === 'considered') next[key] = { value: state.value as EditablePreference['value'], importance: policy.importance[state.importance], valueState: 'draft', importanceState: 'draft', source: 'employee' };
    else if (next[key]) next[key] = { ...next[key], importance: this.editor()!.context.slider.minimum, importanceState: 'draft', source: 'employee' };
    this.brief.update((brief) => ({ ...brief, preferences: next }));
  }
  private dirtyQueue(): void { this.queueNeedsReview.set(false); this.queueDirty.set(true); this.message.set(this.failure() ? 'Your changes are not saved. Try again or reload.' : 'Saving your preferences.'); void this.flush(); }
  private versions() { return { expectedBriefVersion: this.briefVersion(), expectedDraftVersion: this.draftVersion() }; }
  private commandId(kind: string): string { return `${kind}:${crypto.randomUUID()}`; }
  private async flush(retry = false): Promise<void> {
    if (this.locked() || this.saving() || this.failure() || this.fullBusy() || this.buddyResolutionRequired() || this.queueNeedsReview() || !this.queueDirty()) return;
    const epoch = this.epoch; const scope = this.scope();
    let body: BriefPreferencesInput = { commandId: this.commandId('preferences'), ...this.versions(), changes: copy(this.pending),
      ...(this.ratingIntent ? { currentCarRating: copy(this.ratingIntent) } : {}), ...(this.sameIntent ? { sameAgain: copy(this.sameIntent) } : {}) };
    // The server refuses categories while Same again is saved on; an explicit off precedes the newest on.
    if (this.savedSame && has(body.changes) && body.sameAgain?.on) { this.sameIntent = body.sameAgain; body = { ...body, sameAgain: { ...body.sameAgain, on: false } }; }
    else this.sameIntent = undefined;
    const semantic = (v: BriefPreferencesInput) => JSON.stringify({ ...v, commandId: '' });
    const sent = retry && this.failedCommand && semantic(body) === semantic(this.failedCommand) ? this.failedCommand : body;
    this.pending = {}; this.ratingIntent = undefined; this.saving.set(true); this.message.set('Saving your preferences.');
    const outcome = await this.client.savePreferences(sent, { signal: this.controller.signal, expectedContextKey: scope! }); if (!this.live(epoch, scope)) return;
    this.saving.set(false);
    if (outcome.status === 'ok' && this.matches(outcome.value, sent)) {
      const value = outcome.value; this.briefVersion.set(value.briefVersion); this.draftVersion.set(value.draftVersion);
      this.confirmed = copy(value.accountPreferences.categories); this.confirmedScore.set(value.accountPreferences.understanding.value);
      this.categories.update((current) => Object.fromEntries(this.editor()!.context.accountPreferences.order.map((key) => [key, Object.hasOwn(this.pending, key) ? current[key] : this.confirmed[key] ?? { state: 'unset' }])));
      for (const key of Object.keys(sent.changes)) if (!Object.hasOwn(this.pending, key)) this.mirror(key);
      this.savedRating = copy(value.currentCarRating); if (!this.ratingIntent) this.rating.set(copy(this.savedRating));
      this.savedSame = value.sameAgain.on; if (!this.sameIntent) this.sameAgain.set(this.savedSame);
      const heldConsent = value.buddy.state === 'engaged' || value.buddy.reason === 'paused';
      const savedConsent = { search: heldConsent, hold: heldConsent };
      this.resource.update((editor) => editor && ({ ...editor, initial: { ...editor.initial, briefVersion: value.briefVersion, draftVersion: value.draftVersion,
        buddy: value.buddy, consent: savedConsent, sameAgain: value.sameAgain, currentCarRating: value.currentCarRating } }));
      if (!this.fullDirty()) this.consent.set(savedConsent);
      this.canonicalRecordsDirty = true;
      this.failedCommand = null; this.failure.set(null); this.message.set('Preferences saved automatically.');
      if (value.buddyTransition === 'minimum-lost') this.message.set(`Preferences saved. Buddy disengaged: choose at least ${value.buddy.minimumCategories} categories to engage again.`);
      if (this.buddyFailure()?.code === 'engagement-minimum') this.buddyFailure.set(null);
    } else {
      const failure: BriefFailure = outcome.status === 'ok' ? { status: 'unavailable', code: 'invalid-brief-response', retryable: true } : outcome;
      if (['invalid', 'forbidden'].includes(failure.status)) {
        for (const key of Object.keys(sent.changes)) if (!Object.hasOwn(this.pending, key)) { this.categories.update((values) => ({ ...values, [key]: this.confirmed[key] ?? { state: 'unset' } })); this.mirror(key); }
        if (sent.currentCarRating && !this.ratingIntent) this.rating.set(copy(this.savedRating));
        if (sent.sameAgain && !this.sameIntent) this.sameAgain.set(this.savedSame);
        this.message.set('That change could not be saved. Your last saved answer is shown.');
      } else {
        this.pending = fold(sent.changes, this.pending); this.ratingIntent ??= sent.currentCarRating; this.sameIntent ??= sent.sameAgain;
        this.failedCommand = sent; this.fail(failure);
      }
    }
    this.queueDirty.set(has(this.pending) || !!this.ratingIntent || !!this.sameIntent);
    if (!this.failure()) void this.flush();
  }
  private matches(value: BriefPreferenceSaveValue, sent: BriefPreferencesInput): boolean {
    return value.briefVersion >= sent.expectedBriefVersion && value.draftVersion >= sent.expectedDraftVersion
      && (!sent.currentCarRating || value.currentCarRating?.contractId === sent.currentCarRating.contractId)
      && (!sent.sameAgain || value.sameAgain.contractId === sent.sameAgain.contractId);
  }
  private fail(failure: BriefFailure): void {
    this.failure.set(failure);
    this.message.set(failure.reason === 'brief-read-only' ? 'Your buddy found your car, so your preferences can no longer be changed.'
      : ['stale-version', 'conflict'].includes(failure.status) ? 'Your preferences changed elsewhere. Reload to see the latest. Your edits are kept until then.'
        : ['unauthenticated', 'access-required'].includes(failure.status) ? 'Sign in again, then reload and review your preferences. Your changes are not confirmed.'
          : failure.status === 'stale-run' ? 'This session has changed. Reload to read the current preferences.' : 'Your changes are not confirmed as saved. Try again or reload.');
  }
  retry(): void {
    if (this.buddyRetryCommand()) { this.retryBuddy(); return; }
    if (this.queueNeedsReview()) { this.queueNeedsReview.set(false); void this.flush(); return; }
    if (this.locked() || !this.failure()) return;
    this.failure.set(null); if (this.fullCommand) void this.saveFull(true); else void this.flush(true);
  }
  updatePreference(key: string, patch: Partial<Pick<EditablePreference, 'value' | 'importance'>>): void {
    const context = this.editor()?.context; const definition = context?.preferences[key]; const previous = this.brief().preferences[key];
    if (!context || !definition?.editable || this.locked() || this.queuePending() || this.buddyResolutionRequired() || !previous && patch.value === undefined) return;
    const value = patch.value; if (value !== undefined && (definition.type === 'slider' ? !Number.isInteger(value) || Number(value) < context.slider.minimum || Number(value) > context.slider.maximum
      : definition.type === 'enum' && !(definition.multiple && Array.isArray(value) ? value.length > 0 && value.every((v) => definition.values?.includes(v)) : definition.values?.includes(value as BriefValue)))) return;
    if (patch.importance !== undefined && (!Number.isInteger(patch.importance) || patch.importance < context.slider.minimum || patch.importance > context.slider.maximum)) return;
    this.brief.update((brief) => ({ ...brief, preferences: { ...brief.preferences, [key]: { ...(previous ?? { importance: context.accountPreferences.importance.medium, valueState: 'draft' as const, importanceState: 'draft' as const }), ...patch, source: 'employee',
      ...(patch.value === undefined ? {} : { valueState: 'draft' as const }), ...(patch.importance === undefined ? {} : { importanceState: 'draft' as const }), confirmedAt: undefined } } })); this.fullTouched.add(key); this.edited();
  }
  updateEssential(key: string, value: BriefValue): void {
    const definition = this.editor()?.context.essentials[key]; if (!definition?.editable || this.locked() || this.queuePending() || this.buddyResolutionRequired()) return;
    this.brief.update((brief) => ({ ...brief, essentials: { ...brief.essentials, [key]: { value: copy(value), operator: definition.operator, unit: definition.unit, state: value === null ? 'needs-confirmation' : 'draft', source: 'employee' } } })); this.fullEssentialsTouched.add(key); this.edited();
  }
  setConsent(on: boolean): void { if (!this.locked() && !this.queuePending() && !this.buddyResolutionRequired()) { this.consent.set({ search: on, hold: on }); this.edited(); } }
  private edited(): void { this.fullMessage.set('Unsaved changes. Review and save your preferences.'); this.failure.set(null); this.edit++; this.fullDirty.set(true); this.fullState.set('idle'); this.fullCommand = null; this.previewEpoch++; this.previewLoading.set(false); this.preview.set(null); }
  async requestPreview(): Promise<void> {
    if (this.locked() || this.queueBusy() || this.fullBusy() || this.buddyResolutionRequired()) return;
    const epoch = this.epoch; const scope = this.scope(); const ticket = ++this.previewEpoch; this.previewLoading.set(true);
    const result = await this.client.preview({ kind: 'unsaved-draft', baseBriefVersion: this.briefVersion(), draftVersion: this.draftVersion(), brief: copy(this.brief()) }, { signal: this.controller.signal, expectedContextKey: scope! });
    if (!this.live(epoch, scope) || ticket !== this.previewEpoch) return;
    this.previewLoading.set(false); this.preview.set(result);
    if (result.status !== 'ok' && ['stale-version', 'conflict', 'stale-run', 'unauthenticated', 'access-required'].includes(result.status)) this.fail(result);
  }
  async saveFull(retry = false): Promise<void> {
    if (this.locked() || this.queueBusy() || this.fullBusy() || this.buddyResolutionRequired()) return;
    const epoch = this.epoch; const scope = this.scope(); this.fullBusy.set(true);
    if (this.canonicalRecordsDirty) {
      const canonical = await this.client.readEditor({ signal: this.controller.signal, expectedContextKey: scope! }); if (!this.live(epoch, scope)) return;
      if (canonical.status !== 'ok') { this.fullBusy.set(false); this.fail(canonical); return; }
      if (canonical.value.initial.briefVersion !== this.briefVersion() || canonical.value.initial.draftVersion !== this.draftVersion()) { this.fullBusy.set(false); this.fail({ status: 'stale-version' }); return; }
      const source = canonical.value.initial.brief;
      this.brief.update((brief) => ({ ...brief, preferences: { ...source.preferences, ...Object.fromEntries([...this.fullTouched].filter((key) => brief.preferences[key]).map((key) => [key, brief.preferences[key]])) },
        essentials: { ...source.essentials, ...Object.fromEntries([...this.fullEssentialsTouched].filter((key) => brief.essentials[key]).map((key) => [key, brief.essentials[key]])) },
        ...(source.currentCarRating ? { currentCarRating: source.currentCarRating } : {}), ...(source.sameAgain ? { sameAgain: source.sameAgain } : {}) }));
      this.canonicalRecordsDirty = false;
    }
    if (!retry || !this.fullCommand) this.fullCommand = { draft: { commandId: this.commandId('draft'), ...this.versions(), brief: copy(this.brief()) }, confirm: null, edit: this.edit, consent: copy(this.consent()) };
    const command = this.fullCommand; this.fullState.set('saving'); this.fullMessage.set('Saving your preferences.'); this.message.set('Saving your preferences.');
    if (!command.confirm) {
      const draft = await this.client.saveDraft(command.draft, { signal: this.controller.signal, expectedContextKey: scope! }); if (!this.live(epoch, scope)) return;
      if (draft.status !== 'ok') { this.fullBusy.set(false); this.fullState.set('failed'); this.fail(draft); this.fullMessage.set(this.message()); return; }
      if (draft.value.draftVersion <= command.draft.expectedDraftVersion || draft.value.baseBriefVersion !== command.draft.expectedBriefVersion) { this.fullBusy.set(false); this.fullState.set('failed'); this.fail({ status: 'unavailable', retryable: true }); return; }
      this.draftVersion.set(draft.value.draftVersion);
      const promoted = draft.value['confirmed'] as { briefVersion?: number } | undefined;
      if (promoted?.briefVersion !== undefined && Number.isSafeInteger(promoted.briefVersion) && promoted.briefVersion >= this.briefVersion()) this.briefVersion.set(promoted.briefVersion);
      command.confirm = { commandId: this.commandId('confirm'), ...this.versions(), consent: command.consent }; this.fullState.set('draft-saved');
    }
    this.fullState.set('saving'); const confirmed = await this.client.confirm(command.confirm, { signal: this.controller.signal, expectedContextKey: scope! }); if (!this.live(epoch, scope)) return;
    if (confirmed.status !== 'ok') { this.fullBusy.set(false); this.fullState.set('failed'); this.fail(confirmed); this.message.update((message) => `Your draft was saved. Confirmation failed. ${message}`); this.fullMessage.set(this.message()); return; }
    if (confirmed.value.brief.briefVersion <= command.confirm.expectedBriefVersion) { this.fullBusy.set(false); this.fullState.set('failed'); this.fail({ status: 'unavailable', retryable: true }); return; }
    this.briefVersion.set(confirmed.value.brief.briefVersion); this.fullDirty.set(this.edit !== command.edit);
    if (!this.fullDirty()) this.brief.set(copy({ schemaVersion: 1, preferences: confirmed.value.brief.preferences, essentials: confirmed.value.brief.essentials,
      ...(confirmed.value.brief.currentCarFeedback ? { currentCarFeedback: confirmed.value.brief.currentCarFeedback } : {}),
      ...(confirmed.value.brief.currentCarRating ? { currentCarRating: confirmed.value.brief.currentCarRating } : {}), ...(confirmed.value.brief.sameAgain ? { sameAgain: confirmed.value.brief.sameAgain } : {}) }));
    if (!this.fullDirty()) { this.fullTouched.clear(); this.fullEssentialsTouched.clear(); }
    this.fullCommand = null; this.fullState.set('saved'); this.failure.set(null); this.message.set(`Version ${this.briefVersion()} saved.${this.fullDirty() ? ' Newer edits are still unsaved.' : ''}`); this.fullMessage.set(this.message());
    const latest = await this.client.readEditor({ signal: this.controller.signal, expectedContextKey: scope! }); if (!this.live(epoch, scope)) return;
    this.fullBusy.set(false);
    this.fullDirty.set(this.edit !== command.edit);
    const readbackUnavailable = () => {
      this.message.set(`Your preferences were confirmed. Current readback is unavailable. ${['unauthenticated', 'access-required'].includes(this.failure()?.status ?? '') ? 'Sign in again, then refresh and review.' : 'Refresh and review to see the saved preferences.'}${this.fullDirty() ? ' Newer edits are still unsaved.' : ''}`);
      this.fullMessage.set(this.message());
    };
    if (latest.status !== 'ok') { this.fail(latest); readbackUnavailable(); return; }
    const initial = latest.value.initial;
    if (initial.briefVersion < this.briefVersion() || initial.draftVersion < this.draftVersion()) { this.fail({ status: 'unavailable', code: 'invalid-brief-readback', retryable: true }); readbackUnavailable(); return; }
    if (this.fullDirty() && (initial.briefVersion > this.briefVersion() || initial.draftVersion > this.draftVersion())) {
      this.fail({ status: 'stale-version' });
      this.message.set('Your preferences were confirmed. A newer saved version is available. Your newer edits are kept. Refresh and review before saving again.');
      this.fullMessage.set(this.message()); return;
    }
    this.briefVersion.set(initial.briefVersion); this.draftVersion.set(initial.draftVersion);
    if (!this.fullDirty()) { this.brief.set(copy(initial.brief)); this.consent.set(copy(initial.consent)); this.fullTouched.clear(); this.fullEssentialsTouched.clear(); }
    this.message.set(`Your preferences were confirmed. Showing saved version ${initial.briefVersion}.${this.fullDirty() ? ' Newer edits are still unsaved.' : ''}`); this.fullMessage.set(this.message());
    this.resource.set(copy(latest.value)); this.confirmed = copy(latest.value.initial.accountPreferences.categories); this.categories.set(copy(this.confirmed));
    this.confirmedScore.set(latest.value.initial.accountPreferences.understanding.value); this.savedRating = copy(latest.value.initial.currentCarRating); this.rating.set(copy(this.savedRating));
    this.savedSame = latest.value.initial.sameAgain.on; this.sameAgain.set(this.savedSame);
  }
}
