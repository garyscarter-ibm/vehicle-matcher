import { MailTransport } from './port.js';
import { inputDigest, ok, result } from '../repository/index.js';
import { publicOrigin as validOrigin } from '../public-origin.js';
import { safeOfferLink } from './templates.js';

const escape = (value) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class CapturedTransport extends MailTransport {
  #repository; #origin;
  constructor({ repository, publicOrigin } = {}) { super(); this.#repository = repository; this.#origin = validOrigin(publicOrigin ?? ''); }

  // Only the bodies show the absolute link; message.offerLink stays relative so the viewer button is same-origin.
  #withAbsoluteLink(message) {
    const { offerLink } = message;
    if (!this.#origin || typeof offerLink !== 'string' || !/^\/(?!\/)/.test(offerLink) || !safeOfferLink(offerLink)) return message;
    let absolute;
    try { const url = new URL(offerLink, this.#origin); if (url.origin !== this.#origin) return message; absolute = url.href; } catch { return message; }
    return { ...message, textBody: message.textBody.replaceAll(offerLink, absolute),
      htmlBody: message.htmlBody.replaceAll(escape(offerLink), escape(absolute)) };
  }

  async send({ context, job, message, now }) {
    // Capture and sent acknowledgement are one commit. The repository, rather
    // than a process-local list, remains the sole authority across reopen/retry.
    return this.#repository.transaction(context, {
      commandId: `notify:capture:${inputDigest([job.jobId, job.attempts])}`,
      inputDigest: inputDigest([job.jobId, job.inputDigest, job.attempts]),
    }, async (tx) => {
      const found = await tx.get({ table: 'notification_outbox', key: { runId: context.runId, jobId: job.jobId } });
      if (found.status !== 'ok') return found;
      if (found.value.state === 'sent') return ok({ state: 'sent' });
      if (found.value.state !== 'sending' || found.value.attempts !== job.attempts) return result('conflict', { reason: 'notification-attempt-changed' });
      const changed = await tx.compareAndSwap({ table: 'notification_outbox', key: { runId: context.runId, jobId: job.jobId } }, found.value.version, {
        state: 'sent', transport: 'captured', outcome: { ...found.value.outcome, error: null, nextAttemptAt: null,
          capturedAt: now, message: { ...this.#withAbsoluteLink(message), runId: context.runId, jobId: job.jobId, capturedAt: now } },
      });
      return changed.status === 'ok' ? ok({ state: 'sent' }) : changed;
    });
  }
}
