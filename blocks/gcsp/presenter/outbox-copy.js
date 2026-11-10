// Plain-English copy, status table and formatting for the presenter outbox viewer. No DOM here.
const CHECK = ['M5 12.5l4.5 4.5L19 7.5'];
const REFRESH = ['M20 12a8 8 0 1 1-2.5-5.8', 'M20 4v5h-5'];
const CROSS = ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M9 9l6 6', 'M15 9l-6 6'];
const CLOCK = ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'];

export const STATUS = Object.freeze({
  sent: Object.freeze({ label: 'Sent', icon: CHECK, tone: 'ok' }),
  retrying: Object.freeze({ label: 'Retrying', icon: REFRESH, tone: 'warn' }),
  failed: Object.freeze({ label: 'Failed', icon: CROSS, tone: 'bad' }),
  sending: Object.freeze({ label: 'Sending', icon: CLOCK, tone: 'wait' }),
});
const STATUS_ALIAS = { pending: 'sending' };
const CAPTURED = Object.freeze({ ...STATUS.sent, label: 'Captured, not sent' });
// An offline (captured) message was never emailed, so "sent" would contradict the footer.
export const statusOf = (state, transport) => (state === 'sent' && transport === 'captured' ? CAPTURED
  : STATUS[STATUS_ALIAS[state] || state] || Object.freeze({ label: 'Unknown', icon: CLOCK, tone: 'wait' }));

// One table: safe error code from docs/gcsp/captured-outbox.md to a sentence for the presenter.
export const ERROR_COPY = Object.freeze({
  'mail-configuration-invalid': 'The sender configuration needs attention.',
  'recipient-not-allowed': 'The recipient is not an approved address.',
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
});
const UNKNOWN_ERROR = 'The email could not be delivered, for a reason that is not listed.';
export const errorSentence = (code) => (code ? ERROR_COPY[code] || UNKNOWN_ERROR : null);

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Clock instant as "5 Nov 2026, 10:05 GMT" (UK time, explicit zone). */
export function formatDemoTime(iso) {
  const ms = Date.parse(iso);
  if (typeof iso !== 'string' || Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Europe/London', timeZoneName: 'short',
  });
}

export const recipientName = (message) => message?.recipient?.name || message?.recipient?.employeeId || 'Unknown recipient';

/** What to show instead of a body when no email was created. */
export function explain(message) {
  const attempts = message.attempts ?? 0;
  const why = errorSentence(message.error);
  if (message.state === 'retrying') {
    const next = formatDemoTime(message.nextAttemptAt);
    return `Delivery did not work on attempt ${attempts}. ${why || ''} ${next ? `The next attempt is due at ${next}.` : 'Another attempt is due soon.'}`.replace(/\s+/g, ' ').trim();
  }
  if (message.state === 'failed') {
    return `Delivery failed after ${plural(attempts, 'attempt')}. ${why || UNKNOWN_ERROR} No further attempts will be made.`;
  }
  if (message.state === 'sent') return 'This email was captured, but its content is not available.';
  return 'This email is still being prepared. Refresh in a moment to see it.';
}

/** Same rule as the server template: a same-origin path or an https URL with no credentials. */
export function isSafeOfferLink(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
