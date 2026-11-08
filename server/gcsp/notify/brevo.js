import { randomUUID } from 'node:crypto';
import { inputDigest, ok, result } from '../repository/index.js';
import { MailTransport } from './port.js';
import { safeOfferLink } from './templates.js';

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const WINDOW_MS = 30 * 60 * 1000; // Brevo's provider wall-time idempotency window, independent of DemoClock.
const CAPTURE_FOOTER = 'This is a captured demonstration message for a fictional employee. No email has been sent.';
const REAL_FOOTER = 'This is a demonstration message for a fictional employee. Provider acceptance does not confirm inbox delivery.';
const safeMessageId = (id) => typeof id === 'string' && id.length <= 256
  && /^(?:<[a-zA-Z0-9][a-zA-Z0-9._@+\-]*>|[a-zA-Z0-9][a-zA-Z0-9._@+\-]*)$/.test(id);
export const confirmedBrevoAcknowledgement = (provider) => provider?.name === 'brevo' && provider.state === 'confirmed' && safeMessageId(provider.messageId);
const reference = (context, job) => ({ table: 'notification_outbox', key: { runId: context.runId, jobId: job.jobId } });
const failure = (code, retryable = false) => result('unavailable', { code, retryable });
const text = (value) => typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
const email = (value) => text(value) && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
const escape = (value) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const MAIL_FAILURE_CODES = new Set(['mail-configuration-invalid', 'recipient-not-allowed', 'offer-link-invalid',
  'provider-authentication', 'provider-rejected', 'provider-rate-limited', 'provider-unavailable', 'provider-timeout',
  'provider-unconfirmed', 'provider-window-expired']);

export function publicMailBase(value) {
  if (!text(value) || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')
      || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return null;
    url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
    return url;
  } catch { return null; }
}

function absoluteLink(value, base) {
  if (!base || !safeOfferLink(value)) return null;
  try {
    const link = new URL(value, base);
    const fragmentValid = !value.includes('#') || /^#token=[A-Za-z0-9_-]{43}$/.test(link.hash);
    if (link.username || link.password || !fragmentValid || link.origin !== base.origin) return null;
    const route = `${base.pathname}gcsp/offer`;
    if (value.startsWith('/') && link.pathname === '/gcsp/offer') link.pathname = route;
    if (link.pathname !== route) return null;
    return link.href;
  } catch { return null; }
}

export class BrevoMailTransport extends MailTransport {
  #repository; #apiKey; #sender; #recipients; #allowed; #base; #fetch; #wallNow; #timeout; #valid;
  constructor({ repository, apiKey, sender, recipients, allowedRecipients, publicBaseUrl, fetchImpl = globalThis.fetch,
    wallNow = () => new Date().toISOString(), timeoutMs = 10000, configurationValid = true } = {}) {
    super(); this.#repository = repository; this.#apiKey = apiKey; this.#sender = { email: sender?.email, name: sender?.name };
    this.#recipients = plain(recipients) ? { ...recipients } : {};
    this.#allowed = new Set(Array.isArray(allowedRecipients) ? allowedRecipients : Object.values(this.#recipients));
    this.#base = publicMailBase(publicBaseUrl); this.#fetch = fetchImpl; this.#wallNow = wallNow; this.#timeout = timeoutMs;
    this.#valid = configurationValid && text(apiKey) && email(sender?.email) && text(sender?.name) && plain(recipients)
      && Object.entries(recipients).every(([id, address]) => text(id) && email(address)) && this.#base
      && typeof fetchImpl === 'function' && typeof wallNow === 'function' && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000;
  }

  async #current(context) {
    const current = await this.#repository.currentRun(context.environmentId);
    if (current.status !== 'ok') return current;
    return current.value.runId === context.runId ? ok(null) : result('stale-run', { reason: 'Notifications belong to an earlier run.' });
  }

  async send({ context, job, message, now }) {
    const current = await this.#current(context); if (current.status !== 'ok') return current;
    let wall;
    try { wall = this.#wallNow(); } catch { /* Ignore arbitrary clock diagnostic text. */ }
    const validWall = typeof wall === 'string' && Number.isFinite(Date.parse(wall));
    const address = Object.hasOwn(this.#recipients, job.recipientId) ? this.#recipients[job.recipientId] : null;
    const offerLink = message.offerLink === undefined ? undefined : absoluteLink(message.offerLink, this.#base);
    const error = !this.#valid || !validWall ? 'mail-configuration-invalid'
      : !email(address) || !this.#allowed.has(address) ? 'recipient-not-allowed'
        : message.offerLink !== undefined && !offerLink ? 'offer-link-invalid' : null;
    const rendered = { ...message, textBody: message.textBody.replaceAll(CAPTURE_FOOTER, REAL_FOOTER), htmlBody: message.htmlBody.replaceAll(CAPTURE_FOOTER, REAL_FOOTER) };
    if (offerLink) {
      rendered.textBody = rendered.textBody.replaceAll(message.offerLink, offerLink);
      rendered.htmlBody = rendered.htmlBody.replaceAll(escape(message.offerLink), escape(offerLink));
      rendered.offerLink = offerLink;
    }
    const prepared = await this.#repository.transaction(context, {
      commandId: `notify:brevo:prepare:${inputDigest([job.jobId, job.attempts])}`,
      inputDigest: inputDigest([job.jobId, job.inputDigest, job.attempts]),
    }, async (tx) => {
      const found = await tx.get(reference(context, job)); if (found.status !== 'ok') return found;
      if (found.value.state === 'sent') return ok(null);
      if (found.value.state !== 'sending' || found.value.attempts !== job.attempts) return result('conflict', { reason: 'notification-attempt-changed' });
      return tx.compareAndSwap(reference(context, job), found.value.version, {
        transport: 'configured', outcome: { ...found.value.outcome,
          capturedAt: found.value.outcome?.capturedAt ?? now,
          message: found.value.outcome?.message ?? { ...rendered, runId: context.runId, jobId: job.jobId, capturedAt: now },
          ...(!error && !found.value.outcome?.provider ? { provider: { name: 'brevo', idempotencyKey: randomUUID(), firstAttemptAt: wall, state: 'pending' } } : {}),
        },
      });
    });
    if (prepared.status !== 'ok') return prepared;
    const stored = await this.#repository.read(context, reference(context, job)); if (stored.status !== 'ok') return stored;
    const provider = stored.value.outcome?.provider;
    // Reports the row version this adapter last wrote, so the dispatcher can tell its custody from other writers.
    const custody = (outcome, version = stored.value.version) => ({ ...outcome, custodyVersion: version });
    if (confirmedBrevoAcknowledgement(provider)) return custody(ok({ accepted: true }));
    if (error) return custody(failure(error));
    if (!provider || provider.name !== 'brevo' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(provider.idempotencyKey)
      || !Number.isFinite(Date.parse(provider.firstAttemptAt))) return custody(failure('mail-configuration-invalid'));
    const elapsed = Date.parse(wall) - Date.parse(provider.firstAttemptAt);
    if (elapsed < 0 || elapsed >= WINDOW_MS) return custody(failure('provider-window-expired'));
    const stillCurrent = await this.#current(context); if (stillCurrent.status !== 'ok') return stillCurrent;
    if (stored.value.state !== 'sending' || stored.value.attempts !== job.attempts) return result('conflict', { reason: 'notification-attempt-changed' });
    const captured = stored.value.outcome.message;
    const payload = { sender: this.#sender, to: [{ email: address }], subject: captured.subject,
      textContent: captured.textBody, htmlContent: captured.htmlBody, headers: { idempotencyKey: provider.idempotencyKey } };
    let outcome;
    const controller = new AbortController(); let timer; let timedOut = false;
    try {
      outcome = await Promise.race([(async () => {
        const response = await this.#fetch(ENDPOINT, { method: 'POST', redirect: 'error',
          headers: { 'api-key': this.#apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
        let body;
        try { body = await response.json(); } catch { /* Provider response content never leaves the adapter. */ }
        const id = body?.messageId;
        if (response.status === 201 && safeMessageId(id)
          && !id.includes(this.#apiKey) && id !== address && id !== this.#sender.email) return { messageId: id };
        if (body?.code === 'duplicate_parameter' || response.status >= 200 && response.status < 300) return failure('provider-unconfirmed', true);
        if ([401, 403].includes(response.status)) return failure('provider-authentication');
        if (response.status === 429) return failure('provider-rate-limited', true);
        if (response.status >= 500 || response.status === 408) return failure('provider-unavailable', true);
        return failure('provider-rejected');
      })(), new Promise((resolve) => { timer = setTimeout(() => { timedOut = true; controller.abort(); resolve(failure('provider-timeout', true)); }, this.#timeout); })]);
    } catch { outcome = failure(timedOut ? 'provider-timeout' : 'provider-unavailable', true); }
    finally { clearTimeout(timer); }
    const confirmed = Boolean(outcome.messageId);
    const persisted = await this.#repository.transaction(context, {
      commandId: `notify:brevo:outcome:${inputDigest([job.jobId, job.attempts, provider.idempotencyKey, outcome.messageId ?? outcome.code])}`,
      inputDigest: inputDigest([job.jobId, provider.idempotencyKey, outcome.messageId ?? outcome.code]),
    }, async (tx) => {
      const found = await tx.get(reference(context, job)); if (found.status !== 'ok') return found;
      const existing = found.value.outcome?.provider;
      if (confirmedBrevoAcknowledgement(existing)) return ok({ accepted: true, version: found.value.version });
      if (existing?.idempotencyKey !== provider.idempotencyKey) return result('conflict', { reason: 'notification-attempt-changed' });
      const changed = await tx.compareAndSwap(reference(context, job), found.value.version, { outcome: { ...found.value.outcome,
        provider: { ...existing, state: confirmed ? 'confirmed' : 'unconfirmed', ...(confirmed ? { messageId: outcome.messageId, acknowledgedAt: wall } : {}) } } });
      return changed.status === 'ok' ? ok({ accepted: confirmed, version: changed.value.version }) : changed;
    });
    if (persisted.status !== 'ok') return persisted;
    return custody(persisted.value.accepted ? ok({ accepted: true }) : outcome, persisted.value.version);
  }
}
