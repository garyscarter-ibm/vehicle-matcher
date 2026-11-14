import { ChangeDetectorRef, Component, computed, effect, ElementRef, inject, OnDestroy, signal, untracked, ViewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthPort } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { AccountOffers, AccountOrders, AccountOrderSnapshot, latestOrder, orderVehicle, placedOrderRecord } from './account.preview';
import { AccountClient } from './account.client';
import { AccountChoicesComponent } from './account-choices.component';
import { contractTerms, journeyIntent, toAccountView } from './account.projection';
import { AccountAction, AccountDriver, AccountFailure, AccountProjection, AccountResult, ContractView, EvidenceRecord, JourneyIntent,
  ManualDraft, NotificationEmail, SaveNotificationEmailCommand } from './account.types';

type Row = { label: string; value: string };
type Notice = { title: string; text: string };
const object = (value: unknown): EvidenceRecord | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as EvidenceRecord : null;
const words = (value: string): string => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
const states: Record<string, Notice> = {
  'absent-hr-account': { title: 'Your HR account is missing', text: 'Contact HR support to check your employee account.' },
  'not-yet-eligible': { title: 'Replacement is not available yet', text: 'Your collection window does not allow a replacement yet.' },
  'ordering-closed': { title: 'Too late to order before renewal', text: 'No collection date fits before your contract ends. Scheme support can help with your renewal.' },
  'no-entitlement': { title: 'No ordering entitlement', text: 'Scheme support can check your entitlement.' },
  'unsupported-scheme': { title: 'Ordering is not supported for this scheme', text: '' },
  'no-contract': { title: 'Your current contract is missing', text: 'Scheme support must check the contract linked to your vehicle slot.' },
  'source-failure': { title: 'Your account is unavailable', text: 'Refresh to try again, or contact scheme support.' },
  refused: { title: 'This account cannot be opened', text: 'Your signed-in account does not have access. Contact scheme support.' },
  conflict: { title: 'Your account has changed', text: 'Refresh and review your account before trying again.' },
  restarted: { title: 'This session has changed', text: 'Refresh your session to read the current account.' },
  'authentication-required': { title: 'Sign in to open your account', text: 'Your saved progress stays on the server. Review it after signing in.' },
};

@Component({
  selector: 'gcsp-account',
  imports: [RouterLink, ButtonDirective, ScreenIntroComponent, StatusScreenComponent, LabelledFieldComponent, ErrorSummaryComponent, AccountChoicesComponent],
  templateUrl: './account.component.html', styleUrl: './account.component.css',
})
export class AccountComponent implements OnDestroy {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(AccountClient);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  @ViewChild('recordDrawer') private drawer?: ElementRef<HTMLDialogElement>;
  readonly projection = signal<AccountProjection | null>(null);
  readonly draft = signal<AccountResult<ManualDraft> | null>(null);
  readonly offers = signal<AccountResult<AccountOffers> | null>(null);
  readonly orders = signal<AccountResult<AccountOrders> | null>(null);
  readonly orderSnapshot = signal<AccountResult<AccountOrderSnapshot> | null>(null);
  readonly previewLoading = signal(false);
  readonly newestOrder = computed(() => { const orders = this.orders(); return this.currentScope() && orders?.status === 'ok' ? latestOrder(orders.value.orders) : null; });
  readonly orderCar = computed(() => { const snapshot = this.orderSnapshot(); const order = this.newestOrder(); return order ? orderVehicle(snapshot?.status === 'ok' ? snapshot.value : null, order.orderUuid) : null; });
  readonly placedRecord = computed(() => placedOrderRecord(this.newestOrder(), this.orderCar(), this.projection()));
  readonly allocatedOrder = computed(() => this.model()?.state === 'no-entitlement' && !!this.placedRecord());
  readonly visibleSaved = computed(() => this.allocatedOrder() && this.saved()?.choices.slotId === this.newestOrder()?.entitlementSlotId ? null : this.saved());
  readonly pendingOffer = computed(() => { const offers = this.offers(); return this.currentScope() && offers?.status === 'ok' && offers.value.offers[0]?.state === 'pending' ? offers.value.offers[0] : null; });
  readonly previewFailed = computed(() => [this.offers(), this.orders(), this.orderSnapshot()].some((result) => result && result.status !== 'ok' && result.status !== 'not-found'));
  readonly pendingIntent = signal<JourneyIntent | null>(null);
  private readonly accountResult = signal<AccountResult<AccountProjection> | null>(null);
  private readonly loadedScope = signal<string | null>(null);
  readonly scope = computed(() => {
    const state = this.auth.state();
    return state.status === 'ready' && state.context.roles.includes('employee') && state.context.employeeId
      ? JSON.stringify([state.context.subject, state.context.environmentId, state.context.runId, state.context.employeeId]) : null;
  });
  readonly currentScope = computed(() => !!this.scope() && this.scope() === this.loadedScope());
  readonly model = computed(() => this.currentScope() && this.accountResult() ? toAccountView(this.accountResult()!, { draft: this.draft() }) : null);
  readonly saved = computed(() => this.currentScope() && this.draft()?.status === 'ok' ? (this.draft() as { status: 'ok'; value: ManualDraft }).value : null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly message = signal<Notice | null>(null);
  readonly journeyLocked = signal(false);
  readonly confirmingDiscard = signal(false);
  readonly selectedRecord = signal<ContractView | null>(null);
  readonly failedImages = signal<ReadonlySet<string>>(new Set());
  readonly email = signal<NotificationEmail | null>(null);
  readonly emailInput = signal('');
  readonly emailBusy = signal(false);
  readonly emailLocked = signal(false);
  readonly emailMessage = signal('');
  readonly emailError = signal('');
  private controller = new AbortController();
  private generation = 0;
  private disposed = false;
  private reviewedContextVersion: string | null = null;
  private opener: HTMLElement | null = null;
  private emailCommand: SaveNotificationEmailCommand | null = null;
  private printFrame: HTMLIFrameElement | null = null;
  private printTimer: ReturnType<typeof setTimeout> | null = null;
  readonly stateNotice = computed(() => {
    const model = this.model();
    if (model?.failure && ['pending', 'uncertain'].includes(model.failure.status)) return { title: 'Your account read is not confirmed', text: 'Refresh to read the latest account state.' };
    if (this.allocatedOrder()) return null;
    return model && !model.state.startsWith('ready-') ? states[model.state] ?? { title: 'Your account is unavailable', text: 'Refresh to check the latest account information.' } : null;
  });
  readonly canStart = computed(() => this.currentScope() && !this.busy() && !this.loading() && !this.journeyLocked()
    && ['ok', 'not-found'].includes(this.draft()?.status ?? ''));

  constructor() {
    effect(() => { const scope = this.scope(); untracked(() => { this.invalidate(); if (scope) void this.load(false); }); });
  }
  private invalidate(): void {
    this.generation++; this.controller.abort(); this.controller = new AbortController();
    this.closeRecord(undefined, false); this.finishPrint();
    this.offers.set(null); this.orders.set(null); this.orderSnapshot.set(null); this.previewLoading.set(false);
    this.loadedScope.set(null); this.projection.set(null); this.accountResult.set(null); this.draft.set(null); this.pendingIntent.set(null);
    this.loading.set(false); this.busy.set(false); this.message.set(null); this.journeyLocked.set(false); this.confirmingDiscard.set(false);
    this.failedImages.set(new Set()); this.email.set(null); this.emailInput.set(''); this.emailBusy.set(false); this.emailLocked.set(false);
    this.emailMessage.set(''); this.emailError.set(''); this.emailCommand = null; this.reviewedContextVersion = null;
  }
  private live(generation: number): boolean { return !this.disposed && generation === this.generation && this.scope() === this.loadedScope(); }
  async refresh(): Promise<void> { if (!this.loading() && !this.busy() && !this.emailBusy()) await this.load(true); }
  async choicesBack(): Promise<void> { this.pendingIntent.set(null); await this.refresh(); this.focus('h1'); }
  async choicesContinue(): Promise<void> { if (this.currentScope()) await this.router.navigateByUrl('/stock'); }
  private async load(reviewed: boolean): Promise<void> {
    const scope = this.scope(); if (!scope || this.disposed) return;
    this.invalidate(); this.loadedScope.set(scope); this.loading.set(true);
    const generation = this.generation; const options = { signal: this.controller.signal };
    try {
      const [account, draft] = await Promise.all([this.client.readAccount(options), this.client.readDraft(options)]);
      if (!this.live(generation)) return;
      this.accountResult.set(account); this.draft.set(draft);
      this.projection.set(account.status === 'ok' ? account.value : null);
      if (reviewed && account.status === 'ok') this.reviewedContextVersion = account.value.contextVersion ?? null;
      if (account.status === 'ok' && account.value.account) { void this.reloadEmail(); void this.reloadPreviews(); }
    } catch { if (this.live(generation)) this.accountResult.set({ status: 'unavailable', code: 'account-read-failed' }); }
    finally { if (this.live(generation)) this.loading.set(false); }
  }
  async reloadPreviews(): Promise<void> {
    if (!this.currentScope() || this.previewLoading()) return;
    const generation = this.generation; this.previewLoading.set(true);
    this.offers.set(null); this.orders.set(null); this.orderSnapshot.set(null);
    const options = { signal: this.controller.signal };
    const safe = async <T>(read: () => Promise<AccountResult<T>>): Promise<AccountResult<T>> => { try { return await read(); } catch { return { status: 'unavailable' }; } };
    try {
      await Promise.all([
        (async () => { const offers = await safe(() => this.client.readOffers(options)); if (this.live(generation)) this.offers.set(offers); })(),
        (async () => {
          const orders = await safe(() => this.client.readOrders(options)); if (!this.live(generation)) return;
          this.orders.set(orders);
          if (orders.status === 'ok' && latestOrder(orders.value.orders)) {
            const snapshot = await safe(() => this.client.readOrder(options)); if (this.live(generation)) this.orderSnapshot.set(snapshot);
          }
        })(),
      ]);
    } finally { if (this.live(generation)) this.previewLoading.set(false); }
  }
  orderTitle(): string { const outcome = this.newestOrder()?.outcome; return outcome === 'declined' ? 'Your order was declined' : outcome === 'handed-over' ? 'Your car has been handed over' : 'Your new car'; }
  orderStep(): string | null { const stage = this.newestOrder()?.currentStage; return stage ? words(stage).replace(/_/g, ' ') : null; }
  orderReference(): string | null { const reference = this.newestOrder()?.source?.orderReference; return this.shown(object(reference)?.['value'] ?? (typeof reference === 'string' ? reference : null)); }
  orderImage(orderUuid: string): string | null { return this.newestOrder()?.orderUuid === orderUuid && !this.failedImages().has(`order:${orderUuid}`) ? this.orderCar()?.photo ?? null : null; }
  orderImageFailed(orderUuid: string): void { this.failedImages.update((keys) => new Set([...keys, `order:${orderUuid}`])); }
  deliveredName(orderUuid: string): string { return this.newestOrder()?.orderUuid === orderUuid ? this.orderCar()?.name ?? 'Your current car' : 'Your current car'; }
  showNoCar(): boolean { return this.model()?.contractState === 'no-current-car' && (!!this.model()?.carReturned || !(this.allocatedOrder() && this.newestOrder()?.outcome !== 'declined')); }
  authMessage(): string {
    const state = this.auth.state();
    return state.status === 'denied' ? 'Your signed-in account does not have access to employee cars.'
      : state.status === 'unavailable' ? state.message : 'Sign in with your employee account to continue.';
  }
  async signIn(): Promise<void> { await this.auth.signIn('/gcsp/account'); }
  async refreshSession(): Promise<void> { await this.auth.retry(); await this.refresh(); }
  actionLabel(action: AccountAction): string { return action.action === 'replace' ? 'Choose a replacement' : 'Start a new order'; }
  async start(action: AccountAction): Promise<void> {
    const account = this.projection(); if (!account || !this.canStart()) return;
    this.busy.set(true); this.message.set(null); this.confirmingDiscard.set(false);
    const generation = this.generation;
    try {
      const result = await this.client.startJourney({ account, action, commandId: `account-${crypto.randomUUID()}`,
        reviewedContextVersion: this.reviewedContextVersion }, { signal: this.controller.signal });
      if (!this.live(generation)) return;
      if (result.status === 'ok') {
        this.draft.set(result); const { mode, oldContractId, slotId, schemeId } = result.value.choices;
        this.pendingIntent.set({ mode, oldContractId, slotId, schemeId }); this.focus('.review-choices h2');
      }
      else this.journeyFailure(result, false);
    } catch { if (this.live(generation)) this.journeyFailure({ status: 'unavailable' }, false); }
    finally { if (this.live(generation)) this.busy.set(false); }
  }
  async resume(): Promise<void> {
    const saved = this.saved(); const account = this.projection(); if (!saved || !account || !this.canStart()) return;
    const action = account.actions.find((item) => item.enabled && Object.entries(journeyIntent(item)).every(([key, value]) => saved.choices[key as keyof JourneyIntent] === value));
    if (!action) { this.journeyFailure({ status: 'refused' }, false); return; }
    await this.start(action);
  }
  askDiscard(): void { if (this.canStart()) { this.confirmingDiscard.set(true); this.focus('.discard-confirm'); } }
  keepDraft(): void { if (!this.busy()) { this.confirmingDiscard.set(false); this.focus('[data-discard]'); } }
  async discard(): Promise<void> {
    const saved = this.saved(); if (!saved || !this.canStart() || !this.confirmingDiscard()) return;
    this.busy.set(true); this.message.set(null); const generation = this.generation;
    try {
      const result = await this.client.discardDraft({ commandId: `account-discard-${crypto.randomUUID()}`, expectedDraftVersion: saved.draftVersion }, { signal: this.controller.signal });
      if (!this.live(generation)) return;
      this.confirmingDiscard.set(false);
      if (result.status === 'ok' || result.status === 'not-found') {
        this.pendingIntent.set(null); this.draft.set({ status: 'not-found' }); this.busy.set(false); await this.load(false); this.focus('h1');
      } else {
        if (result.status === 'stale-version' || result.status === 'conflict') {
          const latest = await this.client.readDraft({ signal: this.controller.signal }); if (!this.live(generation)) return; this.draft.set(latest);
        }
        this.journeyFailure(result, true);
      }
    } catch { if (this.live(generation)) this.journeyFailure({ status: 'unavailable' }, true); }
    finally { if (this.live(generation)) this.busy.set(false); }
  }
  private journeyFailure(result: AccountFailure, discard: boolean): void {
    this.pendingIntent.set(null); this.journeyLocked.set(true);
    const stale = ['stale-version', 'conflict'].includes(result.status);
    const pending = ['pending', 'uncertain'].includes(result.status);
    const denied = ['forbidden', 'refused', 'authentication-required', 'unauthenticated', 'account-changed'].includes(result.status);
    this.message.set({ title: pending ? 'Your journey update is not confirmed' : stale ? 'Your context has changed' : denied ? 'This action is not available' : discard ? 'Journey could not be discarded' : 'Journey could not be saved',
      text: result.reason === 'release-required' ? 'A car is held for you. Release it before discarding this journey.'
        : pending ? 'Refresh to read the saved state before taking another action.' : stale ? 'Refresh and review your account before trying again.'
          : denied ? 'Refresh your session and account before trying again.' : 'Refresh to recover your saved journey.' });
  }
  async reloadEmail(): Promise<void> {
    if (!this.currentScope() || this.emailBusy()) return;
    const generation = this.generation; this.emailBusy.set(true); this.emailMessage.set('Loading email…');
    try {
      const result = await this.client.readNotificationEmail({ signal: this.controller.signal }); if (!this.live(generation)) return;
      if (result.status === 'ok') { this.email.set(result.value); this.emailInput.set(result.value.deliveryEmail ?? ''); this.emailLocked.set(false); this.emailCommand = null; this.emailMessage.set(''); this.emailError.set(''); }
      else this.emailFailed(result, true);
    } catch { if (this.live(generation)) this.emailFailed({ status: 'unavailable' }, true); }
    finally { if (this.live(generation)) this.emailBusy.set(false); }
  }
  updateEmail(event: Event): void { this.emailInput.set((event.target as HTMLInputElement).value); }
  async saveEmail(event: Event): Promise<void> {
    event.preventDefault(); const email = this.email(); if (!this.currentScope() || !email || this.emailBusy() || this.emailLocked()) return;
    const input = this.host.nativeElement.querySelector<HTMLInputElement>('#notification-email');
    this.emailInput.set(this.emailInput().trim()); if (input) input.value = this.emailInput(); this.emailError.set('');
    if (input && !input.checkValidity()) { this.emailError.set('Enter a valid email address, or clear the field.'); input.focus(); return; }
    const deliveryEmail = this.emailInput() || null;
    if (!this.emailCommand || this.emailCommand.deliveryEmail !== deliveryEmail || this.emailCommand.expectedVersion !== email.version)
      this.emailCommand = { commandId: `account-email-${crypto.randomUUID()}`, expectedVersion: email.version, deliveryEmail };
    const generation = this.generation; this.emailBusy.set(true); this.emailMessage.set('Saving…');
    try {
      const result = await this.client.saveNotificationEmail(this.emailCommand, { signal: this.controller.signal }); if (!this.live(generation)) return;
      if (result.status === 'ok') { this.email.set(result.value); this.emailInput.set(result.value.deliveryEmail ?? ''); this.emailCommand = null; this.emailMessage.set(result.value.deliveryEmail ? 'Saved.' : 'Email notifications off.'); }
      else this.emailFailed(result, false);
    } catch { if (this.live(generation)) this.emailFailed({ status: 'unavailable' }, false); }
    finally { if (this.live(generation)) this.emailBusy.set(false); }
  }
  private emailFailed(result: AccountFailure, reading: boolean): void {
    this.emailLocked.set(reading || ['stale-version', 'conflict', 'pending', 'uncertain', 'forbidden', 'refused', 'stale-run', 'authentication-required', 'unauthenticated'].includes(result.status));
    this.emailMessage.set(['conflict', 'stale-version'].includes(result.status) ? 'This email has changed. Reload it before saving.'
      : ['pending', 'uncertain'].includes(result.status) ? 'This email update is not confirmed. Reload it before saving again.'
        : ['forbidden', 'refused', 'authentication-required', 'unauthenticated'].includes(result.status) ? 'Sign in again to update your notification email.'
          : reading ? 'Could not load your notification email. Try again.' : 'Could not save your notification email. Try again.');
    if (result.status === 'invalid') this.emailError.set('Enter a valid email address, or clear the field.');
  }
  shown(value: unknown): string | null {
    if (value == null || value === '') return null;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-GB') : null;
    if (Array.isArray(value)) return value.map((part) => this.shown(part)).filter(Boolean).join(', ') || null;
    const record = object(value);
    if (record) {
      if (record['status'] === 'unknown') return null;
      if ('value' in record) { const amount = this.shown(record['value']); return amount ? `${amount}${record['unit'] ? ` ${record['unit']}` : record['currency'] ? ` ${record['currency']}` : ''}${record['basis'] || record['measurementBasis'] ? ` (${this.shown(record['basis'] ?? record['measurementBasis'])})` : ''}` : null; }
      return Object.entries(record).map(([key, part]) => `${words(key)}: ${this.shown(part) ?? 'Not supplied'}`).join('; ') || null;
    }
    return String(value);
  }
  date(value: unknown): string | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return this.shown(value);
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null;
  }
  status(value: unknown): string | null { return value === 'current' ? 'Current car' : value === 'returned' ? 'Returned' : typeof value === 'string' ? words(value) : null; }
  schemeName(schemeId: string): string | null { return this.model()?.histories.find((row) => row.schemeId === schemeId)?.label ?? null; }
  historyScheme(schemeId: string): string { const index = this.model()?.histories.findIndex((row) => row.schemeId === schemeId) ?? -1; return this.schemeName(schemeId) ?? `Scheme ${index + 1}`; }
  carName(contract: ContractView): string { return contract.model ?? (contract.status === 'current' ? 'Your current car' : 'Your previous car'); }
  terms(contract: ContractView): string {
    const account = this.projection(); const term = account ? contractTerms(contract, account) : null;
    if (!term) return 'Not supplied';
    if (term.kind === 'points-monthly') {
      const cost = this.shown(term.value); const allowance = this.shown(term.allowance);
      return cost && allowance ? `${cost} / ${allowance}` : cost ? `${cost} · budget not supplied` : allowance ? `Cost not supplied · ${allowance} budget` : 'Not supplied';
    }
    return term.kind === 'purchase-money' && term.currency === 'GBP' && typeof term.value === 'number' ? `£${term.value.toLocaleString('en-GB')}` : this.shown(term) ?? 'Not supplied';
  }
  termsLabel(contract: ContractView): string { return this.projection() && contractTerms(contract, this.projection()!)?.kind === 'purchase-money' ? 'Purchase price' : 'Points per month'; }
  image(contract: ContractView): string | null {
    if (this.failedImages().has(contract.contractId)) return null;
    const src = contract.media?.['src'] ?? contract.media?.['photo'];
    return typeof src === 'string' && (/^\/(?!\/)/.test(src) || /^https:\/\//.test(src)) ? src : null;
  }
  imageFailed(contract: ContractView): void { this.failedImages.update((current) => new Set([...current, contract.contractId])); }
  vehicleSpec(contract: ContractView): string {
    const configuration = this.shown(contract.vehicle?.['configuration']); const end = contract.model?.trim().split(/\s+/).at(-1);
    const trim = configuration?.startsWith(`${end} `) ? configuration.slice((end?.length ?? 0) + 1) : configuration;
    return [trim, this.shown(contract.vehicle?.['fuel'])].filter(Boolean).join(' · ');
  }
  countdown(contract: ContractView): string {
    if (contract.daysRemaining === null) return 'Contract end: Not supplied';
    return contract.daysRemaining < 0 ? `Contract ended ${this.date(contract.contractEndDate)}` : `Contract ends in ${contract.daysRemaining} days · ${this.date(contract.contractEndDate)}`;
  }
  driverLines(driver: AccountDriver): readonly string[] {
    const licence = driver.licence ?? {}; const categories = Array.isArray(licence['categories']) ? licence['categories'] : [];
    const validity = ['car', 'bike'].map((category) => {
      const found = object(licence[category]) ?? object(categories.find((part) => object(part)?.['category'] === category));
      const until = this.date(found?.['validUntil'] ?? (found || categories.includes(category) ? licence['validUntil'] : null));
      return until ? `${words(category)} licence valid until ${until}${found?.['type'] ? ` · ${this.shown(found['type'])}` : ''}` : null;
    });
    return [driver.kind === 'employee' ? 'You' : `Nominated driver${driver['relationship'] ? `, ${this.shown(driver['relationship'])}` : ''}`, ...validity,
      this.shown(licence['displayNumber']), this.status(driver['status']), this.date(driver['dateOfBirth']), this.address(driver['address'])].filter((part): part is string => !!part);
  }
  address(value: unknown): string | null { const record = object(value); return record ? Object.values(record).map((part) => this.shown(part)).filter(Boolean).join(', ') || null : this.shown(value); }
  identityRows(): readonly Row[] {
    return (this.model()?.identityFacts ?? []).filter((row) => row.label !== 'Name').flatMap((row) => {
      const value = row.label === 'Address' ? this.address(row.value) : ['Date of birth', 'Override end'].includes(row.label) ? this.date(row.value) : this.shown(row.value);
      return value ? [{ label: row.label, value }] : [];
    });
  }
  recordSections(contract: ContractView): readonly { title: string; note?: string; rows: readonly Row[] }[] {
    const row = (label: string, value: unknown, unit?: unknown): Row => ({ label, value: this.shown(value) ? `${this.shown(value)}${unit ? ` ${unit}` : ''}` : '' });
    const technical = object(contract['technical']) ?? {};
    const standard = ['insuranceGroup', 'transmission', 'nedcCo2', 'wltpCo2', 'fuelConsumptionLow', 'fuelConsumptionMedium', 'fuelConsumptionHigh', 'fuelConsumptionExtraHigh', 'fuelConsumptionCombinedWeighted', 'electricityConsumption', 'electricRange', 'electricCityRange', 'exterior', 'interior', 'price', 'options'];
    const reference = object(contract['orderReference']);
    const sections = [
      { title: 'Contract', rows: [row('Status', this.status(contract.status)), row('Scheme', this.schemeName(contract.schemeId)), row(this.termsLabel(contract), this.terms(contract) === 'Not supplied' ? null : this.terms(contract)), row('Driver', contract.driver?.name), row('Term', contract.months, 'months'), row('Annual mileage', contract.annualMileage, contract.mileageUnit), row('Contract end', this.date(contract.contractEndDate)), row('Returned', this.date(contract.returnedDate))] },
      { title: 'Collection', rows: [row('Collected', this.date(contract.actualCollectionDate)), row('Earliest collection', this.date(contract.earliestCollectionDate)), row('Latest collection', this.date(contract.latestCollectionDate)), row('Requested collection', this.date(contract['requestedCollectionDate'])), row('Collection location', contract['collectionLocation']), row('Current mileage', contract.currentOdometer), row('Expected return mileage', contract['expectedReturnMileage'], contract['returnMileageUnit'] ?? 'mi'), row('Returned mileage', contract.returnedMileage, contract['returnMileageUnit'] ?? 'mi')] },
      { title: 'Order and vehicle', rows: [row('Order reference', reference?.['value'] ?? (typeof contract['orderReference'] === 'string' ? contract['orderReference'] : null)), row('Car order number', contract.orderNumber), row('Order date', this.date(contract['orderDate'])), row('Order status', this.status(contract['orderStatus'])), row('Registration', contract.registration), row('Delivered VIN', contract.vin), row('Chassis number', contract['chassisNumber']), row('Registration date', this.date(contract['registrationDate'])), row('Vehicle slot', this.model()?.slots.find((slot) => slot.entitlementSlotId === contract.slotId)?.['label']), row('Phone', object(contract['contact'])?.['phone']), row('Email', object(contract['contact'])?.['email']), row('Special requirements', contract['specialRequirements'])] },
      { title: 'Technical specification and options', note: 'Model or handbook evidence does not confirm the fitted equipment on your car.', rows: [...standard.map((key) => row(words(key), technical[key] ?? contract[key])), ...Object.entries(technical).filter(([key]) => !['provenance', 'source', ...standard].includes(key)).map(([key, value]) => row(words(key), value)), row('Specification provenance', object(technical['provenance'] ?? technical['source'] ?? contract['source'])?.['label']), row('Image source', contract.media?.['provenance'])] },
    ];
    return sections.map((section) => ({ ...section, rows: section.rows.filter((item) => item.value !== '') }));
  }
  openRecord(contract: ContractView, event: Event): void {
    this.opener = event.currentTarget as HTMLElement; this.selectedRecord.set(contract); this.changeDetector.detectChanges();
    this.drawer?.nativeElement.showModal(); this.drawer?.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
  }
  closeRecord(event?: Event, restore = true): void {
    event?.preventDefault(); this.drawer?.nativeElement.close(); this.selectedRecord.set(null);
    if (restore && this.opener?.isConnected) this.opener.focus(); this.opener = null;
  }
  drawerKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { this.closeRecord(event); return; }
    if (event.key !== 'Tab') return;
    const controls = this.drawer?.nativeElement.querySelectorAll<HTMLElement>('button, a[href]'); if (!controls?.length) return;
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && this.host.nativeElement.ownerDocument.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && this.host.nativeElement.ownerDocument.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  printRecord(): void {
    const content = this.drawer?.nativeElement.querySelector('.record-content'); if (!content || !this.currentScope()) return;
    this.finishPrint(); const document = this.host.nativeElement.ownerDocument;
    const frame = document.createElement('iframe'); frame.hidden = true; frame.title = 'Print car record'; document.body.append(frame); this.printFrame = frame;
    const printDocument = frame.contentDocument; const printWindow = frame.contentWindow;
    if (!printDocument || !printWindow) { this.finishPrint(); return; }
    printDocument.title = 'Car record'; printDocument.body.append(content.cloneNode(true));
    printWindow.addEventListener('afterprint', () => this.finishPrint(), { once: true });
    this.printTimer = setTimeout(() => this.finishPrint(), 60000);
    try { printWindow.print(); } catch { this.finishPrint(); this.message.set({ title: 'The record could not be printed', text: 'Close the record and try again.' }); }
  }
  private finishPrint(): void { if (this.printTimer) clearTimeout(this.printTimer); this.printTimer = null; this.printFrame?.remove(); this.printFrame = null; }
  private focus(selector: string): void { this.changeDetector.detectChanges(); this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(); }
  ngOnDestroy(): void { this.disposed = true; this.invalidate(); }
}
