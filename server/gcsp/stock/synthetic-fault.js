import { result } from '../repository/index.js';

// Presenter-set synthetic stock fault (FUCQ-130), keyed by run, so a reset (a new run) clears it.
// It alters synthetic pulls only; an operational provider's response always passes through unchanged.
export const STOCK_FAULT_MODES = Object.freeze(['none', 'unavailable', 'stale']);
export const STOCK_SOURCE_MAX_AGE_KEY = 'supply.stockSource.maxAgeMinutes';

export async function readStockSourceMaxAge(policy, read) {
  let row;
  try { row = await policy.getAssumption(STOCK_SOURCE_MAX_AGE_KEY, read); } catch { return null; }
  const minutes = row?.value?.value;
  return row?.status === 'ok' && row.value.unit === 'minutes' && Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

const failed = (code, reason) => result('unavailable', { code, reason, retryable: true });

export function createSyntheticStockFaults({ policy } = {}) {
  const modes = new Map();
  const valid = (runId) => typeof runId === 'string' && runId.length > 0 && runId.length <= 128;
  return Object.freeze({
    read: (runId) => ({ adapter: 'stock', runId, mode: modes.get(runId) ?? 'none', modes: [...STOCK_FAULT_MODES] }),
    set(runId, mode) {
      if (!valid(runId) || !STOCK_FAULT_MODES.includes(mode)) return false;
      if (mode === 'none') modes.delete(runId); else modes.set(runId, mode);
      return true;
    },
    wrap(provider) {
      if (typeof provider?.pull !== 'function') return provider;
      return Object.freeze({ ...provider,
        async pull(request) {
          const out = await provider.pull(request);
          const mode = modes.get(request?.runId);
          if (!mode || out?.status !== 'ok' || out.value?.source?.mode !== 'synthetic') return out;
          if (mode === 'unavailable') return failed('synthetic-stock-unavailable', 'Stock source is unavailable.');
          // Stale: the same list, last observed just beyond the policy age, so the release service refuses it.
          const minutes = await readStockSourceMaxAge(policy, { runId: request.runId, asOf: request.asOf, policyVersion: request.policyVersion });
          if (!minutes) return failed('stock-source-age-unavailable', 'The stock source age policy is unavailable.');
          return { ...out, value: { ...out.value, observedAt: new Date(Date.parse(request.asOf) - (minutes + 1) * 60000).toISOString() } };
        } });
    },
  });
}
