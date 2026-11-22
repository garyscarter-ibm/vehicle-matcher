import { NgTemplateOutlet } from '@angular/common';
import { GregNavigationComponent } from '../kit/greg-navigation.component';
import { Component, computed, effect, inject, OnDestroy, signal, untracked } from '@angular/core';
import { AuthPort, SessionState } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { ComparisonClient } from './comparison.client';
import { COMPARISON_EXPERIMENTS, ComparisonCatalogue, ComparisonDifference, ComparisonExperimentId, ComparisonFailure, ComparisonJob, ComparisonResponse, ComparisonStartInput, ComparisonStartResponse, ComparisonStats } from './comparison.types';

type Phase = 'loading' | 'ready' | ComparisonFailure['status'];
// Survives the sign-in redirect after expiry; same tab, same account and run only.
const PROGRESS_KEY = 'gcsp:comparison:saved-progress';
interface SavedProgress { readonly owner: string; readonly selectedId: ComparisonExperimentId; readonly value: string; readonly basis: string; readonly command: ComparisonStartInput | null }
const LABELS: Record<ComparisonExperimentId, string> = { 'process-only': 'Process only', 'order-mix': 'Order mix', points: 'Points allowance', 'hold-sweep': 'Hold duration' };
const MEASURES: Record<string, string> = { acceptableCoverage: 'Covered before renewal', carsNeverAllocated: 'Cars never allocated', heldNotTakenCarDays: 'Car time held but not taken', declinedOffers: 'Offers declined', expiredOffers: 'Offers expired', failedClaims: 'Holds that expired untaken', retries: 'Retries after a lost claim', meanAcceptedFit: 'Calculated fit of accepted cars' };
const VERDICTS: Record<string, string> = { 'buddy-better': 'Buddy route better', 'current-better': "Today's release route better", 'variant-better': 'Tried value better', 'baseline-better': "Today's value better", 'no-clear-difference': 'No clear difference', 'insufficient-seeds': 'Too few seeds to compare' };
@Component({ selector: 'gcsp-comparison', imports: [NgTemplateOutlet, GregNavigationComponent, ButtonDirective, LabelledFieldComponent, ScreenIntroComponent, StatusScreenComponent], templateUrl: './comparison.component.html', styleUrl: './comparison.component.css' })
export class ComparisonComponent implements OnDestroy {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(ComparisonClient);
  private readonly snapshot = signal<SessionState | null>(null);
  private readonly phase = signal<Phase>('loading');
  private readonly catalogue = signal<ComparisonCatalogue | null>(null);
  private readonly currentJob = signal<ComparisonJob | null>(null);
  private readonly reruns = signal(false);
  private owner = '';
  private generation = 0;
  private requests = new Set<AbortController>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pollRequest: AbortController | null = null;
  private destroyed = false;
  private pendingCommand: ComparisonStartInput | null = null;
  readonly selectedId = signal<ComparisonExperimentId>('process-only');
  readonly valueDraft = signal('');
  readonly basisDraft = signal('');
  readonly commandBusy = signal(false);
  readonly uncertain = signal(false);
  readonly commandError = signal('');
  readonly fieldErrors = signal<readonly { readonly field: string; readonly reason: string }[]>([]);
  readonly jobError = signal('');
  readonly readError = signal('');
  readonly experiments = COMPARISON_EXPERIMENTS;
  readonly view = computed<Phase>(() => {
    const s = this.auth.state();
    if (s.status === 'loading') return 'loading';
    if (s.status === 'signed-out') return 'authentication-required';
    if (s.status === 'denied') return 'forbidden';
    if (s.status === 'unavailable') return 'unavailable';
    if (!s.context.roles.some(r => r === 'greg' || r === 'presenter')) return 'forbidden';
    return s === this.snapshot() ? this.phase() : 'loading';
  });
  readonly selected = computed(() => this.view() === 'ready' ? this.catalogue()?.experiments.find(e => e.experimentId === this.selectedId())?.latest ?? null : null);
  readonly activePolicy = computed(() => this.view() === 'ready' ? this.catalogue()?.activePolicyVersion ?? '' : '');
  readonly job = computed(() => this.view() === 'ready' ? this.currentJob() : null);
  readonly isGreg = computed(() => { const s = this.auth.state(); return s.status === 'ready' && s === this.snapshot() && s.context.roles.includes('greg') && !s.context.roles.includes('presenter'); });
  readonly canStart = computed(() => this.view() === 'ready' && this.isGreg() && this.reruns() && !this.commandBusy() && !this.uncertain() && this.currentJob()?.status !== 'running' && !this.jobError());
  readonly canRefresh = computed(() => { const s = this.auth.state(); return s.status === 'ready' && s === this.snapshot() && s.context.roles.some(r => r === 'greg' || r === 'presenter') && !this.commandBusy() && (this.view() === 'ready' || this.view() === 'unavailable'); });
  readonly newResultMatched = computed(() => this.job()?.status === 'succeeded' && !!this.job()?.resultId && this.selected()?.resultId === this.job()?.resultId);
  readonly rerunsAvailable = computed(() => this.view() === 'ready' && this.reruns());
  readonly failureTitle = computed(() => ({ 'authentication-required': 'Sign in to open comparisons', forbidden: 'You cannot open comparisons', 'stale-run': 'The scenario has restarted', 'account-changed': 'Your session has changed', unavailable: 'Comparisons are unavailable' } as Record<string, string>)[this.view()] ?? 'Comparisons could not be loaded');
  constructor() {
    effect(() => {
      const s = this.auth.state();
      untracked(() => {
        if (this.pendingCommand) this.uncertain.set(true);
        this.cancel(); this.snapshot.set(s); this.catalogue.set(null); this.currentJob.set(null); this.reruns.set(false); this.phase.set('loading'); this.commandBusy.set(false);
        if (s.status === 'ready') {
          const next = `${s.context.environmentId}|${s.context.runId}|${s.context.subject}|${[...s.context.roles].sort().join(',')}`;
          if (this.owner !== next) { this.clearDraft(); this.selectedId.set('process-only'); this.owner = next; this.restoreProgress(next); }
          if (s.context.roles.some(r => r === 'greg' || r === 'presenter')) void this.load();
        } else if (s.status === 'signed-out' || s.status === 'denied') { this.keepProgress(s.status === 'signed-out' && this.auth.recovery() !== null); this.owner = ''; this.clearDraft(); }
      });
    });
    document.addEventListener('visibilitychange', this.visibilityChanged);
  }
  private readonly visibilityChanged = () => { this.stopTimer(); if (document.hidden) this.pollRequest?.abort(); else this.schedulePoll(); };
  refresh(): void { if (this.canRefresh()) void this.load(); }
  select(event: Event): void { const id = (event.target as HTMLSelectElement).value; if (COMPARISON_EXPERIMENTS.includes(id as ComparisonExperimentId) && !this.commandBusy() && !this.uncertain()) { this.selectedId.set(id as ComparisonExperimentId); this.valueDraft.set(''); this.basisDraft.set(''); this.commandError.set(''); this.fieldErrors.set([]); } }
  draft(kind: 'value' | 'basis', event: Event): void { if (!this.uncertain() && !this.commandBusy()) (kind === 'value' ? this.valueDraft : this.basisDraft).set((event.target as HTMLInputElement).value); }
  async recover(): Promise<void> { if (this.auth.state().status === 'signed-out' || this.view() === 'authentication-required') await this.auth.signIn('/gcsp/comparison'); else await this.auth.retry(); }
  private async load(): Promise<void> {
    if (!this.allowed()) return;
    this.cancel(); const mine = this.generation; const s = this.auth.state(); const request = this.controller(); this.phase.set('loading'); this.readError.set(''); this.jobError.set('');
    const jobId = this.currentJob()?.jobId;
    const [results, job] = await Promise.all([
      this.safe(() => this.client.readResults({ signal: request.signal })),
      this.safe(() => this.client.readJob({ signal: request.signal, ...(jobId ? { jobId } : {}) })),
    ]);
    this.requests.delete(request);
    if (!this.valid(mine, s, request)) return;
    if (results.status !== 'ok') { this.catalogue.set(null); this.phase.set(results.status); this.readError.set(results.reason); return; }
    this.catalogue.set(results.value); this.phase.set('ready');
    if (job.status === 'ok') { this.currentJob.set(job.value.job); this.reruns.set(job.value.reruns); }
    else this.acceptJobFailure(job);
    this.schedulePoll();
  }
  private async safe<T>(read: () => Promise<ComparisonResponse<T>>): Promise<ComparisonResponse<T>> { try { return await read(); } catch { return { status: 'unavailable', code: 'comparison-read-failed', reason: 'The comparison service could not be reached.', retryable: true }; } }
  private allowed(): boolean { const s = this.auth.state(); return !this.destroyed && s.status === 'ready' && s === this.snapshot() && s.context.roles.some(r => r === 'greg' || r === 'presenter'); }
  private valid(mine: number, s: SessionState, request: AbortController): boolean { return !this.destroyed && !request.signal.aborted && mine === this.generation && this.auth.state() === s; }
  private controller(): AbortController { const request = new AbortController(); this.requests.add(request); return request; }
  private acceptJobFailure(f: ComparisonFailure): void { this.reruns.set(false); this.jobError.set(f.reason); if (['authentication-required', 'forbidden', 'stale-run', 'account-changed'].includes(f.status)) { this.catalogue.set(null); this.currentJob.set(null); this.phase.set(f.status); } }
  private schedulePoll(): void { this.stopTimer(); if (!this.allowed() || this.view() !== 'ready' || document.hidden || this.currentJob()?.status !== 'running' || this.jobError()) return; this.timer = setTimeout(() => void this.poll(), 2000); }
  private async poll(): Promise<void> {
    if (!this.allowed() || document.hidden || this.currentJob()?.status !== 'running') return;
    const jobId = this.currentJob()!.jobId; const mine = this.generation; const s = this.auth.state(); const request = this.controller(); this.pollRequest = request;
    const response = await this.safe(() => this.client.readJob({ signal: request.signal, jobId })); this.requests.delete(request);
    if (!this.valid(mine, s, request)) return;
    if (response.status !== 'ok') { this.acceptJobFailure(response); return; }
    if (response.value.job?.jobId !== jobId) { this.jobError.set('The tracked comparison could not be read. Refresh to check it.'); return; }
    this.currentJob.set(response.value.job); this.reruns.set(response.value.reruns); this.jobError.set('');
    if (response.value.job.status === 'succeeded') await this.refreshResults(mine, s); else this.schedulePoll();
  }
  private async refreshResults(mine: number, s: SessionState): Promise<void> {
    const request = this.controller(); const response = await this.safe(() => this.client.readResults({ signal: request.signal })); this.requests.delete(request);
    if (!this.valid(mine, s, request)) return;
    if (response.status === 'ok') this.catalogue.set(response.value); else { this.readError.set('The run finished but its result could not be read back. Refresh to try again.'); if (['authentication-required', 'forbidden', 'stale-run', 'account-changed'].includes(response.status)) this.acceptJobFailure(response); }
  }
  start(): void {
    if (!this.canStart()) return;
    const commandId = globalThis.crypto.randomUUID(); const experimentId = this.selectedId(); const basis = this.basisDraft().trim(); const raw = this.valueDraft().trim();
    let input: ComparisonStartInput;
    if (experimentId === 'process-only') input = { experimentId, commandId };
    else {
      if (!basis || !raw) { this.commandError.set('Give the values and why they are worth trying.'); return; }
      if (experimentId === 'points') { const value = Number(raw); if (!Number.isFinite(value)) { this.commandError.set('Give a numeric points multiplier.'); return; } input = { experimentId, commandId, change: { value, basis } }; }
      else if (experimentId === 'hold-sweep') { const values = raw.split(',').map(v => v.trim() ? Number(v.trim()) : NaN); if (!values.every(Number.isInteger)) { this.commandError.set('Give whole-second hold durations, separated by commas.'); return; } input = { experimentId, commandId, change: { values, basis } }; }
      else { const values = raw.split('\n').map(line => { const parts = line.split('='); return { modelLine: parts[0]?.trim(), weight: parts.length === 2 && parts[1].trim() ? Number(parts[1]) : NaN }; }); if (!values.every(v => v.modelLine && Number.isFinite(v.weight))) { this.commandError.set('Give one model line and numeric weight per line, separated by =.'); return; } input = { experimentId, commandId, change: { value: values, basis } }; }
    }
    this.pendingCommand = input; void this.send(input);
  }
  retryCommand(): void { if (this.view() === 'ready' && this.isGreg() && this.reruns() && this.uncertain() && !this.commandBusy() && this.pendingCommand) void this.send(this.pendingCommand); }
  private async send(input: ComparisonStartInput): Promise<void> {
    this.stopTimer(); const mine = this.generation; const s = this.auth.state(); const request = this.controller(); this.commandBusy.set(true); this.commandError.set(''); this.fieldErrors.set([]);
    let response: ComparisonStartResponse;
    try { response = await this.client.start(input, { signal: request.signal }); } catch { response = { status: 'unavailable' as const, code: 'start-unconfirmed', reason: 'The start could not be confirmed. Check progress or retry the same command.', retryable: true, writeOutcome: 'unknown' as const }; }
    this.requests.delete(request); if (!this.valid(mine, s, request)) return;
    this.commandBusy.set(false);
    if (response.status === 'ok' || response.status === 'pending') { this.currentJob.set(response.value); this.pendingCommand = null; this.uncertain.set(false); if (response.value.status === 'succeeded') await this.refreshResults(mine, s); else this.schedulePoll(); }
    else { this.commandError.set(response.reason); this.fieldErrors.set(response.reasons ?? []); this.uncertain.set(response.writeOutcome === 'unknown'); if (!this.uncertain()) this.pendingCommand = null; if (response.jobId) { this.currentJob.set(null); void this.inspectBusy(response.jobId); } if (['authentication-required', 'forbidden', 'stale-run', 'account-changed'].includes(response.status)) this.acceptJobFailure(response); }
  }
  private async inspectBusy(jobId: string): Promise<void> { const mine = this.generation; const s = this.auth.state(); const request = this.controller(); const response = await this.safe(() => this.client.readJob({ signal: request.signal, jobId })); this.requests.delete(request); if (!this.valid(mine, s, request)) return; if (response.status === 'ok' && response.value.job?.jobId === jobId) { this.currentJob.set(response.value.job); this.reruns.set(response.value.reruns); this.schedulePoll(); } else this.jobError.set('The running comparison could not be read. Refresh to check it.'); }
  private keepProgress(expired: boolean): void {
    const saved: SavedProgress = { owner: this.owner, selectedId: this.selectedId(), value: this.valueDraft(), basis: this.basisDraft(), command: this.pendingCommand };
    try { if (expired && this.owner) sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(saved)); else sessionStorage.removeItem(PROGRESS_KEY); } catch { /* Storage refused: progress stays in memory only. */ }
  }
  private restoreProgress(owner: string): void {
    let saved: SavedProgress | null = null;
    try { const raw = sessionStorage.getItem(PROGRESS_KEY); sessionStorage.removeItem(PROGRESS_KEY); saved = raw ? JSON.parse(raw) as SavedProgress : null; } catch { saved = null; }
    if (!saved || saved.owner !== owner || !COMPARISON_EXPERIMENTS.includes(saved.selectedId)) return;
    this.selectedId.set(saved.selectedId); this.valueDraft.set(String(saved.value ?? '')); this.basisDraft.set(String(saved.basis ?? ''));
    // A restored command is only ever resent by the explicit retry control.
    if (saved.command) { this.pendingCommand = saved.command; this.uncertain.set(true); }
  }
  private clearDraft(): void { this.valueDraft.set(''); this.basisDraft.set(''); this.pendingCommand = null; this.uncertain.set(false); this.commandError.set(''); this.fieldErrors.set([]); }
  private stopTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private cancel(): void { this.generation++; this.stopTimer(); for (const request of this.requests) request.abort(); this.requests.clear(); }
  ngOnDestroy(): void { this.destroyed = true; this.cancel(); this.clearDraft(); this.catalogue.set(null); this.currentJob.set(null); document.removeEventListener('visibilitychange', this.visibilityChanged); }
  label(id: ComparisonExperimentId): string { return LABELS[id]; }
  words(value: string): string { return value.replace(/[-_]/g, ' ').replace(/^./, s => s.toUpperCase()); }
  measure(key: string): string { return MEASURES[key] ?? (key.startsWith('accessGroupCoverage:') ? `Covered before renewal: ${key.slice(20).replace(/-/g, ' ')}` : this.words(key)); }
  verdict(value: string): string { return VERDICTS[value] ?? this.words(value); }
  // Same display-only mapping as the approved Greg comparison's demand-copy.plainText.
  // Digest-bearing projections stay unchanged; only painted prose is mapped.
  plain(value: string): string {
    const replacements: readonly [RegExp, string][] = [
      [/^People, cars and behaviour are fictional and assumed; .*$/, 'People, cars and behaviour are modelled, not BMW records.'],
      [/^Fictional cohort and assumed behaviour; /, 'Modelled cohort and assumed behaviour; '],
      [/^Fictional facts for mechanics; /, 'Vehicle and driver facts are assumed; '],
      [/^Underlying needs are synthetic latent inputs, not a real employee confirmation\.$/, 'Underlying needs are modelled inputs, not an employee confirmation.'],
      [/ Not a verified BMW amount\.$/, ''], [/\bin demo brief\/Q15\b/, 'in the brief (Q15)'],
      [/\b(?:synthetic|fictional|demonstration|demo)\b(?:[- ]clock)?[- ]?(?=\w)/gi, ''],
    ];
    const out = replacements.reduce((text, [from, to]) => text.replace(from, to), value);
    return /^(?:synthetic|fictional|demo)/i.test(value) && out !== value ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  }
  json(value: unknown): string { return value === undefined ? 'Not supplied' : typeof value === 'string' ? this.plain(value) : JSON.stringify(value, (_key, item: unknown) => typeof item === 'string' ? this.plain(item) : item, 2); }
  number(key: string, value: number | null, difference = false): string { if (value === null) return 'Not observed'; const share = key === 'acceptableCoverage' || key.startsWith('accessGroupCoverage:'); const amount = Math.round(value * (share ? 1000 : 10)) / 10; return `${difference && amount > 0 ? '+' : ''}${amount}${share ? difference ? ' pts' : '%' : key === 'heldNotTakenCarDays' ? ' days' : ''}`; }
  stats(key: string, value: ComparisonStats, difference = false): string { return `${this.number(key, value.mean, difference)} (${this.number(key, value.min, difference)} to ${this.number(key, value.max, difference)})`; }
  trackDifference(_index: number, difference: ComparisonDifference): string { return difference.measure; }
}
