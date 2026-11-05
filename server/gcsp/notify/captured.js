import { MailTransport } from './port.js';
import { inputDigest, ok, result } from '../repository/index.js';

export class CapturedTransport extends MailTransport {
  #repository;
  constructor({ repository }) { super(); this.#repository = repository; }

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
          capturedAt: now, message: { ...message, runId: context.runId, jobId: job.jobId, capturedAt: now } },
      });
      return changed.status === 'ok' ? ok({ state: 'sent' }) : changed;
    });
  }
}
