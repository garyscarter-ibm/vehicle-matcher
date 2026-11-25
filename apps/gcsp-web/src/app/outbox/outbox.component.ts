import { Component, computed, effect, ElementRef, inject, OnDestroy, signal, untracked } from '@angular/core';
import { LiveRefreshService } from '../live-refresh.service';
import { AuthPort, SessionState } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { MailStatusChipComponent } from '../kit/mail-status-chip.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { OutboxClient, OutboxMessage, OutboxResult } from './outbox.client';

type Phase = 'loading' | 'ready' | 'authentication-required' | 'forbidden' | 'stale-run' | 'account-changed' | 'unavailable';
type Filter = 'state' | 'recipient' | 'kind';
const ERROR_COPY: Readonly<Record<string, string>> = {
  'mail-configuration-invalid': 'The sender configuration needs attention.',
  'recipient-not-allowed': 'The recipient is not an approved address.',
  'recipient-email-invalid': 'Set a valid notification email in Your Cars, under Your details.',
  'offer-link-invalid': 'The offer link is not a public address.',
  'provider-authentication': 'The email provider refused the configured sender credentials.',
  'provider-rejected': 'The email provider refused this message.',
  'provider-rate-limited': 'The email provider asked us to slow down.',
  'provider-unavailable': 'The email provider could not confirm acceptance.',
  'provider-timeout': 'The email provider timed out. Acceptance is not confirmed.',
  'provider-unconfirmed': 'The email provider has not confirmed acceptance.',
  'provider-window-expired': 'Acceptance is not confirmed. The safe retry window has ended.',
  'transport-unavailable': 'The mail service could not be reached.',
  'message-invalid': 'The email could not be built from the offer details.',
  'message-facts-unavailable': 'The offer or employee details needed for the email were not found.',
  'fictional-recipient-required': 'The recipient is not on the approved list, so nothing was sent.',
  'recipient-mismatch': 'The offer belongs to a different employee from the recipient.',
  'message-version-unsupported': 'This email version is not supported.',
  'offer-inactive': 'The offer is no longer active, so no email was created.',
  'offer-expired': 'The offer had expired before the email could be created.',
};

@Component({
  selector: 'gcsp-outbox',
  imports: [ButtonDirective, LabelledFieldComponent, MailStatusChipComponent, ScreenIntroComponent, StatusScreenComponent],
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
  recipient(message: OutboxMessage): string { return message.recipient.name || message.recipient.employeeId; }
  subject(message: OutboxMessage): string { return message.subject || 'Email not created yet'; }
  words(value: string): string { return value.replace(/[-_]/g, ' ').replace(/^./, (s) => s.toUpperCase()); }
  status(message: OutboxMessage): string {
    if (message.state === 'sent') return message.transport === 'captured' ? 'Captured, not sent'
      : message.transport === 'configured' ? 'Accepted by email provider' : 'Delivery status unknown';
    return ({ pending: 'Preparing', sending: 'Sending', retrying: 'Retrying', failed: 'Failed' } as Readonly<Record<string, string>>)[message.state] ?? 'Delivery status unknown';
  }
  deliveryNote(message: OutboxMessage): string {
    if (message.state === 'sent') return message.transport === 'captured' ? 'No email has been sent.'
      : message.transport === 'configured' ? 'Provider acceptance does not confirm inbox receipt.' : 'Email delivery has not been confirmed.';
    if (message.state === 'failed') return 'No further attempts will be made.';
    if (message.state === 'retrying') return 'Delivery is waiting for another attempt.';
    if (message.state === 'pending' || message.state === 'sending') return 'Delivery is not yet confirmed.';
    return 'Email delivery has not been confirmed.';
  }
  error(message: OutboxMessage): string {
    return message.error ? ERROR_COPY[message.error] ?? 'The email could not be delivered, for a reason that is not listed.' : '';
  }
  time(value: string | null): string {
    return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'Europe/London', timeZoneName: 'short',
    }) : 'Time not available';
  }
  safeOfferLink(value: string | null): string | null {
    if (!value || value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
    if (/^\/(?!\/)/.test(value)) return value;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? value : null; }
    catch { return null; }
  }
}
