import { ok, result } from '../repository/core.js';

const CODE = /^[a-z][a-z0-9-]{0,63}$/;
const text = (value) => (typeof value === 'string' ? value : null);
const instant = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);

// Safe projection only: row internals (payload, idempotency key, input digest) never leave the server.
function project(job, names) {
  const outcome = job.outcome && typeof job.outcome === 'object' ? job.outcome : {};
  const message = outcome.message && typeof outcome.message === 'object' ? outcome.message : null;
  const employeeId = text(message?.recipient?.employeeId) ?? text(job.recipientId);
  return {
    jobId: job.jobId,
    messageKind: text(job.messageKind),
    state: job.state,
    attempts: Number.isSafeInteger(job.attempts) ? job.attempts : 0,
    error: CODE.test(outcome.error ?? '') ? outcome.error : (outcome.error ? 'unknown' : null),
    nextAttemptAt: instant(outcome.nextAttemptAt),
    time: instant(job.state === 'sent' ? outcome.capturedAt : outcome.attemptedAt),
    recipient: { employeeId, name: text(message?.recipient?.name) ?? names.get(employeeId) ?? null },
    subject: text(message?.subject),
    textBody: text(message?.textBody),
    htmlBody: text(message?.htmlBody),
    offerLink: text(message?.offerLink),
  };
}

const newestFirst = (a, b) => {
  if (a.time !== b.time) return a.time === null ? 1 : b.time === null ? -1 : Date.parse(b.time) - Date.parse(a.time);
  return a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0;
};

export function createOutboxRoutes(outbox) {
  return [{ method: 'GET', path: '/api/gcsp/presenter/outbox', role: 'presenter', purpose: 'presenter-control',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].length || Object.keys(body).length) return result('invalid', {
        code: 'unsupported-query', reasons: [{ field: 'query', reason: 'The outbox viewer accepts no query selectors.' }],
      });
      const repository = outbox?.repository;
      if (!repository) return result('unavailable', { reason: 'The captured outbox has not been configured.', retryable: true });
      const jobs = await repository.query(context, 'notification_outbox');
      if (jobs.status !== 'ok') return jobs;
      const employees = await repository.query(context, 'employees');
      const names = new Map(employees.status === 'ok'
        ? employees.value.filter((row) => text(row.name)).map((row) => [row.employeeId, row.name]) : []);
      const messages = jobs.value.filter((job) => job.state !== 'stale').map((job) => project(job, names)).sort(newestFirst);
      return ok({ runId: context.runId, messages });
    } }];
}
