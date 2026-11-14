import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { AccountClient } from './account.client';
import { deriveManualChoices, initialManualChoices, matchesJourney, permittedJourney, sameChoices } from './account-choices.model';
import { AccountFailure, AccountProjection, JourneyIntent, ManualChoices, ManualDraft } from './account.types';

@Component({ selector: 'gcsp-account-choices', imports: [ButtonDirective, ErrorSummaryComponent, LabelledFieldComponent],
  templateUrl: './account-choices.component.html', styleUrl: './account-choices.component.css' })
export class AccountChoicesComponent {
  readonly account = input.required<AccountProjection>();
  readonly savedDraft = input<ManualDraft | null>(null);
  readonly intent = input.required<JourneyIntent>();
  readonly back = output<void>();
  readonly continueToStock = output<void>();
  private readonly client = inject(AccountClient);
  private readonly auth = inject(AuthPort);
  private readonly destroy = inject(DestroyRef);
  readonly projection = signal<AccountProjection | null>(null);
  readonly draft = signal<ManualDraft | null>(null);
  readonly choices = signal<ManualChoices | null>(null);
  readonly model = computed(() => { const account = this.projection(); const choices = this.choices(); return account && choices ? deriveManualChoices(account, choices) : null; });
  readonly busy = signal(false);
  readonly dirty = signal(false);
  readonly reviewRequired = signal(false);
  readonly refreshReady = signal(false);
  readonly failure = signal<AccountFailure | null>(null);
  readonly errors = signal<Readonly<Record<string, string>>>({});
  readonly notice = signal('');
  readonly available = signal(true);
  readonly summary = computed(() => Object.entries(this.errors()).map(([field, message]) => ({ controlId: field === 'context' || field === 'allowance' ? 'choices-heading' : field === 'contact' ? 'choices-phone' : `choices-${field}`, message })));
  private operation = new AbortController();
  private generation = 0;
  private scope: string | null | undefined;
  private refreshedDraft: ManualDraft | null = null;

  constructor() {
    effect(() => {
      const state = this.auth.state();
      const scope = state.status === 'ready' && state.context.roles.includes('employee')
        ? JSON.stringify([state.context.subject, state.context.employeeId, state.context.environmentId, state.context.runId]) : null;
      untracked(() => {
        if (scope === null || this.scope !== undefined && scope !== this.scope) {
          this.cancel(); this.available.set(false); this.projection.set(null); this.draft.set(null); this.choices.set(null); this.refreshedDraft = null;
          this.errors.set({}); this.failure.set(null); this.notice.set('');
        }
        this.scope = scope;
      });
    });
    effect(() => { const account = this.account(); const intent = this.intent(); const draft = this.savedDraft();
      untracked(() => {
        if (!this.available()) return;
        if (this.dirty()) { this.projection.set(account); this.refreshReady.set(false); this.reviewRequired.set(true); return; }
        this.projection.set(account); this.draft.set(draft);
        this.choices.set(initialManualChoices(account, intent, draft)); this.dirty.set(false);
        this.reviewRequired.set(!permittedJourney(account, intent) || !!draft && (!matchesJourney(draft.choices, intent) || !!draft.requiresRefresh || draft.contextVersion !== account.contextVersion));
      });
    });
    this.destroy.onDestroy(() => { this.cancel(); this.projection.set(null); this.draft.set(null); this.choices.set(null); this.refreshedDraft = null; });
  }

  private cancel(): void { this.generation += 1; this.operation.abort(); this.operation = new AbortController(); this.busy.set(false); }
  value(event: Event): string { return (event.target as HTMLInputElement).value; }
  update(field: keyof ManualChoices, value: string | number | null): void {
    if (this.busy() || !this.available() || !this.choices() || !['driverId', 'contractOptionId', 'requestedCollectionDate', 'collectionLocationId', 'brand', 'expectedReturnMileage', 'specialRequirements'].includes(field)) return;
    this.choices.update((current) => current ? { ...current, [field]: value } : null); this.dirty.set(true); this.errors.set({}); this.notice.set('Your choices changed. Availability will be refreshed after saving.');
  }
  updateContact(field: 'phone' | 'email', value: string): void {
    if (this.busy() || !this.available()) return;
    this.choices.update((current) => current ? { ...current, contact: { phone: current.contact?.phone ?? '', email: current.contact?.email ?? '', [field]: value } } : null);
    this.dirty.set(true); this.errors.set({});
  }
  error(field: string): string { return this.errors()[field] ?? ''; }
  private focusErrors(): void { queueMicrotask(() => document.getElementById('choices-panel')?.querySelector<HTMLElement>('.gcsp-error-summary')?.focus()); }
  private rejected(failure: AccountFailure): void {
    this.failure.set(failure);
    this.reviewRequired.set(true); this.refreshReady.set(false);
    const reasons = Array.isArray(failure.reasons) ? failure.reasons : [];
    this.errors.set(Object.fromEntries(reasons.filter((item) => item && typeof item.field === 'string' && typeof item.reason === 'string').map((item) => [item.field, item.reason])));
  }
  failureMessage(): string {
    const status = this.failure()?.status;
    if (status === 'forbidden' || status === 'refused') return 'These choices are not available for your account.';
    if (status === 'authentication-required' || status === 'unauthenticated') return 'Sign in again, then review your saved choices.';
    if (status === 'pending' || status === 'uncertain') return 'Saving is not yet confirmed. Refresh saved choices before continuing.';
    if (status === 'stale-version' || status === 'conflict') return 'Your saved choices or ordering context changed. Refresh and review them.';
    return 'Your choices could not be confirmed. Refresh saved choices before trying again.';
  }

  async refresh(): Promise<void> {
    if (this.busy() || !this.available()) return;
    this.cancel(); const generation = this.generation; const signal = this.operation.signal;
    this.busy.set(true); this.failure.set(null);
    const [account, draft] = await Promise.all([this.client.readAccount({ signal }), this.client.readDraft({ signal })]);
    if (generation !== this.generation || !this.available()) return;
    this.busy.set(false);
    if (account.status !== 'ok' || draft.status !== 'ok' && draft.status !== 'not-found') { this.rejected(account.status !== 'ok' ? account : draft as AccountFailure); return; }
    this.projection.set(account.value); this.refreshedDraft = draft.status === 'ok' ? draft.value : null;
    this.reviewRequired.set(true); this.refreshReady.set(true); this.errors.set({});
    this.notice.set('Saved choices refreshed. Review the current options, then keep your edits or use the saved choices.');
  }
  acceptRefresh(useSaved: boolean): void {
    const account = this.projection(); if (!account || !this.refreshReady() || this.busy() || !this.available() || !permittedJourney(account, this.intent())) return;
    this.draft.set(this.refreshedDraft);
    if (useSaved) { this.choices.set(initialManualChoices(account, this.intent(), this.refreshedDraft)); this.dirty.set(false); }
    this.reviewRequired.set(false); this.refreshReady.set(false); this.failure.set(null); this.errors.set({}); this.notice.set('Review complete. Save your choices to continue.');
  }

  async save(proceed: boolean): Promise<void> {
    const account = this.projection(); const choices = this.choices(); const model = this.model();
    if (this.busy() || !this.available() || !account || !choices || !model) return;
    const errors = { ...model.errors, ...(this.reviewRequired() ? { context: 'Refresh and review your ordering context before saving.' } : {}) };
    this.errors.set(errors); if (Object.keys(errors).length) { this.focusErrors(); return; }
    this.cancel(); const generation = this.generation; const signal = this.operation.signal;
    this.busy.set(true); this.failure.set(null); this.notice.set('Saving your choices');
    const previous = this.draft(); const payload = { commandId: crypto.randomUUID(), expectedDraftVersion: previous?.draftVersion ?? 0,
      expectedContextVersion: account.contextVersion!, choices: structuredClone(choices) };
    const saved = !this.dirty() && previous?.draftStage === 'complete' && sameChoices(previous.choices, choices)
      ? { status: 'ok' as const, value: previous } : await this.client.saveDraft(payload, { signal });
    if (generation !== this.generation || !this.available()) return;
    if (saved.status !== 'ok') { this.busy.set(false); this.rejected(saved); this.notice.set(''); return; }
    if (!sameChoices(saved.value.choices, choices) || saved.value.contextVersion !== account.contextVersion || saved.value.requiresRefresh
      || saved.value.draftStage !== 'complete' || saved.value.draftVersion !== (saved.value === previous ? previous!.draftVersion : payload.expectedDraftVersion + 1)) {
      this.busy.set(false); this.rejected({ status: 'uncertain', code: 'draft-readback-mismatch' }); this.notice.set(''); return;
    }
    this.draft.set(saved.value); this.dirty.set(false); this.errors.set({});
    if (!proceed) { this.busy.set(false); this.notice.set('Your choices are saved.'); this.back.emit(); return; }
    this.notice.set('Checking availability');
    const stock = await this.client.readStock({ signal });
    if (generation !== this.generation || !this.available()) return;
    this.busy.set(false);
    if (stock.status !== 'ok') { this.rejected(stock); this.notice.set(''); return; }
    if (stock.value.versions.draft !== saved.value.draftVersion || stock.value.versions.context !== account.contextVersion) {
      this.rejected({ status: 'stale-version', code: 'availability-context-changed' }); this.notice.set(''); return;
    }
    this.notice.set('Your choices are saved.'); this.continueToStock.emit();
  }
}
