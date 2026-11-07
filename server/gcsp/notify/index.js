import { inputDigest, ok, result } from '../repository/index.js';
import { CapturedTransport } from './captured.js';
import { createMailTransport } from './config.js';
import { MAIL_FAILURE_CODES, confirmedBrevoAcknowledgement } from './brevo.js';
import { renderOfferMessage } from './templates.js';
import { renderCaseMessage } from '../cases/notification.js';
export { BrevoMailTransport } from './brevo.js';
export { createMailTransport } from './config.js';
export { MailTransport } from './port.js';
export { CapturedTransport } from './captured.js';
export { renderOfferMessage } from './templates.js';

const unavailable = () => result('unavailable', { reason: 'Captured notifications are unavailable.', retryable: true });
const ref = (context, jobId) => ({ table: 'notification_outbox', key: { runId: context.runId, jobId } });
const attempt = ({ jobId, version, attempts, state }) => ({ jobId, version, attempts, state });
const matchesAttempt = (job, claimed) => job.jobId === claimed.jobId && job.version === claimed.version
  && job.attempts === claimed.attempts && job.state === 'sending' && claimed.state === 'sending';
// A configured transport may add only its capture and provider custody within the same attempt.
const snapshot = ({ version, updatedAt, transport, outcome, ...rest }) => {
  const { message, capturedAt, provider, ...kept } = outcome ?? {}; return inputDigest({ ...rest, outcome: kept });
};
const sameAttempt = (found, job, version) => found.jobId === job.jobId && found.attempts === job.attempts
  && found.state === 'sending' && found.version === version && snapshot(found) === snapshot(job);
const due = (job, now) => job.state === 'pending' || job.state === 'sending'
  || job.state === 'retrying' && Date.parse(job.outcome?.nextAttemptAt) <= Date.parse(now);

export class NotificationDispatcher {
  #repository; #policy; #clock; #environmentId; #transport; #logger;
  #active; #again = false; #startup; #unsubscribe;
  constructor({ repository, policy, clock, environmentId, mail, transport = createMailTransport({ repository, ...mail }), logger } = {}) {
    if (!repository || !policy || !clock || !environmentId || typeof transport?.send !== 'function') throw new TypeError('Inject notification ports and a trusted environment.');
    this.#repository = repository; this.#policy = policy; this.#clock = clock;
    this.#environmentId = environmentId; this.#transport = transport; this.#logger = logger;
  }

  async start() {
    this.#startup ??= (async () => {
      const registered = await this.#clock.registerHandler({ handlerId: 'captured-outbox', stage: 'outbox-dispatch',
        handle: ({ context }) => this.dispatchPending(context) });
      if (registered.status !== 'ok') return registered;
      this.#unsubscribe = this.#repository.afterCommit(({ context, commandId }) => {
        // Notification bookkeeping is itself committed work. Ignore its own
        // namespace, so a drain never waits recursively for its own observer.
        if (context.environmentId === this.#environmentId && !commandId.startsWith('notify:')) return this.dispatchPending(context);
      });
      return this.dispatchPending();
    })();
    return this.#startup;
  }
  close() { this.#unsubscribe?.(); this.#unsubscribe = undefined; return this.#active ?? Promise.resolve(); }

  async dispatchPending(expectedContext) {
    if (expectedContext) {
      const current = await this.#repository.currentRun(this.#environmentId);
      if (current.status !== 'ok') return current;
      if (expectedContext.runId !== current.value.runId || expectedContext.environmentId !== this.#environmentId) return result('stale-run', { reason: 'Notifications belong to an earlier run.' });
    }
    // Coalesce same-instance triggers. Other instances share durable CAS and the
    // transport's per-job acknowledgement; no local message store is involved.
    if (this.#active) { this.#again = true; return this.#active; }
    this.#active = (async () => {
      let outcome;
      do { this.#again = false; outcome = await this.#drain(); } while (this.#again);
      return outcome;
    })().catch(() => unavailable()).finally(() => { this.#active = undefined; });
    return this.#active;
  }

  async #drain() {
    const current = await this.#repository.currentRun(this.#environmentId);
    if (current.status !== 'ok') return current;
    // Backend-owned service principal, the same persisted authority used by the clock.
    const context = { runId: current.value.runId, environmentId: this.#environmentId, principalId: 'notification-dispatcher', roles: [] };
    const clock = await this.#clock.now(context);
    if (clock.status !== 'ok') return clock;
    const now = clock.value.now;
    const configured = await this.#policy.getAssumption('notify.delivery.v1', { runId: context.runId, asOf: now, policyVersion: current.value.policyVersion });
    const rules = configured.value?.value;
    if (configured.status !== 'ok' || !Number.isSafeInteger(rules?.maxAttempts) || rules.maxAttempts < 1
      || !Number.isSafeInteger(rules?.retryBaseSeconds) || rules.retryBaseSeconds < 1
      || !Number.isSafeInteger(rules?.retryMaximumSeconds) || rules.retryMaximumSeconds < rules.retryBaseSeconds) return unavailable();
    const principals = await this.#policy.getAssumption('identity.demo.principals', { runId: context.runId, asOf: now, policyVersion: current.value.policyVersion });
    if (principals.status !== 'ok' || !Array.isArray(principals.value?.value)) return unavailable();
    const jobs = await this.#repository.query(context, 'notification_outbox');
    if (jobs.status !== 'ok') return jobs;
    const counts = { sent: 0, retrying: 0, failed: 0 };
    for (const candidate of jobs.value.filter((job) => due(job, now))) {
      const claimed = await this.#repository.transaction(context, {
        commandId: `notify:attempt:${inputDigest([candidate.jobId, candidate.version])}`,
        inputDigest: inputDigest([candidate.jobId, candidate.version]),
      }, async (tx) => {
        const found = await tx.get(ref(context, candidate.jobId));
        if (found.status !== 'ok') return found;
        const job = found.value;
        if (!due(job, now)) return ok(null);
        if (job.state === 'sending') return ok(attempt(job)); // recover an interrupted durable attempt
        // Keep captured message and provider custody across attempts.
        const changed = await tx.compareAndSwap(ref(context, job.jobId), job.version, { state: 'sending', attempts: (job.attempts ?? 0) + 1,
          outcome: { ...job.outcome, attemptedAt: now, error: null, nextAttemptAt: null, policyVersion: configured.policyVersion } });
        return changed.status === 'ok' ? ok(attempt(changed.value)) : changed;
      });
      if (claimed.status === 'stale-run') return claimed;
      if (claimed.status !== 'ok' || !claimed.value) continue;
      const found = await this.#repository.read(context, ref(context, claimed.value.jobId));
      if (found.status === 'stale-run') return found;
      if (found.status !== 'ok' || !matchesAttempt(found.value, claimed.value)) continue;
      const job = found.value;
      const stillCurrent = async () => {
        const current = await this.#repository.read(context, ref(context, job.jobId));
        if (current.status !== 'ok') return current;
        return ok(matchesAttempt(current.value, claimed.value) && inputDigest(current.value) === inputDigest(job));
      };
      let obsolete = false;
      let delivery;
      let error = 'transport-unavailable';
      let retryable = true;
      try {
        const caseUpdate = job.messageKind === 'renewal-case-update' && job.messageVersion === '1';
        if (confirmedBrevoAcknowledgement(job.outcome?.provider)) delivery = ok({ accepted: true });
        else if (caseUpdate) {
          const employee = await this.#repository.read(context, { table: 'employees', key: { runId: context.runId, employeeId: job.recipientId } });
          const update = job.payload?.caseUpdate;
          if (employee.status === 'unavailable') throw new Error();
          if (employee.status !== 'ok' || !principals.value.value.some((p) => p.employeeId === employee.value.employeeId
            && p.principalId === employee.value.principalId && p.roles.includes('employee'))) {
            error = 'fictional-recipient-required'; retryable = false;
          } else if (update?.runId !== context.runId || update?.employeeId !== employee.value.employeeId) {
            error = 'recipient-mismatch'; retryable = false;
          } else {
            let message;
            try { message = renderCaseMessage({ update, employee: employee.value }); }
            catch { error = 'message-invalid'; retryable = false; }
            if (message) {
              const current = await stillCurrent();
              if (current.status === 'stale-run') return current;
              obsolete = current.status === 'ok' && !current.value;
              if (current.status === 'ok' && current.value) delivery = await this.#transport.send({ context, job, message, now });
            }
          }
        } else {
          const offer = await this.#repository.read(context, { table: 'offers', key: { runId: context.runId, offerId: job.offerId } });
          const employee = await this.#repository.read(context, { table: 'employees', key: { runId: context.runId, employeeId: job.recipientId } });
          if (offer.status !== 'ok' || employee.status !== 'ok') {
            if (offer.status === 'unavailable' || employee.status === 'unavailable') throw new Error();
            error = 'message-facts-unavailable'; retryable = false;
          } else if (!principals.value.value.some((principal) => principal.employeeId === employee.value.employeeId
            && principal.principalId === employee.value.principalId && principal.roles.includes('employee'))) {
            error = 'fictional-recipient-required'; retryable = false;
          } else if (offer.value.employeeId !== employee.value.employeeId || offer.value.environmentId && offer.value.environmentId !== context.environmentId) {
            error = 'recipient-mismatch'; retryable = false;
          } else if (offer.value.state !== 'active' || Date.parse(offer.value.expiresAt) <= Date.parse(now)) {
            error = offer.value.state === 'active' || offer.value.state === 'expired' ? 'offer-expired' : 'offer-inactive'; retryable = false;
          } else if (job.messageKind !== 'offer' || job.messageVersion !== '1') {
            error = 'message-version-unsupported'; retryable = false;
          } else {
            const quote = await this.#repository.read(context, { table: 'quotes', key: { runId: context.runId, quoteId: offer.value.quoteId } });
            if (quote.status === 'unavailable') throw new Error();
            let message;
            try { message = renderOfferMessage({ offer: offer.value, quote: quote.value, employee: employee.value, offerLink: job.payload?.offerLink, now }); }
            catch { error = 'message-invalid'; retryable = false; }
            if (message) {
              const current = await stillCurrent();
              if (current.status === 'stale-run') return current;
              obsolete = current.status === 'ok' && !current.value;
              if (current.status === 'ok' && current.value) delivery = await this.#transport.send({ context, job, message, now });
            }
          }
        }
      } catch { /* Never retain or emit provider exception text or token-bearing inputs. */ }
      if (obsolete) continue;
      const custody = Number.isSafeInteger(delivery?.custodyVersion) ? delivery.custodyVersion : job.version;
      if (delivery?.status === 'stale-run') return delivery;
      if (delivery?.status === 'ok') {
        const acknowledged = await this.#repository.transaction(context, {
          commandId: `notify:sent:${inputDigest([job.jobId, job.attempts])}`, inputDigest: inputDigest([job.jobId, job.attempts]),
        }, async (tx) => {
          const found = await tx.get(ref(context, job.jobId));
          if (found.status !== 'ok') return found;
          if (found.value.state === 'sent') return ok({ state: 'sent' });
          if (!sameAttempt(found.value, job, custody)) return ok(null);
          const changed = await tx.compareAndSwap(ref(context, job.jobId), found.value.version, {
            state: 'sent', transport: this.#transport instanceof CapturedTransport ? 'captured' : 'configured',
            outcome: { ...found.value.outcome, error: null, nextAttemptAt: null, acknowledgedAt: now },
          });
          return changed.status === 'ok' ? ok({ state: 'sent' }) : changed;
        });
        if (acknowledged.status !== 'ok') return acknowledged;
        if (acknowledged.value) counts.sent += 1;
        continue;
      }
      if (MAIL_FAILURE_CODES.has(delivery?.code)) { error = delivery.code; retryable = delivery.retryable === true; }
      else if (delivery && typeof delivery.retryable === 'boolean') retryable = delivery.retryable;
      const state = retryable && job.attempts < rules.maxAttempts ? 'retrying' : 'failed';
      const delay = Math.min(rules.retryMaximumSeconds, rules.retryBaseSeconds * 2 ** Math.min(job.attempts - 1, 52));
      const nextAttemptAt = state === 'retrying' ? new Date(Date.parse(now) + delay * 1000).toISOString() : null;
      const failure = await this.#repository.transaction(context, {
        commandId: `notify:failure:${inputDigest([job.jobId, job.attempts])}`, inputDigest: inputDigest([job.jobId, job.attempts, error, state]),
      }, async (tx) => {
        const found = await tx.get(ref(context, job.jobId));
        if (found.status !== 'ok') return found;
        if (!sameAttempt(found.value, job, custody)) return ok(null);
        const changed = await tx.compareAndSwap(ref(context, job.jobId), found.value.version, {
          state, outcome: { ...found.value.outcome, error, nextAttemptAt },
        });
        return changed.status === 'ok' ? ok({ state: changed.value.state }) : changed;
      });
      if (failure.status === 'stale-run') return failure;
      if (failure.status === 'ok' && failure.value) {
        counts[state] += 1;
        try { await this.#logger?.warn?.({ event: 'notification-attempt-failed', state, attempt: job.attempts, error }); } catch { /* diagnostics cannot alter delivery state */ }
      }
    }
    return ok(counts);
  }
}

export const createNotificationDispatcher = (ports) => new NotificationDispatcher(ports);
