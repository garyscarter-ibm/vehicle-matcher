// Presenter-set synthetic ordering fault (FUCQ-131), keyed by run, so a reset (a new run) clears it.
// It applies to the next handoff only: the provider records its answer, the response is lost, reconciliation finds it.
export const ORDERING_FAULT_MODES = Object.freeze(['none', 'timeout-acknowledged', 'timeout-rejected', 'uncertain-acknowledged', 'uncertain-rejected']);

export function createSyntheticOrderingFaults() {
  const modes = new Map(); const handoffs = new Map();
  const valid = (runId) => typeof runId === 'string' && runId.length > 0 && runId.length <= 128;
  return Object.freeze({
    read: (runId) => ({ adapter: 'ordering', runId, mode: modes.get(runId) ?? 'none', modes: [...ORDERING_FAULT_MODES],
      handoffs: structuredClone(handoffs.get(runId) ?? []) }),
    set(runId, mode) {
      if (!valid(runId) || !ORDERING_FAULT_MODES.includes(mode)) return false;
      if (mode === 'none') modes.delete(runId); else modes.set(runId, mode);
      return true;
    },
    // Called once per provider write: counts every write and consumes a pending fault.
    take(runId, operationId) {
      const mode = modes.get(runId); modes.delete(runId);
      const [response, resolution] = mode ? mode.split('-') : [null, null];
      handoffs.set(runId, [...(handoffs.get(runId) ?? []), { operationId, response: response ?? 'answered', ...(resolution ? { resolution } : {}) }]);
      return mode ? { response, resolution } : null;
    },
  });
}
