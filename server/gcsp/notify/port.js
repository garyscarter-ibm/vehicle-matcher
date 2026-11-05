// A transport must acknowledge a stable (runId, jobId), idempotently. Exceptions and
// provider diagnostics are private; the dispatcher persists only fixed safe codes.
// CapturedTransport commits its acknowledgement and message in the repository.
export class MailTransport {
  async send() { throw new Error('Mail transport is not configured.'); }
}
