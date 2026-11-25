import { Component, computed, input } from '@angular/core';
import { ButtonDirective } from './button.directive';
import { OutboxMessage } from '../outbox/outbox.client';

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


export class MailPresentation {
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
export const mailPresentation = new MailPresentation();

@Component({ selector: 'gcsp-mail-detail', imports: [ButtonDirective], host: { style: 'display: contents' }, templateUrl: './mail-detail.component.html' })
export class MailDetailComponent extends MailPresentation {
  readonly message = input.required<OutboxMessage>();
  readonly showHeading = input(true);
  readonly emailDocument = computed(() => this.message().htmlBody || null);
}
