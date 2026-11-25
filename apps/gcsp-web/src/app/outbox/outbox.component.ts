import { Component, computed, effect, ElementRef, inject, OnDestroy, signal, untracked } from '@angular/core';
import { LiveRefreshService } from '../live-refresh.service';
import { AuthPort, SessionState } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { MailStatusChipComponent } from '../kit/mail-status-chip.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { MailDetailComponent, mailPresentation } from '../kit/mail-detail.component';
import { OutboxClient, OutboxMessage, OutboxResult } from './outbox.client';

type Phase = 'loading' | 'ready' | 'authentication-required' | 'forbidden' | 'stale-run' | 'account-changed' | 'unavailable';
type Filter = 'state' | 'recipient' | 'kind';

@Component({
  selector: 'gcsp-outbox',
  imports: [MailDetailComponent, ButtonDirective, LabelledFieldComponent, MailStatusChipComponent, ScreenIntroComponent, StatusScreenComponent],
  templateUrl: './outbox.component.html', styleUrl: './outbox.component.css',
})
export class OutboxComponent implements OnDestroy {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(OutboxClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly snapshot = signal<SessionState | null>(null);
  private readonly phase = signal<Phase>('loading');
  private readonly rows = signal<readonly OutboxMessage[]>([]);
  private readonly selectedId = signal<string | null>(null);
  private readonly retryable = signal(false);
  private request: AbortController | null = null;
  private generation = 0;
  private destroyed = false;
  readonly stateFilter = signal('');
  readonly recipientFilter = signal('');
  readonly kindFilter = signal('');
  // Hide old facts synchronously, before the session-change effect or a late read can run.
  readonly view = computed<Phase>(() => {
    const session = this.auth.state();
    if (session.status === 'loading') return 'loading';
    if (session.status === 'denied') return 'forbidden';
    if (session.status === 'unavailable') return 'unavailable';
    if (session.status !== 'ready') return 'authentication-required';
    if (!session.context.roles.includes('presenter')) return 'forbidden';
    return session === this.snapshot() ? this.phase() : 'loading';
  });
  readonly messages = computed(() => this.view() === 'ready' ? this.rows() : []);
  readonly states = computed(() => [...new Set(this.messages().map((m) => m.state))].sort());
  readonly kinds = computed(() => [...new Set(this.messages().map((m) => m.messageKind))].sort());
  readonly recipients = computed(() => [...new Map(this.messages().map((m) => [m.recipient.employeeId, this.recipient(m)])).entries()]);
  readonly filtered = computed(() => this.messages().filter((m) => (!this.stateFilter() || m.state === this.stateFilter())
    && (!this.recipientFilter() || m.recipient.employeeId === this.recipientFilter())
    && (!this.kindFilter() || m.messageKind === this.kindFilter())));
  readonly selected = computed(() => this.filtered().find((m) => m.jobId === this.selectedId()) ?? this.filtered()[0] ?? null);
  readonly canRefresh = computed(() => {
    const s = this.auth.state(); return s.status === 'ready' && s.context.roles.includes('presenter')
      && (this.view() === 'ready' || this.view() === 'unavailable' && this.retryable());
  });
  readonly emailDocument = computed(() => {
    const html = this.selected()?.htmlBody;
    if (!html) return null;
    // Angular sanitizes this ordinary string at the sole iframe.srcdoc binding. The empty
    // sandbox independently denies scripts, origin access, forms, popups and top navigation.
    return html;
  });
  readonly failureTitle = computed(() => ({
    'authentication-required': 'Sign in to open captured emails', forbidden: 'You cannot open the outbox',
    'stale-run': 'The scenario has restarted', 'account-changed': 'Your session has changed',
    unavailable: 'Captured emails are unavailable', loading: '', ready: '',
  })[this.view()]);
  readonly failureMessage = computed(() => ({
    'authentication-required': 'Sign in with your presenter account to inspect captured emails.',
    forbidden: 'Only the presenter can inspect captured emails.',
    'stale-run': 'Refresh your session before opening emails from the current run.',
    'account-changed': 'Refresh your session before opening captured emails again.',
    unavailable: 'The captured emails could not be loaded. Try again in a moment.', loading: '', ready: '',
  })[this.view()]);

  private readonly stopLiveRefresh = inject(LiveRefreshService).subscribe(() => this.canRefresh() ? this.load() : undefined);

  constructor() {
    effect(() => {
      const session = this.auth.state();
      untracked(() => {
        this.cancelRead(); this.clearSensitive(); this.snapshot.set(session);
        if (session.status === 'ready' && session.context.roles.includes('presenter')) void this.load();
      });
    });
  }
  refresh(): void { if (this.canRefresh()) void this.load(); }
  setFilter(filter: Filter, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (filter === 'state') this.stateFilter.set(value);
    else if (filter === 'recipient') this.recipientFilter.set(value);
    else this.kindFilter.set(value);
    this.selectedId.set(this.selected()?.jobId ?? null);
  }
  clearFilters(): void { this.stateFilter.set(''); this.recipientFilter.set(''); this.kindFilter.set(''); }
  select(jobId: string): void {
    if (!this.filtered().some((m) => m.jobId === jobId)) return;
    this.selectedId.set(jobId);
    queueMicrotask(() => { if (!this.destroyed) this.host.nativeElement.querySelector<HTMLElement>('.gcsp-mail-heading')?.focus(); });
  }
  private async load(): Promise<void> {
    const session = this.auth.state();
    if (this.destroyed || session.status !== 'ready' || !session.context.roles.includes('presenter') || session !== this.snapshot()) return;
    this.cancelRead(); const mine = this.generation; const request = new AbortController(); this.request = request;
    const keep = this.selected()?.jobId ?? this.selectedId();
    this.phase.set('loading'); this.rows.set([]); this.retryable.set(false);
    let result: OutboxResult;
    try { result = await this.client.read({ signal: request.signal }); }
    catch { result = { status: 'unavailable', code: 'outbox-read-failed', retryable: true }; }
    if (this.destroyed || request.signal.aborted || mine !== this.generation || this.auth.state() !== session) return;
    this.request = null;
    if (result.status === 'ok') {
      if (result.value.runId !== session.context.runId) { this.clearSensitive(); this.phase.set('stale-run'); return; }
      const time = (m: OutboxMessage) => m.time && Number.isFinite(Date.parse(m.time)) ? Date.parse(m.time) : -Infinity;
      this.rows.set([...result.value.messages].sort((a, b) => time(b) - time(a) || a.jobId.localeCompare(b.jobId)));
      this.phase.set('ready'); this.selectedId.set(keep);
      this.selectedId.set(this.selected()?.jobId ?? null);
    } else {
      this.clearSensitive(); this.phase.set(result.status === 'aborted' ? 'unavailable' : result.status);
      this.retryable.set(result.status === 'unavailable' && result.retryable);
    }
  }
  private cancelRead(): void { this.generation++; this.request?.abort(); this.request = null; }
  private clearSensitive(): void {
    this.rows.set([]); this.selectedId.set(null); this.clearFilters(); this.retryable.set(false); this.phase.set('loading');
  }
  ngOnDestroy(): void { this.stopLiveRefresh(); this.destroyed = true; this.cancelRead(); this.clearSensitive(); }
  readonly recipient = mailPresentation.recipient;
  readonly subject = mailPresentation.subject;
  readonly words = mailPresentation.words;
  readonly status = mailPresentation.status;
  readonly deliveryNote = mailPresentation.deliveryNote;
  readonly error = mailPresentation.error;
  readonly time = mailPresentation.time;
  readonly safeOfferLink = mailPresentation.safeOfferLink;
}
