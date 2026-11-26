import { ProductionControlsComponent } from './production-controls.component';
import { OutboxClient, OutboxMessage } from '../outbox/outbox.client';
import { basicModel, weekDays } from './basic-model';
import { PresenterRelease } from './presenter.projections';
import { ReleaseSectionComponent } from './release-section.component';
import { SuitabilitySectionComponent } from './suitability-section.component';
import { HappenedFeedComponent } from './happened-feed.component';
import { friendlyTime } from '../kit/friendly-time';
import { LiveRefreshService } from '../live-refresh.service';
import { ChangeDetectorRef, Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthPort, SessionState } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent, FactRow } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { PresenterClient } from './presenter.client';
import { PresenterCatalogue, PresenterClientFailure, PresenterCommand, PresenterCommandValue, PresenterControls, PresenterCurrentScenario,
  PresenterFaults, PresenterResetInput, PresenterResult } from './presenter.types';

let serial = 0;
@Component({
  selector: 'gcsp-presenter',
  imports: [ProductionControlsComponent, ReleaseSectionComponent, SuitabilitySectionComponent, HappenedFeedComponent, RouterLink, ButtonDirective, FactListComponent, LabelledFieldComponent, ScreenIntroComponent, StatusScreenComponent],
  templateUrl: './presenter.component.html', styleUrl: './presenter.component.css',
})
export class PresenterComponent implements OnDestroy {
  readonly auth = inject(AuthPort);
  private readonly outbox = inject(OutboxClient);
  readonly release = signal<PresenterRelease | null>(null);
  readonly orderCount = signal<number | null>(null);
  readonly emails = signal<readonly OutboxMessage[]>([]);
  readonly emailsUnavailable = signal(false);
  readonly advanced = signal(false);
  readonly basicReset = signal(false);
  readonly mainScenario = computed(() => this.catalogue()?.scenarios.find(s => s.scenarioId === 'main-successful-journey') ?? null);
  readonly startAllowed = computed(() => this.clockReady() && this.mainScenario()?.availability.available === true);
  readonly basic = computed(() => basicModel(this.controls(), this.current()?.currentScenario?.scenarioId === 'main-successful-journey', this.orderCount()));
  readonly days = computed(() => weekDays(this.controls()?.now, this.controls()?.startsAt));
  readonly clockDay = computed(() => this.basic().clock?.split(' · ')[0] ?? '');
  readonly clockTime = computed(() => this.basic().clock?.split(' · ').slice(1).join(' · ') || this.basic().clock || '');
  readonly formatTime = friendlyTime;
  private readonly client = inject(PresenterClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly detector = inject(ChangeDetectorRef);
  readonly id = `gcsp-presenter-${++serial}`;
  readonly controls = signal<PresenterControls | null>(null);
  readonly catalogue = signal<PresenterCatalogue | null>(null);
  readonly current = signal<PresenterCurrentScenario | null>(null);
  readonly faults = signal<PresenterFaults | null>(null);
  readonly reading = signal(false);
  readonly pending = signal(false);
  readonly message = signal('Loading presenter controls.');
  readonly commandMessage = signal('');
  readonly readProblems = signal<readonly string[]>([]);
  readonly retryCommand = signal<PresenterCommand | null>(null);
  readonly faultRetryCommand = signal<PresenterCommand | null>(null);
  readonly resetReview = signal<Extract<PresenterCommand, { kind: 'reset' }> | null>(null);
  readonly selectedScenarioId = signal('');
  readonly selectedFault = signal('');
  readonly selectedMode = signal('');
  readonly advanceKind = signal<'seconds' | 'to'>('seconds');
  readonly seconds = signal('60');
  readonly target = signal('');
  readonly tickId = signal('');
  readonly validation = signal('');
  readonly validationField = signal('');
  private readonly displayedSession = signal<SessionState | null>(null);
  readonly permitted = computed(() => { const state = this.auth.state(); return state === this.displayedSession() && state.status === 'ready' && state.context.roles.includes('presenter'); });
  readonly locked = computed(() => !this.permitted() || this.pending() || this.reading() || !!this.retryCommand());
  readonly recoveringTick = computed(() => ['tick', 'control-tick'].includes(this.retryCommand()?.kind ?? ''));
  readonly faultEditorsLocked = computed(() => !this.permitted() || this.pending() || this.reading() || !!this.faultRetryCommand()
    || !!this.retryCommand() && !this.recoveringTick());
  readonly clockReady = computed(() => !!this.controls() && !this.locked());
  readonly selectedScenario = computed(() => this.catalogue()?.scenarios.find(s => s.scenarioId === this.selectedScenarioId()) ?? null);
  readonly fault = computed(() => this.faults()?.faults.find(f => f.adapter === this.selectedFault()) ?? null);
  readonly modes = computed(() => { const fault = this.fault(); return fault?.available ? fault.modes.filter(mode => !this.recoveringTick() || mode === 'none') : []; });
  readonly resetAllowed = computed(() => this.clockReady() && !!this.selectedScenario()?.availability.available
    && this.current()?.runId === this.controls()?.runId);
  readonly faultAllowed = computed(() => !this.faultEditorsLocked() && !!this.fault()?.available && this.modes().includes(this.selectedMode())
    && this.faults()?.runId === this.controls()?.runId);
  readonly nextReleaseReason = computed(() => { const release = this.controls()?.controls.nextRelease;
    return release?.status === 'unavailable' ? this.publicText(release.reason) : release ? `Next release: ${friendlyTime(release.at)}` : 'Current release information is unavailable.'; });
  readonly nextReleaseAvailable = computed(() => this.clockReady() && this.controls()?.controls.nextRelease.status === 'available');
  readonly clockFacts = computed<readonly FactRow[]>(() => this.controls() ? [
    { label: 'Scheme clock', value: friendlyTime(this.controls()!.now) }, { label: 'Scenario', value: this.current()?.currentScenario?.name },
  ] : []);
  readonly resetFacts = computed<readonly FactRow[]>(() => this.resetReview() ? [{ label: 'Scenario', value: this.catalogue()?.scenarios.find(s => s.scenarioId === this.resetReview()!.input.scenarioId)?.name || 'Selected scenario' }] : []);
  readonly retryFacts = computed<readonly FactRow[]>(() => { const command = this.retryCommand(); return command ? [{ label: 'Action', value: ({ production: 'Production response', advance: 'Advance clock', tick: 'Tick current time', 'control-tick': command.kind === 'control-tick' && command.input.mode === 'next-release' ? 'Next release' : 'Step the scheme clock', reset: 'Start a fresh scenario', fault: 'Set fault mode' })[command.kind] }] : []; });
  readonly namedTimes = computed(() => Object.entries(this.controls()?.controls.namedTimes ?? {}).map(([name, at]) => ({ name, at: friendlyTime(at) })));
  private recoveredReset: { readonly input: PresenterResetInput; readonly subject: string; readonly environmentId: string; readonly needsPreparation: boolean } | null = null;
  private session: SessionState | null = null;
  private controller = new AbortController();
  private generation = 0;
  private destroyed = false;
  private readonly stopRefresh = inject(LiveRefreshService).subscribe(() => this.permitted() && !this.locked() ? this.readCurrent() : undefined);

  constructor() {
    effect(() => { const session = this.auth.state(); untracked(() => this.changeSession(session)); });
  }
  control(name: string): string { return `${this.id}-${name}`; }
  text(event: Event): string { return (event.target as HTMLInputElement).value; }
  scenarioChanged(event: Event): void { this.selectedScenarioId.set(this.text(event)); this.resetReview.set(null); }
  faultChanged(event: Event): void { this.selectedFault.set(this.text(event)); this.selectedMode.set(''); }
  kindChanged(event: Event): void { this.advanceKind.set(this.text(event) === 'to' ? 'to' : 'seconds'); }
  described(name: string): string { return `${this.control(name)}-hint${this.validationField() === name ? ` ${this.control('validation')}` : ''}`; }
  handlerLabel(id: string): string { return ({ 'stock-release': 'Stock release', 'buddy-allocation': 'Buddy allocation', 'buddy-expiry': 'Buddy hold expiry', 'manual-claim-expiry': 'Manual hold expiry', 'captured-outbox': 'Email dispatch', 'lifecycle-approvals': 'Order approvals', 'lifecycle-documents': 'Documents', 'lifecycle-appointments': 'Appointments', 'renewal-risk-cases': 'Renewal cases', 'buddy-pending-operations': 'Buddy reconciliation', 'selection-order-reconciliation': 'Order reconciliation' } as Record<string, string>)[id] ?? 'Scheme step'; }
  outcome(value: Readonly<Record<string, unknown>>): string { return value['status'] === 'ok' ? 'Completed' : value['status'] === 'pending' || value['status'] === 'unavailable' ? 'Waiting to complete' : 'Not completed'; }
  private publicText(value: string): string { return value.replace(/\b\d{4}-\d\d-\d\dT\S+/g, 'the scheme time').replace(/\brun[-_:][A-Za-z0-9._:-]+\b/gi, 'the current scenario'); }

  async refresh(): Promise<void> {
    if (!this.permitted() || this.pending() || this.reading() || this.destroyed) return;
    await this.readCurrent();
    this.focus('[data-presenter-status]');
  }
  async step(mode: 'step' | 'next-release'): Promise<void> {
    const controls = this.controls();
    if (!controls || !this.clockReady() || (mode === 'next-release' && !this.nextReleaseAvailable())) return;
    await this.sendPrepared(this.client.prepareControlTick({ commandId: this.commandId(), expectedClockVersion: controls.clockVersion, mode }));
  }
  async advance(event: Event): Promise<void> {
    event.preventDefault(); const controls = this.controls(); if (!controls || !this.clockReady()) return;
    const base = { commandId: this.commandId(), expectedClockVersion: controls.clockVersion };
    if (this.advanceKind() === 'seconds') {
      const seconds = Number(this.seconds());
      if (!Number.isSafeInteger(seconds) || seconds < 1) { this.invalid('Enter a positive whole number of seconds.', 'seconds'); return; }
      await this.sendPrepared(this.client.prepareAdvance({ ...base, bySeconds: seconds }));
    } else {
      if (!this.target().trim()) { this.invalid('Choose a named time or enter an instant with a UTC offset.', 'target'); return; }
      await this.sendPrepared(this.client.prepareAdvance({ ...base, to: this.target().trim() }));
    }
  }
  async tick(event: Event): Promise<void> {
    event.preventDefault(); const controls = this.controls(); if (!controls || !this.clockReady()) return;
    if (!this.tickId().trim()) { this.invalid('Enter a tick reference.', 'tick'); return; }
    await this.sendPrepared(this.client.prepareTick({ tickId: this.tickId().trim(), expectedClockVersion: controls.clockVersion }));
  }
  async releaseTomorrow(): Promise<void> {
    const controls = this.controls(); const body = this.basic().release.body;
    if (!controls || !body || !this.clockReady() || this.basic().release.disabled) return;
    await this.sendPrepared(this.client.prepareControlTick({ commandId: this.commandId(), expectedClockVersion: controls.clockVersion, ...body }));
    if (this.permitted()) this.focus(this.clockReady() && !this.basic().release.disabled ? '[data-basic-release]' : '[data-start-again]');
  }
  reviewReset(): void { const scenario = this.selectedScenario(); if (scenario && this.resetAllowed()) this.prepareReset(scenario, false); }
  reviewStartAgain(): void { const scenario = this.mainScenario(); if (scenario && this.startAllowed()) this.prepareReset(scenario, true); }
  private prepareReset(scenario: NonNullable<ReturnType<typeof this.selectedScenario>>, basic: boolean): void {
    const controls = this.controls(); if (!controls) return;
    const command = this.client.prepareReset({ commandId: this.commandId(), expectedRunId: controls.runId, scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.scenarioVersion, fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion });
    if ('state' in command) { this.invalid(command.problem); return; } if (command.kind !== 'reset') return;
    this.basicReset.set(basic); this.resetReview.set(command); this.validation.set(''); this.focus(basic ? '[data-basic-confirm]' : '[data-reset-review]');
  }
  cancelReset(): void { if (this.pending()) return; const basic = this.basicReset(); this.resetReview.set(null); this.focus(basic ? '[data-start-again]' : '[data-reset-trigger]'); }
  async confirmReset(): Promise<void> {
    const command = this.resetReview(); if (!command || !(this.basicReset() ? this.startAllowed() : this.resetAllowed())) return;
    this.resetReview.set(null); await this.sendPrepared(command);
  }
  async setFault(event: Event): Promise<void> {
    event.preventDefault(); if (!this.faultAllowed()) return;
    const command = this.client.prepareFault({ commandId: this.commandId(), adapter: this.selectedFault(), mode: this.selectedMode() });
    if (this.recoveringTick()) {
      if ('state' in command) { this.invalid(command.problem); return; }
      await this.submit(command, true);
    } else await this.sendPrepared(command);
  }
  async retryFault(): Promise<void> {
    const command = this.faultRetryCommand();
    if (!command || !this.recoveringTick() || this.pending() || this.reading() || !this.permitted()) return;
    await this.submit(command, true);
  }
  async retry(): Promise<void> {
    const command = this.retryCommand(); if (!command || this.faultRetryCommand() || this.pending() || this.reading() || !this.permitted()) return;
    if (command.kind === 'reset' && this.recoveredReset?.needsPreparation) {
      const prepared = this.client.prepareReset(this.recoveredReset.input);
      if ('state' in prepared) { this.invalid(prepared.problem); return; }
      this.recoveredReset = null; await this.submit(prepared);
    } else { this.recoveredReset = null; await this.submit(command); }
  }
  async retryAuthentication(): Promise<void> {
    if (this.pending() || this.reading() || this.destroyed) return;
    const command = this.retryCommand(); const session = this.auth.state();
    if (command?.kind === 'reset' && session.status === 'ready') {
      this.recoveredReset = { input: command.input, subject: session.context.subject, environmentId: session.context.environmentId, needsPreparation: false };
    }
    const generation = this.generation; this.reading.set(true); this.message.set('Refreshing sign-in context. No previous command will be submitted automatically.');
    try { await this.auth.retry(); } catch { if (!this.destroyed) this.message.set('Sign-in context could not be refreshed. Try again.'); }
    finally {
      if (!this.destroyed) {
        const current = this.auth.state();
        if (current !== this.session) this.changeSession(current);
        else if (generation === this.generation) this.reading.set(false);
      }
    }
  }
  async signIn(): Promise<void> { await this.auth.signIn('/gcsp/presenter'); }
  ngOnDestroy(): void { this.stopRefresh(); this.destroyed = true; this.generation++; this.controller.abort(); }

  private changeSession(session: SessionState): void {
    if (this.session === session) return;
    this.session = session; this.displayedSession.set(session); this.generation++; this.controller.abort(); this.controller = new AbortController();
    this.controls.set(null); this.catalogue.set(null); this.current.set(null); this.faults.set(null); this.release.set(null); this.orderCount.set(null); this.emails.set([]); this.emailsUnavailable.set(false);
    this.pending.set(false); this.reading.set(false); this.retryCommand.set(null); this.faultRetryCommand.set(null); this.resetReview.set(null);
    this.selectedScenarioId.set(''); this.selectedFault.set(''); this.selectedMode.set('');
    this.commandMessage.set(''); this.validation.set(''); this.validationField.set(''); this.readProblems.set([]);
    if (session.status === 'signed-out' || session.status === 'denied' || session.status === 'ready' && (!session.context.roles.includes('presenter')
      || this.recoveredReset && (this.recoveredReset.subject !== session.context.subject || this.recoveredReset.environmentId !== session.context.environmentId))) this.recoveredReset = null;
    if (session.status === 'ready' && session.context.roles.includes('presenter')) {
      if (this.recoveredReset) {
        this.recoveredReset = { ...this.recoveredReset, needsPreparation: true };
        this.retryCommand.set(Object.freeze({ kind: 'reset', input: this.recoveredReset.input }));
        this.commandMessage.set('The previous reset outcome is unresolved. Review and deliberately retry the same reset if still intended.');
      }
      this.message.set('Loading current presenter state. No previous command will be submitted automatically.'); void this.readCurrent();
    } else if (session.status === 'signed-out') this.message.set('Sign in with your presenter account.');
    else if (session.status === 'loading') this.message.set('Checking sign-in.');
    else if (session.status === 'unavailable' || session.status === 'denied') this.message.set(session.message);
    else this.message.set('A presenter account is required.');
  }
  private async readCurrent(): Promise<void> {
    const generation = this.generation; this.reading.set(true); this.resetReview.set(null);
    this.message.set('Reading current backend state.');
    const options = { signal: this.controller.signal };
    try {
      const [controls, catalogue, current, faults, release, outbox, orders] = await Promise.all([
        this.client.readControls(options), this.client.readCatalogue(options), this.client.readCurrentScenario(options), this.client.readFaults(options), this.client.readLatestRelease(options), this.outbox.read(options), this.client.readOrderCount(options),
      ]);
      if (!this.active(generation)) return;
      this.controls.set(controls.state === 'ready' ? controls.value : null);
      this.catalogue.set(catalogue.state === 'ready' ? catalogue.value : null);
      this.current.set(current.state === 'ready' ? current.value : null);
      this.faults.set(faults.state === 'ready' ? faults.value : null);
      this.release.set(release.state === 'ready' && release.value.runId === controls.value?.runId ? release.value : null);
      this.emails.set(outbox.status === 'ok' && outbox.value.runId === controls.value?.runId ? outbox.value.messages : []);
      this.emailsUnavailable.set(outbox.status !== 'ok');
      this.orderCount.set(orders.state === 'ready' ? orders.value.count : null);
      const problems: string[] = [];
      for (const [label, result] of [['Clock and release', controls], ['Scenario catalogue', catalogue], ['Current scenario', current], ['Faults', faults]] as const) {
        if (result.state !== 'ready') problems.push(`${label}: ${this.problem(result)}`);
      }
      if (controls.state === 'ready' && current.state === 'ready' && controls.value.runId !== current.value.runId) {
        this.controls.set(null); this.current.set(null); this.release.set(null); this.orderCount.set(null); this.emails.set([]); problems.push('The active run changed during readback. Refresh current state.');
      }
      if (controls.state === 'ready' && faults.state === 'ready' && controls.value.runId !== faults.value.runId) {
        this.faults.set(null); problems.push('Fault state belongs to a changed run. Refresh current state.');
      }
      this.readProblems.set(problems);
      if (!this.selectedScenarioId()) this.selectedScenarioId.set(this.current()?.currentScenario?.scenarioId ?? this.catalogue()?.scenarios[0]?.scenarioId ?? '');
      this.message.set(problems.length ? 'Some current state is unavailable. Review the readback below.' : 'Current backend state loaded.');
    } catch {
      if (!this.active(generation)) return;
      this.controls.set(null); this.catalogue.set(null); this.current.set(null); this.faults.set(null); this.release.set(null); this.orderCount.set(null); this.emails.set([]); this.emailsUnavailable.set(false);
      this.message.set('Current state could not be read. Refresh before preparing a new command.');
    } finally { if (this.active(generation)) this.reading.set(false); }
  }
  private async sendPrepared(command: PresenterCommand | PresenterClientFailure): Promise<void> {
    if ('state' in command) { this.invalid(command.problem); return; }
    if (this.locked()) return;
    await this.submit(command);
  }
  private async submit(command: PresenterCommand, retainTick = false): Promise<void> {
    const retainedTick = retainTick ? this.retryCommand() : null;
    const generation = this.generation; this.pending.set(true); this.validation.set(''); this.validationField.set(''); this.resetReview.set(null);
    this.commandMessage.set('Submitting command. Its outcome is pending.');
    let result: PresenterResult<PresenterCommandValue>;
    try { result = await this.client.submit(command, { signal: this.controller.signal }); }
    catch { result = { state: 'failed', value: null, problem: 'The connection ended before an outcome was received.', writeOutcome: 'unknown' }; }
    if (!this.active(generation)) return;
    this.pending.set(false);
    if (result.state === 'ready') {
      this.retryCommand.set(retainedTick); this.faultRetryCommand.set(null); this.recoveredReset = null;
      this.commandMessage.set(retainedTick ? 'Fault command acknowledged. The original tick remains available for deliberate retry.' : command.kind === 'reset' && 'activatedRunId' in result.value
        ? 'Started again on day 1.'
        : 'Command acknowledged. Checking current state.');
    } else {
      const retryable = result.state === 'refused' ? result.refusal.status !== 'conflict' && (result.refusal.status === 'pending' || result.refusal.retryable)
        : result.state !== 'scope-mismatch' || result.writeOutcome === 'unknown';
      if (retainedTick) this.faultRetryCommand.set(retryable ? command : null);
      else this.retryCommand.set(retryable ? command : null);
      this.commandMessage.set(this.problem(result, true));
    }
    if (result.state === 'ready' && command.kind === 'reset' && 'activatedRunId' in result.value) {
      this.reading.set(true);
      try { await this.auth.retry(); } catch {
        if (this.destroyed) return;
        this.commandMessage.set('Started again. Refresh sign-in context to continue.');
      }
      if (this.destroyed) return;
      const session = this.auth.state();
      if (session !== this.session) { this.changeSession(session); return; }
    }
    await this.readCurrent();
    if (this.active(generation)) this.focus('[data-presenter-status]');
  }
  private problem(result: Exclude<PresenterResult<unknown>, { state: 'ready' }>, command = false): string {
    if (result.state === 'refused') {
      const refusal = result.refusal;
      return `${refusal.status === 'pending' ? 'Command outcome pending' : refusal.status === 'conflict' ? 'Current-version conflict' : 'Request refused'}: ${this.publicText(refusal.reason)}`;
    }
    if (result.state === 'failed') return `${result.writeOutcome === 'unknown' ? 'Command outcome unknown. ' : result.writeOutcome === 'not-sent' ? 'Command not sent. ' : ''}${result.problem}`;
    if (result.state === 'scope-mismatch') return 'The account or active run changed. Refresh sign-in context before continuing.';
    return command ? 'The response could not be verified. The command outcome is unknown.' : 'The current response could not be verified.';
  }
  private invalid(message: string, field?: string): void { this.validation.set(message); this.validationField.set(field ?? ''); this.focus(field ? `#${this.control(field)}` : '[data-presenter-validation]'); }
  private active(generation: number): boolean { return !this.destroyed && generation === this.generation && this.session === this.auth.state() && this.permitted(); }
  private commandId(): string { return `presenter-${crypto.randomUUID()}`; }
  private focus(selector: string): void { if (this.destroyed) return; this.detector.detectChanges(); this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(); }
}
