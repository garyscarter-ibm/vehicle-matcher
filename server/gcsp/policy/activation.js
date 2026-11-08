import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from './file-provider.js';

const unavailable = () => result('unavailable', { code: 'policy-activation-unavailable',
  reason: 'The published policy is awaiting run activation.', retryable: true });
const stale = () => result('stale-run', { reason: 'This request belongs to an earlier demonstration run.' });
const current = (run, context) => run.current === true && run.status !== 'historical'
  && run.runId === context.runId && run.environmentId === context.environmentId;

// Trusted context/session composition only. Guards and what-if evaluation must remain read-only.
export async function activateRunPolicy({ repository, policy }, context) {
  try {
    if (!repository || !policy) return unavailable();
    const ref = { table: 'runs', key: { runId: context.runId } };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const found = await repository.read(context, ref);
      if (found.status !== 'ok') return found;
      const run = found.value;
      if (!current(run, context)) return stale();
      if (!validInstant(run.clockInstant)) return unavailable();
      const active = await policy.getActiveVersion({ runId: run.runId, asOf: run.clockInstant });
      if (active.status !== 'ok') return active;
      let adopted = found;
      if (run.policyVersion !== active.policyVersion || run.versions?.policy !== active.policyVersion) {
        const input = { runVersion: run.version, clockInstant: run.clockInstant, policyVersion: active.policyVersion };
        const digest = inputDigest(input);
        adopted = await repository.transaction(context, { commandId: `policy:activate:${digest}`, inputDigest: digest }, async (tx) => {
          const latest = await tx.get(ref);
          if (latest.status !== 'ok') return latest;
          if (!current(latest.value, context)) return stale();
          return tx.compareAndSwap(ref, run.version, { policyVersion: active.policyVersion,
            versions: { ...run.versions, policy: active.policyVersion } });
        });
        if (adopted.status === 'stale-version' || adopted.status === 'conflict') continue;
        if (adopted.status !== 'ok') return adopted;
      }
      const final = await repository.read(context, ref);
      if (final.status !== 'ok') return final;
      if (!current(final.value, context)) return stale();
      const version = await policy.getActiveVersion({ runId: run.runId, asOf: final.value.clockInstant });
      if (version.status !== 'ok') return version;
      if (final.value.policyVersion !== version.policyVersion || final.value.versions?.policy !== version.policyVersion) continue;
      return ok({ run: final.value, policyVersion: version.policyVersion, asOf: final.value.clockInstant });
    }
    return result('conflict', { code: 'policy-activation-conflict', reason: 'Run policy changed during activation. Retry.', retryable: true });
  } catch { return unavailable(); }
}
